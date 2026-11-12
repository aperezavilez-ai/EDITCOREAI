"use strict";

const path = require("path");
const {
  handleChat,
// [EDITCORE] Ensure step budget is respected and final response always closes properly.
  stopChat,
  // [EDITCORE-INTEGRAL-B7] Cancelación por runId y plazo de cola del kernel.
  cancelChatRun,
  QUEUE_TIMEOUT_MS,
  steerChat,
  isChatRunning,
  classify,
} = require("../editcore-chat-kernel/index");

const KERNEL_TIMEOUT_MS = 60 * 60 * 1000; // 60 min — el agente nunca se queda sin tiempo en tareas complejas
// [EDITCORE-INTEGRAL-B7] El plazo de COLA vive en el kernel
// (QUEUE_TIMEOUT_MS, 120 s) y es deliberadamente menor que
// KERNEL_TIMEOUT_MS: quien espera en cola no consume el plazo de
// ejecución de su turno; al vencer recibe el resultado honesto
// «sigue en cola» en su propia burbuja (ver index.js).

function buildKernelHelpers({ BrowserWindow, capturePreview, previewUrl, startPreview, appUserData, onProcessChunk, onProcessSevereError, abortSignal, brainSearch, brainRemember, brainReadSkill, readConnections, refreshAccessToken, ...extra }) {
  return {
    ...extra,
    // [EDITCORE-INTEGRAL-B6] Costura de sesión viva: el kernel la usa
    // para re-pedir el token UNA vez ante NO_SESSION y reintentar el
    // paso con el token fresco (main la conecta a authManager).
    refreshAccessToken: typeof refreshAccessToken === "function" ? refreshAccessToken : (typeof extra.refreshSessionToken === "function" ? extra.refreshSessionToken : null),
    previewUrl: previewUrl || "",
    // [EDITCORE-INTEGRAL-B4] Costura del preview para el kernel: la
    // herramienta start_preview de tools.js llama helpers.startPreview
    // (main lo conecta a su startProjectPreview). Sin esta costura la
    // herramienta responde honestamente «no disponible en esta ruta».
    startPreview: typeof startPreview === "function" ? startPreview : null,
    userDataPath: appUserData || "",
    brainSearch: typeof brainSearch === "function" ? brainSearch : null,
    brainRemember: typeof brainRemember === "function" ? brainRemember : null,
    brainReadSkill: typeof brainReadSkill === "function" ? brainReadSkill : null,
    readConnections: typeof readConnections === "function" ? readConnections : null,
    abortSignal: abortSignal || null,
    onProcessChunk: typeof onProcessChunk === "function" ? onProcessChunk : null,
    onProcessSevereError: typeof onProcessSevereError === "function" ? onProcessSevereError : null,
    async capturePreview(opts = {}) {
      if (typeof capturePreview !== "function" || !BrowserWindow) {
        throw new Error("Captura visual no disponible");
      }
      const url = String(opts.url || previewUrl || "").trim();
      if (!url) throw new Error("Sin URL de preview");
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
        throw new Error("Solo se permiten capturas de localhost");
      }
      return capturePreview({
        BrowserWindow,
        url,
        viewport: opts.viewport || "desktop",
        outputRoot: path.join(appUserData || process.cwd(), "preview-captures"),
      });
    },
  };
}

async function runKernelChat({
  message,
  history,
  messages,
  threadId,
  chatId,
  // [EDITCORE-INTEGRAL-B7] Identidad de la corrida y plazo de cola:
  // el runId lo genera/manda el renderer (ruta chat igual que la de
  // agente) y aquí jamás se vacía: entra al kernel y sale en CADA
  // evento de progreso y en el resultado.
  runId,
  queueTimeoutMs,
  projectRoot,
  apiBaseUrl,
  apiKey,
  model,
  images,
  onProgress,
  helpers,
  autoHeal,
  allowWrite,
  permissionMode,
  permissionFull,
  fullAccess,
  planAuthorizedExecution,
  // [EDITCORE-INTEGRAL-B5] Nombres de la autorización en las demás
  // rutas (el renderer la manda como planAuthorized en agent:run) y el
  // dato de chat nuevo para el anuncio de modo: el bridge los acepta
  // y los NORMALIZA a la costura del kernel, sin reconstruir nada
  // desde el texto del prompt.
  planAuthorized,
  authorizedContinuation,
  isNewChat,
  chatIsNew,
  // [EDITCORE-V492-1] Opt-out EXPLÍCITO del acceso completo permanente:
  // solo lo pasa main para sus corridas INTERNAS del Inspector
  // (agentId inspector-* / namespace inspector), que son un subsistema
  // interno y no la superficie del chat. Sin este flag, TODO turno de
  // usuario se normaliza aquí a acceso completo (regla de producto de
  // Luis, 2026-11-11: «que quede con todos los permisos y ya»).
  respectRestrictiveMode,
  fallbackProfiles,
  skillsPrompt,
  maxSteps,
  totalTimeoutMs,
}) {
  // [EDITCORE-INTEGRAL-B5] La autorización viaja como DATO estructurado
  // hasta handle(): cualquier nombre de ruta vale, el kernel recibe
  // siempre planAuthorizedExecution.
  const planAuthorizedData = planAuthorizedExecution === true
    || planAuthorized === true
    || authorizedContinuation === true;
  const newChatData = isNewChat === true || chatIsNew === true;
  const mode = String(permissionMode || "").toLowerCase();

  // NOTA: se eliminó el caso "(planAuthorizedExecution && mode === 'plan')"
  // que convertía a full access por error. Solo fullAccess/permissionFull/mode=full.
  const isFull = Boolean(
    fullAccess === true ||
    permissionFull === true ||
    mode === "full"
  );

  // [EDITCORE-V492-1] ACCESO COMPLETO PERMANENTE: esta es la ÚNICA
  // costura app→kernel, así que la normalización vive aquí y cubre
  // todas las rutas de usuario (chat y agente): cualquier modo guardado
  // o heredado («solo lectura»/Charla, «step»/Pregunta antes, por
  // proyecto, por chat o global) llega al kernel como acceso completo
  // efectivo. Con el modo efectivo siempre «full», el anuncio de modo
  // restrictivo del kernel nunca puede dispararse y ninguna
  // herramienta (write/publish/capture/run) se bloquea por modo. La
  // maquinaria de compuerta del kernel NO se toca: sigue existiendo y
  // probada; la app simplemente nunca le entrega un modo restrictivo.
  // Única excepción: respectRestrictiveMode === true, que main pasa
  // SOLO para las corridas internas del Inspector.
  const forceFullAccess = respectRestrictiveMode !== true;
  const effectivePermissionMode = forceFullAccess ? "full" : permissionMode;
  const effectiveFullAccess = forceFullAccess ? true : fullAccess;
  const effectivePermissionFull = forceFullAccess ? true : permissionFull;
  const effectiveAllowWrite = forceFullAccess ? true : allowWrite;

  // threadId estable: si no viene, generar uno (evita hilos huérfanos por mensaje).
  const tid = String(threadId || chatId || "").trim()
    || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // [EDITCORE-INTEGRAL-B7] runId de la corrida: viene del renderer o se
  // genera UNA vez aquí; nunca vacío. emitProgress es la ÚNICA puerta
  // de progreso del bridge: estampa runId/chatId/threadId en cada
  // evento (kernel, heartbeat, casual y error), para que el renderer
  // enrute cada evento a SU tarjeta y nunca a «la primera que haya».
  const rid = String(runId || "").trim()
    || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const emitProgress = (p) => {
    if (typeof onProgress !== "function") return;
    const base = p && typeof p === "object" ? p : { text: String(p || "") };
    try { onProgress({ ...base, runId: rid, chatId: chatId || tid, threadId: tid }); } catch { /* ignore */ }
  };

  const { isCasualPrompt, localConversationResponse } = require("./chat-local");
  if (isCasualPrompt(message)) {
    const casualText = localConversationResponse(message) || "Hola. ¿En qué te ayudo?";
    emitProgress({ phase: "delta", text: casualText });
    return {
      ok: true,
      text: casualText,
      steps: [],
      threadId: tid,
      runId: rid,
      kernel: true,
      brain: true,
      casual: true,
      report: { completed: true, role: "assistant" },
    };
  }

  const chatHistory = (Array.isArray(history) ? history : Array.isArray(messages) ? messages : [])
    .filter((msg) => {
      if (!msg) return false;
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content.includes("buildKernelProcessHooks is not defined") || content.includes("Error invoking remote method")) {
        return false;
      }
      return true;
    });

  // Heartbeat cada 5s para que la UI muestre actividad mientras el kernel trabaja.
  const heartbeatStart = Date.now();
  const heartbeat = setInterval(() => {
    try {
      const elapsedSec = Math.floor((Date.now() - heartbeatStart) / 1000);
      emitProgress({ phase: "heartbeat", text: "Procesando…", elapsedMs: elapsedSec * 1000 });
    } catch { /* ignore */ }
  }, 5_000);

  try {
    // MOTOR ÚNICO (unificación): el chat lo ejecuta el ChatOrchestrator del
    // kernel (editcore-chat-kernel), que ya tiene herramientas nativas,
    // cancelación de punta a punta y error explícito ante respuestas vacías.
    // El controlador Cline salió de esta ruta: su código permanece en
    // El motor Cline fue retirado del disco en la convergencia; el chat lo ejecuta solo el kernel.
    // stopChatKernel() (arriba, vía index.js) detiene ESTE motor: el que corre.
    const out = await handleChat({
      message,
      history: chatHistory,
      messages: chatHistory,
      threadId: tid,
      chatId,
      // [EDITCORE-INTEGRAL-B7] La identidad y el plazo de cola viajan
      // al kernel: su registro de corridas y su aviso «en cola» usan
      // este mismo runId.
      runId: rid,
      queueTimeoutMs,
      projectRoot,
      apiBaseUrl,
      apiKey,
      model,
      images: Array.isArray(images) ? images : [],
      onProgress: emitProgress,
      helpers,
      autoHeal,
      // [EDITCORE-V492-1] Valores EFECTIVOS ya normalizados arriba:
      // el kernel recibe «full» en toda corrida de usuario.
      allowWrite: effectiveAllowWrite,
      permissionMode: effectivePermissionMode,
      permissionFull: effectivePermissionFull,
      fullAccess: effectiveFullAccess,
      // [EDITCORE-INTEGRAL-B5] Dato normalizado (ver arriba), no el texto.
      planAuthorizedExecution: planAuthorizedData,
      planAuthorized: planAuthorizedData,
      isNewChat: newChatData,
      fallbackProfiles,
      skillsPrompt,
      maxSteps,
    });

    if (out?.error || out?.kind === "ERROR") {
      const err = new Error(out?.error || out?.text || "Error en ejecución del kernel");
      err.code = "KERNEL_FAILED";
      err.threadId = tid;
      err.runId = rid;
      err.kernelFailed = true;
      throw err;
    }

    // [EDITCORE-INTEGRAL-B7] Resultado honesto de COLA: el turno no se
    // ejecutó porque otro ocupaba el motor al vencer el plazo. No es
    // un error del kernel ni un éxito: viaja como resultado con su
    // texto, para que la burbuja del chat de origen lo muestre tal
    // cual y el usuario decida (reenviar o detener el otro turno).
    if (out?.queued) {
      return {
        ok: false,
        queued: true,
        queueTimeout: true,
        text: String(out?.text || "Tu turno sigue en cola."),
        steps: [],
        threadId: tid,
        runId: rid,
        kernel: true,
        brain: true,
        kind: "QUEUED",
        incomplete: true,
        report: { completed: false, role: "assistant", queued: true },
      };
    }

    const isStopped = out?.kind === "STOP" || String(out?.text || "").includes("Detenido.");
    const ok = !out?.blocked && !isStopped;
    const finalText = out?.text
      || (ok ? "Operación procesada." : (isStopped ? "Detenido." : "Hay un proceso activo. Envía **detente** para cancelarlo antes de mandar otro mensaje."));

    return {
      ok,
      text: finalText,
      steps: Array.isArray(out?.steps) ? out.steps : [],
      threadId: out?.threadId || tid,
      // [EDITCORE-INTEGRAL-B7] El resultado también lleva su runId.
      runId: out?.runId || rid,
      kernel: true,
      brain: true,
      kind: isStopped ? "STOP" : out?.kind,
      incomplete: isStopped || !!out?.incomplete,
      // [EDITCORE-INTEGRAL-B7] Cancelación en cola declarada como dato.
      cancelled: out?.cancelled === true,
      mutations: out?.mutations,
      usage: out?.usage,
      report: { completed: ok && !out?.incomplete && !isStopped, role: "assistant" },
    };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 400);
    try {
      emitProgress({ phase: "error", text: message, stage: "kernel_failed" });
    } catch { /* ignore */ }
    // FIX: propagar el error real. El caller (main.js / renderer) debe marcar
    // la corrida como fallida y mostrar el mensaje. Antes se devolvia un
    // objeto "success" con error:true y el renderer cerraba las bolitas OK.
    const error = new Error(message);
    error.code = err?.code || "KERNEL_FAILED";
    error.threadId = tid;
    error.kernelFailed = true;
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = {
  handleChatKernel: runKernelChat,
  stopChatKernel: stopChat,
  // [EDITCORE-INTEGRAL-B7] Cancelación quirúrgica por runId (main la
  // usa en editcore:cancel / agent:cancel cuando el llamante
  // identifica la corrida) y constantes de plazo declaradas.
  cancelChatKernelRun: cancelChatRun,
  KERNEL_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  steerChatKernel: steerChat,
  isChatKernelRunning: isChatRunning,
  classifyChatKernel: classify,
  buildKernelHelpers,
  handleChat,
  stopChat,
  cancelChatRun,
  steerChat,
  classify,
};
