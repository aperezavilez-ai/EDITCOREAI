"use strict";

/**
 * Universal Auto-Router Transparent Agent Protocol.
 * Aplica a CUALQUIER modelo asignado por Auto (Claude, GPT, DeepSeek, Gemini, Qwen, …).
 * No depende del proveedor: se antepone al system prompt del agente.
 */

(function exposeAutoRouterTransparentProtocol(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreAutoRouterProtocol = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutoRouterTransparentProtocol() {
  const PROTOCOL_MARKER = "AUTO_ROUTER_TRANSPARENT_PROTOCOL_V1";

  const AUTO_ROUTER_TRANSPARENT_PROTOCOL = [
    `[${PROTOCOL_MARKER}]`,
    "PROTOCOLO UNIVERSAL — Auto Model Router (obligatorio para TODO modelo asignado):",
    "Claude, GPT, DeepSeek, Gemini, Qwen u otro: mismas reglas. No eres una caja negra.",
    "",
    "1) CERO SILENCIO Y NARRACIÓN EN TIEMPO REAL:",
    "- Prohibido tool calls mudos, Done, Listo, Detenido o un check sin prosa.",
    "- ANTES de leer o escribir: di en español qué harás y por qué.",
    "- Emite el texto a medida que razonas, no un bloque al final.",
    "",
    "2) FLUJO TRANSPARENTE:",
    "- Diagnóstico: qué pediste y qué voy a mirar.",
    "- Lectura: «En `archivo` veo X.»",
    "- Decisión: qué cambio y qué dejo quieto.",
    "- Cierre: resultado concreto, en párrafos cortos.",
    "",
    "3) CUMPLIMIENTO DE STREAMING:",
    "- No buffers la respuesta completa hasta terminar todas las tools.",
    "- Mantén el estilo transparente de Cursor Composer en todo momento.",
    "- Cada read/search/list/write debe dejar rastro narrativo visible en el chat.",
  ].join("\n");

  function hasAutoRouterProtocol(prompt = "") {
    return String(prompt || "").includes(`[${PROTOCOL_MARKER}]`)
      || String(prompt || "").includes("PROTOCOLO UNIVERSAL — Auto Model Router");
  }

  function stripAutoRouterProtocol(prompt = "") {
    let value = String(prompt || "");
    value = value.replace(
      new RegExp(`\\[${PROTOCOL_MARKER}\\][\\s\\S]*?(?=\\n\\n\\[|\\n\\n(?=[A-ZÁÉÍÓÚÑ0-9])|$)`, "g"),
      "",
    );
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  function withAutoRouterTransparentProtocol(systemPrompt = "") {
    const rest = stripAutoRouterProtocol(String(systemPrompt || "").trim());
    if (!rest) return AUTO_ROUTER_TRANSPARENT_PROTOCOL;
    if (hasAutoRouterProtocol(rest)) return rest;
    return `${AUTO_ROUTER_TRANSPARENT_PROTOCOL}\n\n${rest}`;
  }

  return {
    PROTOCOL_MARKER,
    AUTO_ROUTER_TRANSPARENT_PROTOCOL,
    hasAutoRouterProtocol,
    stripAutoRouterProtocol,
    withAutoRouterTransparentProtocol,
  };
});
