"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const startedAt = Date.now();
const projectRoot = String(process.env.EDITCORE_PERFORMANCE_PROJECT || "").trim();
const reportPath = process.env.EDITCORE_PERFORMANCE_REPORT || path.join(process.cwd(), "performance-acceptance.json");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-performance-"));
process.env.EDITCORE_USER_DATA_PATH = userData;
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";

require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readyWindow() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) {
      const ready = await window.webContents.executeJavaScript(`document.readyState === "complete" && document.body.dataset.editcoreReady === "1"`).catch(() => false);
      if (ready) return window;
    }
    await wait(50);
  }
  throw new Error("EDITCOREAI no quedo interactivo dentro de 12 segundos.");
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), projectRoot, ok: false };
  try {
    const window = await readyWindow();
    report.interactiveMs = Date.now() - startedAt;
    report.controls = await window.webContents.executeJavaScript(`(async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const measureDialog = async (buttonId, dialogId, readySelector = "") => {
        const dialog = document.getElementById(dialogId);
        if (dialog.open) dialog.close();
        const started = performance.now();
        document.getElementById(buttonId).click();
        const openedSynchronously = dialog.open;
        const openMs = performance.now() - started;
        let renderMs = openMs;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (!readySelector || dialog.querySelector(readySelector)) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
          renderMs = performance.now() - started;
        }
        await waitFrame();
        if (dialog.open) dialog.close();
        return { openedSynchronously, openMs, renderMs };
      };
      const permissions = (() => {
        const menu = document.getElementById("permissionMenu");
        menu.classList.add("hidden");
        const started = performance.now();
        document.getElementById("permissionsBtn").click();
        const value = { open: !menu.classList.contains("hidden"), latencyMs: performance.now() - started };
        menu.classList.add("hidden");
        return value;
      })();
      const mode = (() => {
        const select = document.getElementById("runMode");
        const started = performance.now();
        select.value = "agent";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return { selected: select.value, latencyMs: performance.now() - started };
      })();
      const web = document.getElementById("webPreviewBtn");
      const webStyle = getComputedStyle(web);
      return {
        connections: await measureDialog("connectionsBtn", "connectionsDialog", "[data-conn]"),
        providers: await measureDialog("providersBtn", "providersDialog", "[data-provider-rendered='1']"),
        projects: await measureDialog("toggleProjectsBtn", "projectsDialog"),
        brain: await measureDialog("brainBtn", "brainDialog"),
        permissions,
        mode,
        web: {
          text: web.textContent.trim(),
          width: web.getBoundingClientRect().width,
          clientWidth: web.clientWidth,
          scrollWidth: web.scrollWidth,
          lineHeight: webStyle.lineHeight,
          clipped: web.scrollWidth > web.clientWidth,
        },
      };
    })()`);

    let maxMainLoopDelayMs = 0;
    let previousTick = Date.now();
    const monitor = setInterval(() => {
      const now = Date.now();
      maxMainLoopDelayMs = Math.max(maxMainLoopDelayMs, now - previousTick - 25);
      previousTick = now;
    }, 25);
    if (projectRoot && fs.existsSync(projectRoot)) {
      await window.webContents.executeJavaScript(`(() => {
        state.projectRoot = ${JSON.stringify(projectRoot)};
        scheduleProjectKnowledgeRefresh(state.projectRoot);
      })()`);
      await wait(4_500);
    } else {
      await wait(500);
    }
    clearInterval(monitor);
    report.maxMainLoopDelayMs = maxMainLoopDelayMs;
    report.ok = Boolean(report.interactiveMs <= 10_000
      && Object.values(report.controls).filter((item) => item && Object.hasOwn(item, "openMs")).every((item) => item.openedSynchronously && item.openMs < 100)
      && report.controls.permissions.open && report.controls.permissions.latencyMs < 100
      && report.controls.mode.selected === "agent" && report.controls.mode.latencyMs < 100
      && report.controls.web.text === "Web" && !report.controls.web.clipped
      && report.maxMainLoopDelayMs < 750);
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 3000);
  } finally {
    const startupLog = path.join(userData, "startup.log");
    if (fs.existsSync(startupLog)) report.startupLog = fs.readFileSync(startupLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-20);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    app.exit(report.ok ? 0 : 2);
  }
}

app.whenReady().then(main);
