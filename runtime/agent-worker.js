"use strict";

const crypto = require("node:crypto");

class AgentWorker {
  constructor({ manager, taskId, runId, durableRunId, workerId, heartbeatMs = 5000, onCancel, execute } = {}) {
    if (!manager || !taskId || !runId || typeof execute !== "function") throw new Error("AgentWorker requiere estado y ejecutor.");
    this.manager = manager;
    this.taskId = taskId;
    this.runId = runId;
    this.durableRunId = durableRunId || runId;
    this.workerId = workerId || `worker_${crypto.randomUUID()}`;
    this.heartbeatMs = Math.max(1000, Number(heartbeatMs) || 5000);
    this.onCancel = onCancel;
    this.execute = execute;
    this.startedAt = Date.now();
    this.lastHeartbeatAt = this.startedAt;
    this.timer = null;
    this.cancelled = false;
    this.stallReported = false;
  }

  event(type, metadata = {}) {
    this.lastHeartbeatAt = Date.now();
    return this.manager.recordRuntimeEvent(this.taskId, type, { runId: this.durableRunId, metadata: { workerId: this.workerId, publicRunId: this.runId, ...metadata } });
  }

  startHeartbeat() {
    this.event("WORKER_STARTED", { startedAt: new Date(this.startedAt).toISOString() });
    this.timer = setInterval(() => this.event("WORKER_HEARTBEAT", { ageMs: Date.now() - this.startedAt }), this.heartbeatMs);
    this.timer.unref?.();
  }

  cancel(reason = "Cancelada por el usuario.") {
    this.cancelled = true;
    this.event("WORKER_STOP_REQUESTED", { reason });
    return typeof this.onCancel === "function" ? this.onCancel(reason) : false;
  }

  async run() {
    this.startHeartbeat();
    try {
      const result = await this.execute();
      this.event("WORKER_COMPLETED", { completed: Boolean(result?.report?.completed) });
      return result;
    } catch (error) {
      this.event("WORKER_FAILED", { error: String(error?.message || error).slice(0, 500) });
      throw error;
    } finally {
      if (this.timer) clearInterval(this.timer);
      this.event("WORKER_STOPPED", { durationMs: Date.now() - this.startedAt });
    }
  }
}

module.exports = { AgentWorker };
