"use strict";

/**
 * Núcleo de chat EditCore — entrada única.
 *
 *   const { handleChat, stopChat } = require("./editcore-chat-kernel");
 *   const out = await handleChat({ message, projectRoot, apiBaseUrl, apiKey, model, onProgress });
 */

const { ChatOrchestrator, hasMutationIntent } = require("./orchestrator");
const { classify } = require("./classify");
// [EDITCORE-V510-B1] Carril del conserje (solo lectura, en paralelo).
const { runConcierge } = require("./concierge");
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
    // [EDITCORE-V510-B1b] Texto de SISTEMA, no del modelo: el recibo
    // no debe estimar tokens de salida sobre él (el caso ↓75 de Luis:
    // 297 caracteres ÷ 4 asentados como si el modelo hubiera hablado).
    systemNotice: true,
    usage: { system_notice: true },
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

// [EDITCORE-V510-B1] ¿Es una CONSULTA PURA? (preguntar, listar,
// analizar, verificar — sin intención de mutación). Solo esas pueden
// salir de la cadena hacia el conserje: una instrucción o una tarea
// jamás se atiende por el carril de solo lectura.
const PURE_QUERY_KINDS = new Set(["ASK", "LIST", "ANALYZE", "VERIFY"]);
function isPureKernelQuery(input = {}) {
  const message = String(input?.message || "");
  if (!message.trim()) return false;
  try {
    if (hasMutationIntent(message)) return false;
    const c = classify(message);
    return Boolean(c && c.allowWrite === false && PURE_QUERY_KINDS.has(c.kind));
  } catch { return false; }
}

// [EDITCORE-V510-B1b] Resultado de una entrada VENCIDA que se fundió
// como steering del turno en curso: el mensaje NO se descartó — el
// agente lo atiende dentro de la tarea que ya corre. Texto de
// sistema: cero tokens estimados en el recibo.
function steeredResult(entry, waitedMs) {
  const seconds = Math.max(1, Math.round(waitedMs / 1000));
  return {
    kind: "STEERED",
    steered: true,
    systemNotice: true,
    usage: { system_notice: true },
    runId: entry.runId,
    chatId: entry.chatId || "",
    waitedMs,
    text: [
      `## 🧭 Tu mensaje se fundió con el turno en curso`,
      "",
      `Llevaba ${seconds} s en cola: en vez de descartarlo, lo entregué como instrucción (steering) al turno que está trabajando, que lo atiende dentro de su tarea. Nada se perdió y este aviso no consumió tokens del modelo.`,
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

// [EDITCORE-V510-B1] Desvío al CONSERJE: atiende la consulta por su
// carril paralelo con AbortController PROPIO (cancelarla no toca la
// corrida principal). Si el carril no puede atender (sin clave o
// fallo del proveedor), la consulta NO se pierde:
//  - hasSlot=false (desvío al llegar, sin sitio en la cadena): se
//    encola por la ruta de siempre.
//  - hasSlot=true (desvío al vencer el plazo, con sitio): queda en
//    ESPERA DECLARADA en su sitio y ejecuta cuando la cadena la
//    recoja.
async function divertToConcierge(entry, safeInput, { hasSlot = false } = {}) {
  const controller = new AbortController();
  entry.controller = controller;
  entry.state = "concierge";
  try {
    safeInput.onProgress?.({ phase: "concierge", runId: entry.runId, chatId: entry.chatId, text: "El agente principal sigue con su tarea; esta consulta la atiende ahora el conserje, en solo lectura y sin tocar archivos." });
  } catch { /* el aviso no tumba el turno */ }
  let out = null;
  try {
    out = await runConcierge({
      message: safeInput.message,
      projectRoot: safeInput.projectRoot,
      threadId: safeInput.threadId,
      apiBaseUrl: safeInput.apiBaseUrl,
      apiKey: safeInput.apiKey,
      model: safeInput.model,
      helpers: safeInput.helpers,
      signal: controller.signal,
      onProgress: safeInput.onProgress,
    });
  } catch { out = null; }
  if (controller.signal.aborted) {
    entry.state = "done";
    _runs.delete(entry.runId);
    entry.resolveCaller(queueCancelledResult(entry));
    return;
  }
  if (out) {
    entry.state = "done";
    _runs.delete(entry.runId);
    entry.resolveCaller({ ...out, runId: entry.runId, chatId: entry.chatId || "" });
    return;
  }
  if (hasSlot) {
    entry.state = "waiting";
    try {
      safeInput.onProgress?.({ phase: "queued-wait", runId: entry.runId, chatId: entry.chatId, text: "El conserje no pudo atender esta consulta; queda en espera declarada y se ejecutará en cuanto el motor se libere. No se descarta." });
    } catch { /* el aviso no tumba el turno */ }
  } else {
    entry.state = "queued";
    enqueueTurn(entry, safeInput);
  }
}

// La ruta de siempre: la cadena serial del orquestador único, con su
// plazo de cola. [EDITCORE-V510-B1b] Al vencer el plazo la entrada YA
// NO se descarta (antes resolvía QUEUED y el pickup la tiraba: el
// mensaje de Luis caducó a los 120 s sin ejecutarse): consulta pura
// → conserje; instrucción/tarea → se funde como steering del turno
// en curso; sin turno al que fundirla → ESPERA DECLARADA en su sitio
// hasta que la cadena la recoja y la EJECUTE.
function enqueueTurn(entry, input) {
  const runId = entry.runId;
  const prev = _chain;
  let release;
  _chain = new Promise((r) => { release = r; });

  // Aviso de cola: si ya hay otra corrida viva, este turno nace EN
  // COLA y su burbuja lo dice (nunca un «ejecutando» falso).
  if ([..._runs.values()].some((other) => other !== entry && other.state !== "done")) {
    try {
      input.onProgress?.({ phase: "queued", runId, chatId: entry.chatId, text: "En cola: el motor ejecuta de uno en uno." });
    } catch { /* el aviso no tumba el turno */ }
  }

  const queueTimeoutMs = resolveQueueTimeoutMs(input);
  if (queueTimeoutMs > 0) {
    entry.queueTimer = setTimeout(() => {
      if (entry.state !== "queued") return;
      const waitedMs = Date.now() - entry.queuedAt;
      // [EDITCORE-V510-B1b] Venció el plazo: jamás descarte.
      if (isPureKernelQuery(input)) {
        divertToConcierge(entry, input, { hasSlot: true });
        return;
      }
      if (orchestrator.isRunning()) {
        let merged = false;
        try {
          const steerOut = orchestrator.steer(String(input.message || ""));
          merged = Boolean(steerOut) && steerOut.accepted !== false;
        } catch { merged = false; }
        if (merged) {
          entry.state = "steered";
          entry.resolveCaller(steeredResult(entry, waitedMs));
          return;
        }
      }
      entry.state = "waiting";
      try {
        input.onProgress?.({ phase: "queued-wait", runId, chatId: entry.chatId, text: "Tu mensaje sigue en cola y NO se descarta: queda en espera declarada y se ejecutará en cuanto el motor se libere." });
      } catch { /* el aviso no tumba el turno */ }
    }, queueTimeoutMs);
  }

  (async () => {
    await prev;
    if (entry.queueTimer) { clearTimeout(entry.queueTimer); entry.queueTimer = null; }
    if (entry.state === "concierge") {
      // El desvío al conserje posee la resolución de esta entrada;
      // aquí solo se libera su sitio de la cadena.
      release();
      return;
    }
    if (entry.state !== "queued" && entry.state !== "waiting") {
      // Cancelada o fundida (steered): nunca llega al orquestador.
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
          systemNotice: true,
          usage: { system_notice: true },
          runId,
          chatId: entry.chatId || "",
        });
        return;
      }
      const out = await orchestrator.handle({ ...input, runId });
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
    controller: null,
  };
  _runs.set(runId, entry);
  const callerPromise = new Promise((resolve, reject) => {
    entry.resolveCaller = resolve;
    entry.rejectCaller = reject;
  });

  // [EDITCORE-V510-B1] Si ya hay una corrida viva y esto es una
  // consulta pura, NO entra en la cadena: la atiende el conserje por
  // su carril, sin esperar a que el motor se libere. Si el motor está
  // libre, el flujo normal no cambia.
  const anotherLive = [..._runs.values()].some((other) => other !== entry && other.state !== "done");
  if ((anotherLive || orchestrator.isRunning()) && isPureKernelQuery(safeInput)) {
    divertToConcierge(entry, safeInput, { hasSlot: false });
    return callerPromise;
  }
  enqueueTurn(entry, safeInput);
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
  if (entry.state === "concierge") {
    // [EDITCORE-V510-B1] Corrida del conserje: se aborta SOLO su
    // señal propia; la corrida principal no se entera. El desvío
    // resuelve al llamante como cancelado al ver la señal.
    try { entry.controller?.abort(); } catch { /* ignore */ }
    return true;
  }
  if (entry.state === "queued" || entry.state === "queue-timeout" || entry.state === "waiting") {
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
  // [EDITCORE-V510-B1/B1b] Clasificación de consulta pura y el
  // resultado de cola (texto de sistema, sin tokens estimados).
  isPureKernelQuery,
  queueTimeoutResult,
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