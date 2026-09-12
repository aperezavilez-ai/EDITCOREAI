"use strict";

/**
 * Memoria de aprendizaje continuo global (cross-project).
 * Persistencia: ~/.editcore/global_memory.json
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_ENTRIES = 120;
const PROMPT_CAP = 8;

function globalMemoryPath() {
  return path.join(os.homedir(), ".editcore", "global_memory.json");
}

function emptyStore() {
  return {
    version: 1,
    updatedAt: null,
    solutions: [],
  };
}

function loadGlobalMemory() {
  const file = globalMemoryPath();
  try {
    if (!fs.existsSync(file)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return emptyStore();
    const solutions = Array.isArray(raw.solutions) ? raw.solutions : [];
    return {
      version: Number(raw.version) || 1,
      updatedAt: raw.updatedAt || null,
      solutions,
    };
  } catch {
    return emptyStore();
  }
}

function saveGlobalMemory(store) {
  const file = globalMemoryPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    solutions: Array.isArray(store?.solutions) ? store.solutions.slice(-MAX_ENTRIES) : [],
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return payload;
}

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function classifyErrorType(raw) {
  const text = String(raw || "");
  if (/error TS\d+|TypeScript error|TS\d{4}/i.test(text)) return "typescript";
  if (/Failed to compile|Build error|ELIFECYCLE|next build|webpack/i.test(text)) return "compile";
  if (/ENOENT|Cannot find module|Module not found/i.test(text)) return "module-missing";
  if (/\.env|env\.local|missing.*(key|var)|supabase/i.test(text)) return "config-env";
  if (/tsconfig|next-env|routes\.d\.ts|types stub/i.test(text)) return "config-types";
  if (/EADDRINUSE|port/i.test(text)) return "runtime-port";
  return "generic";
}

/**
 * Registra un par { tipoError, solucionAplicada } tras un arreglo exitoso del VERIFIER.
 */
function recordSolution({ tipoError, solucionAplicada, errorExcerpt, projectHint, source } = {}) {
  const solucion = String(solucionAplicada || "").trim().slice(0, 1200);
  const tipo = String(tipoError || classifyErrorType(errorExcerpt) || "generic").trim().slice(0, 80);
  if (!solucion) return { ok: false, error: "solucionAplicada vacía" };

  const store = loadGlobalMemory();
  const key = `${tipo}::${normalizeKey(solucion)}`;
  const existingIdx = store.solutions.findIndex((s) => `${s.tipoError}::${normalizeKey(s.solucionAplicada)}` === key);
  const entry = {
    tipoError: tipo,
    solucionAplicada: solucion,
    errorExcerpt: String(errorExcerpt || "").slice(0, 500) || undefined,
    projectHint: String(projectHint || "").slice(0, 200) || undefined,
    source: String(source || "verifier").slice(0, 40),
    hits: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    const prev = store.solutions[existingIdx];
    store.solutions[existingIdx] = {
      ...prev,
      ...entry,
      hits: Number(prev.hits || 1) + 1,
      createdAt: prev.createdAt || entry.createdAt,
    };
  } else {
    store.solutions.push(entry);
  }

  saveGlobalMemory(store);
  return { ok: true, tipoError: tipo, total: store.solutions.length };
}

function scoreEntry(entry, query) {
  const q = normalizeKey(query);
  if (!q) return Number(entry.hits || 1);
  const blob = normalizeKey(`${entry.tipoError} ${entry.solucionAplicada} ${entry.errorExcerpt || ""}`);
  let score = Number(entry.hits || 1);
  const tokens = q.split(/[^a-z0-9áéíóúñ._-]+/i).filter((t) => t.length > 2);
  for (const t of tokens) {
    if (blob.includes(t)) score += 3;
  }
  if (entry.tipoError && q.includes(String(entry.tipoError).toLowerCase())) score += 5;
  return score;
}

/**
 * Soluciones relevantes para inyectar en el system prompt.
 */
function getRelevantSolutions(query = "", limit = PROMPT_CAP) {
  const store = loadGlobalMemory();
  const ranked = [...store.solutions]
    .map((s) => ({ ...s, _score: scoreEntry(s, query) }))
    .sort((a, b) => b._score - a._score || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, Math.max(1, Math.min(limit, 20)));
  return ranked.map(({ _score, ...rest }) => rest);
}

function promptBlock(query = "", limit = PROMPT_CAP) {
  const items = getRelevantSolutions(query, limit);
  if (!items.length) return "";
  const lines = items.map((s, i) => {
    const tipo = s.tipoError || "generic";
    const sol = String(s.solucionAplicada || "").replace(/\s+/g, " ").slice(0, 220);
    return `${i + 1}. [${tipo}] ${sol}`;
  });
  return [
    "[MEMORIA GLOBAL APRENDIDA — soluciones previas del VERIFIER en otros proyectos]",
    "Reutiliza estas soluciones si el error actual es similar:",
    ...lines,
  ].join("\n");
}

function listSolutions(limit = 30) {
  const store = loadGlobalMemory();
  return {
    ok: true,
    path: globalMemoryPath(),
    total: store.solutions.length,
    solutions: store.solutions.slice(-limit).reverse(),
  };
}

module.exports = {
  globalMemoryPath,
  loadGlobalMemory,
  saveGlobalMemory,
  recordSolution,
  classifyErrorType,
  getRelevantSolutions,
  promptBlock,
  listSolutions,
};
