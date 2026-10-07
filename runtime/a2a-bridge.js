"use strict";

/**
 * A2A BRIDGE — Punto único Fase 1 + Fase 2
 *
 * Combina:
 *  - PersistentMemoryV2 + TransactionalEngine  (Fase 1)
 *  - A2ATopology + protocolo de mensajes       (Fase 2)
 *
 * Uso desde agent-runtime / orchestrator:
 *
 *   const { getA2ABridge } = require("./a2a-bridge");
 *   const a2a = getA2ABridge(projectRoot);
 *   await a2a.init();
 *   a2a.startTask(userTask);
 *   // ... el agente activo usa a2a.getRolePrompt(role)
 *   a2a.handoff("explorer", "analyst", "mapa listo");
 *   a2a.emitFinding("analyst", "bug en auth.js:42");
 *   // al terminar:
 *   a2a.complete("Cambios verificados");
 */

const path = require("path");
const { getMemoryCheckpointBridge } = require("./memory-checkpoint-bridge");
const { A2ATopology, ROLES, MSG_TYPES, ROLE_DEFS, DEFAULT_PIPELINE } = require("./a2a-topology");
const { builders } = require("./a2a-protocol");

const instances = new Map();

class A2ABridge {
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.memoryBridge = getMemoryCheckpointBridge(this.projectRoot, options.memory || {});
    this.topology = new A2ATopology(this.projectRoot, {
      ...options.topology,
      bridge: this.memoryBridge,
    });
    this._ready = false;
  }

  async init() {
    await this.memoryBridge.init();
    this._ready = true;
    return this.status();
  }

  status() {
    return {
      memory: this.memoryBridge.status(),
      a2a: this.topology.status(),
      ready: this._ready,
    };
  }

  // ── Ciclo de vida de tarea ───────────────────

  /**
   * Arranca sesión A2A (+ opcionalmente un run del motor transaccional).
   * @param {string} task
   * @param {object} [options] - { pipeline, steps, threadId, runId }
   */
  startTask(task, options = {}) {
    const session = this.topology.startSession(task, {
      pipeline: options.pipeline || DEFAULT_PIPELINE,
      threadId: options.threadId,
      runId: options.runId,
      meta: options.meta || {},
    });

    // Si el caller aporta steps del motor transaccional, arrancarlo también
    if (Array.isArray(options.steps) && options.steps.length) {
      try {
        this.memoryBridge.startRun(task, options.steps, {
          source: "a2a",
          topologyId: session.id,
        });
      } catch (_) {}
    }

    this.memoryBridge.setCurrentTask(task);
    return session;
  }

  handoff(fromRole, toRole, reason = "") {
    return this.topology.handoff(fromRole, toRole, reason);
  }

  emitFinding(fromRole, text, extra) {
    return this.topology.emitFinding(fromRole, text, extra);
  }

  emitProposal(fromRole, proposal, extra) {
    return this.topology.emitProposal(fromRole, proposal, extra);
  }

  vote(fromRole, type, reason, weight) {
    return this.topology.voteOnProposal(fromRole, type, reason, weight);
  }

  resolveDebate(roleWeights) {
    return this.topology.resolveDebate(roleWeights);
  }

  emitResult(fromRole, result, extra) {
    return this.topology.emitResult(fromRole, result, extra);
  }

  async queryMemory(fromRole, query, extra) {
    return this.topology.queryMemory(fromRole, query, extra);
  }

  suggestedNextRole() {
    return this.topology.suggestedNextRole();
  }

  complete(summary = "") {
    const session = this.topology.complete(summary);
    // Cerrar también el run transaccional si está activo y completo
    try {
      const st = this.memoryBridge.status();
      if (st.checkpoint && st.checkpoint.status === "running") {
        // no forzar complete del engine aquí; el caller debe completeStep
      }
    } catch (_) {}
    return session;
  }

  abort(reason) {
    return this.topology.abort(reason);
  }

  // ── Prompts (cache-friendly) ─────────────────

  /**
   * Inyección completa para el system prompt del agente activo.
   * Orden: self-awareness + memoria estable → rol A2A → resume checkpoint → búsqueda dinámica.
   */
  getFullPrompt(role, userQuery = "") {
    const parts = [];

    // 1. Memoria + self-awareness (relativamente estático → bueno para cache)
    const mem = this.memoryBridge.getPromptContext(userQuery, { maxChars: 2500 });
    if (mem) parts.push(mem);

    // 2. Contexto de rol A2A
    if (this.topology.session) {
      parts.push(this.topology.getAgentPromptContext(role || this.topology.session.currentRole));
    } else {
      const def = ROLE_DEFS[role] || ROLE_DEFS[ROLES.SUPERVISOR];
      parts.push(`=== ROL: ${def.label} ===\n${def.description}`);
    }

    // 3. Resume de checkpoint (dinámico)
    const resume = this.memoryBridge.getResumePrompt();
    if (resume) parts.push(resume);

    return parts.filter(Boolean).join("\n\n");
  }

  getRolePrompt(role) {
    return this.getFullPrompt(role, "");
  }

  // ── Atajos de memoria / checkpoints ──────────

  get memory() {
    return this.memoryBridge;
  }

  assertComplete(content, label) {
    return this.memoryBridge.assertComplete(content, label);
  }

  beginStep(stepId) {
    return this.memoryBridge.beginStep(stepId);
  }

  completeStep(stepId, result) {
    return this.memoryBridge.completeStep(stepId, result);
  }

  failStep(stepId, error) {
    return this.memoryBridge.failStep(stepId, error);
  }

  nextPendingStep() {
    return this.memoryBridge.nextPendingStep();
  }

  canResume() {
    return this.memoryBridge.canResume();
  }

  async save() {
    return this.memoryBridge.saveMemory();
  }
}

function getA2ABridge(projectRoot, options = {}) {
  const key = path.resolve(projectRoot);
  if (!instances.has(key)) {
    instances.set(key, new A2ABridge(key, options));
  }
  return instances.get(key);
}

module.exports = {
  A2ABridge,
  getA2ABridge,
  ROLES,
  MSG_TYPES,
  ROLE_DEFS,
  DEFAULT_PIPELINE,
  builders,
};
