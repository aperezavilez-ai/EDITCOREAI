"use strict";

const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const gateway = String(process.env.GAFCORE_GATEWAY_URL || "https://gafcore-gateway.vercel.app").replace(/\/+$/, "");
const adminToken = String(process.env.GAFCORE_ADMIN_TOKEN || "").trim();
const meAiGpt55ApiKey = String(process.env.MEAI_GPT55_API_KEY || "").trim();
const debugPort = 9247;
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
      if (message.error || message.result?.exceptionDetails) reject(new Error("No se pudo leer la configuracion instalada."));
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

async function api(path, options = {}) {
  const response = await fetch(`${gateway}${path}`, {
    ...options,
    headers: { "x-admin-token": adminToken, "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`${path}: ${body?.error?.message || `HTTP ${response.status}`}`);
  return body.data;
}

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore" });
  const page = await readyPage();
  const source = await evaluate(page, `(async () => {
    const secure = await window.editcoreSecureConfig.load();
    const providers = secure["editcore-providers"] || {};
    const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    return ["meai", "apicredits"].map((providerKey) => ({
      providerKey,
      baseUrl: providers[providerKey]?.baseUrl || profiles.find((item) => item?.providerKey === providerKey)?.baseUrl || "",
      profiles: profiles.filter((item) => item?.providerKey === providerKey && item?.model && item?.apiKey && ["active", "enabled"].includes(item.status)).map((item) => ({ model: item.model, apiKey: item.apiKey })),
    }));
  })()`);

  const definitions = {
    meai: {
      name: "ME AI Cloud",
      models: [
        "claude-sonnet-4.6",
        "claude-haiku-4-5",
        "claude-opus-4.8",
        "qwen3.6-plus",
        "glm-5",
        "deepseek-v4-pro",
        "kimi-k2.6",
      ],
    },
    apicredits: {
      name: "APICredits",
      models: [
        "claude-fable-5", "claude-haiku-4-5", "claude-opus-4-7", "claude-opus-4-8",
        "claude-sonnet-4-6", "claude-sonnet-5",
        "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra",
      ],
    },
  };
  const current = await api("/api/admin/providers?include_blocked=1");
  const migrated = [];
  for (const item of source) {
    const definition = definitions[item.providerKey];
    const sourceKeys = Object.fromEntries(item.profiles.map((profile) => [profile.model, profile.apiKey]));
    if (item.providerKey === "meai" && meAiGpt55ApiKey) sourceKeys["gpt-5.5"] = meAiGpt55ApiKey;
    const keyring = Object.fromEntries(
      definition.models
        .filter((model) => typeof sourceKeys[model] === "string" && sourceKeys[model].trim())
        .map((model) => [model, sourceKeys[model]])
    );
    const models = Object.keys(keyring).sort();
    const missingModels = definition.models.filter((model) => !keyring[model]);
    if (!item.baseUrl || missingModels.length > 0) {
      throw new Error(`Configuracion incompleta para ${item.providerKey}: faltan ${missingModels.join(", ")}.`);
    }
    const payload = {
      name: definition.name,
      base_url: item.baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, ""),
      api_key: JSON.stringify(keyring),
      provider_type: "openai-compatible",
      input_cost_per_million: 0,
      output_cost_per_million: 0,
      endpoint_path: "/v1/chat/completions",
      rate_limit_per_minute: 60,
      status: "active",
    };
    const existing = current.find((provider) => provider.name.toLowerCase() === definition.name.toLowerCase());
    const provider = existing
      ? await api(`/api/admin/providers/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api("/api/admin/providers", { method: "POST", body: JSON.stringify({ ...payload, account_balance_usd: 0 }) });
    migrated.push({ id: provider.id, name: provider.name, models });
  }

  await api("/api/admin/provider-routes", {
    method: "PUT",
    body: JSON.stringify({
      project_id: null,
      mode: "auto",
      routes: migrated.map((provider, index) => ({
        provider_id: provider.id,
        sort_order: index + 1,
        enabled: true,
        mode: "auto",
        role: index === 0 ? "primary" : "fallback",
        model_override: null,
      })),
    }),
  });

  const projects = await api("/api/admin/projects");
  let editCoreProject = projects.find((project) => project.name.toLowerCase() === "editcore ai");
  let created = false;
  if (!editCoreProject) {
    const owner = projects.find((project) => project.user_id);
    if (!owner) throw new Error("No existe un usuario propietario para crear EDITCOREAI.");
    editCoreProject = await api("/api/admin/projects", {
      method: "POST",
      body: JSON.stringify({ user_id: owner.user_id, name: "EDITCOREAI", initial_balance_usd: 100 }),
    });
    created = true;
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    providers: migrated.map(({ id, name, models }) => ({ id, name, models })),
    editCoreProject: { id: editCoreProject.id, name: editCoreProject.name, created, hasProjectKey: Boolean(editCoreProject.project_key) },
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }).finally(stopApp);
