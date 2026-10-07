"use strict";

/**
 * A2A TOPOLOGY — Orquestación formal entre agentes (EditCoreAI Fase 2)
 *
 * - Roles canónicos (Supervisor, Explorer, Analyst, Implementer, Verifier, Memory)
 * - Grafo de ejecución dirigido acíclico (DAG) / máquina de estados
 * - Protocolo de mensajes A2A
 * - Debate / ponderación de propuestas (challenge → endorse/reject)
 * - Anti-bucle: límites de hops, visitas por nodo, timeout global
 * - Integración opcional con MemoryCheckpointBridge (Fase 1)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  ROLES,
  MSG_TYPES,
  PRIORITIES,
  createMessage,
  validateMessage,
  builders,
  PROTOCOL_VERSION,
} = require("./a2a-protocol");

const TOPOLOGY_VERSION = 1;
const DEFAULT_MAX_HOPS = 24;
const DEFAULT_MAX_VISITS_PER_ROLE = 6;
const DEFAULT_DEBATE_ROUNDS = 2;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min

// ─────────────────────────────────────────────
// Definición de roles y transiciones legales (DAG)
// ─────────────────────────────────────────────

const ROLE_DEFS = Object.freeze({
  [ROLES.SUPERVISOR]: {
    label: "Supervisor/Router",
    description: "Clasifica la tarea, asigna roles, decide handoffs y cierra el run",
    canEmit: [MSG_TYPES.TASK_ASSIGN, MSG_TYPES.HANDOFF, MSG_TYPES.ABORT, MSG_TYPES.CHECKPOINT],
    nextRoles: [ROLES.EXPLORER, ROLES.ANALYST, ROLES.IMPLEMENTER, ROLES.VERIFIER, ROLES.MEMORY, ROLES.SPECIALIST],
  },
  [ROLES.EXPLORER]: {
    label: "Explorador",
    description: "Mapea estructura, localiza archivos, no edita",
    canEmit: [MSG_TYPES.FINDING, MSG_TYPES.TASK_RESULT, MSG_TYPES.QUERY_MEMORY, MSG_TYPES.HANDOFF],
    nextRoles: [ROLES.ANALYST, ROLES.IMPLEMENTER, ROLES.SUPERVISOR, ROLES.MEMORY],
  },
  [ROLES.ANALYST]: {
    label: "Analista",
    description: "Lee código, diagnostica, propone planes sin escribir aún",
    canEmit: [MSG_TYPES.FINDING, MSG_TYPES.PROPOSAL, MSG_TYPES.TASK_RESULT, MSG_TYPES.QUERY_MEMORY, MSG_TYPES.CHALLENGE],
    nextRoles: [ROLES.IMPLEMENTER, ROLES.VERIFIER, ROLES.SUPERVISOR, ROLES.MEMORY],
  },
  [ROLES.IMPLEMENTER]: {
    label: "Implementador",
    description: "Escribe/edita código, aplica patches, ejecuta comandos de cambio",
    canEmit: [MSG_TYPES.TASK_RESULT, MSG_TYPES.FINDING, MSG_TYPES.PROPOSAL, MSG_TYPES.HANDOFF],
    nextRoles: [ROLES.VERIFIER, ROLES.ANALYST, ROLES.SUPERVISOR],
  },
  [ROLES.VERIFIER]: {
    label: "Verificador/QA",
    description: "Ejecuta tests, linter, valida resultados, puede rechazar propuestas",
    canEmit: [MSG_TYPES.TASK_RESULT, MSG_TYPES.ENDORSE, MSG_TYPES.REJECT, MSG_TYPES.CHALLENGE, MSG_TYPES.FINDING],
    nextRoles: [ROLES.IMPLEMENTER, ROLES.SUPERVISOR, ROLES.ANALYST],
  },
  [ROLES.MEMORY]: {
    label: "Gestor de Memoria",
    description: "Recupera y persiste conocimiento; responde QUERY_MEMORY",
    canEmit: [MSG_TYPES.MEMORY_REPLY, MSG_TYPES.FINDING],
    nextRoles: [ROLES.SUPERVISOR, ROLES.ANALYST, ROLES.EXPLORER],
  },
  [ROLES.SPECIALIST]: {
    label: "Especialista",
    description: "UI/UX, Database, Security, DevOps u otro dominio estrecho",
    canEmit: [MSG_TYPES.PROPOSAL, MSG_TYPES.TASK_RESULT, MSG_TYPES.FINDING, MSG_TYPES.HANDOFF],
    nextRoles: [ROLES.IMPLEMENTER, ROLES.VERIFIER, ROLES.SUPERVISOR],
  },
});

/**
 * Transiciones por defecto según fase de la tarea (máquina de estados simple).
 * Supervisor puede saltar según la clasificación real.
 */
const DEFAULT_PIPELINE = [
  ROLES.SUPERVISOR,
  ROLES.EXPLORER,
  ROLES.ANALYST,
  ROLES.IMPLEMENTER,
  ROLES.VERIFIER,
  ROLES.SUPERVISOR, // cierre
];

function generateTopologyId() {
  return `topo_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ─────────────────────────────────────────────
// Bus de mensajes en memoria + persistencia opcional
// ─────────────────────────────────────────────

class A2AMessageBus {
  constructor(options = {}) {
    this.inbox = []; // cola prioritaria simple
    this.history = [];
    this.maxHistory = options.maxHistory || 200;
    this.listeners = new Map(); // role -> Set<fn>
  }

  publish(msg) {
    const v = validateMessage(msg);
    if (!v.ok) throw new Error(`A2A bus: mensaje inválido — ${v.error}`);
    this.inbox.push(v.message);
    this.inbox.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    this.history.push(v.message);
    if (this.history.length > this.maxHistory) this.history.shift();

    // Notificar listeners del destinatario o de SUPERVISOR si broadcast
    const targets = msg.to ? [msg.to] : [ROLES.SUPERVISOR];
    for (const t of targets) {
      const set = this.listeners.get(t);
      if (set) for (const fn of set) {
        try { fn(v.message); } catch (_) { /* no tumbar el bus */ }
      }
    }
    return v.message;
  }

  subscribe(role, handler) {
    if (!this.listeners.has(role)) this.listeners.set(role, new Set());
    this.listeners.get(role).add(handler);
    return () => this.listeners.get(role).delete(handler);
  }

  drainFor(role, limit = 20) {
    const out = [];
    const rest = [];
    for (const m of this.inbox) {
      if (out.length >= limit) {
        rest.push(m);
        continue;
      }
      if (m.to === role || (m.to === null && role === ROLES.SUPERVISOR)) {
        out.push(m);
      } else {
        rest.push(m);
      }
    }
    this.inbox = rest;
    return out;
  }

  peekHistory(limit = 30) {
    return this.history.slice(-limit);
  }

  clear() {
    this.inbox = [];
  }
}

// ─────────────────────────────────────────────
// Debate / ponderación de propuestas
// ─────────────────────────────────────────────

class DebateSession {
  constructor(proposalMsg, options = {}) {
    this.proposalId = proposalMsg.id;
    this.proposal = proposalMsg;
    this.rounds = options.maxRounds || DEFAULT_DEBATE_ROUNDS;
    this.votes = []; // { from, type, reason, weight, at }
    this.closed = false;
    this.decision = null; // accept | reject | revise
  }

  addVote(from, type, reason = "", weight = 1) {
    if (this.closed) return;
    if (![MSG_TYPES.ENDORSE, MSG_TYPES.REJECT, MSG_TYPES.CHALLENGE].includes(type)) {
      throw new Error("Debate solo acepta endorse/reject/challenge");
    }
    this.votes.push({
      from,
      type,
      reason: String(reason).slice(0, 1500),
      weight: Number(weight) || 1,
      at: Date.now(),
    });
  }

  /**
   * Ponderación simple:
   *  - endorse = +weight
   *  - reject  = -weight * 1.2
   *  - challenge = -weight * 0.5 (pide revisión)
   * Verifier tiene peso base 1.3; Analyst 1.1; resto 1.0
   */
  resolve(roleWeights = {}) {
    if (this.closed) return this.decision;
    let score = this.proposal.payload?.confidence ?? 0.5;
    const defaults = {
      [ROLES.VERIFIER]: 1.3,
      [ROLES.ANALYST]: 1.1,
      [ROLES.SUPERVISOR]: 1.4,
      [ROLES.IMPLEMENTER]: 0.9,
      [ROLES.EXPLORER]: 0.8,
      [ROLES.MEMORY]: 0.7,
      [ROLES.SPECIALIST]: 1.0,
    };
    const weights = { ...defaults, ...roleWeights };

    for (const v of this.votes) {
      const w = (weights[v.from] || 1) * v.weight;
      if (v.type === MSG_TYPES.ENDORSE) score += 0.25 * w;
      else if (v.type === MSG_TYPES.REJECT) score -= 0.35 * w;
      else if (v.type === MSG_TYPES.CHALLENGE) score -= 0.15 * w;
    }

    if (score >= 0.65) this.decision = "accept";
    else if (score <= 0.35) this.decision = "reject";
    else this.decision = "revise";

    this.closed = true;
    this.finalScore = Math.max(0, Math.min(1, score));
    return this.decision;
  }

  summary() {
    return {
      proposalId: this.proposalId,
      title: this.proposal.payload?.title,
      votes: this.votes.length,
      decision: this.decision,
      finalScore: this.finalScore,
      closed: this.closed,
    };
  }
}

// ─────────────────────────────────────────────
// Topología / Orquestador
// ─────────────────────────────────────────────

class A2ATopology {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   * @param {object} [options.bridge] - instancia de MemoryCheckpointBridge (Fase 1)
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot || ".");
    this.bus = new A2AMessageBus(options.bus || {});
    this.bridge = options.bridge || null;
    this.maxHops = options.maxHops || DEFAULT_MAX_HOPS;
    this.maxVisitsPerRole = options.maxVisitsPerRole || DEFAULT_MAX_VISITS_PER_ROLE;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.stateDir = path.join(this.projectRoot, ".editcore", "a2a");

    this.session = null; // estado vivo
  }

  /**
   * Inicia una sesión de topología para una tarea.
   */
  startSession(task, options = {}) {
    const id = generateTopologyId();
    const pipeline = options.pipeline || DEFAULT_PIPELINE.slice();
    this.session = {
      id,
      task: String(task || "").slice(0, 3000),
      createdAt: Date.now(),
      status: "running", // running | completed | failed | aborted
      pipeline,
      currentRole: ROLES.SUPERVISOR,
      hopCount: 0,
      visits: {}, // role -> count
      activeDebate: null,
      debates: [],
      findings: [],
      proposals: [],
      results: [],
      history: [],
      startedAt: new Date().toISOString(),
      meta: options.meta || {},
    };
    this.session.visits[ROLES.SUPERVISOR] = 1;
    this._persistSession();

    // Mensaje inicial del supervisor
    const assign = builders.taskAssign(ROLES.SUPERVISOR, ROLES.EXPLORER, task, {
      meta: { threadId: options.threadId || "default", runId: options.runId || null },
    });
    this.bus.publish(assign);
    this._log("session_start", { id, task: this.session.task.slice(0, 120) });
    return this.session;
  }

  /**
   * Transición de rol (respeta DAG + anti-bucle).
   */
  handoff(fromRole, toRole, reason = "") {
    this._assertSession();
    const def = ROLE_DEFS[fromRole];
    if (!def) throw new Error(`Rol desconocido: ${fromRole}`);
    if (!ROLE_DEFS[toRole]) throw new Error(`Rol destino desconocido: ${toRole}`);

    // Anti-bucle
    this.session.hopCount += 1;
    if (this.session.hopCount > this.maxHops) {
      this.session.status = "aborted";
      this.bus.publish(builders.abort(fromRole, `Máximo de hops (${this.maxHops}) alcanzado`));
      this._persistSession();
      throw new Error(`A2A: anti-bucle — max hops ${this.maxHops}`);
    }
    this.session.visits[toRole] = (this.session.visits[toRole] || 0) + 1;
    if (this.session.visits[toRole] > this.maxVisitsPerRole) {
      this.session.status = "aborted";
      this.bus.publish(builders.abort(fromRole, `Rol ${toRole} visitado demasiadas veces`));
      this._persistSession();
      throw new Error(`A2A: anti-bucle — rol ${toRole} excedió visitas`);
    }

    // Transición legal (aviso si no está en nextRoles, pero Supervisor puede forzar)
    if (fromRole !== ROLES.SUPERVISOR && def.nextRoles && !def.nextRoles.includes(toRole)) {
      this._log("warn_illegal_transition", { from: fromRole, to: toRole });
    }

    const msg = builders.handoff(fromRole, toRole, reason, {
      threadId: this.session.meta.threadId,
      runId: this.session.meta.runId,
    });
    this.bus.publish(msg);
    this.session.currentRole = toRole;
    this._log("handoff", { from: fromRole, to: toRole, reason: reason.slice(0, 100) });
    this._persistSession();
    return msg;
  }

  /**
   * Publica un finding y lo registra en sesión + memoria (si hay bridge).
   */
  emitFinding(fromRole, text, extra = {}) {
    this._assertSession();
    const msg = builders.finding(fromRole, text, extra);
    this.bus.publish(msg);
    this.session.findings.push({ from: fromRole, text: text.slice(0, 600), at: Date.now() });
    if (this.bridge && typeof this.bridge.addKnowledge === "function") {
      try {
        this.bridge.addKnowledge(text, `a2a:${fromRole}`, { tags: ["finding", fromRole] });
      } catch (_) {}
    }
    this._persistSession();
    return msg;
  }

  /**
   * Publica una propuesta y abre sesión de debate.
   */
  emitProposal(fromRole, proposal, extra = {}) {
    this._assertSession();
    const msg = builders.proposal(fromRole, proposal, extra);
    this.bus.publish(msg);
    this.session.proposals.push(msg);
    this.session.activeDebate = new DebateSession(msg, { maxRounds: extra.maxRounds });
    this._log("proposal", { from: fromRole, title: proposal.title });
    this._persistSession();
    return msg;
  }

  /**
   * Voto en el debate activo.
   */
  voteOnProposal(fromRole, type, reason = "", weight = 1) {
    this._assertSession();
    if (!this.session.activeDebate) throw new Error("No hay debate activo");
    this.session.activeDebate.addVote(fromRole, type, reason, weight);

    // Publicar mensaje A2A correspondiente
    const targetId = this.session.activeDebate.proposalId;
    let msg;
    if (type === MSG_TYPES.ENDORSE) msg = builders.endorse(fromRole, targetId, reason);
    else if (type === MSG_TYPES.REJECT) msg = builders.reject(fromRole, targetId, reason);
    else msg = builders.challenge(fromRole, targetId, reason);
    this.bus.publish(msg);
    this._persistSession();
    return msg;
  }

  /**
   * Cierra el debate y devuelve la decisión ponderada.
   */
  resolveDebate(roleWeights) {
    this._assertSession();
    if (!this.session.activeDebate) return null;
    const decision = this.session.activeDebate.resolve(roleWeights);
    const summary = this.session.activeDebate.summary();
    this.session.debates.push(summary);
    this.session.activeDebate = null;
    this._log("debate_resolved", summary);
    this._persistSession();
    return summary;
  }

  /**
   * Registra resultado de un agente.
   */
  emitResult(fromRole, result, extra = {}) {
    this._assertSession();
    const msg = builders.taskResult(fromRole, result, {
      ...extra,
      runId: this.session.meta.runId,
    });
    this.bus.publish(msg);
    this.session.results.push({
      from: fromRole,
      success: result.success !== false,
      summary: result.summary,
      confidence: result.confidence,
      at: Date.now(),
    });
    this._persistSession();
    return msg;
  }

  /**
   * Consulta memoria vía bridge (si existe) y publica MEMORY_REPLY.
   */
  async queryMemory(fromRole, query, extra = {}) {
    this._assertSession();
    const qMsg = builders.queryMemory(fromRole, query, extra);
    this.bus.publish(qMsg);

    let results = { results: [], injectedText: "" };
    if (this.bridge && typeof this.bridge.search === "function") {
      results = this.bridge.search(query, { limit: extra.limit || 10 });
    }

    const reply = builders.memoryReply(ROLES.MEMORY, results, {
      to: fromRole,
      correlationId: qMsg.id,
      replyTo: qMsg.id,
    });
    this.bus.publish(reply);
    return reply;
  }

  /**
   * Siguiente rol sugerido según pipeline o estado.
   */
  suggestedNextRole() {
    this._assertSession();
    const cur = this.session.currentRole;
    const pipe = this.session.pipeline;
    const idx = pipe.lastIndexOf(cur);
    if (idx >= 0 && idx < pipe.length - 1) return pipe[idx + 1];
    // Heurística por resultados
    if (cur === ROLES.EXPLORER) return ROLES.ANALYST;
    if (cur === ROLES.ANALYST) return ROLES.IMPLEMENTER;
    if (cur === ROLES.IMPLEMENTER) return ROLES.VERIFIER;
    if (cur === ROLES.VERIFIER) return ROLES.SUPERVISOR;
    return ROLES.SUPERVISOR;
  }

  /**
   * Cierra la sesión.
   */
  complete(summary = "") {
    this._assertSession();
    this.session.status = "completed";
    this.session.completedAt = new Date().toISOString();
    this.session.closeSummary = String(summary).slice(0, 2000);
    if (this.bridge && typeof this.bridge.addConversation === "function") {
      try {
        this.bridge.addConversation(
          `A2A ${this.session.id}: ${this.session.task.slice(0, 200)} → ${summary.slice(0, 300)}`,
          {
            completed: true,
            stepsExecuted: this.session.hopCount,
            tags: ["a2a", "completed"],
          }
        );
      } catch (_) {}
    }
    this._log("session_complete", { id: this.session.id });
    this._persistSession();
    return this.session;
  }

  abort(reason = "aborted") {
    if (!this.session) return null;
    this.session.status = "aborted";
    this.bus.publish(builders.abort(this.session.currentRole || ROLES.SUPERVISOR, reason));
    this._persistSession();
    return this.session;
  }

  /**
   * Contexto listo para inyectar en el prompt del agente activo (cache-friendly).
   */
  getAgentPromptContext(role) {
    this._assertSession();
    const def = ROLE_DEFS[role] || ROLE_DEFS[ROLES.SUPERVISOR];
    const lines = [
      `=== ROL A2A ACTIVO: ${def.label} (${role}) ===`,
      `Descripción: ${def.description}`,
      `Tarea de sesión: ${this.session.task}`,
      `Hop: ${this.session.hopCount}/${this.maxHops} | Visitas a este rol: ${this.session.visits[role] || 0}/${this.maxVisitsPerRole}`,
      `Siguiente rol sugerido: ${this.suggestedNextRole()}`,
    ];

    if (this.session.findings.length) {
      lines.push("[HALLAZGOS RECIENTES]");
      for (const f of this.session.findings.slice(-6)) {
        lines.push(`• [${f.from}] ${f.text}`);
      }
    }

    if (this.session.activeDebate) {
      const d = this.session.activeDebate;
      lines.push(`[DEBATE ABIERTO] propuesta="${d.proposal.payload?.title}" votos=${d.votes.length}`);
    }

    const recent = this.bus.peekHistory(8);
    if (recent.length) {
      lines.push("[MENSAJES A2A RECIENTES]");
      for (const m of recent) {
        lines.push(`• ${m.from}→${m.to || "*"} ${m.type}`);
      }
    }

    lines.push("REGLAS: Respeta el rol. No saltes al implementer sin análisis si la tarea es compleja. Usa handoff formal. No dejes código incompleto.");
    return lines.join("\n");
  }

  status() {
    if (!this.session) return { active: false };
    return {
      active: true,
      id: this.session.id,
      status: this.session.status,
      currentRole: this.session.currentRole,
      hopCount: this.session.hopCount,
      visits: { ...this.session.visits },
      findings: this.session.findings.length,
      proposals: this.session.proposals.length,
      debates: this.session.debates.length,
      results: this.session.results.length,
      pipeline: this.session.pipeline,
    };
  }

  // ── internos ────────────────────────────────

  _assertSession() {
    if (!this.session || this.session.status === "aborted") {
      throw new Error("A2A: no hay sesión activa");
    }
  }

  _log(event, data = {}) {
    if (!this.session) return;
    this.session.history.push({ at: Date.now(), event, ...data });
    if (this.session.history.length > 100) this.session.history.shift();
  }

  _persistSession() {
    if (!this.session) return;
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const file = path.join(this.stateDir, `${this.session.id}.json`);
      // DebateSession no es JSON-serializable tal cual → snapshot
      const snap = {
        ...this.session,
        activeDebate: this.session.activeDebate
          ? {
              proposalId: this.session.activeDebate.proposalId,
              votes: this.session.activeDebate.votes,
              closed: this.session.activeDebate.closed,
              decision: this.session.activeDebate.decision,
            }
          : null,
      };
      atomicWrite(file, JSON.stringify(snap, null, 2));
      atomicWrite(
        path.join(this.stateDir, "LATEST.json"),
        JSON.stringify({ id: this.session.id, status: this.session.status, updatedAt: new Date().toISOString() }, null, 2)
      );
    } catch (_) {}
  }
}

module.exports = {
  A2ATopology,
  A2AMessageBus,
  DebateSession,
  ROLE_DEFS,
  DEFAULT_PIPELINE,
  ROLES,
  MSG_TYPES,
  createTopology: (projectRoot, options) => new A2ATopology(projectRoot, options),
};
