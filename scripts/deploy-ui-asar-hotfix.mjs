"use strict";

/**
 * Unificacion de app.asar (sin romper el .exe):
 *
 * Fuente de codigo:   resources/app/          (aqui se edita)
 * Runtime canonico:   %LOCALAPPDATA%\Programs\EDITCOREAI\resources\app.asar
 * Espejo del repo:    resources/app.asar      (copia IDENTICA del instalado; no se parchea aparte)
 *
 * Este script:
 *  1) Parchea UNA sola vez el asar instalado (UI + TODO runtime/)
 *  2) Copia el mismo archivo al espejo del repo
 * No toca app.asar.unpacked ni backups.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const resourcesDir = path.join(appRoot, "resources");

const INSTALLED_ASAR = path.join(
  process.env.LOCALAPPDATA || "",
  "Programs",
  "EDITCOREAI",
  "resources",
  "app.asar",
);
const REPO_MIRROR_ASAR = path.join(resourcesDir, "app.asar");

const HOTFIX_FILES = [
  "index.html",
  "renderer.js",
  "preload.js",
  "project-analysis.js",
  "styles.css",
  "chat-home.js",
  "chat-home.css",
  "logs-panel.js",
  "logs-panel.css",
  "editor-inline-edit.js",
  "editor-inline-edit.css",
  "renderer-markdown.js",
  "auto-model-selection.js",
  "main.js",
  "project-path-policy.js",
  "agent-runtime.js",
  "agent-parser.js",
  "command-policy.js",
  "package.json",
  "visual-preview-inspector.js",
  "evidence-grounding.js",
];

function log(message) {
  console.log(`[deploy-ui-asar] ${message}`);
}

function listFilesRecursive(dir, prefix = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

function collectHotfixFiles() {
  const files = new Set(HOTFIX_FILES);
  // main.js exige muchos modulos runtime; copiar el arbol completo evita "Cannot find module".
  for (const rel of listFilesRecursive(path.join(appRoot, "runtime"), "runtime")) {
    files.add(rel);
  }
  // Motor multiagente nuevo (feature flag).
  for (const rel of listFilesRecursive(path.join(appRoot, "agent-core"), "agent-core")) {
    files.add(rel);
  }
  // IDE panes
  for (const rel of listFilesRecursive(path.join(appRoot, "ide"), "ide")) {
    files.add(rel);
  }
  // Skills del Cerebro (seed) para que brain_skill encuentre metodologias nuevas.
  for (const rel of listFilesRecursive(path.join(appRoot, "brain-seed"), "brain-seed")) {
    files.add(rel);
  }
  return [...files];
}

function collectUnpackedModules(header) {
  const nmFiles = (header.files?.node_modules || {}).files || {};
  return Object.entries(nmFiles)
    .filter(([, entry]) => entry.unpacked === true)
    .map(([name]) => name);
}

function verifyUiFiles(files) {
  for (const rel of files) {
    const source = path.join(appRoot, ...rel.split("/"));
    if (!fs.existsSync(source)) {
      throw new Error(`Falta archivo fuente: ${source}`);
    }
  }
}

function hasArchiveFile(asarPath, relPath) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return asar.listPackage(asarPath).some((entry) => {
    const clean = String(entry || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    return clean === normalized || clean.endsWith(`/${normalized}`);
  });
}

function verifyPatchedAsar(asarPath) {
  // En Windows, extractFile justo tras copyFileSync a veces lee cabecera stale (AV/cache).
  let indexHtml = "";
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      indexHtml = asar.extractFile(asarPath, "index.html").toString("utf8");
      if (indexHtml.includes("modelPickerLabel")) break;
    } catch (err) {
      lastErr = err;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (attempt + 1));
  }
  if (!indexHtml.includes("modelPickerLabel")) {
    throw new Error(`${asarPath}: index.html sin UI nueva${lastErr ? ` (${lastErr.message})` : ""}`);
  }
  if (!indexHtml.includes("chatTabs") || !indexHtml.includes("newChatBtn")) {
    throw new Error(`${asarPath}: index.html sin multi-chat (pestanas / Nuevo chat)`);
  }
  if (!indexHtml.includes("welcomeScreen") || !indexHtml.includes("welcomeHomeBtn")) {
    throw new Error(`${asarPath}: index.html sin pantalla de inicio (welcome)`);
  }
  if (!/providersBtn[^>]*>Modelos</.test(indexHtml)) {
    throw new Error(`${asarPath}: boton toolbar sigue sin renombrar a Modelos`);
  }
  if (!hasArchiveFile(asarPath, "auto-model-selection.js")) {
    throw new Error(`${asarPath}: falta auto-model-selection.js`);
  }
  // Electron asar lista paths con \ en Windows; extractFile acepta ambos.
  try {
    asar.extractFile(asarPath, "runtime/post-write-diagnostics.js");
  } catch {
    try {
      asar.extractFile(asarPath, "runtime\\post-write-diagnostics.js");
    } catch {
      throw new Error(`${asarPath}: falta runtime/post-write-diagnostics.js`);
    }
  }
  const mainJs = asar.extractFile(asarPath, "main.js").toString("utf8");
  if (!mainJs.includes("gemini-2.5-flash") || !mainJs.includes("grok-4.5") || !mainJs.includes("deepseek-v4-pro")) {
    throw new Error(`${asarPath}: main.js sin modelos APICredits nuevos`);
  }
  // Detectar corrupcion por ceros (hotfix incompleto / asar parcial).
  for (const rel of ["visual-preview-inspector.js", "main.js", "preload.js", "renderer.js"]) {
    const buf = asar.extractFile(asarPath, rel);
    const sample = buf.subarray(0, Math.min(32, buf.length));
    let nulls = 0;
    for (const byte of sample) if (byte === 0) nulls += 1;
    if (nulls > 8) throw new Error(`${asarPath}: ${rel} corrupto (bytes nulos)`);
  }
  log(`Verificado: ${asarPath}`);
}

async function patchInstalledAsar(asarPath, files) {
  if (!fs.existsSync(asarPath)) {
    throw new Error(`No existe el asar instalado: ${asarPath}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-ui-asar-"));
  const tempDir = path.join(tempRoot, "extract");
  const tempOut = path.join(tempRoot, "app.asar.next");

  try {
    log(`Parche unico desde: ${asarPath}`);
    fs.mkdirSync(tempDir, { recursive: true });
    asar.extractAll(asarPath, tempDir);

    // Nunca reempacar basura de build (Setup.exe / win-unpacked) dentro del asar.
    for (const junk of ["dist", "test", "scripts", "phase4-results"]) {
      const junkPath = path.join(tempDir, junk);
      if (fs.existsSync(junkPath)) {
        log(`  - quitando ${junk}/ del extracto`);
        fs.rmSync(junkPath, { recursive: true, force: true });
      }
    }

    for (const rel of files) {
      const source = path.join(appRoot, ...rel.split("/"));
      const dest = path.join(tempDir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
    }
    log(`  + ${files.length} archivos (UI + runtime/)`);

    const unpackedMods = collectUnpackedModules(asar.getRawHeader(asarPath).header);
    const unpackOpts = unpackedMods.length
      ? { unpackDir: `node_modules/{${unpackedMods.join(",")}}` }
      : {};

    log("Empaquetando asar canonico...");
    if (unpackedMods.length) {
      await asar.createPackageWithOptions(tempDir, tempOut, unpackOpts);
    } else {
      await asar.createPackage(tempDir, tempOut);
    }

    fs.copyFileSync(tempOut, asarPath);
    verifyPatchedAsar(asarPath);
    return asarPath;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function syncRepoMirror(canonicalAsar, mirrorAsar) {
  fs.mkdirSync(path.dirname(mirrorAsar), { recursive: true });
  fs.copyFileSync(canonicalAsar, mirrorAsar);
  const a = fs.statSync(canonicalAsar);
  const b = fs.statSync(mirrorAsar);
  if (a.size !== b.size) {
    throw new Error(`Espejo distinto al canonico: install=${a.size} repo=${b.size}`);
  }
  log(`Espejo sync OK (${(a.size / 1e6).toFixed(1)} MB) → ${mirrorAsar}`);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Electron SOLO debe usar overlay LEAN (UI sin node_modules/electron).
 * Un overlay gordo (~500MB) hace la apertura y los clics lentisimos.
 * Main/preload/runtime siguen saliendo del app.asar.
 */
function syncLiveAppOverlay(files) {
  const resourcesInstalled = path.dirname(INSTALLED_ASAR);
  const appDir = path.join(resourcesInstalled, "app");

  // Si ya hay un arbol gordo, tirarlo entero y recrear lean.
  const nmDest = path.join(appDir, "node_modules");
  if (fs.existsSync(path.join(nmDest, "electron")) || fs.existsSync(path.join(nmDest, "electron-builder"))) {
    log("Overlay hinchado detectado (electron) → eliminando para restaurar arranque rapido");
    fs.rmSync(appDir, { recursive: true, force: true });
  }

  fs.mkdirSync(appDir, { recursive: true });

  const uiOnly = files.filter((rel) => {
    const norm = String(rel || "").replace(/\\/g, "/");
    if (norm.startsWith("node_modules/")) return false;
    if (norm.startsWith("agent-core/")) return false;
    if (norm.startsWith("test/")) return false;
    if (norm.startsWith("scripts/")) return false;
    return true;
  });

  for (const rel of uiOnly) {
    const source = path.join(appRoot, ...rel.split("/"));
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const dest = path.join(appDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }

  // Stamp: resolveUiIndexHtml solo acepta overlay con este marcador y sin electron.
  fs.writeFileSync(path.join(appDir, ".ui-hotfix-stamp"), `${new Date().toISOString()}\nlean-overlay\n`, "utf8");

  // Garantizar que NO quede node_modules en el overlay lean.
  if (fs.existsSync(nmDest)) {
    log("Quitando node_modules del overlay lean...");
    fs.rmSync(nmDest, { recursive: true, force: true });
  }

  log(`Overlay vivo LEAN OK: ${appDir} (${uiOnly.length} archivos UI, sin node_modules)`);
}

const files = collectHotfixFiles();
verifyUiFiles(files);
log(`Origen UI: ${appRoot}`);
log(`Runtime LocalAppData: ${INSTALLED_ASAR}`);
log(`Runtime repo (.exe local): ${REPO_MIRROR_ASAR}`);
log(`Archivos a inyectar: ${files.length}`);

// El usuario abre D:\...\EDITCOREAI\EDITCOREAI.exe → carga resources/app.asar del REPO.
// LocalAppData es el instalador; hay que parchear AMBOS.
const targets = [...new Set([REPO_MIRROR_ASAR, INSTALLED_ASAR].filter((p) => fs.existsSync(p)))];
if (!targets.length) throw new Error("No hay app.asar para parchear (repo ni LocalAppData).");

for (const asarPath of targets) {
  log(`Parcheando ${asarPath}`);
  await patchInstalledAsar(asarPath, files);
  verifyPatchedAsar(asarPath);
}

/**
 * Overlay LEAN del EXE del monorepo: resources/ui-overlay
 * (NO resources/app — ahi vive el source con electron y rompe arranque).
 * Electron loadFile desde app.asar a menudo falla ERR_FAILED(-2) en este layout.
 */
function syncRepoUiOverlay(files) {
  const uiOverlay = path.join(resourcesDir, "ui-overlay");
  fs.mkdirSync(uiOverlay, { recursive: true });
  const uiOnly = files.filter((rel) => {
    const norm = String(rel || "").replace(/\\/g, "/");
    if (norm.startsWith("node_modules/")) return false;
    if (norm.startsWith("agent-core/")) return false;
    if (norm.startsWith("test/")) return false;
    if (norm.startsWith("scripts/")) return false;
    // main.js/preload viven en asar; la UI del BrowserWindow no los necesita via loadFile.
    return true;
  });
  for (const rel of uiOnly) {
    const source = path.join(appRoot, ...rel.split("/"));
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const dest = path.join(uiOverlay, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
  fs.writeFileSync(path.join(uiOverlay, ".ui-hotfix-stamp"), `${new Date().toISOString()}\nlean-ui-overlay\n`, "utf8");
  const nm = path.join(uiOverlay, "node_modules");
  if (fs.existsSync(nm)) fs.rmSync(nm, { recursive: true, force: true });
  log(`Repo ui-overlay LEAN OK: ${uiOverlay} (${uiOnly.length} archivos)`);
}

// Overlay en LocalAppData (por si el instalador se usa algun dia).
if (fs.existsSync(INSTALLED_ASAR)) {
  syncLiveAppOverlay(files);
}

// Overlay lean junto al EXE del monorepo (prioridad de carga UI).
syncRepoUiOverlay(files);

// Agent Core en disco real junto al .exe del repo (fuera del asar).
// Nunca depender de app.asar/agent-core: Node falla con Invalid package config.
const repoCoreDest = path.join(resourcesDir, "editcore-agent-core");
const coreSrc = path.join(appRoot, "agent-core");
if (fs.existsSync(coreSrc)) {
  fs.rmSync(repoCoreDest, { recursive: true, force: true });
  copyDirRecursive(coreSrc, repoCoreDest);
  const unpackedCore = path.join(resourcesDir, "app.asar.unpacked", "agent-core");
  try {
    fs.mkdirSync(path.dirname(unpackedCore), { recursive: true });
    fs.rmSync(unpackedCore, { recursive: true, force: true });
    copyDirRecursive(coreSrc, unpackedCore);
    log(`Agent Core unpacked: ${unpackedCore}`);
  } catch (e) {
    log(`WARN unpacked agent-core: ${e.message}`);
  }
  if (fs.existsSync(INSTALLED_ASAR)) {
    const installedResources = path.dirname(INSTALLED_ASAR);
    const installedCore = path.join(installedResources, "editcore-agent-core");
    try {
      fs.rmSync(installedCore, { recursive: true, force: true });
      copyDirRecursive(coreSrc, installedCore);
      log(`Agent Core instalado: ${installedCore}`);
    } catch (e) {
      log(`WARN installed agent-core: ${e.message}`);
    }
  }
  log(`Agent Core en disco: ${repoCoreDest}`);
}

console.log("\nReparado: asar(s) + Agent Core en disco.");
console.log("Cierra TODOS los EDITCOREAI.exe y abre de nuevo: D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe");
