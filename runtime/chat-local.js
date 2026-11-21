"use strict";

/**
 * Respuestas locales cortas (sin proveedor).
 * Solo saludos / confirmaciones triviales. Cualquier intención de trabajo → "".
 */

function text(value) {
  return String(value || "").trim();
}

function isCasualPrompt(value) {
  const prompt = text(value);
  if (!prompt || prompt.length > 100) return false;
  if (/[\\/]|\b(?:analiza|audita|corrige|crea|implementa|list_|read_|proyecto|archivo|reporte|commit|deploy)\b/i.test(prompt)) {
    return false;
  }
  return /^(?:hola|hi|hello|hey|buenas|buen(?:os|as)\s+(?:d[ií]as|tardes|noches)|gracias(?:\s+mucho)?|ok|vale|perfecto|entendido|de\s+acuerdo|c[oó]mo\s+est[aá]s)[.!?¿¡\s]*$/i.test(prompt);
}

function localConversationResponse(value) {
  const prompt = text(value);
  if (!prompt) return "";
  // Tests / brainstorm: comentarios de intención NO se responden localmente.
  if (/vamos\s+a\s+crear|quiero\s+crear|nuevo\s+proyecto/i.test(prompt)) return "";
  if (!isCasualPrompt(prompt)) return "";

  const lower = prompt.toLowerCase();
  if (/^(?:hola|hi|hello|hey|buenas|buen)/i.test(lower)) {
    return "Hola. Soy EditCoreAI, tu asistente y agente de desarrollo de software. ¿En qué te ayudo hoy?";
  }
  if (/gracias/i.test(lower)) {
    return "De nada, un placer ayudarte.";
  }
  if (/c[oó]mo\s+est[aá]s/i.test(lower)) {
    return "Excelente y listo para trabajar en tu proyecto.";
  }
  if (/^(?:ok|vale|perfecto|entendido|de\s+acuerdo)\b/i.test(lower)) {
    return "Perfecto. Indícame en qué trabajamos a continuación.";
  }
  return "";
}

module.exports = {
  isCasualPrompt,
  localConversationResponse,
};
