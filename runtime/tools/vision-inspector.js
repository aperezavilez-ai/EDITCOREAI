"use strict";

/**
 * Inspección visual del preview compilado (iframe / localhost).
 * Puppeteer → Playwright → helpers Electron (si se pasan).
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_PREVIEW_URL = "http://127.0.0.1:4568/";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

function assertLocalPreviewUrl(url) {
  const raw = String(url || DEFAULT_PREVIEW_URL).trim() || DEFAULT_PREVIEW_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL de preview inválida");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Solo http/https");
  }
  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Solo se permiten capturas de localhost / 127.0.0.1");
  }
  return parsed.href;
}

function visionDir(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function collectLayoutDiagnostics() {
  const root = document.documentElement;
  const body = document.body;
  if (!body) {
    return { title: document.title || "", empty: true, issues: ["Sin document.body"], renderOk: false };
  }
  const interactive = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
    .filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((node) => {
      const r = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        text: (node.textContent || node.getAttribute("aria-label") || "").trim().slice(0, 80),
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    });
  const clipped = interactive.filter((r) =>
    r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > Math.max(innerHeight, root.scrollHeight) + 2
  );
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter((n) => n.offsetParent !== null)
    .slice(0, 12)
    .map((n) => (n.textContent || "").trim().slice(0, 120));
  const horizontalOverflow = root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1;
  const textLen = (body.innerText || "").trim().length;
  let overlayText = "";
  try {
    const overlay = document.querySelector("vite-error-overlay");
    overlayText = String(overlay?.shadowRoot?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600);
  } catch { /* overlay sin acceso */ }
  const issues = [];
  if (overlayText) issues.push(`Error visible en pantalla (overlay): ${overlayText.slice(0, 220)}`);
  if (textLen < 20 && interactive.length < 1) issues.push("Página casi vacía o sin contenido visible");
  if (horizontalOverflow) issues.push("Overflow horizontal detectado (posible error de maquetación)");
  if (clipped.length) issues.push(`Controles recortados: ${clipped.length}`);
  if (!headings.length && textLen > 80) issues.push("Sin encabezados visibles (jerarquía débil)");
  return {
    title: document.title || "",
    empty: false,
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: root.scrollWidth, height: root.scrollHeight },
    horizontalOverflow,
    visibleControls: interactive.length,
    clippedControls: clipped.slice(0, 15),
    headings,
    bodyTextLength: textLen,
    overlayText,
    issues,
    renderOk: issues.length === 0,
  };
}

/**
 * Los errores de consola/runtime son LA evidencia en un turno de
 * reparación: sin ellos la captura solo decía "página vacía" y el agente
 * tenía que pedirle al usuario que pegara la imagen del error (sesión
 * VIXERAI, 2026-11-10). Los errores (no los warnings) marcan renderOk
 * en falso y entran a issues; la lista viaja en diagnostics.
 */
function mergeConsoleErrors(diagnostics, consoleErrors) {
  if (!diagnostics || !Array.isArray(consoleErrors)) return diagnostics;
  diagnostics.consoleErrors = consoleErrors.slice(0, 10);
  const errs = consoleErrors.filter((e) => e && e.type !== "warning").slice(0, 10);
  if (errs.length) {
    diagnostics.issues = Array.isArray(diagnostics.issues) ? diagnostics.issues : [];
    diagnostics.issues.push(`Errores de consola/runtime: ${errs[0].text.slice(0, 220)}`);
    diagnostics.renderOk = false;
  }
  return diagnostics;
}

async function withPuppeteer(url, size, outPath) {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const puppeteer = require("puppeteer");
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      try {
        const t = msg.type();
        if (t === "error" || t === "warning") consoleErrors.push({ type: t, text: String(msg.text() || "").slice(0, 300) });
      } catch { /* ignore */ }
    });
    page.on("pageerror", (err) => { consoleErrors.push({ type: "error", text: String(err?.message || err).slice(0, 300) }); });
    await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });
    await new Promise((r) => setTimeout(r, 600));
    const diagnostics = mergeConsoleErrors(await page.evaluate(collectLayoutDiagnostics), consoleErrors);
    await page.screenshot({ path: outPath, fullPage: false, type: "png" });
    return { engine: "puppeteer", diagnostics };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function withPlaywright(url, size, outPath) {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { chromium } = require("playwright");
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      try {
        const t = msg.type();
        if (t === "error" || t === "warning") consoleErrors.push({ type: t, text: String(msg.text() || "").slice(0, 300) });
      } catch { /* ignore */ }
    });
    page.on("pageerror", (err) => { consoleErrors.push({ type: "error", text: String(err?.message || err).slice(0, 300) }); });
    await page.goto(url, { waitUntil: "networkidle", timeout: 35000 });
    await new Promise((r) => setTimeout(r, 500));
    const diagnostics = mergeConsoleErrors(await page.evaluate(collectLayoutDiagnostics), consoleErrors);
    await page.screenshot({ path: outPath, type: "png" });
    return { engine: "playwright", diagnostics };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Motor principal en la app instalada: una ventana Electron fuera de
 * pantalla del propio proceso principal. Puppeteer y Playwright son
 * dependencias de desarrollo que NO viajan en el instalador, así que
 * pedirlas como requisito dejaba al agente CIEGO en producción
 * (landing de Taller Luis, 2026-11-10: "Cannot find module
 * 'playwright'" y la página se cerró sin una sola captura). Electron
 * siempre está: es la app misma. Fuera de Electron (tests, CLI) este
 * motor se descarta en silencio y sigue la cadena de respaldo.
 */
async function withElectron(url, size, outPath) {
  let BrowserWindow = null;
  try {
    const electron = require("electron");
    BrowserWindow = electron && electron.BrowserWindow;
  } catch { /* sin Electron en este proceso */ }
  if (typeof BrowserWindow !== "function") throw new Error("Electron no disponible en este proceso");
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  });
  const consoleErrors = [];
  const onConsole = (_event, level, message) => {
    if (level >= 2) consoleErrors.push({ type: level >= 3 ? "error" : "warning", text: String(message || "").slice(0, 300) });
  };
  win.webContents.on("console-message", onConsole);
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout cargando el preview (35 s)")), 35000)),
    ]);
    await new Promise((r) => setTimeout(r, 700));
    let diagnostics = null;
    try {
      diagnostics = await win.webContents.executeJavaScript(`(${collectLayoutDiagnostics.toString()})()`, true);
    } catch { diagnostics = null; }
    if (!diagnostics || typeof diagnostics !== "object") {
      diagnostics = { title: "", empty: true, issues: ["No se pudo evaluar el DOM del preview"], renderOk: false };
    }
    diagnostics = mergeConsoleErrors(diagnostics, consoleErrors);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(outPath, image.toPNG());
    return { engine: "electron", diagnostics };
  } finally {
    try { win.webContents.removeListener("console-message", onConsole); } catch { /* ignore */ }
    try { win.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Captura el preview activo (por defecto http://127.0.0.1:4568/).
 * @param {object} [opts]
 * @param {string} [opts.url]
 * @param {string} [opts.projectRoot]
 * @param {'desktop'|'mobile'} [opts.viewport]
 * @param {Function} [opts.electronCapture] fallback Electron helpers.capturePreview
 */
async function capture_preview_screenshot(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const url = assertLocalPreviewUrl(opts.url || DEFAULT_PREVIEW_URL);
  const mode = opts.viewport === "mobile" ? "mobile" : "desktop";
  const size = VIEWPORTS[mode];
  const dir = visionDir(projectRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(dir, `preview-${stamp}-${mode}.png`);

  let engine = null;
  let diagnostics = null;
  let lastError = null;

  // Cadena de motores: Electron nativo primero (el único garantizado en
  // la app instalada), luego Puppeteer y Playwright si el entorno los
  // trae, y al final el helper Electron inyectado por el llamante.
  const attempts = [
    () => withElectron(url, size, outPath),
    () => withPuppeteer(url, size, outPath),
    () => { require.resolve("playwright"); return withPlaywright(url, size, outPath); },
  ];
  for (const attempt of attempts) {
    try {
      const shot = await attempt();
      engine = shot.engine;
      diagnostics = shot.diagnostics;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!engine) {
    if (typeof opts.electronCapture === "function") {
      try {
        const electronShot = await opts.electronCapture({
          url,
          viewport: mode,
        });
        if (electronShot?.ok !== false && (electronShot?.screenshotPath || electronShot?.imageDataUrl)) {
          if (electronShot.screenshotPath && fs.existsSync(electronShot.screenshotPath)) {
            try { fs.copyFileSync(electronShot.screenshotPath, outPath); } catch { /* keep original path */ }
          } else if (electronShot.imageDataUrl) {
            const b64 = String(electronShot.imageDataUrl).replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
          }
          return {
            ok: true,
            engine: "electron",
            url,
            viewport: mode,
            screenshotPath: electronShot.screenshotPath || path.relative(projectRoot, outPath).replace(/\\/g, "/"),
            screenshotAbs: outPath,
            screenshotBytes: fs.existsSync(outPath) ? fs.statSync(outPath).size : electronShot.screenshotBytes || 0,
            diagnostics: electronShot.diagnostics || { issues: [], renderOk: true },
            renderOk: electronShot.diagnostics?.renderOk !== false,
            multimodalHint: buildMultimodalHint(electronShot.diagnostics),
          };
        }
      } catch (err3) {
        lastError = err3;
      }
    }
    return {
      ok: false,
      url,
      viewport: mode,
      error: String(lastError?.message || lastError || "No se pudo capturar el preview").slice(0, 500),
      hint: "La captura usa el navegador interno de la app: abre el preview del proyecto y verifica que su servidor local esté corriendo.",
    };
  }

  const bytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  if (bytes < 800) {
    return {
      ok: false,
      url,
      viewport: mode,
      engine,
      error: "Captura vacía o incompleta",
      screenshotPath: path.relative(projectRoot, outPath).replace(/\\/g, "/"),
    };
  }

  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
  return {
    ok: true,
    engine,
    url,
    viewport: mode,
    screenshotPath: path.relative(projectRoot, outPath).replace(/\\/g, "/"),
    screenshotAbs: outPath,
    screenshotBytes: bytes,
    diagnostics,
    renderOk: diagnostics?.renderOk !== false && issues.length === 0,
    multimodalHint: buildMultimodalHint(diagnostics),
  };
}

function buildMultimodalHint(diagnostics) {
  if (!diagnostics || diagnostics.empty) {
    return "La captura sugiere una página vacía o sin body. Revisa si el preview arrancó.";
  }
  const issues = diagnostics.issues || [];
  if (!issues.length) {
    return "Render aparentemente correcto: sin overflow horizontal ni controles recortados evidentes. Evalúa estética/jerarquía con la captura.";
  }
  return `Posibles problemas de maquetación: ${issues.join("; ")}`;
}

/** Alias camelCase */
const capturePreviewScreenshot = capture_preview_screenshot;

module.exports = {
  capture_preview_screenshot,
  capturePreviewScreenshot,
  DEFAULT_PREVIEW_URL,
  assertLocalPreviewUrl,
  visionDir,
  withElectronCapture: withElectron,
  mergeConsoleErrors,
};
