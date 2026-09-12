"use strict";

const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const debugPort = 9242;
let appProcess;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo."));
      else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page && await evaluate(page, "document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("EDITCOREAI no termino de iniciar.");
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore", env: { ...process.env, EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1" } });
  const page = await readyPage();
  const result = await evaluate(page, `(async () => {
    const secure = await window.editcoreSecureConfig.load();
    const connections = secure["editcore-connections"] || {};
    const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    const custom = Array.isArray(secure["editcore-custom-providers"]) ? secure["editcore-custom-providers"] : [];
    const select = document.getElementById("chatModelSelect");
    return {
      ready: document.body?.dataset?.editcoreReady === "1",
      connections: {
        github: Boolean(connections.githubToken),
        vercel: Boolean(connections.vercelToken),
        supabase: Boolean(connections.selfSupabaseUrl && connections.selfSupabaseKey),
        ssh: Boolean(connections.serverHost && connections.serverKeyPath),
      },
      profileGroups: [...new Set(profiles.filter((item) => item?.status === "active" && item?.model).map((item) => item.providerKey))].sort(),
      activeModels: profiles.filter((item) => item?.status === "active" && item?.model).length,
      visibleChatModels: [...(select?.options || [])].filter((item) => item.dataset.model).length,
      selectedModel: select?.selectedOptions?.[0]?.dataset?.model || "",
      apiyiPresent: custom.some((item) => /apiyi/i.test(String(item?.name || "") + String(item?.baseUrl || ""))),
      rtkEnabled: secure["editcore-rtk"]?.enabled === true,
      controls: {
        connections: Boolean(document.getElementById("connectionsBtn")),
        providers: Boolean(document.getElementById("providersBtn")),
        inspector: Boolean(document.getElementById("inspectorBtn")),
        publish: Boolean(document.getElementById("publishBtn")),
        send: Boolean(document.querySelector("#chatForm button[type='submit']")),
      },
    };
  })()`);
  result.ok = result.ready
    && Object.values(result.connections).every(Boolean)
    && result.profileGroups.length === 1
    && result.profileGroups[0] === "custom:gafcore-gateway"
    && result.activeModels === 12
    && result.visibleChatModels === 12
    && !result.apiyiPresent
    && result.rtkEnabled
    && Object.values(result.controls).every(Boolean);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

main()
  .catch((error) => { process.stderr.write(`${String(error?.stack || error)}\n`); process.exitCode = 2; })
  .finally(() => stopApp());
