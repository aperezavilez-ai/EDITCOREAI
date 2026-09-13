"use strict";

const { capturePreview } = require("../visual-preview-inspector");

function isAllowedBrowserUrl(url, previewUrl = "") {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (previewUrl) {
    try {
      const preview = new URL(previewUrl);
      if (preview.origin === parsed.origin) return true;
    } catch {}
  }
  return false;
}

/**
 * Inspeccion visual segura: solo preview local / localhost.
 * Reutiliza capturePreview; no navega a internet arbitraria.
 */
async function inspectBrowser({
  BrowserWindow,
  startProjectPreview,
  rootPath,
  senderId,
  appUserData,
  url = "",
  viewport = "desktop",
} = {}) {
  if (!BrowserWindow || !startProjectPreview || !rootPath) {
    return { available: false, message: "inspect_browser no disponible en este contexto." };
  }
  const preview = await startProjectPreview(rootPath, senderId);
  if (!preview?.available || !preview.url) {
    return {
      available: false,
      message: String(preview?.message || preview?.reason || "Preview no disponible."),
    };
  }
  const target = String(url || preview.url).trim() || preview.url;
  if (!isAllowedBrowserUrl(target, preview.url)) {
    return {
      available: false,
      blocked: true,
      message: "URL bloqueada. inspect_browser solo permite el preview local (localhost).",
      previewUrl: preview.url,
    };
  }
  const fs = require("node:fs");
  const path = require("node:path");
  const outputRoot = path.join(String(appUserData || ""), "preview-inspections", path.basename(rootPath));
  fs.mkdirSync(outputRoot, { recursive: true });
  const result = await capturePreview({
    BrowserWindow,
    url: target,
    viewport,
    outputRoot,
  });
  return {
    available: true,
    ...result,
    previewUrl: preview.url,
    inspectedUrl: target,
  };
}

module.exports = { inspectBrowser, isAllowedBrowserUrl };
