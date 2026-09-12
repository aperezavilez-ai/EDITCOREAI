"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const repoRootDir = path.resolve(appDir, "..");
const repoAsarPath = path.join(repoRootDir, "resources", "app.asar");
const installAsarPath = path.join(
  process.env.LOCALAPPDATA || "",
  "Programs",
  "EDITCOREAI",
  "resources",
  "app.asar"
);

function log(msg) {
  console.log(`[rebuild-clean-asar] ${msg}`);
}

async function buildCleanAsar() {
  try {
    execFileSync("taskkill", ["/F", "/IM", "EDITCOREAI.exe"], { stdio: "ignore" });
  } catch {}

  const tempStaging = fs.mkdtempSync(path.join(os.tmpdir(), "clean-asar-build-"));
  const tempAsarOut = path.join(tempStaging, "out.asar");
  const stageFilesDir = path.join(tempStaging, "stage");

  log(`Staging con robocopy en: ${stageFilesDir}`);
  fs.mkdirSync(stageFilesDir, { recursive: true });

  try {
    execFileSync("robocopy", [
      appDir,
      stageFilesDir,
      "/MIR",
      "/XD",
      path.join(appDir, "test"),
      path.join(appDir, "scripts"),
      path.join(appDir, "phase4-results"),
      path.join(appDir, "phase1-results"),
      path.join(appDir, "phase2-results"),
      path.join(appDir, "dist"),
      path.join(appDir, ".git"),
      "/XF", "*.log", "*.packing", "*.tmp",
      "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"
    ], { stdio: "inherit" });
  } catch (err) {
    // Robocopy returns exit code 1-3 on successful copy
    if (typeof err.status !== "number" || err.status > 7) {
      throw err;
    }
  }

  log("Empaquetando app.asar limpio...");
  await asar.createPackage(stageFilesDir, tempAsarOut);

  log("Verificando integridad de todos los modulos criticos...");
  const criticalFiles = [
    "main.js",
    "preload.js",
    "renderer.js",
    "project-storage.js",
    "project-analysis.js",
    "brain-service.js",
    "index.html",
    "styles.css",
    "runtime/intent-orchestrator.js",
    "runtime/editcore-claude-adapter.js",
    "node_modules/uuid/dist/cjs/index.js",
  ];

  for (const file of criticalFiles) {
    const normalizedPath = file.replace(/\//g, path.sep);
    const content = asar.extractFile(tempAsarOut, normalizedPath).toString("utf8");
    if (!content || content.length < 20) {
      throw new Error(`Archivo vacio o corrupto en asar: ${file}`);
    }
    if (file === "project-storage.js" && !content.includes("projectId")) {
      throw new Error(`project-storage.js corrupto en asar: ${content.slice(0, 80)}`);
    }
    if (file === "index.html" && !content.includes("welcomeScreen")) {
      throw new Error(`index.html corrupto en asar`);
    }
    log(`  ✓ ${file} verificado OK (${content.length} bytes)`);
  }

  log(`Desplegando en: ${repoAsarPath}`);
  fs.mkdirSync(path.dirname(repoAsarPath), { recursive: true });
  fs.copyFileSync(tempAsarOut, repoAsarPath);

  if (fs.existsSync(path.dirname(installAsarPath))) {
    log(`Desplegando en instalacion LocalAppData: ${installAsarPath}`);
    fs.copyFileSync(tempAsarOut, installAsarPath);
  }

  fs.rmSync(tempStaging, { recursive: true, force: true });
  log("¡Empaquetado y despliegue COMPLETADO CON EXITO!");
}

buildCleanAsar().catch((err) => {
  console.error("ERROR FATAL AL EMPAQUETAR:", err);
  process.exit(1);
});
