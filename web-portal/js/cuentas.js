// Cuentas de EditCoreAI en la web: la misma cuenta de Google, saldo, IA y recargas que la app de escritorio.
// La dirección del servidor y su clave pública llegan en /js/cuentas-config.js, que se genera al publicar
// (scripts/deploy-web.js) y no se guarda en git.
(function (root) {
  "use strict";

  const SESSION_KEY = "editcoreai_web_session";
  const VERIFIER_KEY = "editcoreai_web_pkce";
  const REFRESH_MARGIN_S = 60;

  const ERRORS = {
    NOT_CONFIGURED: "La web todavía no está conectada al servidor de cuentas.",
    NO_SESSION: "Inicia sesión con Google para continuar.",
    SESSION_EXPIRED: "Tu sesión expiró. Vuelve a iniciar sesión.",
    LOGIN_DENIED: "No se pudo completar el inicio de sesión con Google.",
    NETWORK: "No hay conexión con el servidor de EditCoreAI. Intenta de nuevo en un momento.",
    SERVER: "El servidor de EditCoreAI no respondió. Intenta de nuevo en un momento.",
  };

  class CuentasError extends Error {
    constructor(code, message, status = 0) {
      super(message || ERRORS[code] || ERRORS.SERVER);
      this.code = code;
      this.status = status;
    }
  }

  const config = () => {
    const c = root.EDITCOREAI_CUENTAS || {};
    return { url: String(c.url || "").replace(/\/+$/, ""), anonKey: String(c.anonKey || "") };
  };
  const isConfigured = () => {
    const c = config();
    return /^https:\/\//.test(c.url) && c.anonKey.length > 20;
  };
  const now = () => Math.floor(Date.now() / 1000);

  function b64url(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return root.btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function pkcePair() {
    const verifier = b64url(root.crypto.getRandomValues(new Uint8Array(32)));
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  function readSession() {
    try {
      const s = JSON.parse(root.localStorage.getItem(SESSION_KEY) || "null");
      return s && s.access_token && s.refresh_token ? s : null;
    } catch {
      return null;
    }
  }

  function saveSession(token) {
    const session = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Number(token.expires_at) || now() + (Number(token.expires_in) || 3600),
      user: { id: token.user?.id || "", email: token.user?.email || "" },
    };
    root.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    root.localStorage.removeItem(SESSION_KEY);
  }

  async function request(path, { method = "GET", token = "", body } = {}) {
    if (!isConfigured()) throw new CuentasError("NOT_CONFIGURED");
    const c = config();
    const headers = { apikey: c.anonKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await root.fetch(c.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new CuentasError("NETWORK");
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  async function startGoogleLogin(returnPath = "/app.html") {
    if (!isConfigured()) throw new CuentasError("NOT_CONFIGURED");
    const { verifier, challenge } = await pkcePair();
    root.sessionStorage.setItem(VERIFIER_KEY, verifier);
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: root.location.origin + returnPath,
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
    root.location.assign(`${config().url}/auth/v1/authorize?${params.toString()}`);
  }

  // Al volver de Google la página trae ?code=… (o un error); se canjea una sola vez y se limpia la barra de direcciones.
  async function completeLoginFromUrl() {
    const url = new URL(root.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const code = url.searchParams.get("code");
    const errorText = url.searchParams.get("error_description") || hash.get("error_description");
    if (!code && !errorText) return null;
    for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
    root.history.replaceState(null, "", url.pathname + url.search);
    if (errorText) throw new CuentasError("LOGIN_DENIED", `${ERRORS.LOGIN_DENIED} (${errorText})`);
    const verifier = root.sessionStorage.getItem(VERIFIER_KEY);
    root.sessionStorage.removeItem(VERIFIER_KEY);
    if (!verifier) throw new CuentasError("LOGIN_DENIED", `${ERRORS.LOGIN_DENIED} Inténtalo otra vez desde esta misma ventana.`);
    const res = await request("/auth/v1/token?grant_type=pkce", { method: "POST", body: { auth_code: code, code_verifier: verifier } });
    if (!res.ok || !res.data?.access_token) throw new CuentasError("LOGIN_DENIED", undefined, res.status);
    return saveSession(res.data);
  }

  let refreshing = null;
  async function refreshSession(session) {
    if (!refreshing) {
      refreshing = (async () => {
        const res = await request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } });
        if (res.ok && res.data?.access_token) return saveSession(res.data);
        if (res.status >= 400 && res.status < 500) clearSession();
        return null;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    const session = readSession();
    if (!session) return "";
    if (!forceRefresh && session.expires_at - REFRESH_MARGIN_S > now()) return session.access_token;
    const next = await refreshSession(session);
    return next ? next.access_token : "";
  }

  // Llamada con sesión: si el servidor dice 401 se renueva el token una vez y se reintenta.
  async function authed(path, options = {}) {
    let token = await getAccessToken();
    if (!token) throw new CuentasError("NO_SESSION");
    let res = await request(path, { ...options, token });
    if (res.status === 401) {
      token = await getAccessToken({ forceRefresh: true });
      if (!token) throw new CuentasError("SESSION_EXPIRED", undefined, 401);
      res = await request(path, { ...options, token });
      if (res.status === 401) {
        clearSession();
        throw new CuentasError("SESSION_EXPIRED", undefined, 401);
      }
    }
    return res;
  }

  function serverError(res) {
    const err = res.data?.error;
    const code = typeof err === "object" && err?.code ? err.code : "SERVER";
    const message = typeof err === "object" ? err?.message : res.data?.message;
    return new CuentasError(code, message || ERRORS.SERVER, res.status);
  }

  async function account() {
    const res = await authed("/rest/v1/rpc/editcoreai_my_account", { method: "POST", body: {} });
    if (!res.ok || !res.data || typeof res.data !== "object") throw serverError(res);
    return res.data;
  }

  const isUnlimited = (acc) => Boolean(acc && (acc.role === "admin" || acc.is_unlimited === true));

  async function redeemVoucher(code) {
    const res = await authed("/rest/v1/rpc/editcoreai_redeem_voucher", { method: "POST", body: { p_code: String(code || "") } });
    if (!res.ok) throw serverError(res);
    return res.data || { ok: false };
  }

  async function paymentOffer() {
    const res = await authed("/functions/v1/payments/offer");
    if (!res.ok) throw serverError(res);
    return res.data || { ok: false };
  }

  async function createCheckout() {
    const res = await authed("/functions/v1/payments/checkout", { method: "POST", body: {} });
    if (!res.ok || !res.data?.url) throw serverError(res);
    return res.data;
  }

  async function listModels() {
    const res = await authed("/functions/v1/ai-proxy/v1/models");
    if (!res.ok) throw serverError(res);
    return (Array.isArray(res.data?.data) ? res.data.data : []).map((m) => String(m.id || "")).filter(Boolean);
  }

  // Respuesta en streaming (SSE compatible con OpenAI). onDelta recibe cada trozo de texto.
  async function chat({ model, messages, onDelta, signal }) {
    if (!isConfigured()) throw new CuentasError("NOT_CONFIGURED");
    const send = async (token) => {
      try {
        return await root.fetch(`${config().url}/functions/v1/ai-proxy/v1/chat/completions`, {
          method: "POST",
          headers: { apikey: config().anonKey, Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true }),
          signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new CuentasError("NETWORK");
      }
    };
    let token = await getAccessToken();
    if (!token) throw new CuentasError("NO_SESSION");
    let res = await send(token);
    if (res.status === 401) {
      token = await getAccessToken({ forceRefresh: true });
      if (!token) throw new CuentasError("SESSION_EXPIRED", undefined, 401);
      res = await send(token);
    }
    if (!res.ok) {
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      throw serverError({ status: res.status, data });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!payload || payload === "[DONE]") continue;
        let delta = "";
        try {
          delta = JSON.parse(payload)?.choices?.[0]?.delta?.content || "";
        } catch {
          delta = "";
        }
        if (delta) {
          full += delta;
          if (typeof onDelta === "function") onDelta(delta, full);
        }
      }
    }
    return full;
  }

  async function logout() {
    const session = readSession();
    clearSession();
    if (!session) return;
    try {
      await request("/auth/v1/logout?scope=local", { method: "POST", token: session.access_token, body: {} });
    } catch {
      /* la sesión ya se cerró en este navegador */
    }
  }

  const api = {
    CuentasError,
    isConfigured,
    startGoogleLogin,
    completeLoginFromUrl,
    hasSession: () => Boolean(readSession()),
    sessionEmail: () => readSession()?.user?.email || "",
    getAccessToken,
    account,
    isUnlimited,
    redeemVoucher,
    paymentOffer,
    createCheckout,
    listModels,
    chat,
    logout,
  };
  root.EditCoreCuentas = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
