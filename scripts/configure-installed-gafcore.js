"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const gatewayBaseUrl = "https://gafcore-gateway.vercel.app/api/openai/v1";
const adminToken = String(process.env.GAFCORE_ADMIN_TOKEN || "").trim();
const debugPort = 9248;
let appProcess;

if (!adminToken) throw new Error("Falta GAFCORE_ADMIN_TOKEN.");
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
      if (message.error || message.result?.exceptionDetails) reject(new Error("No se pudo actualizar la configuracion instalada."));
      else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page && await evaluate(page, "document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("EDITCOREAI instalado no termino de iniciar.");
}

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function api(pathname) {
  const response = await fetch(`https://gafcore-gateway.vercel.app${pathname}`, {
    headers: { "x-admin-token": adminToken },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body.data;
}

async function main() {
  const projects = await api("/api/admin/projects");
  const project = projects.find((item) => String(item?.name || "").toLowerCase() === "editcore ai");
  if (!project?.project_key) throw new Error("EDITCOREAI no tiene project key en GafCore Gateway.");

  const modelsResponse = await fetch(`${gatewayBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${project.project_key}` },
    signal: AbortSignal.timeout(60_000),
  });
  const modelsBody = await modelsResponse.json().catch(() => ({}));
  const models = Array.isArray(modelsBody?.data) ? modelsBody.data.map((item) => String(item?.id || "").trim()).filter(Boolean) : [];
  if (!modelsResponse.ok || models.length === 0) throw new Error("GafCore Gateway no devolvio modelos para EDITCOREAI.");

  const configPath = path.join(process.env.APPDATA || "", "EDITCOREAI", "editcore-secure-config.bin");
  if (!fs.existsSync(configPath)) throw new Error(`No existe la configuracion instalada: ${configPath}`);
  const backupPath = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(configPath, backupPath);

  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore" });
  const page = await readyPage();
  await evaluate(page, `window.editcoreConnections.storeGatewayAdminToken(${JSON.stringify(adminToken)})`);
  const result = await evaluate(page, `(async () => {
    const secure = await window.editcoreSecureConfig.load();
    const beforeConnections = JSON.stringify(secure["editcore-connections"] || {});
    const models = ${JSON.stringify(models)};
    const baseUrl = ${JSON.stringify(gatewayBaseUrl)};
    const apiKey = ${JSON.stringify(project.project_key)};
    secure["editcore-custom-providers"] = [{
      id: "gafcore-gateway",
      name: "GafCore Gateway",
      baseUrl,
      apiKey,
      models,
      enabledModels: models,
      modelCount: models.length,
      status: "active",
      checkedAt: Date.now(),
    }];
    secure["editcore-provider-profiles"] = models.map((model) => ({
      id: "gafcore-gateway:" + model,
      providerKey: "custom:gafcore-gateway",
      providerName: "GafCore Gateway",
      baseUrl,
      apiKey,
      model,
      modelCount: models.length,
      status: "active",
      catalogConfirmed: true,
      chatVerified: true,
      checkedAt: Date.now(),
      error: "",
    }));
    secure["editcore-providers"] = {};
    secure["editcore-rtk"] = { enabled: true };
    const selectedModel = models[0];
    secure["editcore-chat-config"] = {
      remember: true,
      mode: selectedModel.startsWith("claude") ? "claude" : "gpt",
      baseUrl,
      apiKey,
      model: selectedModel,
      providerKey: "custom:gafcore-gateway",
      provider: "custom:gafcore-gateway",
      providerProfileId: "gafcore-gateway:" + selectedModel,
    };
    delete secure["aiapiflow-config"];
    await window.editcoreSecureConfig.save(secure);
    const saved = await window.editcoreSecureConfig.load();
    return {
      connectionsPreserved: JSON.stringify(saved["editcore-connections"] || {}) === beforeConnections,
      customProviders: saved["editcore-custom-providers"]?.map((item) => item.id),
      providerGroups: [...new Set((saved["editcore-provider-profiles"] || []).map((item) => item.providerKey))],
      modelCount: (saved["editcore-provider-profiles"] || []).length,
      selectedProvider: saved["editcore-chat-config"]?.providerKey,
    };
  })()`);
  if (!result.connectionsPreserved || result.modelCount !== models.length || result.selectedProvider !== "custom:gafcore-gateway") {
    throw new Error("La configuracion instalada no paso la verificacion posterior.");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, backupPath, ...result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}).finally(stopApp);
