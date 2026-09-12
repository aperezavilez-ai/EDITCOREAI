"use strict";

/**
 * Sonda forense live: lanza EXE con CDP, verifica modelos y corre agente scoped FOCO.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.join(root, "EDITCOREAI.exe");
const reportPath = path.join(root, "chat-forensic-live-report.json");
const projectRoot = process.env.EDITCORE_LIVE_PROJECT || "D:\\PROGRAMAS IA\\TAXIDRIV";
const debugPort = Number(process.env.EDITCORE_LIVE_PORT || 9344);
const prompt = [
  "Analiza unicamente package.json de la raiz.",
  "No explores android/ios/docs.",
  "Si no hay nada que corregir, dilo y NO pidas PROCEDE.",
].join(" ");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let appProcess = null;

async function cdp(page, expression, timeoutMs = 180_000) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error(`CDP timeout ${timeoutMs}ms`));
    }, timeoutMs);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo"));
      } else resolve(message.result?.result?.value);
    });
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  return result;
}

async function readyPage() {
  let lastErr = "";
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /index\.html/i.test(String(item.url || "")));
      if (!page) {
        lastErr = "sin page index.html";
        await wait(500);
        continue;
      }
      const ready = await cdp(
        page,
        `Boolean(window.editcoreAgent) && Boolean(window.editcoreSecureConfig) && document.body?.dataset?.editcoreReady === "1"`,
        8_000,
      ).catch((error) => {
        lastErr = String(error?.message || error);
        return false;
      });
      if (ready) return page;
    } catch (error) {
      lastErr = String(error?.message || error);
    }
    await wait(500);
  }
  throw new Error(`EDITCOREAI no cargo runtime de chat/agente. last=${lastErr}`);
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    executable,
    projectRoot,
    prompt,
    ok: false,
    stages: {},
  };
  try {
    appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
      stdio: "ignore",
      env: process.env,
      detached: false,
      windowsHide: false,
    });
    await wait(12_000);
    const page = await readyPage();
    report.stages.uiReady = true;

    // Screenshot via CDP Page.captureScreenshot
    report.stages.screenshot = await (async () => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      await new Promise((resolve) => {
        socket.send(JSON.stringify({ id: 10, method: "Page.enable" }));
        socket.addEventListener("message", (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.id === 10) resolve();
        }, { once: true });
      });
      const shot = await new Promise((resolve, reject) => {
        socket.addEventListener("message", (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.id !== 11) return;
          socket.close();
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result?.data || "");
        });
        socket.send(JSON.stringify({ id: 11, method: "Page.captureScreenshot", params: { format: "png" } }));
      });
      const out = path.join(root, "chat-forensic-ui.png");
      fs.writeFileSync(out, Buffer.from(shot, "base64"));
      return { path: out, bytes: Buffer.from(shot, "base64").length };
    })();

    report.stages.providers = await cdp(page, `(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const profiles = (secure["editcore-provider-profiles"] || [])
        .filter((p) => p && ["active","enabled"].includes(p.status) && p.apiKey && p.model);
      return {
        count: profiles.length,
        models: profiles.slice(0, 8).map((p) => ({ providerKey: p.providerKey, model: p.model, hasKey: true })),
      };
    })()`, 30_000);

    // verify first 2 models
    report.stages.verifyModels = await cdp(page, `(async () => {
      const projectRoot = ${JSON.stringify(projectRoot)};
      const secure = await window.editcoreSecureConfig.load();
      const providers = secure["editcore-providers"] || {};
      const profiles = (secure["editcore-provider-profiles"] || [])
        .filter((p) => p && ["active","enabled"].includes(p.status) && p.apiKey && p.model)
        .slice(0, 2);
      const results = [];
      for (const profile of profiles) {
        const provider = providers[profile.providerKey] || {};
        const started = Date.now();
        try {
          const result = await window.editcoreAgent.verifyModel({
            providerKey: profile.providerKey,
            baseUrl: profile.baseUrl || provider.baseUrl,
            apiKey: profile.apiKey,
            model: profile.model,
            projectRoot,
          });
          results.push({
            providerKey: profile.providerKey,
            model: profile.model,
            chatOK: result.chatOK === true,
            toolOK: result.toolOK === true,
            ok: result.ok === true || (result.chatOK === true && result.toolOK === true),
            ms: Date.now() - started,
            error: String(result.toolError || result.error || "").slice(0, 200),
          });
        } catch (error) {
          results.push({
            providerKey: profile.providerKey,
            model: profile.model,
            ok: false,
            ms: Date.now() - started,
            error: String(error?.message || error).slice(0, 200),
          });
        }
      }
      return results;
    })()`, 240_000);

    // Scoped FOCO agent run with first working model
    const working = (report.stages.verifyModels || []).find((r) => r.ok || r.chatOK);
    if (working) {
      report.stages.scopedAgent = await cdp(page, `(async () => {
        const projectRoot = ${JSON.stringify(projectRoot)};
        const prompt = ${JSON.stringify(prompt)};
        const secure = await window.editcoreSecureConfig.load();
        const providers = secure["editcore-providers"] || {};
        const profiles = secure["editcore-provider-profiles"] || [];
        const profile = profiles.find((p) => p.providerKey === ${JSON.stringify(working.providerKey)} && p.model === ${JSON.stringify(working.model)}) || profiles[0];
        const provider = providers[profile.providerKey] || {};
        const runId = "forensic-scoped-" + Date.now();
        const tools = [];
        window.editcoreAgent.onProgress((item) => {
          if (item?.runId !== runId) return;
          if (item.phase === "tool") tools.push({ name: item.name || "", stage: item.stage || "", path: item.input?.path || "", ok: item.ok !== false });
        });
        const result = await window.editcoreAgent.run({
          providerKey: profile.providerKey,
          baseUrl: profile.baseUrl || provider.baseUrl,
          apiKey: profile.apiKey,
          model: profile.model,
          prompt,
          projectRoot,
          projectId: "taxidriv-forensic",
          agentId: "forensic-scoped",
          permissionMode: "readonly",
          allowWrite: false,
          analysisMode: true,
          planAuthorized: false,
          requireEvidence: true,
          runId,
        });
        const text = String(result?.text || result?.report?.text || "").slice(0, 2500);
        const toolNames = tools.map((t) => t.name + ":" + (t.path || ""));
        const violated = toolNames.some((t) => /list_files:(android|ios|src|docs)/i.test(t) || /read_file:(android|ios|vite|src\\/)/i.test(t));
        const readPkg = toolNames.some((t) => /read_file:.*package\\.json/i.test(t));
        return {
          completed: result?.report?.completed === true,
          toolCount: (result?.report?.toolCount || tools.length || 0),
          tools: toolNames.slice(0, 40),
          readPackageJson: readPkg,
          violatedScope: violated,
          textHead: text,
          stopReason: result?.report?.stopReason || "",
        };
      })()`, 420_000);

      // Second screenshot after agent
      report.stages.screenshotAfter = await (async () => {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        const shot = await new Promise((resolve, reject) => {
          socket.send(JSON.stringify({ id: 21, method: "Page.captureScreenshot", params: { format: "png" } }));
          socket.addEventListener("message", (ev) => {
            const msg = JSON.parse(String(ev.data));
            if (msg.id !== 21) return;
            socket.close();
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result?.data || "");
          });
        });
        const out = path.join(root, "chat-forensic-after-agent.png");
        fs.writeFileSync(out, Buffer.from(shot, "base64"));
        return { path: out, bytes: Buffer.from(shot, "base64").length };
      })();
    } else {
      report.stages.scopedAgent = { skipped: true, reason: "ningun modelo verify OK" };
    }

    const modelsOk = (report.stages.verifyModels || []).some((r) => r.ok || (r.chatOK && r.toolOK));
    const scoped = report.stages.scopedAgent || {};
    report.ok = Boolean(
      report.stages.uiReady
      && report.stages.screenshot?.bytes > 1000
      && modelsOk
      && scoped.completed
      && scoped.readPackageJson
      && !scoped.violatedScope,
    );
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 4000);
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stopApp();
    console.log(JSON.stringify({ ok: report.ok, reportPath, error: report.error || null, stages: Object.keys(report.stages || {}) }, null, 2));
    process.exit(report.ok ? 0 : 2);
  }
}

main();
