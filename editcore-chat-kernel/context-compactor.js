"use strict";

/**
 * EditCoreAI - Context Pruning & Message Compaction (kernel)
 *
 * Algoritmo de poda de contexto (originalmente del motor Cline, cosechado al kernel):
 * 1. Poda histórica progresiva: conserva siempre el System Prompt y el primer mensaje del usuario.
 * 2. Deduplicación y rewrite de lecturas de archivos viejas: cuando se vuelve a leer un archivo,
 *    las lecturas anteriores se reemplazan por un marcador compacto.
 * 3. Truncado estricto de outputs gigantes para no desbordar el token limit ni causar OOM.
 * 4. [EDITCORE-INTEGRAL-B2] Compactación por TAMAÑO ESTIMADO: el umbral
 *    maxTotalTokens ya no es decorativo — compactMessages lo usa para
 *    compactar también cuando hay pocos mensajes pero muy grandes, no
 *    solo cuando messages.length > 40.
 */

const DEFAULT_MAX_TOOL_CHARS = 10_000;
const DEFAULT_MAX_ASSISTANT_CHARS = 100_000;
const OUTDATED_FILE_MARKER = "[EditCoreAI: lectura anterior compactada - referirse a la versión más reciente del archivo]";
const TRUNCATED_MARKER = (removed) => `\n\n... [EditCoreAI: ${removed} caracteres truncados para proteger la ventana de contexto] ...\n\n`;
const SIZE_COMPACTED_NOTICE = "[EditCoreAI: mensajes anteriores compactados por presupuesto de tokens estimado. Continúa trabajando en el objetivo actual.]";

// [EDITCORE-INTEGRAL-B2] ESTIMACIÓN de tokens (declarada como estimación,
// no un conteo exacto de tokenizador): ~4 caracteres por token, la razón
// habitual para texto en español/inglés y código. Sirve para DECIDIR
// cuándo compactar; no se presenta como el conteo del proveedor.
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokensForText(text) {
  const s = typeof text === "string" ? text : "";
  return Math.ceil(s.length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateMessageTokens(message) {
  if (!message || typeof message !== "object") return 0;
  let tokens = 4; // sobre por mensaje (rol y estructura)
  if (typeof message.content === "string") {
    tokens += estimateTokensForText(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part && typeof part.text === "string") tokens += estimateTokensForText(part.text);
    }
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    try { tokens += estimateTokensForText(JSON.stringify(message.tool_calls)); } catch { /* ignore */ }
  }
  if (typeof message.name === "string") tokens += estimateTokensForText(message.name);
  return tokens;
}

function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0);
}

// [EDITCORE-INTEGRAL-B2] Agrupa los mensajes en UNIDADES que se pueden
// podar sin romper el protocolo del proveedor: un mensaje assistant con
// tool_calls y TODOS sus mensajes tool siguientes forman una sola
// unidad; cualquier otro mensaje es su propia unidad. Podar unidades
// enteras garantiza que nunca queda un resultado tool huérfano de su
// llamada ni una llamada sin su resultado.
function groupMessageUnits(messages) {
  const units = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m && m.role === "tool" && units.length) {
      units[units.length - 1].indices.push(i);
    } else {
      units.push({ indices: [i] });
    }
  }
  for (const unit of units) {
    unit.tokens = unit.indices.reduce((acc, idx) => acc + estimateMessageTokens(messages[idx]), 0);
    unit.start = unit.indices[0];
  }
  return units;
}

class ContextCompactor {
  constructor(options = {}) {
    this.maxToolResultChars = options.maxToolResultChars || DEFAULT_MAX_TOOL_CHARS;
    this.maxAssistantChars = options.maxAssistantChars || DEFAULT_MAX_ASSISTANT_CHARS;
    this.maxTotalTokens = options.maxTotalTokens || 120_000;
  }

  // [EDITCORE-INTEGRAL-B2] Compactación por tamaño estimado. Recorta
  // primero las unidades VIEJAS y de MAYOR tamaño (nunca el system, ni el
  // primer mensaje del usuario, ni la unidad más reciente), dejando un
  // aviso donde hubo poda. Si aun así no alcanza, achica los resultados
  // tool que quedan (stub en los viejos, cabeza+cola en el mayor).
  compactByEstimatedSize(messages) {
    let total = estimateMessagesTokens(messages);
    if (total <= this.maxTotalTokens) return messages;

    const units = groupMessageUnits(messages);
    if (units.length <= 2) return this.shrinkLargestContents(messages, total);

    const firstUserIdx = messages.findIndex((m) => m && m.role === "user");
    const protectedStarts = new Set();
    protectedStarts.add(units[0].start); // system (o el primer mensaje)
    const firstUserUnit = units.find((u) => u.indices.includes(firstUserIdx));
    if (firstUserUnit) protectedStarts.add(firstUserUnit.start);
    protectedStarts.add(units[units.length - 1].start); // lo más reciente

    // Candidatos: viejos y grandes primero (mayor tamaño; empate → más viejo).
    const candidates = units
      .filter((u) => !protectedStarts.has(u.start))
      .sort((a, b) => (b.tokens - a.tokens) || (a.start - b.start));

    const removedStarts = new Set();
    let insertNoticeAt = -1;
    for (const unit of candidates) {
      if (total <= this.maxTotalTokens) break;
      removedStarts.add(unit.start);
      if (insertNoticeAt < 0 || unit.start < insertNoticeAt) insertNoticeAt = unit.start;
      total -= unit.tokens;
    }

    let out = messages;
    if (removedStarts.size) {
      const removedIndices = new Set();
      for (const unit of units) {
        if (removedStarts.has(unit.start)) for (const idx of unit.indices) removedIndices.add(idx);
      }
      out = [];
      for (let i = 0; i < messages.length; i++) {
        if (i === insertNoticeAt) out.push({ role: "user", content: SIZE_COMPACTED_NOTICE });
        if (!removedIndices.has(i)) out.push(messages[i]);
      }
      total = estimateMessagesTokens(out);
    }

    if (total > this.maxTotalTokens) out = this.shrinkLargestContents(out, total);
    return out;
  }

  // Último recurso de la compactación por tamaño: achica contenidos. Los
  // resultados tool viejos pasan a un stub compacto; si todavía no
  // alcanza, el contenido más grande restante se corta cabeza+cola con
  // marca. Nunca toca el system ni deja unidades a medias: los tool se
  // achican EN SU SITIO, así los pares llamada/resultado quedan íntegros.
  shrinkLargestContents(messages, totalTokens) {
    let total = Number.isFinite(totalTokens) ? totalTokens : estimateMessagesTokens(messages);
    const out = messages;
    // Stub en resultados tool que no sean el más reciente.
    let lastToolIdx = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i] && out[i].role === "tool") { lastToolIdx = i; break; }
    }
    for (let i = 0; i < out.length && total > this.maxTotalTokens; i++) {
      const m = out[i];
      if (m && m.role === "tool" && i !== lastToolIdx && typeof m.content === "string" && m.content.length > 200) {
        const before = estimateMessageTokens(m);
        m.content = JSON.stringify({ ok: true, compacted: true, note: OUTDATED_FILE_MARKER });
        total -= before - estimateMessageTokens(m);
      }
    }
    // Cabeza+cola sobre el contenido más grande que quede (tool o assistant).
    let guard = 0;
    while (total > this.maxTotalTokens && guard < 8) {
      guard += 1;
      let bigIdx = -1;
      let bigLen = 0;
      for (let i = 1; i < out.length; i++) {
        const m = out[i];
        if (m && typeof m.content === "string" && m.content.length > bigLen) {
          bigLen = m.content.length;
          bigIdx = i;
        }
      }
      if (bigIdx < 0 || bigLen <= 240) break;
      const excessChars = (total - this.maxTotalTokens) * CHARS_PER_TOKEN_ESTIMATE;
      const target = Math.max(240, bigLen - excessChars - 64);
      const m = out[bigIdx];
      const head = m.content.slice(0, Math.floor(target * 0.7));
      const tail = m.content.slice(-Math.floor(target * 0.3));
      const before = estimateMessageTokens(m);
      m.content = `${head}${TRUNCATED_MARKER(bigLen - target)}${tail}`;
      total -= before - estimateMessageTokens(m);
    }
    return out;
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

    // 3. [EDITCORE-INTEGRAL-B2] Compactación por TAMAÑO ESTIMADO: usa el
    // umbral maxTotalTokens (antes declarado y nunca leído) para podar
    // también con pocos mensajes pero muy pesados.
    let compacted = this.compactByEstimatedSize(messages);

    // 4. Ventana deslizante si hay demasiados mensajes
    // Preservar system (0) y primer turno usuario (1), podar el centro si supera 40 mensajes
    if (compacted.length > 40) {
      const system = compacted[0];
      const initialUser = compacted[1];
      let recent = compacted.slice(-25); // Los últimos 25 mensajes
      // [EDITCORE-INTEGRAL-B2] La ventana no puede abrir con resultados
      // tool huérfanos: se descartan los tool iniciales de `recent` hasta
      // el primer mensaje que no sea tool (su llamada quedó fuera).
      while (recent.length && recent[0] && recent[0].role === "tool") recent = recent.slice(1);

      const condensedNotice = {
        role: "user",
        content: "[EditCoreAI: mensajes intermedios anteriores compactados para mantener estabilidad y memoria óptima. Continúa trabajando en el objetivo actual.]"
      };

      compacted = [system, initialUser, condensedNotice, ...recent];
      // La ventana puede seguir por encima del umbral estimado: re-aplicar tamaño.
      compacted = this.compactByEstimatedSize(compacted);
    }

    return compacted;
  }
}

module.exports = {
  ContextCompactor,
  DEFAULT_MAX_TOOL_CHARS,
  OUTDATED_FILE_MARKER,
  // [EDITCORE-INTEGRAL-B2] estimación y agrupación por unidades (pares íntegros)
  CHARS_PER_TOKEN_ESTIMATE,
  estimateTokensForText,
  estimateMessageTokens,
  estimateMessagesTokens,
  groupMessageUnits,
  SIZE_COMPACTED_NOTICE
};
