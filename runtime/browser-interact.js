"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isAllowedBrowserUrl } = require("./browser-inspector");

const sessions = new Map();
const IDLE_MS = 90_000;

function sessionKey(projectRoot = "") {
  return path.resolve(String(projectRoot || "")).toLowerCase();
}

function destroySession(key) {
  const session = sessions.get(key);
  if (!session) return;
  try {
    if (session.idleTimer) clearTimeout(session.idleTimer);
  } catch {}
  try {
    if (session.win && !session.win.isDestroyed()) session.win.destroy();
  } catch {}
  sessions.delete(key);
}

function touch(session, key) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => destroySession(key), IDLE_MS);
  session.lastUsed = Date.now();
}

async function ensureSession({
  BrowserWindow,
  startProjectPreview,
  rootPath,
  senderId,
  url = "",
  viewport = "desktop",
} = {}) {
  if (!BrowserWindow || !startProjectPreview || !rootPath) {
    throw new Error("browser_interact no disponible en este contexto.");
  }
  const preview = await startProjectPreview(rootPath, senderId);
  if (!preview?.available || !preview.url) {
    throw new Error(String(preview?.message || preview?.reason || "Preview no disponible."));
  }
  const target = String(url || preview.url).trim() || preview.url;
  if (!isAllowedBrowserUrl(target, preview.url)) {
    const err = new Error("URL bloqueada. browser_interact solo permite preview local (localhost).");
    err.blocked = true;
    err.previewUrl = preview.url;
    throw err;
  }

  const key = sessionKey(rootPath);
  let session = sessions.get(key);
  const mode = viewport === "mobile" ? "mobile" : "desktop";
  const size = mode === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 };

  if (!session || !session.win || session.win.isDestroyed()) {
    const win = new BrowserWindow({
      show: false,
      useContentSize: true,
      width: size.width,
      height: size.height,
      webPreferences: {
        partition: "editcore-browser-interact",
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    const consoleLogs = [];
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 2) return;
      const text = String(message || "").replace(/%c/g, "").replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();
      if (/electron security warning|insecure content-security-policy|download the react devtools/.test(lower)) return;
      consoleLogs.push({
        level: level >= 3 ? "error" : "warning",
        message: String(message || "").slice(0, 500),
        line: Number(line) || 0,
        source: String(sourceId || "").slice(0, 200),
        at: Date.now(),
      });
      if (consoleLogs.length > 80) consoleLogs.splice(0, consoleLogs.length - 80);
    });
    await win.webContents.session.setProxy({ mode: "direct" });
    await Promise.race([
      win.loadURL(target),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout cargando preview (45s).")), 45_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    session = { win, previewUrl: preview.url, url: target, consoleLogs, viewport: mode };
    sessions.set(key, session);
  } else if (session.url !== target) {
    await Promise.race([
      session.win.loadURL(target),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout navegando preview.")), 45_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    session.url = target;
    session.previewUrl = preview.url;
  }
  touch(session, key);
  return { session, key, previewUrl: preview.url, url: target };
}

async function collectDom(win) {
  return win.webContents.executeJavaScript(`(() => {
    const pick = (sel, limit = 20) => [...document.querySelectorAll(sel)]
      .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .slice(0, limit)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          tag: n.tagName.toLowerCase(),
          id: n.id || "",
          name: n.getAttribute("name") || "",
          type: n.getAttribute("type") || "",
          text: (n.innerText || n.value || n.getAttribute("aria-label") || "").trim().slice(0, 80),
          selector: n.id ? ("#" + CSS.escape(n.id)) : "",
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
    return {
      title: document.title,
      url: location.href,
      headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 12).map((n) => (n.textContent || "").trim().slice(0, 100)),
      buttons: pick('button,a,[role="button"]'),
      inputs: pick("input,textarea,select"),
      bodyText: (document.body?.innerText || "").trim().slice(0, 1200),
    };
  })()`);
}

async function browserInteract(input = {}, ctx = {}) {
  const action = String(input.action || "dom").toLowerCase();
  if (action === "close") {
    destroySession(sessionKey(ctx.rootPath));
    return { ok: true, action: "close" };
  }

  const { session, key, previewUrl, url } = await ensureSession({
    BrowserWindow: ctx.BrowserWindow,
    startProjectPreview: ctx.startProjectPreview,
    rootPath: ctx.rootPath,
    senderId: ctx.senderId,
    url: input.url || "",
    viewport: input.viewport || "desktop",
  });
  const win = session.win;

  if (action === "dom" || action === "get_dom") {
    const dom = await collectDom(win);
    return { ok: true, action: "dom", previewUrl, url, dom };
  }

  if (action === "console" || action === "get_console") {
    return {
      ok: true,
      action: "console",
      previewUrl,
      url,
      logs: session.consoleLogs.slice(-40),
      count: session.consoleLogs.length,
    };
  }

  if (action === "screenshot") {
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    const outputRoot = path.join(String(ctx.appUserData || ""), "preview-inspections", path.basename(String(ctx.rootPath || "project")));
    fs.mkdirSync(outputRoot, { recursive: true });
    const imagePath = path.join(outputRoot, `${Date.now()}-interact.png`);
    fs.writeFileSync(imagePath, png);
    return {
      ok: true,
      action: "screenshot",
      previewUrl,
      url,
      screenshotPath: imagePath,
      screenshotBytes: png.length,
    };
  }

  if (action === "click") {
    const selector = String(input.selector || "").trim();
    if (!selector) throw new Error("browser_interact click requiere selector.");
    const clicked = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, message: "Selector no encontrado." };
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.click();
      return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || "").trim().slice(0, 80) };
    })()`);
    touch(session, key);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { ok: clicked?.ok === true, action: "click", previewUrl, url, ...clicked };
  }

  if (action === "type") {
    const selector = String(input.selector || "").trim();
    const text = String(input.text ?? input.value ?? "");
    if (!selector) throw new Error("browser_interact type requiere selector.");
    const typed = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, message: "Selector no encontrado." };
      el.focus();
      const value = ${JSON.stringify(text)};
      if ("value" in el) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        el.textContent = value;
      }
      return { ok: true, tag: el.tagName.toLowerCase() };
    })()`);
    touch(session, key);
    return { ok: typed?.ok === true, action: "type", previewUrl, url, ...typed };
  }

  if (action === "scroll") {
    const y = Number(input.y);
    const delta = Number.isFinite(y) ? y : Number(input.deltaY) || 400;
    await win.webContents.executeJavaScript(`window.scrollBy(0, ${JSON.stringify(delta)})`);
    touch(session, key);
    return { ok: true, action: "scroll", previewUrl, url, deltaY: delta };
  }

  if (action === "wait_for") {
    const selector = String(input.selector || "").trim();
    const timeoutMs = Math.min(30_000, Math.max(500, Number(input.timeoutMs) || 8_000));
    if (!selector) throw new Error("browser_interact wait_for requiere selector.");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`
      );
      if (found) {
        touch(session, key);
        return { ok: true, action: "wait_for", previewUrl, url, selector, waitedMs: Date.now() - started };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { ok: false, action: "wait_for", previewUrl, url, selector, message: "Timeout esperando selector." };
  }

  if (action === "reload") {
    await win.webContents.reloadIgnoringCache();
    await new Promise((resolve) => setTimeout(resolve, 500));
    touch(session, key);
    return { ok: true, action: "reload", previewUrl, url };
  }

  throw new Error(`Accion browser_interact desconocida: ${action}. Usa: dom, console, click, type, scroll, wait_for, screenshot, reload, close.`);
}

function closeBrowserSessionsForProject(projectRoot = "") {
  destroySession(sessionKey(projectRoot));
}

module.exports = {
  browserInteract,
  closeBrowserSessionsForProject,
  isAllowedBrowserUrl,
};
