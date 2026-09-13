"use strict";

/**
 * Branding permanente del runtime: electron.exe NUNCA debe mostrar logo/nombre Electron.
 * Estampa assets/logo.ico + metadatos EditCoreAI en node_modules/electron/dist/electron.exe.
 * Se ejecuta en postinstall y al abrir (ensure-editcore-shortcuts / Abrir bat).
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const electronExe = path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");
const logoIco = path.join(appRoot, "assets", "logo.ico");
const logoFallback = path.join(appRoot, "resources", "ui-overlay", "assets", "logo.ico");

function resolveLogo() {
  fs.mkdirSync(path.join(appRoot, "assets"), { recursive: true });
  if (fs.existsSync(logoIco) && fs.statSync(logoIco).size > 1000) return logoIco;
  if (fs.existsSync(logoFallback) && fs.statSync(logoFallback).size > 1000) {
    fs.copyFileSync(logoFallback, logoIco);
    return logoIco;
  }
  throw new Error("Falta assets/logo.ico (logo oficial EditCoreAI).");
}

function resolveRcedit() {
  const candidates = [
    path.join(appRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(appRoot, "node_modules", "rcedit", "bin", "rcedit.exe"),
    path.join(appRoot, "node_modules", "rcedit", "rcedit.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Busqueda corta por si cambia la ruta del paquete.
  const nm = path.join(appRoot, "node_modules");
  if (!fs.existsSync(nm)) return "";
  const stack = [nm];
  let seen = 0;
  while (stack.length && seen < 4000) {
    const dir = stack.pop();
    seen += 1;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && /^rcedit.*\.exe$/i.test(entry.name)) return full;
      if (entry.isDirectory() && entry.name !== ".bin" && !entry.name.startsWith(".")) {
        if (/electron-winstaller|rcedit|app-builder/i.test(entry.name) || dir.endsWith("vendor")) {
          stack.push(full);
        }
      }
    }
  }
  return "";
}

function brandElectronRuntime({ force = false } = {}) {
  if (!fs.existsSync(electronExe)) {
    return { ok: false, skipped: true, reason: "electron.exe no instalado" };
  }
  const icon = resolveLogo();
  const rcedit = resolveRcedit();
  if (!rcedit) {
    throw new Error("No se encontro rcedit.exe (electron-winstaller). Ejecuta npm install.");
  }

  const stampPath = path.join(appRoot, "node_modules", "electron", "dist", ".editcore-branded");
  const stamp = `${fs.statSync(electronExe).size}:${fs.statSync(icon).mtimeMs}:${icon}`;
  if (!force && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf8") === stamp) {
    return { ok: true, cached: true, electronExe, icon, rcedit };
  }

  const args = [
    electronExe,
    "--set-icon", icon,
    "--set-version-string", "FileDescription", "EditCoreAI",
    "--set-version-string", "ProductName", "EditCoreAI",
    "--set-version-string", "CompanyName", "EditCoreAI",
    "--set-version-string", "InternalName", "EDITCOREAI",
    "--set-version-string", "OriginalFilename", "EDITCOREAI.exe",
    "--set-version-string", "LegalCopyright", "Copyright © EditCoreAI",
  ];

  const runRcedit = (target) => spawnSync(rcedit, [target, ...args.slice(1)], {
    cwd: appRoot,
    stdio: "pipe",
    shell: false,
    windowsHide: true,
  });

  let result = runRcedit(electronExe);
  if (result.status !== 0) {
    // Si el exe esta bloqueado (app abierta), brandear copia y reemplazar.
    const tmp = path.join(path.dirname(electronExe), "EDITCOREAI-runtime.tmp.exe");
    try {
      fs.copyFileSync(electronExe, tmp);
      result = runRcedit(tmp);
      if (result.status === 0) {
        try { fs.unlinkSync(electronExe); } catch { /* may fail if locked */ }
        try {
          fs.renameSync(tmp, electronExe);
        } catch {
          fs.copyFileSync(tmp, electronExe);
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
      } else {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      const err = String(result.stderr || result.stdout || error?.message || "").trim();
      throw new Error(`rcedit fallo brandear electron.exe: ${err || `exit ${result.status}`}`);
    }
  }
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || "").trim();
    throw new Error(`rcedit fallo brandear electron.exe: ${err || `exit ${result.status}`}`);
  }

  // Stamp por metadatos (size cambia tras rcedit).
  const stamped = `${fs.statSync(electronExe).size}:${fs.statSync(icon).mtimeMs}:${icon}`;
  fs.writeFileSync(stampPath, stamped, "utf8");
  return { ok: true, cached: false, electronExe, icon, rcedit };
}

if (require.main === module) {
  try {
    const out = brandElectronRuntime({ force: process.argv.includes("--force") });
    if (out.skipped) {
      console.log("SKIP", out.reason);
      process.exit(0);
    }
    console.log(out.cached ? "OK electron.exe ya brandado EditCoreAI" : "OK electron.exe brandado EditCoreAI");
    console.log("exe", out.electronExe);
    console.log("icon", out.icon);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = { brandElectronRuntime, resolveLogo };
