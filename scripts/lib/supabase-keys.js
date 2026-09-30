"use strict";

const crypto = require("node:crypto");

// SHA-256 de los valores por defecto públicos de la CLI de Supabase (no se guardan los literales).
const DEFAULT_HASHES = {
  JWT_SECRET: "a064b502e61d27e94b8717290e5e1b32e36720e9fbdf952ec81a84c07128cb37",
  PUBLISHABLE_KEY: "9705102db0d5f99ee08daa19a73e510d9877a2a9add9369da247cbbe6c2a0140",
  SECRET_KEY: "c85debb55f2f204d868cc1552c42faa143b4c675f61363ab040dd50b5b5304cd",
};

const KEY_KINDS = ["ANON_KEY", "SERVICE_ROLE_KEY", "PUBLISHABLE_KEY", "SECRET_KEY"];
const SENSITIVE_KINDS = new Set(["SERVICE_ROLE_KEY", "SECRET_KEY"]);

const CONFIG_ENV_NAMES = {
  JWT_SECRET: "SUPABASE_AUTH_JWT_SECRET",
  ANON_KEY: "SUPABASE_AUTH_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_AUTH_SERVICE_ROLE_KEY",
  PUBLISHABLE_KEY: "SUPABASE_AUTH_PUBLISHABLE_KEY",
  SECRET_KEY: "SUPABASE_AUTH_SECRET_KEY",
};

const CONFIG_TOML_FIELDS = {
  JWT_SECRET: "jwt_secret",
  ANON_KEY: "anon_key",
  SERVICE_ROLE_KEY: "service_role_key",
  PUBLISHABLE_KEY: "publishable_key",
  SECRET_KEY: "secret_key",
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function signHs256Jwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyHs256Jwt(token, secret) {
  const [header, body, signature] = String(token || "").split(".");
  if (!header || !body || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Qué claves del set actual son valores por defecto públicos. */
function detectDefaultKeys(keys = {}) {
  const found = [];
  if (sha256(keys.JWT_SECRET) === DEFAULT_HASHES.JWT_SECRET) found.push("JWT_SECRET");
  for (const kind of ["ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (decodeJwtPayload(keys[kind])?.iss === "supabase-demo") found.push(kind);
  }
  if (sha256(keys.PUBLISHABLE_KEY) === DEFAULT_HASHES.PUBLISHABLE_KEY) found.push("PUBLISHABLE_KEY");
  if (sha256(keys.SECRET_KEY) === DEFAULT_HASHES.SECRET_KEY) found.push("SECRET_KEY");
  return found;
}

function generateKeySet({ projectRef = "local", now = Date.now(), years = 10 } = {}) {
  const jwtSecret = crypto.randomBytes(48).toString("base64url");
  const iat = Math.floor(now / 1000);
  const exp = iat + years * 365 * 24 * 3600;
  return {
    JWT_SECRET: jwtSecret,
    ANON_KEY: signHs256Jwt({ iss: "supabase", ref: projectRef, role: "anon", iat, exp }, jwtSecret),
    SERVICE_ROLE_KEY: signHs256Jwt({ iss: "supabase", ref: projectRef, role: "service_role", iat, exp }, jwtSecret),
    PUBLISHABLE_KEY: `sb_publishable_${crypto.randomBytes(24).toString("base64url")}`,
    SECRET_KEY: `sb_secret_${crypto.randomBytes(24).toString("base64url")}`,
  };
}

/** Clave ES256 con la que GoTrue firma las sesiones (formato de signing_keys.json). */
function generateSigningKey() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return {
    kty: "EC", kid: crypto.randomUUID(), use: "sig", key_ops: ["sign", "verify"], alg: "ES256", ext: true,
    d: jwk.d, crv: jwk.crv, x: jwk.x, y: jwk.y,
  };
}

/** JWKS que PostgREST usa para validar: claves públicas de firma + el secreto HS256. */
function buildRestJwks(jwtSecret, signingKeys = []) {
  const publicKeys = signingKeys.map(({ d, ...pub }) => ({ ...pub, key_ops: ["verify"] }));
  return JSON.stringify({ keys: [...publicKeys, { kty: "oct", k: Buffer.from(jwtSecret).toString("base64url") }] });
}

function parseEnvText(text = "") {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function upsertEnvText(text = "", vars = {}) {
  const eol = String(text).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(text).length ? String(text).split(/\r?\n/) : [];
  const pending = new Map(Object.entries(vars));
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && pending.has(m[1])) {
      const value = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${value}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [name, value] of pending) next.push(`${name}=${value}`);
  return next.join(eol) + eol;
}

function findSection(lines, name) {
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** Fija `field = value` dentro de la tabla [section] (la crea si no existe). */
function upsertTomlField(text, section, field, rawValue) {
  const eol = String(text).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(text).split(/\r?\n/);
  const line = `${field} = ${rawValue}`;
  let sec = findSection(lines, section);
  if (!sec) {
    lines.push("", `[${section}]`, line);
    return lines.join(eol);
  }
  const re = new RegExp(`^\\s*${field}\\s*=`);
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    if (re.test(lines[i])) {
      lines[i] = line;
      return lines.join(eol);
    }
  }
  lines.splice(sec.start + 1, 0, line);
  return lines.join(eol);
}

function applyAuthKeyConfig(tomlText, { signingKeysPath = "" } = {}) {
  let next = tomlText;
  if (signingKeysPath) next = upsertTomlField(next, "auth", "signing_keys_path", JSON.stringify(signingKeysPath));
  for (const kind of Object.keys(CONFIG_TOML_FIELDS).reverse()) {
    next = upsertTomlField(next, "auth", CONFIG_TOML_FIELDS[kind], `"env(${CONFIG_ENV_NAMES[kind]})"`);
  }
  return next;
}

function readTomlNumber(tomlText, section, field) {
  const lines = String(tomlText).split(/\r?\n/);
  const sec = findSection(lines, section);
  if (!sec) return null;
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    const m = lines[i].match(new RegExp(`^\\s*${field}\\s*=\\s*(\\d+)`));
    if (m) return Number(m[1]);
  }
  return null;
}

function isDocFile(filePath = "") {
  const base = String(filePath).replace(/\\/g, "/").split("/").pop().toLowerCase();
  return base.endsWith(".md")
    || base === ".cursorrules"
    || /\.(example|sample|template)$/.test(base);
}

/**
 * Reemplaza claves viejas por nuevas. En documentación las claves sensibles
 * se sustituyen por una referencia a .env.local en vez de copiarse.
 */
function replaceKeysInText(text, oldKeys = {}, newKeys = {}, { docMode = false } = {}) {
  let next = String(text);
  const hits = {};
  for (const kind of KEY_KINDS) {
    const oldValue = oldKeys[kind];
    if (!oldValue || oldValue === newKeys[kind] || !next.includes(oldValue)) continue;
    const replacement = docMode && SENSITIVE_KINDS.has(kind)
      ? `<${kind === "SECRET_KEY" ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY"} en .env.local>`
      : newKeys[kind];
    hits[kind] = next.split(oldValue).length - 1;
    next = next.split(oldValue).join(replacement);
  }
  return { text: next, hits, changed: Object.keys(hits).length > 0 };
}

module.exports = {
  DEFAULT_HASHES,
  KEY_KINDS,
  SENSITIVE_KINDS,
  CONFIG_ENV_NAMES,
  sha256,
  decodeJwtPayload,
  signHs256Jwt,
  verifyHs256Jwt,
  detectDefaultKeys,
  generateKeySet,
  generateSigningKey,
  buildRestJwks,
  parseEnvText,
  upsertEnvText,
  upsertTomlField,
  applyAuthKeyConfig,
  readTomlNumber,
  isDocFile,
  replaceKeysInText,
};
