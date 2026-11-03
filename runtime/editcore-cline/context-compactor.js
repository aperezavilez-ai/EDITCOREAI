"use strict";

/**
 * EditCoreAI - Cline-Grade Context Pruning & Message Compaction
 * 
 * Basado en el algoritmo MessageBuilder de Cline:
 * 1. Poda histórica progresiva: conserva siempre el System Prompt y el primer mensaje del usuario.
 * 2. Deduplicación y rewrite de lecturas de archivos viejas: cuando se vuelve a leer un archivo,
 *    las lecturas anteriores se reemplazan por un marcador compacto.
 * 3. Truncado estricto de outputs gigantes para no desbordar el token limit ni causar OOM.
 */

const DEFAULT_MAX_TOOL_CHARS = 10_000;
const DEFAULT_MAX_ASSISTANT_CHARS = 100_000;
const OUTDATED_FILE_MARKER = "[EditCoreAI: lectura anterior compactada - referirse a la versión más reciente del archivo]";
const TRUNCATED_MARKER = (removed) => `\n\n... [EditCoreAI: ${removed} caracteres truncados para proteger la ventana de contexto] ...\n\n`;

class ContextCompactor {
  constructor(options = {}) {
    this.maxToolResultChars = options.maxToolResultChars || DEFAULT_MAX_TOOL_CHARS;
    this.maxAssistantChars = options.maxAssistantChars || DEFAULT_MAX_ASSISTANT_CHARS;
    this.maxTotalTokens = options.maxTotalTokens || 120_000;
  }

  /**
   * Compacta y prepara los mensajes antes de ser enviados a cualquier LLM.
   * @param {Array} rawMessages
   * @returns {Array} Mensajes listos y seguros para la API
   */
  compactMessages(rawMessages = []) {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];

    // Clonar profundamente para no mutar el histórico original de la UI
    const messages = JSON.parse(JSON.stringify(rawMessages));

    // 1. Identificar lecturas de archivos más recientes para marcar lecturas viejas
    const latestFileReads = new Map();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "tool" && m.name === "read_file") {
        try {
          const content = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
          const filePath = content?.path || content?.file;
          if (filePath && !latestFileReads.has(filePath)) {
            latestFileReads.set(filePath, i);
          } else if (filePath && latestFileReads.has(filePath)) {
            // Lectura obsoleta -> compactar
            m.content = JSON.stringify({
              path: filePath,
              note: OUTDATED_FILE_MARKER,
              cached: true
            });
          }
        } catch {
          // Si no es JSON parseable, mantener
        }
      }
    }

    // 2. Truncar herramientas con respuestas masivas
    for (const m of messages) {
      if (m.role === "tool" && typeof m.content === "string") {
        if (m.content.length > this.maxToolResultChars) {
          const head = m.content.slice(0, Math.floor(this.maxToolResultChars * 0.7));
          const removed = m.content.length - this.maxToolResultChars;
          const tail = m.content.slice(-Math.floor(this.maxToolResultChars * 0.3));
          m.content = `${head}${TRUNCATED_MARKER(removed)}${tail}`;
        }
      } else if (m.role === "assistant" && typeof m.content === "string") {
        if (m.content.length > this.maxAssistantChars) {
          m.content = m.content.slice(0, this.maxAssistantChars) + "\n\n[EditCoreAI: contenido largo recortado]";
        }
      }
    }

    // 3. Ventana deslizante si hay demasiados mensajes
    // Preservar system (0) y primer turno usuario (1), podar el centro si supera 40 mensajes
    if (messages.length > 40) {
      const system = messages[0];
      const initialUser = messages[1];
      const recent = messages.slice(-25); // Los últimos 25 mensajes

      const condensedNotice = {
        role: "user",
        content: "[EditCoreAI: mensajes intermedios anteriores compactados para mantener estabilidad y memoria óptima. Continúa trabajando en el objetivo actual.]"
      };

      return [system, initialUser, condensedNotice, ...recent];
    }

    return messages;
  }
}

module.exports = {
  ContextCompactor,
  DEFAULT_MAX_TOOL_CHARS,
  OUTDATED_FILE_MARKER
};
