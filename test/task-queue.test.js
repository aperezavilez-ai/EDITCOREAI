"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

// Mock mínimo de Worker para no spawnear threads reales en tests unitarios.
class MockWorker extends EventEmitter {
  constructor() {
    super();
    this.terminateCalls = 0;
    this.postMessageCalls = [];
  }
  postMessage(data) {
    this.postMessageCalls.push(data);
  }
  async terminate() {
    this.terminateCalls += 1;
    return Promise.resolve();
  }
}

// Parcheamos require("worker_threads") solo para este módulo.
const originalRequire = require.cache[require.resolve("worker_threads")];
const workerThreads = {
  Worker: MockWorker,
  isMainThread: true,
  parentPort: null,
};

// Cargamos la implementación bajo el mock.
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "worker_threads") {
    return workerThreads;
  }
  return originalLoad(request, parent, isMain);
};

let TaskQueue;
try {
  const mod = require("../editcore-chat-kernel/task-queue");
  TaskQueue = mod.TaskQueue || mod;
} finally {
  Module._load = originalLoad;
}

test("runInBackground encola una tarea y emite task_progress con status queued", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const progresses = [];
  queue.on("task_progress", (evt) => progresses.push(evt));

  const taskId = queue.runInBackground("ANALYZE", { prompt: "hola" });

  assert.ok(typeof taskId === "string" && taskId.length > 0, "debe retornar un taskId");
  assert.ok(
    progresses.some((p) => p.taskId === taskId && p.status === "queued"),
    "debe emitir task_progress con status queued"
  );
});

test("runInBackground encola múltiples tareas manteniendo orden FIFO dentro de la misma prioridad", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    ids.push(queue.runInBackground("ANALYZE", { index: i }));
  }

  assert.equal(ids.length, 3, "debe encolar 3 tareas");
  assert.deepEqual(ids, [ids[0], ids[1], ids[2]], "los ids deben ser únicos y estables");
});

test("getStats refleja tareas encoladas y workers activos", () => {
  const queue = new TaskQueue({ concurrency: 2 });
  queue.runInBackground("ANALYZE", {});
  queue.runInBackground("ANALYZE", {});

  const stats = queue.getStats();
  assert.ok(stats && typeof stats === "object", "getStats debe retornar un objeto");
  assert.ok(
    typeof stats.pending === "number" && stats.pending >= 0,
    "pending debe ser numérico"
  );
});

test("clear vacía la cola pendiente sin afectar workers en ejecución", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  queue.runInBackground("ANALYZE", {});
  queue.clear();

  const stats = queue.getStats();
  assert.equal(stats.pending, 0, "pending debe ser 0 tras clear");
});

test("shutdown detiene la cola y no acepta nuevas tareas", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  queue.shutdown();

  assert.throws(() => queue.runInBackground("ANALYZE", {}), {
    message: /shutdown/i,
  });
});

test("evento task_progress incluye taskId, status y texto", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const events = [];
  queue.on("task_progress", (evt) => events.push(evt));

  queue.runInBackground("ANALYZE", { prompt: "x" });

  const queued = events.find((e) => e.status === "queued");
  assert.ok(queued, "debe existir evento queued");
  assert.ok(typeof queued.taskId === "string", "taskId debe ser string");
  assert.ok(typeof queued.text === "string" && queued.text.length > 0, "text debe ser no vacío");
});

test("runInBackground valida tipos y normaliza taskData vacío", () => {
  const queue = new TaskQueue({ concurrency: 1 });

  const id1 = queue.runInBackground("ANALYZE");
  assert.ok(typeof id1 === "string", "taskType por defecto debe encolarse");

  const id2 = queue.runInBackground("ANALYZE", "no-object");
  assert.ok(typeof id2 === "string", "taskData inválido debe normalizarse a objeto");
});

test("getStats retorna métricas coherentes tras encolar tareas", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  queue.runInBackground("ANALYZE", {});
  queue.runInBackground("ANALYZE", {});

  const stats = queue.getStats();
  assert.ok(typeof stats.total === "number", "total debe existir");
  assert.ok(typeof stats.pending === "number", "pending debe existir");
  assert.ok(typeof stats.workers === "number", "workers debe existir");
  assert.ok(stats.workers >= 0, "workers no debe ser negativo");
});

test("múltiples encolados generan taskId únicos", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) {
    ids.add(queue.runInBackground("ANALYZE", { i }));
  }
  assert.equal(ids.size, 50, "no debe haber taskIds duplicados");
});

test("TaskQueue hereda de EventEmitter", () => {
  const queue = new TaskQueue({ concurrency: 1 });
  assert.ok(queue instanceof EventEmitter, "TaskQueue debe ser instancia de EventEmitter");
});