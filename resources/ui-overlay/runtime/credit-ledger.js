"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

const CREDITS_FILE_PATH = path.join(os.homedir(), ".editcore", "credits.json");

/**
 * Gestor de créditos, cuotas y pasarela de recarga de EditCoreAI.
 * Soporta administradores con créditos ilimitados y usuarios estándar con balance numérico.
 */
class CreditLedger extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.storagePath = options.storagePath || CREDITS_FILE_PATH;
    const defBal = options.defaultCredits !== undefined ? options.defaultCredits : (options.defaultUserBalance !== undefined ? options.defaultUserBalance : 100);
    this.state = {
      defaultUserBalance: defBal,
      adminEmail: "aperezavilez@gmail.com",
      adminName: "Alfonso Perez Avilez",
      users: {},
      transactions: [],
    };
    this._load();
    if (options.defaultCredits !== undefined || options.defaultUserBalance !== undefined) {
      this.state.defaultUserBalance = defBal;
    }
  }

  _ensureDir() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const parsed = JSON.parse(raw);
        this.state = { ...this.state, ...parsed };
      }
    } catch {
      // Usar estado predeterminado
    }

    // Asegurar cuenta de administrador total
    if (!this.state.users[this.state.adminEmail]) {
      this.state.users[this.state.adminEmail] = {
        userId: this.state.adminEmail,
        name: this.state.adminName,
        email: this.state.adminEmail,
        role: "admin", // admin | user
        balance: Infinity,
        isUnlimited: true,
        createdAt: new Date().toISOString(),
      };
    }
  }

  _save() {
    try {
      this._ensureDir();
      const serializableUsers = {};
      for (const [id, u] of Object.entries(this.state.users)) {
        serializableUsers[id] = {
          ...u,
          balance: u.balance === Infinity ? "Infinity" : u.balance,
        };
      }
      const dataToSave = {
        ...this.state,
        users: serializableUsers,
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(dataToSave, null, 2), "utf8");
    } catch {
      // Fallback en memoria
    }
  }

  /**
   * Obtiene o crea el registro de usuario.
   */
  getUser(userId = this.state.adminEmail) {
    const id = String(userId || this.state.adminEmail).toLowerCase();
    if (!this.state.users[id]) {
      const isAdmin = id === this.state.adminEmail.toLowerCase() || id === "admin" || id === "alfonso perez avilez";
      this.state.users[id] = {
        userId: id,
        name: isAdmin ? this.state.adminName : `Usuario ${id.split("@")[0] || id}`,
        email: isAdmin ? this.state.adminEmail : id,
        role: isAdmin ? "admin" : "user",
        balance: isAdmin ? Infinity : this.state.defaultUserBalance,
        isUnlimited: isAdmin,
        createdAt: new Date().toISOString(),
      };
      this._save();
    }
    const user = this.state.users[id];
    const isAdmin = user.role === "admin" || id === this.state.adminEmail.toLowerCase() || id === "admin";
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: isAdmin ? "admin" : user.role,
      balance: isAdmin ? Infinity : Number(user.balance || 0),
      isUnlimited: isAdmin || user.isUnlimited === true,
      isSuperAdmin: isAdmin,
      avatarUrl: user.avatarUrl || null,
    };
  }

  redeemCode(userId, code) {
    const res = this.redeemVoucher(userId, code);
    return {
      success: res.ok,
      balance: res.newBalance !== undefined ? res.newBalance : (this.getUser(userId).balance),
      error: res.error,
      message: res.message,
    };
  }

  /**
   * Obtiene el saldo de créditos disponible para el usuario.
   */
  getBalance(userId = this.state.adminEmail) {
    const user = this.getUser(userId);
    return {
      userId: user.userId,
      role: user.role,
      balance: user.balance,
      isUnlimited: user.isUnlimited,
      canExecute: user.isUnlimited || user.balance > 0,
    };
  }

  /**
   * Descuenta créditos por uso de modelos/agentes.
   */
  deductCredits(userId = this.state.adminEmail, amount = 1) {
    const user = this.getUser(userId);

    if (user.role === "admin" || user.isUnlimited) {
      return { ok: true, success: true, balance: Infinity, isUnlimited: true, deducted: 0 };
    }

    const current = Number(user.balance || 0);
    const toDeduct = Math.max(1, Number(amount || 1));

    if (current <= 0 || current < toDeduct) {
      this.emit("credits:depleted", { userId: user.userId, balance: current });
      return {
        ok: false,
        success: false,
        code: "OUT_OF_CREDITS",
        error: "OUT_OF_CREDITS",
        message: "Saldo de créditos agotado. Añade más créditos para continuar utilizando EditCoreAI.",
        balance: current,
        required: toDeduct,
      };
    }

    const newBalance = current - toDeduct;
    this.state.users[user.userId].balance = newBalance;
    this._save();

    this.emit("credits:deducted", { userId: user.userId, deducted: toDeduct, newBalance });
    return {
      ok: true,
      success: true,
      balance: newBalance,
      deducted: toDeduct,
      isUnlimited: false,
    };
  }

  /**
   * Añade saldo de créditos al usuario (tras pago o recarga de admin).
   */
  addCredits(userId, amount, reference = "manual_recharge") {
    const user = this.getUser(userId);
    const addedAmount = Math.max(0, Number(amount || 0));

    if (user.role !== "admin") {
      const current = Number(user.balance || 0);
      this.state.users[user.userId].balance = current + addedAmount;
    }

    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: user.userId,
      amount: addedAmount,
      reference,
      timestamp: new Date().toISOString(),
    };

    this.state.transactions.push(transaction);
    this._save();

    this.emit("credits:added", { userId: user.userId, amount: addedAmount, transaction });
    return {
      ok: true,
      success: true,
      userId: user.userId,
      added: addedAmount,
      balance: this.getUser(userId).balance,
      newBalance: this.getUser(userId).balance,
      transaction,
    };
  }

  /**
   * Obtiene la lista de paquetes de créditos oficiales con precios en USD y bonificaciones.
   */
  getPacks() {
    return [
      { id: "pack_100", credits: 100, priceUsd: 5, priceLabel: "$5 USD", title: "100 Créditos", tag: "Básico", bonus: "" },
      { id: "pack_500", credits: 500, priceUsd: 20, priceLabel: "$20 USD", title: "500 Créditos", tag: "Más Popular", bonus: "+25% extra" },
      { id: "pack_1500", credits: 1500, priceUsd: 50, priceLabel: "$50 USD", title: "1500 Créditos", tag: "Élite", bonus: "+50% extra" },
    ];
  }

  /**
   * Calcula el costo en créditos exacto según tokens consumidos y tarifa del modelo de MEAI.
   * Valor nominal base: 1 crédito = $0.05 USD.
   */
  calculateUsageCredits(model = "claude-sonnet-4-6", inputTokens = 0, outputTokens = 0) {
    const m = String(model || "").toLowerCase();
    let inRatePer1M = 3.0;
    let outRatePer1M = 15.0;

    if (m.includes("claude-haiku-4-5") || m.includes("gemini-2.5-flash") || m.includes("haiku") || m.includes("flash")) {
      // Modelos Rápidos / Económicos MEAI
      inRatePer1M = 0.80;
      outRatePer1M = 4.00;
    } else if (m.includes("deepseek-v4-pro") || m.includes("deepseek")) {
      // Modelos DeepSeek MEAI
      inRatePer1M = 0.30;
      outRatePer1M = 1.20;
    } else if (m.includes("claude-sonnet-4-6") || m.includes("claude-sonnet-5") || m.includes("claude-fable-5") || m.includes("gpt-5.6-luna") || m.includes("gpt-5.6-sol") || m.includes("grok-4.5")) {
      // Modelos Principales Pro MEAI (Sonnet 4.6 / Sonnet 5 / Luna)
      inRatePer1M = 3.00;
      outRatePer1M = 15.00;
    } else if (m.includes("claude-opus-4-8") || m.includes("claude-opus-4-7") || m.includes("opus")) {
      // Modelos Máxima Potencia MEAI (Opus 4.8 / Opus 4.7)
      inRatePer1M = 15.00;
      outRatePer1M = 75.00;
    }

    const inCostUsd = (Number(inputTokens || 0) / 1_000_000) * inRatePer1M;
    const outCostUsd = (Number(outputTokens || 0) / 1_000_000) * outRatePer1M;
    const totalCostUsd = inCostUsd + outCostUsd;

    // Convertir USD a créditos con margen operativo estándar (1 crédito = $0.05 USD)
    const rawCredits = (totalCostUsd * 1.5) / 0.05;
    const creditsToDeduct = Math.max(0.1, Number(rawCredits.toFixed(2)));

    return {
      model,
      inputTokens,
      outputTokens,
      inRatePer1M,
      outRatePer1M,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      credits: creditsToDeduct,
    };
  }

  /**
   * Genera una orden de pago para Stripe o Mercado Pago.
   */
  createPaymentOrder(userId, packCredits, gateway = "mercadopago") {
    const user = this.getUser(userId);
    const credits = parseInt(packCredits, 10) || 100;
    const pack = this.getPacks().find((p) => p.credits === credits) || {
      id: `pack_${credits}`,
      credits,
      priceUsd: Math.round(credits * 0.05),
      priceLabel: `$${Math.round(credits * 0.05)} USD`,
    };

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const gw = String(gateway || "mercadopago").toLowerCase();

    const order = {
      orderId,
      userId: user.userId,
      userEmail: user.email,
      credits: pack.credits,
      amountUsd: pack.priceUsd,
      gateway: gw,
      status: "pending",
      createdAt: new Date().toISOString(),
      checkoutUrl: gw === "stripe"
        ? `https://checkout.stripe.com/pay/${orderId}?client_reference_id=${encodeURIComponent(user.userId)}&credits=${pack.credits}`
        : `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${orderId}&credits=${pack.credits}`,
    };

    this.emit("payment:order-created", order);
    return { ok: true, success: true, order };
  }

  /**
   * Procesa la confirmación de pago (Webhook de Stripe o Mercado Pago).
   */
  processWebhookPayment({ gateway, orderId, userId, credits, amountPaid, status } = {}) {
    if (status !== "approved" && status !== "succeeded" && status !== "completed") {
      return { ok: false, error: "PAYMENT_NOT_APPROVED" };
    }
    const creds = parseInt(credits, 10) || 100;
    return this.addCredits(userId, creds, `payment_${gateway || "gateway"}_${orderId || Date.now()}`);
  }

  /**
   * Canjea un código de recarga / voucher promocional.
   */
  redeemVoucher(userId, voucherCode) {
    const code = String(voucherCode || "").trim().toUpperCase();
    const VOUCHERS = {
      "EDITCORE100": 100,
      "EDITCORE500": 500,
      "PROMO2026": 250,
      "ADMINVIP": 5000,
    };

    if (!VOUCHERS[code]) {
      return { ok: false, error: "INVALID_VOUCHER", message: "Código de recarga inválido o expirado." };
    }

    const user = this.getUser(userId);
    if (!this.state.users[user.userId].redeemedCodes) {
      this.state.users[user.userId].redeemedCodes = [];
    }

    if (this.state.users[user.userId].redeemedCodes.includes(code)) {
      return { ok: false, error: "CODE_ALREADY_USED", message: "Este código ya ha sido canjeado por tu cuenta." };
    }

    this.state.users[user.userId].redeemedCodes.push(code);
    const amount = VOUCHERS[code];
    return this.addCredits(userId, amount, `voucher_${code}`);
  }

  /**
   * Actualiza los datos de perfil de un usuario.
   */
  updateProfile(userId, { name, avatarUrl } = {}) {
    const user = this.getUser(userId);
    if (name) this.state.users[user.userId].name = name;
    if (avatarUrl !== undefined) this.state.users[user.userId].avatarUrl = avatarUrl;
    this._save();
    return this.getUser(userId);
  }

  /**
   * Lista todos los usuarios registrados (exclusivo para admin).
   */
  listUsers() {
    return Object.values(this.state.users).map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: u.role,
      balance: u.role === "admin" ? Infinity : Number(u.balance || 0),
      isUnlimited: u.role === "admin" || u.isUnlimited === true,
      avatarUrl: u.avatarUrl || null,
    }));
  }
}

const creditLedgerInstance = new CreditLedger();

module.exports = {
  CreditLedger,
  creditLedger: creditLedgerInstance,
};
