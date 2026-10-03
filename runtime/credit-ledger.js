"use strict";

// Créditos de EditCoreAI. El saldo, los cobros, los códigos de recarga y la administración
// viven en el servidor de cuentas (funciones public.editcoreai_*); este módulo solo las llama
// con la sesión del usuario. Si el servidor no responde, no se permite ejecutar (nunca saldo infinito).

const { EventEmitter } = require("node:events");
const { authManager: defaultAuth } = require("./auth-manager");

const RUN_COST_CREDITS = 1;

const CREDIT_ERRORS = {
  OUT_OF_CREDITS: "No tienes créditos suficientes. Canjea un código de recarga o pide créditos al administrador.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
  INVALID_CODE: "El código no es válido.",
  EXPIRED: "El código ya expiró.",
  USED_UP: "Este código ya se usó por completo.",
  ALREADY_REDEEMED: "Ya canjeaste este código con tu cuenta.",
  TOO_MANY_ATTEMPTS: "Demasiados intentos fallidos. Espera una hora antes de volver a intentar.",
  CANNOT_CHANGE_SELF: "No puedes cambiar el estado de tu propia cuenta.",
};

function failure(error) {
  const code = String(error?.code || "SERVER");
  return { ok: false, success: false, code, error: CREDIT_ERRORS[code] || error?.message || code };
}

function fromServer(data) {
  if (data && data.ok === false) {
    const code = String(data.error || "SERVER");
    return { ok: false, success: false, code, error: CREDIT_ERRORS[code] || code, account: data.account || null };
  }
  return { ok: true, success: true, ...(data || {}) };
}

function balanceView(account = {}) {
  const unlimited = Boolean(account.is_unlimited) || account.role === "admin";
  const balance = Number(account.credits_balance || 0);
  const active = account.status === "active";
  return {
    balance,
    isUnlimited: unlimited,
    role: account.role === "admin" ? "admin" : "user",
    status: account.status || "unknown",
    email: account.email || "",
    canExecute: active && (unlimited || balance >= RUN_COST_CREDITS),
  };
}

class CreditLedger extends EventEmitter {
  constructor(options = {}) {
    super();
    this.auth = options.auth || defaultAuth;
  }

  async getBalance() {
    try {
      const account = await this.auth.refreshAccount();
      return { ok: true, success: true, ...balanceView(account) };
    } catch (error) {
      return { ...failure(error), balance: 0, isUnlimited: false, canExecute: false };
    }
  }

  async chargeRun({ model = "", description = "Consulta de IA", amount = RUN_COST_CREDITS } = {}) {
    if (!this.auth.isAuthenticated()) return failure({ code: "NO_SESSION", message: "Inicia sesión con Google para usar EditCoreAI." });
    try {
      const res = fromServer(await this.auth.rpc("editcoreai_consume_credits", {
        p_amount: amount,
        p_model: String(model || "").slice(0, 120) || null,
        p_tokens_in: 0,
        p_tokens_out: 0,
        p_description: String(description || "").slice(0, 300) || null,
      }));
      if (res.account) this.auth.account = res.account;
      if (res.ok) this.emit("balance-changed", balanceView(res.account));
      return { ...res, ...(res.account ? balanceView(res.account) : {}) };
    } catch (error) {
      return failure(error);
    }
  }

  async redeemVoucher(code) {
    const clean = String(code || "").trim();
    if (!clean) return failure({ code: "INVALID_CODE" });
    try {
      const res = fromServer(await this.auth.rpc("editcoreai_redeem_voucher", { p_code: clean }));
      if (res.account) {
        this.auth.account = res.account;
        this.emit("balance-changed", balanceView(res.account));
      }
      return { ...res, ...(res.account ? balanceView(res.account) : {}) };
    } catch (error) {
      return failure(error);
    }
  }

  async listTransactions(limit = 20) {
    try {
      const rows = await this.auth.rpc("editcoreai_my_transactions", { p_limit: Number(limit) || 20 });
      return { ok: true, success: true, transactions: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { ...failure(error), transactions: [] };
    }
  }

  async adminOverview() {
    try {
      return { ok: true, success: true, overview: await this.auth.rpc("editcoreai_admin_overview") };
    } catch (error) {
      return failure(error);
    }
  }

  async adminListUsers(search = "") {
    try {
      const rows = await this.auth.rpc("editcoreai_admin_list_users", { p_search: String(search || "") || null, p_limit: 200 });
      return { ok: true, success: true, users: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { ...failure(error), users: [] };
    }
  }

  async adminCreateVoucher({ credits, maxUses = 1, expiresInDays = 0, note = "", code = "" } = {}) {
    const days = Number(expiresInDays) || 0;
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_create_voucher", {
        p_credits: Number(credits),
        p_max_uses: Math.max(1, parseInt(maxUses, 10) || 1),
        p_expires_at: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
        p_note: String(note || "").slice(0, 300) || null,
        p_code: String(code || "").trim() || null,
      }));
    } catch (error) {
      return failure(error);
    }
  }

  async adminGrantCredits({ email, amount, note = "" } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_grant_credits", {
        p_email: String(email || "").trim(),
        p_amount: Number(amount),
        p_note: String(note || "").slice(0, 300) || null,
      }));
    } catch (error) {
      return failure(error);
    }
  }

  async adminSetStatus({ email, status } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_set_status", {
        p_email: String(email || "").trim(),
        p_status: status === "suspended" ? "suspended" : "active",
      }));
    } catch (error) {
      return failure(error);
    }
  }

  // Tarifa de referencia por tokens (para la fase de cobro en servidor por consumo real).
  calculateUsageCredits(model = "claude-sonnet-4-6", inputTokens = 0, outputTokens = 0) {
    const m = String(model || "").toLowerCase();
    let inRatePer1M = 3.0;
    let outRatePer1M = 15.0;

    if (m.includes("haiku") || m.includes("gemini-2.5-flash") || m.includes("flash")) {
      inRatePer1M = 0.80; outRatePer1M = 4.00;
    } else if (m.includes("deepseek")) {
      inRatePer1M = 0.30; outRatePer1M = 1.20;
    } else if (m.includes("grok-4.5")) {
      inRatePer1M = 2.00; outRatePer1M = 10.00;
    } else if (m.includes("opus")) {
      inRatePer1M = 15.00; outRatePer1M = 75.00;
    }

    const inCostUsd = (Number(inputTokens || 0) / 1_000_000) * inRatePer1M;
    const outCostUsd = (Number(outputTokens || 0) / 1_000_000) * outRatePer1M;
    const totalCostUsd = inCostUsd + outCostUsd;
    const rawCredits = (totalCostUsd * 1.5) / 0.05;
    const creditsToDeduct = Math.max(0.1, Number(rawCredits.toFixed(2)));

    return { model, inputTokens, outputTokens, inRatePer1M, outRatePer1M,
      totalCostUsd: Number(totalCostUsd.toFixed(6)), credits: creditsToDeduct };
  }

  getPacks() {
    return [
      { id: "pack_100", credits: 100, priceUsd: 5, priceLabel: "$5 USD", title: "100 Créditos", tag: "Básico", bonus: "" },
      { id: "pack_500", credits: 500, priceUsd: 20, priceLabel: "$20 USD", title: "500 Créditos", tag: "Más Popular", bonus: "+25% extra" },
      { id: "pack_1500", credits: 1500, priceUsd: 50, priceLabel: "$50 USD", title: "1500 Créditos", tag: "Élite", bonus: "+50% extra" },
    ];
  }
}

const creditLedgerInstance = new CreditLedger();

module.exports = { CreditLedger, creditLedger: creditLedgerInstance, RUN_COST_CREDITS, CREDIT_ERRORS, balanceView };
