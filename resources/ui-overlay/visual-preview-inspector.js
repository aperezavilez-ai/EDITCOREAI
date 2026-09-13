"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function capturePreview({ BrowserWindow, url, viewport = "desktop", outputRoot }) {
  const mode = viewport === "mobile" ? "mobile" : "desktop";
  const size = mode === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
  const inspectionWindow = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: size.width,
    height: size.height,
    webPreferences: {
      partition: "editcore-preview-inspection",
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  try {
    inspectionWindow.setContentSize(size.width, size.height);
    await inspectionWindow.webContents.session.setProxy({ mode: "direct" });
    const probe = await inspectionWindow.webContents.session.fetch(url, { method: "GET" });
    if (!probe.ok) throw new Error(`La sesion Electron no pudo abrir el preview local (HTTP ${probe.status}).`);
    await Promise.race([
      inspectionWindow.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("La inspeccion visual excedio 45 segundos.")), 45_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const actualViewport = await inspectionWindow.webContents.executeJavaScript("({ width: innerWidth, height: innerHeight })");
    if (actualViewport.width !== size.width || actualViewport.height !== size.height) {
      inspectionWindow.setContentSize(
        Math.max(1, size.width + (size.width - actualViewport.width)),
        Math.max(1, size.height + (size.height - actualViewport.height))
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const diagnostics = await inspectionWindow.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      const body = document.body;
      const rects = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
        .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map((node) => { const r = node.getBoundingClientRect(); return { tag: node.tagName, text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 80), left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; });
      const clippedControls = rects.filter((r) => r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > Math.max(innerHeight, root.scrollHeight) + 1);
      const headings = [...document.querySelectorAll('h1,h2,h3')].filter((node) => node.offsetParent !== null).slice(0, 12).map((node) => (node.textContent || '').trim().slice(0, 120));
      return {
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: root.scrollWidth, height: root.scrollHeight },
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1,
        visibleControls: rects.length,
        clippedControls: clippedControls.slice(0, 20),
        headings,
        bodyTextLength: (body.innerText || '').trim().length,
      };
    })()`);
    const image = await inspectionWindow.webContents.capturePage();
    const png = image.toPNG();
    if (png.length < 1000) throw new Error("La captura visual esta vacia o incompleta.");
    fs.mkdirSync(outputRoot, { recursive: true });
    const imagePath = path.join(outputRoot, `${Date.now()}-${mode}.png`);
    fs.writeFileSync(imagePath, png);
    return {
      ok: true,
      viewport: mode,
      requestedViewport: size,
      url,
      screenshotPath: imagePath,
      screenshotBytes: png.length,
      diagnostics,
      imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    };
  } finally {
    if (!inspectionWindow.isDestroyed()) inspectionWindow.destroy();
  }
}

module.exports = { capturePreview };
