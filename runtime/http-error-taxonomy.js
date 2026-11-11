"use strict";

// [EDITCORE-INTEGRAL-B6] Taxonomía ÚNICA de errores HTTP del proveedor /
// ai-proxy. Antes el 429 tenía tres clasificaciones contradictorias
// (provider: transitorio; model-failover: cuota/saldo; sanitizador:
// transitorio) y el 401 del proxy (NO_SESSION) se confundía con un 401
// de API key. Este módulo es la ÚNICA fuente de criterio: provider.js,
// runtime/model-failover.js y runtime/chat-error-sanitize.js lo
// consumen. Criterio:
//  - 401 con código NO_SESSION (o mensaje del proxy «Inicia sesión…»)
//    = SESIÓN expirada, jamás consejo de API key.
//  - 429 del proxy = CONCURRENCIA (>4 simultáneas, ai-proxy/index.ts):
//    «demasiadas peticiones simultáneas, espera y reintenta».
//  - 429 de cuota/saldo SOLO si el cuerpo/código lo distingue
//    (insufficient_quota / quota_exceeded / billing / saldo): conserva
//    su mensaje propio de cuota.
//  - 402 = saldo/facturación. 401/403 sin NO_SESSION = API key.
//  - Retry-After se respeta con un tope declarado (30 s).

const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró: vuelve a iniciar sesión en EditCoreAI para seguir usando la IA.";
const CONCURRENCY_MESSAGE = "Demasiadas peticiones simultáneas: espera unos segundos a que terminen las demás y reintenta.";
const QUOTA_MESSAGE = "El proveedor alcanzó su límite de cuota: espera a que se renueve la cuota o revisa el saldo del proveedor.";
const BILLING_MESSAGE = "El servicio de IA no tiene saldo disponible ahora. Intenta de nuevo en unos minutos.";
const API_KEY_MESSAGE = "No pude autenticar el modelo. Revisa la API key en Modelos e intenta de nuevo.";
const TRANSIENT_MESSAGE = "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";

const MAX_RETRY_AFTER_MS = 30_000;

function parseRetryAfterMs(headersOrValue, nowMs = Date.now()) {
  let raw = null;
  if (headersOrValue && typeof headersOrValue.get === "function") {
    try { raw = headersOrValue.get("retry-after") || headersOrValue.get("Retry-After"); } catch { raw = null; }
  } else if (headersOrValue && typeof headersOrValue === "object") {
    raw = headersOrValue["retry-after"] || headersOrValue["Retry-After"] || headersOrValue.retryAfter || null;
  } else if (headersOrValue != null) {
    raw = headersOrValue;
  }
  if (raw == null || String(raw).trim() === "") return null;
  const text = String(raw).trim();
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0 && /^\d+(?:\.\d+)?$/.test(text)) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const when = Date.parse(text);
  if (Number.isFinite(when)) {
    const delta = when - Number(nowMs || Date.now());
    if (delta <= 0) return 0;
    return Math.min(delta, MAX_RETRY_AFTER_MS);
  }
  return null;
}

function errorCodeOf(errorOrBody) {
  if (!errorOrBody || typeof errorOrBody !== "object") return "";
  return String(
    errorOrBody.code
    || errorOrBody.providerCode
    || errorOrBody.error?.code
    || errorOrBody.data?.error?.code
    || "",
  ).trim().toUpperCase();
}

function errorTextOf(errorOrBody) {
  if (typeof errorOrBody === "string") return errorOrBody;
  if (!errorOrBody || typeof errorOrBody !== "object") return String(errorOrBody || "");
  return String(
    errorOrBody.providerRaw
    || errorOrBody.message
    || errorOrBody.error?.message
    || errorOrBody.data?.error?.message
    || errorOrBody.data?.message
    || "",
  );
}

function isNoSessionError(errorOrBody, status = 0) {
  const code = Number(status || (errorOrBody && typeof errorOrBody === "object" ? errorOrBody.status : 0) || 0);
  const ecode = errorCodeOf(errorOrBody);
  if (ecode === "NO_SESSION" || ecode === "SESSION_EXPIRED") return true;
  const text = errorTextOf(errorOrBody);
  if (/NO_SESSION|SESSION_EXPIRED/i.test(text)) return true;
  if (code === 401 && /inicia sesi[oó]n en editcoreai/i.test(text)) return true;
  return false;
}

const QUOTA_RE = /insufficient_quota|quota_exceeded|quota exceeded|exceeded your current quota|usage limit|plan limit|billing|insufficient (?:funds|balance|credit)|out of credits|sin saldo|saldo insuficiente|credit(?:s)? exhausted/i;
const CONCURRENCY_RE = /TOO_MANY_REQUESTS|too many requests|demasiadas (?:consultas|peticiones)|al mismo tiempo|simult[aá]ne/i;

function classifyHttpError(input = {}) {
  const status = Number(input.status || input.error?.status || 0) || 0;
  const code = String(input.code || errorCodeOf(input.error || input.body || {}) || "").trim().toUpperCase();
  const message = String(input.message || errorTextOf(input.error || input.body || {}) || "");
  const retryAfterMs = input.retryAfterMs != null
    ? input.retryAfterMs
    : parseRetryAfterMs(input.headers || input.error?.headers || null);

  if (isNoSessionError(input.error || input.body || { code, message }, status)) {
    return { kind: "session", status: status || 401, code: code || "NO_SESSION", retryAfterMs, transient: false, billing: false, concurrency: false, message: SESSION_EXPIRED_MESSAGE };
  }
  if (status === 429 || code === "TOO_MANY_REQUESTS" || /rate.?limit|too many requests|\b429\b/i.test(message)) {
    // Cuota/saldo real del upstream: solo si cuerpo/código lo distingue.
    if (code === "INSUFFICIENT_QUOTA" || code === "QUOTA_EXCEEDED" || QUOTA_RE.test(message) && !CONCURRENCY_RE.test(message)) {
      return { kind: "quota", status: 429, code: code || "QUOTA", retryAfterMs, transient: false, billing: true, concurrency: false, message: QUOTA_MESSAGE };
    }
    return { kind: "concurrency", status: 429, code: code || "TOO_MANY_REQUESTS", retryAfterMs, transient: true, billing: false, concurrency: true, message: CONCURRENCY_MESSAGE };
  }
  if (status === 402 || QUOTA_RE.test(message) && status !== 429) {
    return { kind: "billing", status: status || 402, code: code || "BILLING", retryAfterMs, transient: false, billing: true, concurrency: false, message: BILLING_MESSAGE };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth_key", status, code: code || "AUTH", retryAfterMs, transient: false, billing: false, concurrency: false, message: API_KEY_MESSAGE };
  }
  if ([408, 425, 500, 502, 503, 504, 524].includes(status)) {
    return { kind: "transient", status, code: code || "TRANSIENT", retryAfterMs, transient: true, billing: false, concurrency: false, message: TRANSIENT_MESSAGE };
  }
  return { kind: "other", status, code, retryAfterMs, transient: false, billing: false, concurrency: false, message: "" };
}

function isConcurrencyError(error) {
  if (!error) return false;
  return classifyHttpError({ error, status: Number(error.status || 0) || 0 }).kind === "concurrency";
}

function isQuotaError(error) {
  if (!error) return false;
  const kind = classifyHttpError({ error, status: Number(error.status || 0) || 0 }).kind;
  return kind === "quota" || kind === "billing";
}

module.exports = {
  SESSION_EXPIRED_MESSAGE,
  CONCURRENCY_MESSAGE,
  QUOTA_MESSAGE,
  BILLING_MESSAGE,
  API_KEY_MESSAGE,
  TRANSIENT_MESSAGE,
  MAX_RETRY_AFTER_MS,
  parseRetryAfterMs,
  errorCodeOf,
  isNoSessionError,
  classifyHttpError,
  isConcurrencyError,
  isQuotaError,
};
