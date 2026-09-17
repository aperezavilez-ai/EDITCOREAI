"use strict";

/** Portero: una sola decisión por mensaje. Acceso completo aware. */

const STOP_RE = /^\s*(?:alto|detente|deténte|cancela|cancelar|stop|para|basta|deten(?:te)?)\s*[.!?]?\s*$/i;

const APPROVAL_RE = /^\s*(?:procede|continua|continúa|hazlo|autorizado|adelante|ejecuta|si|sí|confirmado|procedo|hazlo\s+ya|dale|va|ok)\b[.!?]?\s*$/i;

const CHAT_INFO_RE = /\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es)|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda|hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\b/i;

const TASK_FIX_RE = /\b(?:corrije|corrige|arregla|implementa|aplica|repara|soluciona|crea|escribe|modifica|refactoriza|actualiza|audita|añade|agrega|cambia|haz|hacer|ejecuta|run_command|run|build|tsc|npx|npm)\b/i;
const TASK_CLONE_RE = /\b(?:clona|clonar|copia\s+esta\s+p[aá]gina|replica(?:r)?\s+(?:esta\s+)?(?:web|p[aá]gina|sitio)|clone_web_page)\b/i;
const HTTP_URL_RE = /https?:\/\/[^\s)>"']+/i;

const TASK_ANALYZE_RE = /\b(?:analiza|audita|diagnostica|revisa\s+errores|hallazgos|reporte\s+completo|plan\s+de\s+acci[oó]n)\b/i;
const TASK_LIST_RE = /\b(?:lista|listar|qu[eé]\s+contiene|qu[eé]\s+hay\s+en|contenido\s+de|muestra\s+(?:la\s+)?carpeta|explora|explorar|explorer|directorio|arbol|árbol)\b/i;
const TASK_READ_RE = /\b(?:explica|explicar|lee|leer|describe|describ[eéa]|resume|resumir|revisa|revisar|qu[eé]\s+hace|c[oó]mo\s+funciona|para\s+qu[eé]\s+sirve)\b/i;
const PATHISH_RE = /(?:[\\/]|\b[a-z0-9_.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|css|html|py|rs|go)\b)/i;
const TASK_GIT_RE = /\b(?:commit|push|git\s+status|haz\s+commit)\b/i;
const TASK_DEPLOY_RE = /\b(?:deploy|publica(?:r)?|vercel)\b/i;
const BACKGROUND_RE = /\b(?:segundo\s+plano|en\s+background|background|sin\s+esperar)\b/i;
const TASK_VERIFY_RE = /\b(?:verifica(?:r)?|typecheck|compila(?:r)?|tsc\b)\b/i;

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

  // Acceso completo: no clasificar como CONFIRM (no hay candado de autorización)
  if (!full && APPROVAL_RE.test(text)) {
    return { kind: "CONFIRM", label: "Autorización Confirmada", allowTools: true, allowWrite: true, background: false };
  }
  if (full && APPROVAL_RE.test(text)) {
    return { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
  }


  const isNegativeClone = /\b(?:no\s+(?:te\s+ped[ií]\s+)?clonar|sin\s+clonar|no\s+clonar|no\s+quiero\s+clonar)\b/i.test(text);

  if (!isNegativeClone && (TASK_CLONE_RE.test(text) || (HTTP_URL_RE.test(text) && /\b(?:clona|clonar|copia|replica)\b/i.test(text)))) {
    return {
      kind: "EXECUTE",
      label: "Clonar página web",
      allowTools: true,
      allowWrite: true,
      background,
      preferredTool: "clone_web_page",
    };
  }

  if (TASK_LIST_RE.test(text)) {
    return { kind: "LIST", label: "Listado", allowTools: true, allowWrite: false, background };
  }

  // Explicar/leer/describir un archivo concreto → tools (read_file), nunca chat ciego
  if (TASK_READ_RE.test(text) && PATHISH_RE.test(text) && !TASK_FIX_RE.test(text)) {
    return { kind: "ASK", label: "Lectura / explicación", allowTools: true, allowWrite: false, background };
  }

  // Chat info solo si NO hay verbo de acción (evita degradar "crea X" / "implementa Y")
  if (CHAT_INFO_RE.test(text) && !TASK_FIX_RE.test(text) && !TASK_READ_RE.test(text)) {
    return { kind: "CHAT", label: "Consulta Informativa", allowTools: false, allowWrite: false, background: false };
  }

  if (TASK_GIT_RE.test(text)) {
    return { kind: "GIT", label: "Git", allowTools: true, allowWrite: true, background };
  }
  if (TASK_DEPLOY_RE.test(text)) {
    return { kind: "DEPLOY", label: "Deploy", allowTools: true, allowWrite: true, background };
  }

  if (TASK_FIX_RE.test(text)) {
    return {
      kind: "EXECUTE",
      label: full ? "Construcción / Acceso completo" : "Construcción / Ejecución",
      allowTools: true,
      allowWrite: true,
      background,
    };
  }

  if (TASK_VERIFY_RE.test(text) && background) {
    return { kind: "VERIFY", label: "Verificación", allowTools: true, allowWrite: false, background: true };
  }

  if (TASK_ANALYZE_RE.test(text)) {
    // "auditar" con acceso completo + intención de fix → EXECUTE
    if (full && /\b(?:corrige|arregla|implementa|aplica|repara)\b/i.test(text)) {
      return { kind: "EXECUTE", label: "Auditoría + corrección", allowTools: true, allowWrite: true, background };
    }
    return { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background };
  }

  if (/^(?:qu[eé]|cual|cuál|donde|dónde|como|cómo)\b/i.test(text) && text.length < 180 && !TASK_FIX_RE.test(text)) {
    return { kind: "ASK", label: "Pregunta", allowTools: true, allowWrite: false, background };
  }

  // Acceso completo: no degradar pedidos con acción a CHAT pasivo
  if (full && TASK_FIX_RE.test(text)) {
    return { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background };
  }

  return {
    kind: "CHAT",
    label: "Chat",
    allowTools: false,
    allowWrite: false,
    background: false,
  };
}

function loadProjectMapHelpers() {
  try {
    return require("../runtime/project-map");
  } catch {
    try {
      return require("./project-map");
    } catch {
      return null;
    }
  }
}

/**
 * Extrae el directorio ignorando palabras vacías.
 * Si hay projectRoot, resuelve contra `.editcore/project-map.json`.
 */
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
  } catch {
    return candidate || ".";
  }
}

module.exports = {
  classify,
  extractListTarget,
  isFullAccess,
  STOP_RE,
  APPROVAL_RE,
  CHAT_INFO_RE,
  BACKGROUND_RE,
  TASK_FIX_RE,
};
