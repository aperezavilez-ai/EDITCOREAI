"use strict";

// Saldo de EditCoreAI en dólares. El saldo, los códigos de recarga y la administración viven en el
// servidor de cuentas (funciones public.editcoreai_*); el cobro por tokens lo hace solo el servidor
// (función ai-proxy). Si el servidor no responde, no se permite ejecutar (nunca saldo infinito).

const { EventEmitter } = require("node:events");
const { authManager: defaultAuth } = require("./auth-manager");

const CREDIT_ERRORS = {
  NO_SESSION: "Inicia sesión con Google para usar EditCoreAI.",
  OUT_OF_CREDITS: "Tu saldo se agotó. Recarga para seguir usando la IA de EditCoreAI.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
  INVALID_CODE: "El código no es válido.",
  EXPIRED: "El código ya expiró.",
  USED_UP: "Este código ya se usó por completo.",
  ALREADY_REDEEMED: "Ya canjeaste este código con tu cuenta.",
  TOO_MANY_ATTEMPTS: "Demasiados intentos fallidos. Espera una hora antes de volver a intentar.",
  CANNOT_CHANGE_SELF: "No puedes cambiar el estado de tu propia cuenta.",
  INVALID_PRICE: "El precio debe ser mayor que 0.",
  INVALID_CREDIT: "El saldo de la recarga debe ser mayor que 0.",
  INVALID_LINK: "El link debe ser un link de pago de Mercado Pago (https://mpago.la/…).",
  INVALID_CONTACT: "El contacto es demasiado largo (máximo 120 caracteres).",
  INVALID_AMOUNT: "La cantidad no es válida.",
  NO_READING: "Todavía no hay una lectura del saldo de ME AI; pulsa «Actualizar» e inténtalo de nuevo.",
  NOT_FOUND: "Ese registro ya no existe.",
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

function usageMeter(account = {}) {
  const balance = Math.max(0, Number(account.credits_balance || 0));
  const topupBase = Math.max(balance, Number(account.topup_base || 0));
  const used = Math.max(0, topupBase - balance);
  const usedPercent = topupBase > 0 ? Math.min(100, (used / topupBase) * 100) : (balance > 0 ? 0 : 100);
  return { balance, topupBase, used, usedPercent };
}

function balanceView(account = {}) {
  const unlimited = Boolean(account.is_unlimited) || account.role === "admin";
  const meter = usageMeter(account);
  const active = account.status === "active";
  return {
    balance: meter.balance,
    topupBase: meter.topupBase,
    used: meter.used,
    usedPercent: unlimited ? 0 : meter.usedPercent,
    isUnlimited: unlimited,
    role: account.role === "admin" ? "admin" : "user",
    status: account.status || "unknown",
    email: account.email || "",
    canExecute: active && (unlimited || meter.balance > 0),
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

  // Antes de cada consulta: cuenta activa y saldo mayor que cero (o ilimitada).
  // El descuento real lo hace el servidor al terminar la respuesta, según los tokens usados.
  async checkCanRun() {
    if (!this.auth.isAuthenticated()) return failure({ code: "NO_SESSION" });
    let account;
    try {
      account = await this.auth.refreshAccount();
    } catch (error) {
      return { ...failure(error), canExecute: false };
    }
    const view = balanceView(account || {});
    if (view.status !== "active") return { ...failure({ code: "ACCOUNT_SUSPENDED" }), ...view };
    if (!view.canExecute) return { ...failure({ code: "OUT_OF_CREDITS" }), ...view };
    return { ok: true, success: true, ...view };
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

  /** Saldo global de ME AI: lectura en vivo (la guarda el servidor) y el reparto por usuarios/admin. */
  async adminMeaiBalance() {
    let live = null;
    let liveError = "";
    try {
      live = await this.auth.meaiBalance();
    } catch (error) {
      liveError = failure(error).error;
    }
    try {
      const summary = await this.auth.rpc("editcoreai_admin_meai_summary");
      return { ok: true, success: true, live, liveError, summary };
    } catch (error) {
      return { ...failure(error), live, liveError };
    }
  }

  /** Registra una compra en ME AI: dólares de panel recibidos, monto pagado, moneda y tipo de cambio a USD. */
  async adminMeaiTopup({ panel, amount, currency = "CNY", fx = 1, note = "" } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_meai_topup", {
        p_panel: Number(panel),
        p_amount: Number(amount),
        p_currency: String(currency || "USD").toUpperCase(),
        p_fx_usd: Number(fx),
        p_note: String(note || "") || null,
      }));
    } catch (error) {
      return failure(error);
    }
  }

  async adminMeaiDeleteTopup(id) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_meai_delete_topup", { p_id: Number(id) }));
    } catch (error) {
      return failure(error);
    }
  }

  async adminSetMarkup(markup) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_set_markup", { p_markup: Number(markup) }));
    } catch (error) {
      return failure(error);
    }
  }

  /** Tipo de cambio del día: cuántos USD vale 1 unidad de la moneda. */
  async fxRateUsd(currency = "CNY") {
    const code = String(currency || "").toUpperCase();
    if (code === "USD") return { ok: true, rate: 1 };
    if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: "Moneda no válida." };
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${code}`, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json();
      const rate = Number(data?.rates?.USD);
      if (!res.ok || !(rate > 0)) throw new Error("sin tipo de cambio");
      return { ok: true, rate, at: data?.time_last_update_utc || "" };
    } catch {
      return { ok: false, error: "No se pudo obtener el tipo de cambio; escríbelo a mano." };
    }
  }

  /** Corrige el saldo global con lo que muestra ME AI; remaining null quita la corrección. */
  async adminMeaiSetBalance({ remaining = null } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_meai_set_balance", {
        p_remaining: remaining == null || remaining === "" ? null : Number(remaining),
      }));
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

  async adminPayments() {
    try {
      return { ok: true, success: true, payments: await this.auth.rpc("editcoreai_admin_payments") };
    } catch (error) {
      return failure(error);
    }
  }

  async adminSetPaymentLink({ link = "", contact = "" } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_set_payment_link", {
        p_link: String(link || "").trim(),
        p_contact: String(contact || "").trim().slice(0, 120),
      }));
    } catch (error) {
      return failure(error);
    }
  }

  async adminSetTopup({ price, creditUsd = null } = {}) {
    try {
      return fromServer(await this.auth.rpc("editcoreai_admin_set_topup", {
        p_price: Number(price),
        p_credit_usd: creditUsd === null || creditUsd === "" ? null : Number(creditUsd),
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
      { id: "recarga_20", credits: 20, priceUsd: 20, priceLabel: "$20 USD", title: "$20 de saldo", tag: "Acceso", bonus: "" },
    ];
  }
}

const creditLedgerInstance = new CreditLedger();

module.exports = { CreditLedger, creditLedger: creditLedgerInstance, CREDIT_ERRORS, balanceView, usageMeter };
