"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");

const appRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(appRoot, "release");
const expectedReleaseDir = path.join(appRoot, "release");
const installerName = "EDITCOREAI-Setup.exe";
const bundledRtk = path.resolve(appRoot, "resources", "rtk", "rtk.exe");

if (releaseDir !== expectedReleaseDir || path.dirname(releaseDir) !== appRoot) {
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
  throw new Error(`No se genero la app en ${unpackedDir}.`);
}

const archivePath = path.join(unpackedDir, "resources", "app.asar");
if (!fs.existsSync(archivePath)) throw new Error("El empaquetado no genero resources/app.asar.");
const uiOverlayPacked = path.join(unpackedDir, "resources", "ui-overlay", "index.html");
if (!fs.existsSync(uiOverlayPacked)) {
  const uiOverlaySrc = path.join(appRoot, "resources", "ui-overlay");
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
  // Comparar contenido lógico: durante builds largos Git/editores pueden
  // tocar CRLF y disparar falsos "ASAR corrupto" aunque el paquete esté bien.
  const norm = (buf) => Buffer.from(String(buf).replace(/\r\n/g, "\n"));
  if (!norm(packed).equals(norm(fs.readFileSync(sourcePath)))) mismatches.push(relative);
}
if (mismatches.length) {
  throw new Error(`ASAR corrupto o inconsistente: ${mismatches.slice(0, 20).join(", ")}`);
}

// Candado de release: nunca publicar un ASAR sin el hotfix path / chrome Chat.
{
  const orchPacked = asar.extractFile(archivePath, "editcore-chat-kernel/orchestrator.js").toString("utf8");
  if (!/const path = require\(["']path["']\)/.test(orchPacked)) {
    throw new Error("ASAR inválido: falta require('path') en orchestrator.js");
  }
  const htmlPacked = asar.extractFile(archivePath, "index.html").toString("utf8");
  const topPacked = (htmlPacked.match(/chat-home-top-actions[\s\S]*?<\/div>/) || [""])[0];
  if (!/id="chatHomeIdeBtn"/.test(topPacked)) {
    throw new Error("ASAR inválido: falta botón IDE en titlebar Chat");
  }
  const cssPacked = asar.extractFile(archivePath, "chat-home.css").toString("utf8");
  if (!/\.chat-home-composer-wrap\s*\{[^}]*box-sizing:\s*border-box/s.test(cssPacked)) {
    throw new Error("ASAR inválido: composer no centrado (falta border-box)");
  }
}

try {
  spawnSync("taskkill", ["/F", "/IM", "EDITCOREAI.exe"], { stdio: "ignore" });
  spawnSync("taskkill", ["/F", "/IM", "electron.exe"], { stdio: "ignore" });
} catch { /* ignore */ }

// Actualizar instalacion LocalAppData si existe (antes de borrar win-unpacked).
const installDir = path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI");
if (fs.existsSync(installDir) && fs.existsSync(unpackedDir)) {
  for (const entry of fs.readdirSync(unpackedDir, { withFileTypes: true })) {
    const destName = entry.name.toLowerCase() === "electron.exe" ? "EDITCOREAI.exe" : entry.name;
    const src = path.join(unpackedDir, entry.name);
    const dest = path.join(installDir, destName);
    try {
      fs.cpSync(src, dest, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[build-windows] No se pudo actualizar instalacion ${dest}: ${error.message}`);
    }
  }
}

// release/: SOLO el Setup.exe (sin carpetas/duplicados/yml/blockmap).
const keepName = installerName.toLowerCase();
for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  if (entry.name.toLowerCase() === keepName) continue;
  const target = path.join(releaseDir, entry.name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[build-windows] No se pudo eliminar ${target}: ${error.message}`);
  }
}

const leftover = fs.readdirSync(releaseDir);
if (leftover.length !== 1 || leftover[0] !== installerName) {
  throw new Error(`Release no limpio. Contenido: ${leftover.join(", ")}`);
}

// BAT solo para el Setup en release\ (no sustituye el EXE de la raíz).
fs.writeFileSync(
  path.join(appRoot, "Abrir-EDITCOREAI-PORTABLE.bat"),
  [
    "@echo off",
    "setlocal",
    'start "" "%~dp0release\\EDITCOREAI-Setup.exe"',
    "endlocal",
    "",
  ].join("\r\n"),
  "utf8",
);

// EDITCOREAI.exe en la RAÍZ = launcher del proyecto raíz (Electron), NUNCA release.
const rebuildRoot = spawnSync(process.execPath, [path.join(__dirname, "rebuild-root-exe.js")], {
  cwd: appRoot,
  stdio: "inherit",
  shell: false,
});
if (rebuildRoot.status !== 0) {
  console.warn("[build-windows] No se pudo recompilar EDITCOREAI.exe de la raíz");
}

console.log(`Release limpio (solo Setup): ${installerPath}`);
console.log(`Version empaquetada: ${appVersion}`);
