"use strict";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(__dirname, "..");
const resourcesDir = path.resolve(source, "..");
const uiOverlay = path.join(resourcesDir, "ui-overlay");
const installApp = path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app");

const targets = [
  { label: "ui-overlay (lean runtime)", dir: uiOverlay },
  { label: "instalacion EDITCOREAI", dir: installApp },
];

function copyWithRobocopy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  execFileSync("robocopy", [from, to, "/E", "/NFL", "/NDL", "/NJH", "/NP", "/R:2", "/W:1",
    "/XD", "node_modules", "electron", "test", "scripts", ".git"], { stdio: "inherit" });
}

console.log(`Origen UI: ${source}\n`);
for (const target of targets) {
  if (!fs.existsSync(path.dirname(target.dir)) && target.label.includes("instalacion")) {
    console.log(`Omitido (${target.label}): ruta no encontrada`);
    continue;
  }
  console.log(`Copiando → ${target.label}\n  ${target.dir}`);
  try {
    copyWithRobocopy(source, target.dir);
  } catch (error) {
    if (typeof error.status === "number" && error.status < 8) {
      console.log(`  OK (robocopy ${error.status})`);
      continue;
    }
    throw error;
  }
  console.log("  OK");
}
console.log("\nListo. Preferible usar deploy-ui-asar-hotfix.mjs para asar + overlay.");
