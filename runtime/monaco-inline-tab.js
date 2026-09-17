"use strict";

/**
 * Motor de Autocompletado Predictivo Ghost Text / Cursor Tab para Monaco Editor.
 * Utiliza Fill-In-the-Middle (FIM) y modelos ultra-rápidos con caché de predicciones.
 */

class InlineCompletionCache {
  constructor(maxSize = 100, ttlMs = 15_000) {
    this.map = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  _key(filePath, prefix, suffix) {
    const pEnd = String(prefix || "").slice(-80);
    const sStart = String(suffix || "").slice(0, 40);
    return `${filePath || ""}::${pEnd}::${sStart}`;
  }

  get(filePath, prefix, suffix) {
    const key = this._key(filePath, prefix, suffix);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return entry.text;
  }

  set(filePath, prefix, suffix, text) {
    if (!text) return;
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    const key = this._key(filePath, prefix, suffix);
    this.map.set(key, { text, at: Date.now() });
  }

  clear() {
    this.map.clear();
  }
}

const globalTabCache = new InlineCompletionCache();

/**
 * Construye el prompt Fill-In-The-Middle (FIM) para el modelo de autocompletado.
 */
function buildFimPrompt({ filePath = "", language = "", prefix = "", suffix = "" } = {}) {
  const fileHeader = filePath ? `// Archivo: ${filePath} (${language})\n` : "";
  const cleanPrefix = String(prefix || "").slice(-2500);
  const cleanSuffix = String(suffix || "").slice(0, 1000);

  return [
    {
      role: "system",
      content: "Eres Cursor Tab, un motor de autocompletado de código de ultra-baja latencia. " +
        "Tu objetivo es completar ÚNICAMENTE el código faltante en la posición exacta del cursor. " +
        "REGLAS DURAS: " +
        "1. Devuelve SOLO el código completado. Sin explicaciones, sin markdown (sin ```), sin texto introductorio. " +
        "2. No repitas el código del prefijo ni del sufijo. " +
        "3. Si no hay nada obvio que autocompletar, devuelve un string vacío."
    },
    {
      role: "user",
      content: `${fileHeader}<<PREFIJO>>\n${cleanPrefix}\n<<POSICION_CURSOR_AQUI>>\n<<SUFIJO>>\n${cleanSuffix}\n\n<<COMPLETA EL CODIGO EN POSICION_CURSOR_AQUI>>:`
    }
  ];
}

/**
 * Limpia la predicción del modelo para insertarla directamente en el editor.
 */
function cleanPredictedCompletion(raw = "", prefix = "") {
  let text = String(raw || "");
  // Quitar bloques de markdown si el modelo los incluyó
  text = text.replace(/^```[a-zA-Z0-9_-]*\n?/g, "").replace(/\n?```$/g, "");
  text = text.replace(/^<<COMPLETA.*?>>:\s*/i, "");

  // Si el texto predicho repite la última línea del prefijo, recortar la repetición
  const prefixLines = String(prefix || "").split("\n");
  const lastLine = prefixLines[prefixLines.length - 1] || "";
  if (lastLine && text.startsWith(lastLine)) {
    text = text.slice(lastLine.length);
  }

  return text;
}

/**
 * Registra el proveedor de autocompletado inline en Monaco Editor.
 */
function registerCursorTabProvider(monaco, { fetchCompletion = null, debounceMs = 250 } = {}) {
  if (!monaco || !monaco.languages || typeof monaco.languages.registerInlineCompletionsProvider !== "function") {
    return null;
  }

  let debounceTimer = null;

  return monaco.languages.registerInlineCompletionsProvider("*", {
    provideInlineCompletions: async (model, position, context, token) => {
      if (token.isCancellationRequested || typeof fetchCompletion !== "function") {
        return { items: [] };
      }

      const fullText = model.getValue();
      const offset = model.getOffsetAt(position);
      const prefix = fullText.slice(0, offset);
      const suffix = fullText.slice(offset);
      const filePath = model.uri ? model.uri.fsPath || model.uri.path : "file.ts";
      const language = model.getLanguageId() || "typescript";

      // 1. Revisar caché local inmediata
      const cached = globalTabCache.get(filePath, prefix, suffix);
      if (cached) {
        return {
          items: [{
            insertText: cached,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          }],
        };
      }

      // 2. Esperar debounce si el usuario sigue tecleando
      if (debounceTimer) clearTimeout(debounceTimer);

      return new Promise((resolve) => {
        debounceTimer = setTimeout(async () => {
          if (token.isCancellationRequested) return resolve({ items: [] });

          try {
            const promptMessages = buildFimPrompt({ filePath, language, prefix, suffix });
            const rawPrediction = await fetchCompletion(promptMessages, { timeoutMs: 2500 });
            const cleaned = cleanPredictedCompletion(rawPrediction, prefix);

            if (cleaned && !token.isCancellationRequested) {
              globalTabCache.set(filePath, prefix, suffix, cleaned);
              return resolve({
                items: [{
                  insertText: cleaned,
                  range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                }],
              });
            }
          } catch { /* ignore completion errors */ }

          resolve({ items: [] });
        }, debounceMs);
      });
    },
    freeInlineCompletions: () => {},
  });
}

module.exports = {
  InlineCompletionCache,
  globalTabCache,
  buildFimPrompt,
  cleanPredictedCompletion,
  registerCursorTabProvider,
};
