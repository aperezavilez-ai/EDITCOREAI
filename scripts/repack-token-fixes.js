"use strict";
// Reempaqueta app.asar partiendo del asar EN VIVO (backup fresco) y sobrepone
// solo los 2 archivos con las correcciones de tokens. Reproduce la estructura
// exacta del asar de produccion (jszip packed, sin unpackDir).

const fs = require("node:fs");
const path = require("node:path");
const asar = require(path.join(__dirname, "..", "node_modules", "@electron", "asar"));

const APP_ROOT = path.resolve(__dirname, "..");
const RES_DIR = path.resolve(APP_ROOT, "..");
const SOURCE_ASAR = path.join(RES_DIR, "app.asar.backup-20260810-pre-token-fixes");
const OUTPUT_ASAR = path.join(RES_DIR, "app.asar");
const TEMP_DIR = path.join(RES_DIR, ".asar-repack-token-temp");

const PATCHED_FILES = ["main.js", "runtime/agent-runtime.js"];

function log(m) { console.log(`[repack] ${m}`); }

async function main() {
  if (!fs.existsSync(SOURCE_ASAR)) throw new Error(`No existe el backup fuente: ${SOURCE_ASAR}`);
  log(`Fuente: ${(fs.statSync(SOURCE_ASAR).size / 1024 / 1024).toFixed(0)} MB`);

  // El asar vivo no tiene archivos unpacked en el header (jszip va packed).
  const header = asar.getRawHeader(SOURCE_ASAR).header;
  let unpackedCount = 0;
  (function walk(n) { for (const e of Object.values(n.files || {})) { if (e.files) walk(e); else if (e.unpacked) unpackedCount++; } })(header);
  if (unpackedCount !== 0) throw new Error(`Se esperaban 0 archivos unpacked, hay ${unpackedCount}. Aborto para no romper estructura.`);

  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  log("Extrayendo asar completo (~690 MB, puede tardar)...");
  asar.extractAll(SOURCE_ASAR, TEMP_DIR);
  log("Extraccion completa.");

  for (const rel of PATCHED_FILES) {
    const src = path.join(APP_ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`Archivo fuente no encontrado: ${src}`);
    const dest = path.join(TEMP_DIR, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    log(`Sobrepuesto: ${rel} (${fs.readFileSync(src, "utf8").split("\n").length} lineas)`);
  }

  const tmpOut = OUTPUT_ASAR + ".repacking";
  log("Empaquetando nuevo app.asar (sin unpackDir, jszip packed)...");
  await asar.createPackage(TEMP_DIR, tmpOut);
  fs.renameSync(tmpOut, OUTPUT_ASAR);
  log(`app.asar actualizado: ${(fs.statSync(OUTPUT_ASAR).size / 1024 / 1024).toFixed(0)} MB`);

  log("Verificando parches en el nuevo asar...");
  for (const rel of PATCHED_FILES) {
    const c = asar.extractFile(OUTPUT_ASAR, rel).toString("utf8");
    const okTokens = rel.includes("agent-runtime") ? c.includes("maxNetInputTokens") && c.includes("stepRanges") : c.includes("maxNetInputTokens");
    log(`  ${rel}: ${c.split("\n").length} lineas, fix presente: ${okTokens}`);
    if (!okTokens) throw new Error(`El parche no quedo aplicado en ${rel}`);
  }
  // Sanidad: jszip debe seguir packed dentro
  const j = (asar.getRawHeader(OUTPUT_ASAR).header.files["node_modules"] || {}).files || {};
  log(`jszip packed dentro: ${!!j["jszip"]}`);

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  log("REPACK COMPLETADO.");
}

main().catch((err) => { console.error("[repack] ERROR:", err.message); process.exit(1); });
