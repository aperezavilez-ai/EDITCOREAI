"use strict";

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.EDITCORE_AGENT_ACCEPTANCE = "1";
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-agent-write-"));
const acceptanceUserData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-agent-profile-"));
const normalUserData = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
const useNormalUserData = process.env.EDITCORE_AGENT_USE_USER_DATA === "1";
const secureConfig = path.join(normalUserData, "editcore-secure-config.bin");
if (!useNormalUserData && fs.existsSync(secureConfig)) fs.copyFileSync(secureConfig, path.join(acceptanceUserData, "editcore-secure-config.bin"));
process.env.EDITCORE_USER_DATA_PATH = useNormalUserData ? normalUserData : acceptanceUserData;
const requestedModels = String(process.env.EDITCORE_AGENT_MODELS || "").split(",").map((item) => item.trim()).filter(Boolean);
const requestedProvider = String(process.env.EDITCORE_AGENT_PROVIDER || "").trim();
const reportPath = process.env.EDITCORE_AGENT_REPORT || path.join(process.cwd(), "agent-chat-acceptance.json");
fs.writeFileSync(path.join(projectRoot, "README.md"), "Proyecto desechable para comprobar escritura real de agentes.\n", "utf8");

require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(`document.readyState === "complete" && Boolean(document.getElementById("sendBtn"))`);
        if (ready) return window;
      } catch {}
    }
    await wait(100);
  }
  throw new Error("El chat de EDITCOREAI no termino de cargar.");
}

function safeSlug(value) {
  return String(value || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "model";
}

function verifyWrittenFile(fileName, expectedModel) {
  const target = path.join(projectRoot, fileName);
  if (!fs.existsSync(target)) return { exists: false, syntaxOK: false, contentOK: false };
  const content = fs.readFileSync(target, "utf8");
  let syntaxOK = false;
  try {
    execFileSync(process.execPath, ["--check", target], { windowsHide: true, stdio: "pipe", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    syntaxOK = true;
  } catch {}
  return { exists: true, syntaxOK, contentOK: content.includes("EDITCORE_AGENT_OK") && content.includes(expectedModel), bytes: Buffer.byteLength(content) };
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), projectRoot, queue: {}, models: [] };
  try {
    const window = await mainWindow();
    await wait(1500);
    report.secureSnapshot = await window.webContents.executeJavaScript(`(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
      return {
        keys: Object.keys(secure).sort(),
        profiles: profiles.map((item) => ({
          providerKey: String(item?.providerKey || ""),
          model: String(item?.model || ""),
          status: String(item?.status || ""),
          hasApiKey: Boolean(String(item?.apiKey || "").trim()),
          hasBaseUrl: Boolean(String(item?.baseUrl || "").trim()),
        })),
      };
    })()`);
    report.queue = await window.webContents.executeJavaScript(`(async () => {
      const root = ${JSON.stringify(projectRoot)};
      activePromptRequests.clear();
      promptQueue = [];
      for (let index = 0; index < 3; index += 1) {
        activePromptRequests.set("acceptance-active-" + index, {
          id: "acceptance-active-" + index,
          prompt: "Tarea activa " + (index + 1),
          isAgent: true,
          agentExecuting: true,
          projectRoot: root,
          runId: "acceptance-run-" + index
        });
      }
      state.projectRoot = root;
      const project = activeProject() || ensureProject();
      project.projectRoot = root;
      state.activeProjectId = project.id;
      project.agentWorkflow = {
        taskId: "acceptance-pending-task",
        phase: "awaiting_authorization",
        task: "analiza el proyecto grupo emergente y dime que mejoras podemos implementar",
        plan: "Aplicar las mejoras detectadas y verificar el resultado.",
        updatedAt: Date.now()
      };
      document.getElementById("runMode").value = "agent";
      const draft = "Segunda instruccion verificable";
      document.getElementById("prompt").value = draft;
      updateSendButtonState();
      const sendWhileRunning = document.getElementById("sendBtn").title === "Enviar otra tarea";
      const profileReady = Boolean(document.getElementById("chatModelSelect")?.selectedOptions?.[0]?.dataset?.model);
      const queuedJob = profileReady ? buildPromptJob(draft) : null;
      const continuationJob = profileReady ? buildPromptJob("procede con los cambios") : null;
      promptQueue.push({ ...(queuedJob || {}), id: "acceptance-queued", prompt: draft, isAgent: true, continueAuthorized: true, projectRoot: root, images: [] });
      document.getElementById("prompt").value = "";
      renderPromptQueue();
      const host = document.getElementById("promptQueue");
      const result = {
        sendWhileRunning,
        profileReady,
        queued: promptQueue.some((item) => item.prompt === draft),
        visible: !host.classList.contains("hidden"),
        directButton: [...host.querySelectorAll("button")].some((item) => item.textContent === "Dirigir"),
        queuedText: host.textContent.includes(draft),
        exactAuthorizationRecognized: isAgentAuthorization("procede con los cambios"),
        pendingTaskRecovered: Boolean(continuationJob?.isAgent && continuationJob?.resumeAuthorized && !continuationJob?.directReadOnly)
      };
      activePromptRequests.clear();
      promptQueue = [];
      renderPromptQueue();
      updateSendButtonState();
      return result;
    })()`);

    const modelResults = await window.webContents.executeJavaScript(`(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const providers = secure["editcore-providers"] || {};
      const profiles = (secure["editcore-provider-profiles"] || [])
        .filter((item) => item && ["active", "enabled"].includes(item.status) && item.model && item.apiKey)
        .filter((item, index, values) => values.findIndex((candidate) => candidate.providerKey === item.providerKey && candidate.model === item.model) === index)
        .filter((item) => !${JSON.stringify(requestedProvider)} || item.providerKey === ${JSON.stringify(requestedProvider)})
        .filter((item) => !${JSON.stringify(requestedModels)}.length || ${JSON.stringify(requestedModels)}.includes(item.model));
      const root = ${JSON.stringify(projectRoot)};
      const sanitize = (value) => String(value || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "model";
      const execute = async (profile, index) => {
        const provider = providers[profile.providerKey] || {};
        const fileName = "proof-" + index + "-" + sanitize(profile.model) + ".js";
        const runId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + index;
        const task = "Crea exactamente " + fileName + " con JavaScript valido que contenga las cadenas EDITCORE_AGENT_OK y " + profile.model + ". Ejecuta node --check " + fileName + ". No uses plantillas y no modifiques otros archivos.";
        try {
          const result = await window.editcoreAgent.run({
            providerKey: profile.providerKey,
            baseUrl: profile.baseUrl || provider.baseUrl,
            apiKey: profile.apiKey,
            model: profile.model,
            prompt: task,
            projectRoot: root,
            projectId: "acceptance-project",
            agentId: "acceptance-agent-" + index,
            allowWrite: true,
            permissionMode: "full",
            planAuthorized: true,
            runId
          });
          return {
            providerKey: profile.providerKey,
            model: profile.model,
            fileName,
            completed: Boolean(result.report?.completed),
            changedFiles: result.report?.changedFiles || [],
            verificationCommands: result.report?.verificationCommands || [],
            toolCount: Number(result.report?.toolCount || 0),
            stopReason: result.report?.stopReason || "",
            providerCalls: Number(result.usage?.provider_calls || 0),
            confirmedInputTokens: Number(result.usage?.confirmed_input_tokens || 0),
            confirmedOutputTokens: Number(result.usage?.confirmed_output_tokens || 0),
            providerCacheReadTokens: Number(result.usage?.provider_cache_read_tokens || 0)
          };
        } catch (error) {
          return { providerKey: profile.providerKey, model: profile.model, fileName, completed: false, error: String(error?.message || error).slice(0, 500) };
        }
      };
      const results = [];
      for (let offset = 0; offset < profiles.length; offset += 3) {
        results.push(...await Promise.all(profiles.slice(offset, offset + 3).map((profile, batchIndex) => execute(profile, offset + batchIndex))));
      }
      return results;
    })()`);

    report.models = modelResults.map((result) => {
      const file = verifyWrittenFile(result.fileName, result.model);
      return { ...result, file, ok: Boolean(result.completed && file.exists && file.syntaxOK && file.contentOK) };
    });
    report.queue.ok = ["sendWhileRunning", "queued", "visible", "directButton", "queuedText", "exactAuthorizationRecognized", "pendingTaskRecovered"].every((key) => report.queue[key] === true);
    report.summary = {
      queueOK: report.queue.ok,
      configuredModels: report.models.length,
      passedModels: report.models.filter((item) => item.ok).length,
      failedModels: report.models.filter((item) => !item.ok).length,
    };
    report.ok = report.summary.queueOK && report.summary.configuredModels > 0 && report.summary.failedModels === 0;
  } catch (error) {
    report.ok = false;
    report.fatal = String(error?.stack || error);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    try { fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
    if (!useNormalUserData) {
      try { fs.rmSync(acceptanceUserData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
    }
    app.exit(report.ok ? 0 : 2);
  }
});
