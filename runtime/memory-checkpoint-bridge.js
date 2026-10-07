"use strict";

/**
 * Bridge de integración: PersistentMemoryV2 + TransactionalEngine
 * Punto único para que agent-runtime / chat-kernel usen las nuevas capas
 * sin romper el código existente.
 *
 * Uso típico desde agent-runtime.js:
 *
 *   const { getMemoryCheckpointBridge } = require("./memory-checkpoint-bridge");
 *   const bridge = getMemoryCheckpointBridge(projectRoot);
 *   await bridge.init();
 *   const ctx = bridge.getPromptContext(userQuery);
 *   // ... plan steps ...
 *   bridge.startRun(task, steps);
 *   // por cada step:
 *   bridge.beginStep(id);
 *   // ... trabajo ...
 *   bridge.completeStep(id, { summary, artifacts });
 */

const path = require("path");
const { PersistentMemoryV2 } = require("./persistent-memory-v2");
const { TransactionalEngine } = require("./transactional-engine");

const bridges = new Map(); // projectRoot -> bridge instance

class MemoryCheckpointBridge {
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.memory = new PersistentMemoryV2(this.projectRoot, options.memory || {});
    this.engine = new TransactionalEngine(this.projectRoot, options.engine || {});
    this._ready = false;
  }

  async init() {
    await this.memory.load();
    if (!this.memory.longTerm.selfAwareness) {
      await this.memory.buildSelfAwareness();
    }
    // Reanudar run incompleto si existe
    this.engine.loadLatest();
    this._ready = true;
    return this.status();
  }

  status() {
    return {
      memory: this.memory.snapshot(),
      checkpoint: this.engine.current
        ? {
            runId: this.engine.current.runId,
            status: this.engine.current.status,
            task: this.engine.current.task,
            progress: `${this.engine.current.steps.filter((s) => s.status === "done").length}/${this.engine.current.steps.length}`,
          }
        : null,
      canResume: this.engine.canResume(),
    };
  }

  // ── Memoria ──────────────────────────────────

  getPromptContext(query = "", options = {}) {
    return this.memory.getPromptContext(query, options);
  }

  getResumePrompt() {
    return this.engine.getResumePrompt();
  }

  /**
   * Contexto completo listo para el system prompt (cache-friendly).
   * Estático primero, dinámico (resume + search) al final.
   */
  getFullSystemInjection(userQuery = "") {
    const parts = [];
    const mem = this.memory.getPromptContext(userQuery, { maxChars: 2800 });
    if (mem) parts.push(mem);
    const resume = this.engine.getResumePrompt();
    if (resume) parts.push(resume);
    return parts.join("\n\n");
  }

  addConversation(summary, meta) {
    return this.memory.addConversation(summary, meta);
  }

  addFile(filePath, action, meta) {
    return this.memory.addFile(filePath, action, meta);
  }

  addDecision(decision, reasoning, meta) {
    return this.memory.addDecision(decision, reasoning, meta);
  }

  addPattern(pattern, description, meta) {
    return this.memory.addPattern(pattern, description, meta);
  }

  addKnowledge(fact, source, meta) {
    return this.memory.addKnowledge(fact, source, meta);
  }

  search(query, options) {
    return this.memory.search(query, options);
  }

  setCurrentTask(task) {
    this.memory.setCurrentTask(task);
  }

  async saveMemory() {
    return this.memory.save(true);
  }

  // ── Checkpoints / Engine ─────────────────────

  startRun(task, steps, meta = {}) {
    this.memory.setCurrentTask(task);
    return this.engine.createRun(task, steps, meta);
  }

  beginStep(stepId) {
    return this.engine.beginStep(stepId);
  }

  completeStep(stepId, result = {}) {
    const cp = this.engine.completeStep(stepId, result);
    // Registrar en memoria los archivos tocados
    if (result.artifacts) {
      for (const rel of result.artifacts) {
        this.memory.addFile(rel, "write", { summary: result.summary || "" });
      }
    }
    return cp;
  }

  failStep(stepId, error) {
    return this.engine.failStep(stepId, error);
  }

  nextPendingStep() {
    return this.engine.nextPendingStep();
  }

  canResume() {
    return this.engine.canResume();
  }

  listCheckpoints(limit) {
    return this.engine.listCheckpoints(limit);
  }

  abortRun(reason) {
    return this.engine.abort(reason);
  }

  /**
   * Helper: valida que un contenido de archivo esté completo antes de escribir.
   */
  assertComplete(content, label = "file") {
    if (TransactionalEngine.looksIncomplete(content)) {
      throw new Error(
        `[TransactionalEngine] Contenido incompleto rechazado (${label}). ` +
          `No se permiten TODOs de implementación ni código truncado.`
      );
    }
  }
}

/**
 * Singleton por projectRoot (evita múltiples instancias en la misma sesión).
 */
function getMemoryCheckpointBridge(projectRoot, options = {}) {
  const key = path.resolve(projectRoot);
  if (!bridges.has(key)) {
    bridges.set(key, new MemoryCheckpointBridge(key, options));
  }
  return bridges.get(key);
}

module.exports = {
  MemoryCheckpointBridge,
  getMemoryCheckpointBridge,
  PersistentMemoryV2: require("./persistent-memory-v2").PersistentMemoryV2,
  TransactionalEngine: require("./transactional-engine").TransactionalEngine,
};
