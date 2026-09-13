"use strict";

const crypto = require("node:crypto");

// Conversacion nativa del agente: prefijo estable (system + tarea inicial) mas
// turnos append-only de assistant/tool/user. El prefijo nunca cambia para que
// el prompt-caching del proveedor pueda reutilizarlo; toda retroalimentacion
// (rechazos, resultados, correcciones) se agrega al final, de modo que el
// contexto SIEMPRE cambia entre llamadas y el modelo nunca recibe dos veces la
// misma entrada exacta.
class ConversationLog {
  constructor({ prefixMessages = [], maxChars = 240_000, keepLastTurns = 12, evidencePreservationBlock = "" } = {}) {
    this.prefix = Array.isArray(prefixMessages) ? [...prefixMessages] : [];
    this.turns = [];
    this.maxChars = Math.max(20_000, Number(maxChars) || 240_000);
    this.keepLastTurns = Math.max(2, Number(keepLastTurns) || 12);
    this.turnCounter = 0;
    this.compactedTurns = 0;
    this.evidencePreservationBlock = String(evidencePreservationBlock || "");
  }

  setEvidencePreservationBlock(block = "") {
    this.evidencePreservationBlock = String(block || "");
  }

  // Normaliza ids de tool_calls: algunos proveedores (Gemini) emiten ids
  // sinteticos repetidos entre turnos ("gemini-0"); se sufijan por turno.
  appendAssistant({ text = "", toolCalls = [] } = {}) {
    this.turnCounter += 1;
    const calls = (Array.isArray(toolCalls) ? toolCalls : []).map((call, index) => {
      const fn = call?.function || call || {};
      const rawId = String(call?.id || `call_${fn.name || "tool"}_${index}`);
      const id = `${rawId}:t${this.turnCounter}`;
      return {
        id,
        type: "function",
        function: {
          name: String(fn.name || ""),
          arguments: (() => {
            const raw = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || fn.input || {});
            try {
              JSON.parse(raw || "{}");
              return raw || "{}";
            } catch {
              return "{}";
            }
          })(),
        },
      };
    });
    const message = { role: "assistant", content: String(text || "") };
    if (calls.length) message.tool_calls = calls;
    this.turns.push(message);
    return calls;
  }

  // Cada tool_call del turno anterior DEBE recibir exactamente un resultado,
  // incluidos los rechazados (payload {error}), para mantener el historial
  // valido en OpenAI/Anthropic/Gemini.
  appendToolResult(callId, name, payload, { cap = 6_000 } = {}) {
    const content = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
    const bounded = content.length > cap ? `${content.slice(0, cap)}... [truncado: ${content.length} chars]` : content;
    if (callId) {
      this.turns.push({ role: "tool", tool_call_id: String(callId), name: String(name || "tool"), content: bounded });
    } else {
      // Protocolo JSON textual (proveedor sin tools nativas): el resultado va
      // como mensaje de usuario porque no existe un tool_call_id que emparejar.
      this.turns.push({ role: "user", content: `Resultado de ${String(name || "la herramienta")}: ${bounded}` });
    }
  }

  appendUser(text) {
    const value = String(text || "").trim();
    if (value) this.turns.push({ role: "user", content: value });
  }

  pendingToolCallIds() {
    const answered = new Set(this.turns.filter((turn) => turn.role === "tool").map((turn) => turn.tool_call_id));
    const pending = [];
    for (const turn of this.turns) {
      if (turn.role !== "assistant" || !Array.isArray(turn.tool_calls)) continue;
      for (const call of turn.tool_calls) if (!answered.has(call.id)) pending.push(call.id);
    }
    return pending;
  }

  serializedLength() {
    return JSON.stringify(this.prefix).length + JSON.stringify(this.turns).length;
  }

  // Cuando el historial excede maxChars se resumen los turnos antiguos en un
  // solo mensaje de usuario; el prefijo queda intacto (estabilidad del cache)
  // y se conservan los ultimos keepLastTurns turnos completos. Nunca se corta
  // dentro de un par assistant(tool_calls)->tool para no romper el historial.
  compact() {
    if (this.serializedLength() <= this.maxChars) return false;
    let cut = Math.max(0, this.turns.length - this.keepLastTurns);
    while (cut > 0 && this.turns[cut].role === "tool") cut -= 1;
    if (cut <= 0) return false;
    const archived = this.turns.slice(0, cut);
    const rows = [];
    for (const turn of archived) {
      if (turn.role === "assistant" && Array.isArray(turn.tool_calls)) {
        for (const call of turn.tool_calls) rows.push(`- ${call.function.name}(${String(call.function.arguments || "").slice(0, 160)})`);
        if (turn.content) rows.push(`  nota: ${String(turn.content).slice(0, 200)}`);
      } else if (turn.role === "tool") {
        const last = rows.length - 1;
        const summary = String(turn.content || "").slice(0, 220);
        if (last >= 0) rows[last] += ` => ${summary}`;
      } else if (turn.content) {
        rows.push(`- [${turn.role}] ${String(typeof turn.content === "string" ? turn.content : JSON.stringify(turn.content)).slice(0, 220)}`);
      }
    }
    this.compactedTurns += archived.length;
    const preservation = String(this.evidencePreservationBlock || "").trim();
    const summaryParts = [];
    if (preservation) {
      summaryParts.push(preservation);
      summaryParts.push("");
    }
    summaryParts.push(`RESUMEN DE EVIDENCIA PREVIA (turnos compactados por EditCore; no repitas estas acciones):\n${rows.join("\n").slice(0, 12_000)}`);
    this.turns = [
      { role: "user", content: summaryParts.join("\n") },
      ...this.turns.slice(cut),
    ];
    return true;
  }

  toProviderMessages() {
    // Se audita antes de cada llamada. compact decide si el umbral preventivo
    // exige archivar evidencia antigua y conservar solo resumen + turnos recientes.
    this.compact();
    return [...this.prefix, ...this.turns];
  }

  contextSignature() {
    return crypto.createHash("sha256").update(JSON.stringify([this.prefix, this.turns])).digest("hex");
  }
}

module.exports = { ConversationLog };
