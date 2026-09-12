"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.EDITCORE_AGENT_ACCEPTANCE = "1";
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";
const normalUserData = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
process.env.EDITCORE_USER_DATA_PATH = normalUserData;
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-real-readonly-"));
const reportPath = process.env.EDITCORE_READONLY_REPORT || path.join(os.tmpdir(), "editcore-real-readonly-acceptance.json");
const requestedModels = String(process.env.EDITCORE_READONLY_MODELS || "apicredits/gpt-5.5,meai/claude-sonnet-4.6").split(",").map((item) => item.trim()).filter(Boolean);
const prompt = "analiza el proyecto grupo emergente para encontrar errores y al finalizar dame un reporte completo";

for (let index = 1; index <= 10; index += 1) {
  fs.writeFileSync(path.join(projectRoot, `analysis-${index}.js`), `export const value${index} = ${index};\n`, "utf8");
}

function digestProject() {
  const hash = crypto.createHash("sha256");
  for (const name of Array.from({ length: 10 }, (_, index) => `analysis-${index + 1}.js`)) {
    hash.update(name);
    hash.update(fs.readFileSync(path.join(projectRoot, name)));
  }
  return hash.digest("hex");
}

require("../main");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window && await window.webContents.executeJavaScript('document.body?.dataset?.editcoreReady === "1"').catch(() => false)) return window;
    await wait(100);
  }
  throw new Error("EDITCOREAI no termino de iniciar para la aceptacion readonly.");
}

app.whenReady().then(async () => {
  const beforeHash = digestProject();
  const report = { generatedAt: new Date().toISOString(), projectRoot, prompt, beforeHash, models: [], ok: false };
  try {
    const window = await mainWindow();
    report.models = await window.webContents.executeJavaScript(`(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const providers = secure["editcore-providers"] || {};
      const profiles = (secure["editcore-provider-profiles"] || [])
        .filter((item) => item && ["active", "enabled"].includes(item.status) && item.apiKey && item.model)
        .filter((item) => ${JSON.stringify(requestedModels)}.includes(item.model));
      const results = [];
      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const provider = providers[profile.providerKey] || {};
        const runId = "real-readonly-" + index + "-" + Date.now();
        const progress = [];
        window.editcoreAgent.onProgress((item) => { if (item?.runId === runId) progress.push({ phase: item.phase || "tool", name: item.name || "", ok: item.ok !== false }); });
        try {
          const result = await window.editcoreAgent.run({
            providerKey: profile.providerKey,
            baseUrl: profile.baseUrl || provider.baseUrl,
            apiKey: profile.apiKey,
            model: profile.model,
            prompt: ${JSON.stringify(prompt)},
            projectRoot: ${JSON.stringify(projectRoot)},
            projectId: "real-readonly-acceptance",
            agentId: "real-readonly-agent-" + index,
            permissionMode: "readonly",
            allowWrite: false,
            analysisMode: true,
            planAuthorized: false,
            requireEvidence: true,
            runId,
          });
          results.push({
            providerKey: profile.providerKey,
            model: profile.model,
            completed: result.report?.completed === true,
            tools: (result.steps || []).map((step) => step.name),
            changedFiles: result.report?.changedFiles || [],
            progress,
            text: String(result.text || "").slice(0, 1000),
          });
        } catch (error) {
          results.push({ providerKey: profile.providerKey, model: profile.model, completed: false, error: String(error?.message || error).slice(0, 1000), progress });
        }
      }
      return results;
    })()`);
    report.afterHash = digestProject();
    report.ok = report.models.length === requestedModels.length
      && report.beforeHash === report.afterHash
      && report.models.every((item) => item.completed && item.changedFiles.length === 0 && item.tools.filter((name) => name === "read_file").length >= 10 && item.progress.some((row) => row.name === "read_file"));
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 2000);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    try { fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
    app.exit(report.ok ? 0 : 2);
  }
});
