"use strict";

const { TokenGovernor } = require("./token-governor");
const { AgentWorker } = require("./agent-worker");

class WorkerSupervisor {
  constructor({ manager, heartbeatTimeoutMs = 30000, governor = new TokenGovernor() } = {}) {
    if (!manager) throw new Error("WorkerSupervisor requiere TaskManager.");
    this.manager = manager;
    this.heartbeatTimeoutMs = Math.max(5000, Number(heartbeatTimeoutMs) || 30000);
    this.governor = governor;
    this.workers = new Map();
    this.runContexts = new Map();
  }

  key(senderId, runId) { return `${senderId}:${runId}`; }

  registerRunContext(senderId, runId, context = {}) {
    this.runContexts.set(this.key(senderId, runId), context);
  }

  unregisterRunContext(senderId, runId) {
    this.runContexts.delete(this.key(senderId, runId));
  }

  getRunContext(senderId, runId) {
    return this.runContexts.get(this.key(senderId, runId)) || null;
  }

  start({ senderId = "", taskId, runId, durableRunId, execute, onCancel, heartbeatMs } = {}) {
    const key = this.key(senderId, runId);
    if (this.workers.has(key)) throw new Error("Ya existe un Worker con el mismo runId.");
    const worker = new AgentWorker({ manager: this.manager, taskId, runId, durableRunId, execute, onCancel, heartbeatMs });
    this.workers.set(key, worker);
    const promise = worker.run().finally(() => {
      this.workers.delete(key);
      this.unregisterRunContext(senderId, runId);
    });
    return { worker, promise };
  }

  watch({ senderId = "", taskId, runId, durableRunId, controller, heartbeatMs = 5000 } = {}) {
    const key = this.key(senderId, runId);
    if (this.workers.has(key)) throw new Error("Ya existe un Worker con el mismo runId.");
    const worker = new AgentWorker({
      manager: this.manager, taskId, runId, durableRunId, heartbeatMs,
      onCancel: (reason) => { if (!controller?.signal.aborted) controller.abort(new Error(reason)); return true; },
      execute: async () => undefined,
    });
    worker.startHeartbeat();
    this.workers.set(key, worker);
    return worker;
  }

  stop(senderId, runId, metadata = {}) {
    const key = this.key(senderId, runId);
    const worker = this.workers.get(key);
    if (!worker) return false;
    if (worker.timer) clearInterval(worker.timer);
    worker.event("WORKER_STOPPED", metadata);
    this.workers.delete(key);
    this.unregisterRunContext(senderId, runId);
    return true;
  }

  cancel(senderId, runId, reason) {
    const worker = this.workers.get(this.key(senderId, runId));
    return worker ? worker.cancel(reason) : false;
  }

  status(senderId, runId) {
    const worker = this.workers.get(this.key(senderId, runId));
    if (!worker) return { status: "DEAD", workerId: "", lastHeartbeatAt: 0 };
    const ageMs = Date.now() - worker.lastHeartbeatAt;
    let status = "ACTIVE";
    if (ageMs > this.heartbeatTimeoutMs * 2) status = "DEAD";
    else if (ageMs > this.heartbeatTimeoutMs) status = "STALLED";
    else if (ageMs > worker.heartbeatMs * 2) status = "SLOW";
    return {
      status,
      workerId: worker.workerId,
      taskId: worker.taskId,
      runId: worker.runId,
      durableRunId: worker.durableRunId,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      ageMs,
      invalidated: worker.invalidated === true,
    };
  }

  resetWorkerHealth(senderId, runId) {
    const worker = this.workers.get(this.key(senderId, runId));
    if (!worker) return false;
    worker.deadHandled = false;
    worker.stallReported = false;
    worker.invalidated = false;
    worker.lastHeartbeatAt = Date.now();
    return true;
  }

  injectWorkerDeath(senderId, runId, status = {}) {
    const key = this.key(senderId, runId);
    const worker = this.workers.get(key);
    const ctx = this.runContexts.get(key);
    if (!worker || !ctx) return false;
    return this.handleWorkerDead(senderId, worker, status);
  }

  handleWorkerDead(senderId, worker, status = {}) {
    const key = this.key(senderId, worker.runId);
    const ctx = this.runContexts.get(key);
    if (!ctx || worker.invalidated === true) return false;

    const deathKey = `${worker.workerId}:${ctx.executionEpoch || 0}`;
    if (!ctx.handledWorkerDeaths) ctx.handledWorkerDeaths = new Set();
    if (ctx.handledWorkerDeaths.has(deathKey)) return false;
    ctx.handledWorkerDeaths.add(deathKey);

    worker.invalidated = true;
    worker.deadHandled = true;

    const ageMs = Number(status.ageMs || 0);
    const error = ctx.failover?.createWorkerDeathError
      ? ctx.failover.createWorkerDeathError(ageMs)
      : Object.assign(new Error(`Worker DEAD: heartbeat no recibido (${ageMs}ms).`), { code: "WORKER_DEAD" });

    this.manager.recordRuntimeEvent(worker.taskId, "WORKER_FAILURE", {
      runId: worker.durableRunId,
      metadata: {
        workerId: worker.workerId,
        publicRunId: worker.runId,
        ageMs,
        provider: ctx.adapterInput?.providerKey || ctx.failover?.current?.providerKey || "",
        model: ctx.adapterInput?.model || ctx.failover?.current?.model || "",
        taskId: worker.taskId,
        planId: ctx.taskContext?.planId || "",
        approvalId: ctx.taskContext?.approvalId || "",
      },
    });

    ctx.executionEpoch = (ctx.executionEpoch || 0) + 1;
    const activeRequest = typeof ctx.getRequestController === "function"
      ? ctx.getRequestController()
      : ctx.requestController;
    if (activeRequest) {
      activeRequest.abort(error);
    } else {
      ctx.pendingWorkerDeathError = error;
    }

    return true;
  }

  handleWorkerStalled(senderId, worker, status = {}) {
    const ctx = this.runContexts.get(this.key(senderId, worker.runId));
    this.manager.recordRuntimeEvent(worker.taskId, "WORKER_STALLED", {
      runId: worker.durableRunId,
      metadata: { workerId: worker.workerId, publicRunId: worker.runId, ...status },
    });
    const run = this.manager.store.getRun(worker.taskId, worker.durableRunId);
    if (run && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status)) {
      this.manager.updateRun(worker.taskId, worker.durableRunId, {
        status: "RECOVERABLE",
        recoveryReason: "WORKER_STALLED: heartbeat retrasado.",
      });
    }
    if (ctx) {
      const unblockError = Object.assign(new Error("Worker stalled - desbloqueando solicitud activa."), { code: "WORKER_STALLED" });
      if (typeof ctx.getRequestController === "function") {
        ctx.getRequestController()?.abort(unblockError);
      } else if (ctx.requestController) {
        ctx.requestController.abort(unblockError);
      }
    }
  }

  supervise() {
    const findings = [];
    for (const [key, worker] of this.workers.entries()) {
      const senderId = key.slice(0, key.length - worker.runId.length - 1);
      const status = this.status(senderId, worker.runId);

      if (status.status === "DEAD") {
        if (!worker.deadHandled) {
          worker.deadHandled = true;
          worker.stallReported = true;
          if (this.handleWorkerDead(senderId, worker, status)) {
            findings.push({ ...status, type: "WORKER_TIMEOUT" });
          }
        }
        continue;
      }

      if (status.status === "STALLED" && !worker.stallReported) {
        worker.stallReported = true;
        this.handleWorkerStalled(senderId, worker, status);
        findings.push({ ...status, type: "WORKER_STALLED" });
      }
    }
    return findings;
  }

  inspect() {
    return [...this.workers.entries()].map(([key, worker]) => {
      const senderId = key.slice(0, key.length - worker.runId.length - 1);
      return this.status(senderId, worker.runId);
    });
  }

  decide(taskId, input = {}) {
    const decision = this.governor.decide(input);
    this.manager.recordRuntimeEvent(taskId, "GOVERNOR_DECISION", { runId: input.runId || "", stepId: input.stepId || "", attemptId: input.attemptId || "", metadata: decision });
    return decision;
  }
}

module.exports = { WorkerSupervisor };
