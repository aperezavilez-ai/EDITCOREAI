"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROADMAP_RELATIVE = "ROADMAP.md";
const ROADMAP_ALT = path.join("ROADMAP", "ROADMAP.md");
const SKIP_DIRS = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel", ".wrangler",
  ".cache", "node_modules", "dist", "build", "coverage", "out", ".editcore",
]);
const KEY_DIRS = new Set(["src", "public", "pages", "app", "scripts", "docs", "components", "lib"]);

function resolveRoadmapPath(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const primary = path.join(root, ROADMAP_RELATIVE);
  const nested = path.join(root, ROADMAP_ALT);
  if (fs.existsSync(primary) && fs.statSync(primary).isFile()) return { relative: ROADMAP_RELATIVE, absolute: primary, exists: true };
  if (fs.existsSync(nested) && fs.statSync(nested).isFile()) return { relative: ROADMAP_ALT.replace(/\\/g, "/"), absolute: nested, exists: true };
  return { relative: ROADMAP_RELATIVE, absolute: primary, exists: false };
}

function readRoadmap(projectRoot, maxChars = 6_000) {
  const found = resolveRoadmapPath(projectRoot);
  if (!found.exists) return { ...found, content: "" };
  try {
    return { ...found, content: fs.readFileSync(found.absolute, "utf8").slice(0, maxChars).trim() };
  } catch {
    return { ...found, content: "" };
  }
}

function projectTitle(projectRoot) {
  return path.basename(path.resolve(String(projectRoot || ""))) || "proyecto";
}

function uniqueLines(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function listLevel(root, relative = "", limit = 40) {
  const dir = relative ? path.join(root, relative) : root;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    const name = String(entry.name || "");
    if (SKIP_DIRS.has(name.toLowerCase())) continue;
    const rel = relative ? `${relative.replace(/\\/g, "/")}/${name}` : name;
    rows.push({
      path: rel,
      directory: entry.isDirectory(),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function scanProjectForRoadmap(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const mapLines = [];
  let stackHint = "";
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = Object.keys(pkg.scripts || {}).slice(0, 8).join(", ");
      stackHint = `package.json — ${pkg.name || "app"}${scripts ? ` · scripts: ${scripts}` : ""}`;
      mapLines.push(stackHint);
    } catch {
      mapLines.push("package.json");
    }
  }
  const rootEntries = listLevel(root, "", 36);
  for (const entry of rootEntries) {
    if (entry.path === "package.json" || entry.path === "ROADMAP.md") continue;
    mapLines.push(entry.directory ? `${entry.path}/` : entry.path);
    if (entry.directory && KEY_DIRS.has(entry.path.toLowerCase())) {
      const children = listLevel(root, entry.path, 24);
      for (const child of children) {
        mapLines.push(child.directory ? `${child.path}/` : child.path);
        if (mapLines.length >= 48) break;
      }
    }
    if (mapLines.length >= 48) break;
  }
  return {
    mapLines: uniqueLines(mapLines).slice(0, 48),
    scanned: true,
    fileCount: mapLines.length,
  };
}

function isStubRoadmap(content = "") {
  const map = parseMapLines(content);
  if (!map.length) return true;
  const onlyGeneric = map.every((line) => /^(README\.md|AGENTS\.md|instructions\.md)$/i.test(line.replace(/\s+—.*$/, "").trim()));
  return onlyGeneric || /scaffold inicial/i.test(content);
}

function renderRoadmap({ title, status, mapLines, task, files, nextAction, verified }) {
  const map = uniqueLines(mapLines).slice(0, 40).map((line) => (line.startsWith("- ") ? line : `- ${line}`));
  const changed = uniqueLines(files).slice(0, 16).map((line) => `- ${line}`);
  const checks = uniqueLines(verified).slice(0, 8).map((line) => `- ${line}`);
  return [
    `# ${title} — ROADMAP`,
    "",
    "Indice compacto generado al analizar el proyecto. LEER ANTES de reexplorar. Actualizar al terminar cambios. No pegar codigo. Nunca pedirlo al usuario.",
    "",
    "## Estado",
    `- ${String(status || "En progreso").trim()}`,
    "",
    "## Mapa",
    ...(map.length ? map : ["- (sin archivos listados)"]),
    "",
    "## Tarea activa",
    `- ${String(task || "Sin tarea activa").trim().slice(0, 240)}`,
    "",
    "## Cambios recientes",
    ...(changed.length ? changed : ["- Ninguno todavia"]),
    "",
    "## Verificado",
    ...(checks.length ? checks : ["- Pendiente"]),
    "",
    "## Siguiente",
    `- ${String(nextAction || "Usar este mapa; solo leer archivos a editar.").trim().slice(0, 240)}`,
    "",
  ].join("\n");
}

function parseMapLines(content = "") {
  const text = String(content || "");
  const block = text.split(/##\s*Mapa/i)[1]?.split(/##\s+/i)[0] || "";
  return uniqueLines(block.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line)).map((line) => line.replace(/^\s*-\s+/, "").trim()));
}

function ensureProjectRoadmap(projectRoot, input = {}) {
  const found = resolveRoadmapPath(projectRoot);
  const existing = found.exists ? readRoadmap(projectRoot).content : "";
  if (found.exists && existing && !isStubRoadmap(existing) && input.forceScan !== true) {
    return { ...found, created: false, scanned: false, content: existing };
  }
  const scan = scanProjectForRoadmap(projectRoot);
  const previousMap = parseMapLines(existing);
  const content = renderRoadmap({
    title: projectTitle(projectRoot),
    status: input.status || (found.exists ? "ROADMAP actualizado con analisis de disco." : "ROADMAP creado al analizar el proyecto en disco."),
    mapLines: uniqueLines([...(scan.mapLines || []), ...previousMap, ...(input.mapLines || [])]),
    task: input.task || "",
    files: input.files || [],
    nextAction: input.nextAction || "Partir de este mapa. No pedir el ROADMAP al usuario. Solo leer archivos a cambiar.",
    verified: input.verified || [],
  });
  fs.mkdirSync(path.dirname(found.absolute), { recursive: true });
  fs.writeFileSync(found.absolute, content, "utf8");
  return { ...found, exists: true, created: !found.exists, scanned: true, content };
}

function syncProjectRoadmap(projectRoot, input = {}) {
  const previous = readRoadmap(projectRoot);
  const scan = scanProjectForRoadmap(projectRoot);
  const mapLines = uniqueLines([
    ...scan.mapLines,
    ...parseMapLines(previous.content),
    ...(input.mapLines || []),
    ...(input.files || []),
  ]);
  const content = renderRoadmap({
    title: projectTitle(projectRoot),
    status: input.status || (previous.exists ? "Actualizado al cerrar cambios" : "ROADMAP creado al cerrar cambios"),
    mapLines,
    task: input.task || "",
    files: input.files || [],
    nextAction: input.nextAction || "Partir de este ROADMAP. No releer el proyecto entero.",
    verified: input.verified || [],
  });
  fs.mkdirSync(path.dirname(previous.absolute), { recursive: true });
  fs.writeFileSync(previous.absolute, content, "utf8");
  return { ...previous, exists: true, created: !previous.exists, updated: true, content };
}

/**
 * Payload compacto para ROADMAP desde una corrida (analisis o ejecucion).
 * Checkpoints mid-run + cierre: baja tokens al no reexplorar el mapa.
 */
function buildRoadmapSyncFromRun({
  steps = [],
  task = "",
  status = "",
  nextAction = "",
  analysisMode = false,
  completed = false,
  reportText = "",
} = {}) {
  const filesRead = [];
  const dirsListed = [];
  const mutated = [];
  for (const step of steps || []) {
    if (step?.ok === false) continue;
    const rel = String(step?.input?.path || step?.result?.path || "").replace(/\\/g, "/").trim();
    const name = String(step?.name || "");
    if (name === "read_file" && rel) filesRead.push(rel);
    if (name === "list_files") dirsListed.push(rel || ".");
    if (["write_file", "replace_in_file", "delete_file", "create_project", "apply_diff"].includes(name) && rel) {
      mutated.push(rel);
    }
  }
  const gaps = [];
  const report = String(reportText || "");
  const gapBlock = report.split(/##\s*Qu[eé]\s+falta\s+para\s+que\s+funcione/i)[1]?.split(/##\s+/i)[0] || "";
  if (gapBlock) {
    for (const line of gapBlock.split(/\r?\n/)) {
      const cleaned = line.replace(/^\s*[-*•]\s*/, "").trim();
      if (cleaned && cleaned.length < 160) gaps.push(cleaned);
      if (gaps.length >= 6) break;
    }
  }
  const mapLines = uniqueLines([
    ...dirsListed.map((d) => (d === "." ? "(raiz)/" : `${d}/`)),
    ...filesRead,
  ]);
  const files = uniqueLines([...mutated, ...filesRead.slice(0, 24)]);
  return {
    task: String(task || "").slice(0, 220),
    files,
    mapLines,
    status: String(status || (
      analysisMode
        ? (completed
          ? "Analisis cerrado. ROADMAP = indice compacto; no reexplorar lo mapeado."
          : "Analisis en curso. ROADMAP checkpoint (ahorro de tokens).")
        : (completed ? "Cambios cerrados. Partir de este ROADMAP." : "Corrida incompleta; retomar desde ROADMAP.")
    )).slice(0, 280),
    nextAction: String(nextAction || (
      gaps.length
        ? `Gaps: ${gaps.slice(0, 3).join("; ")}. Partir de este ROADMAP.`
        : "Leer este ROADMAP y continuar. No reexplorar el proyecto entero."
    )).slice(0, 280),
    verified: gaps.slice(0, 6),
  };
}

function formatRoadmapForPrompt(projectRoot) {
  const loaded = readRoadmap(projectRoot);
  if (!loaded.content) {
    return [
      "ROADMAP ausente. Analiza el disco (list_files + read_file de package.json/index.html) y CREA ROADMAP.md.",
      "PROHIBIDO pedir al usuario que lo pegue, suba o indique la ruta.",
    ].join(" ");
  }
  return [
    `ROADMAP YA CARGADO (${loaded.relative}). Generado al analizar el proyecto. Este es el punto de partida.`,
    "PROHIBIDO pedir el ROADMAP al usuario. PROHIBIDO list_files/read_file de todo el proyecto. Solo lee lo que vas a editar o lo que el mapa no cubre.",
    loaded.content,
  ].join("\n");
}

module.exports = {
  ROADMAP_RELATIVE,
  resolveRoadmapPath,
  readRoadmap,
  scanProjectForRoadmap,
  ensureProjectRoadmap,
  syncProjectRoadmap,
  buildRoadmapSyncFromRun,
  formatRoadmapForPrompt,
  renderRoadmap,
  isStubRoadmap,
};
