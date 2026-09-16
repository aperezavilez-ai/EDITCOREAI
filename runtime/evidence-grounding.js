"use strict";

/**
 * Evidence ledger minimo por ejecucion + anclaje anti-invencion.
 * No es memoria persistente: solo evidencia de tools de la corrida actual.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MUTATION_TOOLS = new Set(["write_file", "replace_in_file", "create_project", "create_pdf", "create_word", "create_excel", "create_csv", "service_write", "apply_diff", "publish_project", "connect_project", "provision_project", "onboard_project", "create_supabase_project", "sync_vercel_env", "supabase_manage", "ssh_deploy"]);
const READ_TOOLS = new Set(["read_file"]);
const LIST_TOOLS = new Set(["list_files", "project_discovery", "codebase_map"]);
const SEARCH_TOOLS = new Set(["search_files", "symbol_search", "dependency_search"]);
const VERIFY_TOOLS = new Set(["run_command", "inspect_preview"]);

const COMMON_INVENTED_ROOTS = [
  "backend", "frontend", "uploads", "server", "client", "api-server", "webapp", "mobile",
];

const STALE_EVIDENCE_LOG = [];

function normalizeProjectRoot(value = "") {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function extractAnalysisTargets(prompt = "") {
  const targets = [];
  const pathPattern = /(?:^|\s)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?:\s|$|,|;)/g;
  let match;
  while ((match = pathPattern.exec(prompt)) !== null) {
    targets.push(match[1]);
  }
  return targets;
}

function normalizeRunScope(scope = {}) {
  return {
    runId: String(scope.runId || "").trim(),
    taskId: String(scope.taskId || "").trim(),
    projectRoot: String(scope.projectRoot || "").trim(),
    prompt: String(scope.prompt || "").trim(),
    analysisTargets: Array.isArray(scope.analysisTargets) ? scope.analysisTargets : extractAnalysisTargets(scope.prompt || ""),
  };
}

function stepMatchesScope(step, scope = {}) {
  if (!scope?.runId && !scope?.taskId) return true;
  if (scope.runId && step?.runId && step.runId !== scope.runId) return false;
  if (scope.taskId && step?.taskId && step.taskId !== scope.taskId) return false;
  if (scope.projectRoot && step?.projectRoot) {
    if (normalizeProjectRoot(step.projectRoot) !== normalizeProjectRoot(scope.projectRoot)) return false;
  }
  return true;
}

function logStaleEvidenceRejection(entry = {}) {
  const safe = {
    code: "STALE_EVIDENCE_REJECTED",
    runId: entry.runId || "",
    taskId: entry.taskId || "",
    projectRoot: entry.projectRoot || "",
    sourceRunId: entry.sourceRunId || "",
    sourceTaskId: entry.sourceTaskId || "",
    evidenceId: entry.evidenceId || "",
    tool: entry.tool || "",
    path: entry.path || "",
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  STALE_EVIDENCE_LOG.push(safe);
  if (STALE_EVIDENCE_LOG.length > 200) STALE_EVIDENCE_LOG.shift();
  return safe;
}

function filterStepsForScope(steps = [], scope = null) {
  if (!scope?.runId && !scope?.taskId) return steps || [];
  const accepted = [];
  for (const step of steps || []) {
    if (!step) continue;
    if (stepMatchesScope(step, scope)) {
      accepted.push(step);
      continue;
    }
    logStaleEvidenceRejection({
      runId: scope.runId,
      taskId: scope.taskId,
      projectRoot: scope.projectRoot,
      sourceRunId: step.runId || "",
      sourceTaskId: step.taskId || "",
      evidenceId: step.resultReference || step.evidenceId || "",
      tool: step.name || "",
      path: step.input?.path || "",
    });
    if (typeof scope.onStaleRejected === "function") {
      scope.onStaleRejected(step);
    }
  }
  return accepted;
}

function dedupeAnalysisTargets(targets = []) {
  const list = [...new Set(targets.map((item) => String(item || "").replace(/\\/g, "/")))].filter(Boolean);
  return list.filter((target) => {
    const lower = target.toLowerCase();
    if (list.some((other) => other !== target && other.toLowerCase().endsWith(`-${lower}`))) return false;
    if (!target.includes("/") && list.some((other) => other !== target && other.endsWith(`/${target}`))) return false;
    return true;
  });
}

function extractAnalysisTargets(prompt = "") {
  const text = String(prompt || "");
  const found = new Set();
  const pathRe = /\b((?:[\w.-]+[\\/])*\w[\w.-]*\.(?:js|ts|tsx|jsx|mjs|cjs|json|py|md))\b/gi;
  for (const match of text.matchAll(pathRe)) {
    const value = String(match[1] || "").replace(/\\/g, "/");
    if (!value) continue;
    if (isDocNoiseTarget(value)) continue;
    found.add(value);
  }
  const baseRe = /\b([\w][\w.-]*\.(?:js|ts|tsx|jsx|mjs|cjs))\b/gi;
  for (const match of text.matchAll(baseRe)) {
    const base = String(match[1] || "");
    if (!base || isDocNoiseTarget(base)) continue;
    found.add(base);
  }
  return dedupeAnalysisTargets([...found]);
}

const TECH_STACK_NAMES = new Set([
  "node.js", "react.js", "vue.js", "three.js", "next.js", "nuxt.js", "deno.js", "bun.js", "nest.js", "express.js", "ember.js", "backbone.js", "chart.js", "d3.js", "socket.io.js"
]);

/** Docs de estado / prohibidos / nombres de tecnologias: nunca son targets de diagnostico. */
function isDocNoiseTarget(value = "") {
  const p = String(value || "").replace(/\\/g, "/");
  if (!p) return true;
  const base = p.split("/").pop().toLowerCase();
  if (TECH_STACK_NAMES.has(base)) return true;
  if (/ANALISIS_ERRORES/i.test(p)) return true;
  if (/(^|\/)\.claude\//i.test(p) || p.startsWith(".claude")) return true;
  if (/(^|\/)ROADMAP\.md$/i.test(p) || /(^|\/)ROADMAP\//i.test(p)) return true;
  return false;
}

/** Prompt que nombra archivos concretos para auditar (no el repo entero). */
function isNamedFileDiagnosticPrompt(prompt = "") {
  const text = String(prompt || "");
  if (!text.trim()) return false;
  const targets = extractAnalysisTargets(text).filter((t) => /\.(?:js|ts|tsx|jsx|mjs|cjs)$/i.test(t));
  if (targets.length < 2) return false;
  if (/\bNO\s+MODIFIC/i.test(text) || /\bMODO:\s*DIAGN/i.test(text)) return true;
  if (/\b(?:audita|diagnostica|analiza|revisa)\b[\s\S]{0,40}\bSOLO\b[\s\S]{0,40}\b(?:estos\s+)?archivos?\b/i.test(text)) {
    return true;
  }
  return targets.length >= 3 && /\b(?:audita|diagnostica|revisa|analiza)\b/i.test(text);
}

function analysisTargetCoverage(prompt = "", evidence = {}) {
  const targets = extractAnalysisTargets(prompt);
  if (!targets.length) {
    return { percent: 100, satisfied: [], missing: [], targets: [] };
  }
  const reads = evidence?.filesRead || [];
  const satisfied = [];
  const missing = [];
  for (const target of targets) {
    const norm = normalizePath(target, evidence?.projectRoot || "");
    const base = basenameOf(target);
    const hit = reads.find((row) => {
      const np = normalizePath(row.path, evidence?.projectRoot || "");
      return np === norm || np.endsWith(`/${norm}`) || basenameOf(row.path) === base;
    });
    if (hit) satisfied.push(target);
    else missing.push(target);
  }
  const percent = Math.round((satisfied.length / targets.length) * 100);
  return { percent, satisfied, missing, targets };
}

function collapseDuplicateReportSections(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const sections = raw.split(/(?=##\s*(?:An[aá]lisis|Reporte\s+Final|Hallazgos verificados|Evidencia real))/i);
  if (sections.length <= 1) return raw;
  const seen = new Set();
  const kept = [];
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const part = sections[i].trim();
    if (!part) continue;
    const key = part.slice(0, 160).replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.unshift(part);
  }
  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizePath(value = "", projectRoot = "") {
  let raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw) return "";
  if (projectRoot) {
    try {
      const absolute = path.resolve(/^[A-Za-z]:|^\\\\/.test(raw) ? raw : path.join(projectRoot, raw));
      const relative = path.relative(path.resolve(projectRoot), absolute).replace(/\\/g, "/");
      if (relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)) {
        raw = relative;
      }
    } catch {
      // keep raw
    }
  }
  return raw.replace(/^\/+/, "").toLowerCase();
}

function basenameOf(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function isShallowPath(value) {
  const raw = String(value || "").trim();
  return !raw || raw === "." || raw === "./" || raw === "/" || /^[A-Za-z]:[\\/]?$/.test(raw);
}

/** Docs de estado / ruido: no cuentan como evidencia de codigo. */
function isDocNoisePath(value) {
  const p = String(value || "").replace(/\\/g, "/");
  if (!p) return true;
  // Memoria/chat interno de EDITCOREAI: NUNCA es codigo del producto bajo analisis.
  if (/(^|\/)\.editcore(\/|$)/i.test(p)) return true;
  if (/(^|\/)ROADMAP(\/|$)/i.test(p) || /(^|\/)ROADMAP\.md$/i.test(p)) return true;
  if (/ANALISIS_ERRORES/i.test(p)) return true;
  if (/\.claude\//i.test(p) && /\.md$/i.test(p)) return true;
  if (/(^|\/)README\.md$/i.test(p)) return true;
  // Vendor / generados / PWA minificado: no son bugs del producto a "corregir".
  if (isVendorOrGeneratedPath(p)) return true;
  // Reportes/estado previos (.md): no son codigo fuente del proyecto bajo analisis.
  if (/\.md$/i.test(p)) {
    const base = (p.split("/").pop() || "").toLowerCase();
    if (/^(reporte|correcciones|estado|resumen|activacion|integracion|capacidades|instrucciones|propuesta|guia_|panel_|nuevas_|codigo_referencia)/i.test(base)) {
      return true;
    }
    if (/analisis|forensic|hallazgos|diagnostic|correcciones-aplicadas|reporte-analisis/i.test(base)) {
      return true;
    }
  }
  return false;
}

/** Workbox, service workers generados, bundles minificados, stubs de Next. */
function isVendorOrGeneratedPath(filePath = "", content = "") {
  const p = String(filePath || "").replace(/\\/g, "/");
  if (!p) return true;
  if (/(^|\/)workbox[^/]*\.js$/i.test(p) || /workbox-/i.test(p)) return true;
  if (/(^|\/)sw\.js$/i.test(p) && /(^|\/)public\//i.test(p)) return true;
  if (/\.min\.(js|css|mjs|cjs)$/i.test(p)) return true;
  if (/(^|\/)next-env\.d\.ts$/i.test(p)) return true;
  if (/(^|\/)(vendor|third[_-]?party|generated|__generated__)\//i.test(p)) return true;
  if (/(^|\/)public\/.*-[a-f0-9]{6,}\.(js|css)$/i.test(p)) return true;
  const text = String(content || "");
  // Blob minificado de 1-3 lineas: no es fuente editable del proyecto.
  if (text.length > 500) {
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount <= 3) return true;
  }
  return false;
}

const SKIP_WALK_DIR_RE = /^(node_modules|\.git|dist|build|\.next|coverage|\.turbo|out|\.cache|vendor|__pycache__|\.venv|venv|\.editcore|\.claude|ROADMAP|Pods|\.expo|\.idea|\.vscode|android\/\.gradle)$/i;
const CODE_SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|swift|cs|php)$/i;
const CODE_CONFIG_RE = /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|[^/]+\.config\.(js|ts|mjs|cjs))$/i;
const PRIORITY_WALK_DIR_RE = /^(src|app|apps|api|packages|pages|components|lib|runtime|resources|resources\/app|resources\/app\/runtime|server|backend|frontend|web|mobile|android|ios)(\/|$)/i;

/** Carpetas de build/deps/docs que el walker no debe abrir. */
function isSkippableWalkDir(value) {
  const p = String(value || "").replace(/\\/g, "/");
  if (!p) return false;
  const parts = p.split("/").filter(Boolean);
  return parts.some((part) => SKIP_WALK_DIR_RE.test(part));
}

/** Archivo de codigo/config util para evidencia forense (no docs de estado). */
function isCodeSourcePath(value) {
  const p = String(value || "").replace(/\\/g, "/");
  if (!p || isDocNoisePath(p) || isSkippableWalkDir(p)) return false;
  return CODE_SOURCE_RE.test(p) || CODE_CONFIG_RE.test(p);
}

function rankWalkDir(value) {
  const p = String(value || "").replace(/\\/g, "/");
  if (!p || p === ".") return 0;
  if (PRIORITY_WALK_DIR_RE.test(p)) return 0;
  if (/^(test|tests|__tests__|spec|e2e)(\/|$)/i.test(p)) return 2;
  return 1;
}

function listedDirectoryTargets(evidence = {}) {
  const dirs = new Set();
  for (const item of evidence.toolLog || []) {
    if (String(item.name || "") !== "list_files" || item.ok === false) continue;
    const p = String(item.path || "").replace(/\\/g, "/").replace(/\/$/, "");
    dirs.add(p || ".");
  }
  return [...dirs];
}

/**
 * Mapa de cobertura carpeta/archivo del run actual.
 * dirsListed = list_files reales (no solo nombres vistos en un listing).
 */
function buildAnalysisCoverageMap(evidence = {}, options = {}) {
  let depthProfile = options.depthProfile || null;
  if (!depthProfile) {
    try { depthProfile = require("./analysis-depth").resolveAnalysisDepth(options.prompt || ""); }
    catch { depthProfile = null; }
  }
  // scopedFocus: minListedDirs puede ser 0 (no forzar list_files de carpetas).
  const minDirs = depthProfile?.scopedFocus
    ? Math.max(0, Number(depthProfile.minListedDirs ?? 0))
    : Math.max(1, Number(depthProfile?.minListedDirs ?? 1));
  const minReads = depthProfile?.scopedFocus
    ? Math.max(1, Number(depthProfile.minCodeReads ?? 1))
    : Math.max(1, Number(depthProfile?.minCodeReads || requiredConcreteReads(evidence, { ...options, depthProfile }) || 1));
  const minSearches = Math.max(0, Number(depthProfile?.minSearches || 0));
  const dirCap = Math.max(minDirs, Number(depthProfile?.maxWalkDirs || Math.max(minDirs * 2, 1)));

  const dirsListed = listedDirectoryTargets(evidence);
  const listedSet = new Set(dirsListed.map((d) => d.toLowerCase()));

  const pendingDirs = [];
  const codeFilesDiscovered = [];
  for (const row of evidence.listed || []) {
    const p = String(row.path || "").replace(/\\/g, "/");
    if (!p || isSkippableWalkDir(p)) continue;
    const isDir = row.kind === "directory" || (!looksLikeFilePath(p) && row.kind !== "file");
    if (isDir) {
      if (!listedSet.has(p.toLowerCase()) && p !== ".") pendingDirs.push(p);
      continue;
    }
    if (isCodeSourcePath(p)) codeFilesDiscovered.push(p);
  }

  pendingDirs.sort((a, b) => rankWalkDir(a) - rankWalkDir(b) || a.length - b.length || a.localeCompare(b));
  const uniquePending = [...new Set(pendingDirs)];
  const uniqueCode = [...new Set(codeFilesDiscovered)];

  const readNorm = new Set((evidence.filesRead || []).map((row) => String(row.normalized || row.path || "").replace(/\\/g, "/").toLowerCase()));
  const codeFilesRead = (evidence.filesRead || [])
    .map((row) => String(row.path || "").replace(/\\/g, "/"))
    .filter((p) => isCodeSourcePath(p));
  const unreadCodeFiles = uniqueCode
    .filter((p) => !readNorm.has(p.toLowerCase()) && !readNorm.has(normalizePath(p, evidence.projectRoot || "").toLowerCase()))
    .sort((a, b) => {
      const rank = (value) => {
        if (/^src\//i.test(value) || /^app\//i.test(value)) return 0;
        if (CODE_CONFIG_RE.test(value)) return 1;
        if (/\/(page|layout|route|index|store|client)\./i.test(value)) return 2;
        if (/^public\//i.test(value)) return 9;
        return 3;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    });

  const searchCount = (evidence.searches || []).length
    || (evidence.toolLog || []).filter((item) => SEARCH_TOOLS.has(item.name) && item.ok).length;

  const dirsListedCount = dirsListed.length;
  const codeReadCount = Math.max(codeFilesRead.length, Number(evidence.realFileReadCount || 0));
  // minDirs=0 (FOCO) no debe producir NaN% (x/0).
  const dirScore = minDirs <= 0 ? 1 : Math.min(1, dirsListedCount / minDirs);
  const readScore = minReads <= 0 ? 1 : Math.min(1, codeReadCount / minReads);
  const searchScore = minSearches > 0 ? Math.min(1, searchCount / minSearches) : 1;
  const percent = Math.round(((dirScore * 0.4) + (readScore * 0.45) + (searchScore * 0.15)) * 100);

  const reasons = [];
  if (dirsListedCount < minDirs && uniquePending.length > 0) {
    reasons.push(`Cobertura carpetas ${dirsListedCount}/${minDirs}. Pendientes: ${uniquePending.slice(0, 8).join(", ") || "(ninguna descubierta)"}`);
  }
  if (codeReadCount < minReads) {
    reasons.push(`Cobertura lecturas codigo ${codeReadCount}/${minReads}. Sin leer: ${unreadCodeFiles.slice(0, 8).join(", ") || "(explora mas carpetas)"}`);
  }
  if (searchCount < minSearches) {
    reasons.push(`Cobertura busquedas ${searchCount}/${minSearches}.`);
  }
  if (depthProfile?.folderByFolder && uniquePending.length && dirsListedCount < dirCap && unreadCodeFiles.length < 2 && codeReadCount < minReads) {
    reasons.push(`Quedan carpetas sin explorar (cap ${dirCap}): ${uniquePending.slice(0, 6).join(", ")}`);
  }

  return {
    dirsListed,
    dirsListedCount,
    pendingDirs: uniquePending,
    codeFilesDiscovered: uniqueCode,
    codeFilesRead,
    unreadCodeFiles,
    searchCount,
    minDirs,
    minReads,
    minSearches,
    dirCap,
    percent,
    ok: reasons.length === 0,
    reasons,
    summary: `Cobertura: ${dirsListedCount}/${minDirs} carpetas, ${codeReadCount}/${minReads} archivos, ${searchCount}/${minSearches} busquedas (${percent}%).`,
  };
}

/**
 * Nota incremental para el chat (estilo Cursor): 1 tool → avance visible → siguiente.
 * No es el reporte final; es el progreso archivo/carpeta a archivo/carpeta.
 */
function formatIncrementalAnalysisNote(name = "", toolInput = {}, result = {}) {
  const tool = String(name || "");
  const rel = String(toolInput.path || toolInput.filePath || "").replace(/\\/g, "/") || ".";
  const label = rel === "." || !rel ? "raíz" : rel;
  if (tool === "list_files") {
    const entries = Array.isArray(result) ? result : (result?.entries || []);
    const dirs = [];
    const files = [];
    for (const entry of entries) {
      const p = String(entry?.path || entry?.name || "").replace(/\\/g, "/");
      if (!p) continue;
      const base = p.split("/").filter(Boolean).pop() || p;
      if (entry?.kind === "directory" || /\/$/.test(p)) dirs.push(base);
      else files.push(base);
    }
    return [
      `### Avance — listé \`${label}\``,
      dirs.length ? `- Carpetas: ${dirs.slice(0, 10).join(", ")}` : "- Carpetas: (ninguna)",
      files.length ? `- Archivos: ${files.slice(0, 12).join(", ")}` : "- Archivos: (ninguno)",
      "",
    ].join("\n");
  }
  if (tool === "read_file") {
    const content = String(result?.content != null ? result.content : (typeof result === "string" ? result : ""));
    const lineCount = content ? content.split(/\r?\n/).length : 0;
    const todos = (content.match(/\b(?:TODO|FIXME|XXX|HACK)\b/g) || []).length;
    const symbols = [];
    const re = /(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)|(?:^|\n)\s*(?:async\s+)?function\s+(\w+)|(?:^|\n)\s*class\s+(\w+))/g;
    let match;
    while ((match = re.exec(content)) && symbols.length < 6) {
      const sym = match[1] || match[2] || match[3];
      if (sym && !symbols.includes(sym)) symbols.push(sym);
    }
    const preview = content.replace(/\s+/g, " ").trim().slice(0, 140);
    return [
      `### Avance — leí \`${label}\`${lineCount ? ` (${lineCount} líneas)` : ""}`,
      symbols.length ? `- Símbolos: ${symbols.join(", ")}` : null,
      todos ? `- Marcadores TODO/FIXME: ${todos}` : null,
      preview ? `- Vista: \`${preview}${content.length > 140 ? "…" : ""}\`` : "- (sin contenido de texto)",
      "",
    ].filter(Boolean).join("\n");
  }
  if (tool === "search_files") {
    const query = String(toolInput.query || toolInput.pattern || "").slice(0, 80);
    const matches = Array.isArray(result?.matches) ? result.matches : (Array.isArray(result) ? result : []);
    const sample = matches.slice(0, 6).map((row) => {
      if (typeof row === "string") return row;
      return String(row?.path || row?.file || row?.name || "").replace(/\\/g, "/");
    }).filter(Boolean);
    return [
      `### Avance — busqué \`${query || "?"}\``,
      `- Coincidencias: ${matches.length}${sample.length ? ` → ${sample.join(", ")}` : ""}`,
      "",
    ].join("\n");
  }
  return "";
}

/** Proximas acciones deterministas del walker: UNA sola por paso (no saturar). */
function nextAnalysisWalkActions(evidence = {}, options = {}) {
  const map = buildAnalysisCoverageMap(evidence, options);
  if (map.dirsListedCount < map.dirCap && map.pendingDirs.length) {
    const dir = map.pendingDirs[0];
    return [{ name: "list_files", input: { path: dir === "." ? "" : dir } }];
  }
  const needReads = Math.max(0, map.minReads - Math.max(map.codeFilesRead.length, Number(evidence.realFileReadCount || 0)));
  if (needReads > 0 && map.unreadCodeFiles.length) {
    return [{ name: "read_file", input: { path: map.unreadCodeFiles[0] } }];
  }
  // Si faltan lecturas pero no hay candidatos: seguir abriendo carpetas pendientes bajo cap.
  if (needReads > 0 && map.pendingDirs.length && map.dirsListedCount < map.dirCap) {
    const dir = map.pendingDirs[0];
    return [{ name: "list_files", input: { path: dir === "." ? "" : dir } }];
  }
  if (map.searchCount < map.minSearches) {
    const defaultQuery = "TODO|FIXME|throw new|@ts-ignore|eslint-disable";
    const alreadyDone = (evidence.searches || []).includes(defaultQuery)
      || (evidence.toolLog || []).some((item) => item.name === "search_files" && item.input?.query === defaultQuery);
    if (!alreadyDone) {
      return [{ name: "search_files", input: { query: defaultQuery } }];
    }
  }
  return [];
}

function formatCoverageBlock(evidence = {}, options = {}) {
  const map = buildAnalysisCoverageMap(evidence, options);
  return [
    "COVERAGE_MAP",
    map.summary,
    map.dirsListed.length ? `Carpetas listadas: ${map.dirsListed.join(", ")}` : "Carpetas listadas: (ninguna)",
    map.pendingDirs.length ? `Carpetas pendientes: ${map.pendingDirs.slice(0, 12).join(", ")}` : "Carpetas pendientes: ninguna",
    map.unreadCodeFiles.length ? `Codigo sin leer: ${map.unreadCodeFiles.slice(0, 12).join(", ")}` : "Codigo sin leer: ninguno descubierto",
    ...(map.reasons.length ? ["Bloqueos:", ...map.reasons.map((r) => `- ${r}`)] : ["Estado: cobertura minima alcanzada."]),
  ].join("\n");
}

function isDeepProjectAnalysisPrompt(prompt = "") {
  const text = String(prompt || "");
  return /\b(?:analiz(?:a|ame|ar)|reanaliza|audita|diagnostica|inspecciona|explora)\b/i.test(text)
    && /\b(?:proyecto|hallazgos|errores|reporte|completo|profundo|codigo|c[oó]digo|src|api)\b/i.test(text);
}

function looksLikeFilePath(value) {
  return /\.[A-Za-z0-9]{1,12}$/.test(String(value || "").replace(/\\/g, "/").split("/").pop() || "");
}

function extractListedPaths(result) {
  const out = [];
  if (!result || typeof result !== "object") return out;
  const push = (item) => {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item === "object") {
      const candidate = item.path || item.name || item.file || item.relativePath;
      if (candidate) out.push(String(candidate));
    }
  };
  if (Array.isArray(result.entries)) result.entries.forEach(push);
  if (Array.isArray(result.files)) result.files.forEach(push);
  if (Array.isArray(result.sample)) result.sample.forEach(push);
  if (Array.isArray(result.tree)) result.tree.forEach(push);
  if (Array.isArray(result.roots)) result.roots.forEach(push);
  if (Array.isArray(result.directories)) result.directories.forEach(push);
  if (Array.isArray(result)) result.forEach(push);
  if (typeof result.summary === "string") {
    for (const match of result.summary.matchAll(/\b[\w./\\-]+\.[A-Za-z0-9]{1,8}\b/g)) out.push(match[0]);
  }
  return out;
}

function contentSnippet(result) {
  if (typeof result === "string") return result.slice(0, 8000);
  if (!result || typeof result !== "object") return "";
  const content = result.content || result.text || result.preview || "";
  return String(content || "").slice(0, 8000);
}

function contentHash(value) {
  const text = String(value || "");
  if (!text) return "";
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Extractos forenses que sobreviven a compactacion: firmas y early-exits,
 * no solo path+length (eso provocaba informes "Falta informacion...").
 */
function extractForensicExcerpts(filePath = "", content = "", maxItems = 14) {
  const text = String(content || "");
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const excerpts = [];
  // package.json / JSON de manifiesto: name, description, scripts (no son "function class").
  if (/\.json$/i.test(String(filePath || "")) || /^\s*\{/.test(text.trim())) {
    const jsonInteresting = /"(?:name|description|version|main|scripts|dependencies|devDependencies)"\s*:/;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!jsonInteresting.test(line)) continue;
      const trimmed = line.trim();
      if (trimmed.length < 5) continue;
      excerpts.push({ path: filePath, line: i + 1, text: trimmed.slice(0, 180) });
      if (excerpts.length >= maxItems) break;
    }
    if (excerpts.length) return excerpts;
  }
  const interesting = /(?:^|\s)(?:async\s+)?function\s+\w+|(?:^|\s)class\s+\w+|(?:exports\.|module\.exports)|return\s+(?:false|true|null|undefined|""|''|\{)|throw\s+new|\.abort\(|signal\.aborted|completed\s*=|analysisMode|authorize\s*\(|skipBrain|evidenceFinalText|Verificacion completada|maxIterations|runDeadline|ActionRegistry|wasExecuted|planAuthorized|directReadOnly|break\s*;|continue\s*;|stopReason|incompleteResult|finalizeAnalysis|compact\s*\(/i;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!interesting.test(line)) continue;
    const trimmed = line.trim();
    if (trimmed.length < 8) continue;
    excerpts.push({ path: filePath, line: i + 1, text: trimmed.slice(0, 180) });
    if (excerpts.length >= maxItems) break;
  }
  return excerpts;
}

function formatForensicExcerptsBlock(evidence = {}) {
  const lines = ["FORENSIC_EXCERPTS (usar estos extractos; PROHIBIDO decir que falta el contenido fuente de estos paths):"];
  let count = 0;
  for (const file of evidence.filesRead || []) {
    if (isVendorOrGeneratedPath(file.path, file.content)) continue;
    const excerpts = Array.isArray(file.forensicExcerpts) && file.forensicExcerpts.length
      ? file.forensicExcerpts
      : extractForensicExcerpts(file.path, file.content);
    if (!excerpts.length) continue;
    lines.push(`### ${file.path}`);
    for (const item of excerpts.slice(0, 10)) {
      lines.push(`- L${item.line}: ${item.text}`);
      count += 1;
    }
  }
  if (!count) lines.push("- (sin extractos estructurales en el contenido leido)");
  return lines.join("\n");
}

/** Informe forense hueco: meta-cierre, "Falta informacion" / NO-GO sin citar codigo real. */
function isHollowAnalysisReport(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return true;
  // Cierre meta del runtime: nunca es un informe forense valido.
  if (/Verificacion completada con evidencia real/i.test(raw)) return true;
  const falta = (raw.match(/Falta informaci[oó]n(?:\s+(?:crucial|en\s+el\s+contexto))?/gi) || []).length;
  const nogo = /\bNO-GO\b/i.test(raw) || /NO EXISTE EVIDENCIA SUFICIENTE/i.test(raw);
  const deniesContent = /contenido (?:fuente|real) no (?:fue incluido|est[aá]|esta)|no aportan evidencia forense|metadatos de archivos le[ií]dos|sin detalle de l[ií]nea retenido|no conserva funciones ni n[uú]meros de l[ií]nea|sin acceso al c[oó]digo|no se incluye el contenido real|Limitaciones de Informaci[oó]n/i.test(raw);
  const hasCodeCite = /(?:^|\n)\s*(?:function|class|const|let|exports)\s+\w+|```|L\d+:|linea\s*~?\d+|:\d{1,5}\b/i.test(raw);
  // Frankenstein: varios encabezados de reporte solapados sin citas de codigo.
  const reportHeaders = (raw.match(/^#{1,3}\s*(?:REPORTE|Informe|An[aá]lisis)/gim) || []).length;
  if (reportHeaders >= 3 && !hasCodeCite) return true;
  // Un solo "Falta informacion" + negar contenido = informe inventado (caso TAXIDRIV 0s).
  if (falta >= 1 && deniesContent && !hasCodeCite) return true;
  if (/Falta informaci[oó]n crucial/i.test(raw) && !hasCodeCite) return true;
  if (falta >= 4 && !hasCodeCite) return true;
  if (nogo && (falta >= 2 || deniesContent) && !hasCodeCite) return true;
  if (deniesContent && falta >= 2) return true;
  return false;
}

function scanContentFindings(filePath, content) {
  const findings = [];
  const text = String(content || "");
  if (isVendorOrGeneratedPath(filePath, text)) return [];
  const lines = text.split(/\r?\n/);
  // No usar TODO/FIXME de .md de analisis como "hallazgo forense" del runtime.
  const isDocNoise = /\.md$/i.test(String(filePath || "")) || /ANALISIS_ERRORES|\.claude[\\/]/i.test(String(filePath || ""));
  const patterns = [
    { re: /function\s+suma\s*\([^)]*\)\s*\{[\s\S]*?return\s+a\s*-\s*b/i, label: "La funcion suma resta en lugar de sumar (return a - b)" },
    ...(isDocNoise ? [] : [{ re: /\bTODO\b|\bFIXME\b|\bHACK\b/i, label: "Marcador pendiente (TODO/FIXME) en el archivo" }]),
    { re: /eslint-disable/i, label: "Regla de lint desactivada localmente" },
    { re: /@ts-ignore|@ts-nocheck/i, label: "Chequeo TypeScript ignorado" },
    // Solo catch vacio en fuente legible (no minificado).
    { re: /catch\s*\([^)]*\)\s*\{\s*\}/, label: "catch vacio (errores silenciados)", requireReadable: true },
  ];
  const readableSource = lines.length >= 4 && text.length < 200_000;
  for (const pattern of patterns) {
    if (pattern.requireReadable && !readableSource) continue;
    if (pattern.re.test(text)) {
      const lineIdx = lines.findIndex((line) => pattern.re.test(line) || /return\s+a\s*-\s*b/.test(line));
      findings.push({
        path: filePath,
        line: lineIdx >= 0 ? lineIdx + 1 : 1,
        label: pattern.label,
        evidence: (lines[lineIdx] || text.slice(0, 120)).trim().slice(0, 160),
      });
    }
  }
  return findings.slice(0, 8);
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = keyFn(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function buildEvidenceLedger(steps = [], projectRoot = "", scope = null) {
  const scoped = filterStepsForScope(steps, scope);
  const ledger = [];
  for (let index = 0; index < scoped.length; index += 1) {
    const step = scoped[index];
    const operation = String(step?.name || "");
    const success = step?.ok !== false && !step?.result?.error;
    const filePath = String(step?.input?.path || "").trim();
    const snippet = contentSnippet(step?.result);
    ledger.push({
      seq: index + 1,
      runId: step?.runId || scope?.runId || "",
      taskId: step?.taskId || scope?.taskId || "",
      projectRoot: step?.projectRoot || scope?.projectRoot || projectRoot || "",
      path: filePath || null,
      operation,
      success,
      status: success ? "COMPLETED" : "FAILED",
      query: String(step?.input?.query || "").trim() || null,
      command: String(step?.input?.command || "").trim() || null,
      error: String(step?.result?.error || "").slice(0, 240) || null,
      contentHash: snippet ? contentHash(snippet) : null,
      contentLength: snippet ? snippet.length : 0,
      evidenceId: snippet ? contentHash(snippet) : null,
      timestamp: step?.completedAt || step?.startedAt || null,
    });
  }
  return { projectRoot, runId: scope?.runId || "", taskId: scope?.taskId || "", entries: ledger };
}

function collectToolEvidence(steps = [], projectRoot = "", scope = null) {
  const normalizedScope = scope ? normalizeRunScope(scope) : null;
  const scopedSteps = filterStepsForScope(steps, normalizedScope);
  const filesRead = [];
  const filesMutated = [];
  const listed = [];
  const searches = [];
  const verifications = [];
  const findings = [];
  const toolLog = [];
  const ledger = buildEvidenceLedger(scopedSteps, projectRoot, normalizedScope);

  for (const step of scopedSteps) {
    const name = String(step?.name || "");
    const ok = step?.ok !== false && !step?.result?.error;
    const inputPath = String(step?.input?.path || "").trim();
    const query = String(step?.input?.query || "").trim();
    const command = String(step?.input?.command || "").trim();
    toolLog.push({
      name,
      ok,
      path: inputPath,
      query,
      command,
      error: String(step?.result?.error || "").slice(0, 200),
    });
    if (!ok) continue;

    if (READ_TOOLS.has(name) && inputPath && !isShallowPath(inputPath) && !isDocNoisePath(inputPath) && step?.result?.isDirectory !== true) {
      const snippet = contentSnippet(step.result);
      const forensicExcerpts = extractForensicExcerpts(inputPath, snippet);
      filesRead.push({
        path: inputPath,
        normalized: normalizePath(inputPath, projectRoot),
        basename: basenameOf(inputPath),
        content: snippet,
        contentHash: contentHash(snippet),
        forensicExcerpts,
      });
      findings.push(...scanContentFindings(inputPath, snippet));
    }
    if (MUTATION_TOOLS.has(name)) {
      if (inputPath) {
        filesMutated.push({
          path: inputPath,
          normalized: normalizePath(inputPath, projectRoot),
          tool: name,
          content: String(step?.input?.content || step?.input?.newText || ""),
          oldText: String(step?.input?.oldText || ""),
          newText: String(step?.input?.newText || ""),
        });
      } else {
        filesMutated.push({
          path: `[${name}]`,
          normalized: `[${name}]`,
          tool: name,
          content: "",
          oldText: "",
          newText: "",
        });
      }
    }
    if (LIST_TOOLS.has(name)) {
      const resultEntries = Array.isArray(step?.result)
        ? step.result
        : (Array.isArray(step?.result?.entries) ? step.result.entries : null);
      if (Array.isArray(resultEntries)) {
        for (const item of resultEntries) {
          if (typeof item === "string" && item.trim()) {
            const p = item.trim().replace(/\\/g, "/");
            listed.push({
              path: p,
              normalized: normalizePath(p, projectRoot),
              basename: basenameOf(p),
              kind: looksLikeFilePath(p) ? "file" : "directory",
            });
          } else if (item && typeof item === "object") {
            const candidate = String(item.path || item.name || item.file || item.relativePath || "").trim();
            if (!candidate) continue;
            const p = candidate.replace(/\\/g, "/");
            const kind = item.kind === "directory" || item.isDirectory === true
              ? "directory"
              : (item.kind === "file" || looksLikeFilePath(p) ? "file" : "directory");
            listed.push({
              path: p,
              normalized: normalizePath(p, projectRoot),
              basename: basenameOf(p),
              kind,
            });
          }
        }
      } else {
        for (const item of extractListedPaths(step.result)) {
          listed.push({
            path: item,
            normalized: normalizePath(item, projectRoot),
            basename: basenameOf(item),
            kind: looksLikeFilePath(item) ? "file" : "directory",
          });
        }
      }
      if (inputPath && !isShallowPath(inputPath)) {
        listed.push({
          path: inputPath,
          normalized: normalizePath(inputPath, projectRoot),
          basename: basenameOf(inputPath),
          kind: "directory",
        });
      }
    }
    if (SEARCH_TOOLS.has(name) && query) searches.push(query);
    if (VERIFY_TOOLS.has(name)) {
      const diagnosticFailed = (() => {
        const result = step?.result;
        if (result && typeof result === "object" && result.diagnostic === true && result.passed === false) return true;
        const text = String(result?.output || result?.summary || (typeof result === "string" ? result : "") || "");
        const match = /verificacion finalizado con exit\s+(\d+)/i.exec(text);
        return match ? Number(match[1]) !== 0 : false;
      })();
      verifications.push({
        name,
        command: command || String(step?.input?.url || ""),
        output: String(step?.result?.output || step?.result?.summary || (typeof step?.result === "string" ? step.result : "") || "").replace(/\s+/g, " ").slice(0, 300),
        ok: ok && !diagnosticFailed,
        passed: ok && !diagnosticFailed,
        diagnosticFailed,
      });
      if (command) {
        try {
          const { isAcotadoDiagnosticCommand } = require("../command-policy");
          if (isAcotadoDiagnosticCommand(command)) {
            findings.push(...extractDiagnosticFindings([{
              name: "run_command",
              input: { command },
              result: step.result,
              ok,
            }]));
          }
        } catch { /* ignore */ }
      }
    }
    if (READ_TOOLS.has(name) && filesMutated.length && inputPath) {
      verifications.push({
        name: "read_file",
        command: inputPath,
        output: "archivo releido tras mutacion",
        ok,
        path: inputPath,
        content: contentSnippet(step.result),
      });
    }
  }

  const evidence = {
    projectRoot,
    runId: normalizedScope?.runId || "",
    taskId: normalizedScope?.taskId || "",
    analysisTargets: normalizedScope?.analysisTargets || [],
    ledger,
    filesRead: uniqueBy(filesRead, (row) => row.normalized || row.path.toLowerCase()),
    filesMutated: uniqueBy(filesMutated, (row) => row.normalized || row.path.toLowerCase()),
    listed: uniqueBy(listed, (row) => row.normalized || row.path.toLowerCase()),
    searches: [...new Set(searches)].slice(0, 40),
    verifications,
    findings: findings.slice(0, 40),
    toolLog,
  };
  evidence.realFileReadCount = evidence.filesRead.length;
  evidence.mutationCount = evidence.filesMutated.length;
  evidence.listedFileCount = evidence.listed.filter((item) => item.kind === "file" || looksLikeFilePath(item.path)).length;
  evidence.requiredConcreteReads = requiredConcreteReads(evidence, { targets: normalizedScope?.analysisTargets });
  evidence.coverage = buildAnalysisCoverageMap(evidence, {
    prompt: normalizedScope?.prompt || "",
    targets: normalizedScope?.analysisTargets,
  });
  return evidence;
}

/**
 * Regla adaptativa: si el prompt nombra archivos concretos, exige solo esos.
 * Analisis de proyecto / hallazgos: exige muchas lecturas de codigo real.
 */
function requiredConcreteReads(evidence, options = {}) {
  let depthProfile = options.depthProfile || null;
  if (!depthProfile) {
    try { depthProfile = require("./analysis-depth").resolveAnalysisDepth(options.prompt || ""); }
    catch { depthProfile = null; }
  }
  const targets = options.targets || evidence?.analysisTargets || [];
  const minFromDepth = Number(depthProfile?.minCodeReads || 0);
  if (targets.length) return Math.max(targets.length, minFromDepth || 0);
  const listedFiles = Math.max(
    Number(evidence.listedFileCount || 0),
    Number(evidence.realFileReadCount || 0),
  );
  if (listedFiles === 0) {
    const hasListTool = (evidence.toolLog || []).some((item) => ["list_files", "project_discovery"].includes(item.name) && item.ok !== false);
    if (hasListTool) return 0;
  }
  if (minFromDepth > 0) {
    // No exigir mas lecturas que archivos de codigo descubiertos (adaptive).
    if (listedFiles > 0 && listedFiles < minFromDepth) {
      return Math.max(1, listedFiles);
    }
    if (listedFiles >= 80) return Math.max(minFromDepth, 20);
    if (listedFiles >= 40) return Math.max(minFromDepth, 16);
    if (listedFiles >= 20) return Math.max(minFromDepth, 12);
    return Math.max(minFromDepth, Math.min(listedFiles || minFromDepth, minFromDepth));
  }
  if (listedFiles === 0) return 0;
  if (listedFiles <= 1) return 1;
  if (listedFiles === 2) return 2;
  return 4;
}

function analysisEvidenceSufficient(evidence, options = {}) {
  if (options.promptOnlyMode === true) {
    return { ok: true, reasons: [], required: 0 };
  }
  let depthProfile = options.depthProfile || null;
  if (!depthProfile) {
    try { depthProfile = require("./analysis-depth").resolveAnalysisDepth(options.prompt || ""); }
    catch { depthProfile = null; }
  }
  const reasons = [];
  const prompt = String(options.prompt || "");
  // FOCO acotado: basta leer el/los archivo(s) permitidos; no exigir walker.
  if (depthProfile?.scopedFocus) {
    const required = Math.max(1, Number(depthProfile.minCodeReads || 1));
    const codeReads = Number(evidence.realFileReadCount || 0);
    if (codeReads >= required) {
      return { ok: true, reasons: [], required, depth: depthProfile.depth || "surface" };
    }
    reasons.push(`FOCO: se requiere leer ${required} archivo(s); hay ${codeReads}.`);
    return { ok: false, reasons, required, depth: depthProfile.depth || "surface" };
  }
  const deep = Boolean(depthProfile && ["deep", "surgical", "forensic", "exhaustive"].includes(depthProfile.depth));
  const targets = options.targets || evidence?.analysisTargets || extractAnalysisTargets(prompt);
  if (targets.length && !deep) {
    const coverage = analysisTargetCoverage(prompt || targets.join(" "), evidence);
    if (coverage.percent >= 100) {
      return { ok: true, reasons: [], required: targets.length, coverage };
    }
    reasons.push(`Faltan archivos objetivo del analisis: ${coverage.missing.join(", ")}.`);
    return { ok: false, reasons, required: targets.length, coverage };
  }
  const hasDiscovery = (evidence.listed || []).length > 0
    || (evidence.searches || []).length > 0
    || (evidence.toolLog || []).some((item) => LIST_TOOLS.has(item.name) || SEARCH_TOOLS.has(item.name));
  const required = requiredConcreteReads(evidence, { ...options, prompt, depthProfile });
  const codeReads = Number(evidence.realFileReadCount || 0);
  if (!hasDiscovery && codeReads < 1 && required > 0) {
    reasons.push("Falta descubrimiento (list_files/search/project_discovery) o lectura concreta.");
  }
  if (codeReads < required) {
    reasons.push(`Se requieren ${required} archivo(s) de codigo leidos con read_file; hay ${codeReads}.`);
  }
  if (deep && depthProfile) {
    const map = buildAnalysisCoverageMap(evidence, { prompt, targets, depthProfile });
    const searchCount = map.searchCount;
    const minSearches = Number(depthProfile.minSearches || 0);
    if (searchCount < minSearches) {
      reasons.push(`${depthProfile.label}: faltan al menos ${minSearches} search_files/symbol_search.`);
    }
    if (map.dirsListedCount < map.minDirs && map.pendingDirs.length > 0) {
      reasons.push(`${depthProfile.label}: explora carpeta por carpeta (minimo ${map.minDirs} list_files reales; hay ${map.dirsListedCount}). Pendientes: ${map.pendingDirs.slice(0, 6).join(", ") || "ninguna"}`);
    }
    if (depthProfile.folderByFolder && map.pendingDirs.length && map.dirsListedCount < map.dirCap && map.unreadCodeFiles.length < 2 && codeReads < required) {
      reasons.push(`${depthProfile.label}: quedan carpetas sin explorar: ${map.pendingDirs.slice(0, 6).join(", ")}`);
    }
  }
  return { ok: reasons.length === 0, reasons, required, depth: depthProfile?.depth || "standard" };
}

function knownPathSet(evidence) {
  const set = new Set();
  for (const row of [...(evidence.filesRead || []), ...(evidence.listed || []), ...(evidence.filesMutated || [])]) {
    if (row.normalized) set.add(row.normalized);
    if (row.basename) set.add(row.basename);
    const parts = String(row.normalized || "").split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) set.add(parts.slice(0, i).join("/"));
    if (parts[0]) set.add(parts[0]);
  }
  return set;
}

function extractClaimedPaths(report = "") {
  const text = String(report || "");
  const claimed = [];
  const patterns = [
    /\b((?:[A-Za-z]:)?(?:[\\/][\w.@-]+)+\.[A-Za-z0-9]{1,10})\b/g,
    /\b((?:src|app|lib|components|pages|api|public|scripts|test|tests|backend|frontend|uploads|server|client)(?:[\\/][\w.@-]+)+)\b/gi,
    /\b((?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,10})\b/g,
    /^\s*[├└│].*?([A-Za-z0-9_.-]+\/)\s/gm,
    /\b(backend|frontend|uploads|server|client)(?:\/|\b)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] || "").replace(/\\/g, "/").replace(/\/+$/, "");
      if (value) claimed.push(value);
    }
  }
  return [...new Set(claimed.map((item) => item.replace(/\\/g, "/")))];
}

function pathIsKnown(claimed, known) {
  const normalized = claimed.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!normalized) return true;
  if (known.has(normalized) || known.has(basenameOf(normalized))) return true;
  for (const item of known) {
    if (!item) continue;
    if (item === normalized || item.endsWith(`/${normalized}`) || normalized.endsWith(`/${item}`)) return true;
    if (item.startsWith(`${normalized}/`) || normalized.startsWith(`${item}/`)) return true;
  }
  return false;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileMentionedAsMissing(text, filePath) {
  const raw = String(text || "");
  const base = basenameOf(filePath);
  const normalized = normalizePath(filePath);
  if (!base) return false;
  const baseRe = escapeRegex(base);
  const patterns = [
    new RegExp(`${baseRe}[^\\n]{0,120}(?:no\\s+exist(?:e|en|ir|ía)|no\\s+apareci[oó]|no\\s+fue\\s+encontrad|no\\s+se\\s+encontr)`, "i"),
    new RegExp(`(?:no\\s+exist(?:e|en|ir|ía)|no\\s+apareci[oó]|no\\s+fue\\s+encontrad)[^\\n]{0,120}${baseRe}`, "i"),
    new RegExp(`\`${escapeRegex(normalized)}\`[^\\n]{0,80}(?:no\\s+exist|no\\s+apareci)`, "i"),
    new RegExp(`"${escapeRegex(normalized)}"[^\\n]{0,80}(?:no\\s+exist|no\\s+apareci)`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(raw));
}

/**
 * Detecta cuando el modelo niega archivos/contenido que read_file ya confirmo.
 * Codigo: CONTRADICTORY_EVIDENCE
 */
function detectContradictoryEvidence(report, evidence) {
  const text = String(report || "").trim();
  const filesRead = evidence?.filesRead || [];
  const contradictions = [];
  if (!text || !filesRead.length) return { ok: true, contradictions };

  const readPaths = filesRead.map((row) => row.path).filter(Boolean);

  if (/\b(?:los\s+)?archivos?\s+(?:no\s+exist(?:en|e|ir|ía)|no\s+(?:fueron\s+)?encontrados?)\b/i.test(text)
    && filesRead.length >= 1) {
    contradictions.push({
      code: "CONTRADICTORY_EVIDENCE",
      detail: "Afirma que archivos no existen pese a read_file exitosos",
      paths: readPaths.slice(0, 12),
    });
  }

  if (/\bno\s+puedo\s+completar\s+la\s+tarea\b/i.test(text)
    && /\bno\s+exist(?:en|e|ir|ía)\b/i.test(text)
    && filesRead.length >= 1) {
    contradictions.push({
      code: "CONTRADICTORY_EVIDENCE",
      detail: "Concluye imposibilidad por inexistencia pese a lecturas exitosas",
      paths: readPaths.slice(0, 12),
    });
  }

  for (const file of filesRead) {
    if (fileMentionedAsMissing(text, file.path)) {
      contradictions.push({
        code: "CONTRADICTORY_EVIDENCE",
        detail: `Niega existencia de ${file.path} leido con exito`,
        path: file.path,
        evidenceId: file.contentHash || null,
      });
    }
  }
  if (/sin detalle de l[ií]nea retenido|no conserva funciones ni n[uú]meros de l[ií]nea|contenido fuente no (?:fue incluido|est[aá])/i.test(text)
    && filesRead.some((file) => (file.forensicExcerpts || []).length > 0 || String(file.content || "").length > 80)) {
    contradictions.push({
      code: "CONTRADICTORY_EVIDENCE",
      detail: "Afirma que no hay lineas/contenido retenido pese a extractos forenses o snippets leidos",
      paths: readPaths.slice(0, 12),
    });
  }

  const secretRead = filesRead.find((row) => /secret[-_]?module/i.test(String(row.path || "")));
  if (secretRead) {
    const content = String(secretRead.content || "");
    const hasSecretValue = /(?:SECRET|REALITY_|REAL_EDITCORE)/i.test(content);
    if (hasSecretValue
      && /\bno\s+(?:fue\s+)?posible\s+(?:determinar|obtener|leer)|no\s+puedo\s+determinar|no\s+se\s+puede\s+determinar\b/i.test(text)
      && /\bsecreto\b/i.test(text)) {
      contradictions.push({
        code: "CONTRADICTORY_EVIDENCE",
        detail: `Niega poder determinar el secreto pese a read_file exitoso de ${secretRead.path}`,
        path: secretRead.path,
        evidenceId: secretRead.contentHash || null,
      });
    }
  }

  return { ok: contradictions.length === 0, contradictions };
}

function summarizeReadFinding(file) {
  const content = String(file?.content || "");
  const filePath = String(file?.path || "");
  if (!content || !filePath) return "";
  if (/calculator\.js$/i.test(filePath.replace(/\\/g, "/"))) {
    const sumaMatch = content.match(/function\s+suma\s*\([^)]*\)\s*\{[\s\S]*?return\s+([^;]+);/i);
    if (sumaMatch) {
      return `En \`${filePath}\`, la funcion suma ejecuta \`return ${sumaMatch[1].trim()}\` (evidencia read_file).`;
    }
  }
  if (/secret[-_]?module\.js$/i.test(filePath.replace(/\\/g, "/"))) {
    const secretMatch = content.match(/REAL_EDITCORE_SECRET\s*=\s*["']([^"']+)["']/);
    if (secretMatch) {
      return `En \`${filePath}\`, el valor secreto almacenado es \`${secretMatch[1]}\` (evidencia read_file).`;
    }
  }
  return "";
}

function buildVerifiedFindingsFromReads(evidence) {
  const lines = [];
  for (const file of evidence.filesRead || []) {
    if (isVendorOrGeneratedPath(file.path, file.content)) continue;
    const summary = summarizeReadFinding(file);
    if (summary) lines.push(`- ${summary}`);
  }
  if (!lines.length) return [];
  return ["## Hallazgos verificados (read_file)", "", ...lines, ""];
}

/** Bloque estructurado CURRENT_RUN_EVIDENCE para compactacion/recovery del mismo run. */
function formatCurrentRunEvidenceBlock(scope = {}, evidence = {}) {
  const lines = [
    "CURRENT_RUN_EVIDENCE",
    `runId: ${scope.runId || evidence.runId || ""}`,
    `taskId: ${scope.taskId || evidence.taskId || ""}`,
    `projectRoot: ${scope.projectRoot || evidence.projectRoot || ""}`,
    "",
    "VERIFIED READS:",
  ];
  for (const file of evidence.filesRead || []) {
    const len = String(file.content || "").length;
    lines.push(`- ${file.path} status=COMPLETED contentLength=${len} evidenceId=${file.contentHash || "n/a"}`);
  }
  if (!(evidence.filesRead || []).length) lines.push("- (ninguno)");
  const failed = (evidence.toolLog || []).filter((row) => row.name === "read_file" && row.ok === false);
  if (failed.length) {
    lines.push("", "FAILED READS:");
    for (const item of failed.slice(0, 8)) {
      lines.push(`- ${item.path || "?"} status=FAILED`);
    }
  }
  lines.push("", formatForensicExcerptsBlock(evidence));
  lines.push("", "PROHIBIDO negar existencia de VERIFIED READS de este run.");
  lines.push("PROHIBIDO afirmar que falta el contenido fuente de un path con FORENSIC_EXCERPTS.");
  return lines.join("\n");
}

/** Bloque de preservacion: metadatos + extractos forenses (no solo path+length). */
function formatEvidencePreservationBlock(evidence, scope = null) {
  if (scope?.runId || evidence?.runId) {
    return formatCurrentRunEvidenceBlock(scope || {}, evidence);
  }
  const lines = [
    "EVIDENCIA REAL PRESERVADA POR EDITCORE (tool_result > narracion del modelo):",
  ];
  for (const file of evidence.filesRead || []) {
    const len = String(file.content || "").length;
    lines.push(`- read_file OK path=${file.path} status=COMPLETED contentLength=${len} evidenceId=${file.contentHash || "n/a"}`);
  }
  for (const item of (evidence.toolLog || []).filter((row) => row.name === "read_file" && row.ok === false).slice(0, 8)) {
    lines.push(`- read_file FAIL path=${item.path || "?"} (no usar para negar existencia si hay read_file OK en src/)`);
  }
  lines.push(formatForensicExcerptsBlock(evidence));
  lines.push("PROHIBIDO afirmar que un archivo leido arriba no existe.");
  lines.push("PROHIBIDO decir que falta el contenido fuente si hay FORENSIC_EXCERPTS de ese path.");
  lines.push("El reporte final debe derivarse SOLO de esta evidencia.");
  return lines.join("\n");
}

function validateGroundedAnalysisReport(report, evidence) {
  const text = String(report || "").trim();
  const known = knownPathSet(evidence);
  const claimed = extractClaimedPaths(text);
  const invented = claimed.filter((item) => !pathIsKnown(item, known));
  const inventedRoots = invented
    .map((item) => item.replace(/\\/g, "/").split("/")[0].toLowerCase())
    .filter((root) => COMMON_INVENTED_ROOTS.includes(root));
  const citedKnown = claimed.filter((item) => pathIsKnown(item, known));
  const sufficiency = analysisEvidenceSufficient(evidence);
  const reasons = [...sufficiency.reasons];

  if (inventedRoots.length >= 1) {
    reasons.push(`El reporte menciona carpetas no observadas en el proyecto: ${[...new Set(inventedRoots)].join(", ")}.`);
  }
  if (invented.length >= 3) {
    reasons.push(`El reporte cita ${invented.length} rutas sin evidencia de herramientas.`);
  }
  if (citedKnown.length < 1 && claimed.length >= 2) {
    reasons.push("El reporte casi no cita archivos realmente leidos.");
  }
  if (/posible falta|potencialmente|por confirmar|sin separacion clara|posibles re-renderizados/i.test(text)
    && citedKnown.length < 1) {
    reasons.push("El reporte usa lenguaje especulativo sin anclar hallazgos a archivos leidos.");
  }
  if (isHollowAnalysisReport(text)) {
    reasons.push("El reporte es hueco o meta (Verificacion/Falta informacion/NO-GO); debe regenerarse desde evidencia.");
  }
  const phantomStack = detectPhantomStackClaims(text, known);
  if (phantomStack.length) {
    reasons.push(`Stack inventado sin evidencia: ${phantomStack.join(", ")}.`);
  }

  const contradiction = detectContradictoryEvidence(text, evidence);
  if (!contradiction.ok) {
    for (const item of contradiction.contradictions) {
      reasons.push(item.detail || "CONTRADICTORY_EVIDENCE: el reporte contradice read_file exitosos.");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    invented: invented.slice(0, 12),
    inventedRoots: [...new Set(inventedRoots)],
    citedKnown: citedKnown.slice(0, 20),
    claimedCount: claimed.length,
    requiredConcreteReads: sufficiency.required,
    phantomStack,
    contradictoryEvidence: contradiction.contradictions,
  };
}

/** Detecta plantillas Vite/CRA narradas cuando el ledger no las respalda (caso CALILI/Next). */
function detectPhantomStackClaims(text = "", known = new Set()) {
  const raw = String(text || "");
  const phantoms = [];
  const hasNext = [...known].some((item) => /next\.config|src\/app\//i.test(item));
  const claimsVite = /\bvite\.config\.(js|ts|mjs)\b/i.test(raw) || /\bVite\s*\+\s*React\b/i.test(raw) || /\b"dev"\s*:\s*"vite"/i.test(raw);
  const claimsCra = /\bsrc\/App\.jsx\b/i.test(raw) || /\bsrc\/main\.jsx\b/i.test(raw);
  if (claimsVite && !pathIsKnown("vite.config.js", known) && !pathIsKnown("vite.config.ts", known) && !pathIsKnown("vite.config.mjs", known)) {
    phantoms.push("vite.config");
  }
  if (claimsCra && !pathIsKnown("src/App.jsx", known) && !pathIsKnown("App.jsx", known)) phantoms.push("src/App.jsx");
  if (claimsCra && !pathIsKnown("src/main.jsx", known) && !pathIsKnown("main.jsx", known)) phantoms.push("src/main.jsx");
  if (hasNext && (claimsVite || claimsCra)) phantoms.push("conflicto Next vs Vite/CRA narrado");
  return [...new Set(phantoms)];
}

function narrationLooksLikeInventedAnalysis(text, steps = [], projectRoot = "") {
  const evidence = collectToolEvidence(steps, projectRoot);
  const known = knownPathSet(evidence);
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (detectPhantomStackClaims(raw, known).length) return true;
  if (!detectContradictoryEvidence(raw, evidence).ok) return true;
  const validation = validateGroundedAnalysisReport(raw, evidence);
  if (!validation.ok && /REPORTE|ERRORES ENCONTRADOS|Cuando autorices|##\s*An[aá]lisis|no\s+exist(?:en|e)/i.test(raw)) return true;
  return false;
}

function formatEvidenceAppendix(evidence, { mode = "analysis" } = {}) {
  const lines = ["## Evidencia real de herramientas", ""];
  lines.push(`- Archivos leidos (${evidence.realFileReadCount}): ${(evidence.filesRead || []).map((f) => f.path).slice(0, 30).join(", ") || "ninguno"}`);
  if ((evidence.searches || []).length) {
    lines.push(`- Busquedas: ${evidence.searches.slice(0, 12).join(" | ")}`);
  }
  if (mode === "execution") {
    lines.push(`- Archivos modificados (${evidence.mutationCount}): ${(evidence.filesMutated || []).map((f) => `${f.tool}:${f.path}`).slice(0, 30).join(", ") || "ninguno"}`);
    if ((evidence.verifications || []).length) {
      for (const item of evidence.verifications.slice(0, 8)) {
        lines.push(`- Verificacion ${item.name}${item.command ? ` \`${item.command}\`` : ""}: ${item.ok ? "OK" : "FALLO"}${item.output ? ` — ${item.output}` : ""}`);
      }
    } else {
      lines.push("- Verificacion: no se ejecuto ninguna herramienta de verificacion");
    }
  }
  lines.push(`- Acciones registradas: ${(evidence.toolLog || []).length}`);
  lines.push(`- Ledger: ${(evidence.ledger?.entries || []).length} entradas`);
  return lines.join("\n");
}

function isJunkRepairTargetPath(filePath = "") {
  const p = String(filePath || "").replace(/\\/g, "/");
  if (!p) return true;
  if (/\.claude\//i.test(p) && /\.md$/i.test(p)) return true;
  if (/ANALISIS_ERRORES/i.test(p)) return true;
  if (/^ROADMAP(\/ROADMAP)?\.md$/i.test(p)) return true;
  if (isVendorOrGeneratedPath(p)) return true;
  return false;
}

function buildPlanFromEvidence(evidence) {
  const fromFindings = (evidence.findings || [])
    .filter((item) => isProvableFinding(item, evidence))
    .map((item) => item.path)
    .filter((p) => !isJunkRepairTargetPath(p));
  // Sin hallazgos reales: NO inventar "corregir" vendor, docs o archivos sin defecto comprobable.
  if (!fromFindings.length) return [];
  const uniqueFiles = [...new Set(fromFindings)];
  uniqueFiles.sort((a, b) => {
    const rank = (value) => (/^src\//i.test(value) ? 0 : /runtime\//i.test(value) ? 1 : /\.md$/i.test(value) ? 3 : 2);
    return rank(a) - rank(b);
  });
  return uniqueFiles.slice(0, 12).map((filePath) => {
    const finding = (evidence.findings || []).find((item) => item.path === filePath && isProvableFinding(item, evidence));
    const via = finding?.source === "typecheck" ? "typecheck" : `read_file(${filePath})`;
    const label = String(finding?.label || "defecto comprobado").slice(0, 120);
    return {
      target: filePath,
      evidence: via,
      label,
      action: `Corregir ${filePath} (${label}) con replace_in_file tras evidencia (${via})`,
    };
  });
}

/** Solo hallazgos con path leido de verdad y fuera de vendor/minificado. */
function isProvableFinding(item = {}, evidence = {}) {
  const path = String(item?.path || "").replace(/\\/g, "/").trim();
  if (!path || isJunkRepairTargetPath(path)) return false;
  const label = String(item?.label || "");
  const snippet = String(item?.evidence || "");
  if (!label && !snippet) return false;
  const reads = (evidence.filesRead || []).map((row) => String(row.path || "").replace(/\\/g, "/").toLowerCase());
  const key = path.toLowerCase();
  const wasRead = reads.some((r) => r === key || r.endsWith(`/${key}`) || key.endsWith(`/${r}`) || r.endsWith(key.split("/").pop()));
  if (!wasRead && item?.source !== "typecheck") return false;
  return true;
}

/** Gaps de arranque SOLO desde evidencia leida (package.json / env), sin inventar. */
function buildRunnableGapsFromEvidence(evidence = {}) {
  const gaps = [];
  const pkgInfo = parsePackageJsonFromEvidence(evidence);
  if (pkgInfo?.parseError) {
    gaps.push(`- \`package.json\` no se pudo parsear (${pkgInfo.parseError}).`);
  } else if (pkgInfo?.pkg) {
    const scripts = pkgInfo.pkg.scripts && typeof pkgInfo.pkg.scripts === "object" ? pkgInfo.pkg.scripts : {};
    if (!scripts.dev && !scripts.start) {
      gaps.push("- `package.json`: no hay scripts `dev`/`start` comprobados.");
    } else {
      gaps.push(`- Arranque comprobado en package.json: \`${scripts.dev ? "npm run dev" : "npm start"}\`.`);
    }
  }
  const envExample = (evidence.filesRead || []).find((row) => {
    const p = String(row.path || "").replace(/\\/g, "/").toLowerCase();
    return /(^|\/)\.env\.example$/.test(p) || /(^|\/)\.env\.local\.example$/.test(p);
  });
  if (envExample?.content) {
    const keys = String(envExample.content)
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/)?.[1])
      .filter(Boolean)
      .slice(0, 12);
    if (keys.length) {
      gaps.push(`- Variables documentadas en \`${envExample.path}\`: ${keys.join(", ")} (comprobar que existan en el entorno real).`);
    }
  }
  const listedNames = new Set();
  for (const entry of evidence.listed || []) {
    // collectToolEvidence may store paths; also scan toolLog list results if present in filesRead only
    const p = String(entry?.path || entry?.name || "").replace(/\\/g, "/");
    if (p) listedNames.add(p.split("/").pop().toLowerCase());
  }
  for (const row of evidence.filesRead || []) {
    const p = String(row.path || "").replace(/\\/g, "/").toLowerCase();
    if (p) listedNames.add(p.split("/").pop());
  }
  if (listedNames.has(".env.example") && !listedNames.has(".env") && !listedNames.has(".env.local")) {
    gaps.push("- Existe `.env.example` en evidencia de listado/lectura, pero no se confirmo `.env` / `.env.local` leido.");
  }
  if (!gaps.length) {
    gaps.push("- No hay gaps de arranque adicionales comprobables solo con la evidencia leida.");
  }
  return gaps;
}

function shouldSkipProceedAsk(prompt = "") {
  const text = String(prompt || "");
  if (!text.trim()) return false;
  if (/\bno\s+pidas?\s+proced(?:e|er|a)?\b/i.test(text)) return true;
  if (/\bsin\s+(?:pedir\s+)?proced(?:e|er|a)?\b/i.test(text)) return true;
  if (/\bno\s+solicites?\s+proced(?:e|er|a)?\b/i.test(text)) return true;
  return false;
}

/** Pide propuesta de texto (name/description) y esperar autorizacion — no plantilla forense. */
function wantsScopedTextProposal(prompt = "") {
  const text = String(prompt || "");
  if (!/\b(?:description|name|descripci[oó]n|nombre)\b/i.test(text)) return false;
  return /\b(?:mejor[ae]|propon|prop[oó]n|suger|cambio\s+m[ií]nimo|mejora\s+m[ií]nima)\b/i.test(text)
    || /\bespera\s+autorizaci[oó]n\b/i.test(text);
}

function parsePackageJsonFromEvidence(evidence = {}) {
  const file = (evidence.filesRead || []).find((row) => {
    const p = String(row.path || "").replace(/\\/g, "/").toLowerCase();
    return p === "package.json" || p.endsWith("/package.json");
  });
  if (!file) return null;
  const raw = String(file.content || "").trim();
  if (!raw) return { path: file.path || "package.json", raw: "", pkg: null, parseError: "vacio" };
  try {
    return { path: file.path || "package.json", raw, pkg: JSON.parse(raw), parseError: "" };
  } catch (error) {
    return { path: file.path || "package.json", raw, pkg: null, parseError: String(error?.message || error).slice(0, 120) };
  }
}

function suggestPackageJsonTextTweaks(pkg = {}) {
  const name = String(pkg?.name || "").trim();
  const description = String(pkg?.description || "").trim();
  const suggestions = [];
  if (!description) {
    suggestions.push({
      field: "description",
      current: "(vacío)",
      proposed: name
        ? `${name}: app Node/JS — completa esta frase con el proposito real del producto.`
        : "Describe en una frase el proposito del producto.",
      reason: "description esta vacia; una frase corta mejora descubrimiento y claridad.",
    });
  } else if (description.length < 12) {
    suggestions.push({
      field: "description",
      current: description,
      proposed: `${description} — anade el proposito o audiencia en una frase.`,
      reason: "description demasiado corta para ser util.",
    });
  } else if (/^(test|demo|app|project|todo|asdf)$/i.test(description.trim())) {
    suggestions.push({
      field: "description",
      current: description,
      proposed: "Reemplaza el placeholder por una frase concreta del producto.",
      reason: "description parece placeholder.",
    });
  }
  if (name && /\s/.test(name)) {
    suggestions.push({
      field: "name",
      current: name,
      proposed: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._~-]/g, ""),
      reason: "npm recomienda name sin espacios (kebab-case).",
    });
  }
  return suggestions;
}

/**
 * Reporte FOCO corto: sin mapa de carpetas / FORENSIC_EXCERPTS / PROCEDE generico.
 */
function buildScopedFocusReport(evidence, projectRoot = "", options = {}) {
  const rootLabel = projectRoot || evidence.projectRoot || "proyecto";
  const prompt = String(options.prompt || evidence.prompt || "");
  const skipProceed = options.skipProceed === true || shouldSkipProceedAsk(prompt);
  const waitAuth = /\bespera\s+autorizaci[oó]n\b/i.test(prompt) || wantsScopedTextProposal(prompt);
  const files = (evidence.filesRead || []).map((f) => f.path);
  const pkgInfo = parsePackageJsonFromEvidence(evidence);
  const lines = [
    "## Analisis FOCO",
    "",
    `- Proyecto: \`${rootLabel}\`.`,
    `- Archivo(s) leidos: ${files.length ? files.join(", ") : "ninguno"}.`,
    "",
  ];

  if (pkgInfo?.pkg) {
    const name = String(pkgInfo.pkg.name || "(sin name)");
    const description = String(pkgInfo.pkg.description || "(sin description)");
    const version = String(pkgInfo.pkg.version || "(sin version)");
    const scriptKeys = pkgInfo.pkg.scripts && typeof pkgInfo.pkg.scripts === "object"
      ? Object.keys(pkgInfo.pkg.scripts).slice(0, 12)
      : [];
    lines.push(
      "## Contenido relevante (`package.json`)",
      "",
      `- **name:** \`${name}\``,
      `- **description:** ${description === "(sin description)" ? description : `"${description}"`}`,
      `- **version:** \`${version}\``,
      scriptKeys.length ? `- **scripts:** ${scriptKeys.join(", ")}` : "- **scripts:** (ninguno)",
      "",
    );
    if (wantsScopedTextProposal) {
      const tweaks = suggestPackageJsonTextTweaks(pkgInfo.pkg).slice(0, 1);
      lines.push("## Propuesta minima (texto)", "");
      if (tweaks.length) {
        const t = tweaks[0];
        lines.push(
          `- Campo: **${t.field}**`,
          `- Actual: ${t.current}`,
          `- Propuesto: ${t.proposed}`,
          `- Motivo: ${t.reason}`,
          "",
          waitAuth
            ? "Esperando tu autorizacion para aplicar **solo este cambio** (di PROCEDE / ADELANTE)."
            : (skipProceed
              ? "Sin aplicar cambios: solo propuesta."
              : "Con Acceso completo este cambio se aplica en disco sin pedir PROCEDE."),
        );
      } else {
        lines.push(
          "- No hay mejora minima clara en `name`/`description` (ya son razonables).",
          "",
          skipProceed || waitAuth
            ? "No se solicita autorizacion de escritura."
            : "Sin correcciones pendientes de texto.",
        );
      }
    } else {
      lines.push(
        "## Hallazgos",
        "",
        "- Lectura de `package.json` completada.",
        "- Sin marcadores automaticos de defecto en este FOCO.",
        "",
        skipProceed
          ? "Sin correcciones pendientes segun el FOCO. No se solicita PROCEDE."
          : "Indica el cambio concreto; con Acceso completo se aplica en disco sin pedir PROCEDE.",
      );
    }
  } else if (pkgInfo?.parseError) {
    lines.push(
      "## Hallazgos",
      "",
      `- \`package.json\` no se pudo parsear: ${pkgInfo.parseError}`,
      "",
      waitAuth || skipProceed
        ? "Corrige el JSON manualmente o autoriza un arreglo concreto."
        : "Cuando autorices, se puede proponer un arreglo de JSON invalido.",
    );
  } else {
    const first = (evidence.filesRead || [])[0];
    const rawContent = String(first?.content || "").trim();
    const firstFewLines = rawContent.split(/\r?\n/).slice(0, 15).join("\n");
    lines.push(
      "## Evidencia",
      "",
      firstFewLines ? `\`\`\`javascript\n${firstFewLines}\n\`\`\`` : "- Sin contenido retenido del archivo FOCO.",
      "",
      skipProceed
        ? "Sin correcciones pendientes segun el FOCO. No se solicita PROCEDE."
        : "Si hay un cambio concreto, indicalo y autoriza con PROCEDE.",
    );
  }

  lines.push(
    "",
    "## Evidencia real de herramientas",
    "",
    `- Archivos leidos (${files.length}): ${files.join(", ") || "ninguno"}`,
    `- Acciones registradas: ${(evidence.toolLog || []).length || files.length}`,
  );
  return lines.join("\n");
}

function isScopedFocusReportContext(_options = {}, _evidence = {}) {
  // FOCO retirado: nunca reporte corto/allowlist.
  return false;
}

function buildGroundedAnalysisReport(evidence, projectRoot = "", options = {}) {
  if (isScopedFocusReportContext(options, evidence)) {
    return buildScopedFocusReport(evidence, projectRoot, options);
  }
  const rootLabel = projectRoot || evidence.projectRoot || "proyecto";
  const prompt = String(options.prompt || evidence.prompt || "");
  const skipProceed = options.skipProceed === true || shouldSkipProceedAsk(prompt);
  const files = (evidence.filesRead || []).map((f) => f.path);
  const listedRoots = [...new Set((evidence.listed || [])
    .map((item) => String(item.path || "").replace(/\\/g, "/").split("/")[0])
    .filter(Boolean))]
    .slice(0, 20);
  const findings = (evidence.findings || []).filter((item) => isProvableFinding(item, evidence));
  const findingLines = findings.length
    ? findings.slice(0, 16).map((item) => `- **${item.path}** (${item.source || "read_file"}, linea ~${item.line}): ${item.label}. Evidencia: \`${item.evidence}\``)
    : [
      "- Sin hallazgos automaticos comprobables en el codigo fuente del producto.",
      "- Se excluyen vendor/minificados (workbox, sw generado, bundles) y docs de estado: no son bugs a \"corregir\".",
    ];

  const plan = buildPlanFromEvidence(evidence);
  const honestNoFix = plan.length === 0;
  const planLines = plan.length
    ? plan.map((item, index) => `${index + 1}. ${item.action}\n   evidencia: ${item.evidence}`)
    : [
      "1. No hay correcciones comprobables pendientes (no se inventan cambios sobre vendor ni archivos sin defecto demostrado).",
    ];

  const verifiedFindings = buildVerifiedFindingsFromReads(evidence);
  const forensicBlock = formatForensicExcerptsBlock(evidence);
  const coverage = evidence.coverage || buildAnalysisCoverageMap(evidence, { prompt, depthProfile: options.depthProfile || null });
  const gapLines = buildRunnableGapsFromEvidence(evidence);
  const effectiveSkipProceed = skipProceed || honestNoFix;

  return [
    "## Qué sí funcionó",
    "",
    `- Proyecto inspeccionado: \`${rootLabel}\`.`,
    `- Estructura observada: ${listedRoots.length ? listedRoots.join(", ") : "rutas de archivos leidos"}.`,
    `- Archivos leidos con evidencia: ${files.length ? files.join(", ") : "ninguno"}.`,
    `- ${coverage.summary || "Cobertura: sin mapa"}`,
    "",
    "## Mapa carpeta por carpeta",
    "",
    coverage.dirsListed?.length
      ? `- Carpetas listadas (${coverage.dirsListedCount}): ${coverage.dirsListed.join(", ")}`
      : "- Carpetas listadas: ninguna",
    coverage.pendingDirs?.length
      ? `- Pendientes de explorar: ${coverage.pendingDirs.slice(0, 12).join(", ")}`
      : "- Pendientes de explorar: ninguna",
    "",
    "## Qué falló / hallazgos",
    "",
    ...findingLines,
    "",
    "## Qué falta para que funcione",
    "",
    ...gapLines,
    "",
    "## Evidencia",
    "",
    ...verifiedFindings,
    "",
    forensicBlock,
    "",
    "## Cómo lo corregiré",
    "",
    ...planLines,
    "",
    "## Recomendaciones concretas",
    "",
    ...plan.map((item) => `- ${item.target}: ${item.label || "corregir"} con replace_in_file (evidencia ${item.evidence})`),
    ...(plan.length
      ? []
      : ["- Ninguna correccion automatica comprobable. No se solicitara PROCEDE inventado."]),
    "",
    formatEvidenceAppendix(evidence, { mode: "analysis" }),
    "",
    effectiveSkipProceed
      ? "Sin correcciones comprobables pendientes. No se solicita PROCEDE."
      : "Cuando autorices procedo con las correcciones.",
  ].join("\n");
}

function groundAnalysisReport(report, steps, projectRoot = "", scope = null) {
  const evidence = collectToolEvidence(steps, projectRoot, scope);
  if (scope?.prompt) evidence.prompt = scope.prompt;
  const reportOpts = {
    prompt: scope?.prompt || "",
    depthProfile: scope?.analysisDepth || null,
  };
  const rawReport = String(report || "").trim();

  const scopedFocus = isScopedFocusReportContext(reportOpts, evidence);
  if (scopedFocus) {
    const modelLooksUseful = rawReport.length > 80
      && !isHollowAnalysisReport(rawReport)
      && !/FORENSIC_EXCERPTS|Mapa carpeta por carpeta|Cobertura:\s*0\/0.*NaN/i.test(rawReport);
    if (modelLooksUseful) {
      const text = collapseDuplicateReportSections(rawReport);
      const withEvidence = /##\s*Evidencia real/i.test(text)
        ? text
        : `${text}\n\n${formatEvidenceAppendix(evidence, { mode: "analysis" })}`;
      return { text: withEvidence, evidence, validation: { ok: true, reasons: [] }, replaced: false };
    }
    return {
      text: buildScopedFocusReport(evidence, projectRoot, reportOpts),
      evidence,
      validation: { ok: true, reasons: [] },
      replaced: true,
      reason: "FOCO: reporte generado desde evidencia de herramientas.",
    };
  }

  // Si el reporte esta vacio o es un meta-cierre, generar reporte estructurado
  if (!rawReport || /Verificacion completada con evidencia real/i.test(rawReport) || isHollowAnalysisReport(rawReport)) {
    return {
      text: buildGroundedAnalysisReport(evidence, projectRoot, reportOpts),
      evidence,
      validation: { ok: false, reasons: ["hollow or meta verification final"] },
      replaced: true,
      reason: /Verificacion completada/i.test(rawReport)
        ? "Cierre meta 'Verificacion completada' rechazado; se regenero desde evidencia."
        : "Informe hueco rechazado; se regenero desde evidencia de herramientas.",
    };
  }

  const contradiction = detectContradictoryEvidence(rawReport, evidence);
  if (!contradiction.ok) {
    const reasons = contradiction.contradictions.map((item) => item.detail || "CONTRADICTORY_EVIDENCE");
    return {
      text: buildGroundedAnalysisReport(evidence, projectRoot, reportOpts),
      evidence,
      validation: { ok: false, reasons, contradictoryEvidence: contradiction.contradictions },
      replaced: true,
      reason: reasons.join(" "),
    };
  }

  const validation = validateGroundedAnalysisReport(rawReport, evidence);
  if (!validation.ok && (validation.invented?.length >= 2 || validation.reasons.some((r) => r.includes("no observadas") || r.includes("contradice")))) {
    return {
      text: buildGroundedAnalysisReport(evidence, projectRoot, reportOpts),
      evidence,
      validation,
      replaced: true,
      reason: validation.reasons.join(" "),
    };
  }

  const text = collapseDuplicateReportSections(rawReport);
  const withEvidence = /##\s*Evidencia real/i.test(text)
    ? text
    : `${text}\n\n${formatEvidenceAppendix(evidence, { mode: "analysis" })}`;
  return { text: withEvidence, evidence, validation: { ok: true, reasons: [] }, replaced: false };
}

/**
 * Verifica mutaciones.
 * - Siempre exige mutacion + verificacion (read/run_command).
 * - Si hay read_file posterior con contenido, ese contenido debe confirmar el cambio.
 * - Chequeo estricto de disco solo con { strictDisk: true } (tests de realidad).
 */
function verifyMutationsOnDisk(steps = [], projectRoot = "", options = {}) {
  const evidence = collectToolEvidence(steps, projectRoot);
  const failures = [];
  const strictDisk = options.strictDisk === true;

  if (evidence.mutationCount < 1) {
    failures.push("No hay mutaciones reales.");
    return { ok: false, failures, evidence };
  }

  for (const mutation of evidence.filesMutated || []) {
    const verified = (evidence.verifications || []).some((item) => {
      const target = String(item.path || item.command || "");
      return normalizePath(target, projectRoot) === mutation.normalized
        || basenameOf(target) === basenameOf(mutation.path)
        || (item.name === "run_command" && item.ok);
    });
    if (!verified) {
      failures.push(`${mutation.path}: falta verificacion posterior (read_file/run_command) tras la mutacion.`);
    }

    const postReads = (evidence.verifications || []).filter((item) => (
      item.name === "read_file"
      && (normalizePath(item.path || item.command || "", projectRoot) === mutation.normalized
        || basenameOf(item.path || item.command || "") === basenameOf(mutation.path))
    ));
    const postContent = postReads.length ? String(postReads[postReads.length - 1].content || "") : "";

    if (mutation.tool === "write_file" && mutation.content && postContent) {
      if (postContent !== mutation.content) {
        failures.push(`${mutation.path}: write_file reporto exito pero la verificacion read_file no confirma el contenido nuevo.`);
      }
    }
    if (mutation.tool === "replace_in_file" && mutation.newText && postContent) {
      if (!postContent.includes(mutation.newText)) {
        failures.push(`${mutation.path}: replace_in_file reporto exito pero read_file posterior no contiene newText.`);
      }
    }

    if (!projectRoot || !fs.existsSync(projectRoot)) continue;
    const absolute = path.resolve(projectRoot, mutation.path);
    if (strictDisk) {
      if (!fs.existsSync(absolute)) {
        failures.push(`${mutation.path}: no existe en disco tras ${mutation.tool}`);
        continue;
      }
      const disk = fs.readFileSync(absolute, "utf8");
      if (mutation.tool === "write_file" && mutation.content && disk !== mutation.content) {
        failures.push(`${mutation.path}: write_file reporto exito pero el contenido en disco no coincide.`);
      }
      if (mutation.tool === "replace_in_file" && mutation.newText && !disk.includes(mutation.newText)) {
        failures.push(`${mutation.path}: replace_in_file reporto exito pero newText no esta en disco.`);
      }
    }
  }

  return { ok: failures.length === 0, failures, evidence };
}

function buildExecutionEvidenceReport(finalText, steps, projectRoot = "", options = {}) {
  const evidence = collectToolEvidence(steps, projectRoot);
  const diskCheck = verifyMutationsOnDisk(steps, projectRoot);
  let base = String(finalText || "").trim();
  while (/##\s*Evidencia de correccion/i.test(base) || /##\s*Evidencia real de herramientas/i.test(base)) {
    base = base
      .replace(/\n*##\s*Evidencia de correccion[\s\S]*$/i, "")
      .replace(/\n*##\s*Evidencia real de herramientas[\s\S]*$/i, "")
      .trim();
  }
  // Quitar narracion larga: el cierre debe ser corto y factual.
  base = base
    .replace(/^[ \t]*[├└│─]+.*$/gm, "")
    .replace(/^(?:Entendido\.?|Procedo con.*|Voy a proceder.*|Disculpa,.*)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (base.length > 900) {
    base = `${base.slice(0, 900).trim()}…`;
  }
  const appendix = formatEvidenceAppendix(evidence, { mode: "execution" });
  const required = [];
  if (evidence.mutationCount < 1) required.push("No hay mutaciones reales (write_file/replace_in_file).");
  if (!(evidence.verifications || []).length) required.push("No hay verificacion posterior a los cambios.");
  const passedVerification = (evidence.verifications || []).some((item) => item.ok === true && item.diagnosticFailed !== true);
  const failedDiagnostic = (evidence.verifications || []).some((item) => item.diagnosticFailed === true || (item.name === "run_command" && item.ok === false));
  if (evidence.mutationCount >= 1 && failedDiagnostic && !passedVerification) {
    required.push("Verificacion diagnostica FALLO (exit != 0); lint/test/build fallidos no cuentan como OK.");
  }
  for (const failure of diskCheck.failures || []) {
    if (!required.includes(failure)) required.push(failure);
  }

  // Cola de fixes: no afirmar archivos corregidos sin mutacion real.
  const queue = assessFixQueue(steps, projectRoot, { finalText: base, ...options });
  for (const reason of queue.reasons || []) {
    if (!required.includes(reason)) required.push(reason);
  }

  if (options.requireDiagnosticVerify === true && evidence.mutationCount >= 1) {
    let isDiag = () => false;
    try { isDiag = require("../command-policy").isAcotadoDiagnosticCommand; } catch { /* ignore */ }
    const hasDiag = (evidence.verifications || []).some((item) => {
      const cmd = String(item.command || "");
      return item.ok === true && item.diagnosticFailed !== true
        && (isDiag(cmd) || /\b(?:typecheck|tsc\b|--test|vitest|jest|npm\s+test)\b/i.test(cmd));
    });
    if (!hasDiag) {
      required.push("Falta verificacion diagnostica tras mutaciones (tsc --noEmit, typecheck o test).");
    }
  }

  const mutationLines = evidence.mutationCount
    ? (evidence.filesMutated || []).map((f) => `- Modificado con ${f.tool}: \`${f.path}\``).join("\n")
    : "- Ningun archivo fue modificado por herramientas.";
  const queueLines = (queue.items || []).length
    ? (queue.items || []).map((item) => `- ${item.target}: ${item.verified ? "mutado+verificado" : item.mutated ? "mutado SIN verificar" : "pendiente"}`).join("\n")
    : "- Cola vacia.";
  const cleanedBase = base.replace(/^##\s*Qu[eé]\s+hice\s*/i, "").trim();
  const body = [
    "## Qué hice",
    "",
    cleanedBase || "Cambios aplicados solo con herramientas reales.",
    "",
    "## Archivos tocados",
    "",
    mutationLines,
    "",
    "## Cola de correcciones",
    "",
    queueLines,
    "",
    appendix,
  ].join("\n");
  return {
    text: body,
    evidence,
    diskCheck,
    fixQueue: queue,
    ok: required.length === 0,
    reasons: required,
  };
}

/** Extrae hallazgos reales de salida tsc/typecheck. */
function extractDiagnosticFindings(steps = []) {
  let isDiag = () => false;
  try { isDiag = require("../command-policy").isAcotadoDiagnosticCommand; } catch { /* ignore */ }
  const findings = [];
  for (const step of steps || []) {
    if (String(step?.name || "") !== "run_command") continue;
    const cmd = String(step?.input?.command || "");
    if (!isDiag(cmd) && !/\b(?:typecheck|tsc\b.*--noEmit)\b/i.test(cmd)) continue;
    const out = String(step?.result?.output || step?.result?.stderr || step?.result?.summary || (typeof step?.result === "string" ? step.result : "") || "");
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || findings.length >= 24) break;
      // path(line,col): error TSxxxx: message
      const ts = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/i.exec(trimmed);
      if (ts) {
        findings.push({
          path: ts[1].replace(/\\/g, "/"),
          line: Number(ts[2]) || 1,
          label: `${ts[4]}: ${ts[5].slice(0, 120)}`,
          evidence: trimmed.slice(0, 160),
          source: "typecheck",
        });
        continue;
      }
      const ts2 = /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/i.exec(trimmed);
      if (ts2) {
        findings.push({
          path: ts2[1].replace(/\\/g, "/"),
          line: Number(ts2[2]) || 1,
          label: `${ts2[4]}: ${ts2[5].slice(0, 120)}`,
          evidence: trimmed.slice(0, 160),
          source: "typecheck",
        });
      }
    }
  }
  return findings;
}

/**
 * Cola de fixes: cada mutacion debe verificarse; narracion no puede inventar archivos corregidos.
 */
function assessFixQueue(steps = [], projectRoot = "", options = {}) {
  const evidence = collectToolEvidence(steps, projectRoot);
  const items = [];
  const reasons = [];
  const mutatedNorm = new Set();

  for (const mutation of evidence.filesMutated || []) {
    const target = mutation.path || mutation.normalized;
    const norm = mutation.normalized || normalizePath(target, projectRoot);
    mutatedNorm.add(String(norm || "").toLowerCase());
    mutatedNorm.add(basenameOf(target).toLowerCase());
    const verified = (evidence.verifications || []).some((item) => {
      const ref = String(item.path || item.command || "");
      return normalizePath(ref, projectRoot) === norm
        || basenameOf(ref) === basenameOf(target)
        || (item.name === "run_command" && item.ok);
    });
    items.push({
      target,
      mutated: true,
      verified,
      tool: mutation.tool,
    });
    if (!verified) {
      reasons.push(`${target}: falta verificacion posterior (read_file/run_command) tras la mutacion.`);
    }
  }

  const finalText = String(options.finalText || "");
  if (finalText && /(?:corregid|arregl|reparad|fixed|listo|completad)/i.test(finalText)) {
    const claimed = extractClaimedPaths(finalText)
      .filter((p) => isCodeSourcePath(p) || looksLikeFilePath(p))
      .filter((p) => !isDocNoisePath(p) && !isJunkRepairTargetPath(p));
    const unmatched = [];
    for (const claim of claimed) {
      const norm = normalizePath(claim, projectRoot).toLowerCase();
      const base = basenameOf(claim).toLowerCase();
      if (mutatedNorm.has(norm) || mutatedNorm.has(base)) continue;
      unmatched.push(claim);
    }
    if (unmatched.length >= 1) {
      reasons.push(`Narracion afirma correcciones sin mutacion real: ${[...new Set(unmatched)].slice(0, 6).join(", ")}`);
    }
  }

  return {
    ok: reasons.length === 0 && (items.length === 0 || items.every((item) => item.verified)),
    items,
    reasons,
    mutatedCount: items.length,
    verifiedCount: items.filter((item) => item.verified).length,
  };
}

function resolveAnalysisDiagnosticCommand(evidence = {}) {
  const pkg = (evidence.filesRead || []).find((row) => /(?:^|\/)package\.json$/i.test(String(row.path || "").replace(/\\/g, "/")));
  const content = String(pkg?.content || "");
  if (/"typecheck"\s*:/.test(content)) return "npm run typecheck";
  const hasTsconfig = (evidence.listed || []).some((row) => /(?:^|\/)tsconfig[^/]*\.json$/i.test(String(row.path || "").replace(/\\/g, "/")))
    || (evidence.filesRead || []).some((row) => /(?:^|\/)tsconfig[^/]*\.json$/i.test(String(row.path || "").replace(/\\/g, "/")))
    || (evidence.filesRead || []).some((row) => /\.tsx?$/i.test(String(row.path || "")));
  if (hasTsconfig) return "npx tsc --noEmit";
  return "";
}

function analysisReportPromptForEvidence(evidence) {
  const files = (evidence.filesRead || []).map((f) => f.path).slice(0, 40);
  return [
    "Ahora redacta el REPORTE FINAL de investigacion (tu analisis real, no una plantilla).",
    "Usa SOLO evidencia de herramientas ya ejecutadas. PROHIBIDO inventar carpetas/archivos no leidos.",
    `ARCHIVOS REALMENTE LEIDOS (${files.length}): ${files.join(", ") || "ninguno"}`,
    "Secciones obligatorias en markdown:",
    "## Qué sí funcionó",
    "## Qué falló / hallazgos (archivo + evidencia concreta de lo leido)",
    "## Qué falta para que funcione",
    "## Evidencia",
    "## Cómo lo corregiré (plan accionable)",
    "Cierra con: Cuando autorices procedo con las correcciones. (Omitelo si no hay correcciones comprobables.)",
    "PROHIBIDO mas herramientas en este turno. Razona y escribe el informe completo en espanol.",
  ].join("\n");
}

function hasMutationEvidence(steps = []) {
  return (steps || []).some((step) => MUTATION_TOOLS.has(String(step?.name || "")) && step?.ok !== false && !step?.result?.error);
}

function hasNarrationOnlyClaim(text = "") {
  return /\b(?:acci[oó]n\s*\d+|voy a corregir|he corregido|el archivo ha sido corregido|refactoriz|modificar[eé]|los cambios (?:ser[aá]n|han sido))\b/i.test(String(text || ""));
}

function narrationClaimsCompletedWork(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  return /\b(cre[eé]|escrib[ií]|gener[eé]|implement[eé]|añad[ií]|agregu[eé]|modifiqu[eé]|actualic[eé]|correg[ií]|constru[ií]|desarroll[eé]|mont[eé])\b/i.test(raw)
    && /\b(archivo|carpeta|proyecto|c[oó]digo|componente|m[oó]dulo|package\.json|readme|layout|p[aá]gina|api|endpoint|servidor|scaffold|estructura)\b/i.test(raw);
}

function narrationLooksLikeSimulatedWork(text, steps = [], projectRoot = "", { requiresWrite = false } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (narrationLooksLikeInventedAnalysis(raw, steps, projectRoot)) return true;
  if (!requiresWrite) return false;
  if (hasNarrationOnlyClaim(raw) || narrationClaimsCompletedWork(raw)) {
    return !hasMutationEvidence(steps);
  }
  if (!hasMutationEvidence(steps) && /\b(listo|completad[oa]|terminad[oa]|hecho|✓|✔|creado|escrito|generado|implementado)\b/i.test(raw)) {
    return true;
  }
  return false;
}

const ROOT_MANIFEST_RE = /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.json|cargo\.toml|pyproject\.toml|requirements\.txt|go\.mod|readme(?:\.md)?|tsconfig\.json|jsconfig\.json|next\.config\.(?:js|mjs|cjs|ts)|\.eslintrc(?:\.json|\.cjs|\.js)?|eslint\.config\.(?:js|mjs|cjs)|postcss\.config\.(?:js|mjs|cjs)|tailwind\.config\.(?:js|mjs|cjs|ts))$/i;

function normalizeDiscoveryPath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function createDiscoveryLedger(options = {}) {
  const files = new Set();
  const dirs = new Set();
  const projectRoot = String(options.projectRoot || "").trim();
  const explicitTargets = new Set(
    (Array.isArray(options.explicitTargets) ? options.explicitTargets : [])
      .map((item) => String(item || "").replace(/\\/g, "/").replace(/^\.\//, "").trim())
      .filter(Boolean),
  );

  const toRelative = (value = "") => {
    let rel = normalizeDiscoveryPath(value);
    if (!rel) return "";
    if (projectRoot && (/^[A-Za-z]:[\\/]/.test(String(value || "")) || path.isAbsolute(String(value || "")))) {
      try {
        const absolute = path.resolve(String(value));
        const relative = path.relative(path.resolve(projectRoot), absolute).replace(/\\/g, "/");
        if (relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)) {
          rel = normalizeDiscoveryPath(relative);
        }
      } catch {
        // keep normalized rel
      }
    }
    return rel;
  };

  const rememberEntry = (value, kind = "") => {
    const rel = toRelative(value);
    if (!rel || rel === ".") return;
    if (kind === "directory") dirs.add(rel);
    else files.add(rel);
  };

  const fileExistsInProject = (rel) => {
    if (!projectRoot || !rel) return false;
    try {
      const absolute = path.resolve(projectRoot, rel);
      const relative = path.relative(path.resolve(projectRoot), absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
      return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    } catch {
      return false;
    }
  };

  return {
    rememberList(dirPath, entries = []) {
      const dir = toRelative(dirPath);
      dirs.add(dir);
      for (const entry of entries || []) {
        if (entry == null) continue;
        if (typeof entry === "string") {
          rememberEntry(entry, "");
          continue;
        }
        const rel = entry.path || entry.name || "";
        const kind = entry.kind || (entry.isDirectory ? "directory" : "file");
        rememberEntry(rel, kind);
      }
    },
    rememberSearch(hits = []) {
      for (const hit of hits || []) {
        if (hit == null) continue;
        rememberEntry(typeof hit === "string" ? hit : hit.path, "file");
      }
    },
    assertReadable(relPath) {
      const rel = toRelative(relPath);
      if (!rel) {
        const error = new Error("read_file requiere un path concreto.");
        error.code = "PATH_NOT_DISCOVERED";
        throw error;
      }
      const base = rel.split("/").pop() || "";
      // Targets explicitos del prompt: se pueden leer sin list_files previo.
      const explicitHit = [...explicitTargets].some((target) => {
        const t = toRelative(target) || String(target || "").replace(/\\/g, "/");
        if (!t) return false;
        if (rel === t || rel.endsWith(`/${t}`) || t.endsWith(`/${rel}`)) return true;
        return base && (base === t || t.endsWith(`/${base}`));
      });
      if (explicitHit && (fileExistsInProject(rel) || !projectRoot)) {
        files.add(rel);
        return { ok: true, reason: "explicit-target" };
      }
      if (explicitHit && fileExistsInProject(base) && !rel.includes("/")) {
        files.add(base);
        return { ok: true, reason: "explicit-target-base" };
      }
      // Basename match against explicit target that exists on disk.
      if (base && [...explicitTargets].some((target) => {
        const tb = String(target || "").replace(/\\/g, "/").split("/").pop();
        return tb && tb.toLowerCase() === base.toLowerCase();
      })) {
        const full = [...explicitTargets].find((target) => {
          const tb = String(target || "").replace(/\\/g, "/").split("/").pop();
          return tb && tb.toLowerCase() === base.toLowerCase();
        });
        const candidate = toRelative(full) || String(full || "").replace(/\\/g, "/");
        if (candidate && fileExistsInProject(candidate)) {
          files.add(candidate);
          return { ok: true, reason: "explicit-target-exists" };
        }
        if (fileExistsInProject(rel)) {
          files.add(rel);
          return { ok: true, reason: "explicit-target-rel" };
        }
      }
      if (ROOT_MANIFEST_RE.test(base) && !rel.includes("/")) return { ok: true, reason: "root-manifest" };
      // Si el archivo EXISTE en disco, se puede leer siempre (no inventado).
      // Evita detener el agente por "Path no descubierto" cuando el path es real.
      if (fileExistsInProject(rel)) {
        files.add(rel);
        return { ok: true, reason: "exists-on-disk" };
      }
      // Permitir archivos comunes de proyecto sin necesitar listado previo.
      // El agente sabe que package.json, server.js, app.js, index.js existen
      // en casi todo proyecto — bloquearlos fuerza tool calls innecesarios.
      if (!rel.includes("/") && /^(server|app|index|main|auth)\.(js|ts|mjs|cjs|py)$/i.test(base)) {
        if (fileExistsInProject(rel)) { files.add(rel); return { ok: true, reason: "common-root-file" }; }
      }
      if (files.has(rel)) return { ok: true, reason: "discovered" };
      const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const ancestorListed = (() => {
        if (dirs.has("")) return true;
        if (dirs.has(parent)) return true;
        const parts = rel.split("/").filter(Boolean);
        for (let i = 1; i < parts.length; i += 1) {
          if (dirs.has(parts.slice(0, i).join("/"))) return true;
        }
        return false;
      })();
      // Ancestro listado + archivo real en disco: no mentir con "omitido".
      if (ancestorListed && fileExistsInProject(rel)) {
        files.add(rel);
        return { ok: true, reason: "exists-under-listed-ancestor" };
      }
      if (dirs.has(parent)) {
        const error = new Error(
          `"${rel}" no aparecio al listar "${parent || "."}". No inventes rutas (Vite/CRA/Express). Usa list_files o search_files sobre el arbol real del proyecto.`
        );
        error.code = "PATH_NOT_DISCOVERED";
        throw error;
      }
      if (!dirs.size && !files.size) {
        const error = new Error(`Antes de leer "${rel}", usa list_files en la raiz del proyecto y luego entra a las carpetas internas.`);
        error.code = "PATH_NOT_DISCOVERED";
        throw error;
      }
      const error = new Error(`Path no descubierto: "${rel}". Lista la carpeta padre con list_files antes de read_file.`);
      error.code = "PATH_NOT_DISCOVERED";
      throw error;
    },
    snapshot() {
      return { files: [...files], dirs: [...dirs] };
    },
  };
}

  module.exports = {
  buildEvidenceLedger,
  collectToolEvidence,
  filterStepsForScope,
  stepMatchesScope,
  normalizeRunScope,
  normalizeProjectRoot,
  logStaleEvidenceRejection,
  STALE_EVIDENCE_LOG,
  extractAnalysisTargets,
  analysisTargetCoverage,
  isNamedFileDiagnosticPrompt,
  isDocNoiseTarget,
  collapseDuplicateReportSections,
  formatCurrentRunEvidenceBlock,
  requiredConcreteReads,
  analysisEvidenceSufficient,
  detectContradictoryEvidence,
  formatEvidencePreservationBlock,
  validateGroundedAnalysisReport,
  buildGroundedAnalysisReport,
  buildScopedFocusReport,
  shouldSkipProceedAsk,
  wantsScopedTextProposal,
  buildPlanFromEvidence,
  groundAnalysisReport,
  extractForensicExcerpts,
  formatForensicExcerptsBlock,
  isHollowAnalysisReport,
  isDocNoisePath,
  isVendorOrGeneratedPath,
  isJunkRepairTargetPath,
  isSkippableWalkDir,
  isCodeSourcePath,
  scanContentFindings,
  buildAnalysisCoverageMap,
  nextAnalysisWalkActions,
  formatIncrementalAnalysisNote,
  formatCoverageBlock,
  listedDirectoryTargets,
  isDeepProjectAnalysisPrompt,
  buildExecutionEvidenceReport,
  assessFixQueue,
  extractDiagnosticFindings,
  resolveAnalysisDiagnosticCommand,
  verifyMutationsOnDisk,
  formatEvidenceAppendix,
  analysisReportPromptForEvidence,
  extractClaimedPaths,
  normalizePath,
  looksLikeFilePath,
  hasMutationEvidence,
  hasNarrationOnlyClaim,
  narrationClaimsCompletedWork,
  narrationLooksLikeSimulatedWork,
  shouldSkipProceedAsk,
  createDiscoveryLedger,
  normalizeDiscoveryPath,
  detectPhantomStackClaims,
  narrationLooksLikeInventedAnalysis,
  MUTATION_TOOLS,
};
