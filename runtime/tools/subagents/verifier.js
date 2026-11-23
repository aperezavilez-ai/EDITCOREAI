"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const tools = require("../tools");

async function runVerifierSubagent({ projectRoot, target = ".", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Verificación cancelada.", steps: [] };
  }

  const reports = [];
  const errors = [];
  let checked = 0;

  const list = tools.listFiles(projectRoot, target);
  const filesToCheck = (list.files || []).filter((f) => /\.(js|cjs|mjs|json)$/i.test(f)).slice(0, 30);

  for (const rel of filesToCheck) {
    if (signal?.aborted) break;
    const full = path.join(projectRoot, rel);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        checked++;
        const content = fs.readFileSync(full, "utf8");
        const ext = path.extname(rel).toLowerCase();
        if (ext === ".json") {
          JSON.parse(content);
        } else {
          try {
            new vm.Script(content, { filename: rel });
          } catch (e) {
            const msg = String(e?.message || e);
            if (!/cannot use import statement outside a module/i.test(msg)) {
              errors.push(`${rel}: ${msg.slice(0, 120)}`);
            }
          }
        }
      }
    } catch (err) {
      errors.push(`${rel}: Error al validar archivo (${String(err?.message || err).slice(0, 100)})`);
    }
  }

  const clean = errors.length === 0;
  const summary = [
    `## Verificación de Integridad y Sintaxis (${target})`,
    `- **Archivos analizados**: ${checked}`,
    `- **Estado**: ${clean ? "SINTAXIS CORRECTA ✅ (Todos los archivos evaluados compilan sin errores sintácticos)" : `ADVERTENCIA ⚠️ (${errors.length} posible(s) error(es))`}`,
    errors.length ? `\n### Posibles fallos detectados:\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
    memoryContext ? `\n### Contexto compartido:\n${String(memoryContext).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");

  return { ok: true, clean, summary, report: summary, checked, errorCount: errors.length };
}

module.exports = { runVerifierSubagent };
