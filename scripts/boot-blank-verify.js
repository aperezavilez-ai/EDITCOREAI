"use strict";

/**
 * Verifica arranque EXE: tiempo hasta UI usable (sendBtn) sin Page.reload.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
const reportPath = path.join(root, "boot-blank-verify-report.json");
const debugPort = Number(process.env.EDITCORE_BOOT_PORT || 9377);
const budgetMs = Number(process.env.EDITCORE_BOOT_BUDGET_MS || 45_000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let appProcess = null;

function killAll() {
  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  if (appProcess?.pid) {
    spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  }
}

async function cdp(page, expression, timeoutMs = 8_000) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error(`CDP timeout ${timeoutMs}ms`));
    }, timeoutMs);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || "eval"));
      } else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  return result;
}

async function listPage() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const pages = await response.json();
  const mainPage = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl && p.url && p.url.includes("index.html"));
  if (mainPage) return mainPage;
  return pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl && p.url !== "about:blank")
    || pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl)
    || null;
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    executable,
    budgetMs,
    ok: false,
    firstPaintWithoutReload: false,
    timings: {},
    samples: [],
  };
  killAll();
  await wait(1500);
  const t0 = Date.now();
  try {
    appProcess = spawn(executable, [
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-sandbox",
    ], {
      stdio: "ignore",
      env: { ...process.env, EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1" },
      windowsHide: false,
    });

    let pageSeenAt = null;
    let uiReadyAt = null;
    let lastState = null;

    while (Date.now() - t0 < budgetMs) {
      try {
        const page = await listPage();
        if (!page) {
          report.samples.push({ t: Date.now() - t0, note: "no-cdp-page" });
          await wait(400);
          continue;
        }
        if (!pageSeenAt) pageSeenAt = Date.now() - t0;
        const state = await cdp(page, `({
          ready: document.readyState,
          bodyLen: (document.body && document.body.innerHTML || '').length,
          hasSend: Boolean(document.getElementById('sendBtn')),
          editcoreReady: document.body?.dataset?.editcoreReady || '',
          title: document.title || '',
          url: location.href,
        })`, 5_000).catch((e) => ({ error: String(e.message || e) }));
        lastState = state;
        report.samples.push({ t: Date.now() - t0, state });
        if (state?.hasSend && (state.ready === "complete" || state.editcoreReady === "1" || state.bodyLen > 500)) {
          uiReadyAt = Date.now() - t0;
          report.firstPaintWithoutReload = true;
          report.ok = true;
          break;
        }
      } catch (error) {
        report.samples.push({ t: Date.now() - t0, error: String(error.message || error) });
      }
      await wait(400);
    }

    report.timings.cdpPageMs = pageSeenAt;
    report.timings.uiReadyMs = uiReadyAt;
    report.timings.totalMs = Date.now() - t0;
    report.lastState = lastState;

    if (!report.ok && lastState) {
      // Un reload no cuenta como OK de doble-clic, pero diagnostica si el HTML sirve.
      try {
        const page = await listPage();
        if (page) {
          const socket = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", reject, { once: true });
          });
          socket.send(JSON.stringify({ id: 99, method: "Page.reload", params: { ignoreCache: true } }));
          await wait(8000);
          socket.close();
          const after = await cdp(page, `({
            ready: document.readyState,
            hasSend: Boolean(document.getElementById('sendBtn')),
            bodyLen: (document.body && document.body.innerHTML || '').length,
          })`);
          report.reloadProbe = after;
        }
      } catch (error) {
        report.reloadProbeError = String(error.message || error);
      }
    }
  } catch (error) {
    report.fatal = String(error.message || error);
  } finally {
    killAll();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: report.ok,
      firstPaintWithoutReload: report.firstPaintWithoutReload,
      timings: report.timings,
      lastState: report.lastState,
      reloadProbe: report.reloadProbe || null,
      reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 2);
  }
}

main();
