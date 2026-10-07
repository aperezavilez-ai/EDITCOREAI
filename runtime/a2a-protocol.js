"use strict";

/**
 * A2A PROTOCOL — Agent-to-Agent communication (EditCoreAI Fase 2)
 *
 * Envelope formal de mensajes entre agentes.
 * Tipos de mensaje, prioridades, correlaciones y validación.
 *
 * Diseño cache-friendly: el schema es estático; el payload dinámico va al final.
 */

const crypto = require("crypto");

const PROTOCOL_VERSION = "2.0";

/** Roles canónicos del sistema */
const ROLES = Object.freeze({
  SUPERVISOR: "supervisor",       // Router / orquestador
  EXPLORER: "explorer",           // Lector de estructura
  ANALYST: "analyst",             // Análisis profundo
  IMPLEMENTER: "implementer",     // Escritor / programador
  VERIFIER: "verifier",           // QA / revisor
  MEMORY: "memory",               // Gestor de memoria
  SPECIALIST: "specialist",       // Especialista (UI, DB, Security, DevOps…)
});

/** Tipos de mensaje A2A */
const MSG_TYPES = Object.freeze({
  TASK_ASSIGN: "task_assign",         // Supervisor → agente
  TASK_RESULT: "task_result",         // Agente → Supervisor
  FINDING: "finding",                 // Hallazgo intermedio
  PROPOSAL: "proposal",               // Propuesta de cambio / plan
  CHALLENGE: "challenge",             // Debate: cuestiona una propuesta
  ENDORSE: "endorse",                 // Debate: apoya una propuesta
  REJECT: "reject",                   // Debate: rechaza
  QUERY_MEMORY: "query_memory",       // → Memory
  MEMORY_REPLY: "memory_reply",       // Memory →
  CHECKPOINT: "checkpoint",           // Estado de progreso
  HANDOFF: "handoff",                 // Transferencia de control
  ABORT: "abort",                     // Cancelación
  HEARTBEAT: "heartbeat",
});

const PRIORITIES = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
});

function generateMsgId() {
  return `a2a_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Crea un envelope A2A válido.
 * @param {object} opts
 * @returns {object} message
 */
function createMessage(opts = {}) {
  const {
    type,
    from,
    to = null,           // null = broadcast al supervisor / bus
    payload = {},
    correlationId = null,
    replyTo = null,
    priority = PRIORITIES.NORMAL,
    threadId = "default",
    runId = null,
    stepId = null,
    ttlMs = 300_000,     // 5 min
  } = opts;

  if (!type || !MSG_TYPES[Object.keys(MSG_TYPES).find((k) => MSG_TYPES[k] === type)]) {
    // permitir type string conocido
    if (!Object.values(MSG_TYPES).includes(type)) {
      throw new Error(`A2A: tipo de mensaje desconocido: ${type}`);
    }
  }
  if (!from) throw new Error("A2A: 'from' (rol emisor) es obligatorio");

  const now = Date.now();
  return {
    v: PROTOCOL_VERSION,
    id: generateMsgId(),
    type,
    from: String(from),
    to: to ? String(to) : null,
    threadId: String(threadId || "default"),
    runId: runId || null,
    stepId: stepId || null,
    correlationId: correlationId || null,
    replyTo: replyTo || null,
    priority: Number(priority) || PRIORITIES.NORMAL,
    createdAt: now,
    expiresAt: now + (ttlMs || 300_000),
    payload: payload && typeof payload === "object" ? payload : { value: payload },
  };
}

/**
 * Valida un mensaje recibido.
 * @returns {{ ok: boolean, error?: string, message?: object }}
 */
function validateMessage(msg) {
  if (!msg || typeof msg !== "object") return { ok: false, error: "mensaje nulo" };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: `versión protocolo ${msg.v} no soportada` };
  if (!msg.id || !msg.type || !msg.from) return { ok: false, error: "campos obligatorios faltantes" };
  if (!Object.values(MSG_TYPES).includes(msg.type)) return { ok: false, error: `tipo inválido: ${msg.type}` };
  if (msg.expiresAt && Date.now() > msg.expiresAt) return { ok: false, error: "mensaje expirado" };
  return { ok: true, message: msg };
}

/**
 * Helpers de construcción rápida por tipo.
 */
const builders = {
  taskAssign(from, to, task, extra = {}) {
    return createMessage({
      type: MSG_TYPES.TASK_ASSIGN,
      from,
      to,
      payload: { task: String(task).slice(0, 4000), ...extra },
      priority: PRIORITIES.HIGH,
      ...extra.meta,
    });
  },
  taskResult(from, result, extra = {}) {
    return createMessage({
      type: MSG_TYPES.TASK_RESULT,
      from,
      to: ROLES.SUPERVISOR,
      payload: {
        success: result.success !== false,
        summary: String(result.summary || "").slice(0, 3000),
        artifacts: result.artifacts || [],
        findings: result.findings || [],
        confidence: result.confidence ?? 0.7,
        ...extra,
      },
      correlationId: extra.correlationId || null,
      runId: extra.runId,
      stepId: extra.stepId,
    });
  },
  finding(from, text, extra = {}) {
    return createMessage({
      type: MSG_TYPES.FINDING,
      from,
      payload: { text: String(text).slice(0, 2000), severity: extra.severity || "info", file: extra.file || null },
      ...extra,
    });
  },
  proposal(from, proposal, extra = {}) {
    return createMessage({
      type: MSG_TYPES.PROPOSAL,
      from,
      payload: {
        title: String(proposal.title || "").slice(0, 300),
        description: String(proposal.description || "").slice(0, 3000),
        changes: proposal.changes || [],
        confidence: proposal.confidence ?? 0.6,
      },
      priority: PRIORITIES.HIGH,
      ...extra,
    });
  },
  challenge(from, targetMsgId, reason, extra = {}) {
    return createMessage({
      type: MSG_TYPES.CHALLENGE,
      from,
      payload: { targetMsgId, reason: String(reason).slice(0, 2000) },
      replyTo: targetMsgId,
      priority: PRIORITIES.HIGH,
      ...extra,
    });
  },
  endorse(from, targetMsgId, reason = "", extra = {}) {
    return createMessage({
      type: MSG_TYPES.ENDORSE,
      from,
      payload: { targetMsgId, reason: String(reason).slice(0, 1000) },
      replyTo: targetMsgId,
      ...extra,
    });
  },
  reject(from, targetMsgId, reason, extra = {}) {
    return createMessage({
      type: MSG_TYPES.REJECT,
      from,
      payload: { targetMsgId, reason: String(reason).slice(0, 2000) },
      replyTo: targetMsgId,
      priority: PRIORITIES.HIGH,
      ...extra,
    });
  },
  queryMemory(from, query, extra = {}) {
    return createMessage({
      type: MSG_TYPES.QUERY_MEMORY,
      from,
      to: ROLES.MEMORY,
      payload: { query: String(query).slice(0, 1000), limit: extra.limit || 10 },
      ...extra,
    });
  },
  memoryReply(from, results, extra = {}) {
    return createMessage({
      type: MSG_TYPES.MEMORY_REPLY,
      from: ROLES.MEMORY,
      to: extra.to || null,
      payload: { results, injectedText: results?.injectedText || "" },
      correlationId: extra.correlationId,
      replyTo: extra.replyTo,
    });
  },
  handoff(from, to, reason, extra = {}) {
    return createMessage({
      type: MSG_TYPES.HANDOFF,
      from,
      to,
      payload: { reason: String(reason).slice(0, 1000), context: extra.context || {} },
      priority: PRIORITIES.HIGH,
      ...extra,
    });
  },
  abort(from, reason, extra = {}) {
    return createMessage({
      type: MSG_TYPES.ABORT,
      from,
      payload: { reason: String(reason).slice(0, 1000) },
      priority: PRIORITIES.CRITICAL,
      ...extra,
    });
  },
};

module.exports = {
  PROTOCOL_VERSION,
  ROLES,
  MSG_TYPES,
  PRIORITIES,
  createMessage,
  validateMessage,
  generateMsgId,
  builders,
};
