"use strict";

/**
 * Guardia Semántico de Intenciones para EditCoreAI
 * Evita confusiones, falsos positivos por palabras sueltas y ejecuciones no solicitadas.
 */

const INTENT_TYPES = {
  STRATEGIC_CONSULTATION: "STRATEGIC_CONSULTATION", // Preguntas de diseño, sugerencias, arquitectura ("qué podemos implementar?")
  CODE_MUTATION: "CODE_MUTATION",                   // Órdenes directas de cambio ("agrega un botón", "corrige X")
  CODE_EXPLANATION: "CODE_EXPLANATION",             // Lectura y comprensión ("explica qué hace App.tsx")
  BUG_DIAGNOSIS: "BUG_DIAGNOSIS",                   // Búsqueda de errores ("por qué falla la consola?")
  DEPLOYMENT: "DEPLOYMENT",                         // Despliegues ("publica a vercel")
  WEB_CLONING: "WEB_CLONING",                       // Clonación real con URL externa explícita
  CONFIRMATION: "CONFIRMATION",                     // Respuestas de aprobación ("procede", "hazlo", "dale")
};

const NEGATION_PATTERNS = [
  /\b(?:no\s+(?:te\s+ped[ií]|quiero|necesito|hagas|toques|modifiques|clones|ejecutes))\b/i,
  /\b(?:sin\s+(?:tocar|modificar|clonar|borrar|cambiar))\b/i,
  /\b(?:en\s+lugar\s+de\s+(?:clonar|borrar|cambiar))\b/i,
];

class SemanticIntentGuard {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Analiza holísticamente el prompt del usuario y extrae la intención real
   * @param {string} prompt
   * @param {object} [context]
   */
  analyze(prompt = "", context = {}) {
    const raw = String(prompt || "").trim();
    if (!raw) {
      return {
        intent: INTENT_TYPES.STRATEGIC_CONSULTATION,
        allowWrite: false,
        prohibitedTools: ["write_file", "replace_in_file", "clone_web_page", "delete_file"],
        isConversational: true,
        summary: "Mensaje vacío",
      };
    }

    const hasNegation = NEGATION_PATTERNS.some((p) => p.test(raw));
    const hasExternalUrl = /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s)>"']+/i.test(raw);

    // 1. Detección de Aprobación
    const isApproval = /^\s*(?:procede|continua|continúa|hazlo|autorizado|adelante|ejecuta|dale|va|ok|si|sí)\b[.!?]?\s*$/i.test(raw);
    if (isApproval) {
      return {
        intent: INTENT_TYPES.CONFIRMATION,
        allowWrite: true,
        prohibitedTools: [],
        isConversational: false,
        requiresExecution: true,
        summary: "Confirmación de usuario para proceder con la tarea pendiente",
      };
    }

    // 2. Detección de Preguntas Estratégicas / Asesoría (NO debe escribir ni clonar)
    const isConsultation = /\b(?:qu[eé]\s+(?:podemos|conviene|me\s+recomiendas|sugieres|hace\s+falta|podr[ií]amos)|tu\s+como\s+experto|c[oó]mo\s+(?:podemos|hacer|mejorar)|ideas\s+para|opini[oó]n|ases[oó]rame)\b/i.test(raw);
    if (isConsultation && !/\b(?:agrega|crea|aplica|modifica|escribe|hazlo\s+ya)\b/i.test(raw)) {
      return {
        intent: INTENT_TYPES.STRATEGIC_CONSULTATION,
        allowWrite: false,
        prohibitedTools: ["write_file", "replace_in_file", "clone_web_page", "delete_file", "apply_diff"],
        isConversational: true,
        requiresExecution: false,
        summary: "Consulta técnica o de diseño. Responder con propuesta experta y consultar antes de mutar código.",
      };
    }

    // 3. Detección de Clonado Web (SOLO si hay URL externa y NO hay negación)
    const wantsClone = /\b(?:clona|clonar|replica(?:r)?)\b/i.test(raw);
    if (wantsClone && !hasNegation && hasExternalUrl) {
      return {
        intent: INTENT_TYPES.WEB_CLONING,
        allowWrite: true,
        prohibitedTools: [],
        isConversational: false,
        preferredTool: "clone_web_page",
        summary: "Clonación autorizada de URL externa",
      };
    }

    // Si menciona clonar pero con negación ("no te pedí clonar"): PROHIBIR clone_web_page
    const prohibitedTools = [];
    if (wantsClone && hasNegation) {
      prohibitedTools.push("clone_web_page");
    }

    // 4. Detección de Despliegue
    if (/\b(?:deploy|publica(?:r)?|despleg(?:ar|a)|vercel|supabase)\b/i.test(raw) && !hasNegation) {
      return {
        intent: INTENT_TYPES.DEPLOYMENT,
        allowWrite: true,
        prohibitedTools,
        isConversational: false,
        summary: "Despliegue o publicación en la nube",
      };
    }

    // 5. Detección de Modificación de Código
    const isMutation = /\b(?:agrega|añade|crea|modifica|cambia|centra|ajusta|corrige|arregla|elimina|quita|borra|refactoriza|pon|coloca|diseña)\b/i.test(raw);
    if (isMutation) {
      return {
        intent: INTENT_TYPES.CODE_MUTATION,
        allowWrite: true,
        prohibitedTools,
        isConversational: false,
        requiresExecution: true,
        summary: "Orden directa de modificación de código en el proyecto",
      };
    }

    // 6. Por defecto: Consulta Informativa / Lectura
    return {
      intent: INTENT_TYPES.CODE_EXPLANATION,
      allowWrite: false,
      prohibitedTools: ["write_file", "replace_in_file", "clone_web_page", "delete_file"],
      isConversational: true,
      requiresExecution: false,
      summary: "Consulta de información o lectura",
    };
  }
}

module.exports = {
  SemanticIntentGuard,
  INTENT_TYPES,
  NEGATION_PATTERNS,
};
