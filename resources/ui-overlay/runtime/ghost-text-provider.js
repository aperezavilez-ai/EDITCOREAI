"use strict";

/**
 * Ghost Text Provider — Proveedor de Inline Completions para Monaco Editor.
 *
 * Ciclo 14, Fase 1: Intercepta cambios de cursor y solicita sugerencias predictivas.
 * - Se registra como InlineCompletionsProvider de Monaco.
 * - Debounce inteligente para no saturar al modelo.
 * - Soporte para streaming de texto fluido.
 * - Integración con RAG local para contexto semántico.
 */

class GhostTextProvider {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.debounceMs = options.debounceMs || 300;
    this.maxTokens = options.maxTokens || 256;
    this.temperature = options.temperature ?? 0.2;
    this.ragBridge = options.ragBridge || null;
    this.onRequest = options.onRequest || null; // callback para IPC
    this._timer = null;
    this._lastRequest = null;
    this._abortController = null;
    this._suggestionCache = new Map();
    this._cacheTTL = options.cacheTTL || 30000;
  }

  /**
   * Monaco llama a este método cuando necesita sugerencias inline.
   * @param {object} model - Monaco text model
   * @param {object} position - { lineNumber, column }
   * @param {object} context - { triggerKind, selectedSuggestionInfo }
   * @param {object} token - CancellationToken
   */
  async provideInlineCompletions(model, position, context, token) {
    const text = model.getValue();
    const lineContent = model.getLineContent(position.lineNumber);
    const prefix = lineContent.slice(0, position.column - 1);
    const suffix = lineContent.slice(position.column - 1);
    const language = model.getLanguageId?.() || "plaintext";
    const filePath = model.uri?.fsPath || model.uri?.path || "";

    // Cancelar request anterior si aún está pendiente
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();

    // Si el token de Monaco se cancela, abortar también
    if (token?.onCancellationRequested) {
      token.onCancellationRequested(() => this._abortController?.abort());
    }

    // Cache key basado en posición y contenido
    const cacheKey = `${filePath}:${position.lineNumber}:${position.column}:${prefix}`;
    const cached = this._suggestionCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this._cacheTTL) {
      return this._formatCompletions(cached.items, position);
    }

    // Debounce: esperar a que el usuario deje de escribir
    const items = await new Promise((resolve) => {
      clearTimeout(this._timer);
      this._timer = setTimeout(async () => {
        try {
          const result = await this._generateSuggestion({
            text,
            prefix,
            suffix,
            lineContent,
            language,
            filePath,
            lineNumber: position.lineNumber,
            column: position.column,
          });
          resolve(result);
        } catch (err) {
          if (err.name === "AbortError") {
            resolve([]);
          } else {
            console.warn("[GhostText] Error generando sugerencia:", err.message);
            resolve([]);
          }
        }
      }, this.debounceMs);
    });

    // Guardar en cache
    if (items.length > 0) {
      this._suggestionCache.set(cacheKey, { items, ts: Date.now() });
      // Limpiar cache vieja
      this._pruneCache();
    }

    return this._formatCompletions(items, position);
  }

  /**
   * Genera la sugerencia usando el backend (IA + RAG).
   */
  async _generateSuggestion(ctx) {
    const { text, prefix, suffix, language, filePath, lineNumber } = ctx;

    // Construir prompt optimizado para autocompletado
    const surroundingLines = this._extractSurroundingContext(text, lineNumber, 15);

    let ragContext = "";
    if (this.ragBridge) {
      try {
        const ragResult = await this.ragBridge.enrichPrompt(
          `Complete the code at line ${lineNumber} in ${filePath}. Language: ${language}. Prefix: "${prefix}"`,
          { topK: 3, minScore: 0.4 }
        );
        if (ragResult.context) {
          ragContext = ragResult.context;
        }
      } catch (err) {
        console.warn("[GhostText] RAG enrichment failed:", err.message);
      }
    }

    const prompt = this._buildCompletionPrompt({
      language,
      filePath,
      surroundingLines,
      prefix,
      suffix,
      ragContext,
    });

    // Llamar al backend vía callback (IPC desde renderer)
    if (!this.onRequest) {
      return [];
    }

    const response = await this.onRequest({
      type: "ghost-text",
      prompt,
      prefix,
      suffix,
      language,
      filePath,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    });

    if (!response || !response.text) {
      return [];
    }

    // Parsear la respuesta en items de completado
    return this._parseResponse(response.text, prefix, suffix);
  }

  /**
   * Extrae líneas de contexto alrededor de la posición actual.
   */
  _extractSurroundingContext(fullText, currentLine, windowSize) {
    const lines = fullText.split("\n");
    const start = Math.max(0, currentLine - windowSize - 1);
    const end = Math.min(lines.length, currentLine + windowSize);
    return lines.slice(start, end).join("\n");
  }

  /**
   * Construye el prompt para el modelo de autocompletado.
   */
  _buildCompletionPrompt({ language, filePath, surroundingLines, prefix, suffix, ragContext }) {
    const langComment = this._getCommentStyle(language);
    let prompt = "";

    if (ragContext) {
      prompt += `${langComment} Relevant codebase context:\n${ragContext}\n\n`;
    }

    prompt += `${langComment} File: ${filePath}\n`;
    prompt += `${langComment} Language: ${language}\n`;
    prompt += `${langComment} Complete the following code. Return ONLY the completion text.\n\n`;
    prompt += surroundingLines;
    prompt += `\n${langComment} --- CURSOR POSITION ---\n`;
    prompt += prefix;

    return prompt;
  }

  /**
   * Devuelve el estilo de comentario según el lenguaje.
   */
  _getCommentStyle(language) {
    const styles = {
      javascript: "//",
      typescript: "//",
      python: "#",
      ruby: "#",
      shell: "#",
      html: "<!--",
      css: "/*",
      sql: "--",
    };
    return styles[language] || "//";
  }

  /**
   * Parsea la respuesta del modelo en items de completado.
   */
  _parseResponse(responseText, prefix, suffix) {
    if (!responseText || typeof responseText !== "string") return [];

    // Limpiar la respuesta: quitar bloques de código markdown, comentarios extra
    let cleaned = responseText.trim();

    // Si viene con markdown code block, extraer solo el código
    const codeBlockMatch = cleaned.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    // No sugerir si es vacío o muy corto
    if (cleaned.length < 2) return [];

    // Si la respuesta repite el prefix, quitarlo
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
    }

    return [{ text: cleaned, range: null }];
  }

  /**
   * Formatea los items para el formato de Monaco InlineCompletions.
   */
  _formatCompletions(items, position) {
    const monacoItems = items.map((item) => ({
      insertText: item.text,
      range: item.range || {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
    }));

    return { items: monacoItems };
  }

  /**
   * Limpia entradas viejas del cache.
   */
  _pruneCache() {
    const now = Date.now();
    for (const [key, val] of this._suggestionCache.entries()) {
      if (now - val.ts > this._cacheTTL) {
        this._suggestionCache.delete(key);
      }
    }
  }

  /**
   * Libera recursos.
   */
  dispose() {
    clearTimeout(this._timer);
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._suggestionCache.clear();
  }

  /**
   * Método requerido por Monaco para verificar si el provider está activo.
   */
  handleItemDidShow() {
    // Hook para analytics o logging futuro
  }

  /**
   * Monaco llama esto para verificar si debe refrescar las sugerencias.
   */
  freeInlineCompletions() {
    // Cleanup de recursos por request
  }
}

module.exports = { GhostTextProvider };
