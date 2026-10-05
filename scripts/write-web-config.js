#!/usr/bin/env node
"use strict";

// Escribe web-portal/js/cuentas-config.js (ignorado por git) con la dirección pública del servidor de cuentas
// y su clave anon. En Vercel corre como buildCommand y toma las variables de entorno del proyecto; en local
// las toma de .env.local. Si faltan, falla: así un despliegue roto no reemplaza al que funciona.
// Uso: node scripts/write-web-config.js [carpeta_web]

const fs = require("node:fs");
const path = require("node:path");

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function jwtRole(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return /^sb_secret_/i.test(String(token || "")) ? "service_role" : "";
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role || "";
  } catch {
    return "";
  }
}

function cuentasConfigJs(env) {
  const url = String(env.EDITCOREAI_CLOUD_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  const anonKey = String(env.EDITCOREAI_CLOUD_ANON_KEY || "").trim();
  if (!/^https:\/\//.test(url)) throw new Error("Falta EDITCOREAI_CLOUD_PUBLIC_URL (https)");
  if (!anonKey) throw new Error("Falta EDITCOREAI_CLOUD_ANON_KEY");
  if (jwtRole(anonKey) === "service_role") throw new Error("EDITCOREAI_CLOUD_ANON_KEY es una service_role: no se publica");
  return `window.EDITCOREAI_CUENTAS = ${JSON.stringify({ url, anonKey })};\n`;
}

function writeWebConfig(webDir, env) {
  const out = path.join(webDir, "js", "cuentas-config.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cuentasConfigJs(env), "utf8");
  return out;
}

if (require.main === module) {
  const repoRoot = path.join(__dirname, "..");
  const env = { ...readEnvFile(path.join(repoRoot, ".env.local")), ...process.env };
  try {
    const out = writeWebConfig(path.resolve(process.argv[2] || path.join(repoRoot, "web-portal")), env);
    console.log(`Config de cuentas para la web escrita en ${out}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { cuentasConfigJs, writeWebConfig };
