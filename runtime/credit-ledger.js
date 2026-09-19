"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

const CREDITS_FILE_PATH = path.join(os.homedir(), ".editcore", "credits.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://supabase.gafcore.com/editcore-ai";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5ODQ5MzMyLCJleHAiOjIxMDUyMDkzMzJ9.3LsN9Eis_cCkPT9sWJQwM9RmreAqM8-7Io0Uv2RqkdQ";
const ADMIN_EMAIL = "aperezavilez@gmail.com";

/**
 * Gestor de créditos de EditCoreAI.
 * Fuente de verdad: Supabase GafCore (online).
 * Fallback: SQLite-like JSON local (offline).
 * Ambas plataformas (Desktop + Web) leen el mismo saldo de Supabase.
 */
class CreditLedger extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.storagePath = options.storagePath || CREDITS_FILE_PATH;
    this._supabaseToken = null; // JWT del usuario actual (set vía setUserSession)
    this._currentUserId = null;
    this._currentUserEmail = null;

    const defBal = options.defaultCredits !== undefined
      ? options.defaultCredits
      : (options.defaultUserBalance !== undefined ? options.defaultUserBalance : 25);

    this.state = {
      defaultUserBalance: defBal,
      adminEmail: ADMIN_EMAIL,
      adminName: "Alfonso Perez Avilez",
      users: {},
      transactions: [],
    };
    this._load();
  }

  // ─── Persistencia local (fallback offline) ─────────────────────────────────

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
    } catch { /* usar estado predeterminado */ }

    // Asegurar cuenta de administrador con créditos ilimitados
    if (!this.state.users[this.state.adminEmail]) {
      this.state.users[this.state.adminEmail] = {
        userId: this.state.adminEmail,
        name: this.state.adminName,
        email: this.state.adminEmail,
        role: "admin",
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
        serializableUsers[id] = { ...u, balance: u.balance === Infinity ? "Infinity" : u.balance };
      }
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify({ ...this.state, users: serializableUsers }, null, 2),
        "utf8"
      );
    } catch { /* fallback en memoria */ }
  }

  // ─── Sesión Supabase (la app principal llama esto al hacer login) ──────────

  /**
   * Registra la sesión activa del usuario para sincronizar con Supabase.
   * @param {string} userId UUID del usuario en Supabase
   * @param {string} userEmail correo del usuario
   * @param {string} accessToken JWT de la sesión (supabase.auth.session().access_token)
   */
  setUserSession(userId, userEmail, accessToken) {
    this._currentUserId = userId;
    this._currentUserEmail = userEmail ? String(userEmail).toLowerCase() : null;
    this._supabaseToken = accessToken || null;
  }

  clearSession() {
    this._currentUserId = null;
    this._currentUserEmail = null;
    this._supabaseToken = null;
  }

  // ─── Supabase REST helpers ─────────────────────────────────────────────────

  async _supabaseGet(path) {
    if (!this._supabaseToken) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${this._supabaseToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) return null;
      const text = await res.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch { return null; }
  }

  async _supabasePatch(path, body) {
    if (!this._supabaseToken) return false;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${this._supabaseToken}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; }
  }

  async _supabasePost(path, body) {
    if (!this._supabaseToken) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${this._supabaseToken}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch { return null; }
  }

  // ─── API principal ─────────────────────────────────────────────────────────

  /**
   * Obtiene el perfil del usuario. Primero intenta Supabase, luego fallback local.
   */
  async getBalanceAsync(userId) {
    const id = String(userId || this._currentUserId || this.state.adminEmail).toLowerCase();

    // Admin siempre ilimitado
    if (id === ADMIN_EMAIL || id === "admin") {
      return { userId: id, balance: Infinity, isUnlimited: true, role: "admin", canExecute: true };
    }

    // Intentar Supabase si hay sesión activa
    if (this._supabaseToken && this._currentUserId) {
      const data = await this._supabaseGet(
        `/profiles?id=eq.${this._currentUserId}&select=id,email,credits_balance,is_unlimited,role`
      );
      if (data && data.length > 0) {
        const profile = data[0];
        const isUnlimited = profile.is_unlimited || profile.email === ADMIN_EMAIL;
        const balance = isUnlimited ? Infinity : parseFloat(profile.credits_balance || 0);

        // Actualizar cache local
        this.state.users[id] = {
          ...this.state.users[id],
          userId: id,
          email: profile.email,
          role: profile.role || "user",
          balance,
          isUnlimited,
          _syncedAt: Date.now(),
        };
        this._save();

        return {
          userId: id,
          balance,
          isUnlimited,
          role: profile.role || "user",
          canExecute: isUnlimited || balance > 0,
          source: "supabase",
        };
      }
    }

    // Fallback local
    const user = this.getUser(id);
    return {
      userId: user.userId,
      balance: user.balance,
      isUnlimited: user.isUnlimited,
      role: user.role,
      canExecute: user.isUnlimited || user.balance > 0,
      source: "local",
    };
  }

  /**
   * Versión síncrona (para compatibilidad con código existente).
   * Usa cache local. Llama getBalanceAsync() para datos actualizados de Supabase.
   */
  getUser(userId = this.state.adminEmail) {
    const id = String(userId || this.state.adminEmail).toLowerCase();
    if (!this.state.users[id]) {
      const isAdmin = id === this.state.adminEmail.toLowerCase() || id === "admin";
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

  redeemCode(userId, code) {
    const res = this.redeemVoucher(userId, code);
    return {
      success: res.ok,
      balance: res.newBalance !== undefined ? res.newBalance : this.getUser(userId).balance,
      error: res.error,
      message: res.message,
    };
  }

  /**
   * Descuenta créditos. Sincroniza con Supabase si hay sesión activa.
   */
  async deductCreditsAsync(userId = this.state.adminEmail, amount = 1, meta = {}) {
    const id = String(userId || this.state.adminEmail).toLowerCase();
    const user = this.getUser(id);

    if (user.role === "admin" || user.isUnlimited || id === ADMIN_EMAIL) {
      return { ok: true, success: true, balance: Infinity, isUnlimited: true, deducted: 0 };
    }

    const toDeduct = Math.max(0.1, Number(amount || 1));
    const balanceData = await this.getBalanceAsync(id);
    const current = balanceData.balance;

    if (current <= 0 || current < toDeduct) {
      this.emit("credits:depleted", { userId: id, balance: current });
      return {
        ok: false,
        success: false,
        code: "OUT_OF_CREDITS",
        error: "OUT_OF_CREDITS",
        message: "Saldo de créditos agotado. Recarga para continuar usando EditCoreAI.",
        balance: current,
        required: toDeduct,
      };
    }

    const newBalance = Math.max(0, current - toDeduct);

    // Actualizar Supabase si hay sesión
    if (this._supabaseToken && this._currentUserId) {
      await this._supabasePatch(`/profiles?id=eq.${this._currentUserId}`, {
        credits_balance: newBalance,
        updated_at: new Date().toISOString(),
      });
      // Registrar en ledger Supabase
      await this._supabasePost("/credit_transactions", {
        user_id: this._currentUserId,
        amount: -toDeduct,
        type: "usage_ai",
        model_used: meta.model || "unknown",
        tokens_input: meta.tokensIn || 0,
        tokens_output: meta.tokensOut || 0,
        description: meta.description || `Uso de ${meta.model || "modelo"} en EditCoreAI Desktop`,
        created_at: new Date().toISOString(),
      });
    }

    // Actualizar cache local
    if (this.state.users[id]) {
      this.state.users[id].balance = newBalance;
      this._save();
    }

    this.emit("credits:deducted", { userId: id, deducted: toDeduct, newBalance });
    return { ok: true, success: true, balance: newBalance, deducted: toDeduct, isUnlimited: false };
  }

  /**
   * Versión síncrona de deductCredits (compatibilidad con código existente).
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
        ok: false, success: false,
        code: "OUT_OF_CREDITS", error: "OUT_OF_CREDITS",
        message: "Saldo de créditos agotado. Añade más créditos para continuar.",
        balance: current, required: toDeduct,
      };
    }
    const newBalance = current - toDeduct;
    this.state.users[user.userId].balance = newBalance;
    this._save();
    // Disparar sync async en background sin bloquear
    if (this._supabaseToken) {
      this.deductCreditsAsync(userId, amount).catch(() => {});
    }
    this.emit("credits:deducted", { userId: user.userId, deducted: toDeduct, newBalance });
    return { ok: true, success: true, balance: newBalance, deducted: toDeduct, isUnlimited: false };
  }

  /**
   * Añade créditos. Sincroniza con Supabase si hay sesión.
   */
  async addCreditsAsync(userId, amount, reference = "manual_recharge") {
    const user = this.getUser(userId);
    const addedAmount = Math.max(0, Number(amount || 0));

    if (user.role !== "admin") {
      // Obtener saldo actualizado de Supabase
      const balanceData = await this.getBalanceAsync(userId);
      const current = balanceData.source === "supabase" ? balanceData.balance : Number(user.balance || 0);
      const newBalance = current + addedAmount;

      if (this._supabaseToken && this._currentUserId) {
        await this._supabasePatch(`/profiles?id=eq.${this._currentUserId}`, {
          credits_balance: newBalance,
          total_credits_purchased: newBalance, // simplificado
          updated_at: new Date().toISOString(),
        });
        await this._supabasePost("/credit_transactions", {
          user_id: this._currentUserId,
          amount: addedAmount,
          type: "purchase",
          description: reference,
          created_at: new Date().toISOString(),
        });
      }

      if (this.state.users[user.userId]) {
        this.state.users[user.userId].balance = newBalance;
        this._save();
      }
    }

    this.emit("credits:added", { userId: user.userId, amount: addedAmount });
    return {
      ok: true, success: true,
      userId: user.userId,
      added: addedAmount,
      balance: this.getUser(userId).balance,
      newBalance: this.getUser(userId).balance,
    };
  }

  addCredits(userId, amount, reference = "manual_recharge") {
    const user = this.getUser(userId);
    const addedAmount = Math.max(0, Number(amount || 0));
    if (user.role !== "admin") {
      const current = Number(user.balance || 0);
      this.state.users[user.userId].balance = current + addedAmount;
    }
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: user.userId, amount: addedAmount, reference,
      timestamp: new Date().toISOString(),
    };
    this.state.transactions.push(transaction);
    this._save();
    // Sync async en background
    if (this._supabaseToken) {
      this.addCreditsAsync(userId, amount, reference).catch(() => {});
    }
    this.emit("credits:added", { userId: user.userId, amount: addedAmount, transaction });
    return { ok: true, success: true, userId: user.userId, added: addedAmount,
      balance: this.getUser(userId).balance, newBalance: this.getUser(userId).balance, transaction };
  }

  /**
   * Cálculo de créditos por tokens consumidos.
   * Fuente de verdad única para Desktop y Web.
   */
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

  createPaymentOrder(userId, packCredits, gateway = "mercadopago") {
    const user = this.getUser(userId);
    const credits = parseInt(packCredits, 10) || 100;
    const pack = this.getPacks().find((p) => p.credits === credits) || {
      id: `pack_${credits}`, credits, priceUsd: Math.round(credits * 0.05),
      priceLabel: `$${Math.round(credits * 0.05)} USD`,
    };
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const gw = String(gateway || "mercadopago").toLowerCase();
    const order = {
      orderId, userId: user.userId, userEmail: user.email,
      credits: pack.credits, amountUsd: pack.priceUsd, gateway: gw,
      status: "pending", createdAt: new Date().toISOString(),
      checkoutUrl: gw === "stripe"
        ? `https://checkout.stripe.com/pay/${orderId}?client_reference_id=${encodeURIComponent(user.userId)}&credits=${pack.credits}`
        : `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${orderId}&credits=${pack.credits}`,
    };
    this.emit("payment:order-created", order);
    return { ok: true, success: true, order };
  }

  processWebhookPayment({ gateway, orderId, userId, credits, amountPaid, status } = {}) {
    if (status !== "approved" && status !== "succeeded" && status !== "completed") {
      return { ok: false, error: "PAYMENT_NOT_APPROVED" };
    }
    const creds = parseInt(credits, 10) || 100;
    return this.addCredits(userId, creds, `payment_${gateway || "gateway"}_${orderId || Date.now()}`);
  }

  redeemVoucher(userId, voucherCode) {
    const code = String(voucherCode || "").trim().toUpperCase();
    const VOUCHERS = {
      "EDITCORE100": 100, "EDITCORE500": 500, "PROMO2026": 250, "ADMINVIP": 5000,
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
    return this.addCredits(userId, VOUCHERS[code], `voucher_${code}`);
  }

  updateProfile(userId, { name, avatarUrl } = {}) {
    const user = this.getUser(userId);
    if (name) this.state.users[user.userId].name = name;
    if (avatarUrl !== undefined) this.state.users[user.userId].avatarUrl = avatarUrl;
    this._save();
    return this.getUser(userId);
  }

  listUsers() {
    return Object.values(this.state.users).map((u) => ({
      userId: u.userId, name: u.name, email: u.email, role: u.role,
      balance: u.role === "admin" ? Infinity : Number(u.balance || 0),
      isUnlimited: u.role === "admin" || u.isUnlimited === true,
      avatarUrl: u.avatarUrl || null,
    }));
  }
}

const creditLedgerInstance = new CreditLedger();

module.exports = { CreditLedger, creditLedger: creditLedgerInstance };
