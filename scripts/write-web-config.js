#!/usr/bin/env node
"use strict";

// Escribe web-portal/js/cuentas-config.js (ignorado por git) con la dirección pública del servidor de cuentas
// y su clave anon, y arma /app con el IDE completo. En Vercel corre como buildCommand y toma las variables de
// entorno del proyecto; en local las toma de .env.local. Si faltan, falla: así un despliegue roto no reemplaza
// al que funciona.
// Uso: node scripts/write-web-config.js [carpeta_web]

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

// /app es el IDE de escritorio tal cual: el mismo index.html con los mismos scripts y estilos, copiados en cada
// publicación a web-portal/ide/. preload.js se sustituye por web-ide-bridge.js + web-agent.js.
const REPO_ROOT = path.join(__dirname, "..");
const WEB_HEAD_SCRIPTS = [
  "/js/cuentas-config.js",
  "/js/cuentas.js",
  "/ide/preload-api.js",
  "/js/web-ide-bridge.js",
  "/js/web-agent.js",
  "/ide/credit-ledger.js",
];

// Archivos locales que carga index.html (scripts, estilos e imágenes), en orden.
function ideSourceFiles(indexHtml) {
  const files = [];
  for (const m of String(indexHtml).matchAll(/\b(?:src|href)="\.\/([^"#?]+)"/g)) {
    if (!files.includes(m[1])) files.push(m[1]);
  }
  return files;
}

// Ejecuta preload.js con un Electron simulado para saber qué funciones expone cada espacio (window.editcore*).
function preloadApi(preloadSource) {
  const api = {};
  const ipc = new Proxy({}, { get: () => () => undefined });
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        api[name] = value && typeof value === "object" ? Object.keys(value).filter((k) => typeof value[k] === "function") : [];
      },
    },
    ipcRenderer: ipc,
    webFrame: ipc,
    webUtils: ipc,
  };
  const sandbox = {
    require: (id) => (id === "electron" ? electron : require(id)),
    process: { platform: "win32", env: {}, versions: {}, resourcesPath: "" },
    __dirname: REPO_ROOT,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, Promise, Error, JSON, Object, Array, String, Number, Boolean, Map, Set, Date, Symbol,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(`(function () {\n${preloadSource}\n})();`, sandbox, { filename: "preload.js" });
  return api;
}

function webAppHtml(indexHtml, version) {
  let html = String(indexHtml)
    .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    .replace(/\b(src|href)="\.\//g, '$1="/ide/')
    .replace(/<body\b([^>]*)>/, (tag, attrs) => (/class="/.test(attrs) ? tag.replace(/class="/, 'class="is-web ') : `<body${attrs} class="is-web">`));
  const boot = [
    "    <!-- Generado por scripts/write-web-config.js desde index.html del IDE. No editar a mano. -->",
    `    <script>window.EDITCORE_WEB_VERSION=${JSON.stringify(String(version || ""))};try{if(!localStorage.getItem("editcore-app-mode"))localStorage.setItem("editcore-app-mode","ide")}catch(e){}</script>`,
    ...WEB_HEAD_SCRIPTS.map((src) => `    <script src="${src}"></script>`),
    '    <link rel="stylesheet" href="/css/web-ide-shell.css" />',
  ].join("\n");
  if (!html.includes("</head>")) throw new Error("index.html del IDE no tiene </head>");
  return html.replace("</head>", `${boot}\n  </head>`);
}

function webCommonJs(source, moduleVar) {
  return `(function (require, module, exports) {\n${source}\n})(window.__editcoreWebRequire, window.${moduleVar} = { exports: {} }, window.${moduleVar}.exports);\n`;
}

function writeWebIdeApp(webDir, repoRoot = REPO_ROOT) {
  const ideDir = path.join(webDir, "ide");
  fs.rmSync(ideDir, { recursive: true, force: true });
  fs.mkdirSync(ideDir, { recursive: true });
  const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  for (const rel of ideSourceFiles(indexHtml)) {
    const from = path.join(repoRoot, rel);
    if (!fs.existsSync(from)) throw new Error(`index.html carga ${rel}, pero no existe`);
    const to = path.join(ideDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  const ledger = fs.readFileSync(path.join(repoRoot, "runtime", "credit-ledger.js"), "utf8");
  fs.writeFileSync(path.join(ideDir, "credit-ledger.js"), webCommonJs(ledger, "__editcoreCreditLedgerModule"), "utf8");
  const api = preloadApi(fs.readFileSync(path.join(repoRoot, "preload.js"), "utf8"));
  fs.writeFileSync(path.join(ideDir, "preload-api.js"), `window.__EDITCORE_PRELOAD_API = ${JSON.stringify(api)};\n`, "utf8");
  let version = "";
  try { version = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version || ""; } catch { version = ""; }
  const out = path.join(webDir, "app.html");
  fs.writeFileSync(out, webAppHtml(indexHtml, version), "utf8");
  return out;
}

function writeWebConfig(webDir, env) {
  const out = path.join(webDir, "js", "cuentas-config.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cuentasConfigJs(env), "utf8");
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

module.exports = { cuentasConfigJs, writeWebConfig, writeWebIdeApp, webAppHtml, ideSourceFiles, preloadApi, webCommonJs };
