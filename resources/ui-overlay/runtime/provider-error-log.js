"use strict";

/**
 * Registro local del error real del proveedor: al usuario solo le llega el mensaje
 * saneado, así que sin este log no hay forma de diagnosticar un "No pude autenticar".
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SECRET_RE = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{20,}|sb_secret_[A-Za-z0-9_-]{8,})/g;
const MAX_BYTES = 2 * 1024 * 1024;

function providerErrorLogPath() {
  const base = process.env.EDITCORE_USER_DATA_PATH
    || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
  return path.join(base, "logs", "provider-errors.jsonl");
}

function redactSecrets(text) {
  return String(text || "").replace(SECRET_RE, "<oculto>");
}

function logProviderError(entry = {}) {
  try {
    const file = providerErrorLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch { /* aún no existe */ }
    fs.appendFileSync(file, redactSecrets(JSON.stringify({ at: new Date().toISOString(), ...entry })) + "\n", "utf8");
  } catch { /* el registro nunca debe romper el chat */ }
}

module.exports = { logProviderError, providerErrorLogPath, redactSecrets };
