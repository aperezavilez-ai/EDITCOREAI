"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const electron = require("electron");
const adminToken = String(process.env.GAFCORE_ADMIN_TOKEN || "").trim();
const projectRoot = process.env.EDITCORE_GATEWAY_PROJECT_ROOT || "D:\\PROGRAMAS IA\\norwestproduce-main";
const reportPath = process.env.EDITCORE_GATEWAY_REPORT || path.join(os.tmpdir(), "editcore-gateway-project-acceptance.json");
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-gateway-acceptance-"));
const debugPort = 9251;
let appProcess;

if (!adminToken) throw new Error("Falta GAFCORE_ADMIN_TOKEN.");
if (!fs.existsSync(projectRoot)) throw new Error(`No existe el proyecto de prueba: ${projectRoot}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error(message.result?.exceptionDetails?.exception?.description || "Runtime.evaluate fallo."));
      else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page && await evaluate(page, "document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("EDITCOREAI no termino de iniciar para la aceptacion Gateway.");
}

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function adminProjects() {
  const response = await fetch("https://gafcore-gateway.vercel.app/api/admin/projects", {
    headers: { "x-admin-token": adminToken },
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function main() {
  const before = await adminProjects();
  const childEnv = { ...process.env, EDITCORE_USER_DATA_PATH: userDataPath };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  appProcess = spawn(electron, [appRoot, `--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: childEnv,
  });
  const page = await readyPage();
  const result = await evaluate(page, `(async () => {
    const input = {
      localProjectId: "acceptance-norwest",
      projectRoot: ${JSON.stringify(projectRoot)},
      projectName: "norwestproduce-main",
      initialBalanceUsd: 10,
      adminToken: ${JSON.stringify(adminToken)},
    };
    const first = await window.editcoreConnections.connectGatewayProject(input);
    const second = await window.editcoreConnections.connectGatewayProject({ ...input, adminToken: "" });
    const status = await window.editcoreConnections.gatewayProjectStatus(input);
    const secure = await window.editcoreSecureConfig.load();
    const serialized = JSON.stringify(secure);
    return {
      first,
      second,
      status,
      activeModels: (secure["editcore-provider-profiles"] || []).filter((item) => item.providerKey === "custom:gafcore-gateway" && item.status === "active").length,
      selectedProvider: secure["editcore-chat-config"]?.providerKey || "",
      adminTokenExposed: serialized.includes(${JSON.stringify(adminToken)}),
      privateStateExposed: Object.prototype.hasOwnProperty.call(secure, "links") || Object.prototype.hasOwnProperty.call(secure, "adminToken"),
    };
  })()`);
  const after = await adminProjects();
  const sameNamedBefore = before.filter((item) => String(item.name || "").trim().toLowerCase() === "norwestproduce-main").length;
  const sameNamedAfter = after.filter((item) => String(item.name || "").trim().toLowerCase() === "norwestproduce-main").length;
  const report = {
    generatedAt: new Date().toISOString(),
    projectCountBefore: before.length,
    projectCountAfter: after.length,
    sameNamedBefore,
    sameNamedAfter,
    result,
    ok: before.length === after.length
      && sameNamedBefore === 1
      && sameNamedAfter === 1
      && result.first?.reused === true
      && result.second?.reused === true
      && result.status?.connected === true
      && result.activeModels === 12
      && result.selectedProvider === "custom:gafcore-gateway"
      && result.adminTokenExposed === false
      && result.privateStateExposed === false,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, result: { ...result, first: { ...result.first, models: undefined }, second: { ...result.second, models: undefined }, status: { ...result.status, models: undefined } } }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

main()
  .catch((error) => { process.stderr.write(`${String(error?.stack || error)}\n`); process.exitCode = 2; })
  .finally(async () => {
    stopApp();
    await wait(1_000);
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (error) {
      process.stderr.write(`Aviso: no se pudo retirar el perfil temporal: ${error.message}\n`);
    }
  });
