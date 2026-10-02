"use strict";
/**
 * editcore-chat-kernel/subagents/coordinator.js
 * Coordinador de subagentes con dependencias y feedback a la red.
 */

const { globalNetwork } = require("../agent-network");

const DEFAULT_TIMEOUT = 120_000;

class SubagentCoordinator {
  constructor({ network = globalNetwork } = {}) {
    this.network = network;
    this.tasks = new Map();
  }

  registerTask(id, { description, agent, deps = [], payload = {} }) {
    this.tasks.set(id, {
      id, description, agent, deps, payload,
      status: "pending", result: null,
      startedAt: null, finishedAt: null,
    });
  }

  getReadyTasks() {
    const ready = [];
    for (const t of this.tasks.values()) {
      if (t.status !== "pending") continue;
      const depsOk = t.deps.every((d) => {
        const dep = this.tasks.get(d);
        return dep && dep.status === "done";
      });
      if (depsOk) ready.push(t);
    }
    return ready;
  }

  async execute(taskId, handler) {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`coordinator: task ${taskId} no existe`);
    t.status = "running";
    t.startedAt = Date.now();
    try {
      const result = await Promise.race([
        handler(t),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${taskId}`)), DEFAULT_TIMEOUT)),
      ]);
      t.status = "done";
      t.result = result;
      t.finishedAt = Date.now();
      this.network.recordOutcome(t.agent, true);
      return result;
    } catch (err) {
      t.status = "failed";
      t.result = { error: String(err && err.message || err) };
      t.finishedAt = Date.now();
      this.network.recordOutcome(t.agent, false);
      throw err;
    }
  }

  status() {
    return [...this.tasks.values()].map((t) => ({
      id: t.id, agent: t.agent, status: t.status, deps: t.deps,
    }));
  }
}

module.exports = { SubagentCoordinator };