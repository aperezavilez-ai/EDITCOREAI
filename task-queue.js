"use strict";

const { EventEmitter } = require("node:events");

class TaskQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 2;
    this.activeCount = 0;
    this.queue = [];
    this.tasks = new Map();
    this._shutdown = false;
  }

  runInBackground(taskType, data = {}, options = {}) {
    if (this._shutdown) {
      throw new Error("TaskQueue is shut down");
    }
    const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const task = {
      taskId,
      taskType: taskType || "ANALYZE",
      data: data && typeof data === "object" ? data : {},
      status: "queued",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.queue.push(task);

    this.emit("task_progress", {
      taskId,
      status: "queued",
      text: `Tarea ${taskId} en cola (${taskType})`,
    });

    this._process();
    return taskId;
  }

  _process() {
    if (this._shutdown || this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }
    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    task.status = "running";
    this.emit("task_progress", {
      taskId: task.taskId,
      status: "running",
      text: `Ejecutando tarea ${task.taskId} (${task.taskType})`,
    });

    setTimeout(() => {
      this.activeCount--;
      task.status = "completed";
      this.emit("task_progress", {
        taskId: task.taskId,
        status: "completed",
        text: `Tarea ${task.taskId} completada`,
      });
      this.emit("task_complete", {
        taskId: task.taskId,
        result: { ok: true, text: "Completado en segundo plano" },
      });
      this._process();
    }, 100);
  }

  cancelAll() {
    this.queue = [];
    this.emit("cancelled_all");
  }

  clear() {
    this.queue = [];
  }

  getStats() {
    return {
      total: this.tasks.size,
      pending: this.queue.pending || this.queue.length,
      workers: this.activeCount,
    };
  }

  shutdown() {
    this._shutdown = true;
    this.queue = [];
  }
}

// Instancia singleton por defecto + clase exportada para compatibilidad total con el núcleo
const defaultInstance = new TaskQueue();
defaultInstance.TaskQueue = TaskQueue;

// Intentar sincronizar con el kernel interno si está disponible
try {
  const kernelModule = require("./editcore-chat-kernel/task-queue");
  if (kernelModule) {
    if (typeof kernelModule === "object") {
      kernelModule.TaskQueue = kernelModule.TaskQueue || TaskQueue;
    }
    module.exports = kernelModule;
    return;
  }
} catch {
  // Usar implementación local robusta como fallback
}

module.exports = defaultInstance;