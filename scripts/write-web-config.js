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
    "CONTEXTO: VERSIÓN WEB (www.editcore.mx) · SUITE DE DESARROLLO WEB",
    "- Eres EditCoreAI, el asistente y entorno de ingeniería de software en la nube.",
    "- En esta versión web, los usuarios pueden crear, diseñar y organizar proyectos completos: páginas web, aplicaciones interactivas, utilidades y scripts.",
    "- Cuando crees o modifiques código, estructura tus respuestas etiquetando con claridad los archivos (ej. // filepath: index.html, // filepath: app.js, // filepath: styles.css).",
    "- Informa con naturalidad que el código generado se sincroniza automáticamente con el Panel de Archivos, que el usuario puede previsualizar e interactuar con su app en vivo en el Navegador Web (Preview) del panel derecho, y que puede descargar el proyecto completo en cualquier momento con el botón 'Descargar Proyecto (.zip)'.",
    "- Si el usuario cuenta con conexiones configuradas (GitHub, Vercel, Supabase), ofrécele sincronizar repositorios o publicar a producción.",
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
  let markup = indexHtml.slice(start, end).replace(/(src|href)="\.\/assets\//g, '$1="/assets/').trimEnd();

  // Inyectar botón de Descargar Proyecto (.zip) en la barra superior
  markup = markup.replace(
    '<div class="chat-home-top-actions">',
    `<div class="chat-home-top-actions">
          <button id="webTopDownloadProjectBtn" type="button" class="chat-home-download-btn" title="Descargar proyecto completo con código fuente (.zip)">📥 Descargar Proyecto (.zip)</button>`
  );

  // Inyectar pestaña de Previsualizador Web en el panel de sesión
  markup = markup.replace(
    '<div class="chat-home-context-tabs" role="tablist" aria-label="Vistas de sesión">',
    `<div class="chat-home-context-tabs" role="tablist" aria-label="Vistas de sesión">
              <button type="button" id="chatHomePreviewTabBtn" class="chat-home-context-tab" data-ctx-tab="preview" title="Navegador Web / Previsualización en vivo" aria-selected="false">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.7"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="1.7"/></svg>
              </button>`
  );

  // Inyectar visor interactivo del navegador web en el cuerpo del panel de sesión
  const previewSectionMarkup = `
            <section class="chat-home-context-section" data-ctx="preview" id="chatHomeCtxSecPreview" hidden>
              <div class="web-preview-header">
                <div class="web-preview-address">
                  <span class="web-preview-dot"></span>
                  <span id="webPreviewUrlLabel">editcore://preview/app</span>
                </div>
                <div class="web-preview-actions">
                  <button type="button" id="webPreviewReloadBtn" title="Recargar vista previa" class="web-preview-icon-btn">🔄</button>
                  <button type="button" id="webPreviewMobileBtn" title="Vista móvil (375px)" class="web-preview-icon-btn">📱</button>
                  <button type="button" id="webPreviewDesktopBtn" title="Vista escritorio" class="web-preview-icon-btn is-active">💻</button>
                  <button type="button" id="webPreviewPopoutBtn" title="Abrir en pestaña nueva" class="web-preview-icon-btn">↗</button>
                </div>
              </div>
              <div class="web-preview-viewport" id="webPreviewViewport">
                <iframe id="webPreviewIframe" sandbox="allow-scripts allow-forms allow-modals" title="Vista previa del proyecto"></iframe>
                <div id="webPreviewEmpty" class="web-preview-empty">
                  <p>Pide a EditCoreAI crear una web o app para verla aquí en tiempo real.</p>
                </div>
              </div>
            </section>`;

  markup = markup.replace(
    '<div class="chat-home-context-body">',
    `<div class="chat-home-context-body">${previewSectionMarkup}`
  );

  // Inyectar botón de Descargar Proyecto (.zip) dentro de la sección de archivos del panel derecho
  markup = markup.replace(
    '<ul id="chatHomeCtxFiles" class="chat-home-context-list"></ul>',
    `<ul id="chatHomeCtxFiles" class="chat-home-context-list"></ul>
              <button type="button" id="webSideDownloadBtn" class="chat-home-zip-btn" title="Descargar código del proyecto generado (.zip)">📥 Descargar Proyecto (.zip)</button>`
  );

  // Inyectar pestaña de Conexiones en el menú de categorías de configuración
  markup = markup.replace(
    '<button type="button" class="ec-settings-nav-item" data-settings-tab="models">',
    `<button type="button" class="ec-settings-nav-item" data-settings-tab="connections">
              <span class="ec-settings-nav-icon">🔗</span>
              <span class="ec-settings-nav-label">Conexiones</span>
            </button>
            <button type="button" class="ec-settings-nav-item" data-settings-tab="models">`
  );

  // Inyectar panel de Conexiones (GitHub, Vercel, Supabase) en el viewport de configuración
  const connectionsPaneMarkup = `
            <!-- PANE: Conexiones (GitHub, Vercel, Supabase) -->
            <div class="ec-settings-pane is-hidden" id="settingsPaneConnections" data-pane="connections" hidden>
              <div class="ec-settings-group-card" style="flex-direction:column;align-items:flex-start;gap:8px;">
                <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                  <div class="ec-group-info">
                    <h4>GitHub (Control de Versiones)</h4>
                    <p>Sincroniza y crea repositorios en tu cuenta de GitHub.</p>
                  </div>
                  <span class="ec-status-tag" id="webGithubStatusTag">Sin conectar</span>
                </div>
                <div style="display:flex;gap:8px;width:100%;margin-top:6px;">
                  <input type="password" id="webGithubTokenInput" class="ec-styled-input" placeholder="Personal Access Token (ghp_...)" />
                  <button type="button" class="ec-btn-action" id="webSaveGithubBtn">Guardar</button>
                </div>
              </div>

              <div class="ec-settings-group-card" style="flex-direction:column;align-items:flex-start;gap:8px;">
                <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                  <div class="ec-group-info">
                    <h4>Vercel (Despliegues en Vivo)</h4>
                    <p>Publica tu proyecto web en producción con 1 clic en un dominio .vercel.app.</p>
                  </div>
                  <span class="ec-status-tag" id="webVercelStatusTag">Sin conectar</span>
                </div>
                <div style="display:flex;gap:8px;width:100%;margin-top:6px;">
                  <input type="password" id="webVercelTokenInput" class="ec-styled-input" placeholder="Vercel Access Token o Deploy Hook" />
                  <button type="button" class="ec-btn-action" id="webSaveVercelBtn">Guardar</button>
                </div>
              </div>

              <div class="ec-settings-group-card" style="flex-direction:column;align-items:flex-start;gap:8px;">
                <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                  <div class="ec-group-info">
                    <h4>Supabase (Base de Datos & Auth)</h4>
                    <p>Conexión a tu proyecto dedicado de PostgreSQL y autenticación.</p>
                  </div>
                  <span class="ec-status-tag" id="webSupabaseStatusTag">Sin conectar</span>
                </div>
                <div style="display:flex;gap:8px;width:100%;margin-top:6px;">
                  <input type="text" id="webSupabaseUrlInput" class="ec-styled-input" placeholder="https://tu-proyecto.supabase.co" />
                  <input type="password" id="webSupabaseKeyInput" class="ec-styled-input" placeholder="Anon Key o Service Role" />
                  <button type="button" class="ec-btn-action" id="webSaveSupabaseBtn">Guardar</button>
                </div>
              </div>
            </div>`;

  markup = markup.replace(
    '<div class="ec-settings-pane is-hidden" id="settingsPaneApplication"',
    `${connectionsPaneMarkup}

            <div class="ec-settings-pane is-hidden" id="settingsPaneApplication"`
  );

  return markup;
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
