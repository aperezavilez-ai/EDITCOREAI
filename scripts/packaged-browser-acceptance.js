"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
const projectRoot = String(process.env.EDITCORE_BROWSER_PROJECT || "").trim();
const secondProjectRoot = String(process.env.EDITCORE_BROWSER_PROJECT_B || "").trim();
const previewUrlOverride = String(process.env.EDITCORE_BROWSER_URL || "").trim();
const reportPath = process.env.EDITCORE_BROWSER_REPORT || path.join(process.cwd(), "packaged-browser-acceptance.json");
const screenshotPath = process.env.EDITCORE_BROWSER_SCREENSHOT || path.join(process.cwd(), "packaged-browser-acceptance.png");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-packaged-browser-"));
const debugPort = 9232;
let appProcess;
let apiServer;

if (!projectRoot || !fs.existsSync(projectRoot)) throw new Error("Falta EDITCORE_BROWSER_PROJECT valido.");
if (secondProjectRoot && !fs.existsSync(secondProjectRoot)) throw new Error("EDITCORE_BROWSER_PROJECT_B no existe.");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function persist(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function waitForPage() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page"
        && item.webSocketDebuggerUrl
        && (/^file:/i.test(String(item.url || "")) || /EDITCOREAI/i.test(String(item.title || ""))));
      if (page) {
        const ready = await evaluate(page, "document.readyState === 'complete' && Boolean(window.editcoreProject?.startPreview) && typeof openPreview === 'function'").catch(() => false);
        if (ready) return page;
      }
    } catch {}
    await wait(250);
  }
  throw new Error("El ejecutable no expuso una pagina para la prueba de navegador.");
}

async function findGuest() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const pages = await response.json();
  return pages.find((item) => item.type === "webview" && item.webSocketDebuggerUrl && /^https?:/i.test(String(item.url || ""))) || null;
}

async function waitForGuest() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const guest = await findGuest();
      if (guest) return guest;
    } catch {}
    await wait(250);
  }
  throw new Error("El webview empaquetado no publico su contexto CDP.");
}

async function waitForGuestDocument(expectedUrl) {
  const expectedHost = new URL(expectedUrl).host;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const guestPage = await findGuest();
      if (!guestPage) throw new Error("Webview HTTP aun no disponible.");
      const guest = await evaluate(guestPage, "({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, contentType: document.contentType, href: location.href })");
      if (/^https?:/i.test(String(guest?.href || "")) && new URL(guest.href).host === expectedHost) return guest;
    } catch {}
    await wait(250);
  }
  throw new Error(`El webview no termino de navegar a ${expectedUrl}.`);
}

async function cdp(page, method, params = {}, timeoutMs = 30_000) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP no respondio a ${method}.`));
    }, timeoutMs);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

async function evaluate(page, expression, timeoutMs = 30_000) {
  const response = await cdp(page, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (response?.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || "Runtime.evaluate fallo.");
  return response?.result?.value;
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

function startApiDocumentServer() {
  return new Promise((resolve, reject) => {
    apiServer = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ swagger: "2.0", info: { title: "PostgREST API" }, paths: { "/todos": {} } }));
    });
    apiServer.once("error", reject);
    apiServer.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${apiServer.address().port}`));
  });
}

async function waitForHostCondition(page, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(page, expression).catch(() => false)) return;
    await wait(250);
  }
  throw new Error(message);
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), projectRoot, previewUrlOverride, stage: "starting", ok: false };
  try {
    persist(report);
    const acceptanceEnv = { ...process.env, EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1" };
    if (process.env.EDITCORE_BROWSER_SHOW_WINDOW !== "1") acceptanceEnv.EDITCORE_ACCEPTANCE_HIDDEN = "1";
    appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
      windowsHide: true,
      stdio: "ignore",
      env: process.env.EDITCORE_BROWSER_USE_MAIN_PROFILE === "1"
        ? acceptanceEnv
        : { ...acceptanceEnv, EDITCORE_USER_DATA_PATH: userData },
    });
    const page = await waitForPage();
    report.stage = "window-ready";
    persist(report);
    report.stage = "preview-starting";
    persist(report);
    const preview = previewUrlOverride ? {
      available: true,
      started: false,
      remote: true,
      url: previewUrlOverride,
      runtimeRoot: projectRoot,
    } : await evaluate(page, `(async () => {
      const root = ${JSON.stringify(projectRoot)};
      state.projectRoot = root;
      const preview = await window.editcoreProject.startPreview(root);
      if (!preview?.available || !preview?.url) throw new Error(preview?.message || "Preview no disponible");
      document.getElementById("previewUrl").value = preview.url;
      await openPreview();
      await fitPreviewToPanel();
      return preview;
    })()`, 150_000);
    if (previewUrlOverride) {
      await evaluate(page, `(async () => {
        state.projectRoot = ${JSON.stringify(projectRoot)};
        document.getElementById("previewUrl").value = ${JSON.stringify(previewUrlOverride)};
        await openPreview();
        await fitPreviewToPanel();
      })()`);
    }
    report.stage = "preview-requested";
    persist(report);
    const guest = await waitForGuestDocument(preview.url);
    report.stage = "preview-document-ready";
    persist(report);
    let projectSwitch = null;
    if (secondProjectRoot) {
      report.stage = "project-switch-starting";
      persist(report);
      projectSwitch = await evaluate(page, `(async () => {
        const firstRoot = ${JSON.stringify(projectRoot)};
        const secondRoot = ${JSON.stringify(secondProjectRoot)};
        const first = projectForRoot(firstRoot, "Proyecto A");
        const second = projectForRoot(secondRoot, "Proyecto B");
        if (!state.projects.includes(first)) state.projects.push(first);
        if (!state.projects.includes(second)) state.projects.push(second);
        await selectProject(second.id);
        for (let attempt = 0; attempt < 240; attempt += 1) {
          const url = document.getElementById("previewUrl").value;
          const guestUrl = document.getElementById("previewWebview").getURL();
          if (state.projectRoot === secondRoot && url && guestUrl && guestUrl !== "about:blank" && document.getElementById("previewWebview").dataset.previewReady === "1") {
            return { activeRoot: state.projectRoot, previewUrl: url, guestUrl, projectId: state.activeProjectId };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { activeRoot: state.projectRoot, previewUrl: document.getElementById("previewUrl").value, guestUrl: document.getElementById("previewWebview").getURL(), projectId: state.activeProjectId };
      })()`, 180_000);
      report.projectSwitch = projectSwitch;
      persist(report);
    }
    const host = await evaluate(page, `(() => {
      const webview = document.getElementById("previewWebview");
      const panel = document.querySelector(".viewer-body").getBoundingClientRect();
      const webviewRect = webview.getBoundingClientRect();
      return {
        panel: { width: panel.width, height: panel.height, bottom: panel.bottom },
        webview: { width: webviewRect.width, height: webviewRect.height, bottom: webviewRect.bottom },
        partition: webview.getAttribute("partition"),
        controlsOrder: ["mobilePreviewBtn", "previewBackBtn", "previewUrl"].map((id) => document.getElementById(id).getBoundingClientRect().left),
      };
    })()`, 150_000);
    const apiUrl = await startApiDocumentServer();
    report.stage = "api-guard";
    persist(report);
    await evaluate(page, `(async () => {
      document.getElementById("previewUrl").value = ${JSON.stringify(apiUrl)};
      await openPreview();
    })()`);
    await waitForHostCondition(page, `(() => {
      const webview = document.getElementById("previewWebview");
      return webview.dataset.previewRejected === "api-document";
    })()`, "EDITCOREAI dejo visible el documento OpenAPI en el navegador.");
    const apiGuard = await evaluate(page, `(() => ({
      src: document.getElementById("previewWebview").getAttribute("src"),
      rejected: document.getElementById("previewWebview").dataset.previewRejected,
      status: document.getElementById("previewStatus").textContent,
      statusHidden: document.getElementById("previewStatus").classList.contains("hidden"),
    }))()`);

    report.stage = "preview-restoring";
    persist(report);
    const restoredPreview = previewUrlOverride ? preview : await evaluate(page, `(async () => {
      const restored = await window.editcoreProject.startPreview(${JSON.stringify(projectRoot)});
      if (!restored?.available || !restored?.url) throw new Error(restored?.message || "Preview no disponible al recuperar");
      return restored;
    })()`, 150_000);
    await evaluate(page, `(async () => {
      const preview = ${JSON.stringify(previewUrlOverride ? { url: previewUrlOverride } : null)} || await window.editcoreProject.startPreview(${JSON.stringify(projectRoot)});
      document.getElementById("previewUrl").value = preview.url;
      await openPreview({ forceReload: true });
      return preview;
    })()`, 150_000);
    await waitForGuestDocument(restoredPreview.url);
    await wait(16_000);
    report.stage = "preview-stability";
    persist(report);
    const stableGuest = await waitForGuestDocument(restoredPreview.url);
    const stableHost = await evaluate(page, `(() => ({
      ready: document.getElementById("previewWebview").dataset.previewReady,
      statusHidden: document.getElementById("previewStatus").classList.contains("hidden"),
      statusDisplay: getComputedStyle(document.getElementById("previewStatus")).display,
      url: document.getElementById("previewUrl").value,
    }))()`);
    const navigation = await evaluate(page, `(async () => {
      const webview = document.getElementById("previewWebview");
      const before = webview.getURL();
      const access = await webview.executeJavaScript("(() => { const candidate = [...document.querySelectorAll('a,button')].find((node) => /acceder/i.test(String(node.textContent || '').trim())); if (!candidate) return false; candidate.click(); return true; })()");
      if (!access) {
        // Real projects do not share a button label. Use a same-document hash
        // navigation so the browser back control is verified generically.
        const target = new URL(before);
        target.hash = "editcore-acceptance";
        await webview.loadURL(target.href);
      }
      for (let attempt = 0; attempt < 160 && webview.getURL() === before; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
      const afterAccess = webview.getURL();
      const backAvailable = !document.getElementById("previewBackBtn").disabled;
      document.getElementById("previewBackBtn").click();
      for (let attempt = 0; attempt < 160 && webview.getURL() !== before; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
      const afterBack = webview.getURL();
      return { attempted: true, mode: access ? "project-control" : "same-document-hash", before, afterAccess, backAvailable, afterBack, ok: afterAccess !== before && backAvailable && afterBack === before };
    })()`);
    report.stage = "navigation-checked";
    persist(report);
    const result = { preview, ...host, guest, apiGuard, restoredPreview, stableGuest, stableHost, navigation, projectSwitch };
    report.result = result;
    try {
      await wait(2_000);
      const capture = await cdp(page, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
      report.screenshot = screenshotPath;
    } catch (error) {
      report.screenshotError = String(error?.message || error);
    }
    report.ok = Boolean(result.panel?.height > 500
      && Math.abs(result.panel.height - result.webview.height) <= 2
      && Math.abs(result.panel.bottom - result.webview.bottom) <= 2
      && result.guest?.height >= result.panel.height - 4
      && /html/i.test(result.guest?.contentType || "")
      && /^https?:/i.test(result.guest?.href || "")
      && new URL(result.guest.href).host === new URL(result.preview.url).host
      && !/127\.0\.0\.1:3000/i.test(result.guest.href)
      && result.apiGuard?.rejected === "api-document"
      && result.apiGuard?.src !== apiUrl
      && /html/i.test(result.stableGuest?.contentType || "")
      && new URL(result.stableGuest.href).host === new URL(result.restoredPreview.url).host
      && result.stableHost?.ready === "1"
      && result.stableHost?.statusHidden === true
      && result.stableHost?.statusDisplay === "none"
      && result.partition === "persist:editcore-browser"
      && result.controlsOrder[0] < result.controlsOrder[1]
      && result.controlsOrder[1] < result.controlsOrder[2]
      && result.navigation?.ok === true);
    if (secondProjectRoot) {
      report.ok = report.ok && result.projectSwitch?.activeRoot === secondProjectRoot
        && result.projectSwitch?.previewUrl
        && result.projectSwitch?.guestUrl
        && result.projectSwitch.guestUrl.startsWith(result.projectSwitch.previewUrl);
    }
    report.stage = report.ok ? "complete" : "failed-criteria";
  } catch (error) {
    report.failedStage = report.stage;
    report.stage = "failed";
    report.error = String(error?.stack || error).slice(0, 3000);
  } finally {
    const startupLog = path.join(userData, "startup.log");
    if (fs.existsSync(startupLog)) report.startupLog = fs.readFileSync(startupLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-40);
    if (process.env.EDITCORE_BROWSER_KEEP_USER_DATA === "1") report.userData = userData;
    persist(report);
    if (apiServer) {
      apiServer.closeAllConnections?.();
      await new Promise((resolve) => apiServer.close(resolve));
    }
    stopApp();
    await wait(1_000);
    if (process.env.EDITCORE_BROWSER_KEEP_USER_DATA !== "1") {
      try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
    }
  }
  if (!report.ok) process.exitCode = 2;
}

main();
