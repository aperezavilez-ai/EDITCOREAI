"use strict";

/**
 * Mapa de carpetas hermanas bajo el padre del workspace (ej. D:\PROGRAMAS IA).
 */

const fs = require("node:fs");
const path = require("node:path");
const { workspaceParentRoot, assertProjectRoot, normalizeDriveLetter } = require("../project-path-policy");

const SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".cache",
  "rtk", "ui-overlay",
]);

function inferSiblingRole(name = "") {
  const n = String(name || "").toLowerCase();
  if (/gafcore\s*gateway|gafcore-gateway/.test(n)) return "AI Gateway (modelos, project keys, /api/v1/chat)";
  if (/^editcoreai$|^editcore ai$/.test(n)) return "IDE EditCore (este runtime)";
  if (/editcore.*web/.test(n)) return "EditCore Web";
  if (/fuxion/.test(n)) return "App de negocio (consumidor típico del Gateway)";
  if (/supabase|postgres/.test(n)) return "Infra datos";
  return "Proyecto hermano en el mismo workspace";
}

function listWorkspaceSiblings(projectRoot = "", { limit = 40 } = {}) {
  let primary = "";
  try {
    primary = assertProjectRoot(projectRoot);
  } catch {
    return { parent: "", primary: "", siblings: [] };
  }
  const parent = workspaceParentRoot(primary);
  if (!parent) return { parent: "", primary, siblings: [] };
  let entries = [];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return { parent, primary, siblings: [] };
  }
  const primaryBase = path.basename(primary).toLowerCase();
  const siblings = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = String(entry.name || "");
    if (!name || name.startsWith(".") || SKIP.has(name.toLowerCase())) continue;
    const abs = normalizeDriveLetter(path.join(parent, name));
    siblings.push({
      name,
      path: abs,
      active: name.toLowerCase() === primaryBase,
      role: inferSiblingRole(name),
      readHint: name.toLowerCase() === primaryBase
        ? "(proyecto activo — paths relativos normales)"
        : `list_files/read_file con "../${name}/..." o "${name}/..."`,
    });
    if (siblings.length >= limit) break;
  }
  siblings.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es"));
  return { parent, primary, siblings };
}

function formatWorkspaceSiblingMap(projectRoot = "", maxChars = 2_200) {
  const map = listWorkspaceSiblings(projectRoot);
  if (!map.parent || !map.siblings.length) {
    return "WORKSPACE SIBLINGS: (sin carpeta padre usable; solo el proyecto activo).";
  }
  const lines = [
    "WORKSPACE SIBLINGS (lectura permitida sin Acceso completo; escritura en hermanos requiere Acceso completo):",
    `Padre: ${map.parent}`,
    `Activo: ${path.basename(map.primary)}`,
    "Relación típica: apps (FUXION, etc.) consumen GafCore Gateway para AI; Supabase GafCore = DB aparte.",
    ...map.siblings.slice(0, 28).map((row) => {
      const mark = row.active ? "★" : "·";
      return `${mark} ${row.name} — ${row.role}. ${row.readHint}`;
    }),
    "Ejemplo: read_file path=\"../GAFCORE GATEWAY/src/app/api/admin/projects/route.ts\" o path=\"GAFCORE GATEWAY/package.json\".",
    "Para health de servicios locales: probe_endpoint / test_local_api (http://127.0.0.1:<port>).",
  ];
  return lines.join("\n").slice(0, maxChars);
}

module.exports = {
  listWorkspaceSiblings,
  formatWorkspaceSiblingMap,
  inferSiblingRole,
};
