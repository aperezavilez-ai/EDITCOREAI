"use strict";

const fs = require("fs");
const path = require("path");

const mainPath = path.join(__dirname, "..", "main.js");
let s = fs.readFileSync(mainPath, "utf8");
const report = [];

function mustReplace(label, from, to) {
  if (!s.includes(from)) {
    throw new Error(`FAIL ${label}: pattern not found`);
  }
  s = s.replace(from, to);
  report.push(`OK ${label}`);
}

function replaceOnce(label, from, to) {
  if (!s.includes(from)) {
    report.push(`SKIP ${label}`);
    return false;
  }
  s = s.replace(from, to);
  report.push(`OK ${label}`);
  return true;
}

if (!s.includes("handleChatKernel")) {
  mustReplace(
    "requires",
    `const { localConversationResponse, isCasualPrompt } = require("./runtime/chat-local");
const { enrichAgentInventory, formatJarvisContextForPrompt } = require("./runtime/jarvis-port");`,
    `const { localConversationResponse, isCasualPrompt } = require("./runtime/chat-local");
const {
  handleChatKernel,
  stopChatKernel,
  classifyChatKernel,
  buildKernelHelpers,
} = require("./runtime/chat-kernel-bridge");
const { attachPreviewLogStream } = require("./runtime/dev-server-daemon");
const { enrichAgentInventory, formatJarvisContextForPrompt } = require("./runtime/jarvis-port");`,
  );
} else {
  report.push("SKIP requires (already present)");
}

replaceOnce(
  "preview maps",
  `const previewProcesses = new Map();
const previewStartPromises = new Map();`,
  `const previewProcesses = new Map();
const previewStartPromises = new Map();
const previewLogStates = new Map();
const previewAutoHealInFlight = new Map();`,
);

// Helper function insertion before startProjectPreview
const helperFn = `
function emitPreviewDaemonEvent(projectRoot, payload) {
  const message = {
    projectRoot,
    ...(payload && typeof payload === "object" ? payload : {}),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send("project:preview-log", message);
      }
    } catch { /* ignore */ }
  }
  if (payload?.type === "preview-issue" && payload.autoHeal && payload.issue) {
    maybeAutoHealPreview(projectRoot, payload.issue).catch(() => {});
  }
}

async function maybeAutoHealPreview(projectRoot, issue) {
  const key = String(projectRoot || "");
  if (!key || previewAutoHealInFlight.get(key)) return;
  previewAutoHealInFlight.set(key, true);
  try {
    const secure = typeof readSecureState === "function" ? readSecureState() : {};
    const apiKey = String(secure?.apiKey || secure?.meaiApiKey || secure?.apicreditsApiKey || "").trim();
    const model = String(secure?.model || secure?.selectedModel || "").trim();
    const baseUrl = typeof normalizeBaseUrl === "function"
      ? normalizeBaseUrl(secure?.baseUrl || secure?.apiBaseUrl || "", secure?.providerKey || secure?.provider || "")
      : String(secure?.baseUrl || "").trim();
    if (!apiKey || !model) {
      emitPreviewDaemonEvent(projectRoot, {
        type: "preview-heal-skipped",
        reason: "missing-api",
        issue,
      });
      return;
    }
    emitPreviewDaemonEvent(projectRoot, { type: "preview-heal-start", issue });
    const helpers = buildKernelHelpers({
      BrowserWindow,
      capturePreview,
      previewUrl: previewProcesses.get(projectRoot)?.url || "",
      appUserData: app.getPath("userData"),
    });
    const out = await handleChatKernel({
      message: \`Auto-heal preview: \${issue.summary}\`,
      projectRoot,
      apiBaseUrl: baseUrl,
      apiKey,
      model,
      helpers,
      autoHeal: issue,
      onProgress: (p) => {
        emitPreviewDaemonEvent(projectRoot, {
          type: "preview-heal-progress",
          ...(p && typeof p === "object" ? p : { text: String(p || "") }),
        });
      },
    });
    emitPreviewDaemonEvent(projectRoot, {
      type: "preview-heal-done",
      text: String(out?.text || "").slice(0, 1200),
      kind: out?.kind,
    });
    // Recargar preview tras heal
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        const url = previewProcesses.get(projectRoot)?.url;
        if (url && !win.isDestroyed()) {
          win.webContents.send("project:preview-updated", { projectRoot, url, reason: "auto-heal" });
        }
      } catch { /* ignore */ }
    }
  } finally {
    previewAutoHealInFlight.delete(key);
  }
}

`;

if (!s.includes("function maybeAutoHealPreview")) {
  mustReplace(
    "insert heal helpers",
    "async function startProjectPreview(rootPath, ownerId) {",
    `${helperFn}async function startProjectPreview(rootPath, ownerId) {`,
  );
} else {
  report.push("SKIP heal helpers");
}

// Attach log stream after spawn
replaceOnce(
  "attach log after spawn",
  `  const runtime = { child, script: direct?.label || manager + " run " + script, url: "", runtimeRoot, fingerprint: previewRuntimeFingerprint(safeRoot, runtimeRoot), dependencyReport, owners: new Set([ownerId]) };
  previewProcesses.set(safeRoot, runtime);
  child.once("exit", () => { if (previewProcesses.get(safeRoot)?.child === child) previewProcesses.delete(safeRoot); });
  child.once("error", () => { if (previewProcesses.get(safeRoot)?.child === child) previewProcesses.delete(safeRoot); });
  const outputRef = { value: "" };`,
  `  const runtime = { child, script: direct?.label || manager + " run " + script, url: "", runtimeRoot, fingerprint: previewRuntimeFingerprint(safeRoot, runtimeRoot), dependencyReport, owners: new Set([ownerId]) };
  previewProcesses.set(safeRoot, runtime);
  runtime.logDetach = attachPreviewLogStream({
    child,
    projectRoot: safeRoot,
    stateByRoot: previewLogStates,
    emit: (payload) => emitPreviewDaemonEvent(safeRoot, payload),
  }).detach;
  child.once("exit", () => {
    try { runtime.logDetach?.(); } catch { /* ignore */ }
    if (previewProcesses.get(safeRoot)?.child === child) previewProcesses.delete(safeRoot);
  });
  child.once("error", () => {
    try { runtime.logDetach?.(); } catch { /* ignore */ }
    if (previewProcesses.get(safeRoot)?.child === child) previewProcesses.delete(safeRoot);
  });
  const outputRef = { value: "" };`,
);

// Replace editcore:chat handler body start — inject kernel path at beginning
const chatHandlerMarker = 'ipcMain.handle("editcore:chat", async (_event, input = {}) => {';
const chatKernelBody = `ipcMain.handle("editcore:chat", async (_event, input = {}) => {
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const prompt = String(input.prompt || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey || input.provider || input.mode);
  const rootPath = String(input.projectRoot || "").trim();

  if (!prompt) throw new Error("Escribe un mensaje.");

  const decision = classifyChatKernel(prompt);
  if (decision.kind === "STOP") {
    const stopped = stopChatKernel();
    return {
      text: stopped.text || "Detenido.",
      cached: true,
      local: true,
      kernel: true,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        confirmed_input_tokens: 0,
        confirmed_output_tokens: 0,
        local_response: true,
      },
    };
  }

  const localText = typeof localConversationResponse === "function"
    ? localConversationResponse(prompt)
    : "";
  if (localText && decision.kind === "CHAT") {
    return {
      text: localText,
      cached: true,
      local: true,
      kernel: true,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        confirmed_input_tokens: 0,
        confirmed_output_tokens: 0,
        estimated_input_tokens: estimateTokens(prompt),
        estimated_output_tokens: estimateTokens(localText),
        local_response: true,
        telemetry: "estimated",
        estimated: true,
      },
    };
  }

  const sender = _event.sender;
  try {
    const helpers = buildKernelHelpers({
      BrowserWindow,
      capturePreview,
      previewUrl: previewProcesses.get(rootPath)?.url || "",
      appUserData: app.getPath("userData"),
    });
    const out = await handleChatKernel({
      message: prompt,
      projectRoot: rootPath,
      apiBaseUrl: baseUrl,
      apiKey,
      model,
      helpers,
      onProgress: (p) => {
        try {
          if (!sender.isDestroyed()) {
            sender.send("agent:progress", {
              runId: String(input.runId || ""),
              projectId: String(input.projectId || ""),
              ...(p && typeof p === "object" ? p : { text: String(p || "") }),
            });
          }
        } catch { /* ignore */ }
      },
    });
    const text = String(out?.text || "").trim() || "Sin respuesta.";
    return {
      text,
      kernel: true,
      kind: out?.kind || decision.kind,
      steps: Array.isArray(out?.steps) ? out.steps : [],
      usage: out?.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        confirmed_input_tokens: 0,
        confirmed_output_tokens: estimateTokens(text),
      },
    };
  } catch (error) {
    throw new Error(toUserFacingError(error));
  }
});

/* LEGACY editcore:chat retained below for reference — disabled by early return handler above.
ipcMain.handle("editcore:chat__LEGACY_DISABLED", async (_event, input = {}) => {`;

if (s.includes('ipcMain.handle("editcore:chat__LEGACY_DISABLED"')) {
  report.push("SKIP chat handler (already kernel)");
} else if (s.includes(chatHandlerMarker)) {
  s = s.replace(chatHandlerMarker, chatKernelBody);
  report.push("OK chat handler → kernel (+ legacy renamed)");
} else {
  throw new Error("editcore:chat handler not found");
}

// agent:run early kernel path
const agentMarker = `ipcMain.handle("agent:run", async (event, input = {}) => {
  // Validaciones b├ísicas
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  const task = String(input.prompt || "").trim();

  if (!apiKey) throw new Error("Falta API key.");
  if (!model) throw new Error("Falta modelo.");
  if (!task) throw new Error("Falta tarea.");`;

const agentKernel = `ipcMain.handle("agent:run", async (event, input = {}) => {
  // Validaciones básicas
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  const task = String(input.prompt || "").trim();

  if (!task) throw new Error("Falta tarea.");

  const kernelDecision = classifyChatKernel(task);
  if (kernelDecision.kind === "STOP") {
    const stopped = stopChatKernel();
    try { cancelRunsForSender(event.sender.id, "Detenido."); } catch { /* ignore */ }
    return {
      text: stopped.text || "Detenido.",
      steps: [],
      usage: { confirmed_input_tokens: 0, confirmed_output_tokens: 0, local_response: true },
      report: { completed: true, toolCount: 0, changedFiles: [], stopReason: "Detenido.", kernel: true },
      kernel: true,
    };
  }

  if (!apiKey) throw new Error("Falta API key.");
  if (!model) throw new Error("Falta modelo.");

  // Preferir núcleo multi-agente salvo bypass explícito al adapter legado.
  if (input.useLegacyAdapter !== true) {
    const privacy = readPrivacyMode(readSecureState());
    const cloudGate = assertCloudAllowed(privacy, String(input.providerKey || input.provider || ""));
    if (!cloudGate.ok && !/local|ollama|lm/i.test(String(baseUrl || ""))) {
      throw new Error(cloudGate.message);
    }
    const requestedRootRaw = String(input.projectRoot || "").trim();
    const promptPaths = extractAuthorizedPaths(task)
      .map((item) => resolveAuthorizedRoot(item))
      .filter(Boolean);
    const permissionHint = String(input.permissionMode || permissionBySender.get(event?.sender?.id) || permissionMode || "");
    const requestedRoot = requestedRootRaw || promptPaths[0] || "";
    if (!requestedRoot) {
      throw new Error("Indica una ruta absoluta (ej. D:\\\\PROGRAMAS IA) con Acceso completo, o abre/crea un proyecto.");
    }
    if (!requestedRootRaw && permissionHint !== "full") {
      throw new Error("Para usar una ruta sin proyecto abierto, activa Acceso completo e indica la ruta absoluta.");
    }
    const rootPath = assertProjectRoot(requestedRoot);
    const runId = String(input.runId || crypto.randomUUID());
    try {
      const helpers = buildKernelHelpers({
        BrowserWindow,
        capturePreview,
        previewUrl: previewProcesses.get(rootPath)?.url || "",
        appUserData: app.getPath("userData"),
      });
      const out = await handleChatKernel({
        message: task,
        projectRoot: rootPath,
        apiBaseUrl: baseUrl,
        apiKey,
        model,
        helpers,
        onProgress: (p) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send("agent:progress", {
                runId,
                projectId: String(input.projectId || ""),
                ...(p && typeof p === "object" ? p : { text: String(p || "") }),
              });
            }
          } catch { /* ignore */ }
        },
      });
      const text = String(out?.text || "").trim() || "Sin respuesta.";
      const steps = Array.isArray(out?.steps) ? out.steps : [];
      const changedFiles = [...new Set(steps
        .filter((st) => ["write_file", "replace_in_file", "delete_file"].includes(String(st?.name || "")) && st?.ok !== false)
        .map((st) => String(st?.input?.path || st?.path || "").trim())
        .filter(Boolean))];
      const report = {
        completed: true,
        toolCount: steps.length,
        changedFiles,
        stopReason: out?.kind === "STOP" ? "Detenido." : \`editcore-chat-kernel:\${out?.kind || kernelDecision.kind}\`,
        kernel: true,
        outcome: out?.kind === "ANALYZE" ? "awaiting_authorization" : "completed",
        awaitingAuthorization: out?.kind === "ANALYZE",
      };
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send("agent:complete", {
            runId,
            projectId: String(input.projectId || ""),
            completed: true,
            text,
            steps: typeof slimAgentStepsForIpc === "function" ? slimAgentStepsForIpc(steps) : steps,
            usage: out?.usage || {},
            report,
          });
        }
      } catch { /* ignore */ }
      // Montar preview si el proyecto es ejecutable
      try {
        const preview = await startProjectPreview(rootPath, event.sender.id);
        if (preview?.available && preview?.url && !event.sender.isDestroyed()) {
          event.sender.send("project:preview-updated", { projectRoot: rootPath, url: preview.url });
        }
      } catch { /* ignore */ }
      return {
        text,
        steps: typeof slimAgentStepsForIpc === "function" ? slimAgentStepsForIpc(steps) : steps,
        usage: out?.usage || {},
        report,
        kernel: true,
        kind: out?.kind || kernelDecision.kind,
      };
    } catch (error) {
      throw new Error(typeof toUserFacingError === "function" ? toUserFacingError(error) : String(error?.message || error));
    }
  }

  // LEGACY adapter path (solo si useLegacyAdapter=true)
  if (!apiKey) throw new Error("Falta API key.");
  if (!model) throw new Error("Falta modelo.");
  if (!task) throw new Error("Falta tarea.");`;

if (s.includes("Preferir núcleo multi-agente")) {
  report.push("SKIP agent:run kernel (already)");
} else if (s.includes(agentMarker)) {
  s = s.replace(agentMarker, agentKernel);
  report.push("OK agent:run → kernel early path");
} else {
  const alt = s.match(/ipcMain\.handle\("agent:run", async \(event, input = \{\}\) => \{\r?\n  \/\/ Validaciones[^\n]*\r?\n  const apiKey[\s\S]*?if \(!task\) throw new Error\("Falta tarea\."\);/);
  if (!alt) throw new Error("agent:run marker not found");
  s = s.replace(alt[0], agentKernel);
  report.push("OK agent:run → kernel (alt match)");
}

// cancel handlers
replaceOnce(
  "editcore:cancel",
  `ipcMain.handle("editcore:cancel", (event) => {
  const controller = activeChatRuns.get(event.sender.id);
  if (!controller) return false;
  controller.abort(new Error("Respuesta cancelada por el usuario."));
  activeChatRuns.delete(event.sender.id);
  return true;
});`,
  `ipcMain.handle("editcore:cancel", (event) => {
  try { stopChatKernel(); } catch { /* ignore */ }
  const controller = activeChatRuns.get(event.sender.id);
  if (!controller) return true;
  controller.abort(new Error("Respuesta cancelada por el usuario."));
  activeChatRuns.delete(event.sender.id);
  return true;
});`,
);

if (!s.includes("try { stopChatKernel(); } catch { /* ignore */ }\n  const runId = String(input.runId")) {
  replaceOnce(
    "agent:cancel prefix",
    `ipcMain.handle("agent:cancel", (event, input = {}) => {
  const runId = String(input.runId || "").trim();
  const reason = "Agente cancelado por el usuario.";`,
    `ipcMain.handle("agent:cancel", (event, input = {}) => {
  try { stopChatKernel(); } catch { /* ignore */ }
  const runId = String(input.runId || "").trim();
  const reason = "Detenido.";`,
  );
}

fs.writeFileSync(mainPath, s);
console.log(JSON.stringify({ report, bytes: s.length }, null, 2));
