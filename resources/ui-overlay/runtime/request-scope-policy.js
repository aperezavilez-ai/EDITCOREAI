"use strict";

/**
 * Política universal de enfoque de solicitud.
 * El agente debe responder a LO PEDIDO (acotado o amplio), no inventar un plan genérico.
 */

(function exposeRequestScopePolicy(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreRequestScope = api;
})(typeof window !== "undefined" ? window : globalThis, function createRequestScopePolicy() {
  const POLICY_MARKER = "REQUEST_SCOPE_POLICY_V1";

  const BROAD_RE = /\b(?:0\s*[aáà]\s*100|1\s*[aáà]\s*100|end\s*[- ]?to\s*[- ]?end|e2e|completo|profunda|profundo|general|exhaustiv|todo\s+el\s+proyecto|auditor[ií]a\s+completa|reporte\s+completo|diagn[oó]stico\s+completo|desde\s+cero)\b/i;
  const ACTION_RE = /\b(?:arregla|corrige|implementa|crea|a[nñ]ade|agrega|elimina|borra|refactor|migra|despliega|publica|instala|ejecuta|aplica|escribe|modifica|cambia|haz|hacer)\b/i;
  const FOCUSED_FILE_RE = /\b(?:roadmap|manifest|package\.json|readme|\.env|session-state|vercel|supabase|github)\b/i;

  /**
   * @returns {"focused"|"broad"|"action"}
   */
  function classifyRequestScope(message = "") {
    const text = String(message || "").trim();
    if (!text) return "focused";
    if (BROAD_RE.test(text)) return "broad";
    if (ACTION_RE.test(text) && !/\b(?:dime|explica|cu[aá]l|qu[eé]\s+es|estado|etapa|analiza\s+solo)\b/i.test(text)) {
      return "action";
    }
    // Pregunta puntual / un solo artefacto → focused
    if (FOCUSED_FILE_RE.test(text) || /\b(?:dime|explica|cu[aá]l|estado|etapa|solo|únicamente|unicamente)\b/i.test(text)) {
      return "focused";
    }
    // "analiza X" corto sin señales de amplitud → focused
    if (/^\s*(?:analiza|revisa|mira|lee|busca)\b/i.test(text) && text.length < 160 && !BROAD_RE.test(text)) {
      return "focused";
    }
    return "focused";
  }

  const REQUEST_SCOPE_POLICY = [
    `[${POLICY_MARKER}]`,
    "ENFOQUE DE LA SOLICITUD (OBLIGATORIO — cualquier pregunta del usuario):",
    "",
    "1) PRIMERO interpreta QUÉ pidió exactamente. Responde a ESO.",
    "2) Calibra el alcance:",
    "   - Pedido concreto/puntual (ej. estado del ROADMAP, explica un error, qué hace un archivo):",
    "     lee solo lo necesario, responde directo y humanizado. NO abras un análisis total del repo.",
    "   - Pedido amplio (ej. análisis 0→100, E2E, auditoría completa, desde cero):",
    "     sí profundiza, estructura el informe y cubre el alcance pedido.",
    "   - Pedido de acción (arregla/crea/implementa): ejecuta esa acción; no cambies de tema.",
    "3) PROHIBIDO ampliar por iniciativa propia: npm install, npm run dev, Supabase, deploy,",
    "   refactor masivo o 'recomendaciones de siguiente paso' si el usuario no lo pidió.",
    "4) Tono: humano, claro, en español; sin relleno de 'como analista senior…'.",
    "5) Si falta un dato crítico para responder, dilo en una frase y pregunta solo eso.",
    "6) Si hay varias interpretaciones razonables, elige la más literal a las palabras del usuario.",
  ].join("\n");

  function hasRequestScopePolicy(prompt = "") {
    return String(prompt || "").includes(`[${POLICY_MARKER}]`);
  }

  function stripRequestScopePolicy(prompt = "") {
    return String(prompt || "")
      .replace(new RegExp(`\\[${POLICY_MARKER}\\][\\s\\S]*?(?=\\n\\n\\[|\\n\\n(?=[A-ZÁÉÍÓÚÑ0-9])|$)`, "g"), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function withRequestScopePolicy(systemPrompt = "") {
    const rest = stripRequestScopePolicy(String(systemPrompt || "").trim());
    if (!rest) return REQUEST_SCOPE_POLICY;
    if (hasRequestScopePolicy(rest)) return rest;
    return `${REQUEST_SCOPE_POLICY}\n\n${rest}`;
  }

  function buildScopedUserDirective(userMessage = "", evidence = "") {
    const text = String(userMessage || "").trim();
    const scope = classifyRequestScope(text);
    const evidenceBlock = String(evidence || "").trim();

    if (scope === "broad") {
      return [
        "ALCANCE: AMPLIO (pedido explícito del usuario).",
        `Pregunta del usuario: ${text}`,
        evidenceBlock ? `\nEvidencia reunida:\n${evidenceBlock}` : "",
        "",
        "Responde con un análisis/informe acorde al alcance amplio pedido.",
        "Organiza en secciones claras. No inventes archivos ni resultados no evidenciados.",
        "Tono humano y directo; sin relleno corporativo.",
      ].filter(Boolean).join("\n");
    }

    if (scope === "action") {
      return [
        "ALCANCE: ACCIÓN pedida por el usuario.",
        `Instrucción: ${text}`,
        evidenceBlock ? `\nContexto/evidencia:\n${evidenceBlock}` : "",
        "",
        "Ejecuta o describe solo esa acción. No abras auditorías generales ni listas de 'siguientes pasos' ajenas.",
        "Narra brevemente qué haces y el resultado.",
      ].filter(Boolean).join("\n");
    }

    // focused (default)
    return [
      "ALCANCE: FOCALIZADO — responde SOLO a lo pedido.",
      `Pregunta del usuario: ${text}`,
      evidenceBlock ? `\nEvidencia relevante:\n${evidenceBlock}` : "",
      "",
      "INSTRUCCIONES:",
      "- Contesta la pregunta de forma humana, concreta y breve.",
      "- Usa solo la evidencia necesaria. No analices el proyecto entero.",
      "- PROHIBIDO: npm install/dev, Supabase, deploy, planes genéricos o '¿procedemos a…?' si no lo pidió.",
      "- PROHIBIDO inventar etapas, archivos o estados no presentes en la evidencia.",
      "- Si la evidencia no alcanza, dilo y sugiere el siguiente dato mínimo a revisar.",
    ].filter(Boolean).join("\n");
  }

  return {
    POLICY_MARKER,
    REQUEST_SCOPE_POLICY,
    classifyRequestScope,
    hasRequestScopePolicy,
    stripRequestScopePolicy,
    withRequestScopePolicy,
    buildScopedUserDirective,
  };
});
