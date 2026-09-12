"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, screen } = require("electron");

const projectRoot = process.env.EDITCORE_BROWSER_PROJECT;
const previewUrlOverride = String(process.env.EDITCORE_BROWSER_URL || "").trim();
const reportPath = process.env.EDITCORE_BROWSER_REPORT || path.join(process.cwd(), "browser-fit-acceptance.json");
const screenshotPath = process.env.EDITCORE_BROWSER_SCREENSHOT || path.join(process.cwd(), "browser-fit-acceptance.png");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-browser-fit-"));
process.env.EDITCORE_USER_DATA_PATH = userData;
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";

if (!projectRoot || !fs.existsSync(projectRoot)) throw new Error("Falta EDITCORE_BROWSER_PROJECT valido.");
require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
]);

function persist(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readyWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) {
      const ready = await window.webContents.executeJavaScript(`document.readyState === "complete" && Boolean(document.getElementById("previewWebview"))`).catch(() => false);
      if (ready) return window;
    }
    await wait(100);
  }
  throw new Error("EDITCOREAI no termino de cargar.");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), projectRoot, stage: "starting" };
  try {
    persist(report);
    const window = await withTimeout(readyWindow(), 60_000, "EDITCOREAI no termino de cargar la ventana.");
    report.stage = "window-ready";
    persist(report);
    window.setSize(1600, 900);
    const project = await withTimeout(window.webContents.executeJavaScript(`(async () => {
      const project = projectForRoot(${JSON.stringify(projectRoot)}, "TAXIDRIV");
      state.activeProjectId = project.id;
      state.projectRoot = project.projectRoot;
      saveProjects();
      renderProjects();
      renderFeed();
      document.getElementById("projectPathLabel").textContent = project.projectRoot;
      await renderProjectFiles();
      return { id: project.id, root: project.projectRoot };
    })()`), 20_000, "EDITCOREAI no termino de registrar el proyecto de aceptacion.");
    report.stage = "project-ready";
    report.project = project;
    persist(report);

    const preview = previewUrlOverride
      ? { available: true, started: false, remote: false, pid: 0, url: previewUrlOverride, runtimeRoot: projectRoot, script: "URL de aceptacion existente" }
      : await withTimeout(window.webContents.executeJavaScript(`window.editcoreProject.startPreview(${JSON.stringify(projectRoot)})`), 90_000, "El servidor del proyecto no termino de iniciar.");
    if (!preview?.available) throw new Error(preview?.message || "Preview no disponible");
    report.stage = "preview-ready";
    report.preview = preview;
    persist(report);

    const result = await withTimeout(window.webContents.executeJavaScript(`(async () => {
      document.getElementById("previewUrl").value = ${JSON.stringify(preview.url)};
      const webview = document.getElementById("previewWebview");
      await openPreview();
      let loaded = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const ready = webview.dataset.previewReady === "1"
          && document.getElementById("previewStatus").classList.contains("hidden")
          && !webview.isLoading?.();
        if (ready) { loaded = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!loaded) throw new Error("El webview no termino de mostrar el proyecto.");
      await fitPreviewToPanel();
      const page = await webview.executeJavaScript('({ viewport: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight, content: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0), contentHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) })');
      const navigation = await (async () => {
        const before = webview.getURL();
        const access = await webview.executeJavaScript("(() => { const candidate = [...document.querySelectorAll('a,button')].find((node) => /acceder/i.test(String(node.textContent || '').trim())); if (!candidate) return false; candidate.click(); return true; })()");
        if (!access) return { attempted: false, ok: true, reason: "No se encontro un control Acceder en la pagina de prueba." };
        let arrived = false;
        for (let attempt = 0; attempt < 240; attempt += 1) {
          const current = webview.getURL();
          if (current && current !== before && webview.dataset.previewReady === "1" && document.getElementById("previewStatus").classList.contains("hidden")) { arrived = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const afterAccess = webview.getURL();
        const backAvailable = !document.getElementById("previewBackBtn").disabled;
        document.getElementById("previewBackBtn").click();
        let returned = false;
        for (let attempt = 0; attempt < 240; attempt += 1) {
          if (webview.getURL() === before && webview.dataset.previewReady === "1" && document.getElementById("previewStatus").classList.contains("hidden")) { returned = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { attempted: true, arrived, afterAccess, backAvailable, returned, afterBack: webview.getURL(), ok: arrived && backAvailable && returned && webview.getURL() === before };
      })();
      const panel = document.querySelector(".viewer-body").getBoundingClientRect();
      const webviewRect = webview.getBoundingClientRect();
      return {
        preview: ${JSON.stringify(preview)},
        panelWidth: panel.width,
        panelHeight: panel.height,
        webviewWidth: webviewRect.width,
        webviewHeight: webviewRect.height,
        webviewBottomGap: Math.abs(panel.bottom - webviewRect.bottom),
        zoom: Number(webview.dataset.fitZoom || 1),
        page,
        navigation,
        statusHidden: document.getElementById("previewStatus").classList.contains("hidden"),
        projectPath: document.getElementById("projectPathLabel").textContent,
      };
    })()`), 35_000, "El webview no termino de mostrar el proyecto.");
    report.stage = "webview-ready";
    persist(report);
    const interactions = await window.webContents.executeJavaScript(`(() => {
      const drag = (id, clientX, clientY) => {
        const node = document.getElementById(id);
        const before = { chat: getComputedStyle(document.body).getPropertyValue("--chat-width"), browser: getComputedStyle(document.body).getPropertyValue("--browser-width") };
        const rect = node.getBoundingClientRect();
        const pointerId = id === "splitChatBrowser" ? 41 : 42;
        node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId, clientX: rect.left + 2, clientY: rect.top + 4, buttons: 1 }));
        node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX, clientY, buttons: 1 }));
        node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, clientX, clientY, buttons: 0 }));
        const after = { chat: getComputedStyle(document.body).getPropertyValue("--chat-width"), browser: getComputedStyle(document.body).getPropertyValue("--browser-width") };
        return { before, after, changed: before.chat !== after.chat || before.browser !== after.browser };
      };
      const body = document.body.getBoundingClientRect();
      return {
        splitChatBrowser: drag("splitChatBrowser", body.left + Math.min(body.width - 360, 600), body.top + 20),
        splitBrowserProjects: drag("splitBrowserProjects", body.left + body.width - 360, body.top + 24),
      };
    })()`);
    const beforeWindows = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed()).length;
    const openedWindow = await window.webContents.executeJavaScript("window.editcoreWindow.open()");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed()).length >= beforeWindows + 1) break;
      await wait(100);
    }
    await wait(500);
    const allWindows = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed());
    const createdWindow = allWindows.find((item) => item !== window);
    let createdReady = false;
    if (createdWindow) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        createdReady = await createdWindow.webContents.executeJavaScript("document.readyState === 'complete' && Boolean(document.getElementById('sendBtn'))").catch(() => false);
        if (createdReady) break;
        await wait(100);
      }
    }
    const bounds = createdWindow?.getBounds?.() || null;
    const workArea = screen.getDisplayMatching(bounds || window.getBounds()).workArea;
    const newWindow = {
      before: beforeWindows,
      after: allWindows.length,
      opened: openedWindow,
      bounds,
      workArea,
      loaded: createdReady,
      single: allWindows.length === beforeWindows + 1,
      centered: Boolean(bounds && Math.abs((bounds.x + bounds.width / 2) - (workArea.x + workArea.width / 2)) <= 2 && Math.abs((bounds.y + bounds.height / 2) - (workArea.y + workArea.height / 2)) <= 2),
    };
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    result.interactions = { ...interactions, newWindow };
    await wait(500);
    const image = await window.capturePage();
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, image.toPNG());
    report.result = result;
    report.screenshot = screenshotPath;
    report.ok = Boolean(result.preview?.url
      && result.panelWidth > 280
      && result.panelHeight > 500
      && Math.abs(result.webviewWidth - result.panelWidth) <= 2
      && Math.abs(result.webviewHeight - result.panelHeight) <= 2
      && result.webviewBottomGap <= 2
      && result.page?.viewport > 0
      && result.page.viewport >= 1360
      && result.page?.viewportHeight >= result.panelHeight - 4
      && result.page?.content > 0
      && result.page.content <= result.page.viewport + 4
      && result.statusHidden
      && (process.env.EDITCORE_BROWSER_NAVIGATE !== "1" || result.navigation?.ok)
      && result.zoom > 0.49 && result.zoom <= 1
      && result.projectPath === projectRoot
      && result.interactions?.splitChatBrowser?.changed
      && result.interactions?.splitBrowserProjects?.changed
      && result.interactions?.newWindow?.single
      && result.interactions?.newWindow?.loaded
      && result.interactions?.newWindow?.centered);
    report.stage = report.ok ? "complete" : "failed-criteria";
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error).slice(0, 2000);
    report.failedStage = report.stage;
    report.stage = "failed";
  } finally {
    const startupLog = path.join(userData, "startup.log");
    if (fs.existsSync(startupLog)) {
      report.startupLog = fs.readFileSync(startupLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-30);
    }
    persist(report);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy();
    }
    await wait(250);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
    app.exit(report.ok ? 0 : 2);
  }
});
