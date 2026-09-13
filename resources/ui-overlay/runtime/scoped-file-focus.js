"use strict";

/**
 * Candado duro de FOCO por turno:
 * - Archivo: solo read_file del allowlist.
 * - Carpeta: list_files + read_file dentro de esa carpeta.
 * Nunca tomar FOCO de enrich/historial ("Archivos relacionados").
 */

const SCOPED_FS_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "project_discovery",
  "codebase_map",
  "symbol_search",
  "dependency_search",
  "semantic_search",
  "run_parallel_explore",
  "unified_search",
]);

function normalizeRel(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

function basenameOf(value = "") {
  const parts = normalizeRel(value).split("/").filter(Boolean);
  return (parts[parts.length - 1] || "").toLowerCase();
}

/** Solo el pedido del usuario, sin bloques de enrich/contexto. */
function isolateUserIntentPrompt(prompt = "") {
  let text = String(prompt || "");
  // CONTINUA/PROCEDE: la instruccion actual manda sobre SOLICITUD ORIGINAL (evita FOCO sticky).
  const currentInstruction = text.match(/\bINSTRUCCION ACTUAL:\s*([\s\S]+?)(?:\n\n[A-ZÁÉÍÓÚ][^\n]{0,40}:|$)/i);
  if (currentInstruction?.[1] && String(currentInstruction[1]).trim().length >= 8) {
    text = String(currentInstruction[1]).trim();
  } else {
    text = text.split(/\n(?:PUNTO DE PARTIDA|INDICE REAL|MEMORIA DE LA CORRIDA|## Contexto|Archivos relacionados|@Files|CURRENT_RUN_EVIDENCE|OBEDIENCIA DURA|SOLICITUD ORIGINAL|PLAN AUTORIZADO|MEMORIA DURABLE)/i)[0] || text;
  }
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length < 500 && /\b(?:lee|lista|analiza|solo|solamente|unicamente|carpeta|package\.json)\b/i.test(last)) {
      return last;
    }
  }
  return text.trim();
}

/**
 * FOCO carpeta: "lee solamente la carpeta api"
 */
function extractScopedFolderAllowlist(prompt = "") {
  const text = isolateUserIntentPrompt(prompt);
  const found = new Set();
  const patterns = [
    /\b(?:solo|unicamente|solamente)\b[\s\S]{0,40}?\b(?:la\s+|el\s+)?(?:carpeta|folder|directorio|dir)\s+[`"'“]?((?:[\w.-]+[\\/])*[\w.-]+)[`"'”]?\b/gi,
    /\b(?:lee|lista|listar|enlista|muestra|revisa|explora)\b[\s\S]{0,40}?\b(?:solo|unicamente|solamente)\b[\s\S]{0,40}?\b(?:la\s+|el\s+)?(?:carpeta|folder|directorio|dir)\s+[`"'“]?((?:[\w.-]+[\\/])*[\w.-]+)[`"'”]?\b/gi,
    /\b(?:contenido\s+de\s+(?:la\s+)?)(?:carpeta|folder|directorio)\s+[`"'“]?((?:[\w.-]+[\\/])*[\w.-]+)[`"'”]?\b/gi,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const rel = normalizeRel(match[1] || "");
      if (!rel || /\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py|css|html)$/i.test(rel)) continue;
      if (/^(android|ios|docs|node_modules|\.git)$/i.test(rel)) continue;
      found.add(rel);
    }
  }
  return [...found];
}

/**
 * Extrae paths de ARCHIVO. No activa si el pedido es carpeta.
 */
function extractScopedAllowlist(prompt = "") {
  const text = isolateUserIntentPrompt(prompt);
  if (extractScopedFolderAllowlist(text).length) return [];
  // Pedido de carpeta sin extension de archivo en el intent → no FOCO archivo.
  if (/\b(?:carpeta|folder|directorio)\b/i.test(text) && !/\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py)\b/i.test(text)) {
    return [];
  }
  const found = new Set();
  // No cruzar "carpeta/folder" entre solamente y el .ts del enrich.
  // Tampoco tomar "solo X" dentro de una PROHIBICION (PROHIBIDO/NO/nunca) — eso
  // convertia el texto anti-ROADMAP de PROCEDE en FOCO allowlist=[ROADMAP.md].
  const re = /\b(?:solo|unicamente|solamente)\b(?:(?!\b(?:carpeta|folder|directorio)\b)[\s\S]){0,60}?((?:[\w.-]+[\\/])*[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py|css|html))\b/gi;
  for (const match of text.matchAll(re)) {
    const full = String(match[0] || "");
    const idx = Number(match.index) || 0;
    const before = text.slice(Math.max(0, idx - 48), idx);
    if (/\b(?:prohibido|nunca|jamas|no\s+(?:toques|modifiques|arregles|arreglar|arreglar|corriges|corrijas)|evita(?:r)?)\b/i.test(before + " " + full)) {
      continue;
    }
    const rel = normalizeRel(match[1] || "");
    if (rel) found.add(rel);
  }
  const re2 = /\bSOLO\s+de\s+((?:[\w.-]+[\\/])*[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py))\b/gi;
  for (const match of text.matchAll(re2)) {
    const rel = normalizeRel(match[1] || "");
    if (rel) found.add(rel);
  }
  const re3 = /\barchivo\s+((?:[\w.-]+[\\/])*[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py))\b/gi;
  for (const match of text.matchAll(re3)) {
    const rel = normalizeRel(match[1] || "");
    if (rel) found.add(rel);
  }
  if (/\b(?:solo|unicamente|solamente)\b/i.test(text) && /\bpackage\.json\b/i.test(text)) {
    found.add("package.json");
  }
  if (found.size === 0
    && /\b(?:reporte|an[aá]lisis|audita)\b[\s\S]{0,40}\b(?:del?|de\s+el)\s+package\.json\b/i.test(text)
    && !/\b(?:todo\s+el\s+proyecto|carpeta\s+por\s+carpeta)\b/i.test(text)) {
    found.add("package.json");
  }
  return [...found];
}

function pathAllowed(candidate = "", allowlist = []) {
  const rel = normalizeRel(candidate);
  if (!allowlist.length) return true;
  if (!rel || rel === "." || rel === "./") return false;
  const base = basenameOf(rel);
  return allowlist.some((allowed) => {
    const a = normalizeRel(allowed);
    const ab = basenameOf(a);
    if (!a) return false;
    if (rel === a || rel.endsWith(`/${a}`)) return true;
    if (base && ab && base === ab) return true;
    return false;
  });
}

function pathUnderFolder(candidate = "", folders = []) {
  const rel = normalizeRel(candidate);
  if (!folders.length) return true;
  if (!rel || rel === "." || rel === "./") return false;
  return folders.some((folder) => {
    const f = normalizeRel(folder).toLowerCase();
    if (!f) return false;
    const c = rel.toLowerCase();
    return c === f || c.startsWith(`${f}/`) || c.endsWith(`/${f}`) || basenameOf(c) === basenameOf(f);
  });
}

/**
 * @throws Error si la tool viola el FOCO
 * options.folderAllowlist → modo carpeta
 */
function assertScopedToolAllowed(toolName = "", toolInput = {}, allowlist = [], options = {}) {
  const name = String(toolName || "");
  const folders = Array.isArray(options.folderAllowlist) ? options.folderAllowlist : [];
  if (!allowlist.length && !folders.length) return { ok: true };
  if (!SCOPED_FS_TOOLS.has(name)) return { ok: true };

  if (["project_discovery", "codebase_map", "run_parallel_explore", "semantic_search", "unified_search"].includes(name)) {
    const err = new Error(
      folders.length
        ? `FOCO ESTRICTO: "${name}" prohibido. Solo list_files/read_file dentro de: ${folders.join(", ")}.`
        : `FOCO ESTRICTO: "${name}" prohibido. Solo read_file de: ${allowlist.join(", ")}.`
    );
    err.code = "SCOPED_FOCUS_BLOCKED";
    throw err;
  }

  if (folders.length) {
    if (name === "search_files" || name === "symbol_search" || name === "dependency_search") {
      const p = toolInput?.path || toolInput?.file || "";
      if (p && !pathUnderFolder(p, folders)) {
        const err = new Error(`FOCO ESTRICTO: busqueda solo dentro de [${folders.join(", ")}].`);
        err.code = "SCOPED_FOCUS_BLOCKED";
        throw err;
      }
      return { ok: true };
    }
    if (name === "list_files") {
      const p = toolInput?.path || toolInput?.file || toolInput?.target || "";
      const target = normalizeRel(p) || folders[0];
      if (!pathUnderFolder(target, folders)) {
        const err = new Error(
          `FOCO ESTRICTO: list_files solo en [${folders.join(", ")}]. Pedido: ${normalizeRel(p) || "(raiz)"}.`
        );
        err.code = "SCOPED_FOCUS_BLOCKED";
        throw err;
      }
      return { ok: true };
    }
    if (name === "read_file") {
      const p = toolInput?.path || toolInput?.file || toolInput?.target || "";
      if (!pathUnderFolder(p, folders)) {
        const err = new Error(
          `FOCO ESTRICTO: read_file solo dentro de [${folders.join(", ")}]. Pedido: ${normalizeRel(p) || "(vacio)"}.`
        );
        err.code = "SCOPED_FOCUS_BLOCKED";
        throw err;
      }
      return { ok: true };
    }
  }

  if (name === "list_files" || name === "search_files" || name === "symbol_search" || name === "dependency_search") {
    const err = new Error(
      `FOCO ESTRICTO: no explores carpetas. Solo read_file de: ${allowlist.join(", ")}.`
    );
    err.code = "SCOPED_FOCUS_BLOCKED";
    throw err;
  }

  if (name === "read_file") {
    const p = toolInput?.path || toolInput?.file || toolInput?.target || "";
    if (!pathAllowed(p, allowlist)) {
      const err = new Error(
        `FOCO ESTRICTO: read_file solo permitido en [${allowlist.join(", ")}]. Pedido: ${normalizeRel(p) || "(vacio)"}.`
      );
      err.code = "SCOPED_FOCUS_BLOCKED";
      throw err;
    }
  }
  return { ok: true };
}

function buildScopedFocusSurfaceDepth() {
  return {
    depth: "surface",
    label: "Analisis acotado (1 archivo)",
    minimumEvidence: 1,
    minCodeReads: 1,
    minSearches: 0,
    minListedDirs: 0,
    maxIterations: 2,
    tokenBudget: 28_000,
    ignoreRoadmap: true,
    requireLineEvidence: false,
    requireRootCause: false,
    orchestrationHint: "FOCO: un solo archivo. PROHIBIDO explorar otras carpetas.",
    scopedFocus: true,
  };
}

function buildScopedFolderSurfaceDepth(folders = []) {
  return {
    depth: "surface",
    label: `Analisis acotado (carpeta: ${(folders || []).join(", ") || "?"})`,
    minimumEvidence: 1,
    minCodeReads: 0,
    minSearches: 0,
    minListedDirs: 1,
    maxIterations: 4,
    tokenBudget: 40_000,
    ignoreRoadmap: true,
    requireLineEvidence: false,
    requireRootCause: false,
    orchestrationHint: `FOCO carpeta: solo list_files/read_file dentro de ${(folders || []).join(", ")}.`,
    scopedFocus: true,
    scopedFolderFocus: true,
  };
}

module.exports = {
  SCOPED_FS_TOOLS,
  normalizeRel,
  basenameOf,
  isolateUserIntentPrompt,
  extractScopedAllowlist,
  extractScopedFolderAllowlist,
  pathAllowed,
  pathUnderFolder,
  assertScopedToolAllowed,
  buildScopedFocusSurfaceDepth,
  buildScopedFolderSurfaceDepth,
};
