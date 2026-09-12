"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const profile = JSON.parse(Buffer.from(String(process.env.EDITCORE_PROVIDER_PROFILE || ""), "base64").toString("utf8"));
const reportPath = String(process.env.EDITCORE_PROVIDER_MODEL_REPORT || path.join(os.tmpdir(), "editcore-provider-model.json"));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-provider-user-"));
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-provider-project-"));
process.env.EDITCORE_USER_DATA_PATH = userData;
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";
process.env.EDITCORE_PROVIDER_ACCEPTANCE = "1";

function createFixture() {
  fs.mkdirSync(path.join(projectRoot, "test"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# Provider acceptance\n\nEstado: pendiente\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify({
    name: "editcore-provider-acceptance",
    private: true,
    scripts: { test: "node test/run.js" },
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "test", "run.js"), [
    '"use strict";',
    'const assert = require("node:assert/strict");',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");',
    'assert.match(readme, /Estado: completado/);',
    'console.log("PROVIDER_AGENT_OK");',
    "",
  ].join("\n"), "utf8");
}

function sanitizedUsage(value = {}) {
  return {
    inputTokens: Number(value.confirmed_input_tokens || value.estimated_input_tokens || 0),
    outputTokens: Number(value.confirmed_output_tokens || value.estimated_output_tokens || 0),
    cachedTokens: Number(value.provider_cache_read_tokens || 0),
    calls: Number(value.provider_calls || 0),
  };
}

async function readyWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (win && await win.webContents.executeJavaScript("document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return win;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("EDITCOREAI no inicio para la prueba del modelo.");
}

require("../main");
createFixture();

app.whenReady().then(async () => {
  const providerGroup = String(profile.model || "").split("/")[0].toLowerCase();
  const report = {
    generatedAt: new Date().toISOString(),
    provider: providerGroup,
    model: String(profile.model || ""),
    baseHost: new URL(profile.baseUrl).hostname,
    chat: { ok: false },
    agent: { ok: false },
    ok: false,
  };
  try {
    const win = await readyWindow();
    const chatStarted = Date.now();
    const chat = await win.webContents.executeJavaScript(`window.editcoreChat.chat(${JSON.stringify({
      mode: "gpt",
      providerKey: profile.providerKey,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      prompt: "Responde solamente EDITCORE_CHAT_OK",
      history: [],
      images: [],
    })})`, true);
    const chatText = String(chat?.text || "").trim();
    report.chat = {
      ok: Boolean(chatText) && !/tool_call|tool_use|<function/i.test(chatText),
      durationMs: Date.now() - chatStarted,
      usage: sanitizedUsage(chat?.usage),
    };

    const agentStarted = Date.now();
    const agent = await win.webContents.executeJavaScript(`window.editcoreAgent.run(${JSON.stringify({
      providerKey: profile.providerKey,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      prompt: "En README.md cambia Estado: pendiente por Estado: completado. Lee README.md, aplica el cambio real y ejecuta npm test. No termines hasta verificarlo.",
      projectRoot,
      projectId: `provider-${crypto.randomUUID()}`,
      agentId: "provider-acceptance",
      allowWrite: true,
      permissionMode: "full",
      planAuthorized: true,
      runId: crypto.randomUUID(),
      sessionProviderCalls: 28,
      sessionNetInputTokens: 40_000,
    })})`, true);
    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const independent = spawnSync("node", [path.join(projectRoot, "test", "run.js")], {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    const tools = (agent?.steps || []).map((step) => String(step.name || ""));
    const mutation = tools.some((name) => ["replace_in_file", "write_file"].includes(name));
    const verification = tools.includes("run_command")
      && (agent?.report?.verificationCommands || []).some((command) => /npm test/i.test(String(command)));
    report.agent = {
      ok: agent?.report?.completed === true
        && /Estado: completado/.test(readme)
        && mutation
        && verification
        && independent.status === 0,
      durationMs: Date.now() - agentStarted,
      usage: sanitizedUsage(agent?.usage),
      tools,
      changedFiles: agent?.report?.changedFiles || [],
      verificationCommands: agent?.report?.verificationCommands || [],
      independentVerification: independent.status === 0,
      stopReason: String(agent?.report?.stopReason || ""),
      runtimeCompleted: agent?.report?.completed === true,
      modelDecisionAudit: agent?.report?.modelDecisionAudit || [],
      independentError: independent.status === 0 ? "" : String(independent.stderr || independent.error?.message || "").slice(0, 500),
    };
    report.ok = report.chat.ok && report.agent.ok;
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 1200);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    try { fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    app.exit(report.ok ? 0 : 2);
  }
});
