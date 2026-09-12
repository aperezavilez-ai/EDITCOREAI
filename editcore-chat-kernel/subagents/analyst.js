"use strict";

const tools = require("../tools");

function loadMap() {
  try {
    return require("../../runtime/project-map");
  } catch {
    return null;
  }
}

async function runAnalyst({ projectRoot, onProgress, maxReads = 8 }) {
  const steps = [];
  let readCount = 0;
  const mapApi = loadMap();
  let cognitive = null;
  try {
    cognitive = mapApi?.ensureProjectMap?.(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null;
  } catch {
    cognitive = null;
  }

  const rootList = tools.listFiles(projectRoot, ".");
  steps.push({ name: "list_files", input: { path: "." }, result: rootList, ok: rootList.ok });

  const importantFiles = [
    ...(cognitive?.entrypoints || []),
    "package.json", "README.md", "index.js", "main.js",
  ];
  // Solo archivos que existen en la raíz listada o en el mapa (nunca src/ inventado).
  const listed = new Set((rootList.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const mapFiles = new Set((cognitive?.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const foundToRead = [...new Set(importantFiles)]
    .filter((f) => listed.has(f) || mapFiles.has(f))
    .slice(0, maxReads);

  for (const file of foundToRead) {
    if (readCount >= maxReads) break;
    onProgress?.({ phase: "tool", name: "read_file", input: { path: file } });
    const contentRes = tools.readFile(projectRoot, file, 4000);
    steps.push({ name: "read_file", input: { path: file }, result: contentRes, ok: contentRes.ok });
    readCount++;
  }

  const report = [
    "# Diagnóstico Corto del Proyecto",
    `- Archivos escaneados: ${readCount}`,
    `- Raíz analizada: ${projectRoot}`,
    cognitive?.rootDirs?.length
      ? `- Carpetas raíz (mapa): ${cognitive.rootDirs.slice(0, 20).join(", ")}`
      : "",
    cognitive?.stack?.length ? `- Stack: ${cognitive.stack.join(", ")}` : "",
    "",
    "## Plan de Acción Recomendado",
    "1. Revisar los módulos listados en el mapa cognitivo.",
    "2. Ejecutar correcciones específicas vía comandos EXECUTE.",
  ].filter(Boolean).join("\n");

  return { report, steps };
}

module.exports = { runAnalyst };
