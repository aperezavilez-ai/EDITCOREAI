"use strict";

/**
 * Clasificador de intención ÚNICO para el chat de EditCore.
 * Evita que renderer / project-analysis / adapter decidan cosas distintas.
 */

const INTENTS = Object.freeze({
  CHAT: "CHAT",
  ANALYZE: "ANALYZE",
  PLAN: "PLAN",
  EXECUTE: "EXECUTE",
  CREATE_PROJECT: "CREATE_PROJECT",
  GIT: "GIT",
  DEPLOY: "DEPLOY",
  CONTINUE: "CONTINUE",
});

function text(value) {
  return String(value || "").trim();
}

function classifyUserIntent(prompt, options = {}) {
  const p = text(prompt);
  const lower = p.toLowerCase();
  const planAuthorized = options.planAuthorizedExecution === true || options.forceWrite === true;

  if (!p) {
    return {
      intent: INTENTS.CHAT,
      analysisMode: false,
      allowWrite: false,
      label: "Chat",
      reason: "empty",
    };
  }

  // Autorización / continuación de plan
  if (
    planAuthorized
    || /^\s*(?:procede|procedamos|adelante|autorizo|autoriza|ejecuta|hazlo|dale)\b/i.test(p)
    || /^\s*(?:contin[uú]a|continuamos|retoma|reanuda|seguimos)\b/i.test(p)
  ) {
    return {
      intent: INTENTS.EXECUTE,
      analysisMode: false,
      allowWrite: true,
      label: "Ejecución (autorizada)",
      reason: "authorization",
    };
  }

  // Corrección / implementación directa
  if (
    /^\s*(?:corrije|corrige|arregla|implementa|aplica|repara|soluciona|crea|escribe|modifica|añade|agrega)\b/i.test(p)
    && !/\b(?:solo\s+(?:analiza|lectura)|NO\s+MODIFICAR|sin\s+escribir)\b/i.test(p)
  ) {
    return {
      intent: INTENTS.EXECUTE,
      analysisMode: false,
      allowWrite: true,
      label: "Ejecución (corregir/crear)",
      reason: "direct_fix",
    };
  }

  if (/\b(?:commit|push|git\s+status|haz\s+commit|sube\s+a\s+github)\b/i.test(lower)) {
    return {
      intent: INTENTS.GIT,
      analysisMode: false,
      allowWrite: true,
      label: "Git",
      reason: "git",
    };
  }

  if (/\b(?:deploy|publica|vercel|publicar)\b/i.test(lower)) {
    return {
      intent: INTENTS.DEPLOY,
      analysisMode: false,
      allowWrite: true,
      label: "Deploy",
      reason: "deploy",
    };
  }

  if (/\b(?:nuevo\s+proyecto|crea(?:r)?\s+(?:un\s+)?proyecto|from\s+scratch|desde\s+cero)\b/i.test(lower)) {
    return {
      intent: INTENTS.CREATE_PROJECT,
      analysisMode: false,
      allowWrite: true,
      label: "Crear proyecto",
      reason: "scaffold",
    };
  }

  if (/\b(?:plan\s+de\s+acci[oó]n|dame\s+(?:el\s+)?plan|prop[oó]n\s+plan)\b/i.test(lower)
    && !/\b(?:corrije|corrige|implementa)\b/i.test(lower)) {
    return {
      intent: INTENTS.PLAN,
      analysisMode: true,
      allowWrite: false,
      label: "Plan (solo lectura)",
      reason: "plan_only",
    };
  }

  if (/\b(?:analiza|audita|diagnostica|revisa|explora|hallazgos|reporte|errores?)\b/i.test(lower)
    || /\b(?:qu[eé]\s+fall|busca\s+errores|inspecciona)\b/i.test(lower)) {
    return {
      intent: INTENTS.ANALYZE,
      analysisMode: true,
      allowWrite: false,
      label: "Análisis (solo lectura)",
      reason: "analyze",
    };
  }

  // Default: chat / ayuda — no escritura automática
  return {
    intent: INTENTS.CHAT,
    analysisMode: false,
    allowWrite: false,
    label: "Chat",
    reason: "default_chat",
  };
}

function toAgentFlags(classification) {
  const c = classification || classifyUserIntent("");
  return {
    analysisMode: c.analysisMode === true,
    allowWrite: c.allowWrite === true,
    planAuthorizedExecution: c.intent === INTENTS.EXECUTE || c.allowWrite === true,
    intent: c.intent,
    intentLabel: c.label,
  };
}

module.exports = {
  INTENTS,
  classifyUserIntent,
  toAgentFlags,
};
