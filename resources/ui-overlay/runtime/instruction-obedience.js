"use strict";

/**
 * Motor de obediencia de instrucciones.
 *
 * FOCO (scoped / scoped_dir) RETIRADO: era mediocre, contaminaba el chat,
 * bloqueaba tools utiles y convertia frases normales en allowlists rotas.
 * EditCore opera como Cursor/Claude: el modelo elige tools; el usuario
 * autoriza mutacion con procede/autorizo/adelante.
 *
 * Se conserva denylist suave solo si el usuario dice explicitamente
 * "no explores android" etc. — sin mensajes FOCO en el chat.
 */

const {
  extractScopedAllowlist,
  extractScopedFolderAllowlist,
  isolateUserIntentPrompt,
  pathAllowed,
  pathUnderFolder,
  normalizeRel,
  basenameOf,
  SCOPED_FS_TOOLS,
  buildScopedFocusSurfaceDepth,
  buildScopedFolderSurfaceDepth,
  assertScopedToolAllowed: assertScopedFocus,
} = require("./scoped-file-focus");

const EXPLORE_TOOLS = new Set([
  ...SCOPED_FS_TOOLS,
  "list_files",
  "search_files",
  "project_discovery",
  "codebase_map",
  "symbol_search",
  "dependency_search",
  "semantic_search",
  "run_parallel_explore",
  "unified_search",
]);

/** Kill-switch global: FOCO nunca se activa. */
const FOCO_ENABLED = false;

/**
 * @returns {{
 *   active: boolean,
 *   mode: 'scoped'|'scoped_dir'|'deny'|'open',
 *   allowlist: string[],
 *   folderAllowlist: string[],
 *   denylist: string[],
 *   skipBootstrap: boolean,
 *   maxIterations: number,
 *   depthOverride: object|null,
 * }}
 */
function resolveInstructionConstraints(prompt = "") {
  const text = isolateUserIntentPrompt(prompt);
  const denylist = extractDeniedRoots(text);

  // FOCO retirado: nunca modo scoped / scoped_dir (aunque el prompt diga "solo X").
  if (!FOCO_ENABLED) {
    if (denylist.length) {
      return {
        active: true,
        mode: "deny",
        allowlist: [],
        folderAllowlist: [],
        denylist,
        skipBootstrap: false,
        maxIterations: 0,
        depthOverride: null,
      };
    }
    return {
      active: false,
      mode: "open",
      allowlist: [],
      folderAllowlist: [],
      denylist: [],
      skipBootstrap: false,
      maxIterations: 0,
      depthOverride: null,
    };
  }

  const folderAllowlist = extractScopedFolderAllowlist(text);
  const allowlist = extractScopedAllowlist(text);

  if (folderAllowlist.length) {
    return {
      active: true,
      mode: "scoped_dir",
      allowlist: [],
      folderAllowlist,
      denylist,
      skipBootstrap: true,
      maxIterations: 4,
      depthOverride: buildScopedFolderSurfaceDepth(folderAllowlist),
    };
  }

  const scoped = allowlist.length > 0
    || /\b(?:solo|unicamente|solamente)\b[\s\S]{0,60}\b(?:archivo|package\.json|[\w./\\-]+\.(?:js|ts|tsx|json|md))\b/i.test(text);

  if (scoped && allowlist.length) {
    return {
      active: true,
      mode: "scoped",
      allowlist,
      folderAllowlist: [],
      denylist,
      skipBootstrap: true,
      maxIterations: 2,
      depthOverride: buildScopedFocusSurfaceDepth(),
    };
  }

  if (denylist.length) {
    return {
      active: true,
      mode: "deny",
      allowlist: [],
      folderAllowlist: [],
      denylist,
      skipBootstrap: false,
      maxIterations: 0,
      depthOverride: null,
    };
  }

  return {
    active: false,
    mode: "open",
    allowlist: [],
    folderAllowlist: [],
    denylist: [],
    skipBootstrap: false,
    maxIterations: 0,
    depthOverride: null,
  };
}

function extractDeniedRoots(prompt = "") {
  const text = isolateUserIntentPrompt(prompt);
  const denied = new Set();
  const slashList = text.match(/\bno\s+explores?(?:\s+mas)?\s+([a-z0-9_./\\,-]+)/i);
  if (slashList?.[1]) {
    for (const part of String(slashList[1]).split(/[\/,|]+/)) {
      const p = normalizeRel(part).toLowerCase();
      if (p && p.length < 40) denied.add(p.split("/")[0]);
    }
  }
  if (/\bno\s+leas?\b[\s\S]{0,80}\.md\b/i.test(text)) denied.add(".md");
  for (const name of ["android", "ios", "docs", "node_modules", ".git", "marketing", "publicidad"]) {
    if (new RegExp(`\\bno\\s+(?:explores?|leas?|entres?|listes?|toques?)\\b[\\s\\S]{0,100}\\b${name}\\b`, "i").test(text)) {
      denied.add(name);
    }
    if (new RegExp(`\\bsin\\s+(?:tocar|explorar|leer)\\b[\\s\\S]{0,40}\\b${name}\\b`, "i").test(text)) {
      denied.add(name);
    }
  }
  return [...denied];
}

function pathDenied(candidate = "", denylist = []) {
  const rel = normalizeRel(candidate).toLowerCase();
  if (!denylist.length) return false;
  if (!rel) return false;
  if (denylist.includes(".md") && /\.md$/i.test(rel)) return true;
  const top = rel.split("/")[0];
  return denylist.some((d) => {
    const dd = String(d || "").toLowerCase();
    if (!dd || dd === ".md") return false;
    return top === dd || rel === dd || rel.startsWith(`${dd}/`);
  });
}

function assertInstructionToolAllowed(toolName = "", toolInput = {}, constraints = null) {
  if (!constraints?.active) return { ok: true };
  const name = String(toolName || "");

  // FOCO retirado: nunca bloquear por allowlist scoped.
  if (!FOCO_ENABLED && (constraints.mode === "scoped" || constraints.mode === "scoped_dir")) {
    return { ok: true };
  }

  if (constraints.mode === "scoped_dir") {
    try {
      assertScopedFocus(name, toolInput, [], { folderAllowlist: constraints.folderAllowlist || [] });
    } catch (err) {
      if (err.code === "SCOPED_FOCUS_BLOCKED") throw obedienceError(err.message.replace(/^FOCO ESTRICTO:\s*/i, ""));
      throw err;
    }
    return { ok: true };
  }

  if (constraints.mode === "scoped") {
    const allowlist = constraints.allowlist || [];
    if (!allowlist.length) return { ok: true };
    try {
      assertScopedFocus(name, toolInput, allowlist, {});
    } catch (err) {
      if (err.code === "SCOPED_FOCUS_BLOCKED") throw obedienceError(err.message.replace(/^FOCO ESTRICTO:\s*/i, ""));
      throw err;
    }
    return { ok: true };
  }

  if (constraints.mode === "deny") {
    if (!EXPLORE_TOOLS.has(name)) return { ok: true };
    const p = toolInput?.path || toolInput?.file || toolInput?.query || "";
    if (name === "list_files" || name === "read_file") {
      if (pathDenied(p, constraints.denylist)) {
        throw obedienceError(`Ruta denegada por el usuario: ${normalizeRel(p)}. Denylist: ${constraints.denylist.join(", ")}.`);
      }
    }
    if (name === "search_files" && /\.md\b/i.test(String(toolInput?.query || "")) && constraints.denylist.includes(".md")) {
      throw obedienceError("Busqueda en .md denegada por el usuario.");
    }
  }

  return { ok: true };
}

function obedienceError(message) {
  const err = new Error(`OBEDIENCIA: ${message}`);
  err.code = "INSTRUCTION_OBEDIENCE_BLOCKED";
  return err;
}

function formatConstraintsForModel(constraints) {
  if (!constraints?.active) return "";
  // Nunca inyectar texto FOCO al modelo.
  if (constraints.mode === "scoped" || constraints.mode === "scoped_dir") return "";
  if (constraints.mode === "deny") {
    return [
      "Restriccion del usuario:",
      `- No explores: ${constraints.denylist.join(", ")}.`,
    ].join("\n");
  }
  return "";
}

module.exports = {
  FOCO_ENABLED,
  resolveInstructionConstraints,
  extractDeniedRoots,
  pathDenied,
  assertInstructionToolAllowed,
  formatConstraintsForModel,
  extractScopedAllowlist,
  extractScopedFolderAllowlist,
  isolateUserIntentPrompt,
  pathAllowed,
  pathUnderFolder,
  normalizeRel,
  basenameOf,
  buildScopedFocusSurfaceDepth,
  buildScopedFolderSurfaceDepth,
};
