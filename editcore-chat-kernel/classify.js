"use strict";

/** Portero: una sola decisión por mensaje. */

const STOP_RE = /^\s*(?:alto|detente|deténte|cancela|cancelar|stop|para|basta|deten(?:te)?)\s*[.!?]?\s*$/i;

// Confirmación / autorización explícita
const APPROVAL_RE = /^\s*(?:procede|continua|continúa|hazlo|autorizado|adelante|ejecuta|si|sí|confirmado|procedo|hazlo\s+ya|dale|va|ok)\b[.!?]?\s*$/i;

const CHAT_INFO_RE = /\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es)|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda|hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\b/i;

const TASK_FIX_RE = /\b(?:corrije|corrige|arregla|implementa|aplica|repara|soluciona|crea|escribe|modifica|añade|agrega|cambia|actualiza|haz|hacer|ejecuta|run_command|run|build|tsc|npx|npm)\b/i;

const TASK_ANALYZE_RE = /\b(?:analiza|audita|diagnostica|revisa\s+errores|hallazgos|reporte\s+completo|plan\s+de\s+acci[oó]n)\b/i;
const TASK_LIST_RE = /\b(?:lista|listar|qu[eé]\s+contiene|qu[eé]\s+hay\s+en|contenido\s+de|muestra\s+(?:la\s+)?carpeta|explora|explorar|explorer|directorio|arbol|árbol)\b/i;
const TASK_GIT_RE = /\b(?:commit|push|git\s+status|haz\s+commit)\b/i;
const TASK_DEPLOY_RE = /\b(?:deploy|publica(?:r)?|vercel)\b/i;
const BACKGROUND_RE = /\b(?:segundo\s+plano|en\s+background|background|sin\s+esperar)\b/i;
const TASK_VERIFY_RE = /\b(?:verifica(?:r)?|typecheck|compila(?:r)?|tsc\b)\b/i;

function classify(message) {
  const text = String(message || "").trim();
  const background = BACKGROUND_RE.test(text);
  if (!text) {
    return { kind: "CHAT", label: "Chat vacío", allowTools: false, allowWrite: false, background: false };
  }
  if (STOP_RE.test(text)) {
    return { kind: "STOP", label: "Parada", allowTools: false, allowWrite: false, background: false };
  }

  if (APPROVAL_RE.test(text)) {
    return { kind: "CONFIRM", label: "Autorización Confirmada", allowTools: true, allowWrite: true, background: false };
  }

  if (TASK_LIST_RE.test(text)) {
    return { kind: "LIST", label: "Listado", allowTools: true, allowWrite: false, background };
  }

  if (CHAT_INFO_RE.test(text)) {
    return { kind: "CHAT", label: "Consulta Informativa", allowTools: false, allowWrite: false, background: false };
  }

  if (TASK_GIT_RE.test(text)) {
    return { kind: "GIT", label: "Git", allowTools: true, allowWrite: true, background };
  }
  if (TASK_DEPLOY_RE.test(text)) {
    return { kind: "DEPLOY", label: "Deploy", allowTools: true, allowWrite: true, background };
  }

  if (TASK_FIX_RE.test(text)) {
    return { kind: "EXECUTE", label: "Construcción / Ejecución", allowTools: true, allowWrite: true, background };
  }

  if (TASK_VERIFY_RE.test(text) && background) {
    return { kind: "VERIFY", label: "Verificación", allowTools: true, allowWrite: false, background: true };
  }

  if (TASK_ANALYZE_RE.test(text)) {
    return { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background };
  }

  if (/^(?:qu[eé]|cual|cuál|donde|dónde|como|cómo)\b/i.test(text) && text.length < 180) {
    return { kind: "ASK", label: "Pregunta", allowTools: true, allowWrite: false, background };
  }

  return { kind: "CHAT", label: "Chat", allowTools: false, allowWrite: false, background: false };
}

/** Extrae el directorio ignorando palabras vacías como "el", "la", "directorio", etc. */
function extractListTarget(message) {
  const t = String(message || "").trim();
  
  // Buscar rutas o referencias explícitas
  const matchPath = t.match(/(?:directorio|carpeta|folder|en|de)\s+([.\/\\a-zA-Z0-9_\-]+)/i);
  if (matchPath) {
    const candidate = matchPath[1].trim();
    // Ignorar artículos comunes
    if (!["el", "la", "los", "las", "un", "una", "este", "esta"].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Si contiene un punto aislado o como parámetro
  if (/\b\.\b/.test(t) || t.includes(" .")) return ".";

  return ".";
}

module.exports = { classify, extractListTarget, STOP_RE, APPROVAL_RE, CHAT_INFO_RE, BACKGROUND_RE };