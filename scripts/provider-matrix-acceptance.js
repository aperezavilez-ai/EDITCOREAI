"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const electron = path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const childScript = path.join(__dirname, "provider-model-acceptance-child.js");
const reportPath = process.env.EDITCORE_PROVIDER_MATRIX_REPORT || path.join(process.cwd(), "phase4-results", "provider-matrix.json");
const installedUserData = path.join(process.env.APPDATA || "", "EDITCOREAI");
const profileUserData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-provider-profile-"));
const debugPort = 9262;
let appProcess;

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
      if (message.error || message.result?.exceptionDetails) reject(new Error(message.result?.exceptionDetails?.exception?.description || "No se pudieron leer los perfiles."));
      else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page && await evaluate(page, "document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("El EXE instalado no inicio para leer los perfiles cifrados.");
}

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function loadProfiles() {
  const secureConfig = path.join(installedUserData, "editcore-secure-config.bin");
  if (!fs.existsSync(secureConfig)) throw new Error("No existe la configuracion cifrada instalada.");
  fs.copyFileSync(secureConfig, path.join(profileUserData, "editcore-secure-config.bin"));
  const gatewayPrivateState = path.join(installedUserData, "editcore-gafcore-projects.bin");
  if (fs.existsSync(gatewayPrivateState)) fs.copyFileSync(gatewayPrivateState, path.join(profileUserData, "editcore-gafcore-projects.bin"));
  const localStorage = path.join(installedUserData, "Local Storage");
  if (fs.existsSync(localStorage)) fs.cpSync(localStorage, path.join(profileUserData, "Local Storage"), { recursive: true });
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      EDITCORE_USER_DATA_PATH: installedUserData,
      EDITCORE_ACCEPTANCE_HIDDEN: "1",
      EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1",
    },
  });
  const page = await readyPage();
  const profiles = await evaluate(page, `(async () => {
    let secure = await window.editcoreSecureConfig.load();
    const incomplete = !(secure["editcore-provider-profiles"] || []).some((item) => item?.providerKey === "custom:gafcore-gateway" && item?.apiKey && item?.baseUrl);
    if (incomplete) {
      const linked = (state.projects || []).find((item) => item?.gafcoreProjectId && item?.projectRoot);
      if (linked) {
        await window.editcoreConnections.activateGatewayProject({ localProjectId: linked.id, projectRoot: linked.projectRoot });
        secure = await window.editcoreSecureConfig.load();
      }
    }
    const config = secure["editcore-chat-config"] || {};
    const custom = (secure["editcore-custom-providers"] || []).find((item) => item?.id === "gafcore-gateway"
      || String(item?.baseUrl || "").includes("gafcore-gateway.vercel.app"));
    const rows = (secure["editcore-provider-profiles"] || [])
      .filter((item) => item?.providerKey === "custom:gafcore-gateway" && item?.model && ["active", "enabled"].includes(item?.status))
      .map((item) => ({
        providerKey: item.providerKey,
        baseUrl: item.baseUrl || custom?.baseUrl || config.baseUrl || "",
        apiKey: item.apiKey || custom?.apiKey || config.apiKey || "",
        model: item.model,
      }));
    if (!rows.length || rows.some((item) => !item.apiKey || !item.baseUrl)) throw new Error("Los perfiles activos de GafCore no tienen una conexion operativa completa.");
    return rows;
  })()`);
  stopApp();
  appProcess = null;
  return profiles;
}

function runModel(profile, index) {
  const modelReport = path.join(os.tmpdir(), `editcore-provider-model-${process.pid}-${index}.json`);
  const result = spawnSync(electron, [childScript], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: "ignore",
    timeout: 12 * 60 * 1000,
    env: {
      ...process.env,
      EDITCORE_PROVIDER_PROFILE: Buffer.from(JSON.stringify(profile), "utf8").toString("base64"),
      EDITCORE_PROVIDER_MODEL_REPORT: modelReport,
    },
  });
  let report = { provider: String(profile.model || "").split("/")[0], model: profile.model, ok: false };
  try { report = JSON.parse(fs.readFileSync(modelReport, "utf8")); }
  catch { report.error = result.error?.message || `La prueba termino sin reporte (codigo ${result.status}).`; }
  try { fs.rmSync(modelReport, { force: true }); } catch {}
  return report;
}

async function main() {
  const profiles = await loadProfiles();
  if (!profiles.length) throw new Error("No hay modelos activos de GafCore para validar.");
  if (process.env.EDITCORE_PROVIDER_MATRIX_INVENTORY === "1") {
    const inventory = profiles.map((profile) => ({
      provider: String(profile.model || "").split("/")[0],
      model: profile.model,
      baseHost: new URL(profile.baseUrl).hostname,
    }));
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return;
  }
  const requested = new Set(String(process.env.EDITCORE_PROVIDER_MODELS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const selected = requested.size ? profiles.filter((profile) => requested.has(profile.model)) : profiles;
  let priorResults = [];
  if (process.env.EDITCORE_PROVIDER_MATRIX_RESUME === "1" && fs.existsSync(reportPath)) {
    try {
      priorResults = (JSON.parse(fs.readFileSync(reportPath, "utf8")).results || []).filter((item) => item?.ok === true);
    } catch {}
  }
  const passedModels = new Set(priorResults.map((item) => item.model));
  const pending = selected.filter((profile) => !passedModels.has(profile.model));
  const results = [...priorResults];
  for (const [index, profile] of pending.entries()) {
    process.stdout.write(`VALIDATING ${profile.model}\n`);
    const item = runModel(profile, index);
    results.push(item);
    process.stdout.write(`${item.ok ? "PASS" : "FAIL"} ${profile.model}\n`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ok: false, inProgress: true, results }, null, 2)}\n`, "utf8");
  }
  const providers = [...new Set(results.map((item) => item.provider))].sort();
  const report = {
    generatedAt: new Date().toISOString(),
    ok: results.length === selected.length && results.every((item) => item.ok),
    expectedProviders: ["apicredits", "meai"],
    providers,
    summary: {
      models: results.length,
      passed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      chatPassed: results.filter((item) => item.chat?.ok).length,
      agentPassed: results.filter((item) => item.agent?.ok).length,
    },
    results,
  };
  if (!requested.size && report.expectedProviders.some((provider) => !providers.includes(provider))) report.ok = false;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ generatedAt: report.generatedAt, ok: report.ok, providers: report.providers, summary: report.summary, results: results.map(({ provider, model, ok, chat, agent, error }) => ({ provider, model, ok, chat, agent, error })) }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ok: false, error: String(error?.message || error) }, null, 2)}\n`, "utf8");
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 2;
}).finally(() => {
  stopApp();
  try { fs.rmSync(profileUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
});
