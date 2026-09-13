"use strict";

/**
 * Chat Task Worker — Worker Thread para el kernel de chat.
 *
 * Protocolo con task-queue.js:
 *  - Recibe: { type: "process", task: { taskId, taskType, taskData } }
 *  - Envía progreso: { status: "progress", taskId, phase, text, ok }
 *  - Envía éxito:   { status: "completed", taskId, result, metrics }
 *  - Envía fallo:   { status: "failed", taskId, error, retryable, attempt }
 *
 * Tipos soportados:
 *  - CHAT_PROCESS   : handleChat completo o parcial
 *  - INTENT_ANALYSIS: classify / intent-orchestrator
 *  - TOOL_EXECUTE   : tools.run / processRunner
 *  - MEMORY_STORE   : globalMemory.recordSolution / brain ingest
 *  - VISION_INSPECT : capture_preview_screenshot / vision-inspector
 */

const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const os = require("os");

const CONFIG = {
  maxRetries: Number(process.env.CHAT_WORKER_MAX_RETRIES || workerData?.maxRetries || 3),
  retryDelayMs: Number(process.env.CHAT_WORKER_RETRY_DELAY || workerData?.retryDelayMs || 1000),
  timeoutMs: Number(process.env.CHAT_WORKER_TIMEOUT || workerData?.timeoutMs || 30000),
  projectRoot: String(process.env.CHAT_WORKER_PROJECT_ROOT || workerData?.projectRoot || process.cwd()),
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
    error: String(error || "Error desconocido en chat-task-worker"),
    retryable: Boolean(retryable),
    attempt: Number(attempt) || 1,
  });
}

function normalizeMetrics(metrics = {}) {
  return {
    startedAt: metrics.startedAt || Date.now(),
    finishedAt: Date.now(),
    durationMs: Number(metrics.durationMs || 0),
    retries: Number(metrics.retries || 0),
    workerId: String(metrics.workerId || workerData?.workerId || os.hostname()),
    memoryUsedMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

function withTimeout(promiseMs, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback || null), promiseMs);
    promiseMs.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }).catch((e) => {
      clearTimeout(timer);
      throw e;
    });
  });
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, Number(ms) || 0));
}

function resolveProjectRoot(data) {
  const fromData = String(data?.projectRoot || "").trim();
  if (fromData && fromData !== "undefined" && fromData !== "null") return fromData;
  return CONFIG.projectRoot;
}

function loadKernelModule(projectRoot, mod) {
  // Resuelve módulos del kernel desde el projectRoot o desde el directorio del worker
  const candidates = [
    path.join(projectRoot, "editcore-chat-kernel", mod),
    path.join(__dirname, "..", mod),
    path.join(process.cwd(), "editcore-chat-kernel", mod),
  ];
  for (const p of candidates) {
    try {
      return require(p);
    } catch (_) {
      // seguir intentando
    }
  }
  return null;
}

async function executeChatProcess(taskId, data) {
  const projectRoot = resolveProjectRoot(data);
  const handleChat = loadKernelModule(projectRoot, "index.js");
  if (!handleChat || !handleChat.handleChat) {
    throw new Error(`handleChat no disponible en ${projectRoot}`);
  }

  progress(taskId, "Ejecutando handleChat…", "chat", true);
  const startedAt = Date.now();

  const input = {
    message: String(data?.message || ""),
    projectRoot,
    apiBaseUrl: data?.apiBaseUrl,
    apiKey: data?.apiKey,
    model: data?.model,
    onProgress: (info) => progress(taskId, info?.text || info?.message || "", "chat", info?.ok !== false),
  };

  const result = await handleChat.handleChat(input);
  const metrics = { startedAt, durationMs: Date.now() - startedAt };

  progress(taskId, "handleChat completado", "chat", true);
  return { result, metrics };
}

async function executeIntentAnalysis(taskId, data) {
  const projectRoot = resolveProjectRoot(data);
  const classify = loadKernelModule(projectRoot, "classify.js");
  if (!classify || !classify.classify) {
    throw new Error(`classify no disponible en ${projectRoot}`);
  }

  progress(taskId, "Analizando intención…", "intent", true);
  const startedAt = Date.now();

  const text = String(data?.text || data?.message || "");
  const result = await classify.classify(text, {
    projectRoot,
    model: data?.model,
    apiKey: data?.apiKey,
  });

  const metrics = { startedAt, durationMs: Date.now() - startedAt };
  progress(taskId, "Intención clasificada", "intent", true);
  return { result, metrics };
}

async function executeToolExecute(taskId, data) {
  const projectRoot = resolveProjectRoot(data);
  const tools = loadKernelModule(projectRoot, "tools.js");
  if (!tools) {
    throw new Error(`tools no disponible en ${projectRoot}`);
  }

  const toolName = String(data?.toolName || data?.tool || "");
  const toolArgs = data?.toolArgs || data?.args || {};

  progress(taskId, `Ejecutando herramienta: ${toolName}`, "tool", true);
  const startedAt = Date.now();

  let result;
  if (typeof tools.run === "function") {
    result = await tools.run(toolName, toolArgs, { projectRoot });
  } else if (typeof tools[toolName] === "function") {
    result = await tools[toolName](toolArgs, { projectRoot });
  } else {
    throw new Error(`Herramienta no encontrada: ${toolName}`);
  }

  const metrics = { startedAt, durationMs: Date.now() - startedAt };
  progress(taskId, `Herramienta completada: ${toolName}`, "tool", true);
  return { result, metrics };
}

async function executeMemoryStore(taskId, data) {
  const projectRoot = resolveProjectRoot(data);
  const globalMemory = loadKernelModule(projectRoot, "global-memory.js");
  if (!globalMemory || !globalMemory.recordSolution) {
    throw new Error(`globalMemory no disponible en ${projectRoot}`);
  }

  const entry = {
    key: String(data?.key || `memory_${taskId}`),
    value: data?.value ?? data?.payload ?? null,
    tags: Array.isArray(data?.tags) ? data.tags : [],
    projectRoot,
  };

  progress(taskId, "Guardando en memoria global…", "memory", true);
  const startedAt = Date.now();

  await globalMemory.recordSolution(entry);

  const metrics = { startedAt, durationMs: Date.now() - startedAt };
  progress(taskId, "Memoria guardada", "memory", true);
  return { result: { stored: true, key: entry.key }, metrics };
}

async function executeVisionInspect(taskId, data) {
  const projectRoot = resolveProjectRoot(data);
  const visionInspector = loadKernelModule(projectRoot, "vision-inspector.js");
  if (!visionInspector || !visionInspector.capture_preview_screenshot) {
    throw new Error(`vision-inspector no disponible en ${projectRoot}`);
  }

  const url = String(data?.url || "http://127.0.0.1:4568/");
  const viewport = String(data?.viewport || "desktop");

  progress(taskId, `Capturando preview: ${url}`, "vision", true);
  const startedAt = Date.now();

  const screenshot = await visionInspector.capture_preview_screenshot(url, viewport);

  const metrics = { startedAt, durationMs: Date.now() - startedAt };
  progress(taskId, "Preview capturado", "vision", true);
  return { result: screenshot || { ok: true, url, viewport }, metrics };
}

const TASK_HANDLERS = {
  CHAT_PROCESS: executeChatProcess,
  INTENT_ANALYSIS: executeIntentAnalysis,
  TOOL_EXECUTE: executeToolExecute,
  MEMORY_STORE: executeMemoryStore,
  VISION_INSPECT: executeVisionInspect,
};

async function processTask(task) {
  const taskId = String(task?.taskId || `task_${Date.now()}`);
  const taskType = String(task?.taskType || "").toUpperCase();
  const taskData = task?.taskData && typeof task.taskData === "object" ? task.taskData : {};

  const handler = TASK_HANDLERS[taskType];
  if (!handler) {
    throw new Error(`Tipo de tarea no soportado por chat-task-worker: ${taskType}`);
  }

  let attempt = 1;
  let lastError;

  while (attempt <= CONFIG.maxRetries) {
    try {
      const { result, metrics } = await withTimeout(
        CONFIG.timeoutMs,
        Promise.reject(new Error(`Timeout en ${taskType} después de ${CONFIG.timeoutMs}ms`))
      )(handler(taskId, taskData));

      complete(taskId, result, { ...metrics, attempt });
      return;
    } catch (err) {
      lastError = err;
      const retryable = attempt < CONFIG.maxRetries;
      progress(
        taskId,
        `Error en ${taskType} (intento ${attempt}/${CONFIG.maxRetries}): ${err?.message || err}`,
        "error",
        false
      );
      if (!retryable) break;
      await delay(CONFIG.retryDelayMs * attempt);
      attempt += 1;
    }
  }

  fail(taskId, lastError?.message || lastError, true, attempt);
}

async function shutdown() {
  post({ type: "shutdown_ack", workerId: workerData?.workerId });
  // No hay estado mutable crítico; salida limpia
  process.exit(0);
}

async function handleMessage(message) {
  const { type, task } = message || {};

  switch (type) {
    case "process":
      await processTask(task);
      break;
    case "cancel":
      // Cancelación cooperativa: no hay API nativa de abort en este worker,
      // pero se marca como cancelado para el próximo ciclo.
      post({ type: "cancelled", taskId: task?.taskId });
      break;
    case "ping":
      post({ type: "pong", workerId: workerData?.workerId, ts: Date.now() });
      break;
    case "shutdown":
      await shutdown();
      break;
    default:
      post({ type: "error", error: `Tipo de mensaje desconocido: ${type}` });
  }
}

function initialize() {
  if (!parentPort) {
    throw new Error("chat-task-worker debe ejecutarse como Worker Thread");
  }

  parentPort.on("message", async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      post({
        type: "worker_error",
        error: String(err?.message || err),
        stack: String(err?.stack || ""),
      });
    }
  });

  post({
    type: "ready",
    workerId: workerData?.workerId,
    pid: process.pid,
    projectRoot: CONFIG.projectRoot,
    supportedTypes: Object.keys(TASK_HANDLERS),
  });
}

initialize();
