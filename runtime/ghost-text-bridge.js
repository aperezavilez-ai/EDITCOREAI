"use strict";

/**
 * Ghost Text Bridge — Conecta el GhostTextProvider con el renderer de Monaco vía IPC.
 *
 * Ciclo 14, Fase 2 y 3:
 * - Expone canales IPC para solicitar autocompletado desde el renderer.
 * - Conecta con RAG local para enriquecer las sugerencias.
 * - Gestiona el ciclo de vida del provider.
 */

const { GhostTextProvider } = require("./ghost-text-provider");

class GhostTextBridge {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.ragBridge = options.ragBridge || null;
    this.aiCore = options.aiCore || null;
    this.provider = null;
    this._ipcMain = options.ipcMain || null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return { ok: true };

    this.provider = new GhostTextProvider({
      projectRoot: this.projectRoot,
      ragBridge: this.ragBridge,
      debounceMs: 300,
      maxTokens: 256,
      temperature: 0.2,
      onRequest: async (request) => {
        return this._handleCompletionRequest(request);
      },
    });

    if (this._ipcMain) {
      this._registerIPCHandlers();
    }

    this._initialized = true;
    return { ok: true };
  }

  /**
   * Registra los canales IPC para comunicación con el renderer.
   */
  _registerIPCHandlers() {
    if (!this._ipcMain) return;

    // Canal principal: solicitar autocompletado
    this._ipcMain.handle("ghost-text:complete", async (_event, input = {}) => {
      try {
        if (!this.provider) {
          return { ok: false, error: "GhostTextProvider no inicializado" };
        }

        const result = await this.provider._generateSuggestion({
          text: input.text || "",
          prefix: input.prefix || "",
          suffix: input.suffix || "",
          language: input.language || "plaintext",
          filePath: input.filePath || "",
          lineNumber: input.lineNumber || 1,
          column: input.column || 1,
        });

        return { ok: true, items: result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    // Canal para streaming de completado
    this._ipcMain.handle("ghost-text:stream", async (event, input = {}) => {
      try {
        if (!this.aiCore) {
          return { ok: false, error: "AI Core no disponible" };
        }

        const { prompt, language, filePath } = input;

        // Enriquecer con RAG si está disponible
        let enrichedPrompt = prompt;
        if (this.ragBridge) {
          try {
            const ragResult = await this.ragBridge.enrichPrompt(prompt, {
              topK: 3,
              minScore: 0.4,
            });
            if (ragResult.context) {
              enrichedPrompt = prompt + "\n\n" + ragResult.context;
            }
          } catch (ragErr) {
            console.warn("[GhostTextBridge] RAG enrichment failed:", ragErr.message);
          }
        }

        // Llamar al AI Core con streaming
        const response = await this.aiCore.chat({
          messages: [{ role: "user", content: enrichedPrompt }],
          stream: true,
          maxTokens: 256,
          temperature: 0.2,
          systemPrompt: this._buildSystemPrompt(language, filePath),
        });

        // Enviar chunks al renderer
        if (response && response.stream) {
          for await (const chunk of response.stream) {
            const text = chunk?.text || chunk?.choices?.[0]?.delta?.content || "";
            if (text) {
              event.sender.send("ghost-text:stream-chunk", { text });
            }
          }
          event.sender.send("ghost-text:stream-done", { ok: true });
        }

        return { ok: true };
      } catch (err) {
        event.sender.send("ghost-text:stream-done", { ok: false, error: err.message });
        return { ok: false, error: err.message };
      }
    });

    // Canal para cancelar request en curso
    this._ipcMain.handle("ghost-text:cancel", async () => {
      if (this.provider?._abortController) {
        this.provider._abortController.abort();
      }
      return { ok: true };
    });

    // Canal para forzar reindexación RAG
    this._ipcMain.handle("ghost-text:reindex", async () => {
      if (!this.ragBridge) {
        return { ok: false, error: "RAG Bridge no disponible" };
      }
      try {
        const result = await this.ragBridge.ensureIndexed({ force: true });
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
  }

  /**
   * Maneja la solicitud de completado usando AI Core.
   */
  async _handleCompletionRequest(request) {
    if (!this.aiCore) {
      return { text: "" };
    }

    try {
      const response = await this.aiCore.chat({
        messages: [{ role: "user", content: request.prompt }],
        stream: false,
        maxTokens: request.maxTokens || 256,
        temperature: request.temperature ?? 0.2,
        systemPrompt: this._buildSystemPrompt(request.language, request.filePath),
      });

      const text = response?.text || response?.choices?.[0]?.message?.content || "";
      return { text };
    } catch (err) {
      console.warn("[GhostTextBridge] Completion request failed:", err.message);
      return { text: "" };
    }
  }

  /**
   * Construye el system prompt para autocompletado.
   */
  _buildSystemPrompt(language, filePath) {
    return [
      "You are an expert code completion assistant.",
      "Return ONLY the code that should appear at the cursor position.",
      "Do NOT repeat existing code. Do NOT add explanations or markdown.",
      `Language: ${language || "auto"}. File: ${filePath || "unknown"}.`,
      "Keep completions concise (max 3-5 lines). Match the existing code style.",
      "If the cursor is mid-line, complete only the rest of that line and optionally the next lines.",
    ].join("\n");
  }

  /**
   * Obtiene estadísticas del provider.
   */
  getStats() {
    if (!this.provider) return { active: false };
    return {
      active: true,
      cacheSize: this.provider._suggestionCache.size,
      debounceMs: this.provider.debounceMs,
      maxTokens: this.provider.maxTokens,
    };
  }

  /**
   * Libera recursos.
   */
  dispose() {
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
    }
    this._initialized = false;
  }
}

module.exports = { GhostTextBridge };
