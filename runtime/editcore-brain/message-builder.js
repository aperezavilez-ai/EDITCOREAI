"use strict";

/**
 * EDITCORE BRAIN - Message Builder & Context Memory Compactor
 * 
 * Basado en el algoritmo MessageBuilder de Cline:
 * 1. Poda activa: detecta lecturas de archivos obsoletas y las sustituye por un puntero ligero.
 * 2. Truncado de outputs masivos con marcadores estructurados para evitar OOM y desbordes.
 * 3. Ventana deslizante anclada: preserva el System Prompt y el objetivo inicial del usuario.
 */

const DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000;
const DEFAULT_MAX_FILE_CONTENT_CHARS = 50_000;
const DEFAULT_MAX_TOTAL_TEXT_CHARS = 150_000;

const OUTDATED_FILE_MARKER = "[EditCore Brain: lectura previa compactada. Consultar la versión más reciente del archivo]";
const TRUNCATE_MARKER = (removed) => `\n\n... [EditCore Brain: ${removed} caracteres truncados para fit de contexto] ...\n\n`;

class BrainMessageBuilder {
  constructor(options = {}) {
    this.maxToolResultChars = options.maxToolResultChars || DEFAULT_MAX_TOOL_RESULT_CHARS;
    this.maxFileContentChars = options.maxFileContentChars || DEFAULT_MAX_FILE_CONTENT_CHARS;
    this.maxTotalTextChars = options.maxTotalTextChars || DEFAULT_MAX_TOTAL_TEXT_CHARS;
  }

  /**
   * Prepara y compacta el historial de mensajes de forma segura para los modelos.
   * @param {Array} messages - Historial completo de la sesión
   * @returns {Array} Array optimizado para enviar a la API
   */
  buildSafeTranscript(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    // Clonar para no alterar el historial visual del renderer
    const transcript = JSON.parse(JSON.stringify(messages));

    // 1. Detección y compactación de lecturas duplicadas/obsoletas de archivos
    const seenFiles = new Map();
    for (let i = transcript.length - 1; i >= 0; i--) {
      const msg = transcript[i];
      if (msg.role === "tool" && (msg.name === "read_file" || msg.name === "read")) {
        try {
          const parsed = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
          const targetPath = parsed?.path || parsed?.file;
          if (targetPath) {
            if (!seenFiles.has(targetPath)) {
              seenFiles.set(targetPath, i); // Última lectura válida
            } else {
              // Lectura anterior obsoleta -> sustituir contenido por marcador
              msg.content = JSON.stringify({
                path: targetPath,
                note: OUTDATED_FILE_MARKER,
                compacted: true,
              });
            }
          }
        } catch {
          // Si no es JSON estándar, mantener intacto
        }
      }
    }

    // 2. Truncado de outputs masivos por herramienta
    for (const msg of transcript) {
      if (msg.role === "tool" && typeof msg.content === "string") {
        if (msg.content.length > this.maxToolResultChars) {
          const keepStart = Math.floor(this.maxToolResultChars * 0.7);
          const keepEnd = Math.floor(this.maxToolResultChars * 0.3);
          const removed = msg.content.length - this.maxToolResultChars;
          msg.content = `${msg.content.slice(0, keepStart)}${TRUNCATE_MARKER(removed)}${msg.content.slice(-keepEnd)}`;
        }
      }
    }

    // 3. Compactación de conversación intermedia si supera los 35 mensajes
    if (transcript.length > 35) {
      const systemMsg = transcript[0];
      const initialTaskMsg = transcript[1];
      const recentTurns = transcript.slice(-20);

      const contextSummaryMsg = {
        role: "user",
        content: "[EditCore Brain: Se han compactado los turnos intermedios para preservar memoria óptima. El objetivo y el estado actual se mantienen activos.]",
      };

      return [systemMsg, initialTaskMsg, contextSummaryMsg, ...recentTurns];
    }

    return transcript;
  }
}

module.exports = {
  BrainMessageBuilder,
  OUTDATED_FILE_MARKER,
};
