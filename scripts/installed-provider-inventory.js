"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const debugPort = 9246;
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

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore" });
  const page = await readyPage();
  const raw = await evaluate(page, `(async () => {
    const secure = await window.editcoreSecureConfig.load();
    const providers = secure["editcore-providers"] || {};
    const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    return ["meai", "apicredits"].map((providerKey) => ({
      providerKey,
      baseUrl: providers[providerKey]?.baseUrl || profiles.find((item) => item?.providerKey === providerKey)?.baseUrl || "",
      profiles: profiles.filter((item) => item?.providerKey === providerKey && item?.model && item?.apiKey).map((item) => ({
        model: item.model,
        status: item.status,
        apiKey: item.apiKey,
      })),
    }));
  })()`);
  const sanitized = raw.map((provider) => {
    const active = provider.profiles.filter((profile) => ["active", "enabled"].includes(profile.status));
    const fingerprints = [...new Set(active.map((profile) => crypto.createHash("sha256").update(profile.apiKey).digest("hex").slice(0, 12)))];
    return {
      providerKey: provider.providerKey,
      baseUrl: provider.baseUrl,
      activeModels: [...new Set(active.map((profile) => profile.model))].sort(),
      keyFingerprints: fingerprints,
      hasSingleKey: fingerprints.length === 1,
    };
  });
  process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }).finally(stopApp);
