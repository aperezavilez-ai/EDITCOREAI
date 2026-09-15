"use strict";

/**
 * Parseo de hunks unificados en el renderer.
 * Debe coincidir con runtime/hunk-review.js (mismas ids h1, h2… e islas).
 */
(function initLiveHunks(global) {
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

    // Misma lógica que runtime/hunk-review.js: 1 @@ con varios bloques → islas.
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
          additions: h.lines.filter((l) => l.startsWith("+")).length,
          deletions: h.lines.filter((l) => l.startsWith("-")).length,
          summary: h.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, 6).join("\n"),
        }));
      }
    }

    return hunks.map((h) => ({
      ...h,
      additions: h.lines.filter((l) => l.startsWith("+")).length,
      deletions: h.lines.filter((l) => l.startsWith("-")).length,
      summary: h.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, 6).join("\n"),
    }));
  }

  function gutterMarksFromDiff(unifiedDiff = "") {
    const marks = [];
    const hunks = parseUnifiedHunks(unifiedDiff);
    for (const hunk of hunks) {
      let newLine = hunk.newStart;
      for (const line of hunk.lines) {
        if (line.startsWith(" ")) {
          newLine += 1;
        } else if (line.startsWith("+")) {
          marks.push({ line: newLine, kind: "add" });
          newLine += 1;
        } else if (line.startsWith("-")) {
          marks.push({ line: Math.max(1, newLine), kind: "del" });
        }
      }
    }
    return marks;
  }

  global.EditCoreLiveHunks = {
    parseUnifiedHunks,
    gutterMarksFromDiff,
  };
})(typeof window !== "undefined" ? window : globalThis);
