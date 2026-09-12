"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");

const appRoot = path.resolve(__dirname, "..");
// Carpeta padre: D:\PROGRAMAS IA  (hermana de EDITCOREAI)
const workspaceRoot = path.resolve(appRoot, "..");
const releaseDir = path.resolve(workspaceRoot, "release-275");
const expectedReleaseDir = path.join(workspaceRoot, "release-275");
const installerName = "EDITCOREAI-Setup.exe";
const bundledRtk = path.resolve(workspaceRoot, "rtk", "rtk.exe");
const portableDir = path.join(releaseDir, "EDITCOREAI-portable");

if (releaseDir !== expectedReleaseDir || path.dirname(releaseDir) !== workspaceRoot) {
  throw new Error(`Ruta de release insegura: ${releaseDir}`);
}
if (!fs.existsSync(bundledRtk) || !fs.statSync(bundledRtk).isFile()) {
  throw new Error(`Falta el binario requerido para el release: ${bundledRtk}`);
}

fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  const target = path.join(releaseDir, entry.name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[build-windows] No se pudo limpiar ${target}: ${error.message}`);
  }
}

const builder = require.resolve("electron-builder/out/cli/cli.js", { paths: [appRoot] });
const result = spawnSync(process.execPath, [builder, "--win", "nsis", "--x64"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const installerPath = path.join(releaseDir, installerName);
if (!fs.existsSync(installerPath)) throw new Error(`No se genero ${installerName}.`);

const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const appVersion = String(pkg.version || "").trim();

const unpackedDir = path.join(releaseDir, "win-unpacked");
const unpackedExe = path.join(unpackedDir, "EDITCOREAI.exe");
if (!fs.existsSync(unpackedExe)) {
  throw new Error(`No se genero la app portable en ${unpackedDir}.`);
}

const archivePath = path.join(unpackedDir, "resources", "app.asar");
if (!fs.existsSync(archivePath)) throw new Error("El empaquetado no genero resources/app.asar.");
const uiOverlayPacked = path.join(unpackedDir, "resources", "ui-overlay", "index.html");
if (!fs.existsSync(uiOverlayPacked)) {
  const uiOverlaySrc = path.join(workspaceRoot, "ui-overlay");
  const uiOverlayDest = path.join(unpackedDir, "resources", "ui-overlay");
  if (!fs.existsSync(path.join(uiOverlaySrc, "index.html"))) {
    throw new Error("Falta resources/ui-overlay (UI lean requerida para evitar pantalla en blanco).");
  }
  fs.cpSync(uiOverlaySrc, uiOverlayDest, { recursive: true, force: true });
  console.warn("[build-windows] ui-overlay inyectado manualmente en win-unpacked/resources/");
}
if (!fs.existsSync(uiOverlayPacked) && !fs.existsSync(path.join(unpackedDir, "resources", "ui-overlay", "index.html"))) {
  throw new Error("El empaquetado no incluye resources/ui-overlay/index.html.");
}
const mismatches = [];
for (const archiveEntry of asar.listPackage(archivePath)) {
  const relative = archiveEntry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (!relative || relative === "package.json" || relative.startsWith("node_modules/")) continue;
  if (!/\.(?:js|json|html|css)$/i.test(relative)) continue;
  const sourcePath = path.join(appRoot, ...relative.split("/"));
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
  let packed;
  try {
    packed = asar.extractFile(archivePath, relative);
  } catch {
    continue;
  }
  const source = fs.readFileSync(sourcePath);
  if (!packed.equals(source)) mismatches.push(relative);
}
if (mismatches.length) {
  throw new Error(`ASAR corrupto o inconsistente: ${mismatches.slice(0, 20).join(", ")}`);
}

try {
  spawnSync("taskkill", ["/F", "/IM", "EDITCOREAI.exe"], { stdio: "ignore" });
  spawnSync("taskkill", ["/F", "/IM", "electron.exe"], { stdio: "ignore" });
} catch { /* ignore */ }

// Portable limpio (no volcar DLLs a D:\ ni a PROGRAMAS IA).
fs.mkdirSync(portableDir, { recursive: true });
for (const entry of fs.readdirSync(unpackedDir, { withFileTypes: true })) {
  const destName = entry.name.toLowerCase() === "electron.exe" ? "EDITCOREAI.exe" : entry.name;
  const src = path.join(unpackedDir, entry.name);
  const dest = path.join(portableDir, destName);
  fs.cpSync(src, dest, { recursive: true, force: true });
}
try {
  const orphanPortable = path.join(portableDir, "electron.exe");
  if (fs.existsSync(orphanPortable)) fs.unlinkSync(orphanPortable);
} catch { /* ignore */ }

// Copia del EXE portable junto al proyecto fuente para acceso rapido.
const projectExe = path.join(appRoot, "EDITCOREAI.exe");
try {
  fs.copyFileSync(path.join(portableDir, "EDITCOREAI.exe"), projectExe);
} catch (error) {
  console.warn(`[build-windows] No se pudo copiar EXE al proyecto: ${error.message}`);
}

const installDir = path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI");
if (fs.existsSync(installDir)) {
  for (const entry of fs.readdirSync(portableDir, { withFileTypes: true })) {
    const src = path.join(portableDir, entry.name);
    const dest = path.join(installDir, entry.name);
    try {
      fs.cpSync(src, dest, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[build-windows] No se pudo actualizar instalacion ${dest}: ${error.message}`);
    }
  }
  try {
    const orphanInstallExe = path.join(installDir, "electron.exe");
    if (fs.existsSync(orphanInstallExe)) fs.unlinkSync(orphanInstallExe);
  } catch { /* ignore */ }
}

console.log(`Release limpio: ${installerPath}`);
console.log(`Version empaquetada: ${appVersion}`);
console.log(`Portable: ${path.join(portableDir, "EDITCOREAI.exe")}`);
console.log(`EXE proyecto: ${projectExe}`);
