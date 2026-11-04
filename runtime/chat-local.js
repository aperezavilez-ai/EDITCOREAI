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
  return /^(?:hola|hi|hello|hey|buenas|buen(?:os|as)\s+(?:d[ií]as|tardes|noches)|gracias(?:\s+mucho)?|ok|vale|perfecto|entendido|de\s+acuerdo|c[oó]mo\s+est[aá]s|qui[eé]n\s+eres|qu[eé]\s+modelos?\s+(?:eres|tienes|usas)|qu[eé]\s+(?:capacidades|funciones|habilidades)\s+(?:tienes|posees)|qu[eé]\s+puedes\s+hacer|qu[eé]\s+haces|para\s+qu[eé]\s+sirves)[.!?¿¡\s]*$/i.test(prompt);
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
  if (/qui[eé]n\s+eres/i.test(lower)) {
    return "Soy EditCoreAI, tu IDE con agente autónomo de ingeniería de software. Puedo inspeccionar tu código, realizar ediciones quirúrgicas atómicas, crear componentes, ejecutar comandos en terminal Windows y ayudarte con git y despliegues.";
  }
  if (/qu[eé]\s+modelos?\s+(?:eres|tienes|usas)/i.test(lower)) {
    return "Soy EditCoreAI. Como agente de este IDE estoy operando actualmente con el modelo seleccionado en tu selector inferior. Puedes cambiar o configurar tus modelos y proveedores en cualquier momento desde dicho selector.";
  }
  if (/qu[eé]\s+(?:capacidades|funciones|habilidades)|qu[eé]\s+puedes\s+hacer|qu[eé]\s+haces|para\s+qu[eé]\s+sirves/i.test(lower)) {
    return `Soy EditCoreAI. Mis capacidades principales son:

1. **Inspección y Diagnóstico**: Exploro la estructura de tus proyectos, leo y comprendo tu código fuente y localizo errores o dependencias faltantes.
2. **Edición Quirúrgica de Código**: Aplico cambios atómicos y precisos mediante diffs directos sin truncar ni romper partes funcionales de tus archivos.
3. **Creación y Refactorización**: Diseño nuevos módulos, componentes, scripts y arquitecturas completas siguiendo las mejores prácticas de la industria.
4. **Terminal y Entorno Windows**: Ejecuto comandos de compilación, instalación de paquetes y tests de forma segura y adaptada a PowerShell/Windows.
5. **Control de Versiones y Despliegue**: Gestiono ramas git, commits atómicos, resolución de conflictos y procesos de compilación o publicación.

¿Qué tarea deseas que abordemos en tu proyecto?`;
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
