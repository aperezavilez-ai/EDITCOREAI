"use strict";

/**
 * EDITCORE BRAIN - Provider Gateway
 * 
 * Capa de abstracción para proveedores de LLM:
 * - OpenAI API, Anthropic API, OpenRouter, GafCore Gateway y modelos locales.
 * - Conecta con la bóveda de credenciales segura de EditCore.
 * - Sin fugas de API Keys al proceso Renderer.
 */

class BrainProviderGateway {
  constructor(deps = {}) {
    // Reutiliza la función probada callChat de EditCore o un adaptador inyectado
    this.callChatFn = deps.callChat || require("../../editcore-chat-kernel/provider").callChat;
  }

  /**
   * Ejecuta una llamada de chat con streaming y herramientas hacia el proveedor configurado.
   */
  async requestTurn({
    apiBaseUrl,
    apiKey,
    model,
    messages,
    tools,
    signal,
    onTextDelta = null,
    fallbackProfiles = [],
    onFallback = null,
  }) {
    if (!apiKey) throw new Error("[EditCore Brain] API Key no configurada.");
    if (!model) throw new Error("[EditCore Brain] Modelo no especificado.");

    return await this.callChatFn({
      apiBaseUrl,
      apiKey,
      model,
      messages,
      tools,
      signal,
      stream: true,
      onTextDelta,
      fallbackProfiles,
      onFallback,
    });
  }
}

module.exports = {
  BrainProviderGateway,
};
