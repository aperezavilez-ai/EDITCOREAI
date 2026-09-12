"use strict";

/**
 * E2E Electron (CDP): lanza EDITCOREAI, verifica franja pipeline + plan durable IPC.
 * No consume tokens LLM.
 *
 * Uso:
 *   node scripts/forensic-pipeline-electron-e2e.js
 *   EDITCORE_USE_EXE=1 node scripts/forensic-pipeline-electron-e2e.js
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const usePackagedExe = process.env.EDITCORE_USE_EXE === "1"
  || (process.env.EDITCORE_USE_EXE !== "0" && fs.existsSync(path.resolve(process.env.EDITCORE_EXE || path.join(repoRoot, "EDITCOREAI.exe"))));
const executable = usePackagedExe
  ? path.resolve(process.env.EDITCORE_EXE || path.join(repoRoot, "EDITCOREAI.exe"))
  : path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");

const report = { ok: true, phases: [], errors: [] };

function log(phase, message, extra = {}) {
  report.phases.push({ phase, message, ...extra, at: new Date().toISOString() });
  console.log(`[${phase}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
}

function fail(phase, message, extra = {}) {
  report.ok = false;
  report.errors.push({ phase, message, ...extra });
  log(phase, `FAIL: ${message}`, extra);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.close();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo"));
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

async function waitForPage(debugPort) {
  for (let i = 0; i < 200; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /index\.html/i.test(String(item.url || "")));
      if (page) {
        const ready = await evaluate(page, 'document.body?.dataset?.editcoreReady === "1"').catch(() => false);
        if (ready) return page;
      }
    } catch { /* retry */ }
    await wait(400);
  }
  throw new Error("EDITCOREAI no expuso renderer listo (timeout ~80s).");
}

function stopApp(appProcess) {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  if (!fs.existsSync(executable)) {
    fail("launch", `No existe ${executable}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  spawnSync("taskkill", ["/IM", "electron.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  await wait(1500);

  const debugPort = await availablePort();
  const args = usePackagedExe
    ? [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", "--no-sandbox"]
    : [appRoot, `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", "--no-sandbox"];
  log("launch", usePackagedExe ? "EDITCOREAI EXE" : "EDITCOREAI DEV electron", { detail: `${executable} :${debugPort}` });

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-profile-"));
  const appProcess = spawn(executable, args, {
    windowsHide: true,
    stdio: "ignore",
    cwd: usePackagedExe ? repoRoot : appRoot,
    env: {
      ...process.env,
      EDITCORE_E2E: "1",
      EDITCORE_ACCEPTANCE_HIDDEN: "1",
      EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1",
      EDITCORE_USER_DATA_PATH: profileRoot,
    },
  });

  try {
    const page = await waitForPage(debugPort);
    log("ready", "Renderer conectado");

    const ui = await evaluate(page, `(() => {
      const strip = document.getElementById("agentPipelineStrip");
      const hasApi = Boolean(window.__editcorePipeline?.update && window.editcoreTasks?.persistPlan);
      if (window.__editcorePipeline?.update) {
        window.__editcorePipeline.update({
          coverage: "E2E 80%",
          coveragePercent: 80,
          coverageState: "run",
          diagnostic: "npx tsc --noEmit → ok",
          diagnosticState: "ok",
          queue: "0/2 · src/broken.ts",
          queueState: "run",
        });
      }
      const state = window.__editcorePipeline?.getState?.() || {};
      return {
        hasStrip: Boolean(strip),
        hasApi,
        coverage: state.coverage || "",
        queue: state.queue || "",
        visible: state.visible === true,
      };
    })()`);

    if (ui.hasStrip) fail("ui", "Franja pipeline no debe existir en el chat", ui);
    else log("ui", "Chat limpio (pipeline solo interno)", { detail: JSON.stringify(ui) });
    if (!ui.hasApi) fail("api", "Falta __editcorePipeline o editcoreTasks.persistPlan");
    if (ui.visible) fail("ui", "Pipeline no debe marcarse visible");
    if (!/E2E 80%/.test(ui.coverage)) fail("ui", "Estado interno cobertura no actualizo", ui);
    if (!/broken\.ts/.test(ui.queue)) fail("ui", "Estado interno cola no actualizo", ui);

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-proj-"));
    fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "src", "broken.ts"), "export const x = 1;\n");
    const planContent = [
      "## Qué sí funcionó",
      "- Lectura real",
      "## Qué falló / hallazgos",
      "- src/broken.ts",
      "## Cómo lo corregiré",
      "1. Corregir `src/broken.ts`",
      "Cuando autorices procedo con las correcciones.",
    ].join("\n");

    const persisted = await evaluate(page, `(async () => {
      const result = await window.editcoreTasks.persistPlan({
        projectId: "e2e-electron",
        projectRoot: ${JSON.stringify(fixture)},
        goal: "analisis forense e2e",
        content: ${JSON.stringify(planContent)},
        fixQueue: [{ id: "fix-1", index: 1, target: "src/broken.ts", action: "Corregir src/broken.ts", evidence: "e2e", status: "pending" }],
      });
      const described = result?.taskId ? await window.editcoreTasks.describeWorkflow(result.taskId) : null;
      return {
        taskId: result?.taskId || "",
        planId: result?.planId || "",
        awaiting: Boolean(described?.awaitingAuthorization),
        fixQueueLen: Array.isArray(described?.fixQueue) ? described.fixQueue.length : 0,
        state: described?.state || "",
      };
    })()`);

    if (!persisted.taskId || !persisted.planId) fail("persist", "persistPlan no devolvio ids", persisted);
    else log("persist", "Plan durable OK", { detail: `${persisted.taskId} / ${persisted.planId}` });
    if (!persisted.awaiting) fail("persist", "Estado no AWAITING_AUTHORIZATION", persisted);
    if (persisted.fixQueueLen < 1) fail("persist", "fixQueue vacia en describeWorkflow", persisted);

    const approved = await evaluate(page, `(async () => {
      const r = await window.editcoreTasks.approvePlan({
        taskId: ${JSON.stringify(persisted.taskId)},
        planId: ${JSON.stringify(persisted.planId)},
      });
      const described = await window.editcoreTasks.describeWorkflow(${JSON.stringify(persisted.taskId)});
      return {
        approvalId: r?.approval?.approvalId || "",
        state: described?.state || "",
        duplicate: Boolean(r?.duplicate),
      };
    })()`);

    if (!approved.approvalId && !approved.duplicate) fail("approve", "approvePlan sin approvalId", approved);
    else log("approve", "PROCEDE/approve OK", { detail: approved.state });

    fs.rmSync(fixture, { recursive: true, force: true });
  } catch (error) {
    fail("run", error.message || String(error));
  } finally {
    stopApp(appProcess);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
