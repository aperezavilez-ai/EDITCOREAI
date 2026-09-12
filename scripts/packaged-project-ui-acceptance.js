"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
let debugPort = 0;
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-project-ui-profile-"));
const normalUserData = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
const secureConfig = path.join(normalUserData, "editcore-secure-config.bin");
if (fs.existsSync(secureConfig)) fs.copyFileSync(secureConfig, path.join(profileRoot, "editcore-secure-config.bin"));
const projectCatalogRoot = "D:\\PROGRAMAS IA";
const expectedProjectNames = fs.readdirSync(projectCatalogRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
let appProcess;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = require("node:http").createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

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
  throw new Error("El EXE no termino de iniciar.");
}

function stopApp() {
  if (appProcess?.pid) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  debugPort = await availablePort();
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, EDITCORE_USER_DATA_PATH: profileRoot, EDITCORE_ACCEPTANCE_HIDDEN: "1", EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1" },
  });
  const page = await readyPage();
  const result = await evaluate(page, `(async () => {
    await refreshProjectCatalog();
    renderProjects();
    state.activeProjectId = "";
    state.projectRoot = "";
    document.getElementById("runMode").value = "agent";
    document.getElementById("prompt").value = "Vamos a trabajar en un nuevo proyecto";
    updateSendButtonState();
    const agentWithoutProjectButtonEnabled = document.getElementById("sendBtn").disabled === false;
    document.getElementById("chatForm").requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const feedText = document.getElementById("feed").textContent;
    const agentWithoutProjectMessage = feedText.includes("Abre o crea un proyecto antes de usar el agente")
      && feedText.includes("No se realizo ninguna llamada al proveedor");
    const projectNames = [...document.querySelectorAll("#projectsManagerList .project-item span")].map((item) => item.textContent.trim());
    return {
      projectRoot: state.projectRoot,
      activeProjectId: state.activeProjectId,
      projectLabel: document.getElementById("projectPathLabel")?.textContent.trim(),
      previewUrl: document.getElementById("previewUrl")?.value.trim(),
      agentWithoutProjectButtonEnabled,
      agentWithoutProjectMessage,
      projectNames,
      rtkTogglePresent: Boolean(document.getElementById("rtkEnabled")),
    };
  })()`);
  const ok = result.projectRoot === ""
    && result.agentWithoutProjectButtonEnabled === true
    && result.agentWithoutProjectMessage === true
    && result.projectLabel === "Sin proyecto"
    && result.previewUrl === ""
    && result.projectNames.includes("TAXIDRIV")
    && result.projectNames.includes("EDITCOREAI")
    && !result.projectNames.includes("PROGRAMAS IA")
    && expectedProjectNames.every((name) => result.projectNames.includes(name))
    && result.rtkTogglePresent === false;
  process.stdout.write(`${JSON.stringify({ ok, ...result }, null, 2)}\n`);
  if (!ok) process.exitCode = 2;
}

main()
  .catch((error) => { process.stderr.write(`${String(error?.stack || error)}\n`); process.exitCode = 2; })
  .finally(() => {
    stopApp();
    try { fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  });
