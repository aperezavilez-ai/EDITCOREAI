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

// La web no tiene archivos, terminal ni tools: de la política del IDE se quitan las secciones y líneas que las suponen.
const IDE_ONLY_SECTIONS = /^(RAZONAMIENTO VISIBLE|E2E \/ REPORTE|ROADMAP-FIRST|OPERACIONES NUBE)/;
const IDE_ONLY_LINES = /\(tools\)|tool_call|run_e2e|ROADMAP|tocaste archivos|proyecto está abierto/i;

function webPersonaPrompt() {
  const { ELITE_COMMUNICATION_POLICY } = require("../runtime/elite-communication-policy.js");
  const policy = ELITE_COMMUNICATION_POLICY.split("\n\n")
    .filter((block) => !IDE_ONLY_SECTIONS.test(block.trim()))
    .map((block) => block.split("\n").filter((line) => !IDE_ONLY_LINES.test(line)).join("\n"))
    .join("\n\n");
  return [
    policy,
    "",
    "CONTEXTO: VERSIÓN WEB (www.editcore.mx)",
    "- Eres EditCoreAI, ingeniero de software senior. Este chat es la versión web: no tienes acceso a archivos, terminal, preview ni conexiones del IDE.",
    "- Nunca digas que leíste, creaste, modificaste, ejecutaste o publicaste algo. Entrega el código completo para que el usuario lo copie.",
    "- Si el pedido necesita trabajar dentro del proyecto (leer o cambiar archivos, ejecutar, publicar), explícalo y sugiere abrir EditCoreAI de escritorio.",
    "- No inventes archivos, cambios ni verificaciones.",
  ].join("\n");
}

function writeWebConfig(webDir, env) {
  const out = path.join(webDir, "js", "cuentas-config.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cuentasConfigJs(env), "utf8");
  fs.writeFileSync(path.join(webDir, "js", "editcore-persona.js"), `window.EDITCORE_WEB_PERSONA = ${JSON.stringify(webPersonaPrompt())};\n`, "utf8");
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

module.exports = { cuentasConfigJs, webPersonaPrompt, writeWebConfig };
