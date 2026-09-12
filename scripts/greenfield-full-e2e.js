"use strict";

/**
 * E2E greenfield 0→100: simula el flujo de chat en EDITCOREAI
 * (crear proyecto → scaffold → dependencias → build → verificar orquestador).
 *
 * Uso: node scripts/greenfield-full-e2e.js
 *      GREENFIELD_E2E_UI=1 node scripts/greenfield-full-e2e.js  (lanza Electron + CDP)
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const { ProjectScaffoldService } = require("../project-scaffold-service");
const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
const { installProjectDependencies } = require("../runtime/project-onboarding");

const PROJECT_NAME = "TaskFlow";
const CHAT_PROMPTS = [
  `CREA EL PROYECTO AHORA: app web "${PROJECT_NAME}" con React — lista de tareas simple`,
  "instala dependencias y ejecuta npm run build para verificar",
  "procede",
];

const report = {
  ok: true,
  startedAt: new Date().toISOString(),
  phases: [],
  errors: [],
};

function log(phase, message, extra = {}) {
  const row = { phase, message, ...extra };
  report.phases.push(row);
  console.log(`[${phase}] ${message}`, extra.detail ? `— ${extra.detail}` : "");
}

function fail(phase, message, extra = {}) {
  report.ok = false;
  report.errors.push({ phase, message, ...extra });
  log(phase, `FAIL: ${message}`, extra);
}

function runCmd(command, cwd, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ code: -1, stdout, stderr: `${stderr}\nTimeout` });
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code) || 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

async function phaseHeadless() {
  const parentDir = path.join(appRoot, "..", "..", ".editcore", "e2e-runs", `run-${Date.now()}`);
  fs.mkdirSync(parentDir, { recursive: true });
  log("headless", "Carpeta padre E2E", { detail: parentDir });

  for (const prompt of CHAT_PROMPTS) {
    const plan = resolveUnifiedAgentPlan({
      prompt,
      requestedAgent: true,
      projectOpen: true,
      permissionMode: "full",
      allowWrite: true,
      cursorParityEnabled: true,
    });
    log("orchestrator", `Plan: "${prompt.slice(0, 50)}..."`, {
      mode: plan.mode,
      cursorParityMode: plan.cursorParityMode,
      greenfieldCreate: plan.greenfieldCreate,
      isAgent: plan.isAgent,
    });
    if (prompt.includes("CREA") && !plan.isAgent) {
      fail("orchestrator", "Se esperaba modo agente en creacion", { prompt });
    }
    if (prompt.includes("CREA") && plan.mode !== "EXECUTE" && !plan.greenfieldCreate) {
      fail("orchestrator", "Se esperaba EXECUTE o greenfield en creacion", { mode: plan.mode });
    }
  }

  const scaffold = new ProjectScaffoldService();
  let created;
  try {
    created = await scaffold.create({
      name: PROJECT_NAME,
      template: "react",
      parentPath: parentDir,
      install: false,
    }, {});
    log("scaffold", "Proyecto creado", { detail: created.projectRoot, template: created.template });
  } catch (error) {
    fail("scaffold", error.message || String(error));
    return { parentDir, projectRoot: null };
  }

  const projectRoot = created.projectRoot || path.join(parentDir, PROJECT_NAME);
  if (!fs.existsSync(path.join(projectRoot, "package.json"))) {
    fail("scaffold", "Falta package.json tras create", { projectRoot });
    return { parentDir, projectRoot };
  }

  const deps = await installProjectDependencies(projectRoot, { force: true });
  log("deps", deps.message || "install", { ok: deps.ok, skipped: deps.skipped });
  if (!deps.ok && !deps.skipped) {
    fail("deps", deps.message || "npm install fallo");
  }

  const build = await runCmd("npm run build", projectRoot);
  log("build", `exit ${build.code}`, { detail: (build.stderr || build.stdout).slice(-400) });
  if (build.code !== 0) {
    fail("build", "npm run build fallo", { stderr: build.stderr.slice(-800) });
  }

  const test = await runCmd("npm test", projectRoot);
  log("test", `exit ${test.code}`, { detail: (test.stderr || test.stdout).slice(-300) });
  if (test.code !== 0) {
    fail("test", "npm test fallo", { stderr: test.stderr.slice(-500) });
  }

  return { parentDir, projectRoot };
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

function sendProviderResponse(response, payload) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 20, completion_tokens: 12 },
  }));
}

function startMockProvider(projectRoot) {
  let step = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (c) => chunks.push(c));
      request.on("end", () => {
        step += 1;
        if (step === 1) {
          return sendProviderResponse(response, { type: "tool", name: "list_files", input: { path: "." } });
        }
        if (step === 2) {
          return sendProviderResponse(response, {
            type: "tool",
            name: "create_project",
            input: { name: PROJECT_NAME, template: "react", install: false },
          });
        }
        if (step === 3) {
          return sendProviderResponse(response, {
            type: "tool",
            name: "write_file",
            input: {
              path: `${PROJECT_NAME}/src/App.jsx`,
              content: [
                'import { useState } from "react";',
                'export default function App() {',
                '  const [tasks, setTasks] = useState([]);',
                '  const [text, setText] = useState("");',
                '  return (',
                '    <main style={{ padding: 24, fontFamily: "system-ui" }}>',
                '      <h1>TaskFlow</h1>',
                '      <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; setTasks((t) => [...t, text.trim()]); setText(""); }}>',
                '        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nueva tarea" />',
                '        <button type="submit">Agregar</button>',
                '      </form>',
                '      <ul>{tasks.map((t, i) => <li key={i}>{t}</li>)}</ul>',
                '    </main>',
                '  );',
                '}',
                '',
              ].join("\n"),
            },
          });
        }
        if (step === 4) {
          return sendProviderResponse(response, {
            type: "tool",
            name: "write_file",
            input: {
              path: `${PROJECT_NAME}/src/main.jsx`,
              content: 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(<App />);\n',
            },
          });
        }
        if (step === 5) {
          return sendProviderResponse(response, {
            type: "tool",
            name: "run_command",
            input: { command: `cd ${PROJECT_NAME} && npm install` },
          });
        }
        if (step === 6) {
          return sendProviderResponse(response, {
            type: "tool",
            name: "run_command",
            input: { command: `cd ${PROJECT_NAME} && npm run build` },
          });
        }
        return sendProviderResponse(response, {
          type: "final",
          text: "Proyecto TaskFlow creado, dependencias instaladas y build verificado.",
        });
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, getSteps: () => step }));
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
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "evaluate fallo"));
      else resolve(message.result?.result?.value);
      socket.close();
    });
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForPage(debugPort) {
  for (let i = 0; i < 240; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /index\.html/i.test(String(item.url || "")));
      if (page && await evaluate(page, 'document.body?.dataset?.editcoreReady === "1" && Boolean(window.editcoreAgent?.run)').catch(() => false)) {
        return page;
      }
    } catch {}
    await wait(300);
  }
  throw new Error("Electron no expuso pagina lista.");
}

async function phaseElectronUI(parentDir) {
  const acceptanceKey = process.env.EDITCORE_ACCEPTANCE_API_KEY || "local-acceptance-key";
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-greenfield-profile-"));
  const { server, port } = await startMockProvider(parentDir);
  const debugPort = await availablePort();
  const electronBin = path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");
  const appProcess = spawn(electronBin, [appRoot, `--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      EDITCORE_LOCAL_ACCEPTANCE: "1",
      EDITCORE_USER_DATA_PATH: profileRoot,
      EDITCORE_ACCEPTANCE_HIDDEN: "1",
      EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1",
    },
  });

  try {
    const page = await waitForPage(debugPort);
    log("electron", "Renderer listo", { detail: `debug:${debugPort}` });

    const prompt = CHAT_PROMPTS[0];
    const result = await evaluate(page, `(async () => {
      const providerKey = "e2e-greenfield";
      const profileId = "e2e-greenfield-profile";
      const model = "greenfield-e2e-model";
      const baseUrl = ${JSON.stringify(`http://127.0.0.1:${port}/v1`)};
      secureState["editcore-provider-profiles"] = [{
        id: profileId, providerKey, model, baseUrl,
        apiKey: ${JSON.stringify(acceptanceKey)},
        status: "active", agentToolOK: true, agentVerifiedAt: Date.now(),
      }];
      secureState["editcore-providers"] = { [providerKey]: { baseUrl, model, apiKey: ${JSON.stringify(acceptanceKey)} } };
      const root = ${JSON.stringify(parentDir)};
      const project = projectForRoot(root, "E2E Greenfield");
      project.projectRoot = root;
      project.permissionMode = "full";
      project.provider = providerKey;
      project.providerProfileId = profileId;
      project.model = model;
      state.activeProjectId = project.id;
      state.projectRoot = root;
      state.permissionMode = "full";
      const runResult = await window.editcoreAgent.run({
        baseUrl, apiKey: ${JSON.stringify(acceptanceKey)}, model,
        prompt: ${JSON.stringify(prompt)},
        projectRoot: root,
        projectId: project.id,
        agentId: project.activeAgentId || "e2e-agent",
        permissionMode: "full",
        allowWrite: true,
        cursorParityEnabled: true,
        orchestratorPlan: window.EditCoreAgentOrchestrator.resolveUnifiedAgentPlan({
          prompt: ${JSON.stringify(prompt)},
          requestedAgent: true,
          projectOpen: true,
          permissionMode: "full",
          allowWrite: true,
          cursorParityEnabled: true,
        }),
        runId: "greenfield-e2e-run",
      });
      return {
        text: runResult.text,
        completed: runResult.report?.completed,
        stopReason: runResult.report?.stopReason,
        steps: (runResult.steps || []).map((s) => ({
          name: s.name, ok: s.ok, error: s.error || "",
          path: s.input?.path || "", command: s.input?.command || "",
        })),
        usage: runResult.usage,
      };
    })()`);

    log("agent-run", "Agente completado", {
      completed: result?.completed,
      steps: result?.steps?.length,
      stopReason: result?.stopReason,
    });

    for (const step of result?.steps || []) {
      if (step.ok === false) {
        fail("agent-step", `${step.name} fallo`, { error: step.error, path: step.path, command: step.command });
      } else {
        log("agent-step", `${step.name} ok`, { path: step.path, command: step.command });
      }
    }

    if (!result?.completed) {
      fail("agent-run", "Agente no completo la tarea", { stopReason: result?.stopReason, text: result?.text });
    }

    const projectPath = path.join(parentDir, PROJECT_NAME);
    const hasPkg = fs.existsSync(path.join(projectPath, "package.json"));
    const hasApp = fs.existsSync(path.join(projectPath, "src", "App.jsx"));
    log("verify", "Artefactos en disco", { hasPkg, hasApp, projectPath });
    if (!hasPkg) fail("verify", "No se creo package.json en disco");
    if (!hasApp) fail("verify", "No se creo App.jsx en disco");

    return result;
  } finally {
    server.close();
    if (appProcess?.pid) {
      spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    }
    try { fs.rmSync(profileRoot, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  console.log("=== EDITCOREAI Greenfield E2E 0→100 ===\n");
  const { parentDir, projectRoot } = await phaseHeadless();

  if (process.env.GREENFIELD_E2E_UI === "1" && parentDir) {
    try {
      await phaseElectronUI(parentDir);
    } catch (error) {
      fail("electron", error.message || String(error));
    }
  } else {
    log("skip-ui", "Fase Electron omitida (GREENFIELD_E2E_UI=1 para chat real)");
  }

  if (projectRoot && report.ok) {
    log("done", "E2E headless OK", { projectRoot });
  }

  report.finishedAt = new Date().toISOString();
  const outPath = path.join(appRoot, "..", "..", ".editcore", "e2e-greenfield-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReporte: ${outPath}`);
  console.log(report.ok ? "\n✅ E2E PASS" : "\n❌ E2E FAIL");
  if (!report.ok) {
    console.error(JSON.stringify(report.errors, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
