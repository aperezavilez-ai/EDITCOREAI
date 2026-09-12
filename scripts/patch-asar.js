"use strict";
// Script que reconstruye app.asar reemplazando solo main.js y runtime/ai-core.js
// con las versiones corregidas de resources/app/, preservando el resto del backup intacto.

const fs = require("node:fs");
const path = require("node:path");
const asar = require(path.join(__dirname, "..", "node_modules", "@electron", "asar"));

const SCRIPT_DIR = __dirname;
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const RESOURCES_DIR = path.resolve(APP_ROOT, "..");
const BACKUP_ASAR = path.join(RESOURCES_DIR, "app.asar.backup-20260807-context-brain-cache-fix");
const OUTPUT_ASAR = path.join(RESOURCES_DIR, "app.asar");
const TEMP_DIR = path.join(RESOURCES_DIR, ".asar-patch-temp");

const PATCHED_FILES = [
  "main.js",
  "renderer.js",
  "agent-runtime.js",
  "runtime/ai-core.js",
  "runtime/brain-tools.js",
  "inspector-core-service.js",
];

function log(msg) { console.log(`[patch-asar] ${msg}`); }

async function main() {
  if (!fs.existsSync(BACKUP_ASAR)) throw new Error(`Backup no encontrado: ${BACKUP_ASAR}`);
  log(`Backup: ${BACKUP_ASAR} (${(fs.statSync(BACKUP_ASAR).size / 1024 / 1024).toFixed(1)} MB)`);

  // Extraer el header del backup para obtener la lista de archivos
  log("Leyendo header del backup...");
  const headerInfo = asar.getRawHeader(BACKUP_ASAR);
  const header = headerInfo.header;
  log(`Header OK.`);

  // Verificar que los archivos fuente modificados existen
  for (const rel of PATCHED_FILES) {
    const src = path.join(APP_ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`Archivo fuente no encontrado: ${src}`);
    log(`Archivo fuente OK: ${rel}`);
  }

  // Crear directorio temporal limpio
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Extraer todos los archivos del backup al temp dir
  log("Extrayendo archivos del backup (puede tomar unos segundos)...");
  const files = collectFiles(header, "");
  let extracted = 0;
  let skipped = 0;
  for (const relPath of files) {
    const normalizedPath = path.normalize(relPath);
    const destPath = path.join(TEMP_DIR, normalizedPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try {
      const content = asar.extractFile(BACKUP_ASAR, normalizedPath);
      fs.writeFileSync(destPath, content);
      extracted++;
    } catch (err) {
      skipped++;
    }
  }
  log(`Extraídos: ${extracted}, Omitidos (unpacked): ${skipped}`);

  // Recopilar módulos marcados unpacked en el backup y copiarlos al temp dir desde app/node_modules
  const backupHeader = asar.getRawHeader(BACKUP_ASAR).header;
  const nmFiles = (backupHeader.files["node_modules"] || {}).files || {};
  const unpackedMods = Object.entries(nmFiles)
    .filter(([, v]) => v.unpacked === true)
    .map(([k]) => k);
  log(`Módulos unpacked a restaurar: ${unpackedMods.join(", ") || "ninguno"}`);

  for (const mod of unpackedMods) {
    const srcMod = path.join(APP_ROOT, "node_modules", mod);
    const destMod = path.join(TEMP_DIR, "node_modules", mod);
    if (fs.existsSync(srcMod)) {
      fs.cpSync(srcMod, destMod, { recursive: true });
      log(`  Copiado unpacked: node_modules/${mod}`);
    } else {
      log(`  ADVERTENCIA: node_modules/${mod} no encontrado en app/`);
    }
  }

  // Reemplazar con las versiones modificadas
  for (const rel of PATCHED_FILES) {
    const src = path.join(APP_ROOT, rel);
    const dest = path.join(TEMP_DIR, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    log(`Reemplazado: ${rel}`);
  }

  // Empaquetar con directiva unpackDir para que jszip y similares queden en app.asar.unpacked/
  const tempOutput = OUTPUT_ASAR + ".patching";
  const unpackOpts = unpackedMods.length
    ? { unpackDir: unpackedMods.length === 1 ? `node_modules/${unpackedMods[0]}` : `node_modules/{${unpackedMods.join(",")}}` }
    : {};
  log(`Empaquetando nuevo asar${unpackedMods.length ? ` (unpackDir: node_modules/${unpackedMods.join(", ")})` : ""}...`);
  await asar.createPackageWithOptions(TEMP_DIR, tempOutput, unpackOpts);
  log(`Reemplazando app.asar...`);
  fs.renameSync(tempOutput, OUTPUT_ASAR);

  const newSize = (fs.statSync(OUTPUT_ASAR).size / 1024 / 1024).toFixed(1);
  log(`app.asar actualizado: ${newSize} MB`);

  // Verificar los archivos parcheados en el nuevo asar
  log("Verificando parches...");
  for (const rel of PATCHED_FILES) {
    const content = asar.extractFile(OUTPUT_ASAR, rel).toString("utf8");
    log(`  ${rel}: ${content.split("\n").length} líneas OK`);
  }

  // Limpiar temp
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  log("Directorio temporal eliminado.");
  log("PATCH COMPLETADO EXITOSAMENTE.");
}

function collectFiles(node, prefix) {
  const result = [];
  for (const [name, entry] of Object.entries(node.files || {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      result.push(...collectFiles(entry, rel));
    } else if (entry.offset !== undefined) {
      result.push(rel);
    }
  }
  return result;
}

main().catch((err) => { console.error("[patch-asar] ERROR:", err.message); process.exit(1); });
