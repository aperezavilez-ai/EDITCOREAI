"use strict";

/**
 * Núcleo de chat EditCore — entrada única.
 *
 *   const { handleChat, stopChat } = require("./editcore-chat-kernel");
 *   const out = await handleChat({ message, projectRoot, apiBaseUrl, apiKey, model, onProgress });
 */

const { ChatOrchestrator } = require("./orchestrator");
const { classify } = require("./classify");
const { SKILL_IDS } = require("./skills-catalog");
const { uiDesignSystemPrompt } = require("./ui-design-prompt");
const { scaffoldNextApp } = require("./scaffold");
const { detectDevLogIssue } = require("./dev-log-detector");
const tools = require("./tools");
const snapshot = require("./snapshot");
const processRunner = require("./process-runner");
const visionInspector = require("./vision-inspector");
const globalMemory = require("./global-memory");
const taskQueue = require("./task-queue");
const threadCore = require("./thread-core");
const threadMemory = require("./thread-memory");
const modelRouter = require("./model-router");
const agentBus = require("./agent-bus");
const selfGuard = require("./self-guard");

const orchestrator = new ChatOrchestrator();

// 🔒 Lock serializado: impide que dos mensajes concurrentes pisen el estado
// interno del orchestrator (abort, turnAbort, _currentUserText, _threadId).
// [EDITCORE-INTEGRAL-B7] La serialización NO se toca (un orquestador +
// una cadena, ver «Lo que ya está bien» del programa): lo que el Bloque
// 7 añade es PLAZO para quien espera en la cola y cancelación POR
// runId. Antes el segundo handleChat esperaba a `prev` sin plazo: una
// corrida colgada dejaba todas las posteriores en «Pensando…» hasta
// reiniciar, y KERNEL_TIMEOUT_MS vivía sin uso en el bridge.
let _chain = Promise.resolve();

// [EDITCORE-INTEGRAL-B7] Plazo de COLA declarado: quien espera su turno
// más de esto recibe un resultado honesto en SU burbuja en vez de
// colgar para siempre. Es deliberadamente mucho menor que el plazo
// total de ejecución del bridge (KERNEL_TIMEOUT_MS, 60 min): esperar
// en cola NO consume el presupuesto de ejecución del turno.
const QUEUE_TIMEOUT_MS = 120_000;

// [EDITCORE-INTEGRAL-B7] Registro de corridas de la cadena: una
// entrada por corrida (runId), con su estado queued|running|done.
// Es la costura que permite cancelar UNA corrida (la de su chat) sin
// matar las demás: la que espera sale de la cola; la que corre aborta
// solo su señal (como es la única en ejecución — serialización —,
// detener el orquestador en ese instante ES detener solo esa).
const _runs = new Map();

function resolveQueueTimeoutMs(input = {}) {
  const raw = input.queueTimeoutMs ?? input.queueWaitMs ?? input.queueDeadlineMs;
  if (raw === null || raw === undefined || raw === "") return QUEUE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return QUEUE_TIMEOUT_MS;
  return n; // 0 = sin plazo (solo para costuras que lo pidan explícito)
}

function queueTimeoutResult(entry, waitedMs) {
  const seconds = Math.max(1, Math.round(waitedMs / 1000));
  return {
    kind: "QUEUED",
    queued: true,
    queueTimeout: true,
    runId: entry.runId,
    chatId: entry.chatId || "",
    waitedMs,
    text: [
      `## ⏳ Tu turno sigue en cola tras ${seconds} s`,
      "",
      "Hay otro turno en curso y el motor de EditCoreAI ejecuta **de uno en uno**: este turno **no se ejecutó** y no quedó colgado en silencio.",
      "",
      "Puedes esperar a que termine el turno anterior y reenviar tu mensaje, o detener el turno en curso desde su propio chat.",
    ].join("\n"),
    steps: [],
  };
}

function queueCancelledResult(entry) {
  return {
    kind: "STOP",
    cancelled: true,
    queuedCancelled: entry.state !== "running",
    runId: entry.runId,
    chatId: entry.chatId || "",
    text: "Cancelado por el usuario.",
    steps: [],
  };
}

function handleChat(input) {
  const safeInput = input && typeof input === "object" ? input : {};
  // [EDITCORE-INTEGRAL-B7] Identidad de la corrida de principio a fin:
  // el runId entra (renderer → main → bridge) o se genera aquí una
  // sola vez; jamás viaja vacío aguas abajo.
  const runId = String(safeInput.runId || "").trim()
    || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    runId,
    chatId: String(safeInput.chatId || safeInput.threadId || "").trim(),
    state: "queued",
    queuedAt: Date.now(),
    resolveCaller: null,
    rejectCaller: null,
    queueTimer: null,
  };
  _runs.set(runId, entry);
  const callerPromise = new Promise((resolve, reject) => {
    entry.resolveCaller = resolve;
    entry.rejectCaller = reject;
  });

  const prev = _chain;
  let release;
  _chain = new Promise((r) => { release = r; });

  // Aviso de cola: si ya hay otra corrida viva, este turno nace EN
  // COLA y su burbuja lo dice (nunca un «ejecutando» falso).
  if ([..._runs.values()].some((other) => other !== entry && other.state !== "done")) {
    try {
      safeInput.onProgress?.({ phase: "queued", runId, chatId: entry.chatId, text: "En cola: el motor ejecuta de uno en uno." });
    } catch { /* el aviso no tumba el turno */ }
  }

  const queueTimeoutMs = resolveQueueTimeoutMs(safeInput);
  if (queueTimeoutMs > 0) {
    entry.queueTimer = setTimeout(() => {
      if (entry.state !== "queued") return;
      // El plazo venció esperando: se resuelve al llamante con el
      // resultado honesto de cola. La entrada conserva su sitio en la
      // cadena hasta que le toque (liberar antes rompería la
      // serialización: el siguiente podría arrancar en paralelo),
      // pero cuando le toque NO ejecuta: sale y libera al instante.
      entry.state = "queue-timeout";
      entry.resolveCaller(queueTimeoutResult(entry, Date.now() - entry.queuedAt));
    }, queueTimeoutMs);
  }

  (async () => {
    await prev;
    if (entry.queueTimer) { clearTimeout(entry.queueTimer); entry.queueTimer = null; }
    if (entry.state !== "queued") {
      // Cancelada o vencida en cola: nunca llega al orquestador.
      entry.state = "done";
      _runs.delete(runId);
      release();
      return;
    }
    entry.state = "running";
    try {
      if (orchestrator.isRunning()) {
        entry.resolveCaller({
          kind: "CHAT",
          text: "Hay un proceso activo. Envía **detente** para cancelarlo antes de mandar otro mensaje.",
          blocked: true,
          runId,
          chatId: entry.chatId || "",
        });
        return;
      }
      const out = await orchestrator.handle({ ...safeInput, runId });
      let guard = null;
      try { guard = selfGuard.verifyAfterTurn(input?.projectRoot, out?.steps); } catch { guard = null; }
      if (guard && !guard.ok && out && typeof out === "object") {
        out.selfGuard = guard;
        out.text = [String(out.text || "").trim(), selfGuard.formatGuardNotice(guard)].filter(Boolean).join("\n\n");
      }
      if (out && typeof out === "object" && !out.runId) out.runId = runId;
      entry.resolveCaller(out);
    } catch (err) {
      entry.rejectCaller(err);
    } finally {
      entry.state = "done";
      _runs.delete(runId);
      release();
    }
  })();

  return callerPromise;
}

// [EDITCORE-INTEGRAL-B7] Cancelación quirúrgica por runId:
//  - corrida EN COLA → su promesa resuelve como cancelada y sale de la
//    cola; la que corre no se entera (el orquestador ni se toca).
//  - corrida EN CURSO → solo su señal se aborta (orchestrator.stop():
//    por la serialización, la única corrida en ejecución es esa).
// Devuelve true si la corrida existía. Sin runId no cancela nada:
// el paro global es stopChat(), último recurso declarado del llamante.
function cancelChatRun(runId) {
  const id = String(runId || "").trim();
  if (!id) return false;
  const entry = _runs.get(id);
  if (!entry) return false;
  if (entry.state === "queued" || entry.state === "queue-timeout") {
    if (entry.queueTimer) { clearTimeout(entry.queueTimer); entry.queueTimer = null; }
    const wasTimeout = entry.state === "queue-timeout";
    entry.state = "cancelled";
    if (!wasTimeout) entry.resolveCaller(queueCancelledResult(entry));
    return true;
  }
  if (entry.state === "running") {
    entry.state = "cancelling";
    try { orchestrator.stop(); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function listChatRuns() {
  return [..._runs.values()].map((entry) => ({
    runId: entry.runId,
    chatId: entry.chatId || "",
    state: entry.state,
    queuedAt: entry.queuedAt,
  }));
}

function stopChat() {
  return orchestrator.stop();
}

function steerChat(instruction) {
  return orchestrator.steer(instruction);
}

function isChatRunning() {
  return orchestrator.isRunning();
}

module.exports = {
  handleChat,
  stopChat,
  // [EDITCORE-INTEGRAL-B7] Cancelación por corrida + plazo de cola.
  cancelChatRun,
  listChatRuns,
  QUEUE_TIMEOUT_MS,
  steerChat,
  isChatRunning,
  classify,
  SKILL_IDS,
  ChatOrchestrator,
  taskQueue,
  uiDesignSystemPrompt,
  scaffoldNextApp,
  detectDevLogIssue,
  TOOL_RESULT_CAP: tools.TOOL_RESULT_CAP,
  tools,
  snapshot,
  rollbackLastChange: snapshot.rollbackLastChange,
  listSnapshots: snapshot.listSnapshots,
  processRunner,
  runProcess: processRunner.runProcess,
  visionInspector,
  capture_preview_screenshot: visionInspector.capture_preview_screenshot,
  globalMemory,
  recordSolution: globalMemory.recordSolution,
  globalMemoryPrompt: globalMemory.promptBlock,
  threadCore,
  threadMemory,
  modelRouter,
  agentBus,
};