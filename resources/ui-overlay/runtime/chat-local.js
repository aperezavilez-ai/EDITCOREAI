"use strict";

function localConversationResponse(value) {
  const prompt = String(value || "").trim();
  if (/^(hola|hi|hello|hey|buenas|buenos dias|buenas tardes|buenas noches)[.!? ]*$/i.test(prompt)) {
    return "¡Hola! ¿En qué te ayudo?";
  }
  if (/^(gracias|muchas gracias)[.!? ]*$/i.test(prompt)) return "De nada.";
  if (/^(qu[eé] pas[oó](?:.*no contestas)?|por ?qu[eé] no contestas|sigues ah[ií])[.!? ]*$/i.test(prompt)) {
    return "Aquí estoy. Si la respuesta anterior terminó por timeout, no se ejecutó ninguna acción ni se sustituyó por un resultado inventado.";
  }
  if (/^(ya est[aá]s (?:operativo|operativamente funcional)|est[aá]s (?:operativo|funcionando))[.!? ]*$/i.test(prompt)) {
    return "El chat está respondiendo. La operación completa del agente se confirma por separado con herramientas reales.";
  }
  return "";
}
function isCasualPrompt(value) {
  return Boolean(localConversationResponse(value));
}

module.exports = {
  localConversationResponse,
  isCasualPrompt,
};
