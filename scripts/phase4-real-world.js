"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const reportPath = process.env.EDITCORE_PHASE4_REPORT || path.join(process.cwd(), "phase4-results", "phase4-real-world.json");
const childScript = path.join(__dirname, "phase4-real-world-child.js");
const electron = path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const debugPort = 9254;
let installedProcess;

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
      if (message.error || message.result?.exceptionDetails) reject(new Error(message.result?.exceptionDetails?.exception?.description || "No se pudo leer el perfil activo."));
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
  throw new Error("El ejecutable instalado no termino de iniciar para leer el perfil activo.");
}

function stopInstalled() {
  if (installedProcess?.pid) spawnSync("taskkill", ["/pid", String(installedProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

function runChild(profile) {
  const env = {
    ...process.env,
    EDITCORE_PHASE4_PROFILE: Buffer.from(JSON.stringify(profile), "utf8").toString("base64"),
    EDITCORE_PHASE4_REPORT: reportPath,
  };
  const result = spawnSync(electron, [childScript], { cwd: process.cwd(), env, windowsHide: true, stdio: "inherit", timeout: 30 * 60 * 1000 });
  if (result.error) throw result.error;
  try {
    const childReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (childReport.runtimeUserData && /^C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\editcore-phase4-user-[A-Za-z0-9]+$/i.test(childReport.runtimeUserData)) {
      fs.rmSync(childReport.runtimeUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  } catch {}
  return Number(result.status || 0);
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`No existe el ejecutable instalado: ${executable}`);
  installedProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore" });
  const page = await readyPage();
  const profile = await evaluate(page, `(async () => {
    const secure = await window.editcoreSecureConfig.load();
    const config = secure["editcore-chat-config"] || {};
    const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    const custom = Array.isArray(secure["editcore-custom-providers"]) ? secure["editcore-custom-providers"] : [];
    const selected = profiles.find((item) => item?.id === config.providerProfileId)
      || profiles.find((item) => item?.providerKey === config.providerKey && item?.model === config.model)
      || profiles.find((item) => item?.status === "active" && item?.apiKey && item?.model);
    const customProvider = custom.find((item) => "custom:" + item?.id === (selected?.providerKey || config.providerKey));
    return {
      providerKey: selected?.providerKey || config.providerKey || "",
      baseUrl: selected?.baseUrl || customProvider?.baseUrl || config.baseUrl || "",
      apiKey: selected?.apiKey || customProvider?.apiKey || config.apiKey || "",
      model: selected?.model || config.model || "",
    };
  })()`);
  stopInstalled();
  installedProcess = null;
  if (!profile?.apiKey || !profile?.baseUrl || !profile?.model) throw new Error("El ejecutable no tiene un perfil activo completo para la prueba real.");
  const status = runChild(profile);
  if (status !== 0) process.exitCode = status;
}

main().catch((error) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ok: false, blocked: true, stage: "provider-profile", error: String(error?.message || error) }, null, 2)}\n`, "utf8");
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 2;
}).finally(stopInstalled);
