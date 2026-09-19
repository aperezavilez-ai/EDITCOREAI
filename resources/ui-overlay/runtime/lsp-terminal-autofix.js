"use strict";

const path = require("node:path");

/**
 * Módulo de Diagnósticos LSP en Vivo y Auto-Fix de Errores de Terminal tipo Cursor AI.
 */

/**
 * Normaliza y filtra marcadores de errores/advertencias de Monaco / LSP.
 */
function extractLspDiagnostics(markers = []) {
  if (!Array.isArray(markers)) return [];
  return markers
    .filter((m) => m && (m.severity === 8 || m.severity === "Error" || m.severity === 4 || m.severity === "Warning"))
    .map((m) => {
      const isError = m.severity === 8 || m.severity === "Error";
      return {
        severity: isError ? "ERROR" : "WARNING",
        message: String(m.message || "").trim(),
        file: String(m.resource?.path || m.resource || m.file || "").replace(/\\/g, "/"),
        startLine: Number(m.startLineNumber || m.line || 1),
        startColumn: Number(m.startColumn || m.column || 1),
      };
    });
}

/**
 * Construye un bloque de instrucción con los diagnósticos de compilación para el agente.
 */
function buildLspPromptNudge(diagnostics = []) {
  if (!diagnostics || !diagnostics.length) return "";
  const errors = diagnostics.filter((d) => d.severity === "ERROR");
  if (!errors.length) return "";

  const list = errors.slice(0, 10).map((e) => `- ${e.file}:${e.startLine}:${e.startColumn} → ${e.message}`).join("\n");
  return [
    "⚠️ DIAGNÓSTICOS LSP EN VIVO (ERRORES DE COMPILACIÓN DETECTADOS EN EDITOR):",
    list,
    "Corrige estos errores de tipos o sintaxis antes de cerrar la tarea.",
  ].join("\n");
}

/**
 * Analiza la salida de un comando de terminal para detectar fallos y extraer el stacktrace.
 */
function parseTerminalFailure(command = "", output = "", exitCode = 1) {
  const code = Number(exitCode ?? 0);
  const out = String(output || "").trim();
  const cmd = String(command || "").trim();

  const isFailed = code !== 0
    || /error:|failed|exception|cannot find module|syntaxerror|typeerror|compilation failed|build failed/i.test(out);

  if (!isFailed) return null;

  // Extraer archivos y líneas sospechosas del error
  const fileRegex = /(?:([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,6}):(\d+)(?::(\d+))?)/g;
  const suspectLocations = [];
  let match;
  while ((match = fileRegex.exec(out)) !== null) {
    if (!match[1].includes("node_modules")) {
      suspectLocations.push({
        file: match[1].replace(/\\/g, "/"),
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : 1,
      });
    }
  }

  // Extraer las líneas de error más relevantes (últimas 25 líneas con contexto)
  const lines = out.split("\n");
  const errorSnippet = lines.slice(-25).join("\n");

  return {
    command: cmd,
    exitCode: code,
    suspectLocations: suspectLocations.slice(0, 5),
    errorSnippet: errorSnippet.length > 3000 ? `${errorSnippet.slice(0, 3000)}\n...[truncado]` : errorSnippet,
  };
}

/**
 * Construye el payload de auto-reparación ("Corregir con EditCore").
 */
function buildTerminalAutoFixPayload(command = "", output = "", exitCode = 1, projectRoot = "") {
  const failure = parseTerminalFailure(command, output, exitCode);
  if (!failure) return null;

  const filesHint = failure.suspectLocations.length
    ? `Archivos involucrados: ${failure.suspectLocations.map((loc) => `@file:${loc.file}`).join(", ")}`
    : "";

  const prompt = [
    `El siguiente comando falló con código de salida ${failure.exitCode}:`,
    `\`\`\`bash\n$ ${failure.command}\n\`\`\``,
    `Error en terminal:`,
    `\`\`\`\n${failure.errorSnippet}\n\`\`\``,
    filesHint,
    `Analiza el error, localiza la causa raíz en el código del proyecto y aplica la corrección necesaria.`,
  ].filter(Boolean).join("\n\n");

  return {
    title: `🛠️ Corregir fallo de: ${failure.command}`,
    prompt,
    failure,
    projectRoot,
  };
}

module.exports = {
  extractLspDiagnostics,
  buildLspPromptNudge,
  parseTerminalFailure,
  buildTerminalAutoFixPayload,
};
