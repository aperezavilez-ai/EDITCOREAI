"use strict";

/**
 * Motor de Diffs interactivos Hunk por Hunk para Monaco Editor tipo Cursor AI.
 * Permite calcular bloques de cambios, renderizar decoraciones y aceptar/rechazar por bloque.
 */

function computeLineDiffHunks(originalText = "", newText = "") {
  const origLines = String(originalText || "").split("\n");
  const newLines = String(newText || "").split("\n");

  const hunks = [];
  let origIdx = 0;
  let newIdx = 0;
  let hunkCounter = 1;

  // Algoritmo simplificado de coincidencia línea por línea
  while (origIdx < origLines.length || newIdx < newLines.length) {
    if (origIdx < origLines.length && newIdx < newLines.length && origLines[origIdx] === newLines[newIdx]) {
      origIdx++;
      newIdx++;
      continue;
    }

    const startOrig = origIdx;
    const startNew = newIdx;

    // Buscar el siguiente punto de sincronización (ventana de 10 líneas)
    let syncOrig = -1;
    let syncNew = -1;

    for (let o = origIdx; o < Math.min(origLines.length, origIdx + 15); o++) {
      for (let n = newIdx; n < Math.min(newLines.length, newIdx + 15); n++) {
        if (origLines[o] === newLines[n] && (o > origIdx || n > newIdx)) {
          syncOrig = o;
          syncNew = n;
          break;
        }
      }
      if (syncOrig !== -1) break;
    }

    if (syncOrig === -1 || syncNew === -1) {
      // Todo el resto es un bloque de cambio
      const origChunk = origLines.slice(origIdx);
      const newChunk = newLines.slice(newIdx);
      hunks.push({
        id: `hunk_${hunkCounter++}`,
        startLineNumber: origIdx + 1,
        endLineNumber: origLines.length,
        originalLines: origChunk,
        newLines: newChunk,
        type: origChunk.length === 0 ? "insert" : (newChunk.length === 0 ? "delete" : "replace"),
        status: "pending", // pending | accepted | rejected
      });
      break;
    } else {
      const origChunk = origLines.slice(origIdx, syncOrig);
      const newChunk = newLines.slice(newIdx, syncNew);
      hunks.push({
        id: `hunk_${hunkCounter++}`,
        startLineNumber: origIdx + 1,
        endLineNumber: syncOrig,
        originalLines: origChunk,
        newLines: newChunk,
        type: origChunk.length === 0 ? "insert" : (newChunk.length === 0 ? "delete" : "replace"),
        status: "pending",
      });
      origIdx = syncOrig;
      newIdx = syncNew;
    }
  }

  return hunks;
}

/**
 * Aplica un hunk específico sobre el texto original.
 */
function applyHunkToText(originalText = "", hunk = {}) {
  const origLines = String(originalText || "").split("\n");
  const start = Math.max(0, hunk.startLineNumber - 1);
  const deleteCount = hunk.originalLines ? hunk.originalLines.length : 0;
  const insertLines = Array.isArray(hunk.newLines) ? hunk.newLines : [];

  origLines.splice(start, deleteCount, ...insertLines);
  return origLines.join("\n");
}

/**
 * Aplica todos los hunks aceptados sobre el texto original.
 */
function applyAcceptedHunks(originalText = "", hunks = []) {
  let resultLines = String(originalText || "").split("\n");
  // Orden inverso para no desfasar números de línea
  const sortedHunks = [...hunks].sort((a, b) => b.startLineNumber - a.startLineNumber);

  for (const hunk of sortedHunks) {
    if (hunk.status === "accepted" || hunk.status === "pending") {
      const start = Math.max(0, hunk.startLineNumber - 1);
      const deleteCount = hunk.originalLines ? hunk.originalLines.length : 0;
      const insertLines = Array.isArray(hunk.newLines) ? hunk.newLines : [];
      resultLines.splice(start, deleteCount, ...insertLines);
    }
  }

  return resultLines.join("\n");
}

/**
 * Genera decoraciones CSS de Monaco para pintar las líneas agregadas/eliminadas.
 */
function formatMonacoDecorations(hunks = []) {
  const decorations = [];

  for (const hunk of hunks) {
    if (hunk.status === "rejected") continue;

    if (hunk.type === "insert" || hunk.type === "replace") {
      decorations.push({
        range: {
          startLineNumber: hunk.startLineNumber,
          startColumn: 1,
          endLineNumber: hunk.startLineNumber + (hunk.newLines?.length || 1) - 1,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "monaco-diff-line-inserted",
          glyphMarginClassName: "monaco-diff-glyph-inserted",
          hoverMessage: { value: `**Cambio de EditCore** (${hunk.id}): Aceptar (Ctrl+Enter) / Rechazar (Ctrl+Backspace)` },
        },
      });
    }

    if (hunk.type === "delete") {
      decorations.push({
        range: {
          startLineNumber: hunk.startLineNumber,
          startColumn: 1,
          endLineNumber: hunk.endLineNumber || hunk.startLineNumber,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "monaco-diff-line-deleted",
          glyphMarginClassName: "monaco-diff-glyph-deleted",
          hoverMessage: { value: `**Eliminación de EditCore** (${hunk.id})` },
        },
      });
    }
  }

  return decorations;
}

module.exports = {
  computeLineDiffHunks,
  applyHunkToText,
  applyAcceptedHunks,
  formatMonacoDecorations,
};
