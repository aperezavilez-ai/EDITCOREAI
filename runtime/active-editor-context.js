"use strict";

/**
 * ACTIVE EDITOR CONTEXT — inyección de archivo activo / selección (MVP Cursor-like)
 * Fase IDE-A
 *
 * El renderer/preload debe pasar en input del chat:
 *   activeFile, selection, openFiles, cursorLine
 */

function buildActiveEditorPrompt(ctx = {}) {
  const activeFile = String(ctx.activeFile || ctx.currentFile || ctx.path || "").trim();
  const selection = String(ctx.selection || ctx.selectedText || "").trim();
  const openFiles = Array.isArray(ctx.openFiles)
    ? ctx.openFiles.map(String).filter(Boolean).slice(0, 12)
    : [];
  const cursorLine = ctx.cursorLine || ctx.line || null;
  const language = ctx.language || ctx.lang || null;

  if (!activeFile && !selection && !openFiles.length) return "";

  const lines = ["[CONTEXTO DEL EDITOR — archivo activo]"];
  if (activeFile) {
    lines.push(`Archivo activo: ${activeFile}${cursorLine ? ` (línea ~${cursorLine})` : ""}`);
  }
  if (language) lines.push(`Lenguaje: ${language}`);
  if (openFiles.length) {
    lines.push(`Pestañas abiertas: ${openFiles.join(", ")}`);
  }
  if (selection) {
    const clipped =
      selection.length > 6000
        ? selection.slice(0, 5000) + "\n…[selección truncada]…\n" + selection.slice(-800)
        : selection;
    lines.push("Selección del usuario:");
    lines.push("```");
    lines.push(clipped);
    lines.push("```");
    lines.push("Prioriza esta selección si el pedido es local (refactor, explicar, arreglar).");
  } else if (activeFile) {
    lines.push("No hay selección: si el pedido es local, lee el archivo activo antes de editar.");
  }
  lines.push("No inventes paths distintos al activo salvo que la tarea lo pida.");
  return lines.join("\n");
}

/**
 * Extrae contexto desde el objeto input del orchestrator/handleChat.
 */
function extractEditorContext(input = {}) {
  return {
    activeFile:
      input.activeFile ||
      input.currentFile ||
      input.editorPath ||
      input.helpers?.activeFile ||
      input.context?.activeFile ||
      "",
    selection:
      input.selection ||
      input.selectedText ||
      input.helpers?.selection ||
      input.context?.selection ||
      "",
    openFiles:
      input.openFiles ||
      input.helpers?.openFiles ||
      input.context?.openFiles ||
      [],
    cursorLine: input.cursorLine || input.line || input.helpers?.cursorLine || null,
    language: input.language || input.helpers?.language || null,
  };
}

module.exports = {
  buildActiveEditorPrompt,
  extractEditorContext,
};
