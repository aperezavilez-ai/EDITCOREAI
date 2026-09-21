"use strict";

/** Portero: una sola decisión por mensaje. Acceso completo aware. */

const STOP_RE = /^\s*(?:alto|detente|cancela|cancelar|stop|para|basta|deten(?:te)?)\s*[.!?]?\s*$/i;
const APPROVAL_RE = /^\s*(?:procede|continua|continúa|hazlo|autorizado|adelante|ejecuta|si|sí|confirmado|procedo|hazlo\s+ya|dale|va|ok)\s*[.!?]?\s*$/i;
const CHAT_INFO_RE = /\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es)|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda|hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\b/i;

// Verbos de cambio/escritura. Ganan sobre TASK_VERIFY_RE si el mensaje pide modificar.
const TASK_FIX_RE = /\b(?:corrige|corrije|arregla|arreglá|implementa(?:r)?|aplica|aplicá|repara|repará|soluciona|solucioná|crea(?:r|ción)?|creá|genera(?:r)?|generá|escribe|escrib[ií]|modifica(?:r)?|modificá|refactoriza(?:r)?|actualiza(?:r)?|actualizá|audita(?:r)?|añade|añadí|agrega(?:r)?|agregá|cambia(?:r)?|cambiá|muev\w*|mov[eé]|copiar?|copiá|haz|hacer|hacé|arma|armá|scaffold|nuevo\s+proyecto|ejecuta(?:r)?|ejecutá|reemplaza(?:r)?|reemplazá|pon[eé]?|setea(?:r)?|borra(?:r)?|elimina(?:r)?|renombra(?:r)?|run_command|run|build|tsc|npx|npm)\b/i;

const TASK_CLONE_RE = /\b(?:clona|clonar|copia\s+esta\s+p[aá]gina|replica(?:r)?\s+(?:esta\s+)?(?:web|p[aá]gina|sitio)|clone_web_page)\b/i;
const HTTP_URL_RE = /https?:\/\/[^\s)>"']+/i;
const TASK_ANALYZE_RE = /(?:^|[^\w])(?:analiz[aá]|analizar|audita(?:r)?|diagnostica(?:r)?|revisa(?:r)?\s+errores|hallazgos|reporte\s+completo|plan\s+de\s+acci[oó]n)(?=\s|$|[.!,?¿¡:])/i;
const TASK_LIST_RE = /\b(?:lista|listar|qu[eé]\s+contiene|qu[eé]\s+hay\s+en|contenido\s+de|muestra\s+(?:la\s+)?carpeta|explora|explorar|explorer|directorio|arbol|árbol)\b/i;
const TASK_READ_RE = /\b(?:explica|explicar|lee|leer|describe|describ[eé]|resume|resumir|revisa|revisar|qu[eé]\s+hace|c[oó]mo\s+funciona|para\s+qu[eé]\s+sirve)\b/i;
const PATHISH_RE = /(?:[\\/]|\b[a-z0-9_.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|css|html|py|rs|go)\b)/i;
const TASK_GIT_RE = /\b(?:commit|push|git\s+status|haz\s+commit)\b/i;
const TASK_DEPLOY_RE = /\b(?:deploy|publica(?:r)?|vercel)\b/i;
const BACKGROUND_RE = /\b(?:segundo\s+plano|en\s+background|background|sin\s+esperar)\b/i;

// Solo matchea si el mensaje EMPIEZA con verbo de verificación (no si aparece "ok" o "verifica" en cualquier parte).
const TASK_VERIFY_RE = /^\s*(?:verifica(?:r)?|verificá|typecheck|compila(?:r)?|compilá|corre?\s+los?\s+tests?|corre?\s+tsc|pasa?\s+el\s+linter|hac[eé]\s+build|build)\b/i;

function isFullAccess(opts = {}) {
  const mode = String(opts.permissionMode || opts.mode || "").toLowerCase().trim();
  return opts.permissionFull === true
    || opts.fullAccess === true
    || mode === "full"
    || mode === "acceso completo"
    || mode === "acceso-completo";
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
  if (APPROVAL_RE.test(text)) {
    return { kind: "EXECUTE", label: "Ejecución autorizada", allowTools: true, allowWrite: true, background };
  }
  if (TASK_CLONE_RE.test(text) && HTTP_URL_RE.test(text)) {
    return { kind: "EXECUTE", label: "Clonar web", allowTools: true, allowWrite: true, background };
  }

  // ORDEN CORREGIDO: verbos de cambio primero (si el usuario dice "cambia X y verifica", gana el cambio).
  const fixMatch = TASK_FIX_RE.test(text);
  const verifyMatch = TASK_VERIFY_RE.test(text);

  if (fixMatch) {
    // Si hay fix + verbo de verificación, el usuario quiere ejecutar y verificar → EXECUTE.
    return {
      kind: "EXECUTE",
      label: full ? "Ejecución (Acceso completo)" : "Construcción / Ejecución",
      allowTools: true,
      allowWrite: true,
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
  if (CHAT_INFO_RE.test(text)) {
    return { kind: "CHAT", label: "Chat informativo", allowTools: false, allowWrite: false, background };
  }
  return { kind: "CHAT", label: "Chat", allowTools: false, allowWrite: false, background };
}

function loadProjectMapHelpers() {
  try { return require("../runtime/project-map"); }
  catch { try { return require("./project-map"); } catch { return null; } }
}

function extractListTarget(message, projectRoot = null) {
  const t = String(message || "").trim();
  let candidate = ".";
  const matchPath = t.match(/(?:directorio|carpeta|folder|en|de)\s+([.\/\\a-zA-Z0-9_\-]+)/i);
  if (matchPath) {
    const raw = matchPath[1].trim();
    if (!["el", "la", "los", "las", "un", "una", "este", "esta"].includes(raw.toLowerCase())) {
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
];
const WRITE_TOOLS = [
  "write_file", "replace_in_file", "delete_file", "create_project",
  "clone_web_page", "web_scrape", "images_to_code",
  "run_command", "create_pdf", "create_word", "create_excel", "create_csv",
  "inspect_preview", "generate_image", "generate_video", "add_erp_module",
  "deploy_one_click", "publish_project", "fullstack_deploy",
  "audit_env", "supabase_migrate", "scaffold_project", "capture_preview",
  "capture_preview_screenshot", "run_e2e_pipeline", "rollback_last_change",
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
};
