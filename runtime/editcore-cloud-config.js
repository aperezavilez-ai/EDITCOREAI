"use strict";

// Dirección y clave pública (anon) del servidor de cuentas de EditCoreAI.
// La clave anon es pública por diseño (la protección real son las funciones del servidor),
// pero no se versiona: viene de variables de entorno, del archivo generado al construir
// (runtime/editcore-cloud.generated.json, ignorado por git) o de .env.local en desarrollo.
// Nunca debe contener la service_role.

const fs = require("node:fs");
const path = require("node:path");

const GENERATED_FILE = path.join(__dirname, "editcore-cloud.generated.json");
const DEFAULT_PUBLIC_URL = "https://api-editcoreai.gafcore.com";

function parseEnvFile(filePath) {
  const out = {};
  let text = "";
  try { text = fs.readFileSync(filePath, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function readGenerated(filePath = GENERATED_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function looksLikeServiceRole(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3) return /^sb_secret_/i.test(String(key || ""));
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function isPackagedApp() {
  if (!process.versions?.electron) return false;
  try {
    return require("electron").app?.isPackaged === true;
  } catch {
    return false;
  }
}

function loadCloudConfig(options = {}) {
  // En la app instalada el servidor de cuentas no se cambia con variables de entorno:
  // apuntarla a un servidor falso permitiría fingir una cuenta de administrador.
  const packaged = options.packaged ?? isPackagedApp();
  const env = packaged ? {} : (options.env || process.env);
  const envFile = options.envFile === undefined ? path.join(__dirname, "..", ".env.local") : options.envFile;
  const generated = readGenerated(options.generatedFile || GENERATED_FILE);
  const local = envFile ? parseEnvFile(envFile) : {};

  const url = String(env.EDITCOREAI_CLOUD_URL || generated.url || local.EDITCOREAI_CLOUD_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
  const anonKey = String(env.EDITCOREAI_CLOUD_ANON_KEY || generated.anonKey || local.EDITCOREAI_CLOUD_ANON_KEY || "").trim();

  if (looksLikeServiceRole(anonKey)) {
    return { url, anonKey: "", configured: false, error: "La clave configurada no es pública (service_role). No se usa." };
  }
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

module.exports = { loadCloudConfig, parseEnvFile, looksLikeServiceRole, isPackagedApp, GENERATED_FILE, DEFAULT_PUBLIC_URL };
