"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_PATCHES = 5;
const BLOCKED = /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;

function isBlockedPath(rel = "") {
  const normalized = String(rel || "").replace(/\\/g, "/").trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) return true;
  if (/(?:^|\/)(?:node_modules|\.git|release-275|win-unpacked)(?:\/|$)/i.test(normalized)) return true;
  return BLOCKED.test(normalized);
}

/**
 * Implementer acotado local:
 * - max 5 archivos
 * - sin secretos / node_modules
 * - escribe solo si ctx.applyWrite / applyReplace existen
 */
async function runBoundedImplement(projectRoot, input = {}, ctx = {}) {
  const task = String(input.task || input.goal || input.query || "").trim();
  const patches = Array.isArray(input.patches) ? input.patches.slice(0, MAX_PATCHES) : [];
  if (!patches.length) {
    return {
      ok: false,
      blocked: false,
      mode: "bounded-implementer",
      message: "run_subagent implementer requiere patches[{path, content}] o [{path, oldText, newText}] (max 5).",
      task,
      maxFiles: MAX_PATCHES,
    };
  }

  const applied = [];
  for (const patch of patches) {
    const rel = String(patch?.path || "").replace(/\\/g, "/").trim();
    if (isBlockedPath(rel)) {
      applied.push({ path: rel, ok: false, error: "Ruta bloqueada por politica del sub-agente." });
      continue;
    }
    const absolute = path.join(String(projectRoot || ""), ...rel.split("/"));
    try {
      if (patch.content != null) {
        if (typeof ctx.applyWrite !== "function") {
          applied.push({
            path: rel,
            ok: false,
            planned: true,
            mode: "write",
            bytes: Buffer.byteLength(String(patch.content), "utf8"),
            note: "Sin applyWrite en este contexto; el agente principal debe aplicar el patch.",
          });
          continue;
        }
        await ctx.applyWrite(rel, String(patch.content));
        applied.push({ path: rel, ok: true, mode: "write" });
        continue;
      }
      if (patch.oldText != null && patch.newText != null) {
        if (typeof ctx.applyReplace !== "function") {
          if (!fs.existsSync(absolute)) {
            applied.push({ path: rel, ok: false, error: "Archivo no existe para replace planificado." });
            continue;
          }
          applied.push({
            path: rel,
            ok: false,
            planned: true,
            mode: "replace",
            note: "Sin applyReplace; el agente principal debe usar replace_in_file.",
          });
          continue;
        }
        await ctx.applyReplace(rel, String(patch.oldText), String(patch.newText), patch.replaceAll === true);
        applied.push({ path: rel, ok: true, mode: "replace" });
        continue;
      }
      applied.push({ path: rel, ok: false, error: "Patch sin content ni oldText/newText." });
    } catch (error) {
      applied.push({ path: rel, ok: false, error: String(error?.message || error).slice(0, 300) });
    }
  }

  const okCount = applied.filter((row) => row.ok).length;
  return {
    ok: okCount > 0,
    mode: "bounded-implementer",
    write: okCount > 0,
    task,
    maxFiles: MAX_PATCHES,
    applied,
    note: "Sub-agente implementer acotado (max 5 archivos, sin secretos). Cambios mayores siguen en el agente principal.",
  };
}

module.exports = {
  MAX_PATCHES,
  isBlockedPath,
  runBoundedImplement,
};
