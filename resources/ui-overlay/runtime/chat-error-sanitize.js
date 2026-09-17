"use strict";

/**
 * Sanitiza errores de proveedor y prosa de chat.
 * Nunca dejar nombres/hostnames internos del proveedor en el chat.
 */

const TRANSIENT_PROVIDER_RE = /no est[aá] disponible|tard[oó] demasiado|PROVIDER_TEMPORARILY_UNAVAILABLE|temporarily unavailable|reintenta en \d+|502|503|504|408|425|429|timeout|timed?\s*out|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket|overloaded|rate.?limit|try again|cloudflare|524|gateway time-?out|circuit.?breaker|POOL_EXHAUSTED|sin cuentas disponibles/i;

const HARD_AUTH_RE = /401|403|invalid.?token|inv[aá]lid.?token|forbidden|api.?key|unauthorized|no est[aá] permitido|not allowed|permitido en la API|modelo .* no permitido|无效|令牌/i;

const BILLING_RE = /402|sin saldo|no balance|PROVIDER_NO_BALANCE|insufficient.?fund|quota|billing|saldo disponible/i;

function scrubInternalProviderNames(text = "") {
  return String(text || "")
    .replace(/https?:\/\/[^\s)]*gafcore-gateway[^\s)]*/gi, "")
    .replace(/\bgafcore-gateway(?:\.vercel\.app)?\b/gi, "proveedor de IA")
    .replace(/\bGafCore\s+Gateway\b/gi, "proveedor de IA")
    .replace(/\bGafCore\b/gi, "proveedor")
    .replace(/\bGAFCORE_(?:GATEWAY_URL|API_KEY|ADMIN_TOKEN)\b/g, "credencial de IA")
    .replace(/\bx-project-key\b/gi, "API key")
    .replace(/\bproject\s*keys?\b/gi, "API keys")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function stripGafcoreMentions(text = "") {
  return scrubInternalProviderNames(text);
}

function isTransientProviderFailure(message = "", status = 0) {
  const code = Number(status) || 0;
  if ([408, 425, 429, 500, 502, 503, 504, 524].includes(code)) return true;
  const text = String(message || "");
  if (BILLING_RE.test(text) || HARD_AUTH_RE.test(text)) return false;
  return TRANSIENT_PROVIDER_RE.test(text);
}

function isHardProviderFailure(message = "", status = 0) {
  const code = Number(status) || 0;
  if ([401, 403].includes(code)) return true;
  if (code === 402) return true;
  const text = String(message || "");
  return HARD_AUTH_RE.test(text) || BILLING_RE.test(text);
}

/** Fallos que SÍ deben sacar un modelo de Auto. Timeouts temporales NO. */
function shouldQuarantineModelForAuto(message = "", status = 0) {
  return isHardProviderFailure(message, status)
    || /EMPTY_PROVIDER|respuesta vacia|modelo .* no permitido|not allowed|permitido en la API/i.test(String(message || ""));
}

function sanitizeChatProviderError(errorOrMessage, { status } = {}) {
  const raw = typeof errorOrMessage === "string"
    ? errorOrMessage
    : String(errorOrMessage?.message || errorOrMessage || "");
  const code = Number(status || errorOrMessage?.status || 0) || 0;
  const cleaned = scrubInternalProviderNames(raw);

  if (!cleaned) {
    return "No pude completar la respuesta. Intenta de nuevo.";
  }

  if (isTransientProviderFailure(cleaned, code)
    || /PROVIDER_TEMPORARILY_UNAVAILABLE|Tu modelo seleccionado se conserv|reintenta en \d+\s*segundos/i.test(cleaned)
    || /no est[aá] disponible o tard/i.test(cleaned)) {
    return "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";
  }

  if (BILLING_RE.test(cleaned) || code === 402) {
    return "El proveedor no tiene saldo disponible ahora. Revisa el saldo de ME AI o APICredits e intenta de nuevo.";
  }

  if (HARD_AUTH_RE.test(cleaned) || [401, 403].includes(code)) {
    return "No pude autenticar el modelo. Revisa la API key en Modelos e intenta de nuevo.";
  }

  if (/Cannot find module|Require stack|ENOENT|\.asar[\\/]|node_modules|ipcMain|jarvis-adapter/i.test(cleaned)) {
    return "No pude procesar tu mensaje ahora. Verifica el modelo en Modelos e intenta de nuevo.";
  }

  if (/ECONNREFUSED|fetch failed|backend|upstream|502|503|429|timeout|EMPTY_PROVIDER|respuesta vacia|devolvio una respuesta|no available accounts/i.test(cleaned)) {
    return "No pude completar la respuesta. Intenta de nuevo.";
  }

  let out = cleaned
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/\bvercel\.app\b/gi, "")
    .trim();
  out = scrubInternalProviderNames(out);
  if (!out || /gafcore/i.test(out)) {
    return "No pude completar la respuesta. Intenta de nuevo.";
  }
  return out.slice(0, 420);
}

module.exports = {
  scrubInternalProviderNames,
  stripGafcoreMentions,
  isTransientProviderFailure,
  isHardProviderFailure,
  shouldQuarantineModelForAuto,
  sanitizeChatProviderError,
};
