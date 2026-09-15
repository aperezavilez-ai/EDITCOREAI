"use strict";

const path = require("node:path");

const GENERATED_PROJECT_DIRS = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel", ".wrangler",
  ".tanstack", ".lovable", ".workspace", ".cache", "node_modules", "dist", "build", "coverage", "out",
]);

const DISCOVERY_TOOLS = new Set([
  "project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan",
  "list_files", "search_files", "read_file", "connection_status", "service_read",
]);
const MUTATION_TOOLS = new Set([
  "write_file", "replace_in_file", "create_project", "service_write",
  "create_pdf", "create_word", "create_excel", "create_csv",
]);
const VERIFICATION_COMMAND = /(^|\s)(test|build|lint|(?:--)?check|typecheck)(\s|$)/i;

const TOOL_ALIASES = {
  "file_search": "list_files",
  "file_reader": "read_file",
  "read_multiple_files": "read_file",
  "search_code": "search_files",
  "list_directory": "list_files"
};

function normalizeToolCall(name, input = {}) {
  const cleanName = String(name || "").trim();
  const resolvedName = TOOL_ALIASES[cleanName] || cleanName;
  
  let normalizedInput = input && typeof input === "object" ? { ...input } : {};
  if (cleanName === "file_reader" && normalizedInput.filepath && !normalizedInput.path) {
    normalizedInput.path = normalizedInput.filepath;
  }
  if (cleanName === "file_search" && normalizedInput.directory && !normalizedInput.path) {
    normalizedInput.path = normalizedInput.directory;
  }
  
  return { name: resolvedName, input: normalizedInput };
}

function contentText(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function sliceAtWordBoundary(text, limit) {
  if (text.length <= limit) return text;
  const lastSpace = text.lastIndexOf(" ", limit);
  const lastNewline = text.lastIndexOf("\n", limit);
  const breakPoint = Math.max(lastSpace, lastNewline);
  if (breakPoint > limit * 0.75) {
    return text.slice(0, breakPoint).trimEnd();
  }
  return text.slice(0, limit);
}

function truncateText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${sliceAtWordBoundary(text, maxChars)}\n[EditCore: contenido truncado; solicita un rango mas especifico]`;
}

function truncateAnchoredText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  const marker = "\n[EditCore: contexto intermedio compactado]\n";
  const available = Math.max(200, maxChars - marker.length);
  const head = Math.ceil(available * 0.62);
  const headSlice = sliceAtWordBoundary(text, head);
  const tailRaw = text.slice(-(available - head));
  const firstSpace = tailRaw.indexOf(" ");
  const tailSlice = firstSpace > 0 && firstSpace < 30 ? tailRaw.slice(firstSpace + 1) : tailRaw;
  return `${headSlice}${marker}${tailSlice}`;
}

function compactAgentMessages(messages, steps = [], options = {}) {
  const maxContentChars = Math.max(1000, Number(options.maxContentChars) || 4_000);
  const maxRecent = Math.max(2, Number(options.maxRecent) || 2);
  const normalized = messages.map((message, index) => ({
    ...message,
    content: typeof message.content === "string"
      ? (index === 1 ? truncateAnchoredText(message.content, maxContentChars) : truncateText(message.content, maxContentChars))
      : Array.isArray(message.content)
        ? message.content.map((part) =>
            part && typeof part === "object" && part.type === "text"
              ? { ...part, text: index === 1
                ? truncateAnchoredText(String(part.text || ""), maxContentChars)
                : truncateText(String(part.text || ""), maxContentChars) }
              : part
          )
        : message.content,
  }));
  if (normalized.length <= 4) return normalized;
  const summary = steps.slice(-12).map((step, index) => {
    const result = step?.result?.error ? `ERROR: ${step.result.error}` : "OK";
    const target = step?.input?.path || step?.input?.query || step?.input?.command || "";
    return `${index + 1}. ${step?.name || "accion"}${target ? ` (${truncateText(target, 180)})` : ""}: ${result}`;
  }).join("\n");
  return [
    normalized[0],
    normalized,
    ...(summary ? [{
      role: "user",
      content: `CHECKPOINTS ANTERIORES (no repetir):\n${summary}`,
    }] : []),
    ...normalized.slice(-maxRecent),
  ];
}

function extractTextFromHistoryItem(item) {
  if (!item) return "";
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => (part && typeof part === "object" && part.text ? part.text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return String(item.content || "");
}

function summarizeHistoryMessages(items = [], maxSummaryChars = 4000) {
  if (!Array.isArray(items) || !items.length) return "";
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const role = it?.role === "assistant" ? "Asistente" : "Usuario";
    const text = extractTextFromHistoryItem(it).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const preview = text.length > 220 ? `${text.slice(0, 217)}...` : text;
    lines.push(`• [Turno previo ${i + 1} - ${role}]: ${preview}`);
  }
  if (!lines.length) return "";
  let joined = lines.join("\n");
  if (joined.length > maxSummaryChars) {
    joined = joined.slice(0, maxSummaryChars - 3) + "...";
  }
  return `[HISTORIAL PREVIO CONVERSACIONAL (Requisitos, directrices y contexto de turnos anteriores)]:\n${joined}`;
}

function compactChatHistory(history = [], options = {}) {
  const maxMessages = Math.max(2, Number(options.maxMessages) || 24);
  const maxContentChars = Math.max(400, Number(options.maxContentChars) || 8_000);
  const maxTotalChars = Math.max(1200, Number(options.maxTotalChars) || 48_000);
  const rows = [];
  let used = 0;
  const recentSlice = history.slice(-maxMessages);
  const seenFingerprints = new Set();
  
  for (const item of recentSlice.reverse()) {
    let content;
    if (Array.isArray(item?.content)) {
      content = item.content.map((part) =>
        part && typeof part === "object" && part.type === "text"
          ? { ...part, text: truncateText(String(part.text || ""), maxContentChars) }
          : part
      );
      const approxLen = JSON.stringify(content).length;
      if (rows.length && used + approxLen > maxTotalChars) break;
      rows.push({ role: item?.role === "assistant" ? "assistant" : "user", content });
      used += approxLen;
    } else {
      content = truncateText(item?.content, maxContentChars);
      const fp = String(content || "").slice(0, 100);
      if (seenFingerprints.has(fp)) continue;
      seenFingerprints.add(fp);
      if (rows.length && used + content.length > maxTotalChars) break;
      rows.push({ role: item?.role === "assistant" ? "assistant" : "user", content });
      used += content.length;
    }
  }
  const result = rows.reverse();
  const omittedCount = history.length - result.length;
  if (omittedCount > 0 && options.includeSummary !== false) {
    const omitted = history.slice(0, omittedCount);
    const summary = summarizeHistoryMessages(omitted, Math.min(4000, Math.floor(maxTotalChars * 0.25)));
    if (summary) {
      result.unshift({
        role: "user",
        content: summary,
      });
    }
  }
  return result;
}

function boundToolResult(name, result, options = {}) {
  const archive = (value, maxChars = 16_000) => options.contextStore
    ? options.contextStore.summarize(value, options.metadata || { tool: name }, maxChars)
    : truncateText(value, maxChars);
  if (result?.error) return {
    error: truncateText(result.error, 2_000),
    ...(result.diagnosis ? { diagnosis: result.diagnosis } : {}),
    ...(result.repair ? { repair: result.repair } : {}),
    ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
  };
  if (name === "list_files" && Array.isArray(result)) {
    if (result.length <= 80) return result.map(({ name: entryName, path, kind }) => ({ name: entryName, path, kind }));
    const clean = result.map(({ name: entryName, path, kind }) => ({ name: entryName, path, kind }));
    const reference = options.contextStore?.store(clean, options.metadata || { tool: name });
    const visible = clean.slice(0, 80);
    if (reference) visible.push({ name: "[context]", path: reference.id, kind: `${clean.length - 80} entradas adicionales; usa retrieve_context` });
    return visible;
  }
  if (name === "search_files" && Array.isArray(result)) {
    if (result.length <= 50) return result;
    const reference = options.contextStore?.store(result, options.metadata || { tool: name });
    return [...result.slice(0, 50), ...(reference ? [{ contextId: reference.id, omitted: result.length - 50 }] : [])];
  }
  if (name === "read_file" && result && typeof result === "object") {
    return { ...result, content: String(result.content || "") };
  }
  if (name === "inspect_preview" && result && typeof result === "object") {
    const { imageDataUrl, ...summary } = result;
    return summary;
  }
  const command = String(options.metadata?.input?.command || "");
  if (typeof result === "string") {
    if (name === "run_command" && /\bgit\s+(?:diff|show)\b/i.test(command)) return result;
    return archive(result, 16_000);
  }
  const serialized = archive(JSON.stringify(result), 16_000);
  try { return JSON.parse(serialized); } catch { return serialized; }
}

function isRetryableProviderStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(Number(status));
}

function classifyModelCapability(result) {
  if (result?.toolOK) return "agent";
  if (result?.chatOK) return "chat";
  return "unavailable";
}

function agentTaskRequirements(task, canWrite = true, options = {}) {
  const value = String(task || "");
  if (options.planAuthorized === true) {
    const exhaustive = /\b(todo|toda|todos|todas|completo|completa|completamente|exhaustiv[oa]|profund[oa]|quirurgic[oa]|integral|sin omitir|archivo por archivo|funcion por funcion)\b/i.test(value);
    const visual = /\b(interfaz|frontend|visual|web|website|landing|dashboard|pagina|p[aá]gina|dise[nñ]o|ux|ui)\b/i.test(value);
    return {
      read: true,
      write: canWrite,
      verification: canWrite,
      analysisOnly: false,
      visual,
      exhaustive,
      minimumEvidence: exhaustive ? 10 : 4,
      targetFiles: extractTaskFilePaths(value),
      verificationCommands: extractTaskVerificationCommands(value),
      baselineVerificationFirst: /^\s*primero\s+ejecuta\b[^.\n]*(?:test|build|lint|check|typecheck)/i.test(value),
    };
  }
  const hasAnalysisKeyword = /\b(?:solo\s+)?analiz[ae]|\banalisis\b|\breporte\b|\bdiagnostica\b|\baudita\b|\brevisa\b|\bidentifica\s+errores?\b|\bexplora\b|\binspecciona\b|\bhallazgos?\b/i.test(value);
  const asksReportOnly = /\b(?:dame|genera|quiero|necesito|entrega|redacta)?\s*(?:un\s+)?(?:reporte|diagn[oó]stico|an[aá]lisis|hallazgos)\b/i.test(value)
    || /\bhallazgos?\s+a\s+corregir\b/i.test(value)
    || /\b(?:a|para)\s+corregir\b/i.test(value);
  const hasExplicitChange = /\b(?:crea|crear|corrige|corrije|corregir|modifica|modificar|agrega|agregar|elimina|eliminar|instala|instalar|implementa|implementar|repara|reparar|actualiza|actualizar|cambia|cambiar|construye|construir|desarrolla|desarrollar|configura|configurar|haz\s+(?:los?|las?|un|una)\b|arregla|arreglar|soluciona|solucionar|resuelve|resolver|integra|integrar|conecta|conectar|restaura|restaurar|recupera|recuperar|termina\s+(?:los?|las?|esta)\b|genera\s+(?:el|un|la|una)\b|añade|añadir|escribe\s+(?:el|un|la|una)\b)\b/i.test(value)
    && !asksReportOnly;
  const hasPlanRequest = /\b(?:propon|recomiend|informa|reporta|pregunta|autoriza|autorizacion|antes de (?:corregir|modificar|cambiar)|hallazgos?\s+a\s+corregir|(?:a|para)\s+corregir)\b/i.test(value);
  const analysisOnly = hasAnalysisKeyword && (!hasExplicitChange || hasPlanRequest || asksReportOnly);

  const explicitChange = /\b(crea|crear|corrige|corrije|corregir|modifica|modificar|agrega|agregar|elimina|eliminar|instala|instalar|implementa|implementar|repara|reparar|actualiza|actualizar|cambia|cambiar|construye|construir|desarrolla|desarrollar|configura|configurar|haz|hacer|arregla|arreglar|soluciona|solucionar|resuelve|resolver|integra|integrar|conecta|conectar|restaura|restaurar|recupera|recuperar|termina|terminar)\b/i.test(value);
  const reportedFailure = /\b(error|falla|fallo|roto|cortad[oa]|bloquead[oa]|no (?:abre|carga|funciona|responde|envia|guarda|activa|aparece|muestra)|se (?:corta|bloquea|cierra|detiene))\b/i.test(value);
  const modification = canWrite && !analysisOnly && (explicitChange || reportedFailure);
  let depthProfile = null;
  try {
    depthProfile = require("./runtime/analysis-depth").resolveAnalysisDepth(value);
  } catch {
    depthProfile = null;
  }
  const exhaustive = Boolean(depthProfile && ["deep", "surgical", "forensic", "exhaustive"].includes(depthProfile.depth))
    || /\b(todo|toda|todos|todas|completo|completa|completamente|exhaustiv[oa]|profund[oa]|quirurgic[oa]|forense|integral|sin omitir|archivo por archivo|funcion por funcion|carpeta por carpeta)\b/i.test(value)
    || (analysisOnly && /\b(?:proyecto|hallazgos|errores|reporte|codigo|c[oó]digo)\b/i.test(value));
  const visual = modification && /\b(interfaz|frontend|visual|web|website|landing|dashboard|pagina|p[aá]gina|dise[nñ]o|ux|ui)\b/i.test(value);
  return {
    read: true,
    write: modification,
    verification: modification,
    analysisOnly,
    visual,
    exhaustive,
    analysisDepth: depthProfile?.depth || "standard",
    analysisDepthLabel: depthProfile?.label || "Analisis estandar",
    minimumEvidence: Number(depthProfile?.minimumEvidence || (exhaustive ? 16 : 6)),
    targetFiles: extractTaskFilePaths(value),
    verificationCommands: extractTaskVerificationCommands(value),
    baselineVerificationFirst: /^\s*primero\s+ejecuta\b[^.\n]*(?:test|build|lint|check|typecheck)/i.test(value),
  };
}

function extractTaskFilePaths(task = "") {
  const matches = String(task).match(/(?:^|[\s`'"(])((?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]{1,10})(?=$|[\s`'",;)])/g) || [];
  return [...new Set(matches.map((value) => value.trim().replace(/^[`'"(]+|[`'",;)]+$/g, "").replace(/\\/g, "/")))];
}

function extractTaskVerificationCommands(task = "") {
  const commands = [];
  for (const match of String(task || "").matchAll(/\b(npm|pnpm|bun)\s+(test|run\s+(?:build|check|lint|test|test:unit|typecheck|verify))\b/gi)) {
    commands.push(match[0].replace(/\s+/g, " ").toLowerCase());
  }
  return [...new Set(commands)];
}

function selectRequiredHostVerification({ requirements = {}, changedFiles = [], missingCommands = [], repairPending = false } = {}) {
  if (requirements.write !== true || repairPending || !changedFiles.length || !missingCommands.length) return "";
  return String(missingCommands[0] || "").trim().toLowerCase();
}

function selectRequiredHostInspection({ requirements = {}, targetFiles = [] } = {}) {
  if (requirements.write !== true || !targetFiles.length) return "";
  return String(targetFiles[0] || "").replace(/\\/g, "/");
}

function normalizeMutationPath(value, projectRoot = "") {
  const raw = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const root = String(projectRoot || "").trim();
  if (!raw || !root) return raw.toLowerCase();
  const absolute = path.resolve(raw);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, absolute).replace(/\\/g, "/");
  if (relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)) return relative.toLowerCase();
  return raw.toLowerCase();
}

function classifyAgentStep(step = {}) {
  const resolvedName = TOOL_ALIASES[step.name] || step.name;
  if (MUTATION_TOOLS.has(resolvedName)) return "mutation";
  if (resolvedName === "run_command" && VERIFICATION_COMMAND.test(String(step.input?.command || ""))) return "verification";
  if (DISCOVERY_TOOLS.has(resolvedName)) return "discovery";
  return "other";
}

function isFailedDiagnosticResult(result) {
  if (result == null) return false;
  if (typeof result === "object") {
    if (result.diagnostic === true && result.passed === false) return true;
    if (result.passed === false && Number.isFinite(Number(result.exitCode)) && Number(result.exitCode) !== 0) return true;
    const text = String(result.output || result.summary || "");
    if (/Resultado de verificacion:\s*FALLO/i.test(text)) return true;
    const match = /verificacion finalizado con exit\s+(\d+)/i.exec(text);
    if (match) return Number(match) !== 0;
    return false;
  }
  const text = String(result);
  if (/Resultado de verificacion:\s*FALLO/i.test(text)) return true;
  const match = /verificacion finalizado con exit\s+(\d+)/i.exec(text);
  return match ? Number(match) !== 0 : false;
}

function verificationStepPassed(step = {}) {
  if (!step || step.ok === false || step.result?.error) return false;
  if (classifyAgentStep(step) !== "verification") return false;
  if (isFailedDiagnosticResult(step.result)) return false;
  return true;
}

function agentStepSignature(step = {}) {
  const normalized = normalizeToolCall(step.name, step.input);
  const name = String(normalized.name || "");
  const source = normalized.input && typeof normalized.input === "object" ? { ...normalized.input } : {};
  const input = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false));
  if (["project_discovery", "codebase_map"].includes(name)) delete input.path;
  return JSON.stringify({ name, input });
}

function prepareResumeSteps(steps = [], maxSteps = 10) {
  const successful = steps.filter((step) => step && step.ok !== false && !step.result?.error);
  const latestFailure = steps.slice().reverse().find((step) => step && (step.ok === false || step.result?.error)) || null;
  const unique = [];
  const seen = new Set();
  for (const step of successful.slice().reverse()) {
    const signature = agentStepSignature(step);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(step);
  }
  const ordered = unique.reverse();
  const durable = ordered.filter((step) => ["mutation", "verification"].includes(classifyAgentStep(step)));
  const context = ordered.filter((step) => !["mutation", "verification"].includes(classifyAgentStep(step))).slice(-4);
  const resumable = [...context, ...durable];
  if (latestFailure && !resumable.includes(latestFailure)) resumable.push(latestFailure);
  return resumable.sort((a, b) => Number(a.index || 0) - Number(b.index || 0)).slice(-Math.max(4, maxSteps));
}

function createAgentBudget(task, canWrite = true, resumeSteps = [], session = {}) {
  const requirements = agentTaskRequirements(task, canWrite);
  const usefulResume = prepareResumeSteps(resumeSteps).some((step) => ["mutation", "verification"].includes(classifyAgentStep(step)));
  const fileCount = Math.max(0, Number(session.fileCount) || 0);
  const rootEntryCount = Math.max(0, Number(session.rootEntryCount) || 0);
  const packageSignals = Math.max(0, Number(session.packageSignals) || 0);
  const taskSignals = Math.max(0, Math.ceil(String(task || "").length / 120));
  const complexity = Math.min(4, Math.floor(fileCount / 80) + Math.floor(rootEntryCount / 20) + Math.min(2, packageSignals) + Math.min(2, taskSignals));
  const usedProviderCalls = Math.max(0, Number(session.usedProviderCalls) || 0);
  const usedNetInputTokens = Math.max(0, Number(session.usedNetInputTokens) || 0);
  const segmentProviderCalls = Math.min(80, (requirements.write ? 28 : 24) + complexity * 4 + (requirements.exhaustive ? 16 : 0) - (usefulResume ? 2 : 0));
  const segmentNetInputTokens = (requirements.write ? 80_000 : 60_000) + complexity * 8_000 + (requirements.exhaustive ? 20_000 : 0);
  return {
    maxProviderCalls: segmentProviderCalls,
    verificationReserve: requirements.write ? 2 : 1,
    maxNetInputTokens: segmentNetInputTokens,
    totalProviderCalls: null,
    hasProviderCallLimit: false,
    totalNetInputTokens: null,
    usedProviderCalls,
    usedNetInputTokens,
    remainingProviderCalls: null,
    remainingNetInputTokens: null,
    maxDiscoveryStreak: 4,
    maxNoProgressStreak: 5,
    maxExactAttempts: 3,
    maxDuplicateBlocks: 3,
    requirements,
  };
}

function calculateAgentNetInputTokens(items = []) {
  return items.reduce((sum, item) => {
    const confirmed = Number(item?.confirmed_input_tokens || item?.prompt_tokens || 0);
    const estimated = Number(item?.estimated_input_tokens || item?.request_input_tokens_estimate || 0);
    const cacheRead = Number(item?.provider_cache_read_tokens || item?.cache_read_input_tokens || item?.cached_tokens || 0);
    return sum + Math.max(0, (confirmed || estimated) - cacheRead);
  }, 0);
}

function analyzeAgentProgress(steps = []) {
  const seen = new Set();
  let discoveryStreak = 0;
  let noProgressStreak = 0;
  let lastError = "";
  for (const step of steps) {
    const kind = classifyAgentStep(step);
    const signature = agentStepSignature(step);
    const successful = step?.ok !== false && !step?.result?.error;
    const repeated = seen.has(signature);
    const meaningful = successful && (["mutation", "verification"].includes(kind) || !repeated);
    if (successful) seen.add(signature);
    discoveryStreak = kind === "discovery" && repeated ? discoveryStreak + 1 : 0;
    noProgressStreak = meaningful ? 0 : noProgressStreak + 1;
    if (!successful) lastError = String(step?.result?.error || "Error de herramienta");
  }
  const usefulEvidence = steps.filter((step) => step?.ok !== false && !step?.result?.error)
    .filter((step, index, rows) => rows.findIndex((candidate) => agentStepSignature(candidate) === agentStepSignature(step)) === index).length;
  return { discoveryStreak, noProgressStreak, lastError, uniqueActions: seen.size, usefulEvidence };
}

const VERIFICATION_NOT_FOUND = /not found|no such file|command not found|ENOENT|no existe|no encontrado|cannot find|not recognized|is not recognized|ENOTFOUND|no scripts|missing script/i;

function isShallowReadStep(step, projectRoot = "") {
  if (!step || step.ok === false) return false;
  const resolvedName = TOOL_ALIASES[step.name] || step.name;
  if (!["read_file", "list_files", "project_discovery"].includes(resolvedName)) return false;
  if (step.result?.isDirectory === true) return true;
  const rawPath = String(step.input?.path || step.result?.path || "").trim();
  if (!rawPath || rawPath === "." || rawPath === "./") return true;
  if (!projectRoot) return false;
  try {
    const normalizedRoot = path.resolve(String(projectRoot)).toLowerCase();
    const absolute = /^[A-Za-z]:|^\\\\/.test(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(path.join(String(projectRoot), rawPath));
    if (path.resolve(absolute).toLowerCase() === normalizedRoot) return true;
  } catch {
    return false;
  }
  return false;
}

function validateAgentCompletion(task, steps = [], canWrite = true, options = {}) {
  const requirements = agentTaskRequirements(task, canWrite);
  const successful = steps.filter((step) => step && step.ok !== false && !step.result?.error);
  const allSteps = steps.filter((step) => step);
  const readTools = new Set(["project_discovery", "codebase_map", "symbol_search", "dependency_search", "list_files", "read_file", "search_files", "review_diff"]);
  const writeTools = MUTATION_TOOLS;
  
  const getResolvedName = (s) => TOOL_ALIASES[s.name] || s.name;

  const hasRead = successful.some((step) => readTools.has(getResolvedName(step)));
  const hasWrite = successful.some((step) => writeTools.has(getResolvedName(step)));
  const lastWriteIndex = allSteps.reduce((last, step, index) => writeTools.has(getResolvedName(step)) && step.ok !== false && !step.result?.error ? index : last, -1);
  const successfulAfterWrite = lastWriteIndex < 0 ? successful : allSteps.slice(lastWriteIndex + 1).filter((step) => step && step.ok !== false && !step.result?.error);
  const hasVerification = successfulAfterWrite.some((step) => verificationStepPassed(step));
  const hasVisualInspection = successfulAfterWrite.some((step) => getResolvedName(step) === "inspect_preview"
    || (getResolvedName(step) === "read_file" && requirements.targetFiles.length)
    || (getResolvedName(step) === "run_command" && /(?:build|lint|dev|preview|check)/i.test(String(step.input?.command || "")) && verificationStepPassed(step)));
  
  const analysisEvidenceTools = new Set(["symbol_search", "dependency_search", "read_file", "search_files", "review_diff", "run_command"]);
  const projectRoot = options.projectRoot || "";
  const meaningfulSuccessful = successful.filter((step) => !isShallowReadStep(step, projectRoot));
  const analysisEvidence = new Set(meaningfulSuccessful
    .filter((step) => analysisEvidenceTools.has(getResolvedName(step)))
    .map(agentStepSignature)).size;
  const hasRealFileRead = meaningfulSuccessful.some((step) => getResolvedName(step) === "read_file" && step.result?.isDirectory !== true);
  const changedFiles = new Set(successful
    .filter((step) => writeTools.has(getResolvedName(step)))
    .map((step) => normalizeMutationPath(step.input?.path, projectRoot))
    .filter(Boolean));
  const missingTargetFiles = requirements.targetFiles.filter((file) => !changedFiles.has(normalizeMutationPath(file, projectRoot)));
  const successfulCommands = new Set(successful.filter((step) => verificationStepPassed(step)).map((step) => String(step.input?.command || "").trim().toLowerCase()));
  const missingVerificationCommands = requirements.verificationCommands.filter((command) => !successfulCommands.has(command));
  
  const verificationAttempted = !hasVerification && allSteps.slice(Math.max(0, lastWriteIndex + 1)).some((step) => {
    if (classifyAgentStep(step) !== "verification") return false;
    if (isFailedDiagnosticResult(step.result)) return false;
    const errText = String(step?.result?.error || step?.result?.message || "");
    return VERIFICATION_NOT_FOUND.test(errText);
  });
  const verificationFailed = !hasVerification && allSteps.slice(Math.max(0, lastWriteIndex + 1)).some((step) => (
    classifyAgentStep(step) === "verification" && isFailedDiagnosticResult(step.result)
  ));
  if (options.promptOnlyMode === true) {
    return {
      ok: true,
      requirements,
      hasRead: false,
      hasWrite: false,
      hasVerification: false,
      verificationAttempted: false,
      verificationFailed: false,
      hasVisualInspection: false,
      missingTargetFiles: [],
      missingVerificationCommands: [],
      lastWriteIndex,
    };
  }
  if (options.analysisMode === true && requirements.read && !hasRead) {
    return { ok: false, reason: "El analisis no puede terminar sin evidencia de lectura del proyecto." };
  }
  if (options.analysisMode === true && !options.planAuthorized && !hasRealFileRead) {
    return { ok: false, reason: "El analisis no puede terminar leyendo solo la carpeta raiz. Usa read_file con archivos concretos (package.json, componentes, servicios)." };
  }
  const realFileReads = meaningfulSuccessful.filter((step) => getResolvedName(step) === "read_file" && step.result?.isDirectory !== true).length;
  let analysisTargetsSatisfied = false;
  if (options.analysisMode === true && !options.planAuthorized) {
    try {
      const {
        collectToolEvidence,
        analysisEvidenceSufficient,
        extractAnalysisTargets,
      } = require("./runtime/evidence-grounding");
      const prompt = String(task || "");
      const targets = extractAnalysisTargets(prompt);
      const evidence = collectToolEvidence(allSteps, projectRoot);
      const sufficiency = analysisEvidenceSufficient(evidence, { prompt, targets });
      if (!sufficiency.ok) {
        return { ok: false, reason: sufficiency.reasons.join(" ") || "Falta evidencia de lectura para el analisis." };
      }
      if (targets.length) analysisTargetsSatisfied = true;
    } catch {
      if (realFileReads < 1) {
        return { ok: false, reason: `El analisis requiere al menos 1 archivo concreto leido con read_file (ahora ${realFileReads}).` };
      }
    }
  }
  if (options.analysisMode === true && !options.planAuthorized && !analysisTargetsSatisfied
    && analysisEvidence < requirements.minimumEvidence) {
    return { ok: false, reason: `El analisis requiere ${requirements.minimumEvidence} evidencias concretas distintas y solo existen ${analysisEvidence}.` };
  }
  if (options.planAuthorized === true && requirements.write && !hasWrite) {
    return { ok: false, reason: "El plan ya fue autorizado: debes aplicar cambios reales con write_file o replace_in_file; narrar no cuenta." };
  }
  if (requirements.write && !hasWrite) return { ok: false, reason: "La tarea solicita cambios, pero aun no has escrito ni creado archivos con una herramienta real." };
  if (requirements.write && missingTargetFiles.length) return { ok: false, reason: `Faltan mutaciones requeridas en: ${missingTargetFiles.join(", ")}.` };
  if (requirements.verification && verificationFailed) {
    return {
      ok: false,
      reason: "La verificacion (lint/test/build) se ejecuto pero FALLO. Corrige los errores y vuelve a verificar; un exit distinto de 0 no cuenta como exito.",
      hasVerification: false,
      verificationFailed: true,
      verificationAttempted: false,
    };
  }
  if (requirements.verification && !hasVerification && !verificationAttempted) return { ok: false, reason: "La tarea modifico el proyecto, pero falta una verificacion real con test, build, lint, check o typecheck." };
  if (requirements.verification && missingVerificationCommands.length) return { ok: false, reason: `Faltan verificaciones requeridas: ${missingVerificationCommands.join(", ")}.` };
  if (requirements.visual && !hasVisualInspection) return { ok: false, reason: "La tarea visual requiere verificar con read_file del componente o run_command build/lint antes de completarse." };
  return { ok: true, requirements, hasRead, hasWrite, hasVerification, verificationAttempted, verificationFailed, hasVisualInspection, missingTargetFiles, missingVerificationCommands, lastWriteIndex };
}

module.exports = {
  GENERATED_PROJECT_DIRS,
  TOOL_ALIASES,
  normalizeToolCall,
  boundToolResult,
  calculateAgentNetInputTokens,
  classifyAgentStep,
  classifyModelCapability,
  compactChatHistory,
  compactAgentMessages,
  contentText,
  createAgentBudget,
  extractTaskFilePaths,
  extractTaskVerificationCommands,
  selectRequiredHostVerification,
  selectRequiredHostInspection,
  normalizeMutationPath,
  agentTaskRequirements,
  agentStepSignature,
  analyzeAgentProgress,
  isShallowReadStep,
  isRetryableProviderStatus,
  prepareResumeSteps,
  truncateText,
  validateAgentCompletion,
  isFailedDiagnosticResult,
  verificationStepPassed,
};