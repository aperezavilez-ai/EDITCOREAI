"use strict";

/**
 * Estado de scaffold greenfield (etapas idempotentes).
 * Archivo: <project>/.editcore/scaffold-state.json
 */

const fs = require("node:fs");
const path = require("node:path");

const STAGES = ["created", "files", "install", "env", "verify", "completed"];

function scaffoldStatePath(projectRoot = "") {
  return path.join(String(projectRoot || ""), ".editcore", "scaffold-state.json");
}

function defaultState(partial = {}) {
  return {
    version: 1,
    template: String(partial.template || ""),
    stage: String(partial.stage || "created"),
    completedStages: Array.isArray(partial.completedStages) ? partial.completedStages : [],
    files: Array.isArray(partial.files) ? partial.files : [],
    updatedAt: new Date().toISOString(),
    incomplete: partial.incomplete !== false,
    note: String(partial.note || ""),
  };
}

function readScaffoldState(projectRoot = "") {
  const file = scaffoldStatePath(projectRoot);
  try {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return defaultState(data);
  } catch {
    return null;
  }
}

function writeScaffoldState(projectRoot = "", partial = {}) {
  const root = String(projectRoot || "");
  if (!root) throw new Error("projectRoot requerido");
  const dir = path.join(root, ".editcore");
  fs.mkdirSync(dir, { recursive: true });
  const prev = readScaffoldState(root) || defaultState();
  const next = defaultState({
    ...prev,
    ...partial,
    completedStages: Array.isArray(partial.completedStages)
      ? partial.completedStages
      : prev.completedStages,
    files: Array.isArray(partial.files) ? partial.files : prev.files,
  });
  if (next.stage === "completed") {
    next.incomplete = false;
    next.completedStages = [...new Set([...next.completedStages, ...STAGES])];
  } else if (!next.completedStages.includes(next.stage)) {
    next.completedStages = [...new Set([...next.completedStages, next.stage])];
  }
  fs.writeFileSync(scaffoldStatePath(root), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function isScaffoldIncomplete(projectRoot = "", { entryCount = null } = {}) {
  const state = readScaffoldState(projectRoot);
  if (state) return state.incomplete === true && state.stage !== "completed";
  // Fallback legado: pocos archivos visibles.
  if (Number.isFinite(Number(entryCount))) return Number(entryCount) > 0 && Number(entryCount) < 8;
  return false;
}

function nextScaffoldStage(projectRoot = "") {
  const state = readScaffoldState(projectRoot) || defaultState({ stage: "created", incomplete: true });
  const idx = STAGES.indexOf(state.stage);
  if (idx < 0) return "files";
  if (idx >= STAGES.length - 1) return "completed";
  return STAGES[idx + 1];
}

module.exports = {
  STAGES,
  scaffoldStatePath,
  readScaffoldState,
  writeScaffoldState,
  isScaffoldIncomplete,
  nextScaffoldStage,
};
