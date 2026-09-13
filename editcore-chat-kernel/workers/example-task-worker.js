"use strict";

/**
 * Example Task Worker — Worker Thread de ejemplo para el kernel de chat.
 *
 * Protocolo con task-queue.js:
 *  - Recibe: { type: "process", task: { taskId, taskType, taskData } }
 *  - Envía progreso: { status: "progress", taskId, phase, text, ok }
 *  - Envía éxito:   { status: "completed", taskId, result, metrics }
 *  - Envía fallo:   { status: "failed", taskId, error, retryable, attempt }
 *
 * Tipos soportados (ejemplo):
 *  - ECHO          : devuelve el taskData tal cual (demo)
 *  - COMPUTE       : suma/operación simple sobre numbers en taskData
 *  - DELAYED_ACK   : espera N ms y confirma (prueba de timeout/async)
 */

const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const os = require("os");

const CONFIG = {
  maxRetries: Number(process.env.EXAMPLE_WORKER_MAX_RETRIES || workerData?.maxRetries || 3),
  retryDelayMs: Number(process.env.EXAMPLE_WORKER_RETRY_DELAY || workerData?.retryDelayMs || 1000),
  timeoutMs: Number(process.env.EXAMPLE_WORKER_TIMEOUT || workerData?.timeoutMs || 30000),
  projectRoot: String(process.env.EXAMPLE_WORKER_PROJECT_ROOT || workerData?.projectRoot || process.cwd()),
};

function post(msg) {
  try {
    parentPort?.postMessage(msg);
  } catch (_) {
    // parentPort cerrado; silenciar para no romper el worker en shutdown
  }
}

function progress(taskId, text, phase = "tool", ok = true) {
  post({
    status: "progress",
    taskId,
    phase,
    text: String(text || ""),
    ok: Boolean(ok),
  });
}

function complete(taskId, result = {}, metrics = {}) {
  post({
    status: "completed",
    taskId,
    result,
    metrics: normalizeMetrics(metrics),
  });
}

function fail(taskId, error, retryable = true, attempt = 1) {
  post({
    status: "failed",
    taskId,
    error: String(error || "unknown error"),
    retryable: Boolean(retryable),
    attempt: Number(attempt) || 1,
  });
}

function normalizeMetrics(metrics = {}) {
  return {
    durationMs: Number(metrics.durationMs || 0),
    retries: Number(metrics.retries || 0),
    workerId: String(metrics.workerId || workerData?.workerId || path.basename(process.title || "example-worker")),
    host: os.hostname(),
  };
}

async function withTimeout(promise, ms) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function processEcho(task) {
  const { taskId, taskData = {} } = task;
  progress(taskId, "Echo: recibiendo datos", "echo");
  await withTimeout(Promise.resolve(taskData), CONFIG.timeoutMs);
  progress(taskId, "Echo: completado", "echo", true);
  return { echoed: taskData };
}

async function processCompute(task) {
  const { taskId, taskData = {} } = task;
  const { operation = "sum", values = [] } = taskData;

  progress(taskId, `Compute: operación ${operation}`, "compute");

  let result;
  switch (operation) {
    case "sum":
      result = values.reduce((a, b) => a + b, 0);
      break;
    case "multiply":
      result = values.reduce((a, b) => a * b, 1);
      break;
    case "mean":
      result = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      break;
    default:
      throw new Error(`Operación no soportada: ${operation}`);
  }

  progress(taskId, `Compute: resultado = ${result}`, "compute", true);
  return { operation, values, result };
}

async function processDelayedAck(task) {
  const { taskId, taskData = {} } = task;
  const delayMs = Number(taskData.delayMs || 1000);

  progress(taskId, `DelayedAck: esperando ${delayMs}ms`, "delay");
  await withTimeout(new Promise((resolve) => setTimeout(resolve, delayMs)), CONFIG.timeoutMs);
  progress(taskId, "DelayedAck: confirmado", "delay", true);
  return { delayMs, confirmed: true };
}

async function processTask(task) {
  const { taskId, taskType, taskData = {} } = task;
  const start = Date.now();

  progress(taskId, `Iniciando ${taskType}`, "start");

  let result;
  switch (taskType) {
    case "ECHO":
      result = await processEcho(task);
      break;
    case "COMPUTE":
      result = await processCompute(task);
      break;
    case "DELAYED_ACK":
      result = await processDelayedAck(task);
      break;
    default:
      throw new Error(`Tipo de tarea no soportado: ${taskType}`);
  }

  const durationMs = Date.now() - start;
  progress(taskId, `Completado en ${durationMs}ms`, "done", true);
  complete(taskId, result, { durationMs });
}

async function handleMessage(message) {
  const { type, task, data } = message;

  try {
    switch (type) {
      case "process":
        await processTask(task || data);
        break;
      case "ping":
        post({ type: "pong", workerId: workerData?.workerId });
        break;
      case "shutdown":
        post({ type: "shutdown_ack" });
        process.exit(0);
        break;
      default:
        throw new Error(`Tipo de mensaje no soportado: ${type}`);
    }
  } catch (error) {
    const taskId = task?.taskId || data?.taskId || "unknown";
    fail(taskId, error.message || String(error), true, 1);
  }
}

// Inicialización del worker
if (!parentPort) {
  throw new Error("example-task-worker.js debe ejecutarse como Worker Thread");
}

parentPort.on("message", async (message) => {
  await handleMessage(message);
});

post({ type: "ready", workerId: workerData?.workerId, pid: process.pid });
