"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { rollbackLastChange } = require("./snapshot");

/**
 * Guardia de auto-modificación: cuando el chat edita el propio código de EditCoreAI,
 * al final del turno verifica que el arranque (main.js, preload.js, kernel) carga;
 * si no, revierte las escrituras de ese turno con sus snapshots.
 */

const APP_ROOT = path.resolve(__dirname, "..");
const ENTRIES = ["main.js", "preload.js", "editcore-chat-kernel/index.js"];
const SYNTAX_ONLY = ["renderer.js"];
const WRITE_TOOLS = new Set(["write_file", "replace_in_file"]);
const MUTATING_TOOLS = new Set([...WRITE_TOOLS, "run_command"]);

function isSelfRoot(projectRoot, appRoot = APP_ROOT) {
  if (!projectRoot) return false;
  return path.resolve(String(projectRoot)).toLowerCase() === path.resolve(appRoot).toLowerCase();
}

function syntaxError(file, source) {
  const body = source.replace(/^#!.*/, "");
  try {
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${body}\n})`, { filename: file });
    return null;
  } catch (err) {
    return String(err?.message || err);
  }
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}.cjs`, path.join(base, "index.js")]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* sigue */ }
  }
  return null;
}

function topLevelRequires(source) {
  const out = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (!/^\S/.test(line)) return;
    for (const m of line.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) out.push({ spec: m[1], line: i + 1 });
  });
  return out;
}

/**
 * Recorre el grafo de requires de nivel superior desde las entradas de arranque.
 * Devuelve los problemas que impedirían abrir la app o cargar el chat.
 */
function checkBoot(appRoot = APP_ROOT) {
  const rel = (abs) => path.relative(appRoot, abs).replace(/\\/g, "/");
  const problems = [];
  const seen = new Set();
  const queue = ENTRIES.map((e) => path.join(appRoot, e));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try { source = fs.readFileSync(file, "utf8"); } catch {
      problems.push(`${rel(file)}: no existe`);
      continue;
    }
    if (!file.endsWith(".js") && !file.endsWith(".cjs")) continue;
    const err = syntaxError(file, source);
    if (err) {
      problems.push(`${rel(file)}: error de sintaxis (${err})`);
      continue;
    }
    for (const { spec, line } of topLevelRequires(source)) {
      const target = resolveRelative(file, spec);
      if (!target) problems.push(`${rel(file)}:${line}: require("${spec}") no existe`);
      else queue.push(target);
    }
  }
  for (const e of SYNTAX_ONLY) {
    const file = path.join(appRoot, e);
    let source;
    try { source = fs.readFileSync(file, "utf8"); } catch { continue; }
    const err = syntaxError(file, source);
    if (err) problems.push(`${e}: error de sintaxis (${err})`);
  }
  return { ok: problems.length === 0, problems, checked: seen.size };
}

/**
 * Llamar al final de cada turno. Devuelve null si no aplica (otro proyecto o sin escrituras).
 */
function verifyAfterTurn(projectRoot, steps, { appRoot = APP_ROOT } = {}) {
  if (!isSelfRoot(projectRoot, appRoot)) return null;
  const list = Array.isArray(steps) ? steps : [];
  if (!list.some((s) => MUTATING_TOOLS.has(s?.name))) return null;
  const before = checkBoot(appRoot);
  if (before.ok) return { ok: true, checked: before.checked };

  const snapshotIds = list
    .filter((s) => WRITE_TOOLS.has(s?.name) && s?.result?.snapshotId)
    .map((s) => s.result.snapshotId)
    .reverse();
  const restored = new Set();
  const deleted = new Set();
  for (const id of snapshotIds) {
    const r = rollbackLastChange(appRoot, id);
    if (!r?.ok) continue;
    (r.restored || []).forEach((f) => restored.add(f));
    (r.deleted || []).forEach((f) => deleted.add(f));
  }
  const after = checkBoot(appRoot);
  return {
    ok: false,
    problems: before.problems,
    reverted: [...restored],
    deleted: [...deleted],
    stillBroken: after.ok ? [] : after.problems,
  };
}

function formatGuardNotice(guard) {
  if (!guard || guard.ok) return "";
  const lines = [
    "## Cambios revertidos para que EditCoreAI siga abriendo",
    "",
    "Este turno modificó el código de EditCoreAI y dejó el arranque roto:",
    ...guard.problems.slice(0, 8).map((p) => `- \`${p}\``),
  ];
  if (guard.reverted.length || guard.deleted.length) {
    lines.push("", "Se deshicieron automáticamente:");
    guard.reverted.forEach((f) => lines.push(`- \`${f}\` (restaurado)`));
    guard.deleted.forEach((f) => lines.push(`- \`${f}\` (creado en este turno, eliminado)`));
  }
  if (guard.stillBroken.length) {
    lines.push("", "Sigue roto (no lo cambió una escritura de este turno; revisalo antes de cerrar la app):");
    guard.stillBroken.slice(0, 8).forEach((p) => lines.push(`- \`${p}\``));
  }
  return lines.join("\n");
}

module.exports = { isSelfRoot, checkBoot, verifyAfterTurn, formatGuardNotice, APP_ROOT };
