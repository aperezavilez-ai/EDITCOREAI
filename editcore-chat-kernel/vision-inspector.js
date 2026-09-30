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
  const issues = [];
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
    issues,
    renderOk: issues.length === 0,
  };
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
    await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });
    await new Promise((r) => setTimeout(r, 600));
    const diagnostics = await page.evaluate(collectLayoutDiagnostics);
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
    await page.goto(url, { waitUntil: "networkidle", timeout: 35000 });
    await new Promise((r) => setTimeout(r, 500));
    const diagnostics = await page.evaluate(collectLayoutDiagnostics);
    await page.screenshot({ path: outPath, type: "png" });
    return { engine: "playwright", diagnostics };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
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

  try {
    const shot = await withPuppeteer(url, size, outPath);
    engine = shot.engine;
    diagnostics = shot.diagnostics;
  } catch (err) {
    lastError = err;
    try {
      const shot = await withPlaywright(url, size, outPath);
      engine = shot.engine;
      diagnostics = shot.diagnostics;
    } catch (err2) {
      lastError = err2;
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
        hint: "Abre el preview (iframe) o instala puppeteer: npm i puppeteer",
      };
    }
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
};
