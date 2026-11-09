"use strict";

const path = require("path");
const {
  handleChat,
// [EDITCORE] Ensure step budget is respected and final response always closes properly.
  stopChat,
  steerChat,
  isChatRunning,
  classify,
} = require("../editcore-chat-kernel/index");

const KERNEL_TIMEOUT_MS = 60 * 60 * 1000; // 60 min — el agente nunca se queda sin tiempo en tareas complejas

function buildKernelHelpers({ BrowserWindow, capturePreview, previewUrl, appUserData, onProcessChunk, onProcessSevereError, abortSignal, brainSearch, readConnections, ...extra }) {
  return {
    ...extra,
    previewUrl: previewUrl || "",
    userDataPath: appUserData || "",
    brainSearch: typeof brainSearch === "function" ? brainSearch : null,
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
  fallbackProfiles,
  skillsPrompt,
  maxSteps,
  totalTimeoutMs,
}) {
  const mode = String(permissionMode || "").toLowerCase();

  // NOTA: se eliminó el caso "(planAuthorizedExecution && mode === 'plan')"
  // que convertía a full access por error. Solo fullAccess/permissionFull/mode=full.
  const isFull = Boolean(
    fullAccess === true ||
    permissionFull === true ||
    mode === "full"
  );

  // threadId estable: si no viene, generar uno (evita hilos huérfanos por mensaje).
  const tid = String(threadId || chatId || "").trim()
    || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { isCasualPrompt, localConversationResponse } = require("./chat-local");
  if (isCasualPrompt(message)) {
    const casualText = localConversationResponse(message) || "Hola. ¿En qué te ayudo?";
    onProgress?.({ phase: "delta", text: casualText });
    return {
      ok: true,
      text: casualText,
      steps: [],
      threadId: tid,
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
      onProgress?.({ phase: "heartbeat", text: "Procesando…", elapsedMs: elapsedSec * 1000 });
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
      projectRoot,
      apiBaseUrl,
      apiKey,
      model,
      images: Array.isArray(images) ? images : [],
      onProgress,
      helpers,
      autoHeal,
      allowWrite,
      permissionMode,
      permissionFull,
      fullAccess,
      planAuthorizedExecution,
      fallbackProfiles,
      skillsPrompt,
      maxSteps,
    });

    if (out?.error || out?.kind === "ERROR") {
      const err = new Error(out?.error || out?.text || "Error en ejecución del kernel");
      err.code = "KERNEL_FAILED";
      err.threadId = tid;
      err.kernelFailed = true;
      throw err;
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
      kernel: true,
      brain: true,
      kind: isStopped ? "STOP" : out?.kind,
      incomplete: isStopped || !!out?.incomplete,
      mutations: out?.mutations,
      usage: out?.usage,
      report: { completed: ok && !out?.incomplete && !isStopped, role: "assistant" },
    };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 400);
    try {
      onProgress?.({ phase: "error", text: message, stage: "kernel_failed" });
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
  steerChatKernel: steerChat,
  isChatKernelRunning: isChatRunning,
  classifyChatKernel: classify,
  buildKernelHelpers,
  handleChat,
  stopChat,
  steerChat,
  classify,
};
