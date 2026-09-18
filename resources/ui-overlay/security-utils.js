// Security utilities for EDITCOREAI
"use strict";

const fs = require('fs');
const path = require('path');
const os = require('os');

// ========================
// Rate Limiting
// ========================
const API_RATE_LIMITS = new Map();

// El contador vive en disco para que no se reinicie al cerrar la app ni se
// duplique por ventana: cada ventana es un proceso renderer distinto pero el
// limite debe ser uno solo por usuario.
let rateLimitStatePath = null;
let rateLimitDirty = false;

function initRateLimitState(appPath) {
  rateLimitStatePath = path.join(appPath, 'rate-limits.json');
  try {
    const raw = fs.readFileSync(rateLimitStatePath, 'utf8');
    const stored = JSON.parse(raw);
    const now = Date.now();
    for (const [key, record] of Object.entries(stored || {})) {
      // Las ventanas ya vencidas no se restauran.
      if (record && Number(record.resetAt) > now) {
        API_RATE_LIMITS.set(key, { count: Number(record.count) || 0, resetAt: Number(record.resetAt) });
      }
    }
  } catch {
    // Sin estado previo o archivo corrupto: se empieza limpio.
  }
}

function persistRateLimitState() {
  if (!rateLimitStatePath || !rateLimitDirty) return;
  rateLimitDirty = false;
  try {
    const now = Date.now();
    const payload = {};
    for (const [key, record] of API_RATE_LIMITS.entries()) {
      if (record.resetAt > now) payload[key] = record;
    }
    fs.writeFileSync(rateLimitStatePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('Failed to persist rate limits:', error.message);
  }
}

function checkRateLimit(key, maxRequests = 100, windowMs = 60000) {
  const now = Date.now();
  const record = API_RATE_LIMITS.get(key);

  if (!record || now > record.resetAt) {
    API_RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    rateLimitDirty = true;
    return;
  }

  if (record.count >= maxRequests) {
    const resetInSeconds = Math.ceil((record.resetAt - now) / 1000);
    throw new Error(
      `Rate limit excedido: máximo ${maxRequests} requests por minuto. ` +
      `Intenta nuevamente en ${resetInSeconds}s.`
    );
  }

  record.count++;
  rateLimitDirty = true;
}

// Cleanup old entries every 5 minutes.
// unref: el timer no debe mantener vivo el proceso (colgaba tests y scripts CLI).
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of API_RATE_LIMITS.entries()) {
    if (now > record.resetAt + 300000) { // 5 min after reset
      API_RATE_LIMITS.delete(key);
      rateLimitDirty = true;
    }
  }
  persistRateLimitState();
}, 300000);
rateLimitCleanupTimer.unref?.();

// ========================
// Sensitive Data Redaction
// ========================
const SENSITIVE_KEYS = new Set([
  'apikey', 'token', 'password', 'secret', 'key', 'auth',
  'authorization', 'bearer', 'credential', 'private',
  'githubtoken', 'verceltoken', 'selfsupabasekey',
  'serverkey', 'serverkeypath'
]);

const TOKEN_PATTERN = /(ghp|gho|ghu|ghs|ghr|sk|pk|rk|xox[bpsa]|Bearer\s+|eyJ)[a-zA-Z0-9_.\/+\-=]{20,}/gi;
const LABELED_CREDENTIAL_PATTERN = /(\b(?:api[\s_-]*key|clave|clve|token|secret|password|contrase(?:n|ñ)a|authorization)\b\s*[:=]?\s*(?:bearer\s+)?)[A-Za-z0-9_.\/+\-=]{12,}/gi;
const URL_CREDENTIAL_PATTERN = /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi;

function isSensitiveKey(key) {
  const keyLower = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.has(keyLower) || keyLower.includes('secret') || keyLower.includes('password')
    || keyLower.includes('token') || keyLower.includes('apikey') || keyLower.includes('api_key');
}

function redactTokensInString(value) {
  const text = String(value == null ? "" : value);
  return text
    .replace(TOKEN_PATTERN, '[REDACTED]')
    .replace(LABELED_CREDENTIAL_PATTERN, '$1[REDACTED]')
    .replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]');
}

// Última barrera: cuando se agota maxDepth no devolvemos el objeto crudo,
// porque un secreto anidado (depth >= 4) se filtraría a los logs.
function redactDeepFallback(obj) {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? redactTokensInString(obj) : obj;
  }
  if (Array.isArray(obj)) return '[Array]';
  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) return '[REDACTED]';
  }
  return '[Object]';
}

function redactSensitive(obj, maxDepth = 3) {
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? redactTokensInString(obj) : obj;
  }
  if (maxDepth <= 0) {
    return redactDeepFallback(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, maxDepth - 1));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    if (isSensitiveKey(keyLower)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactTokensInString(value);
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value, maxDepth - 1);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function sanitizeForLog(data) {
  if (typeof data === 'string') {
    // Redacta tokens ANTES de truncar: un token puede vivir mas alla del limite.
    return redactTokensInString(data).slice(0, 1000);
  }
  return redactSensitive(data);
}

// ========================
// Input Validation
// ========================
// Nota: la validacion de nombre de servicio, metodo HTTP y ruta de proyecto vive
// en service-harness.js (serviceSpec/cleanMethod/cleanPath) y project-path-policy.js.
// Duplicarla aqui creaba dos fuentes de verdad que ya divergian (una admitia "ssh").
function validatePermissionMode(mode) {
  const allowed = ['readonly', 'step', 'full'];
  const clean = String(mode || "step").toLowerCase().trim();
  if (!allowed.includes(clean)) {
    throw new Error(`Modo de permisos no válido: ${clean}`);
  }
  return clean;
}

// ========================
// Audit Logging
// ========================
let auditLogPath = null;

function initAuditLog(appPath) {
  auditLogPath = path.join(appPath, 'audit.log');
}

const AUDIT_LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const AUDIT_LOG_KEEP = 3;

function rotateAuditLogIfNeeded() {
  if (!auditLogPath) return;
  try {
    const stat = fs.statSync(auditLogPath);
    if (stat.size < AUDIT_LOG_MAX_BYTES) return;
  } catch {
    return; // No existe todavia: nada que rotar.
  }
  try {
    for (let i = AUDIT_LOG_KEEP - 1; i >= 1; i -= 1) {
      const from = `${auditLogPath}.${i}`;
      const to = `${auditLogPath}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(auditLogPath, `${auditLogPath}.1`);
  } catch (error) {
    console.error('Failed to rotate audit log:', error.message);
  }
}

function auditLog(event, details = {}) {
  if (!auditLogPath) return; // Not initialized

  try {
    rotateAuditLogIfNeeded();
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      user: os.userInfo().username,
      pid: process.pid,
      ...sanitizeForLog(details),
    };

    // mode 0o600: solo el usuario actual puede leer el log de auditoria.
    fs.appendFileSync(
      auditLogPath,
      JSON.stringify(entry) + '\n',
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
  }
}

// ========================
// Security Headers
// ========================
// CSP de la propia aplicacion. Se aplica por header ademas del meta tag de
// index.html: si el HTML se sirve sin el meta, el meta no protege nada.
// frame-src permite http/https porque el panel de navegador (webview) carga
// sitios arbitrarios; ese contenido va aislado (sin preload ni Node).
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: file:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src http: https: file:",
].join("; ");

function setSecurityHeaders(session) {
  // Remove dangerous headers
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};

    // Add security headers
    headers['X-Content-Type-Options'] = ['nosniff'];
    headers['X-Frame-Options'] = ['DENY'];
    headers['X-XSS-Protection'] = ['1; mode=block'];
    headers['Referrer-Policy'] = ['no-referrer'];

    // CSP solo para los documentos locales de la app: aplicarla al contenido
    // remoto del webview romperia los sitios que el usuario visita.
    if (/^file:\/\//i.test(String(details.url || ''))) {
      headers['Content-Security-Policy'] = [APP_CSP];
    }

    // Remove sensitive headers
    delete headers['Server'];
    delete headers['X-Powered-By'];

    callback({ responseHeaders: headers });
  });
}

// ========================
// Exports
// ========================
module.exports = {
  checkRateLimit,
  initRateLimitState,
  persistRateLimitState,
  redactSensitive,
  sanitizeForLog,
  validatePermissionMode,
  initAuditLog,
  auditLog,
  setSecurityHeaders,
};
