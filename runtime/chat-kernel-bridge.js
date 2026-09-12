"use strict";

/**
 * Puente Electron ↔ editcore-chat-kernel.
 */

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
  projectRoot,
  apiBaseUrl,
  apiKey,
  model,
  onProgress,
  helpers,
  autoHeal,
}) {
  return handleChat({
    message,
    projectRoot,
    apiBaseUrl,
    apiKey,
    model,
    onProgress,
    helpers: helpers || {},
    autoHeal: autoHeal || null,
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
