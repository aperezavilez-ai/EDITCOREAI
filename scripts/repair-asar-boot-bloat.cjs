"use strict";

/**
 * Repara arranque lento / pantalla en blanco:
 * - Quita dist/ (Setup.exe + win-unpacked) del asar
 * - Reemplaza node_modules por solo dependencias de produccion
 * - Adelgaza overlay resources/app
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");

const requireFrom = createRequire(path.join(__dirname, "deploy-ui-asar-hotfix.mjs"));
const asar = requireFrom("@electron/asar");

const appRoot = path.resolve(__dirname, "..");
const resourcesDir = path.resolve(appRoot, "..");
const REPO_ASAR = path.join(resourcesDir, "app.asar");
const INSTALLED_ASAR = path.join(
  process.env.LOCALAPPDATA || "",
  "Programs",
  "EDITCOREAI",
  "resources",
  "app.asar",
);
const INSTALLED_APP = path.join(path.dirname(INSTALLED_ASAR), "app");

function log(msg) {
  console.log(`[repair-asar-boot] ${msg}`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function installProdModules(dir) {
  const pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg)) throw new Error(`Falta package.json en ${dir}`);
  log(`npm install --omit=dev en ${dir}`);
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
    { cwd: dir, stdio: "inherit", shell: true, env: process.env },
  );
  if (result.status !== 0) throw new Error("npm install --omit=dev fallo");
}

function stripBloat(extractDir) {
  const kill = ["dist", "test", "scripts", "phase4-results", ".cursorrules", ".git"];
  for (const name of kill) {
    const p = path.join(extractDir, name);
    if (fs.existsSync(p)) {
      log(`Eliminando ${name}/`);
      rmrf(p);
    }
  }
  const nm = path.join(extractDir, "node_modules");
  if (fs.existsSync(nm)) {
    log("Eliminando node_modules hinchado del extracto...");
    rmrf(nm);
  }
}

async function rebuildAsar(asarPath) {
  if (!fs.existsSync(asarPath)) throw new Error(`No existe ${asarPath}`);
  const before = fs.statSync(asarPath).size;
  log(`Origen ${(before / 1e6).toFixed(1)} MB → ${asarPath}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-slim-asar-"));
  const extractDir = path.join(tempRoot, "extract");
  const outAsar = path.join(tempRoot, "app.asar.next");
  try {
    fs.mkdirSync(extractDir, { recursive: true });
    log("Extrayendo asar (puede tardar)...");
    asar.extractAll(asarPath, extractDir);
    stripBloat(extractDir);

    for (const rel of ["package.json", "main.js", "preload.js", "renderer.js", "index.html", "styles.css"]) {
      const src = path.join(appRoot, rel);
      if (fs.existsSync(src)) copyFile(src, path.join(extractDir, rel));
    }
    for (const dir of ["runtime", "agent-core", "brain-seed"]) {
      const src = path.join(appRoot, dir);
      const dest = path.join(extractDir, dir);
      if (!fs.existsSync(src)) continue;
      rmrf(dest);
      fs.cpSync(src, dest, { recursive: true });
    }

    installProdModules(extractDir);

    log("Empaquetando asar delgado...");
    await asar.createPackage(extractDir, outAsar);
    const after = fs.statSync(outAsar).size;
    log(`Nuevo asar ${(after / 1e6).toFixed(1)} MB (antes ${(before / 1e6).toFixed(1)} MB)`);
    fs.copyFileSync(outAsar, asarPath);
    return { before, after };
  } finally {
    rmrf(tempRoot);
  }
}

function slimOverlay() {
  if (!fs.existsSync(INSTALLED_APP)) {
    log("No hay overlay resources/app");
    return;
  }
  const nm = path.join(INSTALLED_APP, "node_modules");
  if (fs.existsSync(nm)) {
    log("Recreando overlay node_modules lean...");
    rmrf(nm);
  }
  copyFile(path.join(appRoot, "package.json"), path.join(INSTALLED_APP, "package.json"));
  // Sync critical UI files too
  for (const rel of ["main.js", "preload.js", "renderer.js", "index.html", "styles.css"]) {
    const src = path.join(appRoot, rel);
    if (fs.existsSync(src)) copyFile(src, path.join(INSTALLED_APP, rel));
  }
  installProdModules(INSTALLED_APP);
  log(`Overlay lean OK: ${INSTALLED_APP}`);
}

async function main() {
  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { stdio: "ignore", windowsHide: true });

  const repo = await rebuildAsar(REPO_ASAR);
  if (fs.existsSync(INSTALLED_ASAR)) {
    fs.copyFileSync(REPO_ASAR, INSTALLED_ASAR);
    log(`Instalado sync OK → ${INSTALLED_ASAR}`);
  }
  slimOverlay();

  console.log(JSON.stringify({
    ok: true,
    repoMB: +(repo.after / 1e6).toFixed(1),
    beforeMB: +(repo.before / 1e6).toFixed(1),
    overlay: INSTALLED_APP,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
