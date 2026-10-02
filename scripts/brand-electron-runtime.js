"use strict";

/**
 * Branding permanente del runtime: NUNCA logo/nombre Electron en barra de titulo ni tareas.
 * 1) Estampa assets/logo.ico + metadatos en electron.exe
 * 2) Publica EDITCOREAI-host.exe (copia brandada) — ruta nueva = Windows no usa cache del atomo
 * El launcher oficial arranca EDITCOREAI-host.exe, no electron.exe.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const distDir = path.join(appRoot, "node_modules", "electron", "dist");
const electronExe = path.join(distDir, "electron.exe");
const hostExe = path.join(distDir, "EDITCOREAI-host.exe");
const logoIco = path.join(appRoot, "assets", "logo.ico");
function resolveLogo() {
  fs.mkdirSync(path.join(appRoot, "assets"), { recursive: true });
  if (fs.existsSync(logoIco) && fs.statSync(logoIco).size > 1000) return logoIco;
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

function rceditArgs(icon) {
  return [
    "--set-icon", icon,
    "--set-version-string", "FileDescription", "EditCoreAI",
    "--set-version-string", "ProductName", "EditCoreAI",
    "--set-version-string", "CompanyName", "EditCoreAI",
    "--set-version-string", "InternalName", "EDITCOREAI",
    "--set-version-string", "OriginalFilename", "EDITCOREAI.exe",
    "--set-version-string", "LegalCopyright", "Copyright © EditCoreAI",
  ];
}

function runRcedit(rcedit, target, icon) {
  return spawnSync(rcedit, [target, ...rceditArgs(icon)], {
    cwd: appRoot,
    stdio: "pipe",
    shell: false,
    windowsHide: true,
  });
}

function brandTarget(rcedit, target, icon) {
  let result = runRcedit(rcedit, target, icon);
  if (result.status === 0) return result;
  // Archivo bloqueado: brandear copia y reemplazar.
  const tmp = `${target}.${process.pid}.brand.tmp.exe`;
  try {
    fs.copyFileSync(target, tmp);
    result = runRcedit(rcedit, tmp, icon);
    if (result.status !== 0) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return result;
    }
    try { fs.unlinkSync(target); } catch { /* may fail if locked */ }
    try {
      fs.renameSync(tmp, target);
    } catch {
      fs.copyFileSync(tmp, target);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    const err = String(result.stderr || result.stdout || error?.message || "").trim();
    throw new Error(`rcedit fallo brandear ${path.basename(target)}: ${err || `exit ${result.status}`}`);
  }
  return result;
}

function publishHostExe(icon, rcedit, { force = false } = {}) {
  if (!fs.existsSync(electronExe)) return { ok: false, reason: "sin electron.exe" };
  const stampPath = path.join(distDir, ".editcore-host-branded");
  const stamp = `${fs.statSync(electronExe).size}:${fs.statSync(icon).mtimeMs}:${icon}`;
  if (!force && fs.existsSync(hostExe) && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf8") === stamp) {
    return { ok: true, cached: true, hostExe };
  }

  const tmpHost = path.join(distDir, `EDITCOREAI-host.${process.pid}.tmp.exe`);
  try {
    fs.copyFileSync(electronExe, tmpHost);
    const result = runRcedit(rcedit, tmpHost, icon);
    if (result.status !== 0) {
      // Si electron.exe ya estaba brandado, publicar la copia igual.
      const err = String(result.stderr || result.stdout || "").trim();
      if (!/Unable to commit|in use|denied|locked/i.test(err) && result.status !== 0) {
        try { fs.unlinkSync(tmpHost); } catch { /* ignore */ }
        // Fallback: copiar electron.exe brandado tal cual.
        fs.copyFileSync(electronExe, tmpHost);
      }
    }
    try { if (fs.existsSync(hostExe)) fs.unlinkSync(hostExe); } catch { /* ignore */ }
    try {
      fs.renameSync(tmpHost, hostExe);
    } catch {
      fs.copyFileSync(tmpHost, hostExe);
      try { fs.unlinkSync(tmpHost); } catch { /* ignore */ }
    }
    // Re-brand host (ruta nueva → Windows no reutiliza cache del atomo de electron.exe).
    const hostBrand = runRcedit(rcedit, hostExe, icon);
    if (hostBrand.status !== 0) {
      brandTarget(rcedit, hostExe, icon);
    }
    fs.writeFileSync(stampPath, stamp, "utf8");
    return { ok: true, cached: false, hostExe };
  } catch (error) {
    try { fs.unlinkSync(tmpHost); } catch { /* ignore */ }
    throw error;
  }
}

function brandElectronRuntime({ force = false } = {}) {
  if (!fs.existsSync(electronExe)) {
    return { ok: false, skipped: true, reason: "electron.exe no instalado" };
  }
  const icon = resolveLogo();
  const stampPath = path.join(distDir, ".editcore-branded");
  const hostStampPath = path.join(distDir, ".editcore-host-branded");
  const stamp = `${fs.statSync(electronExe).size}:${fs.statSync(icon).mtimeMs}:${icon}`;

  if (!force && fs.existsSync(hostExe) && fs.existsSync(stampPath) && fs.existsSync(hostStampPath)) {
    try {
      if (fs.readFileSync(stampPath, "utf8") === stamp && fs.readFileSync(hostStampPath, "utf8") === stamp) {
        return {
          ok: true,
          cached: true,
          electronExe,
          hostExe,
          icon,
          rcedit: "",
        };
      }
    } catch { /* proceed to brand */ }
  }

  const rcedit = resolveRcedit();
  if (!rcedit) {
    throw new Error("No se encontro rcedit.exe (electron-winstaller). Ejecuta npm install.");
  }

  let electronCached = false;
  if (!force && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf8") === stamp) {
    electronCached = true;
  } else {
    const result = brandTarget(rcedit, electronExe, icon);
    if (result.status !== 0) {
      const err = String(result.stderr || result.stdout || "").trim();
      // Si falla por bloqueo pero el host se puede publicar, no abortar del todo.
      console.warn(`[brand-electron] aviso electron.exe: ${err || `exit ${result.status}`}`);
    } else {
      const stamped = `${fs.statSync(electronExe).size}:${fs.statSync(icon).mtimeMs}:${icon}`;
      fs.writeFileSync(stampPath, stamped, "utf8");
    }
  }

  const host = publishHostExe(icon, rcedit, { force: force || !electronCached });
  return {
    ok: true,
    cached: electronCached && host.cached === true,
    electronExe,
    hostExe: host.hostExe || hostExe,
    icon,
    rcedit,
  };
}

function resolveRuntimeExe() {
  if (fs.existsSync(hostExe)) return hostExe;
  if (fs.existsSync(electronExe)) return electronExe;
  return "";
}

if (require.main === module) {
  try {
    const out = brandElectronRuntime({ force: process.argv.includes("--force") });
    if (out.skipped) {
      console.log("SKIP", out.reason);
      process.exit(0);
    }
    console.log(out.cached ? "OK runtime EditCoreAI ya brandado" : "OK runtime EditCoreAI brandado");
    console.log("electron", out.electronExe);
    console.log("host", out.hostExe);
    console.log("icon", out.icon);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = {
  brandElectronRuntime,
  resolveLogo,
  resolveRuntimeExe,
  hostExe,
  electronExe,
};
