"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Diff unificado local (sin deps de pago).
 * Archivos grandes: emite hunks reales paginables (no solo @@ resumen @@).
 */
function splitLines(text = "") {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

function pushHunk(lines, startA, countA, startB, countB, hunkLines) {
  if (!hunkLines.length) return;
  lines.push(`@@ -${startA},${Math.max(0, countA)} +${startB},${Math.max(0, countB)} @@`);
  lines.push(...hunkLines);
}

/**
 * Myers-lite por ventanas: emite multiples hunks parseables por hunk-review.
 */
function buildUnifiedDiff(filePath, before, after, { context = 2, maxLines = 400, maxHunks = 80 } = {}) {
  const a = splitLines(before);
  const b = splitLines(after);
  const rel = String(filePath || "file").replace(/\\/g, "/");
  const lines = [`--- a/${rel}`, `+++ b/${rel}`];

  let i = 0;
  let j = 0;
  let hunkCount = 0;
  const totalBudget = Math.max(80, Number(maxLines) || 400);
  let emittedBody = 0;

  while ((i < a.length || j < b.length) && hunkCount < maxHunks && emittedBody < totalBudget) {
    while (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    }
    if (i >= a.length && j >= b.length) break;

    const changeStartI = i;
    const changeStartJ = j;
    const hunkLines = [];
    const ctxStartI = Math.max(0, changeStartI - context);
    const ctxStartJ = Math.max(0, changeStartJ - context);
    for (let c = ctxStartI; c < changeStartI; c += 1) hunkLines.push(` ${a[c]}`);

    let oldCount = changeStartI - ctxStartI;
    let newCount = changeStartJ - ctxStartJ;

    while ((i < a.length || j < b.length) && hunkLines.length < 120) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        // context after change
        let same = 0;
        while (i + same < a.length && j + same < b.length && a[i + same] === b[j + same] && same < context + 2) {
          same += 1;
        }
        if (same >= context + 1) {
          for (let k = 0; k < context && k < same; k += 1) {
            hunkLines.push(` ${a[i + k]}`);
            oldCount += 1;
            newCount += 1;
          }
          i += context;
          j += context;
          break;
        }
      }
      if (i < a.length && (j >= b.length || a[i] !== b[j])) {
        // deletion or replace: prefer consume unmatched from a until sync or b-only
        if (j < b.length && a[i] !== b[j]) {
          // try look-ahead match
          const ai = a[i];
          const bj = b[j];
          const aInB = b.slice(j, j + 40).indexOf(ai);
          const bInA = a.slice(i, i + 40).indexOf(bj);
          if (aInB === -1 && bInA >= 0) {
            hunkLines.push(`-${a[i]}`);
            oldCount += 1;
            i += 1;
            continue;
          }
          if (bInA === -1 && aInB >= 0) {
            hunkLines.push(`+${b[j]}`);
            newCount += 1;
            j += 1;
            continue;
          }
          hunkLines.push(`-${a[i]}`);
          hunkLines.push(`+${b[j]}`);
          oldCount += 1;
          newCount += 1;
          i += 1;
          j += 1;
          continue;
        }
        hunkLines.push(`-${a[i]}`);
        oldCount += 1;
        i += 1;
        continue;
      }
      if (j < b.length) {
        hunkLines.push(`+${b[j]}`);
        newCount += 1;
        j += 1;
      }
    }

    pushHunk(lines, ctxStartI + 1, oldCount, ctxStartJ + 1, newCount, hunkLines);
    hunkCount += 1;
    emittedBody += hunkLines.length;
  }

  if (i < a.length || j < b.length) {
    lines.push(`@@ -${i + 1},${a.length - i} +${j + 1},${b.length - j} @@`);
    lines.push(`- … ${a.length - i} lineas restantes omitidas (pide pagina siguiente de hunks)`);
    lines.push(`+ … ${b.length - j} lineas restantes omitidas (pide pagina siguiente de hunks)`);
  }

  const text = lines.join("\n");
  return text.length > 48_000 ? `${text.slice(0, 48_000)}\n…` : text;
}

function readProjectFileSafe(projectRoot, relativePath) {
  try {
    const full = path.join(String(projectRoot || ""), ...String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean));
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return "";
    return fs.readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

function buildMutationDiff(projectRoot, name, input = {}) {
  const rel = String(input.path || "").replace(/\\/g, "/");
  if (!rel) return "";
  const before = readProjectFileSafe(projectRoot, rel);
  let after = before;
  if (name === "write_file") {
    after = String(input.content ?? "");
  } else if (name === "replace_in_file") {
    const oldText = String(input.oldText || "");
    const newText = String(input.newText || "");
    if (!oldText) return "";
    after = input.replaceAll === true
      ? before.split(oldText).join(newText)
      : before.replace(oldText, newText);
  } else {
    return "";
  }
  if (before === after) return `(sin cambios netos en ${rel})`;
  return buildUnifiedDiff(rel, before, after);
}

const pendingDiffs = new Map();

function proposeDiff(projectRoot, input = {}) {
  const rel = String(input.path || "").replace(/\\/g, "/").trim();
  if (!rel || rel.includes("..")) throw new Error("propose_diff requiere path relativo valido.");
  const before = readProjectFileSafe(projectRoot, rel);
  let after = before;
  if (input.content != null) after = String(input.content);
  else if (input.oldText != null) {
    const oldText = String(input.oldText);
    const newText = String(input.newText ?? "");
    if (!before.includes(oldText)) throw new Error("oldText no existe en el archivo.");
    after = input.replaceAll === true ? before.split(oldText).join(newText) : before.replace(oldText, newText);
  } else {
    throw new Error("propose_diff requiere content o oldText/newText.");
  }
  const id = `diff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const diff = buildUnifiedDiff(rel, before, after);
  let hunks = [];
  try {
    const { parseUnifiedHunks } = require("./hunk-review");
    hunks = parseUnifiedHunks(diff).map((h) => ({
      id: h.id,
      text: String(h.text || "").slice(0, 4000),
      status: "pending",
      oldStart: h.oldStart,
      newStart: h.newStart,
    }));
  } catch {
    hunks = [];
  }
  pendingDiffs.set(id, {
    id,
    projectRoot: String(projectRoot || ""),
    path: rel,
    before,
    after,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    proposalId: id,
    path: rel,
    diff,
    hunks,
    bytesBefore: Buffer.byteLength(before, "utf8"),
    bytesAfter: Buffer.byteLength(after, "utf8"),
    note: "Revisa el diff/hunks. Usa apply_diff con proposalId para aplicar, o autoriza en la tarjeta de permiso.",
  };
}

function proposeDiffBatch(projectRoot, files = []) {
  const rows = Array.isArray(files) ? files : [];
  const results = [];
  for (const file of rows.slice(0, 20)) {
    results.push(proposeDiff(projectRoot, file));
  }
  return { ok: true, count: results.length, proposals: results };
}

function applyDiff(projectRoot, input = {}, { writeFile } = {}) {
  const id = String(input.proposalId || input.id || "").trim();
  const pending = pendingDiffs.get(id);
  if (!pending) throw new Error("proposalId desconocido o ya aplicado.");
  if (path.resolve(pending.projectRoot) !== path.resolve(String(projectRoot || ""))) {
    throw new Error("El diff pertenece a otro proyecto.");
  }
  if (typeof writeFile !== "function") throw new Error("writeFile no disponible.");
  const writeResult = writeFile(pending.path, pending.after);
  pendingDiffs.delete(id);
  return {
    ok: true,
    path: pending.path,
    proposalId: id,
    applied: true,
    backupPath: writeResult?.backupPath || "",
    created: writeResult?.created === true,
  };
}

function getPendingDiff(id) {
  return pendingDiffs.get(String(id || "")) || null;
}

module.exports = {
  buildUnifiedDiff,
  buildMutationDiff,
  proposeDiff,
  proposeDiffBatch,
  applyDiff,
  getPendingDiff,
  readProjectFileSafe,
  splitLines,
};
