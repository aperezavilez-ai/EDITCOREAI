"use strict";

const crypto = require("node:crypto");

class ConversationLog {
  constructor({ prefixMessages = [], maxChars = 240_000, keepLastTurns = 12, evidencePreservationBlock = "" } = {}) {
    this.prefix = Array.isArray(prefixMessages) ? [...prefixMessages] : [];
    this.turns = [];
    this.maxChars = Math.max(1_000, Number(maxChars) || 240_000);
    this.keepLastTurns = Math.max(2, Number(keepLastTurns) || 12);
    this.turnCounter = 0;
    this.compactedTurns = 0;
    this.evidencePreservationBlock = String(evidencePreservationBlock || "");
  }

  setEvidencePreservationBlock(block = "") {
    this.evidencePreservationBlock = String(block || "");
  }

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

  appendToolResult(callId, name, payload, { cap = 6_000 } = {}) {
    const content = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
    const bounded = content.length > cap ? `${content.slice(0, cap)}... [truncado: ${content.length} chars]` : content;
    if (callId) {
      this.turns.push({ role: "tool", tool_call_id: String(callId), name: String(name || "tool"), content: bounded });
    } else {
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

  compact() {
    if (this.serializedLength() <= this.maxChars) return false;
    let cut = Math.max(0, this.turns.length - this.keepLastTurns);
    while (cut > 0 && this.turns[cut].role === "tool") cut -= 1;
    if (cut <= 0) return false;
    const archived = this.turns.slice(0, cut);
    const rows = [];
    const touchedFiles = new Set();

    for (const turn of archived) {
      if (turn.role === "assistant" && Array.isArray(turn.tool_calls)) {
        for (const call of turn.tool_calls) {
          const name = call.function.name;
          const args = String(call.function.arguments || "");
          rows.push(`- [TOOL] ${name}: ${args.slice(0, 600)}`);
          try {
            const parsedArgs = JSON.parse(args);
            if (parsedArgs.path) touchedFiles.add(parsedArgs.path);
          } catch {}
        }
      } else if (turn.role === "tool") {
        const summary = String(turn.content || "").slice(0, 800);
        rows.push(`  → Resultado (${turn.name}): ${summary}`);
      } else if (turn.content) {
        rows.push(`- [${turn.role}] ${String(typeof turn.content === "string" ? turn.content : JSON.stringify(turn.content)).slice(0, 600)}`);
      }
    }

    this.compactedTurns += archived.length;
    const preservation = String(this.evidencePreservationBlock || "").trim();
    const summaryParts = [];
    if (preservation) {
      summaryParts.push(preservation);
      summaryParts.push("");
    }
    if (touchedFiles.size) {
      summaryParts.push(`ARCHIVOS MODIFICADOS/CONSULTADOS EN HISTORIAL PREVIO: ${[...touchedFiles].join(", ")}`);
    }
    const summaryLimit = Math.max(1_500, Math.min(25_000, Math.floor(this.maxChars * 0.4)));
    summaryParts.push(`RESUMEN DE EVIDENCIA PREVIA (EditCoreAI sin pérdida de contexto):\n${rows.join("\n").slice(0, summaryLimit)}`);
    this.turns = [
      { role: "user", content: summaryParts.join("\n") },
      ...this.turns.slice(cut),
    ];
    return true;
  }

  toProviderMessages() {
    this.compact();
    return [...this.prefix, ...this.turns];
  }

    contextSignature() {
    return crypto.createHash("sha256").update(JSON.stringify([this.prefix, this.turns])).digest("hex");
  }
}

module.exports = { ConversationLog };