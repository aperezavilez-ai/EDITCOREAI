"use strict";

/**
 * Índice ligero por workspace: árbol superficial + mods recientes.
 * Evita que el agente reescanee el disco en cada turno.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SESSION_RELATIVE = path.join(".editcore", "session-state.json");
const SKIP_DIRS = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel", ".wrangler",
  ".cache", "node_modules", "dist", "build", "coverage", "out", ".editcore",
  ".editcore-patch-backups", "release",
]);
const TREE_TTL_MS = 10 * 60 * 1000;
const MAX_TREE = 64;
const MAX_MODS = 24;
const MAX_READS = 16;

function sessionPath(projectRoot) {
  return path.join(path.resolve(String(projectRoot || "")), SESSION_RELATIVE);
}

function emptyState(projectRoot = "") {
  return {
    version: 1,
    workspaceRoot: path.resolve(String(projectRoot || "")),
    updatedAt: new Date().toISOString(),
    fileTree: [],
    fileTreeAt: "",
    recentMods: [],
    recentReads: [],
    task: "",
    nextAction: "",
  };
}

function loadSessionState(projectRoot) {
  const file = sessionPath(projectRoot);
  try {
    if (!fs.existsSync(file)) return emptyState(projectRoot);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return emptyState(projectRoot);
    return {
      ...emptyState(projectRoot),
      ...raw,
      workspaceRoot: path.resolve(String(projectRoot || "")),
      fileTree: Array.isArray(raw.fileTree) ? raw.fileTree : [],
      recentMods: Array.isArray(raw.recentMods) ? raw.recentMods : [],
      recentReads: Array.isArray(raw.recentReads) ? raw.recentReads : [],
    };
  } catch {
    return emptyState(projectRoot);
  }
}

function saveSessionState(projectRoot, state = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const file = sessionPath(root);
  const next = {
    ...emptyState(root),
    ...state,
    workspaceRoot: root,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function listShallowTree(projectRoot, limit = MAX_TREE) {
  const root = path.resolve(String(projectRoot || ""));
  const rows = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return rows;
  }
  for (const entry of entries) {
    const name = String(entry.name || "");
    if (!name || SKIP_DIRS.has(name.toLowerCase())) continue;
    const kind = entry.isDirectory() ? "directory" : "file";
    rows.push({ path: kind === "directory" ? `${name}/` : name, kind });
    if (kind === "directory" && /^(src|app|lib|components|pages|public|scripts)$/i.test(name)) {
      try {
        const children = fs.readdirSync(path.join(root, name), { withFileTypes: true });
        for (const child of children.slice(0, 18)) {
          const childName = String(child.name || "");
          if (!childName || SKIP_DIRS.has(childName.toLowerCase())) continue;
          rows.push({
            path: child.isDirectory() ? `${name}/${childName}/` : `${name}/${childName}`,
            kind: child.isDirectory() ? "directory" : "file",
          });
          if (rows.length >= limit) return rows;
        }
      } catch { /* ignore */ }
    }
    if (rows.length >= limit) break;
  }
  return rows;
}

function treeFingerprint(tree = []) {
  const payload = (tree || []).map((row) => `${row.kind}:${row.path}`).join("|");
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 12);
}

function refreshFileTreeCache(projectRoot, { force = false } = {}) {
  const state = loadSessionState(projectRoot);
  const age = state.fileTreeAt ? Date.now() - Date.parse(state.fileTreeAt) : Infinity;
  if (!force && Array.isArray(state.fileTree) && state.fileTree.length && Number.isFinite(age) && age < TREE_TTL_MS) {
    return state;
  }
  const fileTree = listShallowTree(projectRoot);
  return saveSessionState(projectRoot, {
    ...state,
    fileTree,
    fileTreeAt: new Date().toISOString(),
    fileTreeHash: treeFingerprint(fileTree),
  });
}

function ensureSessionState(projectRoot, input = {}) {
  const refreshed = refreshFileTreeCache(projectRoot, { force: input.force === true });
  if (!input.task && !input.nextAction) return refreshed;
  return saveSessionState(projectRoot, {
    ...refreshed,
    task: input.task != null ? String(input.task).slice(0, 240) : refreshed.task,
    nextAction: input.nextAction != null ? String(input.nextAction).slice(0, 240) : refreshed.nextAction,
  });
}

function normalizeRel(filePath = "") {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isInternalIndexPath(rel = "") {
  const n = normalizeRel(rel);
  if (!n) return true;
  if (/^ROADMAP(\/ROADMAP)?\.md$/i.test(n)) return true;
  if (n === ".editcore/session-state.json" || n.startsWith(".editcore/")) return true;
  return false;
}

function recordModification(projectRoot, { path: filePath, action = "patch", summary = "" } = {}) {
  const rel = normalizeRel(filePath);
  if (isInternalIndexPath(rel)) return loadSessionState(projectRoot);
  const state = loadSessionState(projectRoot);
  const entry = {
    path: rel,
    action: String(action || "patch").slice(0, 40),
    summary: String(summary || "").slice(0, 160),
    at: new Date().toISOString(),
  };
  const recentMods = [entry, ...state.recentMods.filter((row) => normalizeRel(row.path) !== rel)].slice(0, MAX_MODS);
  const fileTree = state.fileTree.some((row) => normalizeRel(row.path) === rel || normalizeRel(row.path) === `${rel}/`)
    ? state.fileTree
    : [{ path: rel, kind: "file" }, ...state.fileTree].slice(0, MAX_TREE);
  return saveSessionState(projectRoot, {
    ...state,
    recentMods,
    fileTree,
    fileTreeAt: state.fileTreeAt || new Date().toISOString(),
  });
}

function recordRead(projectRoot, filePath = "") {
  const rel = normalizeRel(filePath);
  if (!rel || isInternalIndexPath(rel)) return loadSessionState(projectRoot);
  const state = loadSessionState(projectRoot);
  const recentReads = [rel, ...state.recentReads.filter((p) => p !== rel)].slice(0, MAX_READS);
  return saveSessionState(projectRoot, { ...state, recentReads });
}

/**
 * Tras applyPatch / write exitoso: actualiza session-state + ROADMAP.md.
 */
function noteSuccessfulPatch(projectRoot, meta = {}) {
  const rel = normalizeRel(meta.path || meta.filePath || "");
  if (!projectRoot || isInternalIndexPath(rel)) {
    return { ok: true, skipped: true, reason: "internal-or-empty" };
  }
  const action = String(meta.action || "applyPatch").slice(0, 40);
  const summary = String(meta.summary || meta.reason || "").slice(0, 160);
  const state = recordModification(projectRoot, { path: rel, action, summary });
  let roadmap = null;
  try {
    const { appendPatchSummaryToRoadmap } = require("./project-roadmap");
    roadmap = appendPatchSummaryToRoadmap(projectRoot, { path: rel, action, summary });
  } catch (error) {
    roadmap = { ok: false, error: String(error?.message || error) };
  }
  return { ok: true, path: rel, session: state, roadmap };
}

function formatSessionStateForPrompt(projectRoot, maxChars = 2_400) {
  const state = ensureSessionState(projectRoot);
  const tree = (state.fileTree || []).slice(0, 40).map((row) => `- ${row.path}`).join("\n");
  const mods = (state.recentMods || []).slice(0, 10).map((row) => {
    const bit = row.summary ? ` — ${row.summary}` : "";
    return `- ${row.path} (${row.action})${bit}`;
  }).join("\n");
  const reads = (state.recentReads || []).slice(0, 8).map((p) => `- ${p}`).join("\n");
  const body = [
    "SESSION-STATE (.editcore/session-state.json) — caché de este workspace. Úsalo en lugar de reexplorar.",
    state.task ? `Tarea: ${state.task}` : "",
    state.nextAction ? `Siguiente: ${state.nextAction}` : "",
    state.fileTreeHash ? `Árbol hash=${state.fileTreeHash} @ ${state.fileTreeAt || state.updatedAt}` : "",
    "## Árbol cacheado",
    tree || "- (vacío)",
    "## Mods recientes",
    mods || "- Ninguno",
    reads ? `## Lecturas recientes\n${reads}` : "",
    "PROHIBIDO list_files/glob del repo entero si este caché cubre la pregunta. Solo lee archivos puntuales a editar.",
  ].filter(Boolean).join("\n");
  return body.slice(0, maxChars);
}

module.exports = {
  SESSION_RELATIVE,
  TREE_TTL_MS,
  loadSessionState,
  saveSessionState,
  ensureSessionState,
  refreshFileTreeCache,
  recordModification,
  recordRead,
  noteSuccessfulPatch,
  formatSessionStateForPrompt,
  isInternalIndexPath,
};
