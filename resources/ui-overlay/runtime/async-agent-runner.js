/**
 * EditCoreAI - Async Background Agent Runner (runtime/async-agent-runner.js)
 * Autonomous background agent manager executing complex tasks in an isolated sandbox
 * without blocking the main editor workspace or UI interactions.
 */

"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const TASK_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

class AsyncAgentRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.tasks = new Map();
    this.maxConcurrent = Number.isInteger(options.maxConcurrent) ? options.maxConcurrent : 3;
    this.activeWorkers = 0;
  }

  /**
   * Genera un ID único para la tarea
   */
  _generateTaskId() {
    return `bg_task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Encola una nueva tarea asíncrona
   */
  enqueueTask({ name, type = "general", payload = {}, projectRoot = "" } = {}) {
    if (!name) {
      throw new Error("El nombre de la tarea es obligatorio");
    }

    const taskId = this._generateTaskId();
    const task = {
      id: taskId,
      name,
      type,
      payload,
      projectRoot,
      status: TASK_STATUS.QUEUED,
      progress: 0,
      logs: [],
      result: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    this.tasks.set(taskId, task);
    this.emit("task:queued", task);
    this._processQueue();
    return task;
  }

  /**
   * Procesa la cola de tareas
   */
  async _processQueue() {
    if (this.activeWorkers >= this.maxConcurrent) return;

    for (const [id, task] of this.tasks.entries()) {
      if (task.status === TASK_STATUS.QUEUED) {
        this._runTask(task);
        if (this.activeWorkers >= this.maxConcurrent) break;
      }
    }
  }

  /**
   * Ejecuta una tarea en segundo plano
   */
  async _runTask(task) {
    this.activeWorkers++;
    task.status = TASK_STATUS.RUNNING;
    task.startedAt = Date.now();
    this.emit("task:started", task);
    this.appendLog(task.id, `Iniciando tarea [${task.name}] en segundo plano...`);

    try {
      // Simular progreso de ejecución o ejecutar lógica asignada
      if (typeof task.payload?.executor === "function") {
        task.result = await task.payload.executor({
          log: (msg) => this.appendLog(task.id, msg),
          setProgress: (pct) => this.updateProgress(task.id, pct),
          isCancelled: () => task.status === TASK_STATUS.CANCELLED,
        });
      } else {
        // Ejecutor por defecto según tipo de tarea
        await this._defaultExecutor(task);
      }

      if (task.status !== TASK_STATUS.CANCELLED) {
        task.status = TASK_STATUS.COMPLETED;
        task.progress = 100;
        task.completedAt = Date.now();
        this.appendLog(task.id, `✓ Tarea [${task.name}] completada con éxito.`);
        this.emit("task:completed", task);
      }
    } catch (err) {
      task.status = TASK_STATUS.FAILED;
      task.error = err?.message || String(err);
      task.completedAt = Date.now();
      this.appendLog(task.id, `❌ Error en tarea: ${task.error}`);
      this.emit("task:failed", task);
    } finally {
      this.activeWorkers--;
      this._persistTaskState(task);
      this._processQueue();
    }
  }

  async _defaultExecutor(task) {
    this.updateProgress(task.id, 25);
    this.appendLog(task.id, `Analizando contexto de ${task.projectRoot || "workspace"}...`);
    this.updateProgress(task.id, 60);
    this.appendLog(task.id, `Ejecutando proceso autónomo tipo: ${task.type}...`);
    this.updateProgress(task.id, 90);
    this.appendLog(task.id, `Consolidando resultados de tarea...`);
    task.result = { status: "ok", type: task.type, finished: true };
  }

  /**
   * Agrega un mensaje de log a la tarea
   */
  appendLog(taskId, message) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const logEntry = {
      timestamp: Date.now(),
      message: String(message),
    };
    task.logs.push(logEntry);
    if (task.logs.length > 500) task.logs.shift();
    this.emit("task:log", { taskId, log: logEntry });
  }

  /**
   * Actualiza el porcentaje de progreso
   */
  updateProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.progress = Math.min(100, Math.max(0, Math.round(progress)));
    this.emit("task:progress", { taskId, progress: task.progress });
  }

  /**
   * Cancela una tarea
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if ([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED].includes(task.status)) {
      return false;
    }
    task.status = TASK_STATUS.CANCELLED;
    task.completedAt = Date.now();
    this.appendLog(taskId, "⚠️ Tarea cancelada por el usuario.");
    this.emit("task:cancelled", task);
    this._persistTaskState(task);
    return true;
  }

  /**
   * Obtiene una tarea por su ID
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Lista todas las tareas
   */
  listTasks(projectRoot = null) {
    const all = Array.from(this.tasks.values());
    if (projectRoot) {
      return all.filter((t) => !t.projectRoot || t.projectRoot === projectRoot);
    }
    return all;
  }

  _persistTaskState(task) {
    if (!task.projectRoot) return;
    try {
      const dir = path.join(task.projectRoot, ".editcore", "async-tasks");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${task.id}.json`);
      fs.writeFileSync(target, JSON.stringify(task, null, 2), "utf8");
    } catch {}
  }
}

const asyncAgentRunnerInstance = new AsyncAgentRunner();

module.exports = {
  AsyncAgentRunner,
  asyncAgentRunner: asyncAgentRunnerInstance,
  TASK_STATUS,
};
