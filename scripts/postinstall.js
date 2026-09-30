#!/usr/bin/env node
"use strict";

/**
 * Deja el runtime local listo tras `npm install`. npm con allow-scripts omite los
 * scripts de instalación de las dependencias, pero sí ejecuta este postinstall raíz.
 * Nunca falla la instalación: cada paso se registra en .editcore/logs/setup.jsonl.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const NM = path.join(APP_ROOT, "node_modules");
const LOG_FILE = path.join(APP_ROOT, ".editcore", "logs", "setup.jsonl");

const results = [];

function record(step, status, detail = "") {
  const entry = { at: new Date().toISOString(), step, status, detail: String(detail).slice(0, 400) };
  results.push(entry);
  console.log(`[setup] ${step}: ${status}${detail ? ` — ${entry.detail}` : ""}`);
}

function runNode(script, cwd, timeoutMs = 600_000) {
  const res = spawnSync(process.execPath, [script], { cwd, stdio: "inherit", timeout: timeoutMs, windowsHide: true });
  return res.status === 0;
}

function ensureElectron() {
  const dir = path.join(NM, "electron");
  if (!fs.existsSync(dir)) return record("electron", "omitido", "no instalado");
  const exe = path.join(dir, "dist", process.platform === "win32" ? "electron.exe" : "electron");
  if (fs.existsSync(exe) && fs.existsSync(path.join(dir, "path.txt"))) return record("electron", "ok", "binario presente");
  const ok = runNode(path.join(dir, "install.js"), dir);
  record("electron", ok && fs.existsSync(exe) ? "instalado" : "error", ok ? "" : "install.js falló");
}

function ensureNodePty() {
  const dir = path.join(NM, "node-pty");
  if (!fs.existsSync(dir)) return record("node-pty", "omitido", "no instalado");
  const conpty = path.join(dir, "build", "Release", "conpty", "conpty.dll");
  if (process.platform !== "win32" || fs.existsSync(conpty)) return record("node-pty", "ok");
  const prebuild = path.join(dir, "scripts", "prebuild.js");
  const post = path.join(dir, "scripts", "post-install.js");
  const ok = (!fs.existsSync(prebuild) || runNode(prebuild, dir)) && (!fs.existsSync(post) || runNode(post, dir));
  record("node-pty", ok ? "instalado" : "error");
}

function ensurePuppeteerChrome() {
  const dir = path.join(NM, "puppeteer");
  if (!fs.existsSync(dir)) return record("puppeteer-chrome", "omitido", "no instalado");
  try {
    const exe = require(dir).executablePath();
    if (exe && fs.existsSync(exe)) return record("puppeteer-chrome", "ok");
  } catch { /* se instala abajo */ }
  const installer = path.join(dir, "install.mjs");
  const ok = fs.existsSync(installer) && runNode(installer, dir, 900_000);
  record("puppeteer-chrome", ok ? "instalado" : "error");
}

function ensureBranding() {
  try {
    const out = require("./brand-electron-runtime").brandElectronRuntime();
    record("branding", out.skipped ? "omitido" : "ok", out.skipped ? out.reason : (out.cached ? "ya aplicado" : "aplicado"));
  } catch (error) {
    record("branding", "error", error.message);
  }
}

for (const step of [ensureElectron, ensureNodePty, ensurePuppeteerChrome, ensureBranding]) {
  try { step(); } catch (error) { record(step.name, "error", error.message); }
}

try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
} catch { /* el registro no debe romper la instalación */ }
