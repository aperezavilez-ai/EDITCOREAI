"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
const reportPath = process.env.EDITCORE_PROVIDER_REPORT || path.join(process.cwd(), "packaged-provider-acceptance.json");
const providerName = String(process.env.EDITCORE_PROVIDER_NAME || "GafCore Gateway").trim().toLowerCase();
const debugPort = 9231;
let appProcess;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdp(page, expression) {
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
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo."));
      else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page && await cdp(page, "document.readyState === 'complete' && typeof loadCustomProviders === 'function' && Boolean(document.getElementById('chatModelSelect'))").catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("El ejecutable no cargo el selector de proveedores.");
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), providerName, ok: false };
  try {
    appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore", env: process.env });
    const page = await readyPage();
    report.result = await cdp(page, `(async () => {
      const providers = loadCustomProviders();
      const provider = providers.find((item) => String(item?.name || "").trim().toLowerCase() === ${JSON.stringify(providerName)}
        || String(item?.baseUrl || "").toLowerCase().includes("gafcore-gateway.vercel.app"));
      if (!provider) throw new Error("Proveedor GafCore Gateway no encontrado.");
      const providerKey = "custom:" + provider.id;
      setChatModelOptions([], provider.model, providerKey, provider.id + ":" + provider.model);
      const options = [...document.getElementById("chatModelSelect").options].filter((option) => option.dataset.providerKey === providerKey);
      const selected = options.find((option) => option.dataset.model === provider.model) || options[0];
      document.getElementById("chatModelSelect").value = selected?.value || "";
      const job = buildPromptJob("Responde solamente OK");
      const verification = await window.editcoreProviders.test({ providerKey, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: selected?.dataset.model || provider.model });
      const activeProfiles = loadProviderProfiles().filter((profile) => profile.providerKey === providerKey && profile.status === "active");
      return {
        provider: provider.name,
        catalogCount: normalizedProviderModels(provider).length,
        selectedCount: Array.isArray(provider.enabledModels) ? provider.enabledModels.length : 0,
        activeProfileCount: activeProfiles.length,
        visibleChatCount: options.length,
        visibleModelLimit: Number(provider.visibleModelLimit || 0),
        selectedModel: selected?.dataset.model || "",
        promptJobReady: Boolean(job?.model && job?.apiKey && job?.baseUrl),
        chatOK: verification.chatOK === true,
        toolOK: verification.toolOK === true,
      };
    })()`);
    const result = report.result;
    report.ok = Boolean(result.catalogCount > 0
      && result.selectedCount === result.catalogCount
      && result.activeProfileCount === result.catalogCount
      && result.visibleChatCount === result.catalogCount
      && result.visibleModelLimit === 0
      && result.promptJobReady
      && result.chatOK
      && result.toolOK);
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 3000);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stopApp();
    await wait(1_000);
  }
  if (!report.ok) process.exitCode = 2;
}

main();
