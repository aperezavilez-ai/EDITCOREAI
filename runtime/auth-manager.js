"use strict";

// Sesión de EditCoreAI contra su servidor de cuentas propio (Supabase Auth, proveedor Google).
// El rol, el estado y el saldo los decide el servidor (funciones public.editcoreai_*): la app
// nunca se otorga permisos a sí misma. La sesión se guarda cifrada con safeStorage; si el
// cifrado del sistema no está disponible, solo vive en memoria.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { loadCloudConfig } = require("./editcore-cloud-config");

const DEFAULT_AUTH_DIR = path.join(os.homedir(), ".editcore");
const SESSION_FILE = "editcoreai-session.bin";
const CALLBACK_PORT = 55399;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const ACCOUNT_TTL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

const ERROR_MESSAGES = {
  CLOUD_NOT_CONFIGURED: "El servidor de cuentas no está configurado en esta instalación.",
  NO_SESSION: "Inicia sesión con Google para usar EditCoreAI.",
  SESSION_EXPIRED: "Tu sesión expiró. Vuelve a iniciar sesión con Google.",
  NETWORK: "No se pudo conectar con el servidor de cuentas. Revisa tu conexión e inténtalo de nuevo.",
  LOGIN_TIMEOUT: "No se completó el inicio de sesión a tiempo. Inténtalo de nuevo.",
  LOGIN_CANCELLED: "Se canceló el inicio de sesión.",
  LOGIN_DENIED: "Google no autorizó el inicio de sesión.",
  PORT_BUSY: "Otro programa está usando el puerto de inicio de sesión. Cierra otras ventanas de EditCoreAI e inténtalo de nuevo.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
  SERVER: "El servidor de cuentas respondió con un error. Inténtalo de nuevo en unos minutos.",
  FORBIDDEN: "Solo un administrador puede hacer esto.",
  INVALID_AMOUNT: "La cantidad no es válida.",
  INVALID_STATUS: "El estado no es válido.",
  CODE_TOO_SHORT: "El código personalizado debe tener al menos 12 caracteres.",
  USER_NOT_FOUND: "No existe un usuario con ese correo (debe haber iniciado sesión al menos una vez).",
};

class AuthError extends Error {
  constructor(code, detail) {
    super(ERROR_MESSAGES[code] || code);
    this.code = code;
    if (detail) this.detail = detail;
  }
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function defaultSecureStore() {
  try {
    const { safeStorage } = require("electron");
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable()) {
      return {
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (buf) => safeStorage.decryptString(buf),
      };
    }
  } catch {
    /* fuera de Electron */
  }
  return null;
}

function defaultOpenExternal(url) {
  const { shell } = require("electron");
  return shell.openExternal(url);
}

function userFromTokenUser(u = {}) {
  const meta = u.user_metadata || {};
  return {
    id: String(u.id || ""),
    email: String(u.email || meta.email || "").toLowerCase(),
    name: String(meta.full_name || meta.name || u.email || "").trim(),
    avatarUrl: String(meta.avatar_url || meta.picture || ""),
  };
}

const CALLBACK_PAGE = (ok, message) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>EditCoreAI</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#1e293b;padding:32px 40px;border-radius:14px;text-align:center;max-width:420px}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0}</style></head>
<body><div class="card"><h1>${ok ? "✅ Sesión iniciada" : "⚠️ No se pudo iniciar sesión"}</h1><p>${message}</p></div></body></html>`;

class AuthManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storageDir = options.storageDir || DEFAULT_AUTH_DIR;
    this.sessionPath = path.join(this.storageDir, SESSION_FILE);
    this._configOverride = options.config || null;
    this._fetch = options.fetchImpl || ((...args) => fetch(...args));
    this._secureStoreFactory = options.secureStore === undefined ? defaultSecureStore : () => options.secureStore;
    this._openExternal = options.openExternal || defaultOpenExternal;
    this.callbackPort = Number(options.callbackPort) || CALLBACK_PORT;
    this.loginTimeoutMs = Number(options.loginTimeoutMs) || LOGIN_TIMEOUT_MS;
    this._now = options.now || (() => Date.now());
    this.session = null;
    this.account = null;
    this.accountFetchedAt = 0;
    this._loaded = false;
    this._refreshing = null;
    this._pendingLogin = null;
  }

  get config() {
    return this._configOverride || loadCloudConfig();
  }

  _store() {
    return this._secureStoreFactory();
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    const store = this._store();
    if (!store) return;
    try {
      if (!fs.existsSync(this.sessionPath)) return;
      const parsed = JSON.parse(store.decrypt(fs.readFileSync(this.sessionPath)));
      if (parsed?.access_token && parsed?.refresh_token && parsed?.user?.id) this.session = parsed;
    } catch {
      this.session = null;
    }
  }

  _persist() {
    const store = this._store();
    try {
      if (!this.session) {
        fs.rmSync(this.sessionPath, { force: true });
        return;
      }
      if (!store) return;
      fs.mkdirSync(this.storageDir, { recursive: true });
      fs.writeFileSync(this.sessionPath, store.encrypt(JSON.stringify(this.session)));
    } catch {
      /* la sesión sigue en memoria */
    }
  }

  _setSessionFromToken(t = {}) {
    if (!t.access_token || !t.refresh_token) throw new AuthError("SERVER", "token incompleto");
    const nowSec = Math.floor(this._now() / 1000);
    const prevUser = this.session?.user || {};
    const user = t.user ? userFromTokenUser(t.user) : prevUser;
    this.session = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Number(t.expires_at) || nowSec + (Number(t.expires_in) || 3600),
      user,
    };
    this._persist();
  }

  _clearSession() {
    const had = Boolean(this.session);
    this.session = null;
    this.account = null;
    this.accountFetchedAt = 0;
    this._persist();
    if (had) this.emit("session-changed", null);
  }

  async _request(pathname, { method = "GET", body, token, headers = {} } = {}) {
    const cfg = this.config;
    if (!cfg.configured) throw new AuthError("CLOUD_NOT_CONFIGURED");
    let res;
    try {
      res = await this._fetch(`${cfg.url}${pathname}`, {
        method,
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${token || cfg.anonKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AuthError("NETWORK", error?.message);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  }

  _authorizeUrl(challenge) {
    const cfg = this.config;
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: `http://127.0.0.1:${this.callbackPort}/callback`,
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
    return `${cfg.url}/auth/v1/authorize?${params.toString()}`;
  }

  _waitForCallback() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://127.0.0.1:${this.callbackPort}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const errorDesc = url.searchParams.get("error_description") || url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(code
          ? CALLBACK_PAGE(true, "Ya puedes cerrar esta pestaña y volver a EditCoreAI.")
          : CALLBACK_PAGE(false, "Vuelve a EditCoreAI e inténtalo de nuevo."));
        finish(code ? null : new AuthError("LOGIN_DENIED", errorDesc || ""), code);
      });
      const timer = setTimeout(() => finish(new AuthError("LOGIN_TIMEOUT")), this.loginTimeoutMs);
      const finish = (error, code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        this._cancelLogin = null;
        if (error) reject(error);
        else resolve(code);
      };
      this._cancelLogin = () => finish(new AuthError("LOGIN_CANCELLED"));
      server.once("error", (error) => finish(error?.code === "EADDRINUSE" ? new AuthError("PORT_BUSY") : new AuthError("NETWORK", error?.message)));
      server.listen(this.callbackPort, "127.0.0.1", () => {
        this.emit("login-listening", { port: this.callbackPort });
      });
    });
  }

  loginWithGoogle() {
    if (this._pendingLogin) return this._pendingLogin;
    this._pendingLogin = (async () => {
      this._ensureLoaded();
      if (!this.config.configured) throw new AuthError("CLOUD_NOT_CONFIGURED");
      const { verifier, challenge } = createPkcePair();
      const listening = new Promise((resolve) => this.once("login-listening", resolve));
      const codePromise = this._waitForCallback();
      codePromise.catch(() => {});
      await Promise.race([listening, codePromise]);
      await this._openExternal(this._authorizeUrl(challenge));
      const code = await codePromise;
      const res = await this._request("/auth/v1/token?grant_type=pkce", {
        method: "POST",
        body: { auth_code: code, code_verifier: verifier },
      });
      if (!res.ok) throw new AuthError("LOGIN_DENIED", res.data?.msg || res.data?.error_description || String(res.status));
      this._setSessionFromToken(res.data);
      await this.refreshAccount();
      this.emit("session-changed", this.publicSession());
      return this.publicSession();
    })();
    const pending = this._pendingLogin;
    pending.finally(() => { if (this._pendingLogin === pending) this._pendingLogin = null; }).catch(() => {});
    return pending;
  }

  cancelLogin() {
    if (typeof this._cancelLogin === "function") this._cancelLogin();
    return { success: true };
  }

  async _refreshTokens() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      const res = await this._request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: this.session.refresh_token },
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        this._clearSession();
        throw new AuthError("SESSION_EXPIRED");
      }
      if (!res.ok) throw new AuthError("SERVER", String(res.status));
      this._setSessionFromToken(res.data);
    })();
    try {
      await this._refreshing;
    } finally {
      this._refreshing = null;
    }
  }

  async getAccessToken() {
    this._ensureLoaded();
    if (!this.session) return null;
    const nowSec = Math.floor(this._now() / 1000);
    if (Number(this.session.expires_at) - nowSec < 60) await this._refreshTokens();
    return this.session?.access_token || null;
  }

  async rpc(fn, args = {}) {
    const token = await this.getAccessToken();
    if (!token) throw new AuthError("NO_SESSION");
    let res = await this._request(`/rest/v1/rpc/${fn}`, { method: "POST", body: args, token });
    if (res.status === 401 && this.session) {
      await this._refreshTokens();
      res = await this._request(`/rest/v1/rpc/${fn}`, { method: "POST", body: args, token: this.session.access_token });
    }
    if (res.status === 401) {
      this._clearSession();
      throw new AuthError("SESSION_EXPIRED");
    }
    if (!res.ok) {
      const message = String(res.data?.message || res.data?.msg || "");
      const known = message.match(/^[A-Z_]{4,}$/) ? message : "";
      throw new AuthError(known || "SERVER", message || String(res.status));
    }
    return res.data;
  }

  async refreshAccount() {
    const account = await this.rpc("editcoreai_my_account");
    this.account = account && typeof account === "object" ? account : null;
    this.accountFetchedAt = this._now();
    return this.account;
  }

  // Consultas de IA de usuarios: van a la función ai-proxy del servidor con el token de la sesión.
  aiProxyBaseUrl() {
    return `${this.config.url}/functions/v1/ai-proxy/v1`;
  }

  async listCloudModels() {
    const token = await this.getAccessToken();
    if (!token) throw new AuthError("NO_SESSION");
    const res = await this._request("/functions/v1/ai-proxy/v1/models", { token });
    if (res.status === 401) throw new AuthError("SESSION_EXPIRED");
    if (!res.ok) throw new AuthError("SERVER", String(res.data?.error?.message || res.status));
    return (Array.isArray(res.data?.data) ? res.data.data : [])
      .map((entry) => String(entry?.id || "").trim())
      .filter(Boolean);
  }

  isAuthenticated() {
    this._ensureLoaded();
    return Boolean(this.session);
  }

  publicSession(extra = {}) {
    if (!this.session) return { isAuthenticated: false, user: null, configured: this.config.configured, ...extra };
    const acc = this.account || {};
    const role = acc.role === "admin" ? "admin" : "user";
    return {
      isAuthenticated: true,
      configured: true,
      user: {
        id: this.session.user.id,
        email: acc.email || this.session.user.email,
        name: this.session.user.name || acc.email || this.session.user.email,
        avatarUrl: this.session.user.avatarUrl || "",
        role,
        isAdmin: role === "admin" && acc.status === "active",
        status: acc.status || "unknown",
        plan: acc.plan || "free",
        credits_balance: Number(acc.credits_balance || 0),
        topup_base: Number(acc.topup_base || 0),
        is_unlimited: Boolean(acc.is_unlimited),
      },
      ...extra,
    };
  }

  async getCurrentSession({ refresh = false } = {}) {
    this._ensureLoaded();
    if (!this.session) return this.publicSession();
    const stale = !this.account || this._now() - this.accountFetchedAt > ACCOUNT_TTL_MS;
    if (refresh || stale) {
      try {
        await this.refreshAccount();
      } catch (error) {
        if (!this.session) return this.publicSession({ error: error.message, code: error.code });
        return this.publicSession({ offline: true, error: error.message, code: error.code });
      }
    }
    return this.publicSession();
  }

  async logout() {
    this._ensureLoaded();
    const token = this.session?.access_token;
    if (token) {
      try {
        await this._request("/auth/v1/logout?scope=local", { method: "POST", token, body: {} });
      } catch {
        /* se cierra localmente igual */
      }
    }
    this._clearSession();
    return { success: true };
  }
}

const authManagerInstance = new AuthManager();

module.exports = {
  AuthManager,
  AuthError,
  ERROR_MESSAGES,
  authManager: authManagerInstance,
  createPkcePair,
  CALLBACK_PORT,
};
