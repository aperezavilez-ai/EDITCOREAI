"use strict";

// Fase 1 only: records sizes, hashes, timing, and token usage. It never writes
// API keys, prompts, tool arguments, file contents, or provider responses.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function text(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value || "");
}

function tokens(value) {
  return Math.ceil(text(value).length / 4);
}

function digest(value) {
  return crypto.createHash("sha256").update(text(value)).digest("hex");
}

function content(value) {
  if (!Array.isArray(value)) return text(value);
  return value.map((part) => part?.text || part?.content || "").join("\n");
}

function emptyBreakdown() {
  return Object.fromEntries(["system", "task", "history", "brain", "tools", "project", "files", "symbols", "dependencies", "toolResults", "checkpoints", "other"].map((key) => [key, 0]));
}

function add(row, category, value) {
  row[category] += text(value).length;
}

function breakdown(messages = [], tools = []) {
  const rows = emptyBreakdown();
  const fingerprints = [];
  const messageChars = [];
  messages.forEach((message, index) => {
    const value = content(message?.content);
    if (message?.role === "system") {
      add(rows, "system", value);
    } else if (/^Resultado herramienta |^Formato invalido|^No puedes terminar|^CONTROL DE ESTANCAMIENTO|^Accion exacta repetida|^FASE FINAL/m.test(value)) {
      add(rows, "toolResults", value);
    } else if (/^CHECKPOINTS ANTERIORES|^PROGRESO YA COMPLETADO/m.test(value)) {
      add(rows, "checkpoints", value);
    } else if (/^CONTEXT_MANIFEST\n/m.test(value)) {
      const manifestText = value.split(/\n\n(?:HISTORY_SUMMARY|LAST_TOOL_RESULT|DOCUMENT_SUMMARY)\n/)[0].replace(/^CONTEXT_MANIFEST\n/, "");
      let manifest = {};
      try { manifest = JSON.parse(manifestText); } catch {}
      add(rows, "task", manifest.GOAL || "");
      add(rows, "project", { taskId: manifest.TASK_ID, projectId: manifest.PROJECT_ID, stage: manifest.STAGE, currentStep: manifest.CURRENT_STEP, nextAction: manifest.NEXT_ACTION, verification: manifest.VERIFICATION_STATUS, error: manifest.ERROR_STATE });
      add(rows, "files", manifest.RELEVANT_FILES || []);
      add(rows, "symbols", manifest.RELEVANT_SYMBOLS || []);
      add(rows, "dependencies", manifest.DEPENDENCIES || []);
      add(rows, "brain", { ref: manifest.BRAIN_REF, summary: manifest.BRAIN_SUMMARY, relevance: manifest.BRAIN_RELEVANCE });
      add(rows, "checkpoints", { last: manifest.LAST_CHECKPOINT, history: manifest.HISTORY_REF });
      add(rows, "other", { contextLevel: manifest.CONTEXT_LEVEL, contextHash: manifest.CONTEXT_HASH, toolCatalog: manifest.TOOL_CATALOG, selectedTools: manifest.SELECTED_TOOLS, openIssues: manifest.OPEN_ISSUES });
      const historyMatch = value.match(/\n\nHISTORY_SUMMARY\n([\s\S]*?)(?=\n\n(?:LAST_TOOL_RESULT|DOCUMENT_SUMMARY)\n|$)/);
      const resultMatch = value.match(/\n\nLAST_TOOL_RESULT\n([\s\S]*?)(?=\n\nDOCUMENT_SUMMARY\n|$)/);
      const documentMatch = value.match(/\n\nDOCUMENT_SUMMARY\n([\s\S]*)$/);
      add(rows, "history", historyMatch?.[1] || "");
      add(rows, "toolResults", resultMatch?.[1] || "");
      add(rows, "other", documentMatch?.[1] || "");
    } else if (index < messages.length - 1) {
      add(rows, "history", value);
    } else if (/^Proyecto:/m.test(value)) {
      // The live agent's final user message has stable, named blocks.
      let category = "project";
      for (const line of value.split(/\r?\n/)) {
        if (/^Archivos raiz:/.test(line)) category = "files";
        else if (/^INVENTARIO DEL CEREBRO/.test(line)) category = "other";
        else if (/^CEREBRO EDITCORE:/.test(line)) category = "brain";
        else if (/^DOCUMENTOS ADJUNTOS:/.test(line)) category = "other";
        else if (/^PROGRESO YA COMPLETADO/.test(line)) category = "checkpoints";
        else if (/^Tarea del usuario:/.test(line)) category = "task";
        else if (/^(Proyecto:|Permiso efectivo:|Conexiones disponibles:)/.test(line)) category = "project";
        add(rows, category, `${line}\n`);
      }
    } else {
      add(rows, "task", value);
    }
    fingerprints.push(digest(value));
    messageChars.push(value.length);
  });
  add(rows, "tools", tools);
  const toolText = text(tools);
  const systemLines = messages.filter((message) => message?.role === "system").flatMap((message) => content(message.content).split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const seenSystem = new Set();
  let duplicateSystemChars = 0;
  for (const line of systemLines) {
    const key = line.toLowerCase();
    if (seenSystem.has(key)) duplicateSystemChars += line.length;
    else seenSystem.add(key);
  }
  return {
    chars: rows,
    tokens: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, Math.ceil(value / 4)])),
    messageFingerprints: fingerprints,
    messageChars,
    toolFingerprint: digest(toolText),
    toolChars: toolText.length,
    duplicateSystemChars,
    requestFingerprint: digest({ messages, tools }),
  };
}

function redactError(error) {
  return String(error?.message || error || "").replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[REDACTED]").slice(0, 500);
}

class Phase1Audit {
  constructor(root) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, "phase1-events.jsonl");
    this.sequence = 0;
  }

  write(event) {
    fs.mkdirSync(this.root, { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), sequence: ++this.sequence, ...event })}\n`, "utf8");
  }

  request(input = {}) {
    const measured = breakdown(input.messages, input.tools);
    const event = {
      type: "llm_request",
      requestId: crypto.randomUUID(),
      taskId: String(input.taskId || ""),
      executionId: String(input.executionId || ""),
      segmentId: Number(input.segmentId) || 0,
      stepId: Number(input.stepId) || 0,
      stage: String(input.stage || "unknown"),
      provider: String(input.provider || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120),
      model: String(input.model || "").slice(0, 160),
      attempt: Number(input.attempt) || 1,
      contextChars: Object.values(measured.chars).reduce((sum, value) => sum + value, 0),
      contextTokensEstimate: tokens(JSON.stringify(input.messages || [])) + tokens(JSON.stringify(input.tools || [])),
      categories: measured.chars,
      categoryTokensEstimate: measured.tokens,
      messageFingerprints: measured.messageFingerprints,
      messageChars: measured.messageChars,
      toolFingerprint: measured.toolFingerprint,
      toolChars: measured.toolChars,
      duplicateSystemChars: measured.duplicateSystemChars,
      requestFingerprint: measured.requestFingerprint,
      startedAt: Date.now(),
    };
    this.write(event);
    return event;
  }

  response(request, input = {}) {
    const usage = input.usage || {};
    this.write({
      type: "llm_response",
      requestId: request.requestId,
      taskId: request.taskId,
      executionId: request.executionId,
      segmentId: request.segmentId,
      stepId: request.stepId,
      stage: request.stage,
      attempt: request.attempt,
      durationMs: Math.max(0, Date.now() - request.startedAt),
      ok: input.ok !== false,
      confirmedInputTokens: Number(usage.confirmed_input_tokens || usage.prompt_tokens || usage.input_tokens || 0),
      confirmedOutputTokens: Number(usage.confirmed_output_tokens || usage.completion_tokens || usage.output_tokens || 0),
      estimatedInputTokens: Number(usage.estimated_input_tokens || usage.request_input_tokens_estimate || 0),
      estimatedOutputTokens: Number(usage.estimated_output_tokens || 0),
      providerCacheReadTokens: Number(usage.provider_cache_read_tokens || usage.cached_tokens || 0),
      error: redactError(input.error),
    });
  }

  event(type, input = {}) {
    this.write({ type, ...input });
  }
}

module.exports = { Phase1Audit, breakdown, digest, tokens };
