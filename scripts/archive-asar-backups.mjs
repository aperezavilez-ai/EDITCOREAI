"use strict";

/**
 * Mueve backups viejos de app.asar a resources/_asar-archive/
 * Sin borrar. No toca app.asar ni app.asar.unpacked activos.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const resourcesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const archiveDir = path.join(resourcesDir, "_asar-archive");

fs.mkdirSync(archiveDir, { recursive: true });

const keep = new Set(["app.asar", "app.asar.unpacked"]);
const moved = [];
for (const name of fs.readdirSync(resourcesDir)) {
  if (keep.has(name)) continue;
  if (!/^app\.asar(\.|$)/i.test(name)) continue;
  if (name === "app.asar") continue;
  const src = path.join(resourcesDir, name);
  const dest = path.join(archiveDir, name);
  if (fs.existsSync(dest)) {
    const stamped = path.join(archiveDir, `${name}.dup-${Date.now()}`);
    fs.renameSync(src, stamped);
    moved.push(`${name} → ${path.basename(stamped)}`);
  } else {
    fs.renameSync(src, dest);
    moved.push(`${name} → _asar-archive/`);
  }
}

console.log(`Archivados: ${moved.length}`);
for (const row of moved) console.log(`  ${row}`);
console.log(`Activos en resources/: ${fs.readdirSync(resourcesDir).filter((n) => n.startsWith("app.asar")).join(", ") || "(ninguno)"}`);
