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
    "- PROHIBIDO tool calls silenciosos, turnos solo con checkmark, \"Done\", \"Listo\" o un resumen corto final.",
    "- ANTES de leer, buscar, ejecutar shell o modificar código: escribe en el chat qué harás y por qué.",
    "- El usuario ve tu texto token a token: emite prosa de forma progresiva, no al final del turno.",
    "",
    "2) FLUJO TRANSPARENTE PASO A PASO:",
    "- Paso 1 (Diagnosticar): analiza la petición e indica qué archivos/sistemas inspeccionarás.",
    "- Paso 2 (Explorar y narrar): mientras inspeccionas, actualiza en vivo",
    "  (ej. Inspecting admin-functions.ts to check the online status query…).",
    "- Paso 3 (Proponer y explicar): antes o junto a cada patch, explica la lógica exacta del cambio.",
    "- Paso 4 (Verificar y concluir): resume el estado final en lenguaje natural.",
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
