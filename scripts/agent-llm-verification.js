"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
const reportPath = process.env.EDITCORE_AGENT_LLM_REPORT || path.join(root, "agent-llm-verification.json");
const projectRoot = process.env.EDITCORE_AGENT_TEST_PROJECT || "D:/PROGRAMAS IA/GRUPO EMERGENTE";
const debugPort = Number(process.env.EDITCORE_AGENT_VERIFY_PORT || 9232);
let appProcess = null;

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
      const ready = page && await cdp(page, "document.readyState === 'complete' && typeof loadProviderProfiles === 'function' && Boolean(window.editcoreAgent)").catch(() => false);
      if (ready) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("EDITCOREAI empaquetado no cargo el runtime de agente.");
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), executable, projectRoot, ok: false, results: [] };
  try {
    appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], { windowsHide: true, stdio: "ignore", env: process.env });
    const page = await readyPage();
    report.runtime = await cdp(page, `(async () => {
      const projectRoot = ${JSON.stringify(projectRoot)};
      const profiles = loadProviderProfiles()
        .filter((profile) => ["active", "enabled"].includes(profile?.status) && profile?.apiKey && profile?.baseUrl && profile?.model);
      const unique = [];
      const seen = new Set();
      for (const profile of profiles) {
        const key = [profile.providerKey, profile.baseUrl, profile.model].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(profile);
      }
      const results = [];
      for (const profile of unique.slice(0, 20)) {
        const started = Date.now();
        const result = await window.editcoreAgent.verifyModel({
          providerKey: profile.providerKey,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          model: profile.model,
          projectRoot,
        }).catch((error) => ({ chatOK: false, toolOK: false, error: error?.message || String(error) }));
        results.push({
          providerKey: profile.providerKey,
          model: profile.model,
          chatOK: result.chatOK === true,
          toolOK: result.toolOK === true,
          ok: result.ok === true || (result.chatOK === true && result.toolOK === true),
          capability: result.capability || "",
          tool: result.tool || "",
          entriesRead: result.entriesRead || 0,
          error: String(result.toolError || result.error || "").slice(0, 260),
          ms: Date.now() - started,
        });
      }
      return { profileCount: profiles.length, tested: results.length, results };
    })()`);
    report.results = report.runtime.results || [];
    report.ok = report.results.some((item) => item.chatOK && item.toolOK);
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 3000);
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stopApp();
    await wait(500);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

main();
