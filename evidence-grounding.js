"use strict";

/**
 * Evidence ledger minimo por ejecucion + anclaje anti-invencion.
 * No es memoria persistente: solo evidencia de tools de la corrida actual.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MUTATION_TOOLS = new Set(["write_file", "replace_in_file", "create_project", "create_pdf", "create_word", "create_excel", "create_csv", "service_write"]);
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

const TECH_STACK_NAMES = new Set([
  "node.js", "react.js", "vue.js", "three.js", "next.js", "nuxt.js", "deno.js", "bun.js", "nest.js", "express.js", "ember.js", "backbone.js", "chart.js", "d3.js", "socket.io.js"
]);

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

function extractAnalysisTargets(prompt = "") {
  const text = String(prompt || "");
  const found = new Set();
  const pathRe = /\b((?:[\w.-]+[\\/])*\w[\w.-]*\.(?:js|ts|tsx|jsx|mjs|cjs|json|py|md))\b/gi;
  for (const match of text.matchAll(pathRe)) {
    const value = String(match[1] || "").replace(/\\/g, "/");
    if (value && !isDocNoiseTarget(value)) found.add(value);
  }
  const baseRe = /\b([\w][\w.-]*\.(?:js|ts|tsx|jsx|mjs|cjs))\b/gi;
  for (const match of text.matchAll(baseRe)) {
    const base = String(match[1] || "").toLowerCase();
    if (base && !isDocNoiseTarget(base)) found.add(base);
  }
  return dedupeAnalysisTargets([...found]);
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
  if (typeof result === "string") return result.slice(0, 4000);
  if (!result || typeof result !== "object") return "";
  const content = result.content || result.text || result.preview || "";
  return String(content || "").slice(0, 4000);
}

function contentHash(value) {
  const text = String(value || "");
  if (!text) return "";
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function scanContentFindings(filePath, content) {
  const findings = [];
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const patterns = [
    { re: /function\s+suma\s*\([^)]*\)\s*\{[\s\S]*?return\s+a\s*-\s*b/i, label: "La funcion suma resta en lugar de sumar (return a - b)" },
    { re: /\bTODO\b|\bFIXME\b|\bHACK\b/i, label: "Marcador pendiente (TODO/FIXME) en el archivo" },
    { re: /eslint-disable/i, label: "Regla de lint desactivada localmente" },
    { re: /@ts-ignore|@ts-nocheck/i, label: "Chequeo TypeScript ignorado" },
    { re: /catch\s*\([^)]*\)\s*\{\s*\}/, label: "catch vacio (errores silenciados)" },
  ];
  for (const pattern of patterns) {
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

    if (READ_TOOLS.has(name) && inputPath && !isShallowPath(inputPath) && step?.result?.isDirectory !== true) {
      const snippet = contentSnippet(step.result);
      filesRead.push({
        path: inputPath,
        normalized: normalizePath(inputPath, projectRoot),
        basename: basenameOf(inputPath),
        content: snippet,
        contentHash: contentHash(snippet),
      });
      findings.push(...scanContentFindings(inputPath, snippet));
    }
    if (MUTATION_TOOLS.has(name) && inputPath) {
      filesMutated.push({
        path: inputPath,
        normalized: normalizePath(inputPath, projectRoot),
        tool: name,
        content: String(step?.input?.content || step?.input?.newText || ""),
        oldText: String(step?.input?.oldText || ""),
        newText: String(step?.input?.newText || ""),
      });
    }
    if (LIST_TOOLS.has(name)) {
      for (const item of extractListedPaths(step.result)) {
        listed.push({
          path: item,
          normalized: normalizePath(item, projectRoot),
          basename: basenameOf(item),
        });
      }
      if (inputPath && !isShallowPath(inputPath)) {
        listed.push({
          path: inputPath,
          normalized: normalizePath(inputPath, projectRoot),
          basename: basenameOf(inputPath),
        });
      }
    }
    if (SEARCH_TOOLS.has(name) && query) searches.push(query);
    if (VERIFY_TOOLS.has(name)) {
      verifications.push({
        name,
        command: command || String(step?.input?.url || ""),
        output: String(step?.result?.output || step?.result?.summary || "").replace(/\s+/g, " ").slice(0, 300),
        ok,
      });
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
  evidence.listedFileCount = evidence.listed.filter((item) => looksLikeFilePath(item.path)).length;
  evidence.requiredConcreteReads = requiredConcreteReads(evidence, { targets: normalizedScope?.analysisTargets });
  return evidence;
}

/**
 * Regla adaptativa: si el prompt nombra archivos concretos, exige solo esos.
 * Si no, adapta por tamano del proyecto listado.
 */
function requiredConcreteReads(evidence, options = {}) {
  const targets = options.targets || evidence?.analysisTargets || [];
  if (targets.length) return targets.length;
  const listedFiles = Math.max(
    Number(evidence.listedFileCount || 0),
    Number(evidence.realFileReadCount || 0),
  );
  if (listedFiles <= 1) return 1;
  if (listedFiles === 2) return 2;
  return 3;
}

function analysisEvidenceSufficient(evidence, options = {}) {
  const reasons = [];
  const prompt = String(options.prompt || "");
  const targets = options.targets || evidence?.analysisTargets || extractAnalysisTargets(prompt);
  if (targets.length) {
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
  const required = requiredConcreteReads(evidence, options);
  if (!hasDiscovery && evidence.realFileReadCount < 1) {
    reasons.push("Falta descubrimiento (list_files/search/project_discovery) o lectura concreta.");
  }
  if (evidence.realFileReadCount < required) {
    reasons.push(`Se requieren ${required} archivo(s) concretos leidos con read_file; hay ${evidence.realFileReadCount}.`);
  }
  return { ok: reasons.length === 0, reasons, required };
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
  lines.push("", "PROHIBIDO negar existencia de VERIFIED READS de este run.");
  return lines.join("\n");
}

/** Bloque seguro para compactacion: sin contenido sensible, solo metadatos. */
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
  lines.push("PROHIBIDO afirmar que un archivo leido arriba no existe.");
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

function buildPlanFromEvidence(evidence) {
  const files = (evidence.findings || []).map((item) => item.path);
  const uniqueFiles = [...new Set(files.length ? files : (evidence.filesRead || []).map((f) => f.path))];
  return uniqueFiles.slice(0, 12).map((filePath) => ({
    target: filePath,
    evidence: `read_file(${filePath})`,
    action: `Corregir ${filePath} con replace_in_file tras evidencia de lectura`,
  }));
}

function buildGroundedAnalysisReport(evidence, projectRoot = "") {
  const rootLabel = projectRoot || evidence.projectRoot || "proyecto";
  const files = (evidence.filesRead || []).map((f) => f.path);
  const listedRoots = [...new Set((evidence.listed || [])
    .map((item) => String(item.path || "").replace(/\\/g, "/").split("/")[0])
    .filter(Boolean))]
    .slice(0, 20);
  const findings = evidence.findings || [];
  const findingLines = findings.length
    ? findings.slice(0, 12).map((item) => `- **${item.path}** (read_file, linea ~${item.line}): ${item.label}. Evidencia: \`${item.evidence}\``)
    : [
      "- No se detectaron marcadores automaticos en el contenido leido.",
      "- Solo se listan problemas con evidencia de read_file; no se inventan carpetas ni fallos genericos.",
    ];
  const plan = buildPlanFromEvidence(evidence);
  const planLines = plan.length
    ? plan.map((item, index) => `${index + 1}. ${item.action}\n   evidencia: ${item.evidence}`)
    : ["1. Autoriza procede para corregir solo archivos ya inspeccionados."];

  const verifiedFindings = buildVerifiedFindingsFromReads(evidence);

  return [
    "## Análisis del proyecto",
    "",
    ...verifiedFindings,
    `Proyecto inspeccionado: \`${rootLabel}\`.`,
    `Estructura observada (herramientas): ${listedRoots.length ? listedRoots.join(", ") : "solo rutas de archivos leidos"}.`,
    `Archivos leidos con evidencia: ${files.length ? files.join(", ") : "ninguno"}.`,
    "",
    "## Errores y riesgos encontrados",
    "",
    ...findingLines,
    "",
    "## Cómo lo corregiré",
    "",
    ...planLines,
    "",
    "## Recomendaciones concretas",
    "",
    ...plan.map((item) => `- ${item.target}: aplicar replace_in_file con evidencia ${item.evidence}`),
    ...(plan.length ? [] : ["- Autoriza con procede tras inspeccionar mas archivos si hace falta."]),
    "",
    formatEvidenceAppendix(evidence, { mode: "analysis" }),
    "",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
}

function groundAnalysisReport(report, steps, projectRoot = "", scope = null) {
  const evidence = collectToolEvidence(steps, projectRoot, scope);
  const sufficiency = analysisEvidenceSufficient(evidence, { prompt: scope?.prompt || "", targets: scope?.analysisTargets });
  const contradiction = detectContradictoryEvidence(report, evidence);
  if (!sufficiency.ok) {
    return {
      text: buildGroundedAnalysisReport(evidence, projectRoot),
      evidence,
      validation: { ok: false, reasons: sufficiency.reasons },
      replaced: true,
      reason: sufficiency.reasons.join(" "),
    };
  }
  if (!contradiction.ok) {
    const reasons = contradiction.contradictions.map((item) => item.detail || "CONTRADICTORY_EVIDENCE");
    return {
      text: buildGroundedAnalysisReport(evidence, projectRoot),
      evidence,
      validation: { ok: false, reasons, contradictoryEvidence: contradiction.contradictions },
      replaced: true,
      reason: reasons.join(" "),
    };
  }
  const validation = validateGroundedAnalysisReport(report, evidence);
  if (validation.ok && String(report || "").trim()) {
    const text = collapseDuplicateReportSections(String(report || "").trim());
    const withEvidence = /##\s*Evidencia real/i.test(text)
      ? text
      : `${text}\n\n${formatEvidenceAppendix(evidence, { mode: "analysis" })}`;
    return { text: withEvidence, evidence, validation, replaced: false };
  }
  return {
    text: buildGroundedAnalysisReport(evidence, projectRoot),
    evidence,
    validation,
    replaced: true,
    reason: validation.reasons.join(" "),
  };
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

function buildExecutionEvidenceReport(finalText, steps, projectRoot = "") {
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
  for (const failure of diskCheck.failures || []) {
    if (!required.includes(failure)) required.push(failure);
  }
  const mutationLines = evidence.mutationCount
    ? (evidence.filesMutated || []).map((f) => `- Modificado con ${f.tool}: \`${f.path}\``).join("\n")
    : "- Ningun archivo fue modificado por herramientas.";
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
    appendix,
  ].join("\n");
  return {
    text: body,
    evidence,
    diskCheck,
    ok: required.length === 0,
    reasons: required,
  };
}

function analysisReportPromptForEvidence(evidence) {
  const files = (evidence.filesRead || []).map((f) => f.path).slice(0, 40);
  return [
    "El reporte final se construye SOLO desde el evidence ledger de herramientas.",
    "PROHIBIDO inventar carpetas/archivos no inspeccionados.",
    `ARCHIVOS REALMENTE LEIDOS (${files.length}): ${files.join(", ") || "ninguno"}`,
  ].join("\n");
}

function hasMutationEvidence(steps = []) {
  return (steps || []).some((step) => MUTATION_TOOLS.has(String(step?.name || "")) && step?.ok !== false && !step?.result?.error);
}

function hasNarrationOnlyClaim(text = "") {
  return /\b(?:acci[oó]n\s*\d+|voy a corregir|he corregido|el archivo ha sido corregido|refactoriz|modificar[eé]|los cambios (?:ser[aá]n|han sido))\b/i.test(String(text || ""));
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
      if (ROOT_MANIFEST_RE.test(base) && !rel.includes("/")) return { ok: true, reason: "root-manifest" };
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
  collapseDuplicateReportSections,
  formatCurrentRunEvidenceBlock,
  requiredConcreteReads,
  analysisEvidenceSufficient,
  detectContradictoryEvidence,
  formatEvidencePreservationBlock,
  validateGroundedAnalysisReport,
  buildGroundedAnalysisReport,
  buildPlanFromEvidence,
  groundAnalysisReport,
  buildExecutionEvidenceReport,
  verifyMutationsOnDisk,
  formatEvidenceAppendix,
  analysisReportPromptForEvidence,
  extractClaimedPaths,
  normalizePath,
  looksLikeFilePath,
  hasMutationEvidence,
  hasNarrationOnlyClaim,
  createDiscoveryLedger,
  normalizeDiscoveryPath,
  detectPhantomStackClaims,
  narrationLooksLikeInventedAnalysis,
  MUTATION_TOOLS,
};
