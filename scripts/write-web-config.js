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

// /app es el chat del IDE: se arma en cada publicación con los mismos archivos de la app de escritorio
// (index.html, chat-home.*, styles.css, renderer-markdown.js, runtime/credit-ledger.js) y web-bridge.js.
const REPO_ROOT = path.join(__dirname, "..");
const IDE_COPIES = [
  ["styles.css", "ide/styles.css"],
  ["chat-home.css", "ide/chat-home.css"],
  ["chat-home.js", "ide/chat-home.js"],
  ["renderer-markdown.js", "ide/renderer-markdown.js"],
];
const CHAT_START = '<section id="chatHomeShell"';
const CHAT_END = '<section id="welcomeScreen"';

function ideChatMarkup(indexHtml) {
  const start = indexHtml.indexOf(CHAT_START);
  const end = indexHtml.indexOf(CHAT_END);
  if (start < 0 || end <= start) throw new Error("index.html del IDE no tiene el bloque del chat (chatHomeShell … welcomeScreen)");
  return indexHtml.slice(start, end).replace(/(src|href)="\.\/assets\//g, '$1="/assets/').trimEnd();
}

function webCommonJs(source, moduleVar) {
  return `(function (require, module, exports) {\n${source}\n})(window.__editcoreWebRequire, window.${moduleVar} = { exports: {} }, window.${moduleVar}.exports);\n`;
}

function webAppHtml(chatMarkup) {
  return `<!doctype html>
<!-- Generado por scripts/write-web-config.js desde index.html del IDE. No editar a mano. -->
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EditCoreAI</title>
    <link rel="icon" href="/assets/favicon.ico" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
    <link rel="stylesheet" href="/ide/styles.css" />
    <link rel="stylesheet" href="/ide/chat-home.css" />
    <link rel="stylesheet" href="/css/web-ide.css" />
  </head>
  <body data-app-mode="chat" class="is-web">
    ${chatMarkup}

    <main aria-hidden="true">
      <section id="feed" class="feed"></section>
      <span id="modelPickerLabel" hidden>Auto</span>
      <div id="modelPickerMenu" class="model-picker-menu hidden" role="listbox" aria-label="Modelos disponibles"></div>
    </main>

    <script src="/js/cuentas-config.js"></script>
    <script src="/js/editcore-persona.js"></script>
    <script src="/js/cuentas.js"></script>
    <script src="/ide/renderer-markdown.js"></script>
    <script src="/js/web-bridge.js"></script>
    <script src="/ide/credit-ledger.js"></script>
    <script src="/ide/chat-home.js"></script>
  </body>
</html>
`;
}

function writeWebIdeApp(webDir, repoRoot = REPO_ROOT) {
  const ideDir = path.join(webDir, "ide");
  fs.mkdirSync(ideDir, { recursive: true });
  for (const [from, to] of IDE_COPIES) fs.copyFileSync(path.join(repoRoot, from), path.join(webDir, to));
  const ledger = fs.readFileSync(path.join(repoRoot, "runtime", "credit-ledger.js"), "utf8");
  fs.writeFileSync(path.join(ideDir, "credit-ledger.js"), webCommonJs(ledger, "__editcoreCreditLedgerModule"), "utf8");
  const markup = ideChatMarkup(fs.readFileSync(path.join(repoRoot, "index.html"), "utf8"));
  const out = path.join(webDir, "app.html");
  fs.writeFileSync(out, webAppHtml(markup), "utf8");
  return out;
}

function writeWebConfig(webDir, env) {
  const out = path.join(webDir, "js", "cuentas-config.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cuentasConfigJs(env), "utf8");
  fs.writeFileSync(path.join(webDir, "js", "editcore-persona.js"), `window.EDITCORE_WEB_PERSONA = ${JSON.stringify(webPersonaPrompt())};\n`, "utf8");
  writeWebIdeApp(webDir);
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

module.exports = { cuentasConfigJs, webPersonaPrompt, writeWebConfig, writeWebIdeApp, ideChatMarkup, webCommonJs };
