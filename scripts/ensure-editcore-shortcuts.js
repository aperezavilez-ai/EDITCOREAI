"use strict";

/**
 * Garantiza EDITCOREAI.exe con logo oficial + accesos directos
 * (Escritorio / Inicio) apuntando al launcher, NUNCA a electron.exe.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const logoIco = path.join(appRoot, "assets", "logo.ico");
const launcherExe = path.join(appRoot, "EDITCOREAI.exe");
const shortcutName = "EditCoreAI.lnk";

function ensureLogoIco() {
  fs.mkdirSync(path.join(appRoot, "assets"), { recursive: true });
  if (fs.existsSync(logoIco) && fs.statSync(logoIco).size > 1000) return logoIco;
  throw new Error("Falta assets/logo.ico (logo oficial EditCoreAI).");
}

function rebuildLauncherIfNeeded() {
  ensureLogoIco();
  const rebuild = path.join(__dirname, "rebuild-root-exe.js");
  const result = spawnSync(process.execPath, [rebuild], {
    cwd: appRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0 || !fs.existsSync(launcherExe)) {
    throw new Error("No se pudo compilar EDITCOREAI.exe con el logo oficial.");
  }
  return launcherExe;
}

function desktopDirs() {
  const dirs = [];
  const home = process.env.USERPROFILE || "";
  const publicDir = process.env.PUBLIC || "";
  for (const candidate of [
    path.join(home, "OneDrive", "Escritorio"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "Desktop"),
    path.join(home, "Escritorio"),
    path.join(publicDir, "Desktop"),
  ]) {
    if (candidate && fs.existsSync(candidate) && !dirs.includes(candidate)) dirs.push(candidate);
  }
  return dirs;
}

function startMenuDir() {
  const base = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
    : "";
  if (base && !fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

function writeShortcut(lnkPath, targetExe, iconPath) {
  const workDir = path.dirname(targetExe);
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut(${JSON.stringify(lnkPath)})`,
    `$s.TargetPath = ${JSON.stringify(targetExe)}`,
    `$s.WorkingDirectory = ${JSON.stringify(workDir)}`,
    `$s.Description = "EditCoreAI"`,
    `$s.IconLocation = ${JSON.stringify(`${iconPath},0`)}`,
    `$s.Save()`,
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { cwd: appRoot, stdio: "pipe", shell: false, windowsHide: true },
  );
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || "").trim();
    throw new Error(`No se pudo crear acceso directo: ${err || lnkPath}`);
  }
}

function removeStaleShortcuts(dirs) {
  const staleNames = [
    "EditCore AI.lnk",
    "EDITCOREAI.lnk",
    "EDITCORE AI.lnk",
    "Electron.lnk",
  ];
  for (const dir of dirs) {
    for (const name of staleNames) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && name !== shortcutName) fs.unlinkSync(full);
      } catch { /* ignore */ }
    }
  }
}

function ensureEditCoreShortcuts({ rebuild = false } = {}) {
  const icon = ensureLogoIco();
  const destinations = desktopDirs().filter((dir) => !/\\Public\\Desktop$/i.test(dir));
  const startMenu = startMenuDir();
  if (startMenu) destinations.push(startMenu);

  if (!rebuild && fs.existsSync(launcherExe)) {
    const allExist = destinations.length > 0 && destinations.every((dir) => fs.existsSync(path.join(dir, shortcutName)));
    if (allExist) {
      return { ok: true, cached: true, exe: launcherExe, icon, shortcuts: destinations.map((d) => path.join(d, shortcutName)), errors: [] };
    }
  }

  try {
    const { brandElectronRuntime } = require("./brand-electron-runtime");
    brandElectronRuntime({ force: false });
  } catch (error) {
    console.warn("[ensure-shortcuts] brand electron:", error?.message || error);
  }
  const exe = rebuild || !fs.existsSync(launcherExe)
    ? rebuildLauncherIfNeeded()
    : launcherExe;

  removeStaleShortcuts([
    ...destinations,
    path.join(process.env.PUBLIC || "", "Desktop"),
  ].filter(Boolean));

  const written = [];
  const errors = [];
  for (const dir of destinations) {
    const lnk = path.join(dir, shortcutName);
    try {
      writeShortcut(lnk, exe, icon);
      written.push(lnk);
    } catch (error) {
      errors.push(`${lnk}: ${error?.message || error}`);
    }
  }
  if (!written.length) {
    throw new Error(errors[0] || "No se pudo crear ningun acceso directo EditCoreAI.");
  }
  return { ok: true, exe, icon, shortcuts: written, errors };
}

if (require.main === module) {
  try {
    const result = ensureEditCoreShortcuts({ rebuild: true });
    console.log("OK EditCoreAI shortcuts");
    console.log("exe", result.exe);
    console.log("icon", result.icon);
    for (const s of result.shortcuts) console.log("lnk", s);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = { ensureEditCoreShortcuts, ensureLogoIco };
