"use strict";

const tools = require("../tools");

async function runAnalyst({ projectRoot, onProgress, maxReads = 8 }) {
  const steps = [];
  let readCount = 0;

  const rootList = tools.listFiles(projectRoot, ".");
  steps.push({ name: "list_files", input: { path: "." }, result: rootList, ok: rootList.ok });

  const importantFiles = ["package.json", "README.md", "index.js", "main.js", "src/index.js", "src/main.js"];
  const foundToRead = (rootList.files || []).filter((f) => importantFiles.includes(f));

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
    "",
    "## Plan de Acción Recomendado",
    "1. Revisar los módulos listados.",
    "2. Ejecutar correcciones específicas vía comandos EXECUTE.",
  ].join("\n");

  return { report, steps };
}

module.exports = { runAnalyst };