"use strict";

/**
 * Task Queue multihilo (Worker Threads + EventEmitter).
 * Eventos: task_progress | task_complete | task_error
 */

const { Worker } = require("worker_threads");
const EventEmitter = require("events");
const path = require("path");
const os = require("os");

const WORKER_PATH = path.join(__dirname, "agent-worker.js");
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(4, (os.cpus() || []).length || 2));

class TaskQueue extends EventEmitter {
  constructor({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    super();
    this.concurrency = Number(concurrency) || DEFAULT_CONCURRENCY;
    this.workers = new Map();
    this.meta = new Map();
    this.pending = [];
    this._seq = 0;
  }

  /**
   * Encola y ejecuta un subagente en un Worker. Retorna taskId de inmediato.
   * @param {string} taskType
   * @param {object} taskData
   * @param {{ onProgress?: Function }} [options]
   */
  runInBackground(taskType, taskData = {}, options = {}) {
    this._seq += 1;
    const taskId = `task_${Date.now()}_${this._seq}`;
    const job = {
      taskId,
      taskType: String(taskType || "ANALYZE"),
      taskData: taskData && typeof taskData === "object" ? taskData : {},
      onProgress: typeof options.onProgress === "function" ? options.onProgress : null,
    };

    this.meta.set(taskId, {
      type: job.taskType,
      startedAt: Date.now(),
      onProgress: job.onProgress,
      status: "queued",
    });

    this.emit("task_progress", {
      taskId,
      status: "queued",
      text: `Tarea ${taskId} en cola (${job.taskType})`,
    });
    job.onProgress?.({
      taskId,
      status: "queued",
      text: `Tarea ${taskId} en cola (${job.taskType})`,
    });

    this.pending.push(job);
    this._pump();
    return taskId;
  }

  _pump() {
    while (this.workers.size < this.concurrency && this.pending.length) {
      this._spawn(this.pending.shift());
    }
  }

  _spawn(job) {
    const { taskId, taskType, taskData, onProgress } = job;
    let worker;
    try {
      worker = new Worker(WORKER_PATH);
    } catch (err) {
      const payload = {
        taskId,
        status: "failed",
        error: String(err?.message || err),
      };
      this.meta.delete(taskId);
      onProgress?.(payload);
      this.emit("task_error", payload);
      this.emit("task_progress", payload);
      this._pump();
      return;
    }

    this.workers.set(taskId, worker);
    const meta = this.meta.get(taskId);
    if (meta) meta.status = "running";

    const emitProgress = (payload) => {
      onProgress?.(payload);
      this.emit("task_progress", payload);
    };

    emitProgress({
      taskId,
      status: "running",
      text: `Worker iniciado (${taskType})`,
    });

    worker.on("message", (msg) => {
      const payload = { taskId, ...(msg && typeof msg === "object" ? msg : { data: msg }) };
      if (payload.status === "ready") return;

      emitProgress(payload);

      if (payload.status === "completed") {
        this.emit("task_complete", payload);
        this._cleanup(taskId, worker);
        this._pump();
        return;
      }
      if (payload.status === "failed") {
        this.emit("task_error", payload);
        this._cleanup(taskId, worker);
        this._pump();
      }
    });

    worker.on("error", (err) => {
      const payload = { taskId, status: "failed", error: String(err?.message || err) };
      onProgress?.(payload);
      this.emit("task_error", payload);
      this.emit("task_progress", payload);
      this._cleanup(taskId, worker);
      this._pump();
    });

    worker.on("exit", (code) => {
      if (!this.workers.has(taskId)) return;
      if (code !== 0) {
        const payload = {
          taskId,
          status: "failed",
          error: `Worker salió con código ${code}`,
        };
        onProgress?.(payload);
        this.emit("task_error", payload);
        this.emit("task_progress", payload);
      }
      this._cleanup(taskId, worker);
      this._pump();
    });

    // El worker escucha parentPort: enviamos la tarea por mensaje.
    worker.postMessage({
      type: "run",
      taskId,
      taskType,
      taskData,
    });
  }

  _cleanup(taskId, worker) {
    this.workers.delete(taskId);
    this.meta.delete(taskId);
    try {
      worker.terminate();
    } catch (_) { /* ignore */ }
  }

  cancel(taskId) {
    const id = String(taskId || "");
    this.pending = this.pending.filter((job) => {
      if (job.taskId !== id) return true;
      const payload = { taskId: id, status: "failed", error: "Cancelado" };
      job.onProgress?.(payload);
      this.emit("task_error", payload);
      this.emit("task_progress", payload);
      this.meta.delete(id);
      return false;
    });
    const worker = this.workers.get(id);
    if (worker) {
      try { worker.postMessage({ type: "cancel", taskId: id }); } catch (_) { /* ignore */ }
      try { worker.terminate(); } catch (_) { /* ignore */ }
      const payload = { taskId: id, status: "failed", error: "Cancelado" };
      this.workers.delete(id);
      this.meta.delete(id);
      this.emit("task_error", payload);
      this.emit("task_progress", payload);
    }
    this._pump();
    return { ok: true, taskId: id };
  }

  cancelAll() {
    const ids = [
      ...this.pending.map((j) => j.taskId),
      ...this.workers.keys(),
    ];
    for (const id of ids) this.cancel(id);
    return { ok: true, cancelled: ids.length };
  }

  list() {
    return {
      running: [...this.workers.keys()],
      queued: this.pending.map((j) => j.taskId),
      meta: Object.fromEntries(this.meta),
    };
  }
}

const taskQueue = new TaskQueue();
module.exports = taskQueue;
module.exports.TaskQueue = TaskQueue;
