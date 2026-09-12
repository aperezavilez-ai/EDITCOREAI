"use strict";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..", "..");
const portableAsar = path.join(projectRoot, "resources", "app.asar");
const installAsar = path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app.asar");
const rootExe = path.join(projectRoot, "EDITCOREAI.exe");

function log(msg) {
  console.log(`[deploy-portable] ${msg}`);
}

function verifyAsar(asarPath) {
  const renderer = asar.extractFile(asarPath, "renderer.js").toString("utf8");
  const index = asar.extractFile(asarPath, "index.html").toString("utf8");
  if (!/const WINDOW_ID/.test(renderer)) throw new Error(`${asarPath}: falta WINDOW_ID`);
  if (!renderer.includes("triggerChatSend")) throw new Error(`${asarPath}: falta triggerChatSend`);
  if (!/id="sendBtn"[^>]*type="button"/.test(index)) {
    throw new Error(`${asarPath}: sendBtn no actualizado`);
  }
  log(`Verificado ${asarPath}`);
}

async function packAsar(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.packing`;
  if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  await asar.createPackage(appRoot, temp);
  fs.copyFileSync(temp, target);
  fs.rmSync(temp, { force: true });
  verifyAsar(target);
}

async function main() {
  try {
    execFileSync("taskkill", ["/F", "/IM", "EDITCOREAI.exe"], { stdio: "ignore" });
  } catch {}

  log("Empaquetando app.asar portable...");
  await packAsar(portableAsar);

  if (fs.existsSync(path.dirname(installAsar))) {
    await packAsar(installAsar);
    log("Instalacion AppData actualizada");
  }

  if (fs.existsSync(rootExe)) {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).version || "";
    fs.writeFileSync(
      path.join(projectRoot, "resources", ".ui-hotfix-stamp"),
      `${pkgVersion}\n${new Date().toISOString()}`,
      "utf8",
    );
    log(`Portable listo: ${rootExe} (app.asar v${pkgVersion}; reconstruye el .exe con npm run dist:win para actualizar la version del ejecutable)`);
  } else {
    log("No hay EDITCOREAI.exe en la raiz; ejecuta npm run dist:win");
  }

  console.log("\nCierra y reabre EDITCOREAI.exe desde la carpeta del proyecto.");
}

main().catch((error) => {
  console.error("[deploy-portable] ERROR:", error.message);
  process.exit(1);
});
