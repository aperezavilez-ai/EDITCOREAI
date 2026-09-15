"use strict";

const path = require("path");
const {
  handleChat,
  stopChat,
  classify,
} = require("../editcore-chat-kernel");

function buildKernelHelpers({ BrowserWindow, capturePreview, previewUrl, appUserData, onProcessChunk, onProcessSevereError, abortSignal }) {
  return {
    previewUrl: previewUrl || "",
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
}) {
  const mode = String(permissionMode || "").toLowerCase();
  const isFull = fullAccess === true
    || permissionFull === true
    || mode === "full"
    || (planAuthorizedExecution === true && mode === "full");

  const chatHistory = Array.isArray(history)
    ? history
    : Array.isArray(messages)
      ? messages
      : [];

  return handleChat({
    message,
    history: chatHistory,
    messages: chatHistory,
    projectRoot,
    apiBaseUrl,
    apiKey,
    model,
    images: Array.isArray(images) ? images : [],
    onProgress,
    helpers: helpers || {},
    autoHeal: autoHeal || null,
    allowWrite: isFull ? true : (allowWrite !== false && mode !== "readonly"),
    permissionMode: isFull ? "full" : (permissionMode || "step"),
    permissionFull: isFull,
    fullAccess: isFull,
    planAuthorizedExecution: isFull || planAuthorizedExecution === true,
  });
}

module.exports = {
  handleChatKernel: runKernelChat,
  stopChatKernel: stopChat,
  classifyChatKernel: classify,
  buildKernelHelpers,
  handleChat,
  stopChat,
  classify,
};