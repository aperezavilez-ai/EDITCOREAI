"use strict";

/** Portero: una sola decisión por mensaje. Acceso completo aware. */

const STOP_RE = /^\s*(?:alto|detente|cancela|cancelar|stop|para|basta|deten(?:te)?)\s*[.!?]?\s*$/i;
const APPROVAL_RE = /^\s*(?:procede|continua|continúa|hazlo|autorizado|adelante|ejecuta|si|sí|confirmado|procedo|hazlo\s+ya|dale|va|ok)\s*[.!?]?\s*$/i;
// Frases cortas que solo dicen "seguí" ("si avanza", "ok continua por favor", "termínalo").
const CONTINUE_WORDS = new Set(["procede", "procedo", "continua", "continúa", "continuar", "continue", "sigue", "siguele", "síguele", "avanza", "avanzale", "avánzale", "adelante", "hazlo", "dale", "ejecuta", "ejecutalo", "ejecútalo", "autorizado", "confirmado", "confirmo", "si", "sí", "ok", "okay", "va", "ya", "termina", "terminalo", "termínalo", "acaba", "acabalo", "acábalo", "por", "favor", "porfa", "porfavor", "y", "pues", "bueno", "ahora", "todo"]);
function isContinuePhrase(text = "") {
  const words = String(text || "").toLowerCase().replace(/[.,;:!?¡¿]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && words.every((w) => CONTINUE_WORDS.has(w));
}
const CHAT_INFO_RE = /\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es)|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda|hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\b/i;

// Verbos de cambio/escritura. Ganan sobre TASK_VERIFY_RE si el mensaje pide modificar.
const TASK_FIX_RE = /\b(?:corr[eií][gj](?:e|ir|alo|alos|ala|alas|eme|me|as)?(?:me|lo|la|los|las)?|arregl(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|repar(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|solucion(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|resu[eé]lve(?:lo|la|los|las|me)?|resolver(?:lo|la|los|las|me)?|corrige|corrije|corrijelo|corrijelos|corrigelo|corrigelos|corrijelas|corrigelas|arregla|arreglá|arreglalo|arreglalos|arreglala|arreglalas|implementa(?:r|lo|los|la|las)?|aplica|aplicá|aplicalo|aplicalos|aplicala|aplicalas|repara|repará|reparalo|reparalos|soluciona|solucioná|solucionalo|solucionalos|crea(?:r|ción)?|creá|genera(?:r)?|generá|escribe|escrib[ií]|modifica(?:r|lo|los|la|las)?|modificá|modificaciones|modificaci[oó]n|refactoriza(?:r)?|actualiza(?:r|lo|los|la|las)?|actualizá|añade|añadí|agrega(?:r|lo|los|la|las)?|agregá|cambia(?:r|lo|los|la|las)?|cambiá|muev\w*|mov[eé]|copiar?|copiá|haz(?:me|lo|la|los|las)?|hacer|hac[eé](?:me|lo|la)?|cr[eé]a(?:me|lo|la)|gen[eé]ra(?:me|lo|la)|arr[eé]gla(?:me|lo|la)|corr[ií][gj]e(?:me|lo|la)|agr[eé]ga(?:me|lo|la)|arma|armá|scaffold|nuevo\s+proyecto|ejecuta(?:r|lo|los|la|las)?|ejecutá|reemplaza(?:r|lo|los|la|las)?|reemplazá|pon[eé]?|setea(?:r)?|borra(?:r)?|elimina(?:r|lo|los|la|las)?|renombra(?:r)?|run_command|run|build|tsc|npx|npm)\b/i;

const TASK_CLONE_RE = /\b(?:clona|clonar|copia\s+esta\s+p[aá]gina|replica(?:r)?\s+(?:esta\s+)?(?:web|p[aá]gina|sitio)|clone_web_page)\b/i;
const HTTP_URL_RE = /https?:\/\/[^\s)>"']+/i;
const TASK_ANALYZE_RE = /(?:^|[^\w])(?:analiz[aá]|analizar|audita(?:r)?|diagnostica(?:r)?|revisa(?:r)?\s+errores|hallazgos|reporte\s+completo|plan\s+de\s+acci[oó]n)(?=\s|$|[.!,?¿¡:])/i;
// Pedidos de análisis formulados con sustantivo ("hazme un análisis", "dame un informe").
const ANALYSIS_NOUN_RE = /\b(?:an[aá]lisis|auditor[ií]a|diagn[oó]stico|forense|informe|reporte|revisi[oó]n\s+(?:del?|de\s+la|completa|general)|evaluaci[oó]n\s+(?:del?|de\s+la))\b/i;
// Verbos genéricos que acompañan al sustantivo sin pedir escritura.
const GENERIC_REQUEST_VERB_RE = /\b(?:haz(?:me)?|hacer|hac[eé](?:me)?|dame|d[eé]me|quiero|necesito|prepara(?:me)?|genera(?:me)?|gen[eé]rame)\b/gi;
const DOCUMENT_OUTPUT_RE = /\b(?:pdf|word|docx|excel|xlsx|csv|archivo|documento)\b/i;

// ============================================================
// NUEVO: LIST-ONLY agresivo — GANA sobre ANALYZE cuando es un pedido puro de listado.
// Captura: "lista X", "listar X", "enumera X", "muéstrame X", "muéstrame los archivos",
// "qué hay en X", "dame los archivos de X", "contenido de X", "explora X",
// "dime qué hay en X", "cuántos archivos", "los archivos de X".
// ============================================================
const TASK_LIST_ONLY_RE = /(?:^|[^\w])(?:list(?:a|ar|ame|ado)?|enumer(?:a|ar|ame)|muestr(?:a|ame|e|ar)|muéstr(?:a|ame|e|ar)|mostr(?:a|ame|ar)|muéstr(?:a|ame)|dame|dime|ense[ñn]ame|decime|ver|qu[eé]\s+hay\s+en|qu[eé]\s+contiene|contenido\s+(?:de|del?)|los\s+archivos\s+(?:de|del?|en)|las\s+carpetas\s+(?:de|del?|en)|cu[aá]ntos?\s+archivos?|cu[aá]ntas?\s+carpetas?|explora(?:r)?|inspecciona(?:r)?\s+(?:solo\s+)?(?:la\s+)?(?:carpeta|directorio)|ls\b|dir\b)(?=\s|$|[.!,?¿¡:])/i;
// Excluir de LIST-ONLY cuando pide explícitamente analizar/diagnosticar.
const LIST_ONLY_EXCLUDE_RE = /\b(?:analiz[aá]|analizar|audita(?:r)?|diagnostica(?:r)?|revisa(?:r)?\s+errores|hallazgos|forense|profund(?:o|a|idad)|completo|completa|reporte|informe|evaluaci[oó]n|busca(?:r)?|buscar|encuentra|localiza|signIn|login|\bauth\b|check_connections|conect(?:a|ar|iones)?|publica(?:r)?|deploy|checklist|supabase|github|vercel|d[oó]nde\s+est[aá]|en\s+qu[eé]\s+archivo)\b/i;

/** Solo LIST-ONLY si hay contexto de carpeta/listado real (evita que "dime" o "muestra" secuestre busquedas). */
const LIST_FOLDER_CONTEXT_RE = /\b(?:carpeta|directorio|folder|archivos?\s+(?:de|del|en)|list(?:a|ar)|\bls\b|\bdir\b|estructura|contenido\s+(?:de|del)|qu[eé]\s+hay\s+en|explor(?:a|ar)|tree)\b/i;

const TASK_LIST_RE = /\b(?:lista|listar|qu[eé]\s+contiene|qu[eé]\s+hay\s+en|contenido\s+de|muestra\s+(?:la\s+)?carpeta|explora|explorar|explorer|directorio|arbol|árbol)\b/i;
const TASK_READ_RE = /\b(?:explica|explicar|lee|leer|describe|describ[eé]|resume|resumir|revisa|revisar|qu[eé]\s+hace|c[oó]mo\s+funciona|para\s+qu[eé]\s+sirve)\b/i;
const PATHISH_RE = /(?:[\\/]|\b[a-z0-9_.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|css|html|py|rs|go)\b)/i;
const TASK_GIT_RE = /\b(?:commit|push|git\s+status|haz\s+commit)\b/i;
const TASK_DEPLOY_RE = /\b(?:deploy|publica(?:r)?|vercel)\b/i;
const BACKGROUND_RE = /\b(?:segundo\s+plano|en\s+background|background|sin\s+esperar)\b/i;

// Solo matchea si el mensaje EMPIEZA con verbo de verificación.
const TASK_VERIFY_RE = /^\s*(?:verifica(?:r)?|verificá|typecheck|compila(?:r)?|compilá|corre?\s+los?\s+tests?|corre?\s+tsc|pasa?\s+el\s+linter|hac[eé]\s+build|build)\b/i;

function isFullAccess(opts = {}) {
  // NO cambia el permiso del IDE: solo lee lo que la UI ya otorgó.
  if (opts.permissionFull === true || opts.fullAccess === true || opts.allowWrite === true || opts.write === true) return true;
  if (opts.isFullAccess === true || opts.accesoCompleto === true) return true;
  if (opts.readOnly === true || opts.readonly === true || opts.soloLectura === true) return false;

  const raw = [
    opts.permissionMode, opts.mode, opts.permission, opts.accessMode,
    opts.agentPermission, opts.permissions, opts.perm, opts.level,
  ].filter((v) => v != null && v !== "").map((v) => String(v).toLowerCase().trim());

  const joined = raw.join(" | ");
  // Acceso completo / Agente con escritura (variantes UI EditCore)
  if (/(?:acceso[\s_-]*completo|full[\s_-]*access|\bfull\b|\bwrite\b|escritura|\bagente\b|\bagent\b|\bexecute\b|ejecuci[oó]n)/i.test(joined)) {
    if (/(?:solo[\s_-]*lectura|read[\s_-]*only|\breadonly\b|\bchat\b)/i.test(joined) && !/(?:acceso[\s_-]*completo|full[\s_-]*access|\bwrite\b)/i.test(joined)) {
      return false;
    }
    return true;
  }
  if (/(?:solo[\s_-]*lectura|read[\s_-]*only|\breadonly\b)/i.test(joined)) return false;
  // Nivel numérico o flags anidados
  try {
    if (Number(opts.permissionLevel) >= 2) return true;
    if (opts.permissions && typeof opts.permissions === "object") {
      if (opts.permissions.write === true || opts.permissions.full === true || opts.permissions.execute === true) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function classify(message, opts = {}) {
  const text = String(message || "").trim();
  const background = BACKGROUND_RE.test(text);
  const full = isFullAccess(opts);

  if (!text) {
    return { kind: "CHAT", label: "Chat vacío", allowTools: false, allowWrite: false, background: false };
  }
  if (STOP_RE.test(text)) {
    return { kind: "STOP", label: "Parada", allowTools: false, allowWrite: false, background: false };
  }
  if (APPROVAL_RE.test(text) || isContinuePhrase(text) || /^INSTRUCCI[OÓ]N AUTORIZADA DEL USUARIO:/i.test(text)) {
    return { kind: "EXECUTE", label: full ? "Ejecución (Acceso completo)" : "Ejecución autorizada", allowTools: true, allowWrite: true, background };
  }
  if (TASK_CLONE_RE.test(text) && HTTP_URL_RE.test(text)) {
    return { kind: "EXECUTE", label: "Clonar web", allowTools: true, allowWrite: true, background };
  }


  // Busqueda en codigo / conexiones: NUNCA LIST si pide modificar/arreglar
  if (/\b(?:busca(?:r)?|buscar|encuentra|localiza|search_files|search_codebase|signIn|d[oó]nde\s+est[aá])\b/i.test(text) && !TASK_FIX_RE.test(text)) {
    return { kind: "ASK", label: "Busqueda en codigo", allowTools: true, allowWrite: false, background };
  }
  if (/\b(?:check_connections|conect(?:a|ar|iones)?|checklist|publica(?:r)?\s+(?:el\s+)?proyecto|qu[eé]\s+falta.*(?:conect|public))\b/i.test(text)
      || (/\b(?:github|vercel|supabase|gafcore)\b/i.test(text) && /\b(?:conect|public|deploy|checklist|falta)\b/i.test(text))) {
    return { kind: "EXECUTE", label: "Conexiones / publicar", allowTools: true, allowWrite: true, background };
  }

  // ============================================================
  // PRIORIDAD 1: LIST-ONLY explícito (gana sobre ANALYZE)
  // Ej: "lista los archivos de X", "muéstrame la carpeta Y", "qué hay en Z"
  // NO aplica si hay verbo de análisis ("analiza y lista") o sustantivo de análisis ("informe de X").
  // ============================================================
  if (
    TASK_LIST_ONLY_RE.test(text)
    && LIST_FOLDER_CONTEXT_RE.test(text)
    && !LIST_ONLY_EXCLUDE_RE.test(text)
    && !ANALYSIS_NOUN_RE.test(text)
    && !TASK_FIX_RE.test(text.replace(GENERIC_REQUEST_VERB_RE, " "))
    && !TASK_CLONE_RE.test(text)
  ) {
    return { kind: "LIST", label: "Listado", allowTools: true, allowWrite: false, background };
  }

  // PRIORIDAD 2: Análisis con sustantivo ("hazme un análisis", "dame un informe")
  if (
    ANALYSIS_NOUN_RE.test(text)
    && !DOCUMENT_OUTPUT_RE.test(text)
    && !TASK_FIX_RE.test(text.replace(GENERIC_REQUEST_VERB_RE, " "))
  ) {
    return { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background };
  }

  // PRIORIDAD 3: Verbos de cambio (fix gana sobre verify)
  const fixMatch = TASK_FIX_RE.test(text);
  const verifyMatch = TASK_VERIFY_RE.test(text);

  if (fixMatch) {
    const isReadOnly = ["read", "readonly", "solo lectura", "solo-lectura", "chat"].includes(String(opts.permissionMode || "").toLowerCase().trim()) || (opts.allowWrite === false && opts.fullAccess !== true && opts.permissionFull !== true);
    return {
      kind: "EXECUTE",
      label: full ? "Ejecución (Acceso completo)" : "Construcción / Ejecución",
      allowTools: true,
      allowWrite: !isReadOnly,
      background,
    };
  }

  if (verifyMatch) {
    return { kind: "VERIFY", label: "Verificación", allowTools: true, allowWrite: false, background };
  }

  if (TASK_GIT_RE.test(text)) {
    return { kind: "EXECUTE", label: "Git", allowTools: true, allowWrite: true, background };
  }
  if (TASK_DEPLOY_RE.test(text)) {
    return { kind: "EXECUTE", label: "Deploy", allowTools: true, allowWrite: true, background };
  }
  if (TASK_ANALYZE_RE.test(text)) {
    return { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background };
  }
  if (TASK_LIST_RE.test(text)) {
    return { kind: "LIST", label: "Listado", allowTools: true, allowWrite: false, background };
  }
  if (TASK_READ_RE.test(text) || PATHISH_RE.test(text)) {
    return { kind: "ASK", label: "Consulta", allowTools: true, allowWrite: false, background };
  }
  const isQuestionOrChat = CHAT_INFO_RE.test(text)
    || /\?$/i.test(text)
    || /^(?:qu[eé]\s+(?:skills|es|hace|son|hay|opinas|diferencia|cambi[oó]|pasa)|cu[aá]l(?:es)?|c[oó]mo|por\s*qu[eé]|qui[eé]n(?:es)?|cu[aá]ndo|hay\b|ya\s+qued[oó]|qued[oó]|ya\s+quedaron|porque\s+se\s+te\s+acaba|es\s+posible)\b/i.test(text);

  if (isQuestionOrChat) {
    return { kind: "CHAT", label: "Chat", allowTools: false, allowWrite: false, background };
  }

  // --- Fix: NO mandar trabajo a CHAT sin tools ---
  // Antes el default era allowTools:false → el modelo decía "no tengo herramientas/permisos"
  // en tareas largas o ambiguas ("termina X", "sigue con Y", "necesito que arregles Z").
  const looksLikeWork = text.length >= 12
    && !/^(hola|hi|hello|hey|gracias|thanks|ok|vale|bien)\b/i.test(text);
  if (looksLikeWork) {
    if (full) {
      return {
        kind: "EXECUTE",
        label: "Ejecución (Acceso completo, default)",
        allowTools: true,
        allowWrite: true,
        background,
      };
    }
    const softFix = /\b(?:necesito|quiero|podr[ií]as?|puedes|ayúdame|ayudame|termina|completa|continua|continúa|sigue|haz|hacer|por\s+favor)\b/i.test(text);
    return {
      kind: softFix ? "EXECUTE" : "ASK",
      label: softFix ? "Trabajo (inferido)" : "Consulta con tools",
      allowTools: true,
      allowWrite: softFix,
      background,
    };
  }

  return { kind: "CHAT", label: "Chat", allowTools: false, allowWrite: false, background };
}

function loadProjectMapHelpers() {
  try { return require("../runtime/project-map"); }
  catch { try { return require("./project-map"); } catch { return null; } }
}

// Las rutas Windows pueden tener espacios ("D:\PROGRAMAS IA"): se toma la más larga que exista.
function longestExistingWindowsPath(text) {
  const m = String(text || "").match(/\b([A-Za-z]:[\\/][^"'`\r\n]*)/);
  if (!m) return "";
  const fs = require("fs");
  const parts = m[1].trim().split(/(\s+)/);
  for (let n = parts.length; n > 0; n -= 1) {
    const candidate = parts.slice(0, n).join("").trim().replace(/[.,;:!?)]+$/, "");
    if (!candidate) continue;
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* sigue */ }
  }
  return "";
}

function isInsideRoot(root, target) {
  const path = require("path");
  const base = path.resolve(root).toLowerCase();
  const abs = path.resolve(target).toLowerCase();
  return abs === base || abs.startsWith(base + path.sep);
}

function extractListTarget(message, projectRoot = null) {
  const t = String(message || "").trim();
  let candidate = ".";

  // 1) Ruta absoluta Windows (D:\..., C:\...)
  const absWinMatch = t.match(/\b([A-Za-z]:[\\/][^\s"'`]+)/);
  if (absWinMatch) {
    candidate = longestExistingWindowsPath(t) || absWinMatch[1].trim().replace(/[.,;]+$/, "");
    const root = String(projectRoot || "").trim();
    if (!root) return candidate;
    if (!isInsideRoot(root, candidate)) return candidate;
    const mapApi = loadProjectMapHelpers();
    if (mapApi?.resolveExistingTarget) {
      try {
        mapApi.ensureProjectMap?.(root, { maxAgeMs: 5 * 60_000 });
        const resolved = mapApi.resolveExistingTarget(root, candidate);
        return resolved?.target || candidate;
      } catch { return candidate; }
    }
    return candidate;
  }

  // 2) Ruta absoluta Unix (/home/..., /var/...)
  const absUnixMatch = t.match(/(?:^|\s)(\/[^\s"'`]+)/);
  if (absUnixMatch && !absUnixMatch[1].startsWith("//")) {
    candidate = absUnixMatch[1].trim().replace(/[.,;]+$/, "");
    const root = String(projectRoot || "").trim();
    if (!root) return candidate;
    const mapApi = loadProjectMapHelpers();
    if (mapApi?.resolveExistingTarget) {
      try {
        mapApi.ensureProjectMap?.(root, { maxAgeMs: 5 * 60_000 });
        const resolved = mapApi.resolveExistingTarget(root, candidate);
        return resolved?.target || candidate;
      } catch { return candidate; }
    }
    return candidate;
  }

  // 3) "de X", "en X", "carpeta X", "directorio X"
  const matchPath = t.match(/(?:directorio|carpeta|folder|en|de|del?)\s+([.\/\\a-zA-Z0-9_\-\s]+?)(?=\s*[.!,?¿¡:]|$)/i);
  if (matchPath) {
    const raw = matchPath[1].trim();
    const stop = new Set(["el", "la", "los", "las", "un", "una", "este", "esta", "mi", "tu", "su", "proyecto"]);
    if (raw && !stop.has(raw.toLowerCase())) {
      candidate = raw;
    }
  } else if (/\b\.\b/.test(t) || t.includes(" .")) {
    candidate = ".";
  }

  const root = String(projectRoot || "").trim();
  if (!root) return candidate || ".";
  const mapApi = loadProjectMapHelpers();
  if (!mapApi?.resolveExistingTarget) return candidate || ".";
  try {
    mapApi.ensureProjectMap?.(root, { maxAgeMs: 5 * 60_000 });
    const resolved = mapApi.resolveExistingTarget(root, candidate);
    return resolved?.target || ".";
  } catch { return candidate || "."; }
}

const MODES = { CHAT: "chat", UNDERSTAND: "understand", DISCOVER: "discover", EXECUTE: "execute" };
const SUB_AGENTS = {
  INTENT: "intent-analyst",
  EXPLORER: "project-explorer",
  IMPLEMENTER: "implementer",
  RESUMER: "task-resumer",
};

const PHASES = {
  CHAT: "understand",
  UNDERSTAND: "understand",
  DISCOVER: "discover",
  EXECUTE: "execute",
};

const READ_ONLY_TOOLS = [
  "list_files", "read_file", "search_files", "project_discovery",
  "codebase_map", "symbol_search", "dependency_search",
  "brain_search", "brain_skill", "brain_tools",
  "search_codebase_semantic", "list_snapshots", "analyze_circular_dependencies",
  // Nuevas tools de solo lectura
  "web_search", "git_status", "git_log", "git_diff", "list_skills",
];
const WRITE_TOOLS = [
  "write_file", "replace_in_file", "delete_file", "create_project",
  "clone_web_page", "web_scrape", "images_to_code",
  "run_command", "create_pdf", "create_word", "create_excel", "create_csv",
  "inspect_preview", "generate_image", "generate_video", "add_erp_module",
  "deploy_one_click", "publish_project", "fullstack_deploy",
  "audit_env", "supabase_migrate", "scaffold_project", "capture_preview",
  "capture_preview_screenshot", "run_e2e_pipeline", "rollback_last_change",
  // Nuevas tools de escritura
  "install_skill", "clone_repo", "ingest_to_brain",
];
const ALL_ALLOWED_TOOLS = [...new Set([...READ_ONLY_TOOLS, ...WRITE_TOOLS])];

const TOOL_ALLOWLIST = Object.assign(
  function (modeOrTool) {
    if (TOOL_ALLOWLIST[modeOrTool]) return TOOL_ALLOWLIST[modeOrTool];
    return ALL_ALLOWED_TOOLS.includes(modeOrTool);
  },
  {
    [MODES.CHAT]: [],
    [MODES.UNDERSTAND]: READ_ONLY_TOOLS,
    [MODES.DISCOVER]: READ_ONLY_TOOLS,
    [MODES.EXECUTE]: ALL_ALLOWED_TOOLS,
    includes(toolName) {
      return ALL_ALLOWED_TOOLS.includes(toolName);
    },
    all: ALL_ALLOWED_TOOLS,
  }
);

function resolveExecutionMode(prompt = "", opts = {}) {
  const decision = classify(prompt, opts);
  if (decision.kind === "STOP") return { mode: "STOP", isAgent: false, reason: "stop" };
  if (decision.kind === "CHAT") return { mode: MODES.CHAT, isAgent: false, reason: "chat" };
  if (decision.kind === "ANALYZE" || decision.kind === "LIST" || decision.kind === "ASK") {
    return { mode: MODES.DISCOVER, isAgent: true, reason: "read-only" };
  }
  return { mode: MODES.EXECUTE, isAgent: true, reason: "write" };
}

function isResumeIncompleteAnalysisRequest(prompt = "", options = {}) {
  return /\b(?:contin[uú]a|retoma|reanuda|sigue)\b/i.test(String(prompt || ""))
    && (options.previousIncomplete === true || options.resume === true);
}

function isAnalysisOnlyRequest(prompt = "", allowWrite = false) {
  if (allowWrite === false) return true;
  return /(?:^|[^\w])(?:analiz[aá]|analizar|audita(?:r)?|diagnostica(?:r)?|revisa(?:r)?\s+errores)(?=\s|$|[.!,?¿¡:])/i.test(String(prompt || ""));
}

function analyze(input = {}) {
  const prompt = String(input.prompt || input.message || "").trim();
  return classify(prompt, input);
}

module.exports = {
  classify,
  analyze,
  resolveExecutionMode,
  isResumeIncompleteAnalysisRequest,
  isAnalysisOnlyRequest,
  isContinuePhrase,
  extractListTarget,
  isFullAccess,
  MODES,
  SUB_AGENTS,
  PHASES,
  TOOL_ALLOWLIST,
  STOP_RE,
  APPROVAL_RE,
  CHAT_INFO_RE,
  BACKGROUND_RE,
  TASK_FIX_RE,
  TASK_LIST_ONLY_RE,
  TASK_LIST_RE,
};