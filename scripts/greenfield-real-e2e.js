"use strict";

/**
 * E2E REAL 0→100 en EDITCOREAI (sin mock de proveedor).
 * Lanza EDITCOREAI.exe con perfil real, crea proyecto y envía prompts por chat.
 *
 * Uso: node scripts/greenfield-real-e2e.js
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const appRoot = path.resolve(__dirname, "..");
const usePackagedExe = process.env.EDITCORE_USE_EXE === "1";
const executable = usePackagedExe
  ? path.resolve(process.env.EDITCORE_EXE || path.join(repoRoot, "EDITCOREAI.exe"))
  : path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");
const PROJECT_NAME = `TaskFlow-E2E-${Date.now().toString(36)}`;
const PARENT_DIR = path.join(repoRoot, ".editcore", "e2e-real");
const CHAT_SEQUENCE = [
  "Personaliza esta app React: lista de tareas con agregar, marcar completadas y eliminar. UI limpia en español. Implementa los cambios y verifica con npm run build.",
  "procede",
  "Si quedó algún error de build o test, corrígelo y vuelve a verificar con npm run build.",
];

const report = {
  ok: true,
  real: true,
  projectName: PROJECT_NAME,
  parentDir: PARENT_DIR,
  phases: [],
  errors: [],
  chatResults: [],
};

function log(phase, message, extra = {}) {
  const row = { at: new Date().toISOString(), phase, message, ...extra };
  report.phases.push(row);
  console.log(`[${phase}] ${message}`, extra.detail ? `— ${extra.detail}` : "");
}

function fail(phase, message, extra = {}) {
  report.ok = false;
  report.errors.push({ phase, message, ...extra });
  log(phase, `FAIL: ${message}`, extra);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo"));
      } else resolve(message.result?.result?.value);
      socket.close();
    });
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function waitForPage(debugPort) {
  for (let i = 0; i < 400; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /index\.html/i.test(String(item.url || "")));
      if (page) {
        const ready = await evaluate(page, 'document.body?.dataset?.editcoreReady === "1" && Boolean(window.editcoreProject?.create)').catch(() => false);
        if (ready) return page;
      }
    } catch {}
    await wait(400);
  }
  throw new Error("EDITCOREAI no expuso renderer listo (timeout 160s).");
}

async function waitForIdle(page, timeoutMs = 900_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await evaluate(page, `(() => {
      const active = typeof activePromptRequests !== "undefined" ? activePromptRequests.size : 0;
      const queued = typeof promptQueue !== "undefined" ? promptQueue.filter(i => !i.cancelled).length : 0;
      const thinking = Boolean(document.querySelector(".thinking-msg"));
      return { active, queued, thinking, status: document.getElementById("status")?.textContent || "" };
    })()`);
    if (!busy.active && !busy.queued && !busy.thinking) return busy;
    if (Date.now() - start > 5000 && Date.now() % 15000 < 500) {
      log("wait", "Agente ocupado...", { detail: busy.status?.slice(0, 120) });
    }
    await wait(2000);
  }
  throw new Error("Timeout esperando que el agente termine.");
}

function stopApp(appProcess) {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  spawnSync("taskkill", ["/IM", "electron.exe", "/F"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  if (!fs.existsSync(executable)) {
    fail("launch", `No existe ${executable}`);
    process.exit(1);
  }

  fs.mkdirSync(PARENT_DIR, { recursive: true });
  log("setup", "Carpeta E2E", { detail: PARENT_DIR });

  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  spawnSync("taskkill", ["/IM", "electron.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  await wait(2000);

  const debugPort = await availablePort();
  const args = usePackagedExe
    ? [`--remote-debugging-port=${debugPort}`, "--no-sandbox"]
    : [appRoot, `--remote-debugging-port=${debugPort}`];
  log("launch", usePackagedExe ? "Iniciando EDITCOREAI EXE" : "Iniciando EDITCOREAI DEV (código actual + perfil real)", {
    detail: `${executable} debug:${debugPort}`,
  });

  const appProcess = spawn(executable, args, {
    windowsHide: false,
    stdio: "ignore",
    cwd: usePackagedExe ? repoRoot : appRoot,
    env: { ...process.env },
  });

  let page;
  try {
    page = await waitForPage(debugPort);
    log("ready", "Renderer conectado");

    const createResult = await evaluate(page, `(async () => {
      const parentPath = ${JSON.stringify(PARENT_DIR)};
      const name = ${JSON.stringify(PROJECT_NAME)};
      const runId = "e2e-real-" + Date.now();
      const created = await window.editcoreProject.create({
        name,
        parentPath,
        template: "react",
        install: true,
        runId,
      });
      if (!created?.root) throw new Error("create devolvio vacio: " + JSON.stringify(created));
      const project = projectForRoot(created.root, created.name);
      state.activeProjectId = project.id;
      state.projectRoot = created.root;
      state.permissionMode = "full";
      project.permissionMode = "full";
      saveProjects();
      await selectProject(project.id);
      document.getElementById("runMode").value = "agent";
      if (typeof applyPermissionMode === "function") applyPermissionMode("full");
      return {
        root: created.root,
        name: created.name,
        template: created.template,
        report: created.report,
        projectId: project.id,
      };
    })()`);

    log("create", "Proyecto creado en disco", {
      detail: createResult.root,
      durationMs: createResult.report?.durationMs,
      verified: createResult.report?.verified,
    });

    if (!fs.existsSync(path.join(createResult.root, "package.json"))) {
      fail("create", "package.json no existe tras create");
    }

    for (let i = 0; i < CHAT_SEQUENCE.length; i += 1) {
      const prompt = CHAT_SEQUENCE[i];
      log("chat", `Prompt ${i + 1}/${CHAT_SEQUENCE.length}`, { detail: prompt.slice(0, 80) });

      const sendResult = await evaluate(page, `(async () => {
        const prompt = ${JSON.stringify(prompt)};
        document.getElementById("prompt").value = prompt;
        document.getElementById("runMode").value = "agent";
        if (typeof applyPermissionMode === "function") applyPermissionMode("full");
        await send({ preventDefault() {} });
        return { queued: true, status: document.getElementById("status")?.textContent || "" };
      })()`);

      log("chat", "Enviado al chat", { detail: sendResult.status });
      const idle = await waitForIdle(page);
      log("chat", `Prompt ${i + 1} terminado`, { detail: idle.status?.slice(0, 150) });

      const lastAssistant = await evaluate(page, `(() => {
        const msgs = Array.from(document.querySelectorAll(".msg.assistant, .assistant-msg, [data-role=assistant]"));
        const last = msgs[msgs.length - 1];
        return {
          text: (last?.textContent || "").slice(0, 2000),
          status: document.getElementById("status")?.textContent || "",
          historyLen: state?.history?.length || 0,
        };
      })()`);

      report.chatResults.push({ prompt, status: lastAssistant.status, textPreview: lastAssistant.text?.slice(0, 500) });

      if (/error|fallo|no se pudo|invalido/i.test(lastAssistant.status || "")) {
        fail("chat", `Estado de error tras prompt ${i + 1}`, { status: lastAssistant.status });
      }
    }

    const verify = await evaluate(page, `(async () => {
      const root = state.projectRoot;
      const pkg = root + "\\\\package.json";
      return {
        root,
        hasPkg: Boolean(root),
        files: root ? (await window.editcoreProject.list(root, "src")).slice(0, 20) : [],
        status: document.getElementById("status")?.textContent || "",
      };
    })()`);

    log("verify", "Estado final", { detail: verify.root, files: verify.files?.length });

    const buildCheck = await new Promise((resolve) => {
      const child = spawn("npm run build", {
        cwd: createResult.root,
        shell: true,
        windowsHide: true,
      });
      let stderr = "";
      let stdout = "";
      child.stdout.on("data", (c) => { stdout += String(c); });
      child.stderr.on("data", (c) => { stderr += String(c); });
      child.on("close", (code) => resolve({ code, stdout: stdout.slice(-600), stderr: stderr.slice(-600) }));
    });

    log("build", `npm run build exit ${buildCheck.code}`, { detail: (buildCheck.stderr || buildCheck.stdout).slice(-300) });
    if (buildCheck.code !== 0) {
      fail("build", "Build falló al cierre del E2E", { stderr: buildCheck.stderr });
    }

    report.projectRoot = createResult.root;
    report.finishedAt = new Date().toISOString();

    const outPath = path.join(repoRoot, ".editcore", "e2e-real-report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nReporte: ${outPath}`);
    console.log(report.ok ? "\n✅ E2E REAL PASS" : "\n❌ E2E REAL FAIL — revisar errores");
    if (!report.ok) {
      console.error(JSON.stringify(report.errors, null, 2));
      process.exit(1);
    }
  } catch (error) {
    fail("fatal", error.message || String(error));
    const outPath = path.join(repoRoot, ".editcore", "e2e-real-report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.error(error);
    process.exit(1);
  } finally {
    await wait(3000);
    stopApp(appProcess);
  }
}

main();
