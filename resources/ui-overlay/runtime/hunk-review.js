"use strict";

/**
 * Parseo y aplicacion de hunks de diff unificado (Accept/Reject parcial).
 */

function splitLines(text = "") {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

function parseUnifiedHunks(diffText = "") {
  const lines = String(diffText || "").split("\n");
  const hunks = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (header) {
      if (current) hunks.push(current);
      current = {
        id: `h${hunks.length + 1}`,
        oldStart: Number(header[1]),
        oldCount: Number(header[2] || 1),
        newStart: Number(header[3]),
        newCount: Number(header[4] || 1),
        lines: [],
        text: line,
      };
      continue;
    }
    if (!current) continue;
    if (/^--- |^\+\+\+ /.test(line)) continue;
    current.lines.push(line);
    current.text += `\n${line}`;
  }
  if (current) hunks.push(current);

  // Si solo hay 1 @@ pero varios bloques de cambio, partir en islas.
  if (hunks.length === 1 && hunks[0].lines.filter((l) => l.startsWith("+") || l.startsWith("-")).length >= 4) {
    const source = hunks[0];
    const islands = [];
    let island = null;
    let oldCursor = source.oldStart;
    let newCursor = source.newStart;
    const pushIsland = () => {
      if (!island || !island.lines.some((l) => l.startsWith("+") || l.startsWith("-"))) return;
      islands.push(island);
      island = null;
    };
    for (const line of source.lines) {
      if (line.startsWith(" ")) {
        if (island && island.lines.some((l) => l.startsWith("+") || l.startsWith("-"))) {
          // context after changes closes island if already has changes and we see 2+ context
          island.contextAfter = (island.contextAfter || 0) + 1;
          island.lines.push(line);
          if (island.contextAfter >= 2) {
            oldCursor += 1;
            newCursor += 1;
            pushIsland();
            continue;
          }
        }
        oldCursor += 1;
        newCursor += 1;
        continue;
      }
      if (!island) {
        island = {
          id: `h${islands.length + 1}`,
          oldStart: oldCursor,
          newStart: newCursor,
          lines: [],
          text: `@@ -${oldCursor} +${newCursor} @@`,
          contextAfter: 0,
        };
      }
      island.lines.push(line);
      island.text += `\n${line}`;
      if (line.startsWith("-")) oldCursor += 1;
      if (line.startsWith("+")) newCursor += 1;
    }
    pushIsland();
    if (islands.length > 1) {
      return islands.map((h) => ({
        ...h,
        summary: h.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, 6).join("\n"),
      }));
    }
  }

  return hunks.map((h) => ({
    ...h,
    summary: h.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, 6).join("\n"),
  }));
}

/**
 * Reconstruye el contenido final a partir de before + decisiones por hunk.
 * Hunks rejected → se conservan lineas old del backup.
 * Hunks accepted/pending → se aplica el lado new.
 */
function applyHunkDecisions(beforeText = "", hunks = [], decisions = {}) {
  const before = splitLines(beforeText);
  // Estrategia: partir de before y aplicar solo hunks accepted (o pending=aceptar).
  // Para reject: no aplicar ese hunk.
  let result = before.slice();
  // Aplicar de atras hacia adelante para no invalidar offsets.
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of ordered) {
    const decision = String(decisions[hunk.id] || "accept").toLowerCase();
    if (decision === "reject") continue;
    const oldLines = [];
    const newLines = [];
    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        newLines.push(line.slice(1));
      }
    }
    const start = Math.max(0, (hunk.oldStart || 1) - 1);
    const removeCount = oldLines.length || hunk.oldCount || 0;
    result.splice(start, removeCount, ...newLines);
  }
  // Si el before ya era el "after" en disco (revision post-mutacion),
  // y rechazamos todos: volver a before puro.
  const allRejected = hunks.length > 0 && hunks.every((h) => String(decisions[h.id] || "").toLowerCase() === "reject");
  if (allRejected) return beforeText;
  return result.join("\n");
}

module.exports = {
  parseUnifiedHunks,
  applyHunkDecisions,
  splitLines,
};
