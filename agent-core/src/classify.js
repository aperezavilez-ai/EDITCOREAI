"use strict";

/**
 * Clasificación de intención Agent Core (Acceso completo aware).
 * Usado por modes.classifyMode / orchestrator.
 */

const ACTION_RE = /\b(?:crea(?:r)?|modifica(?:r)?|corri(?:ge|gir)|corrige|arregla(?:r)?|implementa(?:r)?|refactoriza(?:r)?|actualiza(?:r)?|audita(?:r)?|repara(?:r)?|escribe|a[ñn]ade|agrega|cambia(?:r)?|borra(?:r)?|elimina(?:r)?|aplica|soluciona|haz|hacer|fix)\b/i;

const APPROVAL_RE = /^\s*(?:procede|adelante|autorizo|contin[uú]a|hazlo|ejecuta|si|sí|ok|dale|va)\b/i;

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
 * @param {{ allowWrite?: boolean, planAuthorized?: boolean, analysisMode?: boolean, permissionMode?: string, mode?: string, permissionFull?: boolean, fullAccess?: boolean }} [opts]
 * @returns {"list"|"explain"|"diagnose"|"execute"|"chat"}
 */
function classify(prompt = "", opts = {}) {
  const text = String(prompt || "").trim();
  if (!text) return "chat";

  const full = isFullAccess(opts);
  const authorized = opts.planAuthorized === true
    || opts.planAuthorizedExecution === true
    || full
    || APPROVAL_RE.test(text);

  if (authorized && ACTION_RE.test(text)) return "execute";
  if (authorized && !opts.analysisMode) {
    // Acceso completo + pedido no trivial → execute (no degradar a chat)
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

  // Acceso completo: verbos de acción NUNCA degradan a chat
  if ((opts.allowWrite !== false || full) && ACTION_RE.test(text)) {
    return "execute";
  }

  if (full && text.length > 12 && !/^(hola|gracias|ok|sí|si)\b/i.test(text)) {
    // Pedido genérico con acceso completo: preferir execute sobre chat pasivo
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
};
