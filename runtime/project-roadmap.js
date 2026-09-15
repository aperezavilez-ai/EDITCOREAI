"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROADMAP_RELATIVE = "ROADMAP.md";
const ROADMAP_ALT = path.join("ROADMAP", "ROADMAP.md");
const SKIP_DIRS = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel", ".wrangler",
  ".cache", "node_modules", "dist", "build", "coverage", "out", ".editcore",
]);
const KEY_DIRS = new Set(["src", "public", "pages", "app", "scripts", "docs", "components", "lib", "src-tauri"]);

function resolveRoadmapPath(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const primary = path.join(root, ROADMAP_RELATIVE);
  const nested = path.join(root, ROADMAP_ALT);
  if (fs.existsSync(primary) && fs.statSync(primary).isFile()) return { relative: ROADMAP_RELATIVE, absolute: primary, exists: true };
  if (fs.existsSync(nested) && fs.statSync(nested).isFile()) return { relative: ROADMAP_ALT.replace(/\\/g, "/"), absolute: nested, exists: true };
  return { relative: ROADMAP_RELATIVE, absolute: primary, exists: false };
}

function readRoadmap(projectRoot, maxChars = 8_000) {
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

function detectStackHints(root) {
  const hints = [];
  const pkgPath = path.join(root, "package.json");
  let scripts = [];
  let name = "";
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      name = String(pkg.name || "").trim();
      scripts = Object.keys(pkg.scripts || {}).slice(0, 10);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react || deps["react-dom"]) hints.push("React");
      if (deps.vite) hints.push("Vite");
      if (deps.next) hints.push("Next.js");
      if (deps["@tauri-apps/api"] || fs.existsSync(path.join(root, "src-tauri"))) hints.push("Tauri");
      if (deps.electron) hints.push("Electron");
      if (deps.vue) hints.push("Vue");
      if (deps.svelte) hints.push("Svelte");
      if (deps.typescript || fs.existsSync(path.join(root, "tsconfig.json"))) hints.push("TypeScript");
      if (deps["@supabase/supabase-js"]) hints.push("Supabase");
    } catch { /* ignore */ }
  }
  const entryCandidates = [
    "index.html", "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
    "src/App.tsx", "src/App.jsx", "app/page.tsx", "app/layout.tsx", "main.js",
  ];
  const entries = entryCandidates.filter((rel) => fs.existsSync(path.join(root, rel)));
  return {
    name,
    scripts,
    stack: uniqueLines(hints).slice(0, 8),
    entries: entries.slice(0, 8),
  };
}

function scanProjectForRoadmap(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const mapLines = [];
  const stackInfo = detectStackHints(root);
  if (stackInfo.name || stackInfo.scripts.length) {
    mapLines.push(
      `package.json — ${stackInfo.name || "app"}${stackInfo.scripts.length ? ` · scripts: ${stackInfo.scripts.join(", ")}` : ""}`,
    );
  }
  if (stackInfo.stack.length) mapLines.push(`stack: ${stackInfo.stack.join(" + ")}`);
  for (const entry of stackInfo.entries) mapLines.push(`entry: ${entry}`);

  const rootEntries = listLevel(root, "", 36);
  for (const entry of rootEntries) {
    if (entry.path === "package.json" || entry.path === "ROADMAP.md") continue;
    mapLines.push(entry.directory ? `${entry.path}/` : entry.path);
    if (entry.directory && KEY_DIRS.has(entry.path.toLowerCase())) {
      const children = listLevel(root, entry.path, 24);
      for (const child of children) {
        mapLines.push(child.directory ? `${child.path}/` : child.path);
        if (mapLines.length >= 56) break;
      }
    }
    if (mapLines.length >= 56) break;
  }
  return {
    mapLines: uniqueLines(mapLines).slice(0, 56),
    scanned: true,
    fileCount: mapLines.length,
    stackInfo,
  };
}

function isStubRoadmap(content = "") {
  const map = parseMapLines(content);
  if (!map.length) return true;
  const onlyGeneric = map.every((line) => /^(README\.md|AGENTS\.md|instructions\.md)$/i.test(line.replace(/\s+—.*$/, "").trim()));
  return onlyGeneric || /scaffold inicial/i.test(content);
}

function parseSectionBullets(content = "", heading = "") {
  const re = new RegExp(`##\\s*${heading}`, "i");
  const block = String(content || "").split(re)[1]?.split(/##\s+/i)[0] || "";
  return uniqueLines(
    block.split(/\r?\n/)
      .filter((line) => /^\s*-\s+/.test(line))
      .map((line) => line.replace(/^\s*-\s+/, "").trim())
      .filter((line) => line && !/^\(?(sin |ninguno|pendiente|n\/a)/i.test(line)),
  );
}

function parseMapLines(content = "") {
  return parseSectionBullets(content, "Mapa");
}

function parseFirstBullet(content = "", heading = "") {
  return parseSectionBullets(content, heading)[0] || "";
}

function normalizePhase(raw = "") {
  const value = String(raw || "").toLowerCase();
  if (/bloque|error|roto|falla|bug/.test(value)) return "bloqueado";
  if (/listo|done|completo|cerrado|ready|ok\b/.test(value)) return "listo";
  if (/implement|ejecut|escri|fix|corrige|aplica/.test(value)) return "implementacion";
  if (/anal|diagn|revis|plan|explora/.test(value)) return "analisis";
  return String(raw || "en_curso").trim().slice(0, 40) || "en_curso";
}

function renderRoadmap({
  title,
  status,
  mapLines,
  task,
  files,
  nextAction,
  verified,
  phase,
  stack,
  entries,
  scripts,
  previewUrl,
  blockers,
  decisions,
  keyFiles,
  processNotes,
} = {}) {
  const map = uniqueLines(mapLines).slice(0, 48).map((line) => (line.startsWith("- ") ? line : `- ${line}`));
  const changed = uniqueLines(files).slice(0, 18).map((line) => `- ${line}`);
  const checks = uniqueLines(verified).slice(0, 10).map((line) => `- ${line}`);
  const blockRows = uniqueLines(blockers).slice(0, 10).map((line) => `- ${line}`);
  const decisionRows = uniqueLines(decisions).slice(0, 10).map((line) => `- ${line}`);
  const keyRows = uniqueLines(keyFiles).slice(0, 16).map((line) => `- ${line}`);
  const stackRows = uniqueLines(stack).slice(0, 8);
  const entryRows = uniqueLines(entries).slice(0, 8);
  const scriptRows = uniqueLines(scripts).slice(0, 10);
  const fase = normalizePhase(phase || status);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  return [
    `# ${title} — ROADMAP`,
    "",
    "Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.",
    "PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.",
    "EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.",
    "",
    "## Proceso",
    `- Fase: ${fase}`,
    `- Estado: ${String(status || "En progreso").trim().slice(0, 280)}`,
    `- Actualizado: ${stamp}`,
    ...(stackRows.length ? [`- Stack: ${stackRows.join(" + ")}`] : []),
    ...(entryRows.length ? entryRows.map((e) => `- Entry: ${e}`) : []),
    ...(scriptRows.length ? [`- Scripts: ${scriptRows.join(", ")}`] : []),
    `- Preview: ${String(previewUrl || "desconocido — usa el preview del IDE, no inventes puertos").trim().slice(0, 160)}`,
    ...(processNotes ? [`- Nota: ${String(processNotes).trim().slice(0, 240)}`] : []),
    "",
    "## Mapa",
    ...(map.length ? map : ["- (sin archivos listados)"]),
    "",
    "## Archivos clave (no reexplorar)",
    ...(keyRows.length ? keyRows : ["- Usar el Mapa; no list_files('.') si ya hay rutas aqui"]),
    "",
    "## Tarea activa",
    `- ${String(task || "Sin tarea activa").trim().slice(0, 280)}`,
    "",
    "## Bloqueos / bugs conocidos",
    ...(blockRows.length ? blockRows : ["- Ninguno registrado"]),
    "",
    "## Decisiones",
    ...(decisionRows.length ? decisionRows : ["- Ninguna registrada"]),
    "",
    "## Cambios recientes",
    ...(changed.length ? changed : ["- Ninguno todavia"]),
    "",
    "## Verificado",
    ...(checks.length ? checks : ["- Pendiente"]),
    "",
    "## Siguiente",
    `- ${String(nextAction || "Partir de este ROADMAP + .editcore/session-state.json; no releer el proyecto entero.").trim().slice(0, 280)}`,
    "",
    "## Regla anti-reexploracion",
    "- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.",
    "- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.",
    "- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.",
    "",
  ].join("\n");
}

function extractRoadmapMeta(content = "") {
  const proceso = parseSectionBullets(content, "Proceso");
  const pick = (prefix) => {
    const row = proceso.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    return row ? row.slice(prefix.length).replace(/^[:\s]+/, "").trim() : "";
  };
  return {
    phase: pick("Fase") || "",
    status: pick("Estado") || parseFirstBullet(content, "Estado") || "",
    stack: pick("Stack") ? pick("Stack").split(/\s*\+\s*/).map((s) => s.trim()).filter(Boolean) : [],
    entries: proceso.filter((line) => /^Entry:/i.test(line)).map((line) => line.replace(/^Entry:\s*/i, "").trim()),
    scripts: pick("Scripts") ? pick("Scripts").split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [],
    previewUrl: pick("Preview") || "",
    processNotes: pick("Nota") || "",
    task: parseFirstBullet(content, "Tarea activa"),
    nextAction: parseFirstBullet(content, "Siguiente"),
    blockers: parseSectionBullets(content, "Bloqueos"),
    decisions: parseSectionBullets(content, "Decisiones"),
    keyFiles: parseSectionBullets(content, "Archivos clave"),
    verified: parseSectionBullets(content, "Verificado"),
    files: parseSectionBullets(content, "Cambios recientes"),
    mapLines: parseMapLines(content),
  };
}

function ensureProjectRoadmap(projectRoot, input = {}) {
  const found = resolveRoadmapPath(projectRoot);
  const existing = found.exists ? readRoadmap(projectRoot).content : "";
  if (found.exists && existing && !isStubRoadmap(existing) && input.forceScan !== true) {
    return { ...found, created: false, scanned: false, content: existing };
  }
  const scan = scanProjectForRoadmap(projectRoot);
  const previous = extractRoadmapMeta(existing);
  const content = renderRoadmap({
    title: projectTitle(projectRoot),
    status: input.status || (found.exists ? "ROADMAP actualizado con analisis de disco." : "ROADMAP creado al analizar el proyecto en disco."),
    phase: input.phase || previous.phase || "analisis",
    mapLines: uniqueLines([...(scan.mapLines || []), ...(previous.mapLines || []), ...(input.mapLines || [])]),
    task: input.task || previous.task || "",
    files: input.files || previous.files || [],
    nextAction: input.nextAction || previous.nextAction || "Partir de este mapa. No pedir el ROADMAP al usuario. Solo leer archivos a cambiar.",
    verified: input.verified || previous.verified || [],
    stack: input.stack || scan.stackInfo?.stack || previous.stack || [],
    entries: input.entries || scan.stackInfo?.entries || previous.entries || [],
    scripts: input.scripts || scan.stackInfo?.scripts || previous.scripts || [],
    previewUrl: input.previewUrl || previous.previewUrl || "",
    blockers: input.blockers || previous.blockers || [],
    decisions: input.decisions || previous.decisions || [],
    keyFiles: input.keyFiles || previous.keyFiles || (scan.stackInfo?.entries || []),
    processNotes: input.processNotes || previous.processNotes || "",
  });
  fs.mkdirSync(path.dirname(found.absolute), { recursive: true });
  fs.writeFileSync(found.absolute, content, "utf8");
  return { ...found, exists: true, created: !found.exists, scanned: true, content };
}

function syncProjectRoadmap(projectRoot, input = {}) {
  const previousRaw = readRoadmap(projectRoot);
  const previous = extractRoadmapMeta(previousRaw.content);
  const needScan = !previousRaw.exists || isStubRoadmap(previousRaw.content) || (previous.mapLines || []).length < 3;
  const scan = needScan ? scanProjectForRoadmap(projectRoot) : { mapLines: previous.mapLines, stackInfo: null };
  const mapLines = uniqueLines([
    ...(scan.mapLines || []),
    ...(previous.mapLines || []),
    ...(input.mapLines || []),
    ...(input.files || []),
  ]);
  const content = renderRoadmap({
    title: projectTitle(projectRoot),
    status: input.status || (previousRaw.exists ? "Actualizado al cerrar cambios" : "ROADMAP creado al cerrar cambios"),
    phase: input.phase || previous.phase || (input.analysisMode ? "analisis" : "implementacion"),
    mapLines,
    task: input.task || previous.task || "",
    files: uniqueLines([...(input.files || []), ...(previous.files || [])]).slice(0, 18),
    nextAction: input.nextAction || previous.nextAction || "Partir de este ROADMAP. No releer el proyecto entero.",
    verified: uniqueLines([...(input.verified || []), ...(previous.verified || [])]).slice(0, 10),
    stack: input.stack || scan.stackInfo?.stack || previous.stack || [],
    entries: input.entries || scan.stackInfo?.entries || previous.entries || [],
    scripts: input.scripts || scan.stackInfo?.scripts || previous.scripts || [],
    previewUrl: input.previewUrl || previous.previewUrl || "",
    blockers: uniqueLines([...(input.blockers || []), ...(previous.blockers || [])]).slice(0, 10),
    decisions: uniqueLines([...(input.decisions || []), ...(previous.decisions || [])]).slice(0, 10),
    keyFiles: uniqueLines([
      ...(input.keyFiles || []),
      ...(previous.keyFiles || []),
      ...(input.files || []),
      ...(scan.stackInfo?.entries || []),
    ]).slice(0, 16),
    processNotes: input.processNotes || previous.processNotes || "",
  });
  fs.mkdirSync(path.dirname(previousRaw.absolute), { recursive: true });
  fs.writeFileSync(previousRaw.absolute, content, "utf8");
  return { ...previousRaw, exists: true, created: !previousRaw.exists, updated: true, content, scanned: needScan };
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
  previewUrl = "",
  blockers = [],
  decisions = [],
  phase = "",
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
  // Extraer bugs/errores evidentes del texto del turno
  const inferredBlockers = [...(blockers || [])];
  for (const match of report.matchAll(/(?:ERROR|Error|Multiple exports|failed|fall[oó])[^\n]{0,120}/gi)) {
    const line = String(match[0] || "").replace(/\s+/g, " ").trim();
    if (line.length > 12) inferredBlockers.push(line.slice(0, 160));
    if (inferredBlockers.length >= 6) break;
  }
  const mapLines = uniqueLines([
    ...dirsListed.map((d) => (d === "." ? "(raiz)/" : `${d}/`)),
    ...filesRead,
  ]);
  const files = uniqueLines([...mutated, ...filesRead.slice(0, 24)]);
  const inferredPhase = phase
    || (analysisMode ? (completed ? "analisis" : "analisis") : (completed ? (mutated.length ? "implementacion" : "listo") : "implementacion"));
  return {
    task: String(task || "").slice(0, 280),
    files,
    mapLines,
    keyFiles: uniqueLines([...mutated, ...filesRead]).slice(0, 16),
    blockers: uniqueLines([...inferredBlockers, ...gaps]).slice(0, 10),
    decisions: uniqueLines(decisions).slice(0, 10),
    phase: inferredPhase,
    previewUrl: String(previewUrl || "").trim(),
    status: String(status || (
      analysisMode
        ? (completed
          ? "Analisis cerrado. ROADMAP = proceso + mapa; no reexplorar lo mapeado."
          : "Analisis en curso. ROADMAP checkpoint (ahorro de tokens).")
        : (completed ? "Cambios cerrados. Partir de este ROADMAP (proceso completo)." : "Corrida incompleta; retomar desde ROADMAP.")
    )).slice(0, 280),
    nextAction: String(nextAction || (
      gaps.length || inferredBlockers.length
        ? `Resolver: ${(inferredBlockers[0] || gaps[0] || "").slice(0, 120)}. Partir de este ROADMAP.`
        : "Leer este ROADMAP (Proceso + Tarea + Bloqueos) y continuar. No reexplorar el proyecto entero."
    )).slice(0, 280),
    verified: uniqueLines(gaps).slice(0, 6),
  };
}

function formatRoadmapForPrompt(projectRoot) {
  const loaded = readRoadmap(projectRoot);
  if (!loaded.content) {
    return [
      "ROADMAP ausente. Analiza el disco (list_files + read_file de package.json/index.html) y CREA ROADMAP.md con Proceso+Mapa+Tarea+Bloqueos.",
      "PROHIBIDO pedir al usuario que lo pegue, suba o indique la ruta.",
    ].join(" ");
  }
  return [
    `ROADMAP YA CARGADO (${loaded.relative}). Contiene el PROCESO del proyecto (fase, stack, bloqueos, tarea, mapa).`,
    "PROHIBIDO pedir el ROADMAP al usuario. PROHIBIDO list_files/read_file de todo el proyecto. Solo lee lo que vas a editar o lo que el mapa no cubre.",
    "Antes de cualquier búsqueda o glob: lee también .editcore/session-state.json (caché de árbol/mods).",
    "Usa las secciones Proceso / Bloqueos / Tarea activa / Siguiente como memoria de continuidad entre mensajes del usuario.",
    loaded.content,
  ].join("\n");
}

/**
 * Append ligero tras applyPatch OK: actualiza Estado + Cambios recientes sin reescribir el mapa entero.
 */
function appendPatchSummaryToRoadmap(projectRoot, { path: filePath = "", action = "patch", summary = "" } = {}) {
  const rel = String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!rel || /^ROADMAP(\/ROADMAP)?\.md$/i.test(rel) || rel.startsWith(".editcore/")) {
    return { ok: true, skipped: true };
  }
  const previousRaw = readRoadmap(projectRoot);
  const previous = extractRoadmapMeta(previousRaw.content);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const changeLine = summary
    ? `${rel} — ${String(summary).slice(0, 120)} (${stamp})`
    : `${rel} (${action}) @ ${stamp}`;
  const content = renderRoadmap({
    title: projectTitle(projectRoot),
    status: `Patch OK: ${rel} (${stamp})`,
    phase: previous.phase || "implementacion",
    mapLines: uniqueLines([rel, ...(previous.mapLines || [])]),
    task: previous.task || `Último cambio: ${rel}`,
    files: uniqueLines([changeLine, ...(previous.files || [])]),
    nextAction: previous.nextAction || "Partir de ROADMAP + session-state; no reexplorar el repo.",
    verified: previous.verified || [],
    stack: previous.stack || [],
    entries: previous.entries || [],
    scripts: previous.scripts || [],
    previewUrl: previous.previewUrl || "",
    blockers: previous.blockers || [],
    decisions: previous.decisions || [],
    keyFiles: uniqueLines([rel, ...(previous.keyFiles || [])]),
    processNotes: previous.processNotes || "",
  });
  fs.mkdirSync(path.dirname(previousRaw.absolute), { recursive: true });
  fs.writeFileSync(previousRaw.absolute, content, "utf8");
  return { ok: true, updated: true, path: previousRaw.relative, change: changeLine };
}

module.exports = {
  ROADMAP_RELATIVE,
  resolveRoadmapPath,
  readRoadmap,
  scanProjectForRoadmap,
  ensureProjectRoadmap,
  syncProjectRoadmap,
  appendPatchSummaryToRoadmap,
  buildRoadmapSyncFromRun,
  formatRoadmapForPrompt,
  renderRoadmap,
  isStubRoadmap,
  extractRoadmapMeta,
  detectStackHints,
};
