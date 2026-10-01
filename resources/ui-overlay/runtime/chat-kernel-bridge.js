"use strict";

const path = require("path");
const {
  handleChat,
  stopChat,
  steerChat,
  isChatRunning,
  classify,
} = require("../editcore-chat-kernel/index");

const KERNEL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — el adapter tiene su propio deadline interno (analysis-depth.js)

function buildKernelHelpers({ BrowserWindow, capturePreview, previewUrl, appUserData, onProcessChunk, onProcessSevereError, abortSignal, brainSearch, readConnections }) {
  return {
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
}) {
  const mode = String(permissionMode || "").toLowerCase();

  // NOTA: se eliminó el caso "(planAuthorizedExecution && mode === 'plan')"
  // que convertía a full access por error. Solo fullAccess/permissionFull/mode=full.
  const isFull = Boolean(
    fullAccess === true ||
    permissionFull === true ||
    mode === "full"
  );

  const chatHistory = Array.isArray(history)
    ? history
    : Array.isArray(messages)
      ? messages
      : [];

  // threadId estable: si no viene, generar uno (evita hilos huérfanos por mensaje).
  const tid = String(threadId || chatId || "").trim()
    || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Heartbeat cada 5s para que la UI muestre actividad mientras el kernel trabaja.
  const heartbeatStart = Date.now();
  const heartbeat = setInterval(() => {
    try {
      const elapsedSec = Math.floor((Date.now() - heartbeatStart) / 1000);
      onProgress?.({ phase: "heartbeat", text: "Procesando…", elapsedMs: elapsedSec * 1000 });
    } catch { /* ignore */ }
  }, 5_000);

  try {
    const result = await Promise.race([
      handleChat({
        message,
        history: chatHistory,
        threadId: tid,
        chatId: tid,
        projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        images: Array.isArray(images) ? images : [],
        fallbackProfiles: Array.isArray(fallbackProfiles) ? fallbackProfiles : [],
        skillsPrompt: String(skillsPrompt || ""),
        onProgress,
        helpers: helpers || {},
        autoHeal: autoHeal || null,
        allowWrite: isFull ? true : (allowWrite !== false && mode !== "readonly"),
        permissionMode: isFull ? "full" : (permissionMode || "step"),
        permissionFull: isFull,
        fullAccess: isFull,
        planAuthorizedExecution: planAuthorizedExecution === true,
      }),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(Object.assign(new Error("KERNEL_TIMEOUT: el kernel superó 4 minutos"), { code: "KERNEL_TIMEOUT" })),
          KERNEL_TIMEOUT_MS,
        )
      ),
    ]);
    return { ...result, threadId: tid, kernelError: result?.error === true };
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