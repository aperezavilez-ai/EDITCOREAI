"use strict";

const { EventEmitter } = require("node:events");

class TaskQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = Math.max(1, Number(options.concurrency) || 2);
    this.activeCount = 0;
    this.queue = [];
    this.tasks = new Map();
    this._shutdown = false;
    // [FIX] Cota del historial de tareas: antes el Map crecía sin límite
    // (cada runInBackground añadía y nadie eliminaba) → fuga de memoria en sesiones largas.
    this._maxTasks = Math.max(100, Number(options.maxTasks) || 1000);
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
      // [FIX] Si el llamador pasa un handler real, se ejecuta; si no, se conserva el
      // comportamiento original (completado simulado a los 100 ms). Antes el handler
      // nunca se invocaba: cualquier tarea con trabajo real reportaba éxito falso.
      handler: typeof options.handler === "function" ? options.handler : null,
      status: "queued",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    // [FIX] Evicción FIFO cuando el historial supera la cota.
    while (this.tasks.size > this._maxTasks) {
      const oldest = this.tasks.keys().next().value;
      if (oldest === undefined) break;
      this.tasks.delete(oldest);
    }
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

    setTimeout(async () => {
      let ok = true;
      let result = { ok: true, text: "Completado en segundo plano" };
      // [FIX] El handler se ejecuta de verdad y sus errores se capturan: antes una
      // excepción async quedaría como 'completed' o tumbaría el proceso.
      if (task.handler) {
        try {
          result = await task.handler(task.data, task);
          ok = result?.ok !== false;
        } catch (error) {
          ok = false;
          result = { ok: false, error: String(error?.message || error) };
        }
      }
      this.activeCount--;
      task.status = ok ? "completed" : "failed";
      task.result = result;
      try {
        this.emit("task_progress", {
          taskId: task.taskId,
          status: ok ? "completed" : "failed",
          text: ok ? `Tarea ${task.taskId} completada` : `Tarea ${task.taskId} falló`,
        });
        this.emit(ok ? "task_complete" : "task_error", {
          taskId: task.taskId,
          result,
        });
      } finally {
        // [FIX] La cola siempre continúa, aunque un listener lance.
        this._process();
      }
    }, 100);
  }

  cancelAll() {
    // [FIX] Las tareas encoladas quedaban con status "queued" para siempre aunque se
    // descartaran; ahora se marcan como canceladas antes de vaciar.
    for (const task of this.queue) {
      task.status = "cancelled";
    }
    this.queue = [];
    this.emit("cancelled_all");
  }

  clear() {
    this.queue = [];
  }

  getStats() {
    return {
      total: this.tasks.size,
      // [FIX] this.queue es un Array: no tiene .pending; ahora se lee .length directamente.
      pending: this.queue.length,
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

// Intentar sincronizar con el kernel interno si está disponible.
// [FIX] Antes se adoptaba el módulo del kernel sin verificar su forma: si exportaba una
// clase (función) en vez de una instancia con runInBackground/cancelAll, los consumidores
// de este módulo recibían una clase y rompían al llamar taskQueue.runInBackground().
// Ahora solo se adopta si "quacks like a queue"; si no, se usa la implementación local.
try {
  const kernelModule = require("./editcore-chat-kernel/task-queue");
  if (
    kernelModule
    && typeof kernelModule === "object"
    && typeof kernelModule.runInBackground === "function"
    && typeof kernelModule.cancelAll === "function"
  ) {
    if (!kernelModule.TaskQueue) kernelModule.TaskQueue = TaskQueue;
    module.exports = kernelModule;
    return;
  }
} catch {
  // Usar implementación local robusta como fallback
}

module.exports = defaultInstance;
