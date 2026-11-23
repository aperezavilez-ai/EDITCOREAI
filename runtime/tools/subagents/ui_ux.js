"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

async function runUiUxSubagent({ projectRoot, target = ".", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Inspección UI/UX cancelada.", steps: [] };
  }

  const reports = [];
  const uiFiles = [];

  // 1. Detectar Tailwind, CSS, PostCSS
  for (const rel of ["tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "styles.css", "src/index.css", "app/globals.css"]) {
    if (fs.existsSync(path.join(projectRoot, rel))) {
      uiFiles.push(rel);
      reports.push(`- **Estilos detectados**: \`${rel}\``);
    }
  }

  // 2. Componentes UI en target
  const list = tools.listFiles(projectRoot, target);
  const componentCandidates = (list.files || []).filter((f) => /\.(jsx|tsx|vue|svelte|css|html)$/i.test(f)).slice(0, 20);

  if (componentCandidates.length) {
    reports.push(`- **Componentes encontrados en ${target}**: ${componentCandidates.length} archivo(s).`);
  }

  const summary = [
    `## Diagnóstico de Interfaz, Estilos y UI/UX (${target})`,
    reports.length ? reports.join("\n") : "- Sin archivos de estilo o componentes en el alcance evaluado.",
    componentCandidates.length ? `\n### Componentes inspeccionados:\n${componentCandidates.map((f) => `- ${f}`).join("\n")}` : "",
    memoryContext ? `\n### Contexto compartido:\n${String(memoryContext).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");

  return { ok: true, summary, report: summary, componentsCount: componentCandidates.length };
}

module.exports = { runUiUxSubagent };
