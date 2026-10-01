"use strict";

/**
 * Clasificacion de intencion Agent Core (Acceso completo aware).
 * v0.4.0 — Reconoce intents extendidos: internet, git, skills, shell, archivos externos.
 */

const ACTION_RE = /\b(?:crea(?:r)?|modifica(?:r)?|corri(?:ge|gir)|corrige|arregla(?:r)?|implementa(?:r)?|refactoriza(?:r)?|actualiza(?:r)?|audita(?:r)?|repara(?:r)?|escribe|a[ñn]ade|agrega|cambia(?:r)?|borra(?:r)?|elimina(?:r)?|aplica|soluciona|haz|hacer|fix)\b/i;

const APPROVAL_RE = /^\s*(?:procede|adelante|autorizo|contin[uú]a|hazlo|ejecuta|si|sí|ok|dale|va)\b/i;

// v0.4.0 — Intents de solo lectura: internet, git-read, archivos externos, skills-list
const RESEARCH_RE = /\b(?:busca(?:r|me)?(?:\s+en\s+(?:internet|la\s+web|google))?|investiga(?:r)?|averigua(?:r)?|googlea(?:r)?|consulta(?:r)?(?:\s+en\s+(?:internet|la\s+web))|lee(?:r)?\s+(?:esta\s+url|la\s+url)|abre\s+esta\s+url|git\s+log|git\s+status|git\s+diff|historial\s+de(?:l)?\s+repo(?:sitorio)?|estado\s+de(?:l)?\s+repo(?:sitorio)?|qu[eé]\s+skills|skills\s+instaladas|lista(?:r|me)?\s+(?:las\s+)?skills|mis\s+skills|lista(?:r|me)?\s+(?:los\s+)?archivos?\s+(?:de|en)\s+[A-Za-z]:\\|muestra(?:me)?\s+(?:los\s+)?archivos?\s+(?:de|en)\s+[A-Za-z]:\\|lee(?:r)?\s+(?:el\s+)?archivo\s+[A-Za-z]:\\|qu[eé]\s+hay\s+en\s+[A-Za-z]:\\)/i;

// v0.4.0 — Intents de mutacion externa: clonar, ejecutar comando, instalar skill, escribir externo
const EXT_ACTION_RE = /\b(?:clona(?:r|me)?|git\s+clone|descarga(?:r)?\s+el\s+repo(?:sitorio)?|trae(?:me)?\s+el\s+repo(?:sitorio)?|ejecuta(?:r|me)?\s+(?:el\s+comando|en\s+shell|en\s+powershell|la\s+terminal)|corre(?:r|me)?\s+(?:el\s+comando|en\s+shell)|lanza(?:r|me)?\s+(?:el\s+comando|en\s+shell)|instala(?:r|me)?\s+(?:la\s+)?skill|npm\s+install|yarn\s+add|pnpm\s+add|pip\s+install|escribe(?:r)?\s+en\s+[A-Za-z]:\\|guarda(?:r)?\s+en\s+[A-Za-z]:\\)/i;

function isFullAccess(opts = {}) {
  const mode = String(opts.permissionMode || opts.mode || "").toLowerCase().trim();
  return opts.permissionFull === true
    || opts.fullAccess === true
    || mode === "full"
    || mode === "acceso-completo"
    || mode === "acceso completo";
}

/**
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {"list"|"explain"|"diagnose"|"execute"|"research"|"chat"}
 */
function classify(prompt = "", opts = {}) {
  const text = String(prompt || "").trim();
  if (!text) return "chat";

  const full = isFullAccess(opts);
  const authorized = opts.planAuthorized === true
    || opts.planAuthorizedExecution === true
    || full
    || APPROVAL_RE.test(text);

  // ============ v0.4.0: Intents extendidos (prioridad alta) ============
  // Mutacion externa → execute (aunque no haya ACTION_RE)
  if (EXT_ACTION_RE.test(text)) {
    return "execute";
  }
  // Solo lectura extendida → research (nunca cae en chat)
  if (RESEARCH_RE.test(text)) {
    // Si además hay verbos de accion → execute (busca Y corrige)
    if (ACTION_RE.test(text) && (authorized || full)) return "execute";
    return "research";
  }

  // ============ Reglas originales ============
  if (authorized && ACTION_RE.test(text)) return "execute";
  if (authorized && !opts.analysisMode) {
    if (ACTION_RE.test(text) || /\b(bug|error|falla|roto|deploy|commit|push)\b/i.test(text)) {
      return "execute";
    }
  }

  if (APPROVAL_RE.test(text)) return "execute";

  if (opts.analysisMode === true
    || /\bNO\s+MODIFI(?:CAR|QUES?)\b|\bMODO:\s*DIAGN|\bDIAGN[OÓ]STICO\b/i.test(text)) {
    return "diagnose";
  }

  const wantsList = /\b(enlista(?:r|me)?|listar?|enumerar|muestra(?:me)?\s+(?:los\s+)?archivos|dame\s+(?:los\s+)?archivos)\b/i.test(text);
  const wantsExplain = /\b(explica|explicar|describ[eéa]|qu[eé]\s+hace|para\s+qu[eé]|c[oó]mo\s+funciona)\b/i.test(text);
  if (wantsList && wantsExplain) return "explain";
  if (wantsList && !wantsExplain) return "list";
  if (wantsExplain) return "explain";

  if (/\b(analiza|audita|diagnostica|revisa|reporte|hallazgos)\b/i.test(text)
    && !ACTION_RE.test(text)) {
    return "diagnose";
  }

  if ((opts.allowWrite !== false || full) && ACTION_RE.test(text)) {
    return "execute";
  }

  if (full && text.length > 12 && !/^(hola|gracias|ok|sí|si)\b/i.test(text)) {
    if (/\b(proyecto|archivo|codigo|código|agente|ide|bug|feature|mejora)\b/i.test(text)) {
      return "execute";
    }
  }

  return "chat";
}

module.exports = {
  classify,
  classifyMode: classify,
  isFullAccess,
  ACTION_RE,
  APPROVAL_RE,
  RESEARCH_RE,
  EXT_ACTION_RE,
};