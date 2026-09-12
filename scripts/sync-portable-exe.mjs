"use strict";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..", "..");
const sourceDir = path.join(
  projectRoot,
  JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).build?.directories?.output || "release-266",
  "win-unpacked",
);
const rootExe = path.join(projectRoot, "EDITCOREAI.exe");
const freshAsar = path.join(projectRoot, "resources", "app.asar");

function log(msg) {
  console.log(`[sync-portable-exe] ${msg}`);
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`No existe ${sourceDir}`);
}
if (!fs.existsSync(freshAsar)) {
  throw new Error(`Primero ejecuta node scripts/deploy-portable-exe.mjs (${freshAsar})`);
}

try {
  execFileSync("taskkill", ["/F", "/IM", "EDITCOREAI.exe"], { stdio: "ignore" });
} catch {}

const asarBackup = `${freshAsar}.sync-backup`;
fs.copyFileSync(freshAsar, asarBackup);
log(`Copiando runtime desde ${sourceDir}`);
try {
  execFileSync("robocopy", [sourceDir, projectRoot, "/E", "/NFL", "/NDL", "/NJH", "/NP", "/R:2", "/W:1"], { stdio: "inherit" });
} catch (error) {
  if (typeof error.status !== "number" || error.status >= 8) throw error;
}
fs.copyFileSync(asarBackup, freshAsar);
fs.rmSync(asarBackup, { force: true });

const stamp = new Date().toISOString();
fs.writeFileSync(path.join(projectRoot, "resources", ".ui-hotfix-stamp"), stamp, "utf8");
log(`EXE actualizado: ${rootExe}`);
log(`app.asar conservado con UI nueva (${freshAsar})`);
console.log("\nabre EDITCOREAI.exe desde la carpeta del proyecto.");
