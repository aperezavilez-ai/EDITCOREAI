"use strict";

/**
 * Mapa cognitivo liviano del proyecto → `.editcore/project-map.json`
 * Evita exploraciones a ciegas (src/, app/, etc. inexistentes).
 */

const fs = require("node:fs");
const path = require("node:path");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "coverage",
  "out", "tmp", "temp", ".cache", "release", "release-275",
  "win-unpacked", "packaged", "app.asar", "app.asar.unpacked",
  "snapshots", "chat-memory",
]);

const MAX_DIRS = 400;
const MAX_FILES = 2500;
const MAX_DEPTH = 8;

function mapPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "project-map.json");
}

function normalizeRel(rel = "") {
  return String(rel || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}

function walkTree(root, relative = "", depth = 0, acc = { dirs: [], files: [] }) {
  if (depth > MAX_DEPTH || acc.dirs.length >= MAX_DIRS || acc.files.length >= MAX_FILES) return acc;
  const abs = relative ? path.join(root, relative) : root;
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return acc;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    // .editcore: solo metadatos livianos; nunca snapshots/.bak
    if (entry.name.startsWith(".") && entry.name !== ".cursor" && entry.name !== ".editcore") continue;
    if (entry.name === ".editcore" || normalizeRel(relative) === ".editcore") {
      if (entry.isDirectory() && (entry.name === "snapshots" || entry.name === "chat-memory")) continue;
    }
    const rel = normalizeRel(relative ? `${relative}/${entry.name}` : entry.name);
    if (entry.isDirectory()) {
      acc.dirs.push(rel);
      walkTree(root, rel, depth + 1, acc);
    } else if (entry.isFile()) {
      acc.files.push(rel);
    }
    if (acc.dirs.length >= MAX_DIRS || acc.files.length >= MAX_FILES) break;
  }
  return acc;
}

function detectStack(rootDirs = [], allFiles = []) {
  const dirs = new Set(rootDirs.map((d) => d.toLowerCase()));
  const files = new Set(allFiles.map((f) => f.toLowerCase()));
  const hints = [];
  if (files.has("package.json")) hints.push("node");
  if ([...files].some((f) => /^next\.config\./.test(f))) hints.push("next");
  if ([...files].some((f) => /^vite\.config\./.test(f))) hints.push("vite");
  if (dirs.has("app") || files.has("app/layout.tsx") || files.has("app/page.tsx")) hints.push("app-router");
  if (dirs.has("src")) hints.push("src");
  if (dirs.has("runtime")) hints.push("runtime");
  if (dirs.has("editcore-chat-kernel")) hints.push("editcore-kernel");
  if (dirs.has("supabase")) hints.push("supabase");
  if (files.has("main.js") && files.has("preload.js")) hints.push("electron");
  return hints;
}

function buildProjectMap(projectRoot, { maxFiles = MAX_FILES } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "projectRoot invalido", map: null };
  }
  const walked = walkTree(root, "", 0, { dirs: [], files: [] });
  if (walked.files.length > maxFiles) walked.files = walked.files.slice(0, maxFiles);
  const rootDirs = walked.dirs.filter((d) => !d.includes("/"));
  const rootFiles = walked.files.filter((f) => !f.includes("/"));
  const map = {
    version: 1,
    root,
    builtAt: new Date().toISOString(),
    rootDirs,
    rootFiles,
    dirs: walked.dirs,
    files: walked.files.slice(0, 800),
    fileCount: walked.files.length,
    dirCount: walked.dirs.length,
    stack: detectStack(rootDirs, walked.files),
    entrypoints: [
      "package.json", "main.js", "index.html", "src/index.ts", "src/main.ts",
      "app/page.tsx", "app/layout.tsx", "pages/index.tsx", "README.md",
    ].filter((p) => walked.files.some((f) => f === p || f.toLowerCase() === p.toLowerCase())),
  };
  return { ok: true, map };
}

function saveProjectMap(projectRoot, map) {
  const root = path.resolve(String(projectRoot || ""));
  fs.mkdirSync(path.join(root, ".editcore"), { recursive: true });
  const file = mapPath(root);
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  return { ok: true, path: ".editcore/project-map.json" };
}

function loadProjectMap(projectRoot) {
  const file = mapPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const map = JSON.parse(fs.readFileSync(file, "utf8"));
    return map && typeof map === "object" ? map : null;
  } catch {
    return null;
  }
}

function ensureProjectMap(projectRoot, { force = false, maxAgeMs = 5 * 60_000 } = {}) {
  const existing = force ? null : loadProjectMap(projectRoot);
  if (existing?.builtAt) {
    const age = Date.now() - Date.parse(existing.builtAt);
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
      return { ok: true, map: existing, cached: true };
    }
  }
  const built = buildProjectMap(projectRoot);
  if (!built.ok) return built;
  saveProjectMap(projectRoot, built.map);
  return { ok: true, map: built.map, cached: false };
}

function pathExistsInMap(map, relPath = "") {
  const rel = normalizeRel(relPath);
  if (!rel || rel === "." || rel === "/") return true;
  if (!map) return false;
  const lower = rel.toLowerCase();
  if ((map.dirs || []).some((d) => {
    const dd = d.toLowerCase();
    return dd === lower || lower.startsWith(`${dd}/`);
  })) return true;
  if ((map.files || []).some((f) => f.toLowerCase() === lower)) return true;
  const top = lower.split("/")[0];
  return (map.rootDirs || []).some((d) => d.toLowerCase() === top)
    && (map.dirs || []).some((d) => {
      const dd = d.toLowerCase();
      return dd === top || dd.startsWith(`${top}/`);
    });
}

/**
 * Resuelve un target de listado/exploración contra el mapa real.
 * Nunca inventa src/ o app/ si no existen.
 */
function resolveExistingTarget(projectRoot, requested = ".", map = null) {
  const root = path.resolve(String(projectRoot || ""));
  const cognitive = map || loadProjectMap(root);
  let req = normalizeRel(requested);
  if (!req || req === "." || req === "/" || /^(el|la|los|las|proyecto|carpeta|folder|directorio)$/i.test(req)) {
    return { target: ".", source: "root", map: cognitive };
  }

  if (/^[a-zA-Z]:[\\/]/.test(String(requested)) || String(requested).startsWith("/")) {
    try {
      const abs = path.resolve(String(requested));
      if (abs.toLowerCase().startsWith(root.toLowerCase())) {
        req = normalizeRel(path.relative(root, abs));
      }
    } catch { /* keep */ }
  }

  if (pathExistsInMap(cognitive, req) || fs.existsSync(path.join(root, req))) {
    return { target: req || ".", source: "exact", map: cognitive };
  }

  // Carpetas típicas de frameworks: si no están en la raíz del mapa, NO inventar ni hacer fuzzy.
  const phantomRoots = new Set(["src", "app", "lib", "pages", "components", "public", "server", "client"]);
  const topSeg = (req.split("/")[0] || "").toLowerCase();
  if (phantomRoots.has(topSeg)) {
    const rootHas = (cognitive?.rootDirs || []).some((d) => d.toLowerCase() === topSeg);
    if (!rootHas) {
      return {
        target: ".",
        source: "fallback-root",
        map: cognitive,
        missing: req,
        availableRoots: (cognitive?.rootDirs || []).slice(0, 24),
      };
    }
  }

  const base = req.split("/").filter(Boolean).pop() || req;
  const dirHit = (cognitive?.dirs || []).find((d) => {
    const parts = d.split("/");
    return parts[parts.length - 1].toLowerCase() === base.toLowerCase();
  });
  if (dirHit) return { target: dirHit, source: "fuzzy-dir", map: cognitive };

  const fileHit = (cognitive?.files || []).find((f) => {
    const parts = f.split("/");
    return parts[parts.length - 1].toLowerCase() === base.toLowerCase();
  });
  if (fileHit) {
    const parent = fileHit.includes("/") ? fileHit.split("/").slice(0, -1).join("/") : ".";
    return { target: parent || ".", source: "fuzzy-file-parent", map: cognitive, file: fileHit };
  }

  return {
    target: ".",
    source: "fallback-root",
    map: cognitive,
    missing: req,
    availableRoots: (cognitive?.rootDirs || []).slice(0, 24),
  };
}

function formatMapForPrompt(map) {
  if (!map) return "MAPA COGNITIVO: (no disponible; usa list_files('.') primero).";
  const roots = (map.rootDirs || []).slice(0, 30);
  const files = (map.rootFiles || []).slice(0, 30);
  return [
    "MAPA COGNITIVO DEL PROYECTO (.editcore/project-map.json):",
    `- Stack: ${(map.stack || []).join(", ") || "desconocido"}`,
    `- Carpetas raíz: ${roots.join(", ") || "(ninguna)"}`,
    `- Archivos raíz: ${files.join(", ") || "(ninguno)"}`,
    `- Totales: ${map.dirCount || 0} dirs / ${map.fileCount || 0} archivos`,
    "- PROHIBIDO buscar carpetas inventadas (src/, app/, lib/) si no aparecen arriba.",
    "- Usa solo rutas del mapa o list_files('.') para descubrir.",
    map.entrypoints?.length ? `- Entrypoints: ${map.entrypoints.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

module.exports = {
  mapPath,
  buildProjectMap,
  saveProjectMap,
  loadProjectMap,
  ensureProjectMap,
  pathExistsInMap,
  resolveExistingTarget,
  formatMapForPrompt,
  normalizeRel,
};
