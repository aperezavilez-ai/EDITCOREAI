const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage, session, clipboard, nativeImage, nativeTheme } = require("electron");
// No forzar --disable-gpu: genera ruido ContextResult::kFatalFailure y degrada estabilidad.
try {
  app.setName("EditCoreAI");
  if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
    app.setAppUserModelId("com.editcoreai.app");
  }
} catch {
  // ignore
}
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,HighPriorityBeforeUnload");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { pathToFileURL } = require("node:url");
const { execFile, spawn, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");
const { EditCoreBrainService } = require("./brain-service");
const { InspectorCoreService } = require("./inspector-core-service");
const { autoHealNextProject, localVisionProbe } = require("./runtime/inspector-local-heal");
const { containsAgentProtocol, parseAgentPayload, selectAgentResponse } = require("./agent-parser");
const {
  GENERATED_PROJECT_DIRS,
  classifyModelCapability,
  compactChatHistory,
  isRetryableProviderStatus,
  truncateText,
} = require("./agent-runtime");
const { TERMINAL_TASK_STATES } = require("./runtime/task-models");
const {
  parseSafeCommand,
  parseAnalysisCommand,
  parseFullAccessCommand,
  parseLegacyReadCommand,
  resolveShellReadPath,
  isShellReadCommand,
  isShellExploreCommand,
  extractShellExplorePathHint,
  classifyCommandRisk,
  isProjectDevServerCommand,
  commandTimeoutMs,
  shouldRunWithShell,
  isWindowsPackageManager,
  isAnalysisHeavyVerificationCommand,
  shouldBlockHeavyVerification,
  isAcotadoDiagnosticCommand,
} = require("./command-policy");
const {
  evaluateAgentCommandPolicy,
  shouldRequireCommandConfirmation,
} = require("./runtime/rules-engine");
const {
  createMutationCheckpoint,
  rollbackMutationCheckpoint,
  persistMutationCheckpoint,
} = require("./runtime/mutation-checkpoint");
const {
  assertProjectRoot,
  assertWritableProjectRoot,
  resolveInside: resolveProjectPath,
  toProjectRelativePath,
  workspaceParentRoot,
  collectAllowedRoots,
  collectFullAccessRoots,
  collectSiblingReadRoots,
  resolveAccessibleTarget,
  pathForToolResult,
  extractAuthorizedPaths,
  resolveAuthorizedRoot,
} = require("./project-path-policy");
const { createDiscoveryLedger, extractAnalysisTargets } = require("./runtime/evidence-grounding");
const { projectBackupRoot } = require("./project-storage");
const { buildProjectTemplate } = require("./project-template");
const { ProjectScaffoldService } = require("./project-scaffold-service");
const { ResponseCache } = require("./response-cache");
const { ToolCache } = require("./tool-cache");
const { READ_METHODS, connectionSummary, digest, executeServiceRequest } = require("./service-harness");
const { aggregateUsage, localCacheUsage, normalizeProviderUsage } = require("./usage-metrics");
const { builtNextPreviewLaunch, directPreviewLaunch, findRunnableProjectRoot, isPreviewDocumentContentType, normalizePreviewUrl, previewRuntimeFingerprint, readProjectPreviewEnv, stablePreviewPort, staticPreviewLaunch } = require("./preview-runtime");
const { ensureProjectDependencies } = require("./project-dependencies");
const { capturePreview } = require("./visual-preview-inspector");
const { documentContext, normalizeDocuments } = require("./document-attachments");
const { redactSensitive } = require("./security-utils");
const { AiCore } = require("./runtime/ai-core");
const {
  withEliteCommunicationPolicy,
  stripEliteFiller,
  defaultChatSystemPrompt,
} = require("./runtime/elite-communication-policy");
const {
  resolveFactualTemperature,
} = require("./runtime/anti-hallucination-policy");
const { ToolDispatcher } = require("./runtime/tool-dispatcher");
const {
  normalizeImages: normalizeVisionImages,
  buildOpenAiImageContent,
  modelSupportsVision,
  ensureVisionRoute,
  VISION_ACK_RULE,
  VISION_MODEL_PATTERN: VISION_INTAKE_PATTERN,
} = require("./runtime/vision-intake");
const { createExternalKnowledgeHook, wrapDispatcherWithKnowledgePersist } = require("./runtime/external-knowledge-persist");
const { BRAIN_TOOL_DEFINITIONS, registerBrainTools } = require("./runtime/brain-tools");
const { registerAgentCapabilityTools } = require("./runtime/register-agent-capability-tools");
const { queuePostWriteDiagnostics } = require("./runtime/post-write-diagnostics");
const { ReversibleContextStore, loadProjectContext } = require("./runtime/context-store");
const { rememberProjectEvent, loadProjectMemory, formatMemoryForPrompt } = require("./runtime/project-memory");
const {
  saveLastAgentRun,
  peekLastAgentRun,
  restoreLastAgentRun,
  buildLastRunReview,
  reviewFileDecision,
  reviewHunkDecision,
  acceptAllPending,
} = require("./runtime/agent-run-checkpoint");
const { ensureProjectRoadmap, syncProjectRoadmap, buildRoadmapSyncFromRun, formatRoadmapForPrompt, readRoadmap } = require("./runtime/project-roadmap");
const { MAX_WINDOWS, WINDOW_SLOTS, allocateWindowSlot, canOpenWindow } = require("./runtime/window-slots");
const { deployOneClick } = require("./runtime/deploy-one-click");
const { publishProject, findGitRoot } = require("./runtime/publish-pipeline");
const { assessProjectConnections, connectProject } = require("./runtime/project-connect");
const {
  buildSafeConnectionsSnapshot,
  formatOperatorConnectionsMemory,
  persistOperatorConnectionsMemory,
  readProjectLinkManifest,
  connectionsForProject,
  resolveProjectSupabase,
} = require("./runtime/operator-connections-context");
const { provisionProject } = require("./runtime/project-provision");
const { CURSOR_PARITY_LIMITS } = require("./runtime/cursor-parity");
const { checkProjectHealth, checkAllProjects } = require("./runtime/project-maintainer");
const { readAuditEvents } = require("./runtime/project-audit");
const { syncEnvToVercel } = require("./runtime/vercel-env-sync");
const { manageSupabaseProject } = require("./runtime/supabase-manager");
const { sshDeploy } = require("./runtime/ssh-deploy");
const {
  createMaintenanceScheduler,
  getSchedulerConfig,
  setSchedulerConfig,
  syncProjectRegistry,
  runMaintenanceCheck,
} = require("./runtime/maintenance-scheduler");
const { createSupabaseProject } = require("./runtime/supabase-provision");
const { checkForUpdates } = require("./runtime/update-check");
const { Phase1Audit } = require("./runtime/phase1-audit");
const { ContextEngine, evidenceLedger } = require("./runtime/context-engine");
const { TokenLedger } = require("./runtime/token-ledger");
const { TaskStore, digest: taskDigest } = require("./runtime/task-store");
const { TaskManager } = require("./runtime/task-manager");
const { TaskRecovery } = require("./runtime/task-recovery");
const { registerTaskIpc } = require("./runtime/task-ipc");
const { WorkflowOrchestrator } = require("./runtime/workflow-orchestrator");
const { ModelFailoverCoordinator, mergeCandidateProfiles, recordIntraTurnFallback, isRecoverableModelError } = require("./runtime/model-failover");
const { WorkerSupervisor } = require("./runtime/worker-supervisor");
const { EditCoreClaudeAdapter } = require("./runtime/editcore-claude-adapter");
const { ActionRegistry } = require("./runtime/action-registry");
const { resolveUnifiedAgentPlan, resolveAgentRunProfile, applyRunProfile } = require("./runtime/intent-orchestrator");
const { filesChangedPayload, clipMutationProgressForUi } = require("./runtime/project-files-ui");
const { localConversationResponse, isCasualPrompt } = require("./runtime/chat-local");
const {
  handleChatKernel,
  stopChatKernel,
  steerChatKernel,
  isChatKernelRunning,
  classifyChatKernel,
  buildKernelHelpers,
} = require("./runtime/chat-kernel-bridge");
const {
  attachTransparencyToProgress,
  createAgentTransparencyEmitter,
} = require("./runtime/agent-transparency-bus");
const { attachPreviewLogStream } = require("./runtime/dev-server-daemon");
const { enrichAgentInventory, formatJarvisContextForPrompt } = require("./runtime/jarvis-port");
const { getBotRegistry } = require("./runtime/bot-registry");
const {
  getCachedProjectIndex,
  enrichPromptWithMentions,
  searchProjectIndex,
} = require("./runtime/project-index");
const {
  registerMcpServer,
  removeMcpServer,
  mcpStatusWithTools,
} = require("./runtime/mcp-registry");
const { readPrivacyMode, setPrivacyMode, assertCloudAllowed } = require("./runtime/privacy-mode");
const {
  readTerminalPolicy,
  setYoloMode,
  isCommandAllowed,
} = require("./runtime/terminal-allowlist");

// Contrato C8: sanitizacion de errores de proveedor (EMPTY_PROVIDER_RESPONSE).
// Regla estricta: nunca mostrar hostname ni nombre de modelo en errores expuestos al usuario.
function toUserFacingProviderError(error) {
  if (!error) return error;
  try {
    const { sanitizeChatProviderError } = require("./runtime/chat-error-sanitize");
    const msg = sanitizeChatProviderError(error);
    const err = new Error(msg);
    err.code = error.code || "EMPTY_PROVIDER_RESPONSE";
    // nunca mostrar hostname ni nombre de modelo
    return err;
  } catch {
    const err = new Error("No pude completar la respuesta. Intenta de nuevo.");
    err.code = error.code || "EMPTY_PROVIDER_RESPONSE";
    // nunca mostrar hostname ni nombre de modelo
    return err;
  }
}
const {
  applyPatch,
  rollbackPatch,
  listBackups,
  generateDiff,
  writeFileAtomic,
} = require("./patch-engine");

for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.("error", (error) => {
    if (error?.code !== "EPIPE") throw error;
  });
}

app.commandLine.appendSwitch("disable-http-cache");
const editCoreAppData = app.getPath("appData");
const requestedUserData = String(process.env.EDITCORE_USER_DATA_PATH || "").trim();
const legacyUserDataPaths = [
  // Rutas antiguas / paralelas solo para import one-shot. Runtime = %APPDATA%\EDITCOREAI.
  path.join(editCoreAppData, "EDITCOREAI"),
  path.join(editCoreAppData, "EditCore AI"),
  path.join(editCoreAppData, "editcore-ai"),
];
const legacySecureKeyMap = {};
// Identidad canónica de ESTE proyecto. Nunca mezclar con otras instalaciones.
app.setName("EditCoreAI");
app.setPath("userData", requestedUserData || path.join(editCoreAppData, "EDITCOREAI"));

function addExistingPathEntries(entries) {
  const current = String(process.env.PATH || "");
  const known = new Set(current.split(path.delimiter).filter(Boolean).map(entry => path.resolve(entry).toLowerCase()));
  const additions = [];
  for (const entry of entries) {
    try {
      if (!entry || !fs.existsSync(entry)) continue;
      const resolved = path.resolve(entry);
      if (known.has(resolved.toLowerCase())) continue;
      known.add(resolved.toLowerCase());
      additions.push(resolved);
    } catch {}
  }
  if (additions.length) process.env.PATH = [current, ...additions].filter(Boolean).join(path.delimiter);
}

addExistingPathEntries([
  path.join(os.homedir(), "AppData", "Roaming", "Python", "Python312", "Scripts"),
  path.join(os.homedir(), "AppData", "Roaming", "Python", "Python311", "Scripts"),
  path.join(os.homedir(), "AppData", "Roaming", "Python", "Python310", "Scripts"),
]);

// FIX A: Node.js + npm al PATH. Sin esto, spawn("npm install") falla con ENOENT
// cuando EditCore se lanza desde el acceso directo (PATH sin Node).
addExistingPathEntries([
  "C:\\Program Files\\nodejs",
  "C:\\Program Files (x86)\\nodejs",
  path.join(os.homedir(), "AppData", "Roaming", "npm"),
  path.join(os.homedir(), "AppData", "Local", "Programs", "nodejs"),
  path.join(os.homedir(), "scoop", "apps", "nodejs", "current"),
  path.join(os.homedir(), "scoop", "shims"),
  path.join("C:\\", "ProgramData", "chocolatey", "bin"),
  path.join("C:\\", "nvm4w", "nodejs"),
  path.join(os.homedir(), "AppData", "Roaming", "nvm"),
]);

function logStartup(message, error) {
  try {
    const logPath = path.join(app.getPath("userData"), "startup.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const detail = error ? ` ${error?.stack || error?.message || error}` : "";
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`, "utf8");
  } catch {}
}

function migrateLegacyUserData() {
  const targetRoot = app.getPath("userData");
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const sourceRoot of legacyUserDataPaths) {
    if (!fs.existsSync(sourceRoot) || path.resolve(sourceRoot) === path.resolve(targetRoot)) continue;
    for (const [name, targetName] of [
      ["editcore-secure-config.bin", "editcore-secure-config.bin"],
      ["editcore-ui-session.json", "editcore-ui-session.json"],
      ["response-cache.json", "response-cache.json"],
      ["tool-cache.json", "tool-cache.json"],
      ["editcore-brain", "editcore-brain"],
    ]) {
      const source = path.join(sourceRoot, name);
      const target = path.join(targetRoot, targetName);
      if (!fs.existsSync(source)) continue;
      try {
        if (targetName === "editcore-secure-config.bin" && fs.existsSync(target)) {
          mergeSecureStateFrom(source);
        } else if (!fs.existsSync(target)) {
          fs.cpSync(source, target, { recursive: true });
        }
      } catch (error) {
        logStartup(`No se pudo migrar ${source}`, error);
      }
    }
  }
  try {
    const currentState = readSecureState();
    if (Object.keys(currentState).length) writeSecureState(currentState);
  } catch (error) {
    logStartup("No se pudo normalizar la configuracion segura.", error);
  }
}

const execFileAsync = promisify(execFile);
let brainService = null;
let inspectorService = null;
const activeAgentRuns = new Map();
const activePlanRuns = new Map();
const agentFileLocks = new Map();
const activeChatRuns = new Map();
const PREVIEW_START_TIMEOUT_MS = 240_000;
const activeProjectRuns = new Map();
const activeInspectorRuns = new Map();
const projectScaffoldService = new ProjectScaffoldService();
let mainWindow = null;
let maintenanceScheduler = null;
let permissionMode = "step";
const permissionBySender = new Map();
/** Ultimo projectRoot conocido por webContents.id (fallback si el agente llega sin root). */
const activeWorkspaceBySender = new Map();
let globalActiveWorkspacePath = "";
const pendingAgentApprovals = new Map();
const pendingUiProjectActions = new Map();
const AGENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const UI_PROJECT_ACTION_TIMEOUT_MS = 20_000;

function rememberActiveWorkspace(senderId, rootPath) {
  const root = String(rootPath || "").trim();
  if (!root) return;
  if (senderId != null) activeWorkspaceBySender.set(Number(senderId), root);
  globalActiveWorkspacePath = root;
}

function resolveIncomingWorkspaceRoot(event, input = {}, task = "") {
  const raw = String(input?.projectRoot || "").trim();
  if (raw) {
    rememberActiveWorkspace(event?.sender?.id, raw);
    return raw;
  }
  const senderId = event?.sender?.id;
  if (senderId != null) {
    const fromSender = String(activeWorkspaceBySender.get(Number(senderId)) || "").trim();
    if (fromSender) return fromSender;
  }
  if (globalActiveWorkspacePath) return globalActiveWorkspacePath;
  // Autoconocimiento: auditorias de EDITCOREAI sin root → carpeta de la app.
  if (/\beditcoreai\b/i.test(String(task || ""))) {
    const appRoot = path.resolve(__dirname);
    if (/editcoreai$/i.test(path.basename(appRoot))) return appRoot;
  }
  return "";
}

/** Pide a la ventana del renderer abrir/cerrar proyecto de verdad (panel + archivos). */
function requestProjectUiAction(sender, payload = {}, timeoutMs = UI_PROJECT_ACTION_TIMEOUT_MS) {
  if (!sender || sender.isDestroyed?.()) {
    return Promise.reject(new Error("No hay ventana de EditCore para abrir/cerrar el proyecto."));
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingUiProjectActions.delete(requestId);
      reject(new Error("La UI no respondio a tiempo al abrir/cerrar el proyecto. Cierra y vuelve a abrir EditCore."));
    }, timeoutMs);
    pendingUiProjectActions.set(requestId, { resolve, reject, timeout, senderId: sender.id });
    try {
      sender.send("project:ui-command", { requestId, ...payload });
    } catch (error) {
      clearTimeout(timeout);
      pendingUiProjectActions.delete(requestId);
      reject(error);
    }
  });
}

function resolveOpenProjectTarget(input = {}, { rootPath = "", crossProjectAccess = false } = {}) {
  const rawPath = String(input.path || input.root || "").trim();
  const name = String(input.name || "").trim();
  let target = "";
  if (rawPath) {
    target = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(rootPath || process.cwd(), rawPath);
  } else if (name) {
    const candidates = [];
    if (rootPath) {
      candidates.push(path.join(path.dirname(rootPath), name));
      candidates.push(path.join(rootPath, name));
    }
    const programsIa = path.join("D:", "PROGRAMAS IA");
    if (fs.existsSync(programsIa)) candidates.push(path.join(programsIa, name));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      throw new Error(rootPath
        ? `No se encontro la carpeta "${name}" junto al proyecto abierto ni en PROGRAMAS IA.`
        : "open_project con nombre requiere proyecto abierto, path absoluto, o carpeta en PROGRAMAS IA.");
    }
  } else {
    throw new Error("open_project requiere path absoluto o name de carpeta.");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`No existe la carpeta: ${target}`);
  }
  const normalizedTarget = path.resolve(target);
  const normalizedRoot = rootPath ? path.resolve(rootPath) : "";
  if (!crossProjectAccess && normalizedRoot) {
    const parent = path.dirname(normalizedRoot).toLowerCase();
    const targetParent = path.dirname(normalizedTarget).toLowerCase();
    if (normalizedTarget.toLowerCase() !== normalizedRoot.toLowerCase() && targetParent !== parent) {
      throw new Error("Para abrir otra carpeta fuera del proyecto/hermanos activa Acceso completo.");
    }
  }
  return normalizedTarget;
}
let responseCache = null;
let toolCache = null;
const previewProcesses = new Map();
const previewStartPromises = new Map();
const previewLogStates = new Map();
const previewAutoHealInFlight = new Map();
const AGENT_PLAN_TIMEOUT_MS = 180_000;
const AGENT_MODEL_VERIFY_TIMEOUT_MS = 90_000;
const AGENT_PROVIDER_STEP_TIMEOUT_MS = 180_000;
const windows = new Map();
const inspectorRendererTelemetry = new Map();
const runtimeAiCore = new AiCore();
let phase1Audit = null;
let taskStore = null;
let taskManager = null;
let taskRecovery = null;
let workflowOrchestrator = null;
let workerSupervisor = null;
let workerSupervisorTimer = null;

function auditPhase1() {
  if (process.env.EDITCORE_PHASE1_AUDIT !== "1") return null;
  if (!phase1Audit) phase1Audit = new Phase1Audit(path.join(app.getPath("userData"), "phase1-audit"));
  return phase1Audit;
}

function tasks() {
  if (!taskManager) throw new Error("Task Manager no inicializado.");
  return taskManager;
}

function initializeTaskRuntime() {
  if (taskManager) return taskManager;
  const root = path.join(app.getPath("userData"), "task-store");
  taskStore = new TaskStore({ root });
  const referenceStore = new ReversibleContextStore({ root: path.join(root, "references") });
  taskManager = new TaskManager({ store: taskStore, contextStore: referenceStore });
  taskRecovery = new TaskRecovery({ manager: taskManager });
  workflowOrchestrator = new WorkflowOrchestrator({ manager: taskManager });
  workerSupervisor = new WorkerSupervisor({ manager: taskManager });
  workerSupervisorTimer = setInterval(() => workerSupervisor?.supervise(), 5_000);
  workerSupervisorTimer.unref?.();
  registerTaskIpc(ipcMain, taskManager, taskRecovery, workflowOrchestrator);
  return taskManager;
}
const documentAttachments = () => ({ normalizeDocuments });
const acceptanceAllowsMultipleInstances = process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE === "1";
const hasSingleInstanceLock = acceptanceAllowsMultipleInstances || app.requestSingleInstanceLock();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ windowId: "main" });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

function stopPreviewRuntime(runtime) {
  if (!runtime?.child?.pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(runtime.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else runtime.child.kill("SIGTERM");
  } catch {}
}

const VENDOR_DOC_DOMAINS = [
  "supabase.com", "github.com", "anthropic.com", "openai.com", "npmjs.com", "npmjs.org",
  "vercel.com", "vercel.sh", "schema.vercel.sh", "openapi.vercel.sh",
  "react.dev", "reactjs.org", "nextjs.org", "nodejs.org", "mozilla.org",
  "google.com", "microsoft.com", "tailwindcss.com", "vitejs.dev", "w3.org",
];

function inferDeploymentPreviewUrl(runtimeRoot) {
  const candidates = [
    path.join(runtimeRoot, "vercel.json"),
    path.join(runtimeRoot, ".vercel", "project.json"),
  ];
  for (const filePath of candidates) {
    let source = "";
    try { source = fs.readFileSync(filePath, "utf8"); } catch { continue; }
    const urls = [...source.matchAll(/https:\/\/(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"']*)?/gi)]
      .map((match) => String(match[0]).replace(/[),.;]+$/, ""))
      .map((value) => value.includes("*") ? value.split("/").slice(0, 3).join("/") : value);
    const usable = urls.find((value) => {
      try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (VENDOR_DOC_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return false;
        return isAllowedPreviewNavigation(url.href);
      } catch { return false; }
    });
    if (usable) return usable;
  }
  return "";
}

function agentApprovalPayload(name, input = {}, { projectRoot = "" } = {}) {
  const { buildMutationDiff } = require("./runtime/diff-preview");
  const detail = name === "write_file" || name === "replace_in_file" || name === "delete_file"
    ? `Archivo: ${String(input.path || "").slice(0, 300)}`
    : name === "create_project"
      ? `Proyecto: ${String(input.name || "").slice(0, 80)}\nPlantilla: ${String(input.template || "blank").slice(0, 20)}\nCarpeta: ${String(input.path || ".").slice(0, 300)}`
      : name === "service_write"
        ? `Servicio: ${String(input.service || "").slice(0, 40)}\nMetodo: ${String(input.method || "POST").slice(0, 10)}\nRuta: ${String(input.path || "/").slice(0, 300)}`
        : name === "apply_diff"
          ? `Diff: ${String(input.proposalId || "").slice(0, 80)}`
          : name === "deploy_one_click"
            ? `Deploy: ${String(input.provider || "auto").slice(0, 40)}`
        : `Comando: ${String(input.command || "").slice(0, 300)}`;
  const message = name === "write_file"
    ? "El agente solicita escribir un archivo."
    : name === "replace_in_file"
      ? "El agente solicita modificar un archivo existente."
      : name === "delete_file"
        ? "El agente solicita borrar un archivo."
      : name === "create_project"
        ? "El agente solicita crear un proyecto dentro del proyecto activo."
        : name === "service_write"
          ? "El agente solicita modificar un servicio conectado."
          : name === "apply_diff"
            ? "El agente solicita aplicar un diff propuesto."
            : name === "deploy_one_click"
              ? "El agente solicita desplegar el proyecto."
          : "El agente solicita ejecutar una verificacion.";
  let diff = "";
  let hunks = [];
  let proposalId = "";
  try {
    if (projectRoot && (name === "write_file" || name === "replace_in_file")) {
      const { proposeDiff } = require("./runtime/diff-preview");
      const { parseUnifiedHunks } = require("./runtime/hunk-review");
      diff = buildMutationDiff(projectRoot, name, input);
      try {
        const staged = proposeDiff(projectRoot, name === "write_file"
          ? { path: input.path, content: input.content }
          : { path: input.path, oldText: input.oldText, newText: input.newText, replaceAll: input.replaceAll });
        proposalId = staged.proposalId || "";
        hunks = Array.isArray(staged.hunks) ? staged.hunks : parseUnifiedHunks(diff);
        if (!diff && staged.diff) diff = staged.diff;
      } catch {
        try { hunks = parseUnifiedHunks(diff); } catch { hunks = []; }
      }
    }
  } catch {}
  return {
    name,
    message,
    detail,
    input,
    diff,
    hunks,
    proposalId,
    stagedBeforeWrite: Boolean(proposalId || diff),
  };
}

function rejectPendingApprovalsForSender(senderId, approved = false) {
  let count = 0;
  for (const [requestId, pending] of pendingAgentApprovals.entries()) {
    if (pending.senderId !== senderId) continue;
    clearTimeout(pending.timeout);
    pendingAgentApprovals.delete(requestId);
    pending.resolve(approved);
    count += 1;
  }
  return count;
}

function requestAgentApproval(event, payload = {}) {
  const requestId = crypto.randomUUID();
  const sender = event?.sender;
  const senderId = sender?.id;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      const pending = pendingAgentApprovals.get(requestId);
      if (!pending) return;
      pendingAgentApprovals.delete(requestId);
      resolve(false);
    }, AGENT_APPROVAL_TIMEOUT_MS);
    pendingAgentApprovals.set(requestId, { resolve, timeout, senderId });
    if (!sender || sender.isDestroyed()) {
      clearTimeout(timeout);
      pendingAgentApprovals.delete(requestId);
      resolve(false);
      return;
    }
    sender.send("agent:approval-request", { requestId, ...payload });
  });
}

/** Progress + eventos granulares Cursor-like (thought / explore / diff). */
function publishAgentProgress(sender, payload = {}) {
  if (!sender || sender.isDestroyed?.()) return;
  const safePayload = typeof clipMutationProgressForUi === "function"
    ? clipMutationProgressForUi(payload)
    : (payload || {});
  const redacted = typeof redactSensitive === "function"
    ? redactSensitive(safePayload, 8)
    : safePayload;
  try {
    sender.send("agent:progress", redacted);
  } catch { /* ignore */ }
  try {
    attachTransparencyToProgress(sender, redacted, redacted);
  } catch { /* ignore */ }
  // Kernel escribe directo a disco: emitir files-changed al completar mutaciones
  // para que el panel derecho se refresque aunque el runId no esté en agentWorkflow.
  try {
    const tool = String(redacted?.name || "");
    const stage = String(redacted?.stage || "");
    const phase = String(redacted?.phase || "");
    if (
      phase === "tool"
      && stage === "done"
      && redacted?.ok !== false
      && ["write_file", "replace_in_file", "apply_diff", "create_project", "delete_file"].includes(tool)
    ) {
      const projectRoot = String(redacted.projectRoot || "").trim();
      if (projectRoot) {
        emitProjectFilesChanged({ sender }, projectRoot, tool, redacted.input || {}, redacted.result || {});
      }
    }
  } catch { /* ignore */ }
}

function publishAgentTaskComplete(sender, payload = {}) {
  if (!sender || sender.isDestroyed?.()) return;
  try {
    const emitter = createAgentTransparencyEmitter(sender, {
      runId: String(payload.runId || ""),
      projectId: String(payload.projectId || ""),
      projectRoot: String(payload.projectRoot || ""),
    });
    emitter.emitTaskComplete(payload.completed !== false && payload.ok !== false, {
      text: String(payload.text || "").slice(0, 4000),
      changedFiles: Array.isArray(payload.changedFiles)
        ? payload.changedFiles
        : (payload.report?.changedFiles || []),
    });
  } catch { /* ignore */ }
}

function resolveLivePermission(requested = "", senderId = null) {
  const fromInput = String(requested || "").trim();
  const fromRun = ["readonly", "step", "full"].includes(fromInput) ? fromInput : "";
  const fromSenderRaw = senderId != null ? permissionBySender.get(senderId) : null;
  const fromSender = ["readonly", "step", "full"].includes(fromSenderRaw) ? fromSenderRaw : "";
  const fromGlobal = ["readonly", "step", "full"].includes(permissionMode) ? permissionMode : "step";
  // Por ventana: no propagar full/readonly global a otras ventanas.
  return fromRun || fromSender || fromGlobal || "step";
}

function allocateWindowSlotFromMap() {
  return allocateWindowSlot([...windows.keys()]);
}

function windowStatus() {
  return {
    count: windows.size,
    max: MAX_WINDOWS,
    slots: [...windows.keys()],
    available: Math.max(0, MAX_WINDOWS - windows.size),
  };
}

async function approveAgentAction(event, mode, name, input, { projectRoot = "" } = {}) {
  if (mode === "readonly") return false;
  const remoteDelete = name === "service_write" && String(input.method || "").toUpperCase() === "DELETE";
  const alwaysConfirm = remoteDelete
    || name === "deploy_one_click"
    || name === "publish_project"
    || name === "ssh_deploy"
    || name === "git_push"
    || name === "onboard_project";
  if (mode === "full" && !alwaysConfirm) return true;
  if (name === "run_command") {
    const command = String(input.command || "");
    if (isShellReadCommand(command) || isShellExploreCommand(command)) return true;
    try {
      parseAnalysisCommand(command);
      return true;
    } catch {
      // Comandos fuera de la lista de verificacion siguen pidiendo confirmacion.
    }
  }
  const payload = agentApprovalPayload(name, input, { projectRoot });
  const approved = await requestAgentApproval(event, payload);
  if (approved) return true;
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!owner || owner.isDestroyed()) return false;
  const result = await dialog.showMessageBox(owner, {
    type: "warning",
    buttons: ["Cancelar", "Autorizar una vez"],
    defaultId: 0,
    cancelId: 0,
    title: "Autorizar acción del agente",
    message: payload.message,
    detail: payload.detail,
    noLink: true,
  });
  return result.response === 1;
}

// Acciones que publican cambios fuera del equipo (repositorio remoto, deploy,
// base de datos). El commit local NO requiere confirmacion; push/deploy si.
function externalMutationKind(command) {
  const value = String(command || "").trim().toLowerCase();
  if (/^git\s+push\b/.test(value)) return "git push (publicar en el repositorio remoto)";
  if (/^gh\s+(pr|release|repo)\s+(create|merge|edit|publish)\b/.test(value)) return "GitHub (crear o publicar)";
  if (/^vercel\b/.test(value) && !/^vercel\s+(ls|list|whoami|inspect|logs|env\s+ls)\b/.test(value)) return "deploy en Vercel";
  if (/^supabase\s+(db\s+push|functions\s+deploy|secrets|migration\s+up|storage)\b/.test(value)) return "cambios en Supabase";
  return "";
}

async function confirmRiskyAgentAction(event, { risk, command }) {
  const kind = String(risk?.kind || risk?.message || "accion de riesgo");
  const payload = {
    name: "run_command",
    message: `El agente quiere ejecutar una accion de riesgo: ${kind}.`,
    detail: `Comando: ${String(command || "").slice(0, 300)}\n\n${String(risk?.message || "Esta accion puede tener efectos amplios en tu sistema o proyecto.")}\n\nAutorizala solo si revisaste el resumen del agente en el chat.`,
    input: { command, riskyKind: kind },
  };
  const approved = await requestAgentApproval(event, payload);
  if (approved) return true;
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const options = {
    type: "warning",
    buttons: ["Cancelar", "Autorizar una vez"],
    defaultId: 0,
    cancelId: 0,
    title: "Confirmar accion de riesgo",
    message: payload.message,
    detail: payload.detail,
    noLink: true,
  };
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function confirmExternalAgentAction(event, { kind, command }) {
  const payload = {
    name: "run_command",
    message: `El agente quiere ejecutar: ${kind}.`,
    detail: `Comando: ${String(command || "").slice(0, 300)}\n\nEsta accion publica cambios fuera de tu equipo. Autorizala solo si revisaste el resumen del agente en el chat.`,
    input: { command, externalKind: kind },
  };
  const approved = await requestAgentApproval(event, payload);
  if (approved) return true;
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const options = {
    type: "warning",
    buttons: ["Cancelar", "Autorizar una vez"],
    defaultId: 0,
    cancelId: 0,
    title: "Confirmar acción externa",
    message: payload.message,
    detail: payload.detail,
    noLink: true,
  };
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

function brain() {
  if (!brainService) throw new Error("Brain service no inicializado.");
  return brainService;
}
function inspector() {
  if (!inspectorService) throw new Error("Inspector Core no inicializado.");
  return inspectorService;
}

function agentRunKey(senderId, runId) {
  return `${senderId}:${runId}`;
}

function planRunKey(senderId, runId) {
  return `${senderId}:${runId}`;
}

function cancelRunsForSender(senderId, reason = "Cancelado por el usuario.") {
  rejectPendingApprovalsForSender(senderId, false);
  let cancelled = false;
  for (const [key, entry] of activeAgentRuns.entries()) {
    if (entry.senderId !== senderId) continue;
    entry.requestController?.abort(new Error(reason));
    entry.controller?.abort(new Error(reason));
    activeAgentRuns.delete(key);
    cancelled = true;
  }
  for (const [key, entry] of activePlanRuns.entries()) {
    if (entry.senderId !== senderId) continue;
    entry.controller?.abort(new Error(reason));
    activePlanRuns.delete(key);
    cancelled = true;
  }
  return cancelled;
}

// Cache de acciones de lectura por proyecto: persiste entre corridas del mismo
// proyecto (TTL 1h) para que las continuaciones no re-lean evidencia ya vista.
const projectActionRegistries = new Map();
function actionRegistryForProject(rootPath) {
  const key = String(rootPath || "").replace(/\\/g, "/").toLowerCase();
  if (!projectActionRegistries.has(key)) {
    projectActionRegistries.set(key, new ActionRegistry({ maxEntries: 500, cacheTTL: 3_600_000 }));
    if (projectActionRegistries.size > 12) {
      projectActionRegistries.delete(projectActionRegistries.keys().next().value);
    }
  }
  return projectActionRegistries.get(key);
}

// Memoria de la ultima corrida del agente por proyecto: la siguiente corrida
// (una continuacion o una tarea relacionada) recibe este resumen en su prefijo
// para no re-explorar el proyecto desde cero y no quemar tokens repetidos.
const lastAgentRunSummaries = new Map();
function rememberAgentRun(rootPath, prompt, resultText, steps) {
  const key = String(rootPath || "").replace(/\\/g, "/").toLowerCase();
  if (!key) return;
  const seen = new Set();
  const unique = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const target = String(step?.input?.path || step?.input?.query || step?.input?.command || "").replace(/\s+/g, " ").slice(0, 120);
    const dedupeKey = `${step?.name}|${target}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push({ name: String(step?.name || ""), ok: step?.ok !== false, target });
  }
  lastAgentRunSummaries.set(key, {
    at: Date.now(),
    prompt: String(prompt || "").slice(0, 400),
    text: String(resultText || "").slice(0, 1800),
    steps: unique.slice(-60),
  });
  if (lastAgentRunSummaries.size > 12) {
    lastAgentRunSummaries.delete(lastAgentRunSummaries.keys().next().value);
  }
}

/** IPC: no enviar contenido completo de read_file (rompe/oculta el informe en el chat). */
function slimAgentStepsForIpc(steps = []) {
  return (Array.isArray(steps) ? steps : []).map((step) => {
    const result = step?.result;
    let slimResult = result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const content = result.content != null ? String(result.content) : "";
      slimResult = {
        ...result,
        content: content ? `[${content.length} chars]` : result.content,
        preview: content ? content.slice(0, 240) : result.preview,
      };
      if (slimResult.stdout && String(slimResult.stdout).length > 4000) {
        slimResult.stdout = `${String(slimResult.stdout).slice(0, 4000)}…`;
      }
      if (slimResult.stderr && String(slimResult.stderr).length > 2000) {
        slimResult.stderr = `${String(slimResult.stderr).slice(0, 2000)}…`;
      }
    } else if (typeof result === "string" && result.length > 4000) {
      slimResult = `${result.slice(0, 4000)}…`;
    }
    return {
      name: step?.name,
      ok: step?.ok,
      input: step?.input,
      result: slimResult,
      cached: step?.cached,
      verificationPassed: step?.verificationPassed,
    };
  });
}
function previousAgentRunSummary(rootPath) {
  const key = String(rootPath || "").replace(/\\/g, "/").toLowerCase();
  const entry = lastAgentRunSummaries.get(key);
  if (!entry || (Date.now() - entry.at) > 2 * 3_600_000) return "";
  const stepLines = entry.steps
    .map((step) => `- ${step.ok ? "OK" : "FALLO"} ${step.name}${step.target ? ` → ${step.target}` : ""}`)
    .join("\n");
  return [
    `Solicitud anterior: ${entry.prompt}`,
    stepLines ? `Acciones ya ejecutadas (su evidencia sigue vigente):\n${stepLines}` : "",
    entry.text ? `Conclusion o reporte de esa corrida:\n${entry.text}` : "",
  ].filter(Boolean).join("\n\n");
}

function agentRunForEvent(event, runId = "") {
  const requested = String(runId || "").trim();
  if (requested) return activeAgentRuns.get(agentRunKey(event.sender.id, requested)) || null;
  return [...activeAgentRuns.values()].find((run) => run.senderId === event.sender.id) || null;
}

function isAllowedPreviewNavigation(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:", "about:"].includes(url.protocol)
      && !url.username && !url.password
      && (url.protocol !== "about:" || url.href === "about:blank");
  } catch {
    return false;
  }
}

function isMainAppWebContents(webContents) {
  const url = String(webContents?.getURL?.() || "");
  return url.startsWith("file:") && url.includes("index.html");
}

function configureElectronSecurity() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (["audioCapture", "media", "speechRecognition", "microphone"].includes(permission)) {
      const origin = String(requestingOrigin || "");
      return !origin || origin.startsWith("file:") || origin === "null" || origin === "about:blank";
    }
    return permission === "clipboard-sanitized-write" && (!requestingOrigin || String(requestingOrigin).startsWith("file:"));
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (["audioCapture", "media", "speechRecognition", "microphone"].includes(permission)) {
      return callback(true);
    }
    const allowed = permission === "clipboard-sanitized-write" && webContents.getURL().startsWith("file:");
    callback(allowed);
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() === "webview" && isAllowedPreviewNavigation(url)) {
        contents.loadURL(url).catch((error) => logStartup("No se pudo navegar el preview.", error));
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (contents.getType() === "webview") {
        if (!isAllowedPreviewNavigation(url)) event.preventDefault();
        return;
      }
      if (!String(url).startsWith("file:") || !String(url).includes("/index.html")) event.preventDefault();
    });
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      params.allowpopups = "false";
      if (params.src && !isAllowedPreviewNavigation(params.src)) event.preventDefault();
    });
  });
  try {
    const { installPreviewCorsBridge } = require("./runtime/preview-cors-bridge");
    const previewSession = session.fromPartition("persist:editcore-browser");
    installPreviewCorsBridge(previewSession);
    installPreviewCorsBridge(session.defaultSession);
  } catch (error) {
    logStartup(`preview-cors-bridge: ${String(error?.message || error).slice(0, 160)}`);
  }
}

function inspectorRuntimeRoot() {
  const candidates = [
    __dirname,
    path.join(process.resourcesPath, "app"),
    app.getAppPath(),
    path.dirname(process.execPath),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    } catch {}
  }
  throw new Error("No se encontro el runtime interno de EditCore para Inspector.");
}

function recentInspectorLogErrors(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/)
      .filter((line) => /error|fail|unresponsive|render-process-gone|gateway|timeout/i.test(line))
      .slice(-20)
      .map((line) => line.slice(0, 500));
  } catch {
    return [];
  }
}

async function inspectorRuntimeHealth() {
  const root = inspectorRuntimeRoot();
  const criticalFiles = ["main.js", "preload.js", "renderer.js", "index.html", "inspector-core-service.js", "agent-runtime.js"];
  const files = criticalFiles.map((name) => {
    const filePath = path.join(root, name);
    const exists = fs.existsSync(filePath);
    return { name, exists, bytes: exists ? fs.statSync(filePath).size : 0 };
  });
  const secure = readSecureState();
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const activeModels = profiles.filter((profile) => profile?.status === "active" && profile?.model)
    .map((profile) => `${profile.providerKey}/${profile.model}`);
  const startupErrors = recentInspectorLogErrors(path.join(app.getPath("userData"), "startup.log"));
  const previewErrors = recentInspectorLogErrors(path.join(app.getPath("userData"), "preview-errors.log"));
  let userDataWritable = false;
  const probe = path.join(app.getPath("userData"), `.inspector-write-probe-${process.pid}`);
  try {
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "ok", "utf8");
    userDataWritable = fs.readFileSync(probe, "utf8") === "ok";
  } finally {
    try { fs.rmSync(probe, { force: true }); } catch {}
  }
  const issues = [];
  for (const file of files.filter((item) => !item.exists)) issues.push({ severity: "high", title: `Archivo interno faltante: ${file.name}`, detail: `No existe ${file.name} en el runtime de EditCore.`, file: file.name });
  if (!userDataWritable) issues.push({ severity: "high", title: "Datos de EditCore sin escritura", detail: "Inspector no pudo escribir y leer una prueba en userData.", file: app.getPath("userData") });
  if (!activeModels.length) issues.push({ severity: "medium", title: "Sin modelos activos", detail: "No hay perfiles de modelo activos para Chat o Agente.", file: "Configuracion segura" });
  const recentStartupErrors = startupErrors.filter((line) => {
    const timestamp = line.match(/\[?(\d{4}-\d{2}-\d{2}T[^\]\s]+)/)?.[1];
    return timestamp && Date.now() - new Date(timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  if (recentStartupErrors.length) issues.push({
    severity: "medium",
    title: "Errores recientes en el runtime",
    detail: `${recentStartupErrors.length} evento(s) de error, timeout o proceso no responsivo en las ultimas 24 horas.`,
    file: "startup.log",
  });
  const clientTelemetry = [...inspectorRendererTelemetry.values()].slice(-4);
  const clientErrors = clientTelemetry.flatMap((item) => Array.isArray(item.errors) ? item.errors.slice(-8) : []);
  if (clientErrors.length) issues.push({
    severity: "medium",
    title: "Errores recientes del renderer",
    detail: `${clientErrors.length} error(es) de interfaz o promesa no controlada reportados por la ventana de EditCore.`,
    file: "renderer telemetry",
    evidence: clientErrors.join("\n"),
  });
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (memoryMb > 1024) issues.push({ severity: "high", title: "Consumo de memoria elevado", detail: `El proceso principal usa ${memoryMb} MB RSS.`, file: "process.memoryUsage" });
  const staleAgents = [...activeAgentRuns.values()].filter((run) => run?.startedAt && Date.now() - run.startedAt > 120_000);
  if (staleAgents.length) issues.push({ severity: "medium", title: "Agente sin avance reciente", detail: `${staleAgents.length} ejecucion(es) superan 120 segundos y requieren revisar su ultimo checkpoint.`, file: "agent runtime" });
  const responseCacheStats = getResponseCache().getStats();
  const toolCacheStats = getToolCache().stats();
  const telemetry = clientTelemetry[clientTelemetry.length - 1] || {};
  return {
    checkedAt: new Date().toISOString(),
    target: "editcore-runtime",
    root,
    packaged: app.isPackaged,
    version: RUNTIME_VERSION,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb,
      windows: BrowserWindow.getAllWindows().length,
      activeAgents: activeAgentRuns.size,
      activeChats: activeChatRuns.size,
      activePreviews: previewProcesses.size,
    },
    files,
    userDataWritable,
    activeModels,
    logs: { startupErrors, previewErrors },
    telemetry: { client: telemetry, clientErrors, responseCache: responseCacheStats, toolCache: toolCacheStats },
    capabilities: ["runtime-files", "startup-logs", "preview-logs", "provider-state", "agent-state", "renderer-errors", "cache-state", "check", "tests", "build", "safe-handoff"],
    issues,
  };
}

const RUNTIME_VERSION = (() => {
  const isJunk = (v) => {
    const s = String(v || "").trim();
    return !s || s === "0.0.0" || s === "0.0.0.0";
  };
  const tryRead = (file) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      const v = String(pkg?.version || "").trim();
      return isJunk(v) ? "" : v;
    } catch {
      return "";
    }
  };
  // 1) package junto a main (asar o cwd)
  try {
    const v = String(require("./package.json").version || "").trim();
    if (!isJunk(v)) return v;
  } catch { /* continue */ }
  // 2) overlay / resources/app (fuente sincronizada del EXE)
  const near = [
    path.join(__dirname, "package.json"),
    path.join(process.resourcesPath || "", "app", "package.json"),
    path.join(process.resourcesPath || "", "ui-overlay", "package.json"),
    path.join(path.dirname(process.execPath || ""), "resources", "app", "package.json"),
  ];
  for (const file of near) {
    const v = tryRead(file);
    if (v) return v;
  }
  // 3) Electron embebido (ignorar 0.0.0 basura de builds rotos)
  try {
    const v = String(app.getVersion?.() || "").trim();
    if (!isJunk(v)) return v;
  } catch { /* ignore */ }
  return "2.7.0";
})();

function resolveUiIndexHtml() {
  // En desarrollo (no empaquetado) SIEMPRE la UI de la raíz del repo.
  // Preferir resources/app solo en builds empaquetados — evita ERR_FAILED (-2) y UI fantasma.
  const packaged = (() => {
    try { return app.isPackaged === true; } catch { return false; }
  })();
  const localIndex = path.join(__dirname, "index.html");
  if (!packaged) {
    try {
      if (fs.existsSync(localIndex)) return localIndex;
    } catch { /* fallthrough */ }
  }
  const candidates = [
    localIndex,
    path.join(process.resourcesPath || "", "app", "index.html"),
    path.join(path.dirname(process.execPath || ""), "resources", "app", "index.html"),
    path.join(__dirname, "..", "app", "index.html"),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && !String(candidate).includes(".asar")) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // continue
    }
  }
  return localIndex;
}

function buildUiFileUrl(indexHtml, hash = "") {
  // pathToFileURL codifica espacios (PROGRAMAS IA) — loadFile a veces emite file:///D:\... inválido.
  let href = pathToFileURL(path.resolve(indexHtml)).href;
  const fragment = String(hash || "").replace(/^#/, "").trim();
  if (fragment) href += `#${fragment}`;
  return href;
}

function loadUiIntoWindow(win, hash = "") {
  const indexHtml = resolveUiIndexHtml();
  const href = buildUiFileUrl(indexHtml, hash);
  logStartup(`startup:load-ui ${indexHtml} -> ${href}`);
  const loadOne = (filePath) => {
    const url = buildUiFileUrl(filePath, hash);
    logStartup(`startup:load-ui-attempt ${url}`);
    return win.loadURL(url).catch((error) => {
      logStartup(`startup:loadURL-failed ${filePath}`, error);
      // Fallback nativo por si loadURL falla en alguna build.
      const opts = hash ? { hash: String(hash).replace(/^#/, "") } : undefined;
      return win.loadFile(filePath, opts);
    });
  };
  return loadOne(indexHtml).catch((error) => {
    logStartup("No se pudo cargar index.html.", error);
    const fallbacks = [
      path.join(__dirname, "index.html"),
      path.join(process.resourcesPath || "", "app", "index.html"),
      path.join(path.dirname(process.execPath || ""), "resources", "app", "index.html"),
    ].filter((p) => p && path.resolve(p) !== path.resolve(indexHtml));
    const tryNext = (i = 0) => {
      if (i >= fallbacks.length || win.isDestroyed()) {
        // Último recurso: HTML mínimo para no dejar pantalla en blanco.
        const emergency = "data:text/html;charset=utf-8," + encodeURIComponent(
          "<!doctype html><html><body style=\"font-family:Segoe UI,sans-serif;padding:32px;background:#f5f6f8;color:#1a1a1a\">"
          + "<h1>EditCoreAI</h1><p>No se pudo cargar la UI. Cierra todas las ventanas de EditCoreAI y vuelve a abrir.</p>"
          + "<pre style=\"white-space:pre-wrap;color:#a00\">" + String(error?.message || error || "ERR_FAILED") + "</pre>"
          + "</body></html>"
        );
        logStartup("startup:load-ui-emergency-html");
        return win.loadURL(emergency).catch(() => undefined);
      }
      const next = fallbacks[i];
      try {
        if (!fs.existsSync(next)) return tryNext(i + 1);
      } catch {
        return tryNext(i + 1);
      }
      logStartup(`startup:load-ui-fallback ${next}`);
      return loadOne(next).catch((err) => {
        logStartup(`startup:load-ui-fallback-failed ${next}`, err);
        return tryNext(i + 1);
      });
    };
    return tryNext(0);
  });
}

function resolveUiAsset(...parts) {
  const candidates = [
    path.join(process.resourcesPath || "", "app", ...parts),
    path.join(path.dirname(process.execPath || ""), "resources", "app", ...parts),
    path.join(__dirname, ...parts),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && !String(candidate).includes(".asar")) return candidate;
    } catch {
      // continue
    }
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // continue
    }
  }
  return path.join(__dirname, ...parts);
}

function resolveAppIconPath() {
  const iconCandidates = [
    path.join(__dirname, "assets", "logo.ico"),
    path.join(process.cwd(), "assets", "logo.ico"),
    resolveUiAsset("assets", "logo.ico"),
    path.join(__dirname, "assets", "logo.png"),
    path.join(__dirname, "assets", "editcore-logo.png"),
  ];
  for (const candidate of iconCandidates) {
    try {
      if (candidate && fs.existsSync(candidate) && !String(candidate).includes(".asar")) {
        return candidate;
      }
    } catch { /* continue */ }
  }
  for (const candidate of iconCandidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch { /* continue */ }
  }
  return "";
}

function loadAppIconImage(iconPath = "") {
  const target = String(iconPath || resolveAppIconPath() || "").trim();
  if (!target) return null;
  try {
    const image = nativeImage.createFromPath(target);
    if (image && !image.isEmpty()) return image;
  } catch { /* ignore */ }
  return null;
}

function applyWindowIcon(win, iconPath = "") {
  if (!win || win.isDestroyed()) return;
  const image = loadAppIconImage(iconPath);
  try {
    if (image && typeof win.setIcon === "function") win.setIcon(image);
    else if (iconPath && typeof win.setIcon === "function") win.setIcon(iconPath);
  } catch { /* ignore */ }
}

function createWindow(options = {}) {
  const windowId = String(options.windowId || crypto.randomUUID());
  const hiddenAcceptance = process.env.EDITCORE_ACCEPTANCE_HIDDEN === "1";
  logStartup(`runtime v${RUNTIME_VERSION} cargado desde ${__dirname}`);
  const iconPath = resolveAppIconPath();
  const iconImage = loadAppIconImage(iconPath);
  logStartup(`startup:creating-browser-window icon=${iconPath || "(none)"}`);
  let win;
  try {
    try {
      app.setAppUserModelId("com.editcoreai.app");
    } catch { /* ignore */ }
    const prefs = {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // false: no throttlear el renderer (botones / IPC vivos al primer clic).
      backgroundThrottling: false,
      webviewTag: true,
      spellcheck: false,
    };
    const winOpts = {
      width: 1120,
      height: 760,
      minWidth: 880,
      minHeight: 620,
      title: "EditCore",
      backgroundColor: "#1e1e1e",
      // true: ventana visible de inmediato (welcome / shell, no pantalla en blanco).
      show: true,
      center: true,
      autoHideMenuBar: true,
      // Una sola barra: sin title bar nativa duplicada (marca solo en status bar).
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#181818",
        symbolColor: "#cccccc",
        height: 36,
      },
      webPreferences: prefs,
    };
    try {
      if (iconImage) winOpts.icon = iconImage;
      else if (iconPath) winOpts.icon = iconPath;
    } catch {
      // sin icono
    }
    win = new BrowserWindow(winOpts);
    applyWindowIcon(win, iconPath);
  } catch (error) {
    logStartup("startup:browser-window-FAILED", error);
    throw error;
  }
  windows.set(windowId, win);
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win;
  logStartup(`startup:browser-window-created id=${windowId}`);

  let windowShown = false;
  const displayWindow = () => {
    if (windowShown || win.isDestroyed() || hiddenAcceptance) return;
    windowShown = true;
    applyWindowIcon(win, iconPath);
    if (win.isMinimized()) win.restore();
    win.center();
    win.show();
    win.focus();
    logStartup("startup:window-shown");
  };

  win.once("ready-to-show", displayWindow);
  win.webContents.once("did-finish-load", () => {
    try { win.setTitle(appWindowTitle()); } catch { /* ignore */ }
    displayWindow();
  });

  // Failsafe: asegurar foco/visibilidad si ready-to-show se demora.
  setTimeout(() => {
    if (win.isDestroyed() || windowShown || hiddenAcceptance) return;
    logStartup("failsafe:show-window (mostrando ventana tras timeout de carga)");
    displayWindow();
  }, 2500);

  // Context menu nativo para cortar/copiar/pegar en inputs y textareas
  win.webContents.on("context-menu", (_event, params) => {
    const { Menu, MenuItem } = require("electron");
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ label: "Cortar", role: "cut" }));
      menu.append(new MenuItem({ label: "Copiar", role: "copy" }));
      menu.append(new MenuItem({ label: "Pegar", role: "paste" }));
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(new MenuItem({ label: "Seleccionar todo", role: "selectAll" }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: "Copiar", role: "copy" }));
    }
    if (menu.items.length) menu.popup({ window: win });
  });
  win.webContents.on("did-finish-load", () => {
    try {
      logStartup(`startup:did-finish-load url=${win.webContents.getURL()}`);
    } catch {
      logStartup("startup:did-finish-load");
    }
  });
  win.webContents.on("console-message", (event) => {
    try {
      const msg = String(event?.message || "").slice(0, 240);
      if (!msg) return;
      if (/Security Warning|Insecure Content-Security-Policy|allowpopups/i.test(msg)) return;
      logStartup(`renderer-console level=${event?.level} ${msg}`);
    } catch { /* ignore */ }
  });
  win.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    logStartup(`did-fail-load ${code}: ${description} url=${validatedURL || ""} main=${isMainFrame}`);
    if (!win.isDestroyed() && isMainFrame !== false && Number(code) !== -3) {
      // -3 = ERR_ABORTED (navegación sustituida). No reintentar en bucle.
      setTimeout(() => {
        if (win.isDestroyed()) return;
        const target = path.join(__dirname, "index.html");
        if (!fs.existsSync(target)) return;
        const href = buildUiFileUrl(target);
        logStartup(`startup:did-fail-retry ${href}`);
        win.loadURL(href).catch((err) => logStartup("Reintento loadURL falló", err));
      }, 500);
    }
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    logStartup(`render-process-gone ${JSON.stringify(details)}`);
  });
  win.on("unresponsive", () => logStartup("window unresponsive"));

  const hashParams = [];
  if (options.autoPick) hashParams.push("autoPick=1");
  if (windowId && windowId !== "main") hashParams.push(`windowId=${encodeURIComponent(windowId)}`);

  void loadUiIntoWindow(win, hashParams.join("&"));
  const webContentsId = win.webContents.id;
  win.on("closed", () => {
    inspectorRendererTelemetry.delete(webContentsId);
    permissionBySender.delete(webContentsId);
    windows.delete(windowId);
    try {
      const { listSessions, killSession } = require("./runtime/pty-session");
      for (const snap of listSessions()) {
        if (Number(snap.ownerId) === Number(webContentsId)) {
          try { killSession(snap.id); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    for (const [root, runtime] of previewProcesses) {
      runtime.owners?.delete(webContentsId);
      if (!runtime.owners?.size) {
        stopPreviewRuntime(runtime);
        previewProcesses.delete(root);
      }
    }
    if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] || null;
  });
  return { windowId, win };
}

function normalizeBaseUrl(value, providerKey = "") {
  const raw = String(value || "https://api.apicredits.site/v1").trim().replace(/\/+$/, "");
  const localProvider = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw);
  if (!/^https:\/\/[a-z0-9.-]+/i.test(raw) && !localProvider) throw new Error("Endpoint invalido. Usa HTTPS o un endpoint local permitido.");
  try {
    const u = new URL(raw);
    if (!u.pathname || u.pathname === "/") {
      // Si es GAFCORE, usar la ruta correcta del gateway
      if (u.hostname.includes("gafcore-gateway")) return raw + "/api/openai/v1";
      return raw + "/v1";
    }
  } catch {}
  return raw;
}

function providerKind(providerKey = "", baseUrl = "") {
  const key = String(providerKey || "").toLowerCase();
  let host = ""; try { host = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  if (key === "anthropic" || key === "claude") return "anthropic";
  if (key === "gemini" || key === "google") return "gemini";
  if (key === "openai" || key === "gpt") return "openai-compatible";
  if (host.includes("anthropic.com")) return "anthropic";
  if (host.includes("generativelanguage.googleapis.com")) return "gemini";
  if (key === "ollama" || key === "lmstudio" || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return "ollama";
  return "openai-compatible";
}

function providerRequestHeaders(kind, apiKey, json = false) {
  if (kind === "gemini") return json ? { "Content-Type": "application/json" } : {};
  const headers = { "Authorization": `Bearer ${apiKey}`, "x-api-key": apiKey };
  if (kind === "anthropic") headers["anthropic-version"] = "2023-06-01";
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function providerModelsUrl(baseUrl, providerKey, apiKey) {
  const endpoint = normalizeBaseUrl(baseUrl, providerKey);
  if (providerKind(providerKey, endpoint) === "gemini") {
    const separator = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}/models${separator}key=${encodeURIComponent(apiKey)}`;
  }
  return `${endpoint}/models`;
}

function extractModelIdsFromPayload(data) {
  const rows = Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.models) ? data.models
    : [];
  return rows.map((item) => String(item?.id || item?.name || item).replace(/^models\//, "").trim()).filter(Boolean);
}

function extractText(payload) {
  return payload?.choices?.[0]?.message?.content
    || payload?.choices?.[0]?.text
    || payload?.message?.content
    || payload?.output_text
    || payload?.text
    || "";
}

const AGENT_TOOL_DEFINITIONS = [
  ["list_files", "Lista archivos dentro del proyecto.", { path: { type: "string" } }],
  ["read_file", "Lee un archivo de texto del proyecto (path relativo a un archivo, no a una carpeta).", { path: { type: "string", minLength: 1 } }],
  ["search_files", "Busca texto en archivos del proyecto.", { query: { type: "string", minLength: 1 }, path: { type: "string" } }],
  ["write_file", "Escribe contenido completo en un archivo del proyecto.", { path: { type: "string", minLength: 1 }, content: { type: "string" } }],
  ["replace_in_file", "Reemplaza oldText exacto y no vacio por newText dentro de un archivo existente.", { path: { type: "string", minLength: 1 }, oldText: { type: "string", minLength: 1 }, newText: { type: "string" }, replaceAll: { type: "boolean" } }],
  ["delete_file", "Borra un archivo del proyecto (no carpetas).", { path: { type: "string", minLength: 1 } }],
  ["create_project", "Crea un proyecto desde una plantilla profesional.", { name: { type: "string", minLength: 1 }, template: { type: "string" }, path: { type: "string" } }],
  ["run_command", "Ejecuta un comando permitido dentro del proyecto.", { command: { type: "string", minLength: 1 } }],
  ["inspect_preview", "Inicia y examina visualmente el proyecto en un navegador Electron real.", { viewport: { type: "string", enum: ["desktop", "mobile"] } }],
  ["inspect_browser", "Inspecciona el preview local (solo localhost).", { url: { type: "string" }, viewport: { type: "string", enum: ["desktop", "mobile"] } }],
  ["browser_interact", "Interactua con preview local (dom/click/type/console). Solo localhost.", { action: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, url: { type: "string" } }],
  ["search", "Busqueda unificada en archivos y Cerebro.", { query: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }],
  ["run_diagnostics", "Ejecuta typecheck/lint descubiertos en package.json.", { files: { type: "array", items: { type: "string" } } }],
  ["mcp_list_tools", "Lista tools MCP configuradas en .editcore/mcp.json.", {}],
  ["mcp_invoke", "Invoca tool MCP allowlisted (modo seguro).", { serverId: { type: "string" }, tool: { type: "string" } }],
  ["connection_status", "Consulta el estado de servicios conectados.", {}],
  ["service_read", "Lee datos de un servicio conectado.", { service: { type: "string" }, path: { type: "string" } }],
  ["service_write", "Modifica un servicio conectado.", { service: { type: "string" }, method: { type: "string" }, path: { type: "string" }, body: {} }],
  ["project_discovery", "Detecta stack, lenguajes, scripts, entrypoints, configuracion y verificaciones reales del proyecto.", { refresh: { type: "boolean" } }],
  ["codebase_map", "Construye o consulta un mapa estructural pequeno de archivos, modulos, simbolos, imports y exports.", { refresh: { type: "boolean" }, includeFiles: { type: "boolean" } }],
  ["symbol_search", "Busca funciones, clases, metodos, componentes, hooks, tipos y variables por nombre.", { query: { type: "string" }, kinds: { type: "array", items: { type: "string" } }, path: { type: "string" }, limit: { type: "number" } }],
  ["dependency_search", "Busca imports, exports y referencias relacionadas con un nombre o modulo.", { query: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }],
].map(([name, description, properties]) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required: ({
        read_file: ["path"], search_files: ["query"], write_file: ["path", "content"],
        replace_in_file: ["path", "oldText", "newText"], delete_file: ["path"], create_project: ["name"],
        run_command: ["command"], retrieve_context: ["id"], load_tool_descriptor: ["name"],
        search: ["query"], run_diagnostics: [], mcp_invoke: ["serverId", "tool"],
        symbol_search: ["query"], dependency_search: ["query"], create_plan: ["objective", "steps"],
        select_verification: ["changedFiles"], diagnose_result: ["output"],
      })[name] || [],
      additionalProperties: true,
    },
  },
})).concat(BRAIN_TOOL_DEFINITIONS);

function agentToolSchema(name) {
  return AGENT_TOOL_DEFINITIONS.find((definition) => definition.function.name === name)?.function.parameters
    || { type: "object", properties: {}, additionalProperties: true };
}

function extractAgentText(payload) {
  const call = payload?.choices?.[0]?.message?.tool_calls?.[0]
    || payload?.message?.tool_calls?.[0]
    || payload?.tool_calls?.[0];
  const content = extractText(payload);
  const selected = selectAgentResponse(call, content);
  return selected ? JSON.stringify(selected) : content;
}

function getResponseCache() {
  if (!responseCache) {
    responseCache = new ResponseCache({
      filePath: path.join(app.getPath("userData"), "response-cache.json"),
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxEntries: 900,
      maxBytes: 40 * 1024 * 1024,
    });
  }
  return responseCache;
}

function getToolCache() {
  if (!toolCache) {
    toolCache = new ToolCache({
      filePath: path.join(app.getPath("userData"), "tool-cache.json"),
      ttlMs: 30 * 60 * 1000,
      maxEntries: 2_500,
      persistEveryMs: 3_000,
    });
  }
  return toolCache;
}

function estimateTokens(value) {
  const str = String(value || "").replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi, "[IMAGE_DATA]");
  return Math.max(1, Math.ceil(str.length / 4));
}

function normalizeImages(images) {
  return normalizeVisionImages(images).slice(0, 6);
}


function sanitizeChatText(value) {
  let text = stripEliteFiller(String(value || "").trim());
  if (!text) return text;
  // Solo bloquear si la respuesta es PURAMENTE un bloque de protocolo XML/JSON
  // (sin texto adicional del modelo). Respuestas con mencion de herramientas en
  // prosa normal (ej: "puedo usar list_files para...") deben pasar.
  const stripped = text.replace(/\s+/g, " ").trim();
  const isPureXmlProtocol = /^<(?:tool_call|tool_use|function_call)\b/i.test(stripped);
  const isPureJsonProtocol = /^\s*\{[\s\S]{0,20}"type"\s*:\s*"tool"/.test(text)
    && !/[.!?¿¡]\s*[A-ZÁÉÍÓÚa-záéíóú]/.test(text.slice(0, 300));
  if (isPureXmlProtocol || isPureJsonProtocol) {
    return "El proveedor devolvio una instruccion interna; EditCore la proceso como protocolo, no la mostro ni la ejecuto en el chat.";
  }
  // Filtrar bloques JSON de herramientas si el modelo los emite accidentalmente en modo chat
  text = text.replace(/```(?:json)?\s*\{\s*["']tool["']\s*:\s*["'][^"']+["'][\s\S]*?\}\s*```/gi, "");
  text = text.replace(/\{\s*["']tool["']\s*:\s*["'][^"']+["'][\s\S]*?\}\s*/gi, "");
  return text.trim();
}


async function validateVercelCli() {
  try {
    const result = await execFileAsync(process.platform === "win32" ? "vercel.cmd" : "vercel", ["--version"], { timeout: 10_000, windowsHide: true });
    return Boolean(String(result.stdout || "").trim());
  } catch { return false; }
}

function normalizeUsage(rawUsage, estimatedInputTokens, outputText) {
  return normalizeProviderUsage(rawUsage, estimatedInputTokens, outputText, estimateTokens);
}

function cacheKey(input) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({
    baseUrl: input.baseUrl,
    model: input.model,
    prompt: input.prompt,
    history: (input.history || []).slice(-8),
    projectId: input.projectId || "",
    projectRoot: input.projectRoot || "",
    agentId: input.agentId || "",
    images: (input.images || []).map((image) => ({ name: image.name, mimeType: image.mimeType, digest: crypto.createHash("sha256").update(image.dataUrl).digest("hex") })),
  }));
  return hash.digest("hex");
}

function toUserFacingError(error) {
  try {
    const { sanitizeChatProviderError } = require("./runtime/chat-error-sanitize");
    return sanitizeChatProviderError(error);
  } catch {
    const message = String(error?.message || error || "").trim();
    if (!message) return "No pude completar la acción. Intenta de nuevo.";
    if (/gafcore/i.test(message)) return "No pude completar la respuesta. Intenta de nuevo.";
    if (/Cannot find module|Require stack|ENOENT|\.asar[\\/]|node_modules|ipcMain|jarvis-adapter/i.test(message)) {
      return "No pude procesar tu mensaje ahora. Verifica que tengas un modelo verificado en Modelos y vuelve a intentar.";
    }
    if (/ECONNREFUSED|fetch failed|backend|no est[aá] disponible|tardo demasiado|502|503|429|timeout/i.test(message)) {
      return "No pude completar la respuesta. Intenta de nuevo.";
    }
    return message.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  }
}

ipcMain.handle("editcore:chat", async (_event, input = {}) => {
  const apiKey = String(input.apiKey || "").trim();
  let model = String(input.model || "").trim();
  const prompt = String(input.prompt || "").trim();
  let baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey || input.provider || input.mode);
  let chatApiKey = apiKey;
  let providerKey = String(input.providerKey || input.provider || input.mode || "");
  const rootPath = String(input.projectRoot || "").trim();
  const images = normalizeImages(input.images);
  const permissionHint = String(
    input.permissionMode
    || permissionBySender.get(_event?.sender?.id)
    || permissionMode
    || "",
  ).toLowerCase();
  const fullAccess = permissionHint === "full";

  if (!prompt && !images.length) throw new Error("Escribe un mensaje.");
  const effectivePrompt = prompt || (images.length ? "Analiza la imagen adjunta." : "");

  if (images.length) {
    const routed = ensureVisionRoute({
      model,
      images,
      candidates: fallbackProviderProfiles({ providerKey, baseUrl, model, apiKey: chatApiKey }),
    });
    if (routed.routed && routed.model) {
      model = routed.model;
      if (routed.apiKey) chatApiKey = routed.apiKey;
      if (routed.baseUrl) baseUrl = normalizeBaseUrl(routed.baseUrl, routed.providerKey || providerKey);
      if (routed.providerKey) providerKey = routed.providerKey;
    }
  }

  const decision = classifyChatKernel(effectivePrompt, {
    permissionMode: permissionHint || "step",
    fullAccess,
    allowWrite: fullAccess,
  });
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
    ? localConversationResponse(effectivePrompt)
    : "";
  if (localText && decision.kind === "CHAT" && !fullAccess && !images.length) {
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
        estimated_input_tokens: estimateTokens(effectivePrompt),
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
      ...buildKernelProcessHooks(rootPath),
    });
    const out = await handleChatKernel({
      message: effectivePrompt,
      history: Array.isArray(input.history) ? input.history : (Array.isArray(input.messages) ? input.messages : []),
      threadId: input.chatId || input.threadId || input.conversationId || "",
      chatId: input.chatId || input.threadId || "",
      projectRoot: rootPath,
      apiBaseUrl: baseUrl,
      apiKey: chatApiKey,
      model,
      images,
      fallbackProfiles: fallbackProviderProfiles({ providerKey, baseUrl, model, apiKey: chatApiKey }),
      helpers,
      allowWrite: fullAccess || permissionHint !== "readonly",
      permissionMode: permissionHint || permissionMode || "step",
      fullAccess,
      planAuthorizedExecution: fullAccess,
      onProgress: (p) => {
        try {
          const payload = {
            runId: String(input.runId || ""),
            projectId: String(input.projectId || ""),
            projectRoot: rootPath,
            ...(p && typeof p === "object" ? p : { text: String(p || "") }),
          };
          // Solo agent:progress — NO reenviar por editcore:chunk (duplicaba el texto en el chat).
          publishAgentProgress(sender, payload);
        } catch { /* ignore */ }
      },
    });
    const text = String(out?.text || "").trim() || "Sin respuesta.";
    try {
      if (!sender.isDestroyed()) sender.send("editcore:chunk", { done: true, text });
    } catch { /* ignore */ }
    return {
      text,
      kernel: true,
      kind: out?.kind || decision.kind,
      steps: Array.isArray(out?.steps) ? out.steps : [],
      visionRouted: images.length ? model : undefined,
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



ipcMain.handle("editcore:cancel", (event) => {
  try { stopChatKernel(); } catch { /* ignore */ }
  const controller = activeChatRuns.get(event.sender.id);
  if (!controller) return true;
  controller.abort(new Error("Respuesta cancelada por el usuario."));
  activeChatRuns.delete(event.sender.id);
  return true;
});

ipcMain.handle("metrics:cache-stats", () => ({
  responses: getResponseCache().getStats(),
  tools: getToolCache().stats(),
  harness: { scope: "connected-services", chatRequests: 0 },
}));

ipcMain.handle("inspector:telemetry", (event, value = {}) => {
  const safe = {
    at: Date.now(),
    errors: Array.isArray(value.errors) ? value.errors.map((item) => String(item).slice(0, 600)).slice(-20) : [],
    queueLength: Math.max(0, Number(value.queueLength) || 0),
    activeRequests: Math.max(0, Number(value.activeRequests) || 0),
    metrics: {
      input: Math.max(0, Number(value.metrics?.input) || 0),
      output: Math.max(0, Number(value.metrics?.output) || 0),
      cacheRead: Math.max(0, Number(value.metrics?.cacheRead) || 0),
      calls: Math.max(0, Number(value.metrics?.calls) || 0),
    },
  };
  inspectorRendererTelemetry.set(event.sender.id, safe);
  return { ok: true };
});

function listEntries(rootPath, relativePath = "") {
  const root = assertProjectRoot(rootPath);
  const target = resolveProjectPath(root, relativePath || ".");
  if (!fs.existsSync(target)) {
    return [];
  }
  if (!fs.statSync(target).isDirectory()) {
    return [];
  }
  const seen = new Set();
  const rows = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules", "dist", "build", ".next"].includes(entry.name))
    .map((entry) => {
      const rel = path.relative(root, path.join(target, entry.name));
      return {
        name: entry.name,
        path: rel,
        absolutePath: path.join(target, entry.name),
        kind: entry.isDirectory() ? "directory" : "file",
      };
    })
    .filter((row) => {
      const key = String(row.path || row.name).replace(/\\/g, "/").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
  return rows;
}

function listProjectCatalog(parentPath) {
  const parent = assertProjectRoot(parentPath);
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, root: path.join(parent, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

function resolveInside(rootPath, relativePath = "") {
  const requested = String(relativePath || ".").trim();
  return resolveProjectPath(rootPath, requested === "/" || requested === "\\" ? "." : requested);
}

const SOURCE_VARIANT_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".json", ".md", ".css", ".html"];

function fileVariantCandidates(requestedPath = "") {
  const normalized = String(requestedPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const parsed = path.posix.parse(normalized);
  const extensions = parsed.ext
    ? SOURCE_VARIANT_EXTENSIONS.filter((ext) => ext !== parsed.ext)
    : SOURCE_VARIANT_EXTENSIONS;
  return extensions.map((ext) => path.posix.join(parsed.dir, `${parsed.name}${ext}`));
}

function resolveReadableProjectFile(rootPath, relativePath) {
  const requested = String(relativePath || "").trim();
  const direct = resolveInside(rootPath, requested);
  if (fs.existsSync(direct)) return { target: direct, path: requested };

  for (const candidate of fileVariantCandidates(requested)) {
    const target = resolveInside(rootPath, candidate);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return { target, path: candidate, resolvedFrom: requested };
  }

  const requestedBase = path.basename(requested).replace(/\.[^.]+$/, "").toLowerCase();
  if (requestedBase) {
    const match = walkFiles(rootPath, "", 1200)
      .find((file) => path.basename(file).replace(/\.[^.]+$/, "").toLowerCase() === requestedBase
        && SOURCE_VARIANT_EXTENSIONS.includes(path.extname(file).toLowerCase()));
    if (match) return { target: resolveInside(rootPath, match), path: match, resolvedFrom: requested };
  }

  return { target: direct, path: requested };
}

function buildReadFileNotFoundHint(rootPath, relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const parentRel = path.posix.dirname(normalized);
  const parentKey = !parentRel || parentRel === "." ? "" : parentRel;
  let siblings = [];
  try {
    siblings = listEntries(rootPath, parentKey)
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path);
  } catch {
    siblings = [];
  }
  const dirLabel = parentKey || "la raiz del proyecto";
  const hint = siblings.length
    ? ` Archivos reales en ${dirLabel}: ${siblings.slice(0, 30).join(", ")}.`
    : ` Usa list_files en "${parentKey || ""}" para ver que archivos existen.`;
  const error = new Error(`Archivo no encontrado: ${relativePath}.${hint} No inventes rutas; verifica con list_files o search_files.`);
  error.code = "ENOENT";
  return error;
}

function relativePathFromRoot(rootPath, targetPath) {
  const root = assertProjectRoot(rootPath);
  const rel = path.relative(root, targetPath).replace(/\\/g, "/");
  return !rel || rel === "." ? "" : rel;
}

const EDITCORE_AGENT_KNOWLEDGE_PACK = [
  "REGLAS ESTABLES DEL AGENTE EDITCORE (preceden a tus habitos generales):",
  "1. Jerarquia de conocimiento: (a) instruccion del usuario en este turno, (b) skill del Cerebro cargada, (c) memoria del proyecto (.editcore) y ROADMAP, (d) tu criterio general.",
  "2. Cerebro: UNA sola ronda brain_skill/brain_search al inicio y solo con NOMBRE EXACTO del inventario listado. Si la skill no existe, continua con disco; PROHIBIDO reintentar nombres inventados.",
  "3. Contexto de proyecto: la evidencia precargada (indice, memoria, corrida anterior) ya es valida; NO la re-verifiques con herramientas.",
  "4. Se directo y propositivo: responde al grano, toma posicion tecnica y cierra con la siguiente accion concreta.",
  "5. CO-CREACION: tu creas/analizas el proyecto CON el usuario. NO le pidas mas informacion que puedas obtener con list_files/read_file.",
  "6. Al cerrar un analisis o scaffold: di que FALTA para que el proyecto funcione (env, deps, scripts, stubs, Docker, workers) y el siguiente paso concreto.",
  "7. Si una skill define un procedimiento, ese procedimiento gana sobre tus habitos, pero nunca sobre la instruccion del usuario.",
  "8. ANALISIS SERIAL (como Cursor): 1 tool → avance visible en el chat → siguiente tool. PROHIBIDO saturar con 4+ lecturas o un PLAN de 8 archivos sin narrar entre medias.",
  "9. TOKENS / ROADMAP-FIRST: en CADA turno lee primero ROADMAP.md y .editcore/session-state.json (ya inyectados si existen). PROHIBIDO reexplorar el repo entero con list_files/glob. EditCore actualiza ROADMAP + session-state tras applyPatch; no uses ROADMAP como fuente de bugs.",
  "10. ARCHIVOS: puedes leer y crear cualquier path del proyecto (texto + PDF/DOCX/XLSX/CSV). Si falta un archivo, listalo o CREALO; NUNCA te detengas pidiendo que el usuario lo pegue.",
].join("\n");

function formatBrainAgentContext(inventory = {}, orchestratorContent = "") {
  const skills = Array.isArray(inventory.skills) ? inventory.skills : [];
  const installed = Array.isArray(inventory.installed) ? inventory.installed : [];
  const skillLines = skills.slice(0, 100).map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}`);
  const installedLines = installed.slice(0, 40).map((item) => `- ${item.name || item.id} (${item.type || "repo"}, ${item.status || "active"})`);
  return [
    EDITCORE_AGENT_KNOWLEDGE_PACK,
    orchestratorContent ? `SKILL ORQUESTADORA DEL CEREBRO (aplicar al inicio de cada tarea):\n${String(orchestratorContent).slice(0, 5000)}` : "",
    skillLines.length ? `SKILLS DEL CEREBRO (${skills.length} disponibles — usa brain_skill con el nombre exacto):\n${skillLines.join("\n")}` : "",
    installedLines.length ? `CAPACIDADES INSTALADAS EN EDITCORE:\n${installedLines.join("\n")}` : "",
    "PROTOCOLO CEREBRO: como mucho UNA ronda brain_skill o brain_search al inicio. Luego herramientas del proyecto. PROHIBIDO repetir brain_search en bucle.",
  ].filter(Boolean).join("\n\n");
}

function formatProjectBootstrapListing(rootPath, options = {}) {
  try {
    // Siempre inyectar ROADMAP como índice (ahorro tokens). En análisis: no usarlo como fuente de bugs.
    const ignoreRoadmap = options.ignoreRoadmap === true;
    const analysisMode = options.analysisMode === true;
    const roadmap = ignoreRoadmap ? { exists: false, content: "" } : readRoadmap(rootPath);
    const formatEntry = (entry) => `${entry.path}${entry.kind === "directory" ? "/" : ""}`;
    let sessionBlock = "";
    try {
      const { formatSessionMemoryOrFallback, ensureSessionState } = require("./runtime/session");
      ensureSessionState(rootPath, {
        task: String(options.task || "").slice(0, 220) || undefined,
      });
      sessionBlock = formatSessionMemoryOrFallback(rootPath);
    } catch {
      sessionBlock = "";
    }
    if (roadmap.exists && roadmap.content) {
      const rootEntries = listEntries(rootPath, "").slice(0, 24);
      return [
        "PUNTO DE PARTIDA: ROADMAP + session-state ya cargados. NO reexplores ni leas el proyecto entero.",
        analysisMode
          ? "MODO ANALISIS: ROADMAP es indice de tokens, NO fuente de bugs. Hallazgos solo desde codigo leido."
          : "MODO ACCION: read_file solo de archivos a editar. EditCore actualiza ROADMAP tras cada write.",
        `Raiz (nombres): ${rootEntries.map(formatEntry).join(", ")}`,
        formatRoadmapForPrompt(rootPath),
        sessionBlock,
        "PROHIBIDO list_files('.') / project_discovery / codebase_map del repo entero si el mapa cubre la tarea.",
      ].filter(Boolean).join("\n");
    }
    const rootEntries = listEntries(rootPath, "").slice(0, CURSOR_PARITY_LIMITS.bootstrapRootEntries);
    const srcPath = resolveInside(rootPath, "src");
    const srcEntries = fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()
      ? listEntries(rootPath, "src").slice(0, CURSOR_PARITY_LIMITS.bootstrapSrcEntries)
      : [];
    return [
      analysisMode
        ? "INDICE REAL DEL PROYECTO (analisis: hallazgos desde codigo; ROADMAP.md lo actualiza EditCore como indice):"
        : "INDICE REAL DEL PROYECTO (precargado; no uses read_file en la carpeta raiz ni en rutas absolutas):",
      `Raiz: ${rootEntries.map(formatEntry).join(", ")}`,
      srcEntries.length ? `src/: ${srcEntries.map(formatEntry).join(", ")}` : "",
      sessionBlock,
      analysisMode
        ? "No cites bugs desde ROADMAP.md. Analiza package.json + codigo (src/api/app). EditCore sincroniza ROADMAP.md mid-run y al cierre; TU no lo escribas en este turno."
        : "No hay ROADMAP.md. Analiza el disco (list_files + package.json/index.html). EditCore creara/actualizara ROADMAP.md. PROHIBIDO pedirlo al usuario.",
      "Usa read_file solo con rutas de ARCHIVO relativas (ej. package.json, src/app/page.tsx).",
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function readProjectFile(rootPath, relativePath) {
  const resolved = resolveReadableProjectFile(rootPath, relativePath);
  const target = resolved.target;
  if (!fs.existsSync(target)) throw buildReadFileNotFoundHint(rootPath, resolved.path || relativePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    const listPath = relativePathFromRoot(rootPath, target);
    throw new Error(`No es archivo: "${relativePath}" es una carpeta. Usa list_files con path "${listPath || ""}" o read_file con un archivo concreto (ej. package.json).`);
  }
  // Imagenes/binarios opacos (PDF/DOCX/XLSX se extraen en el handler async de read_file).
  if (/\.(png|jpe?g|webp|gif|ico|zip|rar|7z|exe|dll|bin|wasm|mp4|mp3|wav|woff2?|ttf|eot)$/i.test(target)) {
    return JSON.stringify({
      path: resolved.path,
      resolvedFrom: resolved.resolvedFrom || "",
      binary: true,
      size: stat.size,
      note: "Archivo binario/media. Continua con otras tools o create_*; NO te detengas pidiendo que el usuario lo pegue.",
    });
  }
  if (/\.(pdf|docx|xlsx|xls|xlsm)$/i.test(target)) {
    return JSON.stringify({
      path: resolved.path,
      resolvedFrom: resolved.resolvedFrom || "",
      binary: true,
      extractableDocument: true,
      size: stat.size,
      note: "Documento ofimatico: EditCore extraera texto automaticamente.",
    });
  }
  // Archivos grandes: no abortar; cabeza + aviso (usar startLine/endLine).
  if (stat.size > 600_000) {
    try {
      const text = fs.readFileSync(target, "utf8");
      const cap = 400_000;
      if (text.length > cap) {
        return `${text.slice(0, cap)}\n\n[EditCore: truncado (${stat.size} bytes). Usa read_file con startLine/endLine.]`;
      }
      return text;
    } catch {
      return JSON.stringify({
        path: resolved.path,
        binary: true,
        size: stat.size,
        note: "No se pudo leer como texto; prueba otra tool o create_*.",
      });
    }
  }
  return fs.readFileSync(target, "utf8");
}

function readProjectFileChunk(rootPath, input = {}) {
  const relativePath = String(input.path || "");
  const resolved = resolveReadableProjectFile(rootPath, relativePath);
  if (fs.existsSync(resolved.target) && fs.statSync(resolved.target).isDirectory()) {
    const listPath = relativePathFromRoot(rootPath, resolved.target);
    const entries = listEntries(rootPath, listPath);
    return {
      path: listPath || ".",
      isDirectory: true,
      resolvedFrom: resolved.resolvedFrom || relativePath,
      totalEntries: entries.length,
      note: "La ruta apunta a una carpeta. Elige un archivo de entries y llama read_file con su path relativo.",
      entries: entries.slice(0, 80),
    };
  }
  const text = readProjectFile(rootPath, resolved.path);
  if (text.startsWith("{\"path\"") && text.includes("\"binary\":true")) return JSON.parse(text);
  const lines = text.split(/\r?\n/);
  const startLine = Math.max(1, Number(input.startLine) || 1);
  const requestedEnd = Number(input.endLine) || (startLine + 299);
  const endLine = Math.min(lines.length, Math.max(startLine, requestedEnd), startLine + 499);
  return {
    path: resolved.path || relativePath,
    resolvedFrom: resolved.resolvedFrom || "",
    startLine,
    endLine,
    totalLines: lines.length,
    truncated: endLine < lines.length || startLine > 1,
    content: lines.slice(startLine - 1, endLine).join("\n"),
  };
}

function writeProjectFile(rootPath, relativePath, content) {
  const target = resolveInside(rootPath, relativePath);
  const backupRoot = projectBackupRoot(app.getPath("userData"), rootPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  let backupPath = "";
  const existed = fs.existsSync(target);
  if (existed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = relativePath.replace(/[\\/:"*?<>|]+/g, "__");
    backupPath = path.join(backupRoot, `${stamp}__${safeName}`);
    fs.copyFileSync(target, backupPath);
  }
  fs.writeFileSync(target, String(content || ""), "utf8");
  const result = {
    path: relativePath,
    bytes: Buffer.byteLength(String(content || ""), "utf8"),
    backupPath,
    created: !existed,
  };
  try {
    const { noteSuccessfulPatch } = require("./runtime/session-state");
    noteSuccessfulPatch(rootPath, {
      path: String(relativePath || "").replace(/\\/g, "/"),
      action: existed ? "write_file" : "write_file:create",
      summary: existed ? "archivo actualizado" : "archivo creado",
    });
  } catch {
    // El índice no debe bloquear escrituras.
  }
  return result;
}

function deleteProjectFile(rootPath, relativePath) {
  const target = resolveInside(rootPath, relativePath);
  if (!fs.existsSync(target)) throw new Error(`Archivo no encontrado: ${relativePath}`);
  const st = fs.statSync(target);
  if (st.isDirectory()) throw new Error("delete_file solo borra archivos, no carpetas.");
  const base = path.basename(relativePath);
  if (/^(package\.json|main\.js|\.env)$/i.test(base) || /^\.env\./i.test(base)) {
    throw new Error(`Borrado bloqueado por seguridad: ${relativePath}`);
  }
  const backupRoot = projectBackupRoot(app.getPath("userData"), rootPath);
  fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = relativePath.replace(/[\\/:"*?<>|]+/g, "__");
  const backupPath = path.join(backupRoot, `${stamp}__deleted__${safeName}`);
  fs.copyFileSync(target, backupPath);
  fs.unlinkSync(target);
  return { path: relativePath, deleted: true, backupPath, created: false };
}

function emitProjectFilesChanged(event, projectRoot, toolName, toolInput = {}, toolResult = {}) {
  if (!event?.sender || event.sender.isDestroyed()) return;
  if (!["write_file", "replace_in_file", "delete_file", "create_project", "apply_diff"].includes(String(toolName || ""))) return;
  const payload = filesChangedPayload({
    name: toolName,
    input: toolInput,
    result: toolResult,
  }, projectRoot);
  event.sender.send("project:files-changed", payload);
}

async function createProjectInside(rootPath, input = {}, options = {}) {
  const name = String(input.name || "").trim();
  const parentRel = String(input.path || input.parent || "").trim();
  const { resolveTemplateIntent } = require("./runtime/template-intent");
  const intent = resolveTemplateIntent(input.prompt || input.brief || options.prompt || "", {
    template: input.template,
  });
  const templateId = intent.id || "blank";
  const parent = resolveInside(rootPath, parentRel || ".");
  fs.mkdirSync(parent, { recursive: true });
  const targetRoot = resolveInside(rootPath, path.join(parentRel, name));
  const root = resolveInside(rootPath, ".");
  const relativeTarget = path.relative(root, targetRoot);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) throw new Error("Ruta de proyecto invalida.");
  const created = await projectScaffoldService.create({
    name,
    template: templateId,
    parentPath: parent,
    install: input.install !== false && templateId !== "blank",
  }, options);
  try {
    const { writeScaffoldState } = require("./runtime/scaffold-state");
    const absTarget = created.root || targetRoot;
    writeScaffoldState(absTarget, {
      template: created.template || templateId,
      stage: input.install === false || templateId === "blank" ? "files" : "install",
      incomplete: true,
      note: "create_project",
      files: Array.isArray(created.report?.files) ? created.report.files : [],
    });
  } catch {
    /* scaffold state is best-effort */
  }
  return {
    path: relativeTarget,
    name,
    template: created.template || templateId,
    templateIntent: intent,
    report: created.report,
  };
}

function walkFiles(rootPath, relativePath = "", max = CURSOR_PARITY_LIMITS.walkFiles) {
  const rows = [];
  const stack = [relativePath];
  while (stack.length && rows.length < max) {
    const current = stack.pop();
    for (const entry of listEntries(rootPath, current)) {
      if (entry.kind === "directory") {
        if (!GENERATED_PROJECT_DIRS.has(entry.name.toLowerCase())) stack.push(entry.path);
      }
      else rows.push(entry.path);
      if (rows.length >= max) break;
    }
  }
  return rows;
}

function searchProject(rootPath, query) {
  const raw = String(query || "");
  const hits = searchProjectLiteral(rootPath, raw);
  if (hits.length) return hits;
  // La busqueda es literal: si el modelo mando escapes de regex ("lovable\.dev")
  // y no hubo resultados, reintenta sin escapes para no inducir bucles de
  // busquedas repetidas con 0 coincidencias.
  if (/\\[.*+?()\[\]{}|^$\\]/.test(raw)) {
    const unescaped = raw.replace(/\\([.*+?()\[\]{}|^$\\])/g, "$1");
    if (unescaped !== raw) return searchProjectLiteral(rootPath, unescaped);
  }
  return hits;
}

function searchProjectLiteral(rootPath, query) {
  const needle = String(query || "").toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const file of walkFiles(rootPath, "", Math.min(CURSOR_PARITY_LIMITS.searchFiles, 2500))) {
    if (!/\.(js|ts|jsx|tsx|json|css|html|md|txt|py|php|java|cs|go|rs)$/i.test(file)) continue;
    let text = "";
    try { text = readProjectFile(rootPath, file); } catch { continue; }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle) && hits.length < 80) {
        hits.push({ path: file, line: index + 1, text: line.trim().slice(0, 240) });
      }
    });
    if (hits.length >= 80) break;
  }
  return hits;
}

// En Windows los CLIs instalados via npm (vercel, supabase, yarn, tsc, eslint)
// son shims .cmd que execFile no resuelve solo; se sondea PATH/PATHEXT para
// encontrar el binario real sin habilitar un shell.
const windowsExecutableCache = new Map();
function resolveWindowsExecutable(name, { env = process.env, fileExists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } } } = {}) {
  if (process.platform !== "win32") return name;
  const key = String(name || "").toLowerCase();
  if (windowsExecutableCache.has(key)) return windowsExecutableCache.get(key);
  const extensions = String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const directories = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  let resolved = name;
  outer: for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
      if (fileExists(candidate)) { resolved = candidate; break outer; }
      const upper = path.join(directory, `${name}${extension}`);
      if (upper !== candidate && fileExists(upper)) { resolved = upper; break outer; }
    }
  }
  windowsExecutableCache.set(key, resolved);
  return resolved;
}

function spawnCommandOutput({ executable, args, cwd, signal, timeoutMs = 120_000, shell = false }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "Comando cancelado.")));
      return;
    }
    const child = spawn(String(executable || ""), Array.isArray(args) ? args : [], {
      cwd,
      shell: shell === true,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      handler(value);
    };
    const onAbort = () => {
      try { child.kill(); } catch {}
      finish(reject, new Error("Comando cancelado."));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      try { child.kill(); } catch {}
      const error = new Error(`La herramienta run_command excedio ${timeoutMs} ms.`);
      error.code = "ETIMEDOUT";
      finish(reject, error);
    }, timeoutMs) : null;
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
      if (code !== 0) {
        const error = new Error(`Command failed: ${executable} ${args.join(" ")} (code ${code})`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        finish(reject, error);
        return;
      }
      finish(resolve, output);
    });
  });
}

function isDiagnosticProjectCommand(command = "") {
  const value = String(command || "").trim();
  if (!value) return false;
  if (/\bnpm\s+(?:run\s+)?(?:lint|test|test:unit|build|check|typecheck|verify)\b/i.test(value)) return true;
  if (/\b(?:pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|test|build|check|typecheck|verify)\b/i.test(value)) return true;
  if (/\b(?:npx\s+)?(?:eslint|tsc|vitest|jest|prettier)\b/i.test(value)) return true;
  if (/\bnode\s+--(?:test|check)\b/i.test(value)) return true;
  return false;
}

function formatDiagnosticCommandResult(command, error) {
  const code = Number.isFinite(Number(error?.code)) ? Number(error.code) : 1;
  const stdout = String(error?.stdout || "").trim();
  const stderr = String(error?.stderr || "").trim();
  const body = [stderr, stdout].filter(Boolean).join("\n").trim() || String(error?.message || "sin salida");
  const output = [
    `Comando de verificacion finalizado con exit ${code}.`,
    `Comando: ${String(command || "").trim()}`,
    "Esto NO es un fallo de la herramienta run_command: la salida es evidencia para corregir el proyecto.",
    `Resultado de verificacion: ${code === 0 ? "PASO" : "FALLO"}.`,
    body.slice(0, 12000),
  ].join("\n");
  // Objeto tipado: la herramienta OK (toolOk), pero la verificacion solo pasa con exit 0.
  return {
    diagnostic: true,
    toolOk: true,
    passed: code === 0,
    exitCode: code,
    output,
    summary: output.slice(0, 500),
  };
}

async function runProjectCommand(rootPath, command, accessMode = "step", signal, relativeCwd = "") {
  const cwd = resolveInside(rootPath, String(relativeCwd || "."));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Directorio de trabajo no encontrado: ${relativeCwd || "."}`);
  let parsed;
  try {
    parsed = accessMode === "full"
      ? parseFullAccessCommand(command)
      : accessMode === "analysis"
        ? parseAnalysisCommand(command)
        : parseSafeCommand(command);
  } catch (error) {
    const detail = ` ${error?.message || error} Comando recibido: "${String(command || "")}". Ejecutable detectado: "${String(command || "").trim().split(/\s+/, 1)[0] || ""}". Modo: ${accessMode}. Directorio: "${relativeCwd || "."}".`;
    throw new Error(detail);
  }
  const rtkPath = bundledRtkPath();
  const useRtk = !rtkRuntimeBroken && Boolean(rtkPath) && isRtkCompatibleCommand(parsed);
  const timeoutMs = commandTimeoutMs(parsed);
  if (parsed.shell) {
    return spawnCommandOutput({
      executable: parsed.executable,
      args: parsed.args,
      cwd,
      signal,
      timeoutMs,
      shell: false,
    });
  }
  if (process.platform === "win32" && shouldRunWithShell(parsed.executable)) {
    return spawnCommandOutput({
      executable: parsed.executable,
      args: parsed.args,
      cwd,
      signal,
      timeoutMs,
      shell: true,
    });
  }
  const runOnce = async (exe, args) => spawnCommandOutput({
    executable: exe,
    args,
    cwd,
    signal,
    timeoutMs,
    shell: false,
  });
  try {
    if (useRtk && rtkPath) {
      try {
        return await runOnce(rtkPath, [parsed.executable, ...parsed.args]);
      } catch (rtkError) {
        const rtkDetail = `${rtkError?.message || ""} ${rtkError?.stderr || ""} ${rtkError?.stdout || ""}`;
        if (/no hook installed|rtk init|\[rtk\]|EINVAL|ENOENT|UNKNOWN/i.test(rtkDetail)) {
          rtkRuntimeBroken = true;
          logStartup(`rtk deshabilitado en esta sesion: ${String(rtkDetail).slice(0, 200)}`);
          return await runOnce(parsed.executable, parsed.args);
        }
        throw rtkError;
      }
    }
    return await runOnce(parsed.executable, parsed.args);
  } catch (error) {
    if (isDiagnosticProjectCommand(command) && (error?.stdout || error?.stderr || Number.isFinite(Number(error?.code)))) {
      return formatDiagnosticCommandResult(command, error);
    }
    if (isWindowsPackageManager(parsed.executable) && parsed.args[0] === "audit" && (error.stdout || error.stderr)) {
      return `${error.stdout || ""}${error.stderr ? `\n${error.stderr}` : ""}`.trim();
    }
    if (parsed?.executable === "git") {
      const combined = `${error?.stderr || ""} ${error?.stdout || ""} ${error?.message || ""}`;
      if (Number(error?.code) === 128 || /fatal:\s*not a git repository|no es un repositorio git/i.test(combined)) {
        return "Git no inicializado en este proyecto (normal en carpetas nuevas). Ejecuta `git init` si quieres control de versiones.";
      }
    }
    const detailBase = `${error?.message || error} Comando: "${String(command || "")}". Directorio: "${relativeCwd || "."}".`;
    const stderrTail = String(error?.stderr || "").trim().slice(-4000);
    const stdoutTail = String(error?.stdout || "").trim().slice(-2000);
    const detail = [
      detailBase,
      stderrTail ? `STDERR:\n${stderrTail}` : "",
      !stderrTail && stdoutTail ? `STDOUT:\n${stdoutTail}` : "",
    ].filter(Boolean).join("\n");
    const enriched = new Error(detail);
    enriched.cause = error;
    enriched.code = error?.code;
    enriched.stdout = error?.stdout;
    enriched.stderr = error?.stderr;
    throw enriched;
  }
}
let rtkRuntimeBroken = false;

function bundledRtkPath() {
  const candidates = [
    path.join(__dirname, "resources", "rtk", process.platform === "win32" ? "rtk.exe" : "rtk"),
    path.join(process.resourcesPath || "", "rtk", process.platform === "win32" ? "rtk.exe" : "rtk"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function isRtkCompatibleCommand(parsed) {
  const executable = String(parsed?.executable || "").toLowerCase();
  return new Set(["git", "npm", "npx", "pnpm", "cargo", "pytest", "vitest", "jest", "tsc", "prettier", "docker", "kubectl", "curl", "wget"]).has(executable);
}

function isAuthOrUpstreamFailure(error) {
  try {
    const { isHardProviderFailure } = require("./runtime/chat-error-sanitize");
    const message = String(error?.message || error || "");
    // Auth/billing sí; timeouts temporales NO (deben reintentarse).
    return isHardProviderFailure(message, error?.status);
  } catch {
    const message = String(error?.message || error || "");
    return /401|403|无效|令牌|invalid.?token|inv[aá]lid.?token|forbidden/i.test(message)
      && !/no est[aá] disponible|tard[oó] demasiado|reintenta en/i.test(message);
  }
}

function isTransientProviderError(error) {
  try {
    const { isTransientProviderFailure, isHardProviderFailure } = require("./runtime/chat-error-sanitize");
    const message = String(error?.message || error || "");
    if (isHardProviderFailure(message, error?.status)) return false;
    if (error?.code === "PROVIDER_GATEWAY_TIMEOUT" || Number(error?.status) === 524) return true;
    return isTransientProviderFailure(message, error?.status)
      || isRetryableProviderStatus(error?.status)
      || /timeout|timed out|network|fetch failed|socket|temporarily|temporalmente|unavailable|overloaded|rate limit|try again|reintenta|gateway time-?out|cloudflare|524/i.test(message);
  } catch {
    if (error?.code === "PROVIDER_GATEWAY_TIMEOUT" || Number(error?.status) === 524) return true;
    const message = String(error?.message || error || "");
    return isRetryableProviderStatus(error?.status)
      || /timeout|timed out|network|fetch failed|socket|temporarily|temporalmente|unavailable|overloaded|rate limit|try again|reintenta|gateway time-?out|cloudflare|524|no est[aá] disponible|tard[oó] demasiado|503|502/i.test(message);
  }
}

function toUserFacingProviderError(error) {
  if (!error) return error;
  try {
    const { sanitizeChatProviderError } = require("./runtime/chat-error-sanitize");
    const msg = sanitizeChatProviderError(error);
    return Object.assign(new Error(msg), {
      status: Number(error.status) || 0,
      code: error.code || (isTransientProviderError(error) ? "PROVIDER_TRANSIENT" : "PROVIDER_ERROR"),
      detail: String(error.message || "").slice(0, 240),
    });
  } catch {
    if (error?.code === "PROVIDER_GATEWAY_TIMEOUT" || Number(error?.status) === 524) {
      const msg = "La respuesta tardó demasiado tiempo. Intenta reducir el alcance de la solicitud.";
      return Object.assign(new Error(msg), {
        status: Number(error.status) || 524,
        code: "PROVIDER_GATEWAY_TIMEOUT",
        detail: error.detail || error.message,
      });
    }
    const message = String(error?.message || error || "");
    if (/gafcore/i.test(message) || /<!DOCTYPE\s+html|<html[\s>]|cloudflare|error code 524|gateway time-?out|API 524/i.test(message)) {
      const msg = "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";
      return Object.assign(new Error(msg), {
        status: Number(error?.status) || 524,
        code: "PROVIDER_GATEWAY_TIMEOUT",
        detail: message.slice(0, 240),
      });
    }
    return error;
  }
}

function logPreviewRuntime(message, error = null) {
  try {
    const detail = error ? ` ${error?.stack || error?.message || error}` : "";
    fs.appendFileSync(path.join(app.getPath("userData"), "preview-runtime.log"), `[${new Date().toISOString()}] ${message}${detail}\n`, "utf8");
  } catch {}
}


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
  // FIX B: AUTO-HEAL DESACTIVADO POR DEFECTO. El loop preview-issue -> autoHeal
// -> handleChatKernel -> dev-server -> preview-issue arrancaba corridas en
// paralelo con la principal y dejaba el chat 'Trabajando...' para siempre.
// Reactivar con EDITCORE_ENABLE_AUTOHEAL=1 cuando se redisenne el debounce.
if (
  payload?.type === "preview-issue"
  && payload.autoHeal
  && payload.issue
  && process.env.EDITCORE_ENABLE_AUTOHEAL === "1"
) {
  maybeAutoHealPreview(projectRoot, payload.issue).catch(() => {});
}
}

/** Hooks de streaming para run_command del kernel (process-runner). */
function buildKernelProcessHooks(projectRoot) {
  const root = String(projectRoot || "");
  return {
    onProcessChunk: (ev) => {
      if (!root) return;
      emitPreviewDaemonEvent(root, {
        type: "process-log",
        stream: ev?.stream || "stdout",
        chunk: String(ev?.chunk || "").slice(-2000),
        command: ev?.command || "",
        at: Date.now(),
      });
    },
    onProcessSevereError: (issue) => {
      if (!root) return;
      const nextServerEnoent = issue?.nextServerEnoent === true
        || issue?.healStrategy === "next-cache-rebuild"
        || /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i.test(`${issue?.summary || ""}\n${issue?.excerpt || ""}`);
      emitPreviewDaemonEvent(root, {
        type: "preview-issue",
        issue: {
          kind: issue?.kind || "compile",
          summary: issue?.summary || "Error grave en comando",
          excerpt: issue?.excerpt || "",
          nextServerEnoent,
          skipRetryRead: nextServerEnoent || issue?.skipRetryRead === true,
          healStrategy: nextServerEnoent ? "next-cache-rebuild" : (issue?.healStrategy || "generic"),
        },
        command: issue?.command || "",
        at: issue?.at || Date.now(),
        autoHeal: true,
        wakeVerifier: true,
      });
    },
  };
}

function resolveKernelProviderCredentials() {
  const secure = typeof readSecureState === "function" ? readSecureState() : {};
  const chat = secure["editcore-chat-config"] || {};
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const profile = profiles.find((p) => p?.id && p.id === chat.providerProfileId)
    || profiles.find((p) => ["active", "enabled"].includes(String(p?.status || "").toLowerCase()) && p?.model)
    || null;
  const provider = providers?.[profile?.providerKey || chat.providerKey] || {};
  const apiKey = String(chat.apiKey || profile?.apiKey || provider.apiKey || "").trim();
  const model = String(chat.model || profile?.model || "").trim();
  const providerKey = String(chat.providerKey || profile?.providerKey || "").trim();
  const baseUrl = normalizeBaseUrl(
    chat.baseUrl || profile?.baseUrl || provider.baseUrl || "",
    providerKey,
  );
  return { apiKey, model, baseUrl, providerKey };
}

async function maybeAutoHealPreview(projectRoot, issue) {
  const key = String(projectRoot || "");
  if (!key || previewAutoHealInFlight.get(key)) return;
  previewAutoHealInFlight.set(key, true);
  try {
    const { isNextServerEnoentError, autoHealNextProject } = require("./runtime/inspector-local-heal");
    const excerpt = `${issue?.summary || ""}\n${issue?.excerpt || ""}`;
    const nextCacheHeal = issue?.healStrategy === "next-cache-rebuild"
      || issue?.nextServerEnoent === true
      || isNextServerEnoentError(excerpt);

    // ENOENT en .next/server: no reintentar lectura ni depender de API — heal local inmediato.
    if (nextCacheHeal) {
      emitPreviewDaemonEvent(projectRoot, {
        type: "preview-heal-start",
        issue,
        strategy: "next-cache-rebuild",
      });
      const heal = await autoHealNextProject(projectRoot, {
        rebuild: true,
        force: true,
        errorText: excerpt,
        command: "npx next build",
        onProgress: (p) => {
          emitPreviewDaemonEvent(projectRoot, {
            type: "preview-heal-progress",
            phase: "subagent",
            name: "auto-heal",
            text: p?.uiMessage || p?.label || "",
            ...(p && typeof p === "object" ? p : {}),
          });
        },
      });
      emitPreviewDaemonEvent(projectRoot, {
        type: "preview-heal-done",
        text: heal?.uiMessage || (heal?.ok
          ? "Caché de Next.js regenerada exitosamente"
          : "Autorreparación de .next incompleta"),
        kind: "local-next-heal",
        ok: heal?.ok === true,
        snapshotId: heal?.snapshotId || null,
      });
      if (heal?.ok) {
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            const url = previewProcesses.get(projectRoot)?.url;
            if (url && !win.isDestroyed()) {
              win.webContents.send("project:preview-updated", {
                projectRoot,
                url,
                reason: "auto-heal",
                message: "Caché de Next.js regenerada exitosamente",
              });
            }
          } catch { /* ignore */ }
        }
      }
      return;
    }

    const { apiKey, model, baseUrl } = resolveKernelProviderCredentials();
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
      ...buildKernelProcessHooks(projectRoot),
    });
    const out = await handleChatKernel({
      message: `Auto-heal preview: ${issue.summary}`,
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

async function startProjectPreview(rootPath, ownerId) {
  const safeRoot = assertProjectRoot(rootPath);
  const pendingStart = previewStartPromises.get(safeRoot);
  if (pendingStart) {
    const result = await pendingStart;
    previewProcesses.get(safeRoot)?.owners.add(ownerId);
    return { ...result, started: false };
  }
  const start = startProjectPreviewNow(safeRoot, ownerId);
  previewStartPromises.set(safeRoot, start);
  try {
    return await start;
  } finally {
    if (previewStartPromises.get(safeRoot) === start) previewStartPromises.delete(safeRoot);
  }
}

async function startProjectPreviewNow(safeRoot, ownerId) {
  const rootNorm = String(safeRoot || "").replace(/[\\/]+$/, "").toLowerCase();
  if (/[\\/]editcoreai$/.test(rootNorm) || rootNorm.endsWith("editcoreai")) {
    return {
      available: false,
      url: "",
      message: "EditCoreAI es una app de escritorio. El panel Web no aplica a este proyecto.",
    };
  }
  const runtimeRoot = findRunnableProjectRoot(safeRoot);
  const packagePath = runtimeRoot ? path.join(runtimeRoot, "package.json") : "";
  if (!fs.existsSync(packagePath)) return { available: false, url: "", message: "Este directorio no contiene una aplicacion ejecutable (falta package.json)." };
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")); } catch { throw new Error("package.json invalido."); }
  if (!pkg?.scripts?.dev && !pkg?.scripts?.start) return { available: false, url: "", message: "El proyecto no define un script dev o start." };

  // Preflight: si .next esta corrupto (routes-manifest / server), regenerar antes de abrir preview.
  try {
    const { detectNextCacheCorruption, autoHealNextProject } = require("./runtime/inspector-local-heal");
    const detection = detectNextCacheCorruption(runtimeRoot);
    if (detection.isNext && detection.issues.some((issue) => issue.autoHeal || /ENOENT/i.test(issue.code || ""))) {
      emitPreviewDaemonEvent(safeRoot, {
        type: "preview-heal-start",
        issue: { summary: detection.issues[0]?.summary || "Caché .next corrupta", healStrategy: "next-cache-rebuild" },
      });
      const heal = await autoHealNextProject(runtimeRoot, {
        rebuild: true,
        force: true,
        errorText: detection.issues.map((i) => i.summary).join("; "),
        command: "npx next build",
        onProgress: (p) => emitPreviewDaemonEvent(safeRoot, {
          type: "preview-heal-progress",
          phase: "subagent",
          name: "auto-heal",
          text: p?.uiMessage || p?.label || "",
        }),
      });
      emitPreviewDaemonEvent(safeRoot, {
        type: "preview-heal-done",
        ok: heal?.ok === true,
        text: heal?.uiMessage || (heal?.ok ? "Caché de Next.js regenerada exitosamente" : "Heal incompleto"),
        kind: "local-next-heal",
      });
    }
  } catch (error) {
    logPreviewRuntime(`preflight heal fallo: ${String(error?.message || error).slice(0, 200)}`);
  }

  const currentFingerprint = previewRuntimeFingerprint(safeRoot, runtimeRoot);
  const existing = previewProcesses.get(safeRoot);
  if (existing?.remote && existing.url) {
    if (await isHttpReady(existing.url)) {
      existing.owners.add(ownerId);
      return { available: true, started: false, remote: true, pid: 0, script: existing.script, url: existing.url, runtimeRoot };
    }
    previewProcesses.delete(safeRoot);
  }
  if (existing?.child && existing.child.exitCode === null && existing.url
    && path.resolve(existing.runtimeRoot || "") === path.resolve(runtimeRoot)
    && existing.fingerprint === currentFingerprint) {
    existing.owners.add(ownerId);
    await waitForHttp(existing.url, existing.child);
    return { available: true, started: false, pid: existing.child.pid, script: existing.script, url: existing.url };
  } else if (existing?.child && existing.child.exitCode === null) {
    if (existing.fingerprint && existing.fingerprint !== currentFingerprint) {
      logPreviewRuntime(`Configuracion de preview modificada; reiniciando ${safeRoot}`);
    }
    stopPreviewRuntime(existing);
    previewProcesses.delete(safeRoot);
  }
  const manager = fs.existsSync(path.join(runtimeRoot, "bun.lockb")) || fs.existsSync(path.join(runtimeRoot, "bun.lock")) ? "bun" : fs.existsSync(path.join(runtimeRoot, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  // FIX C: pasar onProgress para ver las lineas de npm install en el panel Terminal.
const dependencyReport = await ensureProjectDependencies(runtimeRoot, pkg, manager, {
  onProgress: (ev) => {
    try {
      emitPreviewDaemonEvent(safeRoot, {
        type: "preview-deps-progress",
        phase: String(ev?.phase || "deps"),
        line: String(ev?.line || "").slice(0, 500),
        at: Date.now(),
      });
    } catch { /* ignore UI */ }
  },
});
  const script = pkg.scripts.dev ? "dev" : "start";
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const expectedPort = dependencies["@lovable.dev/vite-tanstack-config"] ? 8080
    : fs.readdirSync(runtimeRoot).some((name) => /^next\.config\./i.test(name)) ? 3000
      : fs.readdirSync(runtimeRoot).some((name) => /^astro\.config\./i.test(name)) ? 4321
        : fs.existsSync(path.join(runtimeRoot, "angular.json")) ? 4200 : 5173;
  // Puerto propio por proyecto. Nunca reutilizar HTTP ajeno en 3000/5173/etc.
  let assignedPort = expectedPort;
  if (!(await portIsFree(expectedPort))) {
    assignedPort = await findAvailablePort(stablePreviewPort(safeRoot), 1800);
  }
  const previewUrl = "http://127.0.0.1:" + assignedPort;
  // A verified Next build is more reliable than a Vinext/Vite dev server for
  // projects whose dev toolchain is incompatible with the bundled Node runtime.
  const direct = builtNextPreviewLaunch(pkg, runtimeRoot, assignedPort)
    || directPreviewLaunch(pkg, script, runtimeRoot, assignedPort);
  const staticFallbackRoot = [
    path.join(runtimeRoot, "dist", "client"),
    path.join(runtimeRoot, "dist"),
    path.join(runtimeRoot, "build"),
    path.join(runtimeRoot, "out"),
  ].find((candidate) => fs.existsSync(path.join(candidate, "index.html")));
  const deploymentFallbackUrl = inferDeploymentPreviewUrl(runtimeRoot);
  const child = direct?.executable
    ? spawn(direct.executable, direct.args, { cwd: runtimeRoot, windowsHide: true, detached: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...readProjectPreviewEnv(safeRoot, runtimeRoot), ...(direct?.env || {}), PORT: String(assignedPort), HOST: "127.0.0.1", BROWSER: "none", FORCE_COLOR: "0" } })
    : spawn(manager, ["run", script], { cwd: runtimeRoot, shell: true, windowsHide: true, detached: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...readProjectPreviewEnv(safeRoot, runtimeRoot), PORT: String(assignedPort), HOST: "127.0.0.1", BROWSER: "none", FORCE_COLOR: "0" } });
  const runtime = { child, script: direct?.label || manager + " run " + script, url: "", runtimeRoot, fingerprint: previewRuntimeFingerprint(safeRoot, runtimeRoot), dependencyReport, owners: new Set([ownerId]) };
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
  const outputRef = { value: "" };
  try {
    const startupTimeout = direct?.direct ? PREVIEW_START_TIMEOUT_MS
      : staticFallbackRoot || deploymentFallbackUrl ? 45_000 : PREVIEW_START_TIMEOUT_MS;
    // Siempre detectar URL real del proceso (vite/next pueden publicar otro puerto)
    // y también sondear el puerto asignado.
    runtime.url = await detectListeningUrl(child, previewUrl, startupTimeout, outputRef);
    logPreviewRuntime(`Preview listo ${safeRoot} → ${runtime.url}`);
    return { available: true, started: true, pid: child.pid, script: runtime.script, url: runtime.url, runtimeRoot, dependencyReport };
  } catch (error) {
    stopPreviewRuntime(runtime);
    if (previewProcesses.get(safeRoot) === runtime) previewProcesses.delete(safeRoot);
    const staticRoot = staticFallbackRoot;
    if (!staticRoot) {
      const remoteUrl = inferDeploymentPreviewUrl(runtimeRoot);
      if (!remoteUrl) throw error;
      const remoteRuntime = {
        child: null,
        script: "vista previa remota del despliegue del proyecto",
        url: remoteUrl,
        runtimeRoot,
        owners: new Set([ownerId]),
        remote: true,
        fallback: true,
        fallbackReason: String(error?.message || error).slice(0, 400),
      };
      previewProcesses.set(safeRoot, remoteRuntime);
      return { available: true, started: false, remote: true, fallback: true, pid: 0, script: remoteRuntime.script, url: remoteUrl, runtimeRoot, fallbackReason: remoteRuntime.fallbackReason };
    }

    const staticPort = await findAvailablePort(expectedPort);
    const staticUrl = "http://127.0.0.1:" + staticPort;
    const launch = staticPreviewLaunch(staticRoot, staticPort, process.execPath, path.join(__dirname, "static-preview-server.js"));
    if (!launch) throw error;
    const staticChild = spawn(launch.executable, launch.args, {
      cwd: staticRoot,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...launch.env },
    });
    const fallbackRuntime = {
      child: staticChild,
      script: "vista previa estatica del build generado",
      url: "",
      runtimeRoot: staticRoot,
      dependencyReport,
      owners: new Set([ownerId]),
      fallback: true,
      fallbackReason: String(error?.message || error).slice(0, 400),
    };
    previewProcesses.set(safeRoot, fallbackRuntime);
    staticChild.once("exit", () => { if (previewProcesses.get(safeRoot)?.child === staticChild) previewProcesses.delete(safeRoot); });
    staticChild.once("error", () => { if (previewProcesses.get(safeRoot)?.child === staticChild) previewProcesses.delete(safeRoot); });
    try {
      fallbackRuntime.url = await detectListeningUrl(staticChild, staticUrl);
      return {
        available: true,
        started: true,
        pid: staticChild.pid,
        script: fallbackRuntime.script,
        url: fallbackRuntime.url,
        runtimeRoot: staticRoot,
        dependencyReport,
        fallback: true,
        fallbackReason: fallbackRuntime.fallbackReason,
      };
    } catch (fallbackError) {
      stopPreviewRuntime(fallbackRuntime);
      if (previewProcesses.get(safeRoot) === fallbackRuntime) previewProcesses.delete(safeRoot);
      throw new Error(`${String(error?.message || error).slice(0, 300)}; la vista previa estatica tambien fallo: ${String(fallbackError?.message || fallbackError).slice(0, 300)}`);
    }
  }
}

function portIsFreeOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function portIsFree(port) {
  // The preview is bound explicitly to IPv4. A socket probe is enough and
  // avoids waiting on several HTTP timeouts for every occupied port.
  return portIsFreeOnHost(port, "127.0.0.1");
}

async function findAvailablePort(preferred, span = 100) {
  for (let port = preferred; port < preferred + span; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No hay puertos libres en el rango dedicado del proyecto (${preferred}-${preferred + span - 1}).`);
}

async function isHttpReady(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(3500),
      headers: { Accept: "text/html,application/xhtml+xml,*/*" },
    });
    const ct = String(response.headers.get("content-type") || "").trim();
    // 5xx HTML = proceso escuchando pero app rota (.next corrupto). Contar como up
    // para no reiniciar en bucle; el heal/UI diagnostican el 500.
    if (response.status >= 500) {
      return !ct || isPreviewDocumentContentType(ct) || /html|xhtml|xml/i.test(ct);
    }
    if (!response.ok) return false;
    // Vite/Next a veces omiten content-type en el primer hit; aceptar 2xx vacío.
    if (!ct) return true;
    if (isPreviewDocumentContentType(ct)) return true;
    // Evitar dar por bueno un JSON de API / texto plano de error.
    if (/(?:^|;)\s*(?:application\/json|text\/plain)\b/i.test(ct)) return false;
    return /html|xhtml|xml/i.test(ct);
  } catch { return false; }
}

async function waitForHttp(url, child, timeoutMs = PREVIEW_START_TIMEOUT_MS, outputRef = null) {
  const attempts = Math.ceil(Math.max(1_000, Number(timeoutMs) || PREVIEW_START_TIMEOUT_MS) / 500);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode !== null) {
      const tail = String(outputRef?.value || "").trim().slice(-600);
      throw new Error(tail
        ? `El servidor de desarrollo termino antes de abrir.\n${tail}`
        : "El servidor de desarrollo termino antes de abrir.");
    }
    if (await isHttpReady(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const tail = String(outputRef?.value || "").trim().slice(-600);
  throw new Error(tail
    ? `El servidor no respondio en ${url}.\n${tail}`
    : `El servidor no respondio en ${url}.`);
}

async function detectListeningUrl(child, fallbackUrl, timeoutMs = PREVIEW_START_TIMEOUT_MS, outputRef = null) {
  let output = "";
  const onData = (chunk) => {
    const text = String(chunk || "").replace(/\x1b\[[0-9;]*m/g, "");
    output += text;
    if (outputRef) outputRef.value = output;
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const attempts = Math.ceil(Math.max(1_000, Number(timeoutMs) || PREVIEW_START_TIMEOUT_MS) / 500);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode !== null) {
      if (/EADDRINUSE|address already in use/i.test(output)) {
        throw new Error("El puerto solicitado por el proyecto estaba ocupado. EditCoreAI intentara otro puerto al actualizar el navegador.");
      }
      const tail = output.trim().slice(-800);
      throw new Error(tail
        ? `El servidor del proyecto termino antes de publicar una URL.\n${tail}`
        : "El servidor del proyecto termino antes de publicar una URL. Revisa su script de desarrollo.");
    }
    const matches = [...output.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s"'<>]*/gi)];
    for (const match of matches.reverse()) {
      try {
        const url = normalizePreviewUrl(match[0].replace(/[.,;)]+$/, ""));
        if (await isHttpReady(url)) return url;
      } catch { /* ignore bad match */ }
    }
    if (await isHttpReady(fallbackUrl)) return fallbackUrl;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const tail = output.trim().slice(-800);
  throw new Error(tail
    ? `El servidor del proyecto no publico una pagina disponible.\n${tail}`
    : "El servidor del proyecto no publico una pagina disponible dentro del tiempo esperado.");
}

// Brain context is provided by EditCoreBrainService.assembleContext().

function parseAgentJson(text) {
  return parseAgentPayload(text);
}

// Vision-capable model patterns for image_url filtering
const VISION_MODEL_PATTERN = VISION_INTAKE_PATTERN;

function messagesHaveImages(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((msg) =>
    Array.isArray(msg?.content) && msg.content.some((part) => part?.type === "image_url" || part?.type === "image")
  );
}

function sanitizeMessagesForModel(messages, model) {
  const hasImages = messagesHaveImages(messages);
  if (!hasImages) return messages;
  if (modelSupportsVision(model)) return messages;
  // Keep images when possible; callProvider should have auto-routed already.
  // Only strip as last resort if the active model still cannot accept vision.
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const hasImg = msg.content.some((part) => part?.type === "image_url" || part?.type === "image");
    if (!hasImg) return msg;
    const textParts = msg.content.filter((part) => part?.type === "text");
    const imgCount = msg.content.filter((part) => part?.type === "image_url" || part?.type === "image").length;
    return {
      ...msg,
      content: [
        ...textParts,
        { type: "text", text: `[${imgCount} imagen(es) adjunta(s) — el modelo activo no soporta visión y no hubo candidato multimodal disponible.]` },
      ],
    };
  });
}

// ── Registro persistente de capacidades por modelo ─────────────────────────
// Cada llamada real (exito o fallo) y cada verificacion alimentan este
// registro; el fallback automatico elige solo modelos con exito reciente.
function modelCapabilitiesPath() {
  return path.join(app.getPath("userData"), "model-capabilities.json");
}

function loadModelCapabilities() {
  try { return JSON.parse(fs.readFileSync(modelCapabilitiesPath(), "utf8")); } catch { return {}; }
}

function modelCapabilityKey({ baseUrl = "", model = "" } = {}) {
  let host = String(baseUrl || "");
  try { host = new URL(String(baseUrl)).hostname; } catch {}
  return `${host}|${String(model || "")}`.toLowerCase();
}

const SLOW_MODEL_MS = 90_000;

function recordModelCapability({ baseUrl = "", model = "", providerKey = "", ok = false, error = "", latencyMs = 0 } = {}) {
  if (!model) return;
  try {
    const latency = Number(latencyMs) || 0;
    const slow = latency > SLOW_MODEL_MS;
    const effectiveOk = Boolean(ok) && !slow;
    const all = loadModelCapabilities();
    const key = modelCapabilityKey({ baseUrl, model });
    const previous = all[key] || {};
    all[key] = {
      providerKey: providerKey || previous.providerKey || "",
      baseUrl: String(baseUrl || previous.baseUrl || ""),
      model: String(model),
      ok: effectiveOk,
      lastOkAt: effectiveOk ? Date.now() : Number(previous.lastOkAt) || 0,
      lastFailAt: effectiveOk ? Number(previous.lastFailAt) || 0 : Date.now(),
      failStreak: effectiveOk ? 0 : (Number(previous.failStreak) || 0) + 1,
      lastLatencyMs: latency || Number(previous.lastLatencyMs) || 0,
      lastError: effectiveOk ? "" : String(error || (slow ? `Latencia alta (${Math.round(latency / 1000)}s)` : "")).slice(0, 240),
    };
    fs.writeFileSync(modelCapabilitiesPath(), JSON.stringify(all, null, 2), "utf8");
  } catch {}
}

// Candidatos de fallback DEL MISMO gateway con otro modelo verificado:
// resuelve caidas por modelo (p. ej. meai/* caido -> apicredits/claude-sonnet-5)
// aunque exista un solo perfil configurado.
function capabilityFallbackCandidates(current = {}) {
  const maxAgeMs = 7 * 24 * 3_600_000;
  let currentHost = String(current.baseUrl || "");
  try { currentHost = new URL(String(current.baseUrl)).hostname; } catch {}
  return Object.values(loadModelCapabilities())
    .filter((entry) => entry.ok && Date.now() - Number(entry.lastOkAt || 0) < maxAgeMs)
    .filter((entry) => modelCapabilityKey(entry) !== modelCapabilityKey(current))
    .filter((entry) => {
      try { return new URL(String(entry.baseUrl)).hostname === currentHost; } catch { return false; }
    })
    .sort((a, b) => Number(b.lastOkAt || 0) - Number(a.lastOkAt || 0))
    .slice(0, 4)
    .map((entry) => ({
      providerKey: entry.providerKey || current.providerKey || "",
      baseUrl: entry.baseUrl || current.baseUrl,
      apiKey: current.apiKey || "",
      model: entry.model,
    }))
    .filter((entry) => entry.baseUrl && entry.apiKey && entry.model);
}

// Errores que no son transitorios pero SI justifican cambiar de modelo:
// el modelo no existe en la cuenta o el proveedor lo tiene inactivo.
function isModelUnavailableError(error) {
  const message = String(error?.message || error || "");
  return /is not supported|not supported by any|no existe o est[aá] inactivo|proveedor no existe|model .* not found|unknown model|modelo no disponible/i.test(message);
}

function buildFailoverCandidateProfiles(current = {}, { requireTools = true } = {}) {
  const secure = readSecureState();
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const capabilityMap = loadModelCapabilities();
  const activeProfiles = profiles
    .filter((profile) => ["active", "enabled"].includes(String(profile?.status || "").toLowerCase()) && profile?.model)
    .map((profile) => {
      const provider = providers?.[profile.providerKey] || {};
      const cap = Object.values(capabilityMap).find((entry) => String(entry?.model || "").toLowerCase() === String(profile.model || "").toLowerCase());
      return {
        providerKey: profile.providerKey,
        baseUrl: profile.baseUrl || provider.baseUrl,
        apiKey: profile.apiKey || provider.apiKey,
        model: profile.model,
        toolOK: requireTools ? (cap?.toolOK !== false) : true,
        chatOK: cap?.chatOK !== false,
        verified: Boolean(cap?.ok),
      };
    });
  return mergeCandidateProfiles(current, [activeProfiles, fallbackProviderProfiles(current)]);
}

function fallbackProviderProfiles(current = {}) {
  const secure = readSecureState();
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const currentKey = `${String(current.providerKey || "")}|${String(current.baseUrl || "")}|${String(current.model || "")}`.toLowerCase();
  const profileCandidates = profiles
    .filter((profile) => ["active", "enabled"].includes(String(profile?.status || "").toLowerCase()) && profile?.model)
    .map((profile) => {
      const provider = providers?.[profile.providerKey] || {};
      return {
        providerKey: profile.providerKey,
        baseUrl: profile.baseUrl || provider.baseUrl,
        apiKey: profile.apiKey || provider.apiKey,
        model: profile.model,
      };
    })
    .filter((profile) => profile.providerKey && profile.baseUrl && profile.apiKey && profile.model)
    .filter((profile) => `${String(profile.providerKey)}|${String(profile.baseUrl)}|${String(profile.model)}`.toLowerCase() !== currentKey);
  const seen = new Set(profileCandidates.map((item) => modelCapabilityKey(item)));
  const capabilityCandidates = capabilityFallbackCandidates(current)
    .filter((item) => !seen.has(modelCapabilityKey(item)));
  return [...profileCandidates, ...capabilityCandidates];
}

// Un 400 que menciona tools/functions indica que el modelo o el gateway no
// acepta herramientas nativas; el agente puede continuar con el protocolo
// JSON textual sin reiniciar la conversacion.
function isProviderToolUnsupported(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return Number(error?.status) === 400
    && /tool|function|unsupported|not support|no soporta|herramient/.test(message);
}

async function callProvider({ baseUrl, apiKey, model, messages, providerKey = "", signal, timeoutMs = 180_000, maxAttempts = 2, enableTools = false, tools = AGENT_TOOL_DEFINITIONS, auditContext = null, tokenLedger = null, ledgerContext = null, allowProviderFallback = true, rawToolCalls = false, onTextDelta = null }) {
  let activeModel = model;
  let activeApiKey = apiKey;
  let activeBaseUrl = baseUrl;
  let activeProviderKey = providerKey;
  if (messagesHaveImages(messages) && !modelSupportsVision(activeModel)) {
    const pick = ensureVisionRoute({
      model: activeModel,
      images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
      candidates: fallbackProviderProfiles({
        providerKey: activeProviderKey,
        baseUrl: activeBaseUrl,
        model: activeModel,
        apiKey: activeApiKey,
      }),
    });
    if (pick.routed && pick.model) {
      activeModel = pick.model;
      if (pick.apiKey) activeApiKey = pick.apiKey;
      if (pick.baseUrl) activeBaseUrl = pick.baseUrl;
      if (pick.providerKey) activeProviderKey = pick.providerKey;
    }
  }
  const endpoint = normalizeBaseUrl(activeBaseUrl, activeProviderKey);
  const providerId = `endpoint:${new URL(endpoint).hostname}`;
  runtimeAiCore.register({ id: providerId, kind: providerKind(activeProviderKey, endpoint), baseUrl: endpoint });
  const attempts = Math.max(1, Math.min(3, Number(maxAttempts) || 1));
  const safeMessages = modelSupportsVision(activeModel)
    ? messages
    : sanitizeMessagesForModel(messages, activeModel);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new Error("Solicitud cancelada.");
    const auditTimeoutMs = process.env.EDITCORE_PHASE1_AUDIT === "1" ? Number(process.env.EDITCORE_PHASE1_PROVIDER_TIMEOUT_MS) : 0;
    const effectiveTimeoutMs = auditTimeoutMs > 0 ? Math.min(Number(timeoutMs) || auditTimeoutMs, auditTimeoutMs) : Number(timeoutMs);
    const timeout = effectiveTimeoutMs > 0 ? AbortSignal.timeout(effectiveTimeoutMs) : null;
    const requestSignal = signal && timeout ? AbortSignal.any([signal, timeout]) : signal || timeout || undefined;
    const trace = auditPhase1()?.request({
      ...(auditContext || {}),
      provider: new URL(endpoint).hostname,
      model: activeModel,
      messages: safeMessages,
      tools: enableTools ? tools : [],
      attempt,
    });
    const estimatedRequestTokens = estimateTokens(safeMessages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n"));
    const ledgerRow = tokenLedger?.begin({
      ...(ledgerContext || {}),
      provider: new URL(endpoint).hostname,
      model: activeModel,
      retry: attempt - 1,
      attemptId: `${String(ledgerContext?.attemptId || ledgerContext?.stepId || "model")}:${attempt}`,
      budgetBefore: Math.max(0, Number(ledgerContext?.budgetBefore) || 0),
    });
    try {
      let result;
      try {
        result = await runtimeAiCore.complete({ provider: providerId, apiKey: activeApiKey, model: activeModel, messages: safeMessages, tools: enableTools ? tools : [], temperature: resolveFactualTemperature(), signal: requestSignal, maxAttempts: 1, onTextDelta });
      } catch (error) {
        if (!enableTools || !isProviderToolUnsupported(error)) throw error;
        const textProtocolMessages = [
          ...safeMessages,
          { role: "user", content: "El proveedor no acepto herramientas nativas. Continua usando el protocolo JSON textual de EditCore: responde SOLO con {\"type\":\"tool\",\"name\":\"...\",\"input\":{...}} o {\"type\":\"final\",\"text\":\"...\"}." },
        ];
        result = await runtimeAiCore.complete({ provider: providerId, apiKey: activeApiKey, model: activeModel, messages: textProtocolMessages, tools: [], temperature: resolveFactualTemperature(), signal: requestSignal, maxAttempts: 1 });
        result.decisionSource = "text_protocol_no_native_tools";
      }
      result.usage = { ...normalizeUsage(result.usage, estimatedRequestTokens, result.text), model: activeModel, request_input_tokens_estimate: estimatedRequestTokens, provider_host: new URL(endpoint).hostname, request_attempt: attempt };
      tokenLedger?.finish(ledgerRow, result.usage, {
        latency: result.latencyMs,
        budgetAfter: Math.max(0, Number(ledgerContext?.budgetBefore || 0) - Number(result.usage.confirmed_input_tokens || result.usage.estimated_input_tokens || 0)),
      });
      if (!rawToolCalls && enableTools && result.toolCalls?.length) result.text = extractAgentText({ choices: [{ message: { content: result.text, tool_calls: result.toolCalls } }] });
      const hasToolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0;
      const hasText = Boolean(String(result.text || "").trim());
      if (!hasToolCalls && !hasText) {
        const emptyError = new Error(`El proveedor ${new URL(endpoint).hostname} devolvio una respuesta vacia para ${activeModel}.`);
        emptyError.code = "EMPTY_PROVIDER_RESPONSE";
        throw emptyError;
      }
      if (trace) auditPhase1()?.response(trace, { usage: result.usage });
      recordModelCapability({ baseUrl: endpoint, model: activeModel, providerKey: activeProviderKey, ok: true, latencyMs: result.latencyMs });
      return result;
    } catch (error) {
      tokenLedger?.finish(ledgerRow, {}, { error, latency: Date.now() - Number(ledgerRow?.startedAt || Date.now()), budgetAfter: ledgerContext?.budgetBefore });
      if (trace) auditPhase1()?.response(trace, { ok: false, error });
      lastError = toUserFacingProviderError(error);
      if (signal?.aborted) throw lastError;
      if (attempt < attempts && isTransientProviderError(error)) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * attempt, 3000)));
        continue;
      }
      break;
    }
  }
  if (!(signal?.aborted)) recordModelCapability({ baseUrl: endpoint, model: activeModel, providerKey: activeProviderKey, ok: false, error: String(lastError?.message || lastError || "") });
  const shouldRotateProvider = allowProviderFallback && (
    isRecoverableModelError(lastError)
    || isModelUnavailableError(lastError)
    || isTransientProviderError(lastError)
    || isAuthOrUpstreamFailure(lastError)
  );
  if (shouldRotateProvider) {
    for (const fallback of fallbackProviderProfiles({ providerKey: activeProviderKey, baseUrl: endpoint, model: activeModel, apiKey: activeApiKey })) {
      try {
        const result = await callProvider({
          baseUrl: fallback.baseUrl,
          apiKey: fallback.apiKey,
          model: fallback.model,
          providerKey: fallback.providerKey,
          messages,
          signal,
          timeoutMs,
          maxAttempts: 1,
          enableTools,
          tools,
          auditContext: { ...(auditContext || {}), fallbackFrom: `${activeProviderKey || "provider"}/${activeModel}` },
          tokenLedger,
          ledgerContext,
          allowProviderFallback: false,
          rawToolCalls,
          onTextDelta,
        });
        result.usage = { ...(result.usage || {}), provider_fallback_used: true, fallback_from_model: activeModel, fallback_to_model: fallback.model };
        result.fallback = {
          from: { providerKey: activeProviderKey, model: activeModel, baseUrl: endpoint, apiKey: activeApiKey },
          to: {
            providerKey: fallback.providerKey,
            model: fallback.model,
            baseUrl: fallback.baseUrl,
            apiKey: fallback.apiKey,
          },
        };
        return result;
      } catch (fallbackError) {
        recordModelCapability({
          baseUrl: fallback.baseUrl,
          model: fallback.model,
          providerKey: fallback.providerKey,
          ok: false,
          error: String(fallbackError?.message || fallbackError || ""),
        });
      }
    }
  }
  throw toUserFacingProviderError(lastError) || new Error("El proveedor no respondio.");
}

function secureConfigPath() {
  return path.join(app.getPath("userData"), "editcore-secure-config.bin");
}

function normalizeSecureState(value) {
  const state = value && typeof value === "object" ? { ...value } : {};
  for (const [legacyKey, currentKey] of Object.entries(legacySecureKeyMap)) {
    if (
      Object.prototype.hasOwnProperty.call(state, legacyKey)
      && !Object.prototype.hasOwnProperty.call(state, currentKey)
    ) {
      state[currentKey] = state[legacyKey];
    }
  }
  return state;
}

function readSecureStateFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error("El almacenamiento seguro de Windows no esta disponible.");
  const payload = fs.readFileSync(filePath);
  const parsed = JSON.parse(safeStorage.decryptString(payload));
  return normalizeSecureState(parsed);
}

const CONNECTION_SECRET_KEYS = [
  "githubToken",
  "vercelToken",
  "selfSupabaseUrl",
  "selfSupabaseKey",
  "supabaseCloudToken",
  "supabaseOrgId",
  "serverHost",
  "serverKeyPath",
  "vercelTeamId",
  "vercelOrgId",
  "vercelProjectId",
];

function isBlankConnValue(value) {
  return value == null || String(value).trim() === "";
}

function mergeConnectionObjects(base = {}, incoming = {}, { preferIncoming = false } = {}) {
  const merged = { ...(base && typeof base === "object" ? base : {}) };
  const src = incoming && typeof incoming === "object" ? incoming : {};
  for (const [key, value] of Object.entries(src)) {
    if (isBlankConnValue(value)) continue;
    if (preferIncoming || isBlankConnValue(merged[key])) merged[key] = value;
  }
  delete merged.netlifyToken;
  delete merged.netlifySiteId;
  return merged;
}

function connectionsNeedLegacyImport(connections = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  return !(
    !isBlankConnValue(c.githubToken)
    && !isBlankConnValue(c.vercelToken)
    && !isBlankConnValue(c.selfSupabaseUrl)
    && !isBlankConnValue(c.selfSupabaseKey)
    && !isBlankConnValue(c.serverHost)
    && !isBlankConnValue(c.serverKeyPath)
  );
}

function mergeSecureStateFrom(sourcePath) {
  let source = {};
  try {
    source = readSecureStateFile(sourcePath);
  } catch (error) {
    logStartup(`No se pudo descifrar bóveda legacy ${sourcePath}`, error);
    return;
  }
  if (!Object.keys(source).length) return;
  const current = readSecureState();
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (key === "editcore-connections") {
      const prev = current[key] && typeof current[key] === "object" ? current[key] : {};
      const next = mergeConnectionObjects(prev, value, { preferIncoming: connectionsNeedLegacyImport(prev) });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        current[key] = next;
        changed = true;
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      current[key] = value;
      changed = true;
    }
  }
  if (changed) writeSecureState(current);
}

function exportLegacyConnectionsBridgeSync() {
  const legacyDir = path.join(editCoreAppData, "EditCore AI");
  const legacyVault = path.join(legacyDir, "editcore-secure-config.bin");
  if (!fs.existsSync(legacyVault)) return { ok: false, error: "no-legacy-vault" };
  const electronCli = path.join(__dirname, "node_modules", "electron", "cli.js");
  if (!fs.existsSync(electronCli)) return { ok: false, error: "no-electron" };
  const bridgePath = path.join(app.getPath("temp"), `editcore-conn-bridge-live-${process.pid}.json`);
  const scriptPath = path.join(app.getPath("temp"), `editcore-export-legacy-${process.pid}.js`);
  const code = `
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const USER_DATA = ${JSON.stringify(legacyDir)};
const BRIDGE = ${JSON.stringify(bridgePath)};
app.setName("EditCoreAI");
try {
  if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
    app.setAppUserModelId("com.editcoreai.app");
  }
} catch { /* ignore */ }
app.setPath("userData", USER_DATA);
app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage no disponible");
    const securePath = path.join(USER_DATA, "editcore-secure-config.bin");
    const secure = JSON.parse(safeStorage.decryptString(fs.readFileSync(securePath)));
    const connections = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
      ? secure["editcore-connections"] : {};
    const providers = secure["editcore-providers"] && typeof secure["editcore-providers"] === "object"
      ? secure["editcore-providers"] : {};
    const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    fs.writeFileSync(BRIDGE, JSON.stringify({ connections, providers, profiles, from: USER_DATA }), { mode: 0o600 });
    app.exit(0);
  } catch (error) {
    console.error(String(error.message || error));
    app.exit(1);
  }
}).catch((e) => { console.error(String(e.message || e)); app.exit(1); });
`;
  try {
    fs.writeFileSync(scriptPath, code, "utf8");
    const result = spawnSync(process.execPath, [electronCli, scriptPath], {
      encoding: "utf8",
      timeout: 12_000,
      windowsHide: true,
      env: { ...process.env },
    });
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    if (result.status !== 0 || !fs.existsSync(bridgePath)) {
      return { ok: false, error: String(result.stderr || result.stdout || "export-failed").slice(0, 200) };
    }
    const bridge = JSON.parse(fs.readFileSync(bridgePath, "utf8"));
    try { fs.unlinkSync(bridgePath); } catch { /* ignore */ }
    return { ok: true, bridge };
  } catch (error) {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    try { fs.unlinkSync(bridgePath); } catch { /* ignore */ }
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

function importLegacyConnectionsIntoCurrentVault({ force = false } = {}) {
  const secure = readSecureState();
  const currentConn = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
    ? secure["editcore-connections"]
    : {};
  if (!force && !connectionsNeedLegacyImport(currentConn)) {
    return { ok: true, skipped: true, imported: false };
  }
  const exported = exportLegacyConnectionsBridgeSync();
  if (!exported.ok) return { ok: false, error: exported.error, imported: false };
  const incoming = exported.bridge?.connections || {};
  const merged = mergeConnectionObjects(currentConn, incoming, { preferIncoming: true });
  secure["editcore-connections"] = merged;
  if (exported.bridge?.providers && Object.keys(exported.bridge.providers).length) {
    secure["editcore-providers"] = {
      ...(secure["editcore-providers"] || {}),
      ...exported.bridge.providers,
    };
  }
  if (Array.isArray(exported.bridge?.profiles) && exported.bridge.profiles.length) {
    const existing = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    if (!existing.length) secure["editcore-provider-profiles"] = exported.bridge.profiles;
  }
  writeSecureState(secure);
  return {
    ok: true,
    imported: true,
    configured: {
      github: !isBlankConnValue(merged.githubToken),
      vercel: !isBlankConnValue(merged.vercelToken),
      selfsupabase: !isBlankConnValue(merged.selfSupabaseUrl) && !isBlankConnValue(merged.selfSupabaseKey),
      ssh: !isBlankConnValue(merged.serverHost) && !isBlankConnValue(merged.serverKeyPath),
    },
  };
}

let _cachedSecureState = null;
let _cachedSecureStateMtime = 0;

function readSecureState() {
  const filePath = secureConfigPath();
  try {
    if (!fs.existsSync(filePath)) {
      _cachedSecureState = {};
      _cachedSecureStateMtime = 0;
      return {};
    }
    const stat = fs.statSync(filePath);
    if (_cachedSecureState && stat.mtimeMs === _cachedSecureStateMtime) {
      return { ..._cachedSecureState };
    }
    _cachedSecureState = readSecureStateFile(filePath);
    _cachedSecureStateMtime = stat.mtimeMs;
    return { ..._cachedSecureState };
  } catch (error) {
    logStartup(`No se pudo leer ${filePath}`, error);
    return _cachedSecureState ? { ..._cachedSecureState } : {};
  }
}

function writeSecureState(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("El almacenamiento seguro de Windows no esta disponible.");
  const normalized = value && typeof value === "object" ? value : {};
  const payload = safeStorage.encryptString(JSON.stringify(normalized));
  const filePath = secureConfigPath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, payload, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try {
    _cachedSecureState = normalizeSecureState(normalized);
    _cachedSecureStateMtime = fs.statSync(filePath).mtimeMs;
  } catch {
    _cachedSecureState = null;
    _cachedSecureStateMtime = 0;
  }
}

const GAFCORE_ORIGIN = "https://gafcore-gateway.vercel.app";
const GAFCORE_API_BASE = `${GAFCORE_ORIGIN}/api/openai/v1`;

function gatewayPrivateStatePath() {
  return path.join(app.getPath("userData"), "editcore-gafcore-projects.bin");
}

function readGatewayPrivateState() {
  try {
    return readSecureStateFile(gatewayPrivateStatePath());
  } catch (error) {
    logStartup("No se pudo leer estado privado legado de proveedores", error);
    return {};
  }
}

function writeGatewayPrivateState(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("El almacenamiento seguro de Windows no esta disponible.");
  const payload = safeStorage.encryptString(JSON.stringify(value && typeof value === "object" ? value : {}));
  const filePath = gatewayPrivateStatePath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, payload, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function normalizedGatewayProjectName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function gatewayLinkKey(input = {}) {
  const localProjectId = String(input.localProjectId || "").trim();
  if (localProjectId) return `id:${localProjectId}`;
  const rawRoot = String(input.projectRoot || "").trim();
  const projectRoot = rawRoot ? path.resolve(rawRoot).replace(/[\\/]+$/, "").toLowerCase() : "";
  return projectRoot ? `root:${digest(projectRoot)}` : "";
}

async function gatewayJson(pathname, { method = "GET", token = "", projectKey = "", body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers["x-admin-token"] = token;
  if (projectKey) {
    headers.Authorization = `Bearer ${projectKey}`;
    headers["x-project-key"] = projectKey;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${GAFCORE_ORIGIN}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || payload?.message || `El proveedor respondio HTTP ${response.status}`);
  }
  return payload?.data ?? payload;
}

function gatewayModelsFromPayload(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return expandGatewayCatalogModels([...new Set(rows.map((item) => String(item?.id || item?.name || item || "").trim()).filter(Boolean))]);
}

// ME AI: set recomendado para EditCore (agente + fallbacks).
const MEAI_GATEWAY_MODELS = [
  "claude-sonnet-4.6",
  "claude-haiku-4-5",
  "claude-opus-4.8",
  "qwen3.6-plus",
  "glm-5",
  "deepseek-v4-pro",
  "kimi-k2.6",
];

// Live GET api.apicredits.site/v1/models por key (2026-09-03).
const APICREDITS_GATEWAY_MODELS = [
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gemini-2.5-flash",
  "grok-4.3",
  "grok-4.5",
  "deepseek-v4-pro",
];

const BLOCKED_GATEWAY_MODELS = [
  /^meai\/gpt/i,
  /^meai\/claude-sonnet-5$/i,
  /^meai\/glm-5\.[12]$/i,
  /^meai\/qwen3\.5/i,
  /^meai\/deepseek-v4-flash$/i,
  /^meai\/deepseek-v4$/i,
  /^meai\/sd-2/i,
  /^meai\/.*thinking/i,
  /^apicredits\/gpt-(?!5\.6-(?:luna|sol|terra)$)/i,
  /^apicredits\/claude-opus-4-6$/i,
  /^apicredits\/claude-opus-4-5/i,
  /^apicredits\/claude-sonnet-4-5/i,
  /^apicredits\/claude-haiku-4-5-2025/i,
  /^apicredits\/claude-opus-5$/i,
  /^apicredits\/claude-sonnet-4\.6$/i,
  /^apicredits\/claude-haiku-4\.5$/i,
  /^apicredits\/gemini-(?!2\.5-flash$)/i,
  /^apicredits\/grok-(?!4\.[35]$)/i,
  /^apicredits\/deepseek-(?!v4-pro$)/i,
  /^apicredits\/glm/i,
  /^chatgptpro4all\//i,
];

function isBlockedGatewayModel(model) {
  const value = String(model || "").trim();
  return BLOCKED_GATEWAY_MODELS.some((pattern) => pattern.test(value));
}

function expandGatewayCatalogModels(models = []) {
  const list = Array.isArray(models) ? models.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const cleaned = list.filter((model) => !isBlockedGatewayModel(model));
  const expanded = new Set(cleaned);
  if (cleaned.some((model) => model.startsWith("meai/")) || list.some((model) => model.startsWith("meai/"))) {
    for (const model of MEAI_GATEWAY_MODELS) expanded.add(`meai/${model}`);
  }
  if (cleaned.some((model) => model.startsWith("apicredits/")) || list.some((model) => model.startsWith("apicredits/"))) {
    for (const model of APICREDITS_GATEWAY_MODELS) expanded.add(`apicredits/${model}`);
  }
  return [...expanded].filter((model) => !isBlockedGatewayModel(model));
}

function isGatewayResidueProvider(provider) {
  const id = String(provider?.id || "").toLowerCase();
  const url = String(provider?.baseUrl || "").toLowerCase();
  const name = String(provider?.name || "").toLowerCase();
  return id === "gafcore-gateway"
    || url.includes("gafcore-gateway")
    || name.includes("gafcore gateway")
    || name === "gafcore";
}

function isGatewayResidueProfile(profile) {
  const key = String(profile?.providerKey || "");
  const url = String(profile?.baseUrl || "").toLowerCase();
  const id = String(profile?.id || "").toLowerCase();
  return key === "custom:gafcore-gateway"
    || id.startsWith("gafcore-gateway")
    || url.includes("gafcore-gateway");
}

/** Elimina residuos del gateway AI de la bóveda. No reinyecta endpoints. */
function scrubGatewayFromSecureState() {
  const secure = readSecureState();
  let changed = false;
  const rawProviders = Array.isArray(secure["editcore-custom-providers"]) ? secure["editcore-custom-providers"] : [];
  const cleanedProviders = rawProviders.filter((provider) => !isGatewayResidueProvider(provider));
  if (cleanedProviders.length !== rawProviders.length) {
    secure["editcore-custom-providers"] = cleanedProviders;
    changed = true;
  }
  const rawProfiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const cleanedProfiles = rawProfiles.filter((profile) => !isGatewayResidueProfile(profile));
  if (cleanedProfiles.length !== rawProfiles.length) {
    secure["editcore-provider-profiles"] = cleanedProfiles;
    changed = true;
  }
  const chat = secure["editcore-chat-config"];
  if (chat && (isGatewayResidueProfile(chat) || String(chat.baseUrl || "").toLowerCase().includes("gafcore-gateway"))) {
    const fallback = cleanedProfiles.find((profile) =>
      (profile.providerKey === "meai" || profile.providerKey === "apicredits")
      && profile.apiKey
      && profile.model,
    ) || cleanedProfiles.find((profile) => profile.apiKey && profile.model);
    if (fallback) {
      secure["editcore-chat-config"] = {
        ...chat,
        baseUrl: fallback.baseUrl
          || (fallback.providerKey === "meai" ? "https://api.meai.cloud/v1" : "https://api.apicredits.site/v1"),
        apiKey: fallback.apiKey,
        model: fallback.model,
        providerKey: fallback.providerKey,
        providerProfileId: fallback.id || "",
        modelSelectionMode: chat.modelSelectionMode || "auto",
      };
    } else {
      secure["editcore-chat-config"] = {
        ...chat,
        baseUrl: "https://api.meai.cloud/v1",
        apiKey: "",
        model: "claude-sonnet-4.6",
        providerKey: "meai",
        providerProfileId: "",
        modelSelectionMode: "auto",
      };
    }
    changed = true;
  }
  try {
    const privateState = readGatewayPrivateState();
    if (privateState?.adminToken || (privateState?.links && Object.keys(privateState.links || {}).length)) {
      writeGatewayPrivateState({});
      changed = true;
    }
  } catch { /* ignore */ }
  if (changed) writeSecureState(secure);
  return changed;
}

function applyGatewayProjectToSecureState(_link) {
  // Integración eliminada: nunca reinyectar el gateway en la bóveda.
  scrubGatewayFromSecureState();
  return "";
}

function sanitizedGatewayLink(link, extra = {}) {
  return {
    connected: Boolean(link?.projectId && link?.models?.length),
    projectId: String(link?.projectId || ""),
    projectName: String(link?.projectName || ""),
    modelCount: Array.isArray(link?.models) ? link.models.length : 0,
    models: Array.isArray(link?.models) ? [...link.models] : [],
    balanceUsd: Number(link?.balanceUsd || 0),
    connectedAt: Number(link?.connectedAt || 0),
    ...extra,
  };
}

function gatewayLinkForInput(input = {}) {
  const privateState = readGatewayPrivateState();
  const links = privateState.links && typeof privateState.links === "object" ? privateState.links : {};
  const direct = links[gatewayLinkKey(input)];
  if (direct) return direct;
  const normalizedRoot = String(input.projectRoot || "").trim().replace(/[\\/]+$/, "").toLowerCase();
  return Object.values(links).find((link) => normalizedRoot && link?.projectRoot === normalizedRoot) || null;
}

function readConnections() {
  const value = readSecureState()["editcore-connections"];
  const connections = value && typeof value === "object" ? { ...value } : {};
  // Bóveda global: nunca conservar path de un proyecto (/taxidriv, /page, ...).
  const rawUrl = String(connections.selfSupabaseUrl || "").trim();
  try {
    const parsed = new URL(rawUrl);
    if (/supabase\.gafcore\.com$/i.test(parsed.hostname) && String(parsed.pathname || "").replace(/\/+$/, "")) {
      connections.selfSupabaseUrl = `${parsed.protocol}//${parsed.host}`;
      // Persistir limpieza para que el modal no vuelva a mostrar taxidriv.
      try {
        const secure = readSecureState();
        const stored = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
          ? { ...secure["editcore-connections"] }
          : {};
        if (String(stored.selfSupabaseUrl || "").trim() !== connections.selfSupabaseUrl) {
          stored.selfSupabaseUrl = connections.selfSupabaseUrl;
          secure["editcore-connections"] = stored;
          writeSecureState(secure);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return connections;
}

function operatorConnectionsProjectId(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  if (!root) return "";
  return crypto.createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 16);
}

function getOperatorConnectionsSnapshot(input = {}) {
  const globalConnections = readConnections();
  const projectRoot = String(input.projectRoot || "").trim();
  const connections = connectionsForProject(globalConnections, projectRoot);
  return buildSafeConnectionsSnapshot({
    connections,
    connectionSummary,
    gatewayLink: null,
    gatewayAdminConfigured: false,
    projectRoot,
    projectManifest: readProjectLinkManifest(projectRoot),
    accounts: input.accounts || {},
  });
}

function getOperatorConnectionsMemoryBlock(input = {}) {
  return formatOperatorConnectionsMemory(getOperatorConnectionsSnapshot(input));
}

function syncOperatorConnectionsToBrain(projectRoot = "") {
  try {
    const snapshot = getOperatorConnectionsSnapshot({ projectRoot });
    const service = brain();
    persistOperatorConnectionsMemory(service, snapshot, {
      projectRoot,
      projectId: operatorConnectionsProjectId(projectRoot),
    });
  } catch (error) {
    logStartup(`operator-connections memory: ${String(error?.message || error).slice(0, 160)}`);
  }
}

function credentialFingerprint(service, connections) {
  if (service === "github") return digest(connections.githubToken || "");
  if (service === "vercel") return digest(connections.vercelToken || "");
  if (service === "selfsupabase") return digest([connections.selfSupabaseUrl || "", connections.selfSupabaseKey || ""]);
  return digest("");
}

async function executeRemoteTool(input = {}) {
  const service = String(input.service || "").toLowerCase();
  const method = String(input.method || "GET").toUpperCase();
  const remotePath = String(input.path || "/");
  const projectRoot = String(input.projectRoot || "").trim();
  const connections = service === "selfsupabase"
    ? connectionsForProject(readConnections(), projectRoot)
    : readConnections();
  const cacheContext = {
    service, method, path: remotePath, body: input.body ?? null,
    credential: credentialFingerprint(service, connections),
    projectRoot: service === "selfsupabase" ? projectRoot : "",
  };
  if (READ_METHODS.has(method)) {
    const cached = getToolCache().get(cacheContext);
    if (cached) return { ...cached, cacheHit: true };
  }
  const result = await executeServiceRequest({
    service, method, path: remotePath, body: input.body, connections,
    signal: AbortSignal.timeout(30_000),
  });
  if (READ_METHODS.has(method)) getToolCache().set(cacheContext, result);
  else getToolCache().invalidateService(service);
  return { ...result, cacheHit: false };
}

async function validateConnection(service) {
  const name = String(service || "").toLowerCase();
  const connections = readConnections();
  const summary = connectionSummary(connections);
  const summaryName = name === "ssh" ? "server" : name;
  const configured = Boolean(summary[summaryName]?.configured);
  if (!configured) return { service: name, configured: false, ok: false, error: "Sin configurar" };

  if (name === "ssh") {
    try {
      const exists = require("fs").existsSync(connections.serverKeyPath);
      if (!exists) return { service: name, configured: true, ok: false, error: "Archivo de clave no existe en la ruta" };
      return { service: name, configured: true, ok: true, account: connections.serverHost || "SSH verificado" };
    } catch (err) {
      return { service: name, configured: true, ok: false, error: String(err) };
    }
  }
  const request = name === "github" ? { service: name, method: "GET", path: "/user" }
    : name === "vercel" ? { service: name, method: "GET", path: "/v2/user" }
      : { service: name, method: "GET", path: "/rest/v1/" };
  try {
    const result = await executeServiceRequest({
      ...request,
      connections,
      signal: AbortSignal.timeout(30_000),
    });
    const data = result.data || {};
    const account = name === "github"
      ? (data.login || data.name || "")
      : name === "vercel"
        ? (data.user?.username || data.user?.email || data.user?.name || data.username || data.email || "")
        : (summary[name]?.url || "");
    return { service: name, configured: true, ok: true, status: result.status, account: String(account || "").slice(0, 160) };
  } catch (error) {
    const raw = String(error?.message || error).slice(0, 300);
    let hint = raw;
    if (name === "github" && /401|403|Bad credentials|Requires authentication/i.test(raw)) {
      hint = `${raw} — revisa el token GitHub (scopes repo,workflow) o regeneralo.`;
    }
    if (name === "selfsupabase" && /gafcore-gateway|404|ENOTFOUND/i.test(raw)) {
      hint = `${raw} — no mezcles Gateway. Usa la URL del proyecto (ej. https://supabase.gafcore.com/taxidriv).`;
    }
    if (name === "selfsupabase" && /401|403|JWT|Invalid API key|unauthorized/i.test(raw)) {
      hint = `${raw} — API Key o URL de proyecto incorrecta. En GafCore suele ser https://supabase.gafcore.com/<proyecto> + SERVICE_ROLE del .env.`;
    }
    return { service: name, configured: true, ok: false, error: hint };
  }
}

ipcMain.handle("connections:validate", async (_event, service) => {
  const allowed = ["github", "vercel", "selfsupabase", "ssh"];
  const requested = String(service || "").toLowerCase();
  let result;
  if (requested) {
    if (!allowed.includes(requested)) throw new Error("Servicio de conexion no permitido.");
    result = await validateConnection(requested);
  } else {
    result = await Promise.all(allowed.map(validateConnection));
  }
  syncOperatorConnectionsToBrain("");
  return result;
});

ipcMain.handle("connections:import-local", async (_event, input = {}) => {
  const imported = await importLocalConnections(input);
  syncOperatorConnectionsToBrain(String(input?.projectRoot || ""));
  return imported;
});

ipcMain.handle("connections:operator-memory", async (_event, input = {}) => {
  const snapshot = getOperatorConnectionsSnapshot(input || {});
  return {
    snapshot,
    memory: formatOperatorConnectionsMemory(snapshot),
  };
});
ipcMain.handle("connections:gafcore-status", async () => {
  scrubGatewayFromSecureState();
  return { connected: false, adminTokenStored: false, vaultActive: false, removed: true };
});

ipcMain.handle("connections:gafcore-admin-token", async () => {
  scrubGatewayFromSecureState();
  throw new Error("Esta integración ya no está disponible. Configura ME AI o APICredits en Modelos.");
});

ipcMain.handle("connections:gafcore-activate", async () => {
  scrubGatewayFromSecureState();
  return { connected: false, removed: true };
});

async function connectGatewayProjectInternal() {
  scrubGatewayFromSecureState();
  throw new Error("Esta integración ya no está disponible. Configura ME AI o APICredits en Modelos.");
}

ipcMain.handle("connections:gafcore-project", async (_event, input = {}) => connectGatewayProjectInternal(input));

function getCloudVaultBridge() {
  const { createCloudVaultBridge } = require("./runtime/cloud-vault-bridge");
  return createCloudVaultBridge({
    getConnections: readConnections,
    getGatewayAdminToken: () => "",
    connectGatewayProject: null,
    gatewayOrigin: "",
  });
}

ipcMain.handle("cloud:vault-status", async () => getCloudVaultBridge().vaultStatus());
ipcMain.handle("cloud:deploy-github", async (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  return getCloudVaultBridge().deployGithub(root, input);
});
ipcMain.handle("cloud:deploy-vercel", async (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  return getCloudVaultBridge().deployVercel(root, input);
});
ipcMain.handle("cloud:provision-supabase", async (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  return getCloudVaultBridge().provisionSupabase(root, input);
});
ipcMain.handle("cloud:provision-gafcore-ai", async () => {
  scrubGatewayFromSecureState();
  throw new Error("Esta integración ya no está disponible. Configura ME AI o APICredits en Modelos.");
});
ipcMain.handle("cloud:provision-fullstack", async (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  return getCloudVaultBridge().provisionFullStackProject(root, {
    ...input,
    provisionAi: false,
    connectGateway: false,
  });
});
ipcMain.handle("cloud:probe-endpoint", async (_event, input = {}) => {
  const { probeEndpoint } = require("./runtime/probe-endpoint");
  return probeEndpoint(input || {});
});
ipcMain.handle("cloud:test-local-api", async (_event, input = {}) => {
  const { testLocalApi } = require("./runtime/probe-endpoint");
  return testLocalApi(input || {});
});

function verificationReportPath() {
  const argument = process.argv.find((value) => String(value).startsWith("--editcore-verify-report="));
  return argument ? path.resolve(String(argument).slice("--editcore-verify-report=".length)) : "";
}

function agentAcceptanceReportPath() {
  const argument = process.argv.find((value) => String(value).startsWith("--editcore-agent-acceptance-report="));
  return argument ? path.resolve(String(argument).slice("--editcore-agent-acceptance-report=".length)) : "";
}

async function createRealAgentAcceptanceReport() {
  const secure = readSecureState();
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const profile = profiles.find((item) => ["active", "enabled"].includes(String(item?.status || "").toLowerCase()) && item?.model && (item.apiKey || providers?.[item.providerKey]?.apiKey))
    || profiles.find((item) => item?.model && (item.apiKey || providers?.[item.providerKey]?.apiKey));
  if (!profile) {
    const configured = Object.entries(providers).map(([providerKey, provider]) => ({ providerKey, models: Array.isArray(provider?.models) ? provider.models.length : Number(Boolean(provider?.model)), hasKey: Boolean(provider?.apiKey) }));
    throw new Error(`No existe un perfil de modelo utilizable para la aceptacion real. Perfiles: ${profiles.length}; proveedores configurados: ${JSON.stringify(configured)}.`);
  }
  const provider = providers?.[profile.providerKey] || {};
  const baseUrl = profile.baseUrl || provider.baseUrl;
  const apiKey = profile.apiKey || provider.apiKey;
  const model = String(profile.model || "");
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-real-agent-"));
  const timeline = [];
  const startedAt = Date.now();
  try {
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "editcore-real-agent-acceptance",
      private: true,
      scripts: { test: "node --test acceptance.test.js" },
    }, null, 2));
    fs.writeFileSync(path.join(projectRoot, "acceptance.test.js"), [
      'const test = require("node:test");',
      'const assert = require("node:assert/strict");',
      'test("resultado creado por el agente", () => {',
      '  const result = require("./result.js");',
      '  assert.deepEqual(result, { status: "corrected", source: "real-agent" });',
      '});',
      "",
    ].join("\n"));

    const planStartedAt = Date.now();
    const planResult = await callProvider({
      baseUrl, apiKey, model, providerKey: profile.providerKey,
      timeoutMs: 45_000, maxAttempts: 1,
      messages: [{
        role: "system",
        content: "Eres el planificador de EditCore. Propone objetivo, acciones, archivos, riesgos y verificacion. No ejecutes ni afirmes cambios. Termina exactamente con: Cuando autorices procedo con los cambios.",
      }, {
        role: "user",
        content: "Crea result.js para que las pruebas del proyecto temporal pasen y verifica con npm test.",
      }],
    });
    const plan = String(planResult.text || "").trim();
    const planValid = plan.length >= 80 && /Cuando autorices procedo con los cambios\./i.test(plan);
    timeline.push({ phase: "plan", durationMs: Date.now() - planStartedAt, valid: planValid });
    if (!planValid) throw new Error("El modelo real no produjo un plan util que esperara autorizacion.");
    if (fs.existsSync(path.join(projectRoot, "result.js"))) throw new Error("La fase de plan modifico el proyecto sin autorizacion.");

    const adapter = new EditCoreClaudeAdapter({ maxIterations: 14, tokenBudget: 80_000, logger: console });
    adapter.actionRegistry = new ActionRegistry({ maxEntries: 200, cacheTTL: 60_000 });
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("Aceptacion real excedio 120 segundos.")), 120_000);
    adapter.providerApi = { call: (options) => callProvider({
      baseUrl, apiKey, model, providerKey: profile.providerKey,
      messages: options.messages, tools: options.tools, enableTools: true,
      signal: options.signal || controller.signal, timeoutMs: 45_000, maxAttempts: 1,
    }) };
    adapter.toolExecutor = { execute: async (name, input = {}) => {
      const toolStartedAt = Date.now();
      let result;
      if (name === "list_files") result = listEntries(projectRoot, String(input.path || ""));
      else if (name === "read_file") result = readProjectFileChunk(projectRoot, input);
      else if (name === "search_files") result = searchProject(projectRoot, String(input.query || ""));
      else if (name === "write_file") result = writeProjectFile(projectRoot, String(input.path || ""), String(input.content || ""));
      else if (name === "replace_in_file") {
        const target = resolveInside(projectRoot, String(input.path || ""));
        const current = fs.readFileSync(target, "utf8");
        if (!current.includes(String(input.oldText || ""))) throw new Error("oldText no existe.");
        result = writeProjectFile(projectRoot, String(input.path || ""), current.replace(String(input.oldText), String(input.newText || "")));
      } else if (name === "run_command") result = await runProjectCommand(projectRoot, String(input.command || ""), "full", controller.signal, input.cwd);
      else throw new Error(`Herramienta no permitida en aceptacion: ${name}`);
      timeline.push({ phase: "tool", name, ok: true, durationMs: Date.now() - toolStartedAt });
      return result;
    } };
    let result;
    try {
      result = await adapter.executeTask({
        prompt: "Crea result.js que exporte exactamente { status: \"corrected\", source: \"real-agent\" } para corregir la prueba y verifica el resultado con npm test.",
        projectRoot, model, apiKey, baseUrl, providerKey: profile.providerKey,
        allowWrite: true, analysisMode: false, requireEvidence: true, enforceController: true,
        signal: controller.signal,
        onProgress: (progress) => timeline.push({ phase: progress.phase || "progress", stage: progress.stage || "", atMs: Date.now() - startedAt }),
      });
    } finally {
      clearTimeout(deadline);
    }
    const resultPath = path.join(projectRoot, "result.js");
    const fileExists = fs.existsSync(resultPath);
    const fileHash = fileExists ? crypto.createHash("sha256").update(fs.readFileSync(resultPath)).digest("hex") : "";
    const verificationStep = result.steps.find((step) => step.name === "run_command" && step.ok === true && /npm\s+test/i.test(String(step.input?.command || "")));
    const accepted = result.completed === true && fileExists && Boolean(verificationStep);
    return {
      generatedAt: new Date().toISOString(),
      provider: String(profile.providerKey || ""), model,
      accepted, planValid, planDurationMs: timeline.find((item) => item.phase === "plan")?.durationMs || 0,
      totalDurationMs: Date.now() - startedAt,
      completed: result.completed, stopReason: result.stopReason || "", finalText: result.text,
      fileExists, fileSha256: fileHash,
      tools: result.steps.map((step) => ({ name: step.name, ok: step.ok === true, path: String(step.input?.path || ""), command: String(step.input?.command || ""), error: String(step.result?.error || "") })),
      usage: result.usage, timeline,
    };
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function shouldRepairFailingProfiles() {
  return process.argv.includes("--editcore-repair-failing-profiles");
}

function deactivateFailingProfiles(modelResults = []) {
  const failures = new Set(modelResults.filter((item) => !item.ok).map((item) => item.label));
  if (!failures.size) return [];
  const secure = readSecureState();
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const deactivated = [];
  secure["editcore-provider-profiles"] = profiles.map((profile) => {
    const label = `${profile.providerKey}/${profile.model}`;
    if (!failures.has(label) || profile.status !== "active") return profile;
    deactivated.push(label);
    return { ...profile, status: "inactive", verificationError: "Desactivado por auditoria operativa", updatedAt: Date.now() };
  });
  if (deactivated.length) writeSecureState(secure);
  return deactivated;
}

function connectionImportReportPath() {
  const argument = process.argv.find((value) => String(value).startsWith("--editcore-import-connections-report="));
  return argument ? path.resolve(String(argument).slice("--editcore-import-connections-report=".length)) : "";
}

function readEnvValues(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function connectionWorks(service, connections) {
  const request = service === "github" ? { service, method: "GET", path: "/user" }
    : service === "vercel" ? { service, method: "GET", path: "/v2/user" }
      : { service, method: "GET", path: "/rest/v1/" };
  try {
    await executeServiceRequest({ ...request, connections, signal: AbortSignal.timeout(20_000) });
    return true;
  } catch {
    return false;
  }
}

async function importLocalConnections(input = {}) {
  let legacyImport = null;
  try {
    const before = readSecureState()["editcore-connections"] || {};
    if (connectionsNeedLegacyImport(before) || input.forceLegacy === true) {
      legacyImport = importLegacyConnectionsIntoCurrentVault({ force: true });
      logStartup(`connections:legacy-import ok=${Boolean(legacyImport?.ok)} imported=${Boolean(legacyImport?.imported)}`);
    }
  } catch (error) {
    legacyImport = { ok: false, error: String(error?.message || error).slice(0, 160) };
    logStartup("connections:legacy-import-failed", error);
  }

  const secure = readSecureState();
  const connections = { ...(secure["editcore-connections"] || {}) };
  const imported = { github: false, vercel: false, selfsupabase: false, gafcore: false, legacy: Boolean(legacyImport?.imported) };
  const sources = {};
  if (legacyImport?.imported) sources.legacy = "legacy-appdata";

  if (!connections.githubToken || !await connectionWorks("github", connections)) {
    const ghPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    try {
      const { stdout } = await execFileAsync(fs.existsSync(ghPath) ? ghPath : "gh", ["auth", "token"], { windowsHide: true, timeout: 20_000 });
      const candidate = { ...connections, githubToken: String(stdout || "").trim() };
      if (candidate.githubToken && await connectionWorks("github", candidate)) {
        connections.githubToken = candidate.githubToken;
        imported.github = true;
        sources.github = "GitHub CLI";
      }
    } catch {}
  }

  if (!connections.vercelToken || !await connectionWorks("vercel", connections)) {
    const vercelFiles = [
      path.join(app.getPath("appData"), "xdg.data", "com.vercel.cli", "auth.json"),
      path.join(app.getPath("appData"), "com.vercel.cli", "auth.json"),
      path.join(app.getPath("home"), ".config", "vercel", "auth.json"),
    ];
    for (const filePath of vercelFiles) {
      try {
        const auth = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const token = String(auth?.token || auth?.credentials?.token || "").trim();
        const candidate = { ...connections, vercelToken: token };
        if (token && await connectionWorks("vercel", candidate)) {
          connections.vercelToken = token;
          imported.vercel = true;
          sources.vercel = "Vercel CLI";
          break;
        }
      } catch {}
    }
  }

  if (!connections.selfSupabaseUrl || !connections.selfSupabaseKey || !await connectionWorks("selfsupabase", connections)) {
    const activeRoot = String(input.projectRoot || "").trim();
    // Solo el proyecto activo: nunca importar URL de TAXIDRIV u otros a la bóveda global.
    const envFiles = activeRoot
      ? [path.join(activeRoot, ".env"), path.join(activeRoot, ".env.local")]
      : [];
    const urlNames = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL"];
    const keyNames = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"];
    for (const filePath of envFiles) {
      const values = readEnvValues(filePath);
      const rawUrl = urlNames.map((name) => values[name]).find((value) => /https:\/\/supabase\.gafcore\.com/i.test(String(value || "")));
      const key = keyNames.map((name) => values[name]).find(Boolean);
      if (!rawUrl || !key) continue;
      // Bóveda = origen de plataforma SIN path de proyecto (/taxidriv, /page, ...).
      let url = String(rawUrl).replace(/^=+/, "").replace(/\/+$/, "")
        .replace(/\/gafcore-gateway(?:\/api(?:\/openai(?:\/v1)?)?)?$/i, "")
        .replace(/\/rest\/v1$/i, "")
        .replace(/\/+$/, "");
      try {
        const parsed = new URL(url);
        if (/supabase\.gafcore\.com$/i.test(parsed.hostname)) {
          url = `${parsed.protocol}//${parsed.host}`;
        }
      } catch { /* keep cleaned url */ }
      const candidate = { ...connections, selfSupabaseUrl: url, selfSupabaseKey: String(key).replace(/^=+/, "").trim() };
      if (await connectionWorks("selfsupabase", candidate)) {
        connections.selfSupabaseUrl = candidate.selfSupabaseUrl;
        connections.selfSupabaseKey = candidate.selfSupabaseKey;
        imported.selfsupabase = true;
        sources.selfsupabase = path.basename(activeRoot);
        break;
      }
    }
  }

  // Importación de tokens de gateway AI eliminada a propósito.

  secure["editcore-connections"] = connections;
  writeSecureState(secure);
  const validation = await Promise.all(["github", "vercel", "selfsupabase"].map(validateConnection));
  return { imported, sources, validation, legacyImport, gafcoreImported: false };
}

async function verifyModelAgentProfile(profile, providers, projectRoot) {
  const provider = providers?.[profile.providerKey] || {};
  const baseUrl = profile.baseUrl || provider.baseUrl;
  const apiKey = profile.apiKey || provider.apiKey;
  const model = String(profile.model || "");
  const label = `${profile.providerKey || "provider"}/${model || "sin-modelo"}`;
  if (!baseUrl || !apiKey || !model) return { label, ok: false, error: "Perfil incompleto" };
  const messages = [
    { role: "system", content: "Responde SOLO JSON. Para usar herramienta: {\"type\":\"tool\",\"name\":\"list_files\",\"input\":{\"path\":\"\"}}" },
    { role: "user", content: "Usa list_files ahora para revisar la raiz del proyecto." },
  ];
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await callProvider({
        baseUrl,
        apiKey,
        model,
        providerKey: profile.providerKey,
        messages,
        timeoutMs: AGENT_MODEL_VERIFY_TIMEOUT_MS,
        maxAttempts: 1,
        enableTools: true,
        rawToolCalls: true,
      });
      const rawText = response.text;
      lastRaw = typeof rawText === "string" ? rawText : JSON.stringify(rawText);
      try {
        fs.writeFileSync(path.join(__dirname, "verify-debug.log"), `Attempt ${attempt} for model ${model}:\n${lastRaw}\n\n`, { flag: "a" });
      } catch (err) {}
      if (Array.isArray(response.toolCalls) && response.toolCalls.length) {
        const listCall = response.toolCalls.find((call) => call?.function?.name === "list_files");
        if (listCall) {
          let requestedPath = "";
          try {
            requestedPath = String(JSON.parse(listCall.function.arguments || "{}").path || "");
          } catch {}
          const files = listEntries(projectRoot, requestedPath === "/" || requestedPath === "\\" ? "" : requestedPath);
          return { label, ok: true, tool: "list_files", entriesRead: files.length, attempts: attempt };
        }
      }
      const action = parseAgentJson(rawText);
      if (action?.type === "tool" && action?.name === "list_files") {
        const requestedPath = String(action.input?.path || "");
        const files = listEntries(projectRoot, requestedPath === "/" || requestedPath === "\\" ? "" : requestedPath);
        return { label, ok: true, tool: action.name, entriesRead: files.length, attempts: attempt };
      }
      if (String(rawText || "").includes("list_files")) {
        const files = listEntries(projectRoot, "");
        return { label, ok: true, tool: "list_files", entriesRead: files.length, attempts: attempt };
      }
      messages.push({ role: "assistant", content: String(rawText || "").slice(0, 4000) });
      messages.push({ role: "user", content: 'Formato invalido. Responde exactamente: {"type":"tool","name":"list_files","input":{"path":""}}' });
    } catch (error) {
      if (attempt === 2) return { label, ok: false, error: String(error?.message || error).slice(0, 240) };
    }
  }
  return {
    label,
    ok: false,
    error: `El modelo respondio, pero no emitio la herramienta solicitada despues de 2 intentos${lastRaw ? `: ${lastRaw.replace(/\s+/g, " ").slice(0, 220)}` : ""}`,
  };
}

function configuredProviderEntries() {
  const secure = readSecureState();
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
  const byCredential = new Map();
  const addEntry = ({ providerKey, baseUrl, apiKey, models = [] }) => {
    if (!providerKey || !baseUrl || !apiKey) return;
    const key = `${providerKey}|${baseUrl}|${digest(apiKey)}`;
    const existing = byCredential.get(key) || { providerKey, baseUrl, apiKey, configuredModels: [] };
    existing.configuredModels = [...new Set([...existing.configuredModels, ...models.map((model) => String(model || "").trim()).filter(Boolean)])];
    byCredential.set(key, existing);
  };
  for (const [providerKey, provider] of Object.entries(providers)) {
    const baseUrl = provider?.baseUrl;
    const apiKey = provider?.apiKey;
    addEntry({
      providerKey,
      baseUrl,
      apiKey,
      models: [
        String(provider.model || "").trim(),
        ...(Array.isArray(provider.models) ? provider.models.map((model) => String(model || "").trim()) : []),
      ],
    });
  }
  for (const profile of profiles) {
    if (!profile?.apiKey || !profile?.model) continue;
    const provider = providers?.[profile.providerKey] || {};
    addEntry({
      providerKey: profile.providerKey,
      baseUrl: profile.baseUrl || provider.baseUrl,
      apiKey: profile.apiKey,
      models: [profile.model],
    });
  }
  return [...byCredential.values()];
}

async function fetchProviderModelIds(provider) {
  try {
    const endpoint = normalizeBaseUrl(provider.baseUrl, provider.providerKey);
    const kind = providerKind(provider.providerKey, endpoint);
    const response = await fetch(providerModelsUrl(provider.baseUrl, provider.providerKey, provider.apiKey), {
      headers: providerRequestHeaders(kind, provider.apiKey),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    const models = extractModelIdsFromPayload(data);
    return { ok: true, models: [...new Set(models)] };
  } catch (error) {
    return { ok: false, models: [], error: String(error?.message || error).slice(0, 300) };
  }
}

async function verifyOneProviderModel(provider, model, projectRoot) {
  const label = `${provider.providerKey}/${model}`;
  const result = { label, providerKey: provider.providerKey, model, chatOK: false, toolOK: false, ok: false, capability: "unavailable" };
  try {
    const chat = await callProvider({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      providerKey: provider.providerKey,
      messages: [{ role: "user", content: "Responde solamente OK" }],
      timeoutMs: 30_000,
      maxAttempts: 1,
    });
    result.chatOK = Boolean(String(chat.text || "").trim());
    result.chatStatus = 200;
  } catch (error) {
    result.error = String(error?.message || error).slice(0, 300);
    return result;
  }

  try {
    const profile = { providerKey: provider.providerKey, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model };
    const tool = await verifyModelAgentProfile(profile, { [provider.providerKey]: provider }, projectRoot);
    result.toolOK = Boolean(tool.ok);
    result.tool = tool.tool || "";
    result.entriesRead = tool.entriesRead || 0;
    if (!tool.ok) result.toolError = tool.error || "No emitio herramienta compatible";
  } catch (error) {
    result.toolError = String(error?.message || error).slice(0, 300);
  }
  result.ok = result.chatOK && result.toolOK;
  result.capability = classifyModelCapability(result);
  return result;
}

async function verifyAllConfiguredModels(projectRoot) {
  const providers = configuredProviderEntries();
  const reports = [];
  for (const provider of providers) {
    const listed = await fetchProviderModelIds(provider);
    const models = [...new Set([...(listed.models || []), ...(provider.configuredModels || [])])];
    const providerReport = {
      providerKey: provider.providerKey,
      baseUrl: provider.baseUrl,
      modelListOK: listed.ok,
      modelListError: listed.error || "",
      totalModels: models.length,
      models: [],
    };
    for (const model of models) {
      providerReport.models.push(await verifyOneProviderModel(provider, model, projectRoot));
    }
    providerReport.chatOK = providerReport.models.filter((item) => item.chatOK).length;
    providerReport.toolOK = providerReport.models.filter((item) => item.toolOK).length;
    providerReport.ok = providerReport.totalModels > 0 && providerReport.models.every((item) => item.ok);
    reports.push(providerReport);
  }
  return reports;
}

async function verifyAgentProjectAccess(event, rootPath, requestedPermission) {
  const projectRoot = assertProjectRoot(rootPath);
  const selectedPermission = ["readonly", "step", "full"].includes(String(requestedPermission)) ? String(requestedPermission) : permissionMode;
  const canWrite = selectedPermission !== "readonly";
  const tempRel = `.editcore/agent-verification/${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  const report = {
    projectRoot,
    permissionMode: selectedPermission,
    canWrite,
    list: { ok: false },
    read: { ok: false },
    write: { ok: false, skipped: !canWrite },
    command: { ok: false, skipped: !canWrite },
    cleanup: { ok: false },
  };
  try {
    const entries = listEntries(projectRoot, "");
    report.list = { ok: true, count: entries.length, sample: entries.slice(0, 12).map((item) => item.path || item.name) };
  } catch (error) {
    report.list = { ok: false, error: String(error?.message || error).slice(0, 300) };
  }

  try {
    const textFile = walkFiles(projectRoot, "", 500).find((file) => /\.(js|ts|jsx|tsx|json|css|html|md|txt|py|php|java|cs|go|rs|yml|yaml)$/i.test(file));
    if (!textFile) throw new Error("No se encontro archivo de texto legible.");
    const content = readProjectFile(projectRoot, textFile);
    report.read = { ok: true, path: textFile, bytes: Buffer.byteLength(content, "utf8") };
  } catch (error) {
    report.read = { ok: false, error: String(error?.message || error).slice(0, 300) };
  }

  if (canWrite) {
    try {
      if (!await approveAgentAction(event, selectedPermission, "write_file", { path: tempRel })) throw new Error("Escritura no autorizada por el usuario.");
      const content = `EditCore agent verification\nproject=${projectRoot}\nat=${new Date().toISOString()}\n`;
      const written = writeProjectFile(projectRoot, tempRel, content);
      const reread = readProjectFile(projectRoot, tempRel);
      report.write = { ok: reread.includes("EditCore agent verification"), path: tempRel, bytes: written.bytes };
    } catch (error) {
      report.write = { ok: false, error: String(error?.message || error).slice(0, 300) };
    }

    try {
      if (!await approveAgentAction(event, selectedPermission, "run_command", { command: "node --version" })) throw new Error("Comando no autorizado por el usuario.");
      const output = await runProjectCommand(projectRoot, "node --version", selectedPermission, AbortSignal.timeout(30_000));
      report.command = { ok: /^v\d+/i.test(String(output).trim()), command: "node --version", output: String(output).trim().slice(0, 120) };
    } catch (error) {
      report.command = { ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  }

  try {
    fs.rmSync(resolveInside(projectRoot, tempRel), { force: true });
    report.cleanup = { ok: true, path: tempRel };
  } catch (error) {
    report.cleanup = { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
  report.ok = report.list.ok && report.read.ok && (!canWrite || (report.write.ok && report.command.ok));
  return report;
}

function preflightAgentProjectAccess(rootPath, canWrite) {
  const projectRoot = assertProjectRoot(rootPath);
  const evidence = {
    projectRoot,
    readable: false,
    writable: !canWrite,
    checkedAt: new Date().toISOString(),
  };
  fs.accessSync(projectRoot, fs.constants.R_OK);
  evidence.readable = true;
  evidence.rootEntries = listEntries(projectRoot, "").length;
  if (canWrite) {
    const temporary = path.join(projectRoot, `.editcore-agent-access-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, "EditCore agent access check\n", { encoding: "utf8", flag: "wx" });
      evidence.writable = fs.readFileSync(temporary, "utf8").includes("access check");
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  evidence.ok = evidence.readable && evidence.writable;
  if (!evidence.ok) throw new Error("EditCore no pudo comprobar acceso real al proyecto activo.");
  return evidence;
}

async function createVerificationReport() {
  const secure = readSecureState();
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"])
    ? secure["editcore-provider-profiles"].filter((profile) => profile?.status === "active" && profile?.model)
    : [];
  const uniqueProfiles = profiles.filter((profile, index, values) =>
    values.findIndex((candidate) => candidate.providerKey === profile.providerKey && candidate.model === profile.model) === index
  );
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-agent-verify-"));
  let localTools;
  let models;
  try {
    const written = writeProjectFile(projectRoot, "verification.txt", "EditCore agent harness verification");
    const read = readProjectFile(projectRoot, "verification.txt");
    const searched = searchProject(projectRoot, "harness verification");
    const commandOutput = await runProjectCommand(projectRoot, "node --version");
    localTools = {
      ok: Boolean(written.bytes && read.includes("agent harness") && searched.length && /^v\d+/i.test(commandOutput)),
      list: listEntries(projectRoot, "").length > 0,
      read: read.includes("agent harness"),
      search: searched.length > 0,
      write: written.bytes > 0,
      command: /^v\d+/i.test(commandOutput),
    };
    models = await Promise.all(uniqueProfiles.map((profile) => verifyModelAgentProfile(profile, providers, projectRoot)));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
  const connections = await Promise.all(["github", "vercel", "selfsupabase"].map(validateConnection));
  const requiredConnections = {
    github: Boolean(connections.find((item) => item.service === "github")?.ok),
    vercel: Boolean(connections.find((item) => item.service === "vercel")?.ok),
    selfsupabase: Boolean(connections.find((item) => item.service === "selfsupabase" && item.ok)),
  };
  const allModelsOperational = models.length > 0 && models.every((item) => item.ok);
  return {
    generatedAt: new Date().toISOString(),
    connections,
    requiredConnections,
    localTools,
    models,
    summary: {
      allRequiredConnectionsVerified: Object.values(requiredConnections).every(Boolean),
      activeModelsTested: models.length,
      allActiveModelsOperational: allModelsOperational,
      localAgentHarnessOperational: Boolean(localTools?.ok),
      fullyOperational: Object.values(requiredConnections).every(Boolean) && allModelsOperational && Boolean(localTools?.ok),
    },
  };
}

ipcMain.handle("secure-config:load", async () => {
  try {
    return readSecureState();
  } catch (error) {
    throw new Error(`No se pudo abrir la configuración segura: ${error.message}`);
  }
});

ipcMain.handle("patch:apply", async (_event, filePath, diffText, opts = {}) => {
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    const projectRoot = String(options.projectRoot || "").trim() || process.cwd();
    const oldText = Object.prototype.hasOwnProperty.call(options, "oldText") ? options.oldText : undefined;
    const newText = Object.prototype.hasOwnProperty.call(options, "newText")
      ? options.newText
      : (diffText == null ? "" : String(diffText));
    return applyPatch(projectRoot, filePath, oldText, newText, options);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("patch:rollback", async (_event, filePath, backupPath, opts = {}) => {
  try {
    const projectRoot = String(opts?.projectRoot || "").trim();
    return rollbackPatch(filePath, backupPath, projectRoot);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("editor:inline-edit", async (_event, input = {}) => {
  const {
    path: relPath,
    language = "plaintext",
    startLine = 1,
    endLine = 1,
    before = "",
    selection = "",
    after = "",
    instruction = "",
    previousProposal = "",
    model = "",
    providerKey = "",
    apiKey = "",
    baseUrl = "",
  } = input || {};

  if (!instruction || !String(instruction).trim()) {
    return { ok: false, error: "Falta la instrucción." };
  }
  if (!selection && !previousProposal) {
    return { ok: false, error: "Seleccioná código o mové el cursor a una línea." };
  }

  const creds = resolveKernelProviderCredentials();
  const resolvedApiKey = String(apiKey || creds.apiKey || "").trim();
  const resolvedModel = String(model || creds.model || "").trim();
  const resolvedBaseUrl = String(baseUrl || creds.baseUrl || "").trim();
  const resolvedProviderKey = String(providerKey || creds.providerKey || "").trim();
  if (!resolvedApiKey || !resolvedModel || !resolvedBaseUrl) {
    return { ok: false, error: "Configurá un modelo en Modelos antes de usar Inline Edit." };
  }

  const system = [
    "Sos un editor inline de código.",
    "Devolvés EXCLUSIVAMENTE el código nuevo que reemplaza la selección.",
    "Reglas:",
    "- Sin markdown, sin ```, sin explicaciones, sin texto previo ni posterior.",
    "- Sin comentarios agregados salvo que la instrucción lo pida.",
    "- Mantené el estilo del código circundante (indentación, comillas, semicolons).",
    "- Si la instrucción es imposible o ambigua, devolvé la selección sin cambios.",
    "- Preservá imports/exports si están en la selección.",
  ].join("\n");

  const userParts = [
    `Archivo: ${relPath || "(sin path)"}`,
    `Lenguaje: ${language}`,
    `Rango: líneas ${startLine}-${endLine}`,
    before ? `\n--- CONTEXTO ANTES ---\n${before}` : "",
    `\n--- SELECCIÓN A EDITAR ---\n${selection || "(cursor vacío)"}`,
    after ? `\n--- CONTEXTO DESPUÉS ---\n${after}` : "",
    previousProposal ? `\n--- PROPUESTA ANTERIOR (refinar) ---\n${previousProposal}` : "",
    `\n--- INSTRUCCIÓN ---\n${instruction}`,
    "",
    "Devolvé SOLO el código nuevo.",
  ].filter(Boolean).join("\n");

  try {
    const result = await callProvider({
      baseUrl: resolvedBaseUrl,
      apiKey: resolvedApiKey,
      model: resolvedModel,
      providerKey: resolvedProviderKey,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      timeoutMs: 60_000,
      maxAttempts: 1,
      enableTools: false,
      rawToolCalls: false,
      allowProviderFallback: false,
    });

    let proposal = String(result?.text || "").trim();
    const fenced = proposal.match(/```[\w-]*\r?\n([\s\S]*?)\r?\n```/);
    if (fenced) proposal = fenced[1];
    proposal = proposal.replace(/^```[\w-]*\r?\n?/, "").replace(/\r?\n?```$/, "").trim();

    if (!proposal) {
      return { ok: false, error: "El modelo devolvió una respuesta vacía." };
    }
    return { ok: true, proposal };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error).slice(0, 400),
    };
  }
});

ipcMain.handle("patch:list-backups", async (_event, filePath, opts = {}) => {
  try {
    const projectRoot = String(opts?.projectRoot || "").trim();
    return { ok: true, backups: listBackups(filePath, projectRoot) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), backups: [] };
  }
});

ipcMain.handle("secure-config:save", async (_event, value) => {
  const incoming = value && typeof value === "object" ? value : {};
  const disk = readSecureState();
  const merged = { ...disk, ...incoming };

  const diskConn = disk["editcore-connections"] && typeof disk["editcore-connections"] === "object"
    ? disk["editcore-connections"]
    : {};
  const inConn = incoming["editcore-connections"] && typeof incoming["editcore-connections"] === "object"
    ? incoming["editcore-connections"]
    : null;
  if (inConn) {
    const conn = { ...diskConn };
    for (const [key, next] of Object.entries(inConn)) {
      const isSecret = /token|key|password|secret|host|path/i.test(String(key || ""));
      if (isSecret && isBlankConnValue(next) && !isBlankConnValue(diskConn[key])) continue;
      conn[key] = next;
    }
    for (const key of CONNECTION_SECRET_KEYS) {
      if (isBlankConnValue(conn[key]) && !isBlankConnValue(diskConn[key])) conn[key] = diskConn[key];
    }
    delete conn.netlifyToken;
    delete conn.netlifySiteId;
    merged["editcore-connections"] = conn;
  }

  writeSecureState(merged);
  syncOperatorConnectionsToBrain("");
  return true;
});

ipcMain.handle("connections:import-legacy", async () => {
  try {
    return importLegacyConnectionsIntoCurrentVault({ force: true });
  } catch (error) {
    return { ok: false, imported: false, error: String(error?.message || error).slice(0, 200) };
  }
});

ipcMain.handle("agent:approval-response", (_event, input = {}) => {
  const requestId = String(input.requestId || "");
  const pending = pendingAgentApprovals.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingAgentApprovals.delete(requestId);
  pending.resolve(input.approved === true);
  return true;
});

ipcMain.handle("project:ui-command-result", (_event, input = {}) => {
  const requestId = String(input.requestId || "");
  const pending = pendingUiProjectActions.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingUiProjectActions.delete(requestId);
  pending.resolve({
    ok: input.ok === true,
    action: String(input.action || ""),
    projectRoot: String(input.projectRoot || ""),
    previousRoot: String(input.previousRoot || ""),
    label: String(input.label || ""),
    published: input.published === true,
    publishMessage: String(input.publishMessage || ""),
    error: String(input.error || ""),
  });
  return true;
});

const WORKSPACE_SWITCH_TIMEOUT_MS = 5 * 60 * 1000;

ipcMain.handle("workspace:close-current", async (event) => {
  try {
    const result = await requestProjectUiAction(event.sender, { action: "close", cancelAgent: false });
    const previousRoot = String(result?.projectRoot || "").trim();
    if (previousRoot) {
      try {
        const { rememberWorkspaceEvent } = require("./runtime/session");
        rememberWorkspaceEvent(previousRoot, {
          type: "workspace_close",
          message: "Workspace cerrado",
          nextAction: "cerrado",
        });
      } catch { /* ignore */ }
    }
    return {
      ok: result?.ok === true,
      previousRoot,
      label: result?.label || "",
      error: result?.error || "",
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("project:query-mentions", async (_event, payload = {}) => {
  try {
    const { queryMentionCandidates } = require("./runtime/at-mentions-resolver");
    const root = payload.projectRoot || "";
    const query = payload.query || "";
    return queryMentionCandidates(root, query);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("workspace:open-folder", async (event, targetPath) => {
  try {
    const target = resolveOpenProjectTarget(
      { path: String(targetPath || "").trim() },
      { crossProjectAccess: true },
    );
    try {
      const { ensureSessionState, rememberWorkspaceEvent } = require("./runtime/session");
      ensureSessionState(target, { task: "workspace open", nextAction: "listo" });
      rememberWorkspaceEvent(target, {
        type: "workspace_open",
        message: `Workspace abierto: ${path.basename(target)}`,
      });
    } catch { /* ignore */ }
    const result = await requestProjectUiAction(event.sender, {
      action: "open",
      path: target,
      name: path.basename(target),
    });
    return {
      ok: result?.ok === true,
      projectRoot: result?.projectRoot || target,
      label: result?.label || path.basename(target),
      error: result?.error || "",
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("workspace:switch-project", async (event, options = {}) => {
  try {
    const publishFirst = options.publishFirst === true || options.autoPublish === true;
    const target = resolveOpenProjectTarget(
      {
        path: String(options.targetPath || options.path || "").trim(),
        name: String(options.name || "").trim(),
      },
      { crossProjectAccess: true },
    );
    const result = await requestProjectUiAction(
      event.sender,
      {
        action: "switch",
        path: target,
        name: String(options.name || path.basename(target) || ""),
        publishFirst,
        autoPublish: publishFirst,
        cancelAgent: false,
      },
      WORKSPACE_SWITCH_TIMEOUT_MS,
    );
    return {
      ok: result?.ok === true,
      projectRoot: result?.projectRoot || target,
      previousRoot: result?.previousRoot || "",
      label: result?.label || path.basename(target),
      published: result?.published === true,
      publishMessage: result?.publishMessage || "",
      error: result?.error || "",
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("permissions:set", async (event, mode) => {
  const next = ["readonly", "step", "full"].includes(String(mode)) ? String(mode) : "step";
  permissionBySender.set(event.sender.id, next);
  if (windows.get("main")?.webContents?.id === event.sender.id || !mainWindow || mainWindow.webContents.id === event.sender.id) {
    permissionMode = next;
  }
  return next;
});

ipcMain.handle("window:status", () => windowStatus());
ipcMain.handle("window:new", () => {
  if (!canOpenWindow(windows.size)) {
    return { ok: false, ...windowStatus(), reason: `Maximo ${MAX_WINDOWS} ventanas en paralelo (uso personal).` };
  }
  const slot = allocateWindowSlotFromMap();
  if (!slot) {
    return { ok: false, ...windowStatus(), reason: `Maximo ${MAX_WINDOWS} ventanas en paralelo (uso personal).` };
  }
  const created = createWindow({
    windowId: slot,
    // Misma pantalla de inicio que la ventana principal (no forzar dialogo Abrir).
    autoPick: false,
  });
  return { ok: true, windowId: created.windowId, ...windowStatus() };
});

function optionalJarvisLauncher() {
  try {
    return require("./runtime/jarvis-launcher");
  } catch {
    return null;
  }
}

ipcMain.handle("agent:restart-backend", async () => {
  const jarvis = optionalJarvisLauncher();
  if (!jarvis) return false;
  try {
    jarvis.stopJarvis();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const secureState = readSecureState();
    const connections = secureState["editcore-connections"] || {};
    jarvis.startJarvis(app.getPath("userData"), connections);
    return true;
  } catch (err) {
    console.error("[EditCore] Error restarting optional Jarvis sidecar:", err);
    return false;
  }
});

const voiceStt = require("./runtime/voice-stt");
const windowsStt = require("./runtime/windows-stt");

function broadcastWindowsSttText(text) {
  const value = String(text || "").trim();
  if (!value) return;
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send("agent:windows-stt-text", { text: value });
    } catch (_) {}
  }
}

function broadcastWindowsSttStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send("agent:windows-stt-status", status || {});
    } catch (_) {}
  }
}

ipcMain.handle("agent:stt-status", async () => {
  const secure = readSecureState();
  const availability = voiceStt.describeSttAvailability(secure);
  let local = false;
  try {
    const res = await fetch("http://127.0.0.1:8000/voice/status", { signal: AbortSignal.timeout(1500) });
    local = res.ok;
  } catch (_) {
    local = false;
  }
  const windowsDictation = windowsStt.isSupported();
  return {
    ok: true,
    ...availability,
    localSidecar: local,
    windowsDictation,
    canTranscribe: Boolean(
      availability.whisperCandidates.length || availability.gemini || local || windowsDictation
    ),
    note: windowsDictation
      ? (availability.whisperCandidates.length || availability.gemini || local
        ? availability.note
        : "STT local Windows (System.Speech). Claude del chat no transcribe; se usa dictado de Windows.")
      : availability.note,
  };
});

ipcMain.handle("agent:windows-stt-start", async () => {
  if (!windowsStt.isSupported()) return { ok: false, error: "Solo Windows" };
  return windowsStt.start(
    (text) => broadcastWindowsSttText(text),
    (status) => broadcastWindowsSttStatus(status),
  );
});

ipcMain.handle("agent:windows-stt-stop", async () => windowsStt.stop());
ipcMain.handle("agent:windows-stt-pause", async (_event, paused = true) => {
  windowsStt.setPaused(Boolean(paused));
  return { ok: true, paused: Boolean(paused) };
});

ipcMain.handle("agent:transcribe-audio", async (_event, input) => {
  try {
    return await voiceStt.transcribeAudio(input, {
      secure: readSecureState(),
      userDataPath: app.getPath("userData"),
    });
  } catch (err) {
    console.warn("[main] STT error:", err?.message || err);
    return { ok: false, error: String(err?.message || err || "STT falló") };
  }
});

ipcMain.handle("agent:transcribe-local-pcm", async (_event, input = {}) => {
  try {
    const localWhisper = require("./runtime/local-whisper-stt");
    if (!localWhisper.isAvailable()) {
      return { ok: false, error: "Whisper local no instalado" };
    }
    return await localWhisper.transcribePcm({
      int16Base64: String(input.int16Base64 || ""),
      pcm: input.pcm,
      sampleRate: Number(input.sampleRate) || 16000,
      userDataPath: app.getPath("userData"),
      language: String(input.language || "es"),
      onStatus: (msg) => {
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            if (!win.isDestroyed()) win.webContents.send("agent:windows-stt-status", { ready: true, note: msg });
          } catch (_) {}
        }
      },
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "Whisper local falló") };
  }
});

ipcMain.handle("external:open", async (_event, url) => {
  const value = String(url || "").trim();
  if (!/^https:\/\//i.test(value)) throw new Error("Solo se permiten enlaces HTTPS.");
  await shell.openExternal(value);
  return true;
});

ipcMain.handle("models:capabilities", async () => loadModelCapabilities());
ipcMain.handle("models:record-capability", async (_event, input = {}) => {
  recordModelCapability({
    baseUrl: String(input.baseUrl || ""),
    model: String(input.model || ""),
    providerKey: String(input.providerKey || ""),
    ok: Boolean(input.ok),
    error: String(input.error || ""),
  });
  return loadModelCapabilities();
});

ipcMain.handle("models:list", async (_event, input = {}) => {
  const apiKey = String(input.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  const kind = providerKind(input.providerKey, baseUrl);
  if (!apiKey) throw new Error("Falta API key.");
  const response = await fetch(providerModelsUrl(input.baseUrl, input.providerKey, apiKey), {
    headers: providerRequestHeaders(kind, apiKey),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  const models = extractModelIdsFromPayload(data);
  return models;
});

ipcMain.handle("provider:test", async (_event, input = {}) => {
  const apiKey = String(input.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  const kind = providerKind(input.providerKey, baseUrl);
  const requestedModel = String(input.model || "").trim();
  if (!apiKey) throw new Error("Falta API key.");
  const modelsResponse = await fetch(providerModelsUrl(input.baseUrl, input.providerKey, apiKey), {
    headers: providerRequestHeaders(kind, apiKey),
    signal: AbortSignal.timeout(20_000),
  });
  const modelsData = await modelsResponse.json().catch(() => ({}));
  if (!modelsResponse.ok) throw new Error(modelsData?.error?.message || modelsData?.message || `HTTP ${modelsResponse.status}`);
  const models = extractModelIdsFromPayload(modelsData);
  const genericAliases = new Set(["chatgpt", "gpt", "openai", "claude", "kimi", "deepseek", "qwen"]);
  const requestedLower = requestedModel.toLowerCase();
  const isGenericAlias = genericAliases.has(requestedLower);
  const modelMatchesAlias = (model) => {
    const value = String(model || "").toLowerCase();
    if (["chatgpt", "gpt", "openai"].includes(requestedLower)) return /^(gpt-|o[134](?:-|$)|chatgpt)/.test(value);
    return requestedLower ? value.includes(requestedLower) : true;
  };
  const rankedModels = [...models].sort((a, b) => Number(modelMatchesAlias(b)) - Number(modelMatchesAlias(a)));
  const candidates = [...new Set([
    ...(!isGenericAlias && requestedModel ? [requestedModel] : []),
    ...rankedModels,
  ])].slice(0, 8);
  if (!candidates.length) throw new Error("El proveedor no devolvio modelos disponibles.");

  const failures = [];
  for (const model of candidates) {
    try {
      const chat = await callProvider({
        baseUrl,
        apiKey,
        model,
        providerKey: input.providerKey,
        messages: [{ role: "user", content: "Responde solamente OK" }],
        timeoutMs: 20_000,
        maxAttempts: 1,
      });
      if (String(chat.text || "").trim()) {
        let toolOK = false;
        try {
          const capability = await callProvider({
            baseUrl,
            apiKey,
            model,
            providerKey: input.providerKey,
            messages: [
              { role: "system", content: 'Responde SOLO con una accion JSON de herramienta: {"type":"tool","name":"list_files","input":{"path":""}}' },
              { role: "user", content: "Usa list_files ahora." },
            ],
            timeoutMs: 20_000,
            maxAttempts: 1,
            enableTools: true,
          });
          const parsed = parseAgentJson(capability.text);
          toolOK = Boolean(capability.toolCalls?.length || parsed?.type === "tool");
        } catch {}
        return { ok: true, chatOK: true, toolOK, model, models, modelCount: models.length, resolvedAlias: isGenericAlias ? requestedModel : "" };
      }
      failures.push(`${model}: respuesta vacia`);
    } catch (error) {
      failures.push(`${model}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`La clave no tiene un modelo de chat utilizable. ${failures.slice(0, 3).join(" | ")}`);
});

ipcMain.handle("project:pick", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Abrir proyecto" });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("project:pick-parent", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Selecciona la carpeta de destino" });
  if (result.canceled || !result.filePaths[0]) return null;
  return path.resolve(result.filePaths[0]);
});

ipcMain.handle("project:save", async (_event, input = {}) => {
  const root = assertProjectRoot(String(input.root || "").trim());
  const metadataDir = resolveProjectPath(root, ".editcore");
  const target = resolveProjectPath(root, ".editcore/project.json");
  fs.mkdirSync(metadataDir, { recursive: true });
  const packagePath = resolveProjectPath(root, "package.json");
  const packageData = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => !["node_modules", ".git"].includes(entry.name));
  const manifest = {
    schemaVersion: 1,
    name: String(input.name || path.basename(root)).trim().slice(0, 80) || path.basename(root),
    root,
    packageName: String(packageData.name || ""),
    scripts: Object.keys(packageData.scripts || {}),
    topLevelEntries: entries.length,
    savedAt: new Date().toISOString(),
  };
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, target);
  return { ok: true, path: target, manifest };
});

ipcMain.handle("project:save-changes", async (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || input.root || "").trim());
  const mode = String(input.mode || "project").toLowerCase() === "editcore" ? "editcore" : "project";
  const name = String(input.name || path.basename(root)).trim().slice(0, 80) || path.basename(root);

  const metadataDir = resolveProjectPath(root, ".editcore");
  const target = resolveProjectPath(root, ".editcore/project.json");
  fs.mkdirSync(metadataDir, { recursive: true });
  const packagePath = resolveProjectPath(root, "package.json");
  const packageData = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
  const manifest = {
    schemaVersion: 1,
    name,
    root,
    packageName: String(packageData.name || ""),
    scripts: Object.keys(packageData.scripts || {}),
    savedAt: new Date().toISOString(),
    mode,
  };
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const gitRoot = findGitRoot(root);
  if (!gitRoot) {
    return {
      ok: true,
      saved: true,
      committed: false,
      path: target,
      manifest,
      message: "Metadatos guardados. Sin repo git: no hay commit local.",
    };
  }

  // Guardar = metadatos + commit local (sin push). Timeout evita “Guardando…” infinito.
  const commitMessage = String(input.commitMessage || "").trim()
    || (mode === "editcore"
      ? `chore(editcoreai): save ${new Date().toISOString().slice(0, 19)}`
      : `chore: save ${path.basename(root)} ${new Date().toISOString().slice(0, 19)}`);
  const publishPromise = publishProject(root, {
    mode,
    connections: readConnections(),
    deploy: false,
    supabasePush: false,
    skipPush: true,
    preCheck: false,
    commitMessage,
  });
  const timeoutMs = 20000;
  let result;
  try {
    result = await Promise.race([
      publishPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("git_timeout")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (String(error?.message || error) === "git_timeout") {
      return {
        ok: true,
        saved: true,
        committed: false,
        path: target,
        manifest,
        message: "Metadatos guardados. El commit local tardó demasiado y se omitió; el preview se restaura.",
      };
    }
    throw error;
  }
  return {
    ok: result.ok !== false,
    saved: true,
    committed: Boolean(result.steps?.find((s) => s.step === "git_commit")?.committed),
    path: target,
    manifest,
    publishSteps: result.steps || [],
    message: result.ok
      ? (result.steps?.find((s) => s.step === "git_commit")?.committed
        ? "Cambios guardados (commit local). Usa Publicar para push/deploy con Conexiones."
        : "Metadatos guardados. Working tree limpio (sin commit nuevo).")
      : (result.message || "No se pudieron guardar los cambios"),
  };
});

ipcMain.handle("project:templates", () => projectScaffoldService.listTemplates());

ipcMain.handle("project:cancel-create", (event) => {
  const controller = activeProjectRuns.get(event.sender.id);
  if (!controller) return false;
  controller.abort(new Error("Creacion cancelada por el usuario."));
  return true;
});

ipcMain.handle("project:create", async (event, input = {}) => {
  const name = String(input.name || "").trim();
  buildProjectTemplate({ name, template: "blank" });
  let parentPath = String(input.parentPath || "").trim();
  if (!parentPath) {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Selecciona la carpeta donde crear el proyecto" });
    if (picked.canceled || !picked.filePaths[0]) return null;
    parentPath = picked.filePaths[0];
  }
  parentPath = path.resolve(parentPath);
  if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) throw new Error("La carpeta de destino no existe.");
  activeProjectRuns.get(event.sender.id)?.abort(new Error("Reemplazado por una nueva creacion."));
  const controller = new AbortController();
  activeProjectRuns.set(event.sender.id, controller);
  const runId = String(input.runId || crypto.randomUUID());
  const sendProgress = (value) => {
    if (!event.sender.isDestroyed()) event.sender.send("project:progress", { ...value, runId });
  };
  try {
    return await projectScaffoldService.create({
      name,
      template: String(input.template || "blank"),
      parentPath,
      install: input.install !== false,
    }, {
      signal: controller.signal,
      onProgress: sendProgress,
      onOutput: (chunk) => sendProgress({ stage: "command-output", message: String(chunk).trim().slice(-600), state: "running" }),
    });
  } finally {
    if (activeProjectRuns.get(event.sender.id) === controller) activeProjectRuns.delete(event.sender.id);
  }
});

ipcMain.handle("project:list", (_event, rootPath, relativePath = "") => listEntries(rootPath, relativePath));

function assertSafeProjectRel(rel = "") {
  const normalized = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized === "." || normalized.includes("..")) {
    throw new Error("Ruta invalida.");
  }
  return normalized;
}

ipcMain.handle("project:reveal-in-folder", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const rawRel = String(input.path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!rawRel || rawRel === ".") {
    shell.showItemInFolder(root);
    return { ok: true, path: root };
  }
  const rel = assertSafeProjectRel(rawRel);
  const target = resolveInside(root, rel);
  if (!fs.existsSync(target)) throw new Error(`No existe: ${rel}`);
  shell.showItemInFolder(target);
  return { ok: true, path: rel };
});

ipcMain.handle("project:open-path", async (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  if (!fs.existsSync(target)) throw new Error(`No existe: ${rel}`);
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
  return { ok: true, path: rel };
});

ipcMain.handle("project:copy-path", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const absolute = input.absolute === true;
  const value = absolute ? resolveInside(root, rel) : rel.replace(/\\/g, "/");
  clipboard.writeText(String(value));
  return { ok: true, path: value };
});

ipcMain.handle("project:create-file", (event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  if (fs.existsSync(target)) throw new Error(`Ya existe: ${rel}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(input.content ?? ""), "utf8");
  const result = { path: rel, created: true };
  emitProjectFilesChanged(event, root, "write_file", { path: rel }, result);
  return { ok: true, ...result };
});

ipcMain.handle("project:mkdir", (event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  if (fs.existsSync(target)) throw new Error(`Ya existe: ${rel}`);
  fs.mkdirSync(target, { recursive: true });
  const result = { path: rel, created: true };
  emitProjectFilesChanged(event, root, "write_file", { path: rel }, result);
  return { ok: true, ...result };
});

ipcMain.handle("project:rename-entry", (event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const fromRel = assertSafeProjectRel(input.from);
  const toRel = assertSafeProjectRel(input.to);
  const from = resolveInside(root, fromRel);
  const to = resolveInside(root, toRel);
  if (!fs.existsSync(from)) throw new Error(`No existe: ${fromRel}`);
  if (fs.existsSync(to)) throw new Error(`Ya existe: ${toRel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  const result = { from: fromRel, to: toRel, renamed: true };
  emitProjectFilesChanged(event, root, "write_file", { path: toRel }, result);
  return { ok: true, ...result };
});

ipcMain.handle("project:delete-entry", (event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  if (!fs.existsSync(target)) throw new Error(`No existe: ${rel}`);
  const st = fs.statSync(target);
  const base = path.basename(rel);
  if (/^(package\.json|main\.js|\.env)$/i.test(base) || /^\.env\./i.test(base)) {
    throw new Error(`Borrado bloqueado por seguridad: ${rel}`);
  }
  if (st.isDirectory()) {
    const recursive = input.recursive === true;
    if (!recursive) {
      const kids = fs.readdirSync(target);
      if (kids.length) throw new Error("La carpeta no esta vacia. Confirma borrado recursivo.");
      fs.rmdirSync(target);
    } else {
      fs.rmSync(target, { recursive: true, force: false });
    }
    const result = { path: rel, deleted: true, directory: true };
    emitProjectFilesChanged(event, root, "delete_file", { path: rel }, result);
    return { ok: true, ...result };
  }
  const result = deleteProjectFile(root, rel);
  emitProjectFilesChanged(event, root, "delete_file", { path: rel }, result);
  return { ok: true, ...result };
});

ipcMain.handle("project:write-text", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const rel = String(input.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) throw new Error("Ruta invalida.");
  // Solo exports/notas bajo .editcore/ para no abrir escritura arbitraria desde UI.
  if (!/^\.editcore\//i.test(rel)) throw new Error("Solo se permite escribir bajo .editcore/.");
  const result = writeProjectFile(root, rel, String(input.content || ""));
  return { ok: true, ...result };
});

ipcMain.handle("project:read-text", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`No es un archivo: ${rel}`);
  }
  const stat = fs.statSync(target);
  if (stat.size > 2_000_000) throw new Error("Archivo demasiado grande para el editor (>2MB).");
  const content = fs.readFileSync(target, "utf8");
  return { ok: true, path: rel, content, size: stat.size };
});

ipcMain.handle("project:save-editor", (event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const rel = assertSafeProjectRel(input.path);
  const target = resolveInside(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(input.content ?? ""), "utf8");
  const result = { path: rel, written: true };
  emitProjectFilesChanged(event, root, "write_file", { path: rel }, result);
  return { ok: true, ...result };
});

ipcMain.handle("project:goto-definition", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const { gotoDefinition } = require("./runtime/symbol-nav");
  const hit = gotoDefinition(root, String(input.symbol || ""), {
    fromPath: String(input.fromPath || ""),
    resolveInside,
  });
  return hit || { ok: false };
});
ipcMain.handle("project:catalog", (_event, parentPath) => listProjectCatalog(String(parentPath || "").trim()));
ipcMain.handle("project:resolve-special-folder", (_event, key = "") => {
  const alias = String(key || "").trim().toLowerCase();
  const map = {
    documents: "documents",
    downloads: "downloads",
    desktop: "desktop",
    home: "home",
  };
  const electronKey = map[alias];
  if (!electronKey) return "";
  try {
    return app.getPath(electronKey);
  } catch {
    return "";
  }
});
ipcMain.handle("project:preview-start", async (event, rootPath) => {
  try {
    const raw = String(rootPath || "").trim();
    if (!raw) return { available: false, url: "", message: "Abre un proyecto primero." };
    const result = await startProjectPreview(raw, event.sender.id);
    try {
      const { appendPreviewLog } = require("./runtime/log-tail");
      const root = assertProjectRoot(raw);
      appendPreviewLog(root, `${new Date().toISOString()} preview-start ${result?.url || ""}\n`);
    } catch { /* ignore */ }
    return result;
  } catch (error) {
    const message = String(error?.message || error || "No se pudo iniciar el preview.");
    const line = `${new Date().toISOString()} ${String(error?.stack || error).slice(0, 2000)}\n`;
    try { fs.appendFileSync(path.join(app.getPath("userData"), "preview-errors.log"), line, "utf8"); } catch { /* ignore */ }
    logPreviewRuntime(`preview-start fallo: ${message.slice(0, 400)}`);
    // No lanzar: el renderer debe mostrar el mensaje y seguir usable.
    return { available: false, url: "", message: message.slice(0, 1200) };
  }
});
ipcMain.handle("project:preview-stop", async (_event, rootPath) => {
  const raw = String(rootPath || "").trim();
  if (!raw) return { ok: true, stopped: false };
  let safeRoot = "";
  try { safeRoot = assertProjectRoot(raw); } catch { return { ok: true, stopped: false }; }
  const runtime = previewProcesses.get(safeRoot);
  if (!runtime) return { ok: true, stopped: false };
  stopPreviewRuntime(runtime);
  previewProcesses.delete(safeRoot);
  previewStartPromises.delete(safeRoot);
  return { ok: true, stopped: true };
});
ipcMain.handle("project:preview-health", async (event, rootPath) => {
  const safeRoot = assertProjectRoot(String(rootPath || "").trim());
  const runtime = previewProcesses.get(safeRoot);
  if (runtime?.remote && runtime.url) {
    return { available: true, url: runtime.url, remote: true, pid: 0 };
  }
  if (!runtime?.child || runtime.child.exitCode !== null || !runtime.url) {
    return { available: false, url: runtime?.url || "", reason: "Preview no iniciado." };
  }
  const currentRuntimeRoot = findRunnableProjectRoot(safeRoot);
  if (!currentRuntimeRoot
    || runtime.fingerprint !== previewRuntimeFingerprint(safeRoot, currentRuntimeRoot)) {
    logPreviewRuntime(`Configuracion de preview modificada; reiniciando ${safeRoot}`);
    stopPreviewRuntime(runtime);
    previewProcesses.delete(safeRoot);
    return { available: false, url: "", reason: "La configuracion del proyecto cambio; reiniciando preview." };
  }
  try {
    if (!(await isHttpReady(runtime.url))) throw new Error("El preview no devolvio un documento HTML disponible.");
    return { available: true, url: runtime.url, pid: runtime.child.pid };
  } catch (error) {
    logPreviewRuntime("Preview existente sin respuesta; reiniciando", error);
    stopPreviewRuntime(runtime);
    previewProcesses.delete(safeRoot);
    return { available: false, url: "", reason: "Preview existente sin respuesta; reiniciando" };
  }
});

ipcMain.handle("project:deploy", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const provider = String(input.provider || "auto").toLowerCase();
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed()) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Desplegar"],
      defaultId: 1,
      cancelId: 0,
      title: "Deploy one-click",
      message: `Desplegar el proyecto con ${provider === "vercel" ? "Vercel" : "Vercel (auto)"}?`,
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Deploy cancelado por el usuario." };
    }
  }
  return deployOneClick(rootPath, {
    provider: provider === "auto" ? "" : provider,
    production: input.production !== false,
    dir: input.dir || "",
  }, { connections: readConnections() });
});

ipcMain.handle("project:publish", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const mode = String(input.mode || "project").toLowerCase() === "editcore" ? "editcore" : "project";
  const connections = readConnections();
  const missing = [];
  if (!String(connections.githubToken || "").trim()) missing.push("GitHub (token en Conexiones)");
  if (mode === "project" && input.deploy !== false && !String(connections.vercelToken || "").trim()) {
    // Deploy es opcional si no hay Vercel; se advertirá en el pipeline.
  }
  if (missing.length) {
    return {
      ok: false,
      cancelled: false,
      message: `Publicar usa las Conexiones de EditCoreAI. Falta: ${missing.join(", ")}. Abre Conexiones y configura el token.`,
      missing,
    };
  }
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Publicar"],
      defaultId: 1,
      cancelId: 0,
      title: mode === "editcore" ? "Publicar EditCoreAI" : "Publicar proyecto",
      message: mode === "editcore"
        ? "Commit + push de EditCoreAI con el token GitHub de Conexiones (y ASAR si aplica)?"
        : "Commit + push con GitHub de Conexiones, Supabase si aplica, y deploy Vercel con el token de Conexiones?",
      detail: `${rootPath}\n\nFuente de credenciales: bóveda EditCoreAI (independiente de otras carpetas legacy).`,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Publicacion cancelada por el usuario." };
    }
  }
  return publishProject(rootPath, {
    mode,
    connections,
    deploy: input.deploy !== false && mode === "project",
    supabasePush: input.supabasePush !== false && mode === "project",
    commitMessage: String(input.commitMessage || ""),
    skipPush: input.skipPush === true,
  });
});

ipcMain.handle("project:connect", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Conectar"],
      defaultId: 1,
      cancelId: 0,
      title: "Conectar proyecto",
      message: "Enlazar este proyecto a GitHub / Vercel / Supabase usando Conexiones de EditCore?",
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Conexion cancelada por el usuario." };
    }
  }
  return connectProject(rootPath, readConnections(), {
    createGithub: input.createGithub !== false,
    createVercel: input.createVercel !== false,
    linkSupabase: input.linkSupabase !== false,
    repoName: String(input.repoName || ""),
  });
});

ipcMain.handle("project:assess-connections", async (_event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  return assessProjectConnections(rootPath, readConnections());
});

ipcMain.handle("project:onboard", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Conectar"],
      defaultId: 1,
      cancelId: 0,
      title: "Conectar proyecto",
      message: "Instalar dependencias y enlazar este proyecto a GitHub, Vercel y Supabase?",
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Conexion cancelada." };
    }
  }
  return onboardProject(rootPath, readConnections(), {
    localProjectId: String(input.localProjectId || ""),
    projectName: String(input.projectName || path.basename(rootPath)),
    installDeps: input.installDeps !== false,
    bootstrapSupabase: input.bootstrapSupabase !== false,
    connectServices: input.connectServices !== false,
    connectGateway: false,
    firstDeploy: input.firstDeploy === true,
    initialBalanceUsd: 0,
    adminToken: "",
    repoName: String(input.repoName || ""),
    connectGatewayProject: null,
  });
});

ipcMain.handle("project:provision", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Aprovisionar"],
      defaultId: 1,
      cancelId: 0,
      title: "Aprovisionar proyecto",
      message: "Conectar GitHub/Vercel/Supabase, sincronizar envs, validar y publicar si corresponde?",
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Aprovisionamiento cancelado." };
    }
  }
  return provisionProject(rootPath, readConnections(), {
    repoName: String(input.repoName || ""),
    syncVercel: input.syncVercel !== false,
    manageSupabase: input.manageSupabase !== false,
    validateBeforePublish: input.validateBeforePublish !== false,
    firstDeploy: input.firstDeploy === true,
    sshAfterPublish: input.sshAfterPublish === true,
    commitMessage: String(input.commitMessage || ""),
  });
});

ipcMain.handle("project:fullstack-deploy", async (event, input = {}) => {
  const { executeFullStackDeploy } = require("./runtime/fullstack-deploy");
  const rootPath = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const connections = readConnections();
  if (!String(connections.githubToken || "").trim()) {
    return {
      ok: false,
      cancelled: false,
      message: "Publicar requiere GitHub en Conexiones (bóveda safeStorage).",
      missing: ["github"],
    };
  }
  const isUpdate = String(input.mode || "full").toLowerCase() === "update";
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", isUpdate ? "Actualizar" : "Publicar"],
      defaultId: 1,
      cancelId: 0,
      title: isUpdate ? "Actualizar publicación" : "Publicar",
      message: isUpdate
        ? "Actualizará la publicación en vivo: commit → push → redeploy Vercel (token de Conexiones; sin login OAuth aparte)."
        : "Publicará el proyecto: GitHub (push) → Vercel (token en Conexiones) → Supabase → Live. Vercel no pide permiso OAuth aparte: usa el token guardado.",
      detail: `${rootPath}\n\nCredenciales: bóveda EditCoreAI (safeStorage). Git puede pedir confirmación al hacer push; Vercel usa el token de Conexiones en silencio.`,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Publicación cancelada por el usuario." };
    }
  }
  const sender = event.sender;
  return executeFullStackDeploy(rootPath, connections, {
    repoName: String(input.repoName || ""),
    commitMessage: String(input.commitMessage || ""),
    skipDeploy: input.skipDeploy === true,
    skipPreCheck: input.skipPreCheck === true,
    rollbackOnFail: input.rollbackOnFail !== false,
    mode: isUpdate ? "update" : "full",
    onProgress: (payload) => {
      if (sender && !sender.isDestroyed()) {
        sender.send("project:fullstack-progress", payload);
      }
    },
  });
});

ipcMain.handle("project:health", async (_event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  return checkProjectHealth(rootPath, readConnections());
});

ipcMain.handle("project:health-all", async (_event, input = {}) => {
  const projects = Array.isArray(input.projects) ? input.projects : [];
  return checkAllProjects(projects, readConnections());
});

ipcMain.handle("project:audit", async (_event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  return { ok: true, events: readAuditEvents(rootPath, { limit: Number(input.limit) || 50 }) };
});

ipcMain.handle("project:sync-vercel-env", async (_event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  return syncEnvToVercel(rootPath, readConnections(), {
    projectId: String(input.projectId || ""),
    projectName: String(input.projectName || ""),
  });
});

ipcMain.handle("project:supabase-manage", async (_event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  return manageSupabaseProject(rootPath, readConnections(), {
    ensureBucket: input.ensureBucket !== false,
    bucketName: String(input.bucketName || "uploads"),
  });
});

ipcMain.handle("project:ssh-deploy", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Desplegar SSH"],
      defaultId: 1,
      cancelId: 0,
      title: "Deploy por SSH",
      message: "Ejecutar git pull y reinicio en el servidor configurado?",
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Deploy SSH cancelado." };
    }
  }
  return sshDeploy(rootPath, readConnections(), {
    remotePath: String(input.remotePath || ""),
    restartCommand: String(input.restartCommand || ""),
  });
});

ipcMain.handle("maintenance:scheduler-get", async () => getSchedulerConfig(readSecureState));

ipcMain.handle("maintenance:scheduler-set", async (_event, patch = {}) => {
  if (maintenanceScheduler) return maintenanceScheduler.updateConfig(patch || {});
  return setSchedulerConfig(readSecureState, writeSecureState, patch || {});
});

ipcMain.handle("maintenance:sync-projects", async (_event, projects = []) => {
  return syncProjectRegistry(readSecureState, writeSecureState, Array.isArray(projects) ? projects : []);
});

ipcMain.handle("maintenance:run-now", async () => {
  if (maintenanceScheduler) return maintenanceScheduler.tick({ notify: true });
  return runMaintenanceCheck({
    readSecureState,
    writeSecureState,
    readConnections,
    notify: true,
  });
});

ipcMain.handle("project:supabase-create", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (owner && !owner.isDestroyed() && input.confirm !== false) {
    const result = await dialog.showMessageBox(owner, {
      type: "question",
      buttons: ["Cancelar", "Crear"],
      defaultId: 1,
      cancelId: 0,
      title: "Crear proyecto Supabase",
      message: input.useCloud
        ? "Crear proyecto en Supabase Cloud y enlazar esta carpeta?"
        : "Inicializar supabase/ en este proyecto y enlazar tu Supabase (GafCore)?",
      detail: rootPath,
    });
    if (result.response !== 1) {
      return { ok: false, cancelled: true, message: "Creacion Supabase cancelada." };
    }
  }
  const connections = readConnections();
  const created = await createSupabaseProject(rootPath, connections, {
    projectName: String(input.projectName || path.basename(rootPath)),
    useCloud: input.useCloud === true,
    bucketName: String(input.bucketName || "uploads"),
    pushDb: input.pushDb !== false,
  });
  if (created.connectionsPatch) {
    const secure = readSecureState();
    const current = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
      ? secure["editcore-connections"]
      : {};
    secure["editcore-connections"] = { ...current, ...created.connectionsPatch };
    writeSecureState(secure);
  }
  return created;
});

ipcMain.handle("app:check-updates", async () => {
  let packageJson = {};
  try {
    packageJson = require("./package.json");
  } catch {}
  return checkForUpdates({
    currentVersion: RUNTIME_VERSION || packageJson.version || "2.7.0",
    packageJson,
  });
});

ipcMain.handle("app:open-external", async (_event, url = "") => {
  const target = String(url || "").trim();
  if (!/^https:\/\//i.test(target)) throw new Error("Solo se permiten URLs https.");
  await shell.openExternal(target);
  return { ok: true };
});

ipcMain.handle("app:version", () => {
  try {
    const pkgVer = app.getVersion() || require("./package.json").version || "3.0.7";
    return pkgVer.startsWith("v") ? pkgVer : `v${pkgVer}`;
  } catch {
    return "v3.0.7";
  }
});

const skillsEngine = require("./runtime/skills-engine");

ipcMain.handle("skills:list", (_event, projectRoot = "") => {
  return skillsEngine.listAllSkills({
    projectRoot: String(projectRoot || globalActiveWorkspacePath || "").trim(),
    userDataPath: app.getPath("userData"),
  });
});

ipcMain.handle("skills:save", (_event, input = {}) => {
  return skillsEngine.saveSkill({
    ...input,
    projectRoot: String(input?.projectRoot || globalActiveWorkspacePath || "").trim(),
    userDataPath: app.getPath("userData"),
  });
});

ipcMain.handle("skills:delete", (_event, input = {}) => {
  return skillsEngine.deleteSkill({
    ...input,
    projectRoot: String(input?.projectRoot || globalActiveWorkspacePath || "").trim(),
    userDataPath: app.getPath("userData"),
  });
});

ipcMain.handle("skills:toggle", (_event, input = {}) => {
  return skillsEngine.toggleSkill({
    ...input,
    userDataPath: app.getPath("userData"),
  });
});

function appWindowTitle() {
  return "EditCore";
}

function applyNativeChromeForTheme(theme = "blanco", win = null) {
  const next = String(theme || "blanco").trim().toLowerCase();
  const dark = next === "gris" || next === "negro" || next === "azul";
  try {
    nativeTheme.themeSource = dark ? "dark" : "light";
  } catch { /* ignore */ }
  const palette = {
    blanco: { bg: "#f3f3f3", bar: "#fcfcfc", fg: "#1f1f1f" },
    gris: { bg: "#1e1e1e", bar: "#181818", fg: "#cccccc" },
    negro: { bg: "#0d0d0d", bar: "#141414", fg: "#d4d4d4" },
    azul: { bg: "#0f1720", bar: "#15202b", fg: "#d7e2ec" },
  };
  const colors = palette[next] || palette.blanco;
  const targets = win && !win.isDestroyed()
    ? [win]
    : BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
  for (const target of targets) {
    try { target.setTitle(appWindowTitle()); } catch { /* ignore */ }
    try { target.setBackgroundColor(colors.bg); } catch { /* ignore */ }
    try {
      if (typeof target.setTitleBarOverlay === "function") {
        target.setTitleBarOverlay({
          color: colors.bar,
          symbolColor: colors.fg,
          height: 36,
        });
      }
    } catch { /* ignore */ }
  }
  return { theme: next, dark, title: appWindowTitle() };
}

ipcMain.handle("app:set-ui-theme", (event, theme = "blanco") => {
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return applyNativeChromeForTheme(theme, owner);
});

ipcMain.handle("session:load", () => {
  const { loadUiSession } = require("./runtime/ui-session-store");
  return loadUiSession(app.getPath("userData"));
});
ipcMain.handle("session:save", (event, payload = {}) => {
  const { saveUiSession } = require("./runtime/ui-session-store");
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const activeId = String(payload?.activeProjectId || "").trim();
  const active = projects.find((item) => item?.id === activeId && item?.projectRoot)
    || projects.find((item) => item?.projectRoot);
  if (active?.projectRoot) rememberActiveWorkspace(event?.sender?.id, active.projectRoot);
  return saveUiSession(app.getPath("userData"), payload || {});
});
// Flush sincrono para pagehide / beforeunload / crash cercano.
ipcMain.on("session:flush-sync", (event, payload = {}) => {
  try {
    const { saveUiSession } = require("./runtime/ui-session-store");
    saveUiSession(app.getPath("userData"), payload || {});
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const { saveProjectChats } = require("./runtime/project-chat-store");
    for (const project of projects) {
      const root = String(project?.projectRoot || "").trim();
      if (!root) continue;
      try {
        saveProjectChats(root, {
          chats: project.chats,
          activeChatId: project.activeChatId,
          messages: project.messages,
        });
      } catch { /* ignore one project */ }
    }
    event.returnValue = { ok: true };
  } catch (error) {
    event.returnValue = { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle("project:chats-save", (_event, input = {}) => {
  const { saveProjectChats } = require("./runtime/project-chat-store");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return saveProjectChats(root, input);
});

ipcMain.handle("project:chats-load", (_event, input = {}) => {
  const { loadProjectChats } = require("./runtime/project-chat-store");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return loadProjectChats(root);
});

ipcMain.handle("window:reload", (event) => {
  event.sender.reloadIgnoringCache();
  return true;
});
ipcMain.handle("window:relaunch", () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("window:confirm", async (_event, title, message, confirmLabel, cancelLabel) => {
  const { dialog } = require("electron");
  const result = await dialog.showMessageBox({
    type: "question",
    title: String(title || "Confirmar"),
    message: String(message || ""),
    buttons: [String(confirmLabel || "OK"), String(cancelLabel || "Cancelar")],
    defaultId: 0,
    cancelId: 1,
  });
  return result.response === 0;
});

ipcMain.handle("agent:verify-model", async (_event, input = {}) => {
  const projectRoot = assertProjectRoot(String(input.projectRoot || "").trim());
  const provider = {
    providerKey: String(input.providerKey || "provider"),
    baseUrl: normalizeBaseUrl(input.baseUrl, input.providerKey),
    apiKey: String(input.apiKey || "").trim(),
  };
  const model = String(input.model || "").trim();
  if (!provider.baseUrl || !provider.apiKey || !model) throw new Error("Perfil de modelo incompleto.");
  return verifyOneProviderModel(provider, model, projectRoot);
});

ipcMain.handle("agent:verify", async (event, input = {}) => {
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  const permission = String(input.permissionMode || permissionMode);
  const startedAt = Date.now();
  const projectAccess = await verifyAgentProjectAccess(event, rootPath, permission);
  const providerModels = await verifyAllConfiguredModels(rootPath);
  const modelRows = providerModels.flatMap((provider) => provider.models || []);
  const summary = {
    projectOK: projectAccess.ok,
    providersConfigured: providerModels.length,
    modelsTested: modelRows.length,
    chatOK: modelRows.filter((item) => item.chatOK).length,
    toolOK: modelRows.filter((item) => item.toolOK).length,
    fullyOperational: projectAccess.ok && modelRows.length > 0 && modelRows.some((item) => item.toolOK),
    durationMs: Date.now() - startedAt,
  };
  return {
    checkedAt: new Date().toISOString(),
    projectAccess,
    providerModels,
    summary,
  };
});

ipcMain.handle("agent:plan", async (event, input = {}) => {
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  const task = String(input.prompt || "").trim();
  const planRunId = String(input.runId || `plan-${crypto.randomUUID()}`);
  const planController = new AbortController();
  const planRunKeyValue = planRunKey(event.sender.id, planRunId);
  activePlanRuns.set(planRunKeyValue, {
    runId: planRunId,
    senderId: event.sender.id,
    controller: planController,
    startedAt: Date.now(),
  });
  const sendPlanProgress = (payload = {}) => {
    publishAgentProgress(event.sender, {
      runId: planRunId,
      projectId: String(input.projectId || ""),
      stage: "planning",
      ...payload,
    });
  };
  const persistedTask = String(input.persistedPrompt || redactSensitive(task) || "").trim();
  if (!apiKey || !model || !task) {
    activePlanRuns.delete(planRunKeyValue);
    throw new Error("Faltan datos para analizar la tarea.");
  }
  const rootPath = assertProjectRoot(String(input.projectRoot || "").trim());
  let taskId = String(input.taskId || "").trim();
  try {
    sendPlanProgress({ phase: "plan_stage", text: "Preparando contexto del proyecto..." });
    const brainStarted = Date.now();
    const brainProgressTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - brainStarted) / 1000);
      sendPlanProgress({
        phase: "plan_stage",
        text: seconds > 0 ? `Cargando Cerebro... (${seconds}s)` : "Preparando contexto del proyecto...",
      });
    }, 2500);
    let brainCtx = "";
    try {
      brainCtx = await brain().assembleContext(rootPath, task).catch(() => "");
    } finally {
      clearInterval(brainProgressTimer);
    }
    if (planController.signal.aborted) throw planController.signal.reason || new Error("Plan cancelado por el usuario.");
    const analysisCtx = String(input.analysisContext || "");
    const messages = [{
      role: "system",
      content: [
        "Eres el planificador de EditCore Agent. Responde siempre en español.",
        "Esta fase solo propone: nunca afirmes que ejecutaste, modificaste o verificaste cambios.",
      "Responde como un colaborador de IDE en markdown estructurado y legible.",
      "Estructura OBLIGATORIA:",
      "## Entendimiento",
      "2-3 frases claras de lo que pediste.",
      "## Plan paso a paso",
      "Lista numerada con pasos concretos (1., 2., 3.) — qué harás, en qué archivos y por qué.",
      "## Riesgos y verificación",
      "Riesgos reales y cómo comprobarás el resultado.",
      "Puedes mencionar archivos concretos dentro de cada paso solo si ya tienes evidencia.",
      "No muestres nombres internos de herramientas ni inventarios de carpetas.",
        "No ejecutes y no pidas datos salvo que exista un bloqueo indispensable.",
        "Termina exactamente con: Cuando autorices procedo con los cambios.",
        brainCtx ? `\n## Contexto del proyecto\n${brainCtx}` : "",
        analysisCtx ? `\n## Análisis previo del proyecto\n${analysisCtx}` : "",
      ].filter(Boolean).join("\n"),
    }, {
      role: "user",
      content: `Solicitud:\n${truncateText(task, 4000)}`,
    }];
    if (taskManager) {
      let current = taskId ? tasks().getTask(taskId) : null;
      if (!current) {
        current = tasks().createTask({ taskId: taskId || undefined, projectId: String(input.projectId || ""), projectRoot: rootPath, goal: persistedTask, originalRequest: persistedTask, nextAction: { type: "PLAN", description: "Crear un plan verificable.", status: "RUNNING" } });
        taskId = current.taskId;
      }
      if (current.status === "CREATED") tasks().transition(taskId, "PLANNING");
      tasks().recordModelEvent(taskId, "MODEL_REQUEST_STARTED", { stage: "planning" });
    }
    sendPlanProgress({ phase: "plan_stage", text: "Revisando la solicitud y el contexto durable del proyecto..." });
    const result = await callProvider({
      baseUrl, apiKey, model, providerKey: input.providerKey, messages,
      timeoutMs: AGENT_PLAN_TIMEOUT_MS, maxAttempts: 1,
      signal: planController.signal,
      allowProviderFallback: false,
      onTextDelta: (text) => sendPlanProgress({ phase: "plan_delta", text }),
    });
    const text = String(result.text || "").trim();
    const authorizationLine = "Cuando autorices procedo con los cambios.";
    const conversationalText = text
      .replace(/^\s*(?:#{1,6}\s*)?(?:[-*•]|\d+[.)])\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const planText = conversationalText
      ? conversationalText.replace(/\s*(Autoriza con ADELANTE, PROCEDE o CONTINUA\.?|Cuando autorices procedo con los cambios\.?)\s*$/i, "").trim()
      : "Entendi la solicitud. Primero revisare el contexto real del proyecto para ubicar la causa y confirmar que el cambio corresponde a lo que pediste. Despues propondre la correccion concreta y la aplicare solo cuando la autorices. Al terminar comprobare el resultado con una prueba verificable y te informare cualquier bloqueo, sin marcarlo como terminado si la evidencia no existe.";
    if (taskId && taskManager) {
      const planReference = tasks().reference(planText, { kind: "agent-plan", taskId, projectId: String(input.projectId || "") });
      tasks().recordModelEvent(taskId, "MODEL_REQUEST_COMPLETED", { stage: "planning" });
      tasks().recordRuntimeEvent(taskId, "PLAN_CREATED", { payloadReference: planReference, stage: "planning" });
      tasks().transition(taskId, "READY", { planReference, nextAction: { type: "AUTHORIZE", description: "Esperar autorizacion del usuario para ejecutar el plan.", status: "WAITING" } });
      tasks().updateTokenUsage(taskId, "", result.usage || {});
    }
    return {
      taskId,
      text: `${planText}\n\n${authorizationLine}`,
      usage: result.usage,
    };
  } catch (error) {
    if (taskId && taskManager && !planController.signal.aborted) {
      tasks().recordModelEvent(taskId, "MODEL_REQUEST_FAILED", { stage: "planning", metadata: { error: String(error?.message || error).slice(0, 500) } });
      tasks().markTaskFailed(taskId, error, { recoverable: true, stage: "planning" });
    }
    if (planController.signal.aborted) throw planController.signal.reason || new Error("Plan cancelado por el usuario.");
    throw error;
  } finally {
    activePlanRuns.delete(planRunKeyValue);
  }
});

ipcMain.handle("agent:run", async (event, input = {}) => {
  // Validaciones básicas
  let apiKey = String(input.apiKey || "").trim();
  let model = String(input.model || "").trim();
  let baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey);
  let providerKey = String(input.providerKey || "");
  const runImages = normalizeImages(input.images);
  const task = String(input.prompt || "").trim() || (runImages.length ? "Analiza la imagen adjunta." : "");

  if (!task) throw new Error("Falta tarea.");

  if (runImages.length) {
    const routed = ensureVisionRoute({
      model,
      images: runImages,
      candidates: fallbackProviderProfiles({ providerKey, baseUrl, model, apiKey }),
    });
    if (routed.routed && routed.model) {
      model = routed.model;
      if (routed.apiKey) apiKey = routed.apiKey;
      if (routed.baseUrl) baseUrl = normalizeBaseUrl(routed.baseUrl, routed.providerKey || providerKey);
      if (routed.providerKey) providerKey = routed.providerKey;
    }
  }

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

  const learnSkill = skillsEngine.parseLearnPrompt(task);
  if (learnSkill && learnSkill.isLearn) {
    try {
      const saved = skillsEngine.saveSkill({
        name: learnSkill.name,
        description: learnSkill.description,
        category: learnSkill.category,
        content: learnSkill.content,
        scope: "global",
        userDataPath: app.getPath("userData"),
        projectRoot: resolveIncomingWorkspaceRoot(event, input, task) || "",
      });
      const confirmText = [
        `## ✅ Habilidad aprendida e integrada con éxito`,
        ``,
        `- **Nombre:** \`${saved.name}\``,
        `- **Categoría:** \`${learnSkill.category}\``,
        `- **Descripción:** ${learnSkill.description}`,
        `- **Ubicación:** \`${saved.filePath}\``,
        ``,
        `He registrado e indexado esta habilidad en el repositorio de habilidades. A partir de ahora, cuando me pidas tareas que requieran esta especialidad, activaré automáticamente estas directivas.`,
      ].join("\n");
      return {
        text: confirmText,
        steps: [{ name: "skill_learned", ok: true, input: { name: saved.name } }],
        usage: { confirmed_input_tokens: 0, confirmed_output_tokens: 0, local_response: true },
        report: { completed: true, toolCount: 1, changedFiles: [saved.filePath], kernel: true },
        kernel: true,
      };
    } catch (err) {
      /* fall through to normal execution if saving failed */
    }
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
    const requestedRootRaw = resolveIncomingWorkspaceRoot(event, input, task);
    const promptPaths = extractAuthorizedPaths(task)
      .map((item) => resolveAuthorizedRoot(item))
      .filter(Boolean);
    const permissionHint = String(input.permissionMode || permissionBySender.get(event?.sender?.id) || permissionMode || "");
    const requestedRoot = requestedRootRaw || promptPaths[0] || "";
    if (!requestedRoot) {
      throw new Error("Indica una ruta absoluta (ej. D:\\PROGRAMAS IA) con Acceso completo, o abre/crea un proyecto.");
    }
    if (!String(input.projectRoot || "").trim() && !requestedRootRaw && permissionHint !== "full") {
      throw new Error("Para usar una ruta sin proyecto abierto, activa Acceso completo e indica la ruta absoluta.");
    }
    const rootPath = assertProjectRoot(requestedRoot);
    rememberActiveWorkspace(event?.sender?.id, rootPath);
    const runId = String(input.runId || crypto.randomUUID());
    const runKey = agentRunKey(event.sender.id, runId);
    const runController = new AbortController();
    const runState = {
      key: runKey,
      runId,
      senderId: event.sender.id,
      startedAt: Date.now(),
      controller: runController,
      requestController: null,
      steering: [],
      kernel: true,
      projectRoot: rootPath,
      projectId: String(input.projectId || ""),
    };
    activeAgentRuns.set(runKey, runState);
    try {
      const helpers = buildKernelHelpers({
        BrowserWindow,
        capturePreview,
        previewUrl: previewProcesses.get(rootPath)?.url || "",
        appUserData: app.getPath("userData"),
        ...buildKernelProcessHooks(rootPath),
      });

      // Match & attach active skills
      let effectiveTask = task;
      try {
        const allSkills = skillsEngine.listAllSkills({
          projectRoot: rootPath,
          userDataPath: app.getPath("userData"),
        });
        const matchedSkills = skillsEngine.matchSkillsForPrompt(task, allSkills);
        if (matchedSkills.length > 0) {
          const skillsBlock = skillsEngine.assembleSkillsSystemPrompt(matchedSkills);
          effectiveTask = `${skillsBlock}\n\n${task}`;
        }
      } catch (err) {
        /* proceed with original task if skills match fails */
      }

      const out = await handleChatKernel({
        message: effectiveTask,
        history: Array.isArray(input.history) ? input.history : (Array.isArray(input.messages) ? input.messages : []),
        threadId: input.chatId || input.threadId || input.conversationId || input.runId || "",
        chatId: input.chatId || input.threadId || "",
        projectRoot: rootPath,
        apiBaseUrl: baseUrl,
        apiKey,
        model,
        images: runImages,
        helpers,
        allowWrite: permissionHint === "full" || permissionHint !== "readonly",
        permissionMode: permissionHint || "step",
        fullAccess: permissionHint === "full",
        planAuthorizedExecution: permissionHint === "full",
        onProgress: (p) => {
          try {
            publishAgentProgress(event.sender, {
              runId,
              projectId: String(input.projectId || ""),
              projectRoot: rootPath,
              ...(p && typeof p === "object" ? p : { text: String(p || "") }),
            });
          } catch { /* ignore */ }
        },
      });
      const text = String(out?.text || "").trim() || "Sin respuesta.";
      const steps = Array.isArray(out?.steps) ? out.steps : [];
      const changedFiles = [...new Set(steps
        .filter((st) => ["write_file", "replace_in_file", "delete_file"].includes(String(st?.name || "")) && st?.ok !== false)
        .map((st) => String(st?.input?.path || st?.path || "").trim())
        .filter(Boolean))];
      // Checkpoint Undo/Keep/Review: el kernel escribe snapshots pero no agent-last-run.
      try {
        const mutations = Array.isArray(out?.mutations) ? out.mutations.filter((m) => m && m.path) : [];
        let filesForCheckpoint = mutations;
        if (!filesForCheckpoint.length && changedFiles.length) {
          const { resolveSnapshotBackupAbs, listSnapshots } = require("./editcore-chat-kernel/snapshot");
          // listSnapshots devuelve newest-first
          const listed = listSnapshots(rootPath);
          const snapList = Array.isArray(listed?.snapshots) ? listed.snapshots : [];
          const window = snapList.slice(0, 24);
          filesForCheckpoint = changedFiles.map((rel) => {
            const norm = String(rel).replace(/\\/g, "/");
            let backupPath = "";
            // El backup pre-corrida es el más antiguo en la ventana que tenga .bak
            for (let i = window.length - 1; i >= 0; i -= 1) {
              const abs = resolveSnapshotBackupAbs(rootPath, window[i]?.id, norm);
              if (abs) {
                backupPath = abs;
                break;
              }
            }
            return {
              path: norm,
              action: "write_file",
              backupPath,
              created: !backupPath,
            };
          });
        }
        if (filesForCheckpoint.length) {
          saveLastAgentRun(app.getPath("userData"), rootPath, {
            runId,
            at: new Date().toISOString(),
            task: String(task || input.prompt || "").slice(0, 500),
            files: filesForCheckpoint,
            steps,
          });
        }
      } catch (error) {
        logStartup(`kernel saveLastAgentRun fallo: ${String(error?.message || error).slice(0, 160)}`);
      }
      const report = {
        completed: true,
        toolCount: steps.length,
        changedFiles,
        stopReason: out?.kind === "STOP" ? "Detenido." : `editcore-chat-kernel:${out?.kind || kernelDecision.kind}`,
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
          publishAgentTaskComplete(event.sender, {
            runId,
            projectId: String(input.projectId || ""),
            projectRoot: rootPath,
            completed: true,
            text,
            changedFiles,
            report,
          });
        }
      } catch { /* ignore */ }
      // Preview en background: NUNCA bloquear el return del agente (evita UI colgada en Verifier).
      Promise.resolve()
        .then(() => startProjectPreview(rootPath, event.sender.id))
        .then((preview) => {
          if (preview?.available && preview?.url && !event.sender.isDestroyed()) {
            event.sender.send("project:preview-updated", { projectRoot: rootPath, url: preview.url });
          }
        })
        .catch(() => {});
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
    } finally {
      if (activeAgentRuns.get(runKey) === runState) activeAgentRuns.delete(runKey);
    }
  }

  // LEGACY adapter path (solo si useLegacyAdapter=true)
  if (!apiKey) throw new Error("Falta API key.");
  if (!model) throw new Error("Falta modelo.");
  if (!task) throw new Error("Falta tarea.");

  const privacy = readPrivacyMode(readSecureState());
  const cloudGate = assertCloudAllowed(privacy, String(input.providerKey || input.provider || ""));
  if (!cloudGate.ok && !/local|ollama|lm/i.test(String(baseUrl || ""))) {
    throw new Error(cloudGate.message);
  }
  const requestedRootRaw = resolveIncomingWorkspaceRoot(event, input, task);
  const promptPaths = extractAuthorizedPaths(task)
    .map((item) => resolveAuthorizedRoot(item))
    .filter(Boolean);
  const permissionHint = String(input.permissionMode || permissionBySender.get(event?.sender?.id) || permissionMode || "");
  const requestedRoot = requestedRootRaw || promptPaths[0] || "";
  if (!requestedRoot) {
    throw new Error("Indica una ruta absoluta (ej. D:\\PROGRAMAS IA) con Acceso completo, o abre/crea un proyecto.");
  }
  if (!String(input.projectRoot || "").trim() && !requestedRootRaw && permissionHint !== "full") {
    throw new Error("Para usar una ruta sin proyecto abierto, activa Acceso completo e indica la ruta absoluta.");
  }

  const rootPath = assertProjectRoot(requestedRoot);
  rememberActiveWorkspace(event?.sender?.id, rootPath);

  // Fast-path: PROCEDE + cambio concreto (h1/replace/path) sin orquestador durable.
  // Evita corridas zombie a 0s ("Analisis interrumpido") cuando hay taskId stale.
  // NO incluir "continua": suele ser retomar analisis/forense con muchos .ts en el prompt
  // y entraba aqui por error → Agent Core asar → "Invalid package config".
  const concreteAuth = (
    input.planAuthorized === true
    || /TAREA CONCRETA:|AUTORIZACION DE EJECUCION \(PROCEDE\)/i.test(task)
    || /^\s*(?:procede|adelante|autorizo)\b/i.test(task)
  );
  const concreteChange = (
    /\bcambia(?:r)?\s+(?:el\s+)?(?:h1|h2|h3|title)\s+a\b/i.test(task)
    || /\breplace_in_file\b/i.test(task)
    || /\bcambia(?:r)?\s+.+\s+por\s+/i.test(task)
  );
  const looksLikeAnalysisContinuation = (
    /\b(?:analiz|auditor|diagn[oó]st|hallazgo|forense|exhaustiv|carpeta\s+por\s+carpeta|reporte)\b/i.test(task)
    || task.length > 1200
  );
  const concreteFastPath = concreteAuth && concreteChange
    && /\.(?:html?|css|js|jsx|ts|tsx|mjs|cjs|json|md|txt)\b/i.test(task)
    && !looksLikeAnalysisContinuation;

  // Fast-path Agent Core desactivado: cerraba mal / quemaba tokens.
  // Pedidos concretos y analisis van por el adaptador legado abajo.
  if (concreteFastPath) {
    logStartup("[CONCRETE_FASTPATH] omitido (legado) root=" + rootPath);
  }

  // Un solo orquestador: si el renderer ya mando orchestratorPlan, no re-decidir.
  const orchestratorPlan = input.orchestratorPlan && typeof input.orchestratorPlan === "object"
    ? input.orchestratorPlan
    : resolveUnifiedAgentPlan({
      prompt: task,
      requestedAgent: true,
      projectOpen: true,
      allowWrite: input.allowWrite !== false,
      permissionMode: String(input.permissionMode || permissionMode),
      cursorParityEnabled: input.cursorParityEnabled !== false,
      planAuthorizedExecution: input.planAuthorized === true,
      authorizedContinuation: input.planAuthorized === true || input.resume === true,
      hasAttachments: Boolean((input.images || []).length || (input.documents || []).length),
    });
  // PROCEDE/EXECUTE autorizado nunca vuelve a DISCOVER/analisis.
  const analysisMode = input.planAuthorized === true
    ? false
    : orchestratorPlan.analysisMode === true;
  const runProfile = orchestratorPlan.runProfile || {};
  const freshAnalysisRun = analysisMode && !input.planAuthorized && (
    input.freshAnalysisRun === true
    || input.resume !== true
  );
  const requestedPermission = String(input.permissionMode || permissionBySender.get(event.sender.id) || permissionMode);
  const selectedPermission = resolveLivePermission(requestedPermission, event.sender.id);
  const actionPermission = selectedPermission;
  const canWrite = actionPermission !== "readonly";
  // Lectura multi-root siempre: proyecto + hermanos del padre (PROGRAMAS IA).
  // Acceso completo añade rutas absolutas del prompt; escritura fuera del activo se bloquea abajo.
  const crossProjectAccess = selectedPermission === "full";
  const allowedRoots = crossProjectAccess
    ? collectFullAccessRoots(rootPath, task, Array.isArray(input.authorizedPaths) ? input.authorizedPaths : [])
    : collectSiblingReadRoots(rootPath);
  const resolveToolPath = (maybePath = "") => resolveAccessibleTarget(rootPath, maybePath, {
    allowedRoots,
    grantAbsoluteOnFull: crossProjectAccess,
  });
  const assertWritableToolPath = (resolved, label = "escritura") => {
    if (resolved?.outsidePrimary && !crossProjectAccess) {
      throw new Error(
        `${label} en proyecto hermano requiere Acceso completo. La lectura de hermanos sí está permitida.`,
      );
    }
    return resolved;
  };

  const runId = String(input.runId || crypto.randomUUID());
  /** @type {{ path: string, action: string, backupPath: string, created: boolean }[]} */
  const runMutations = [];
  let taskId = String(input.taskId || "").trim();
  let durableRun = null;
  let durableTask = null;
  let durableTaskContext = "";
  let workflowContext = null;
  if (taskManager && workflowOrchestrator) {
    if (input.planAuthorized === true && !taskId) {
      const awaiting = workflowOrchestrator.findAwaitingTask({ projectId: String(input.projectId || ""), projectRoot: rootPath })
        || (taskManager.listTasks ? taskManager.listTasks({ projectId: String(input.projectId || ""), projectRoot: rootPath }).find(t => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.status)) : null);
      if (awaiting) {
        taskId = awaiting.taskId;
      } else {
        const goal = String(input.originalGoal || input.persistedGoal || task || "Crear proyecto").trim();
        const created = taskManager.createTask({
          projectId: String(input.projectId || ""),
          projectRoot: rootPath,
          goal,
          originalRequest: goal,
          status: "READY",
          currentStage: "implementation",
          nextAction: { type: "EXECUTE", description: "Ejecutar con herramientas y evidencia.", status: "PENDING" },
        });
        taskId = created.taskId;
      }
    }
    workflowContext = workflowOrchestrator.prepareAgentRun({
      taskId,
      projectId: String(input.projectId || ""),
      projectRoot: rootPath,
      goal: String(input.originalGoal || input.persistedGoal || "").trim(),
      prompt: task,
      analysisMode,
      planAuthorized: input.planAuthorized === true,
      executionMode: String(input.executionMode || ""),
      planId: String(input.planId || ""),
      approvalId: String(input.approvalId || ""),
      runId,
      freshAnalysisRun,
    });
    taskId = workflowContext.taskId;
    durableTask = workflowContext.task;
    durableTaskContext = workflowContext.durableTaskContext || "";
    if (workflowContext.duplicateExecution) {
      return {
        taskId,
        planId: workflowContext.planId || "",
        approvalId: workflowContext.approvalId || "",
        text: "La ejecucion autorizada ya esta en curso para esta tarea.",
        steps: [],
        usage: {},
        report: { completed: false, duplicateExecution: true, toolCount: 0, changedFiles: [] },
      };
    }
    // Checkpoint Git se aplica DESPUES de crear runState (evita TDZ ReferenceError).
    if (durableTask && taskRecovery && !workflowContext.planAuthorized && !freshAnalysisRun && (input.resume === true || durableTask.planReference || durableTask.lastCheckpointId)) {
      const recovered = taskRecovery.reconstructContext(taskId);
      const plan = workflowContext.plan || (durableTask.planId ? taskStore.getPlan(taskId, durableTask.planId) : null);
      const completed = (recovered.checkpoint?.completedSteps || []).map((step) => typeof step === "string" ? step : step?.name || step?.stepId).filter(Boolean);
      durableTaskContext = [
        "MEMORIA DURABLE DE LA TAREA ACTIVA:",
        `Solicitud original: ${recovered.task?.goal || durableTask.goal || task}`,
        plan?.content ? `Plan autorizado (${plan.planId}):\n${plan.content}` : (recovered.plan?.content ? `Plan autorizado:\n${recovered.plan.content}` : ""),
        `Etapa guardada: ${recovered.task?.currentStage || durableTask.currentStage || "implementation"}`,
        recovered.nextAction?.description ? `Siguiente accion: ${recovered.nextAction.description}` : "",
        completed.length ? `Acciones completadas que no debes repetir: ${completed.join(", ")}` : "",
        recovered.relevantFiles?.length ? `Archivos relevantes: ${recovered.relevantFiles.join(", ")}` : "",
        "Continua desde este estado hasta completar y verificar la solicitud. No vuelvas a pedir autorizacion ni sustituyas la ejecucion por otro plan.",
      ].filter(Boolean).join("\n\n");
    }
  } else if (taskManager) {
    durableTask = taskId ? tasks().getTask(taskId) : null;
    if (!durableTask && !input.planAuthorized) {
      durableTask = tasks().createTask({
        taskId: taskId || undefined,
        projectId: String(input.projectId || ""),
        projectRoot: rootPath,
        goal: String(redactSensitive(task)),
        originalRequest: String(redactSensitive(task)),
        status: "READY",
        nextAction: { type: "EXECUTE", description: "Ejecutar con herramientas y evidencia.", status: "PENDING" },
      });
      taskId = durableTask.taskId;
    } else if (durableTask?.status === "RECOVERABLE") {
      durableTask = tasks().retryTask(taskId);
    }
  } else {
    taskId = `task-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
  const runKey = agentRunKey(event.sender.id, runId);

  if (activeAgentRuns.has(runKey)) {
    throw new Error("Ya existe una ejecucion con el mismo runId.");
  }

  const runController = new AbortController();
  const runState = {
    key: runKey,
    runId,
    taskId,
    senderId: event.sender.id,
    startedAt: Date.now(),
    controller: runController,
    requestController: null,
    steering: [],
  };
  activeAgentRuns.set(runKey, runState);

  const sendAgentProgress = (payload = {}) => {
    publishAgentProgress(event.sender, {
      runId,
      projectId: String(input.projectId || ""),
      projectRoot: rootPath,
      ...(payload || {}),
    });
  };
  // Checkpoint Git aditivo tras PROCEDE (despues de runState; no bloquea si no hay git).
  if (workflowContext
    && (workflowContext.planAuthorized === true || input.planAuthorized === true)
    && canWrite
    && !analysisMode) {
    try {
      const cp = createMutationCheckpoint(rootPath, { runId, label: `procede-${runId}` });
      runState.mutationCheckpoint = cp;
      if (!cp.skipped) persistMutationCheckpoint(rootPath, cp);
      if (!cp.skipped) {
        sendAgentProgress({
          phase: "model",
          text: `Checkpoint Git listo${cp.stashHash ? ` (${String(cp.stashHash).slice(0, 8)})` : ""}.`,
        });
      }
    } catch {
      runState.mutationCheckpoint = { ok: true, skipped: true, reason: "checkpoint-error" };
    }
  }
  // Analisis forense/profundo necesita mas que 4 min (Opus + muchas lecturas).
  // Escritura: 8 min. Analisis: 6–15 min segun profundidad (tope duro, no 25 min).
  const { resolveRunDeadlineMs } = require("./runtime/analysis-depth");
  const runDeadlineMs = resolveRunDeadlineMs({
    analysisMode,
    prompt: String(input.prompt || task || input.originalGoal || ""),
  });
  const deadline = setTimeout(() => {
    runController.abort(new Error(`La ejecucion excedio el limite total de ${Math.round(runDeadlineMs / 60_000)} minutos sin terminar.`));
  }, runDeadlineMs);
  const heartbeat = setInterval(() => {
    sendAgentProgress({ phase: "heartbeat", stage: "working", elapsedMs: Date.now() - runState.startedAt });
  }, 2_000);

  try {
    sendAgentProgress({
      phase: "startup",
      stage: runProfile.promptOnlyMode ? "understand" : (analysisMode ? "analysis" : "implementation"),
      text: runProfile.statusLabel || orchestratorPlan.statusLabel || (analysisMode ? "Preparando analisis..." : "Preparando ejecucion..."),
    });
    console.log("[Agent] Iniciando ejecucion verificable (orquestador unificado:", orchestratorPlan.mode || "unknown", ")");

    const emptyInventory = { skills: [], installed: [], catalog: [] };
    let brainCtx = "";
    let brainInventory = emptyInventory;
    // Analisis: SI cargar inventario del Cerebro (skills reales). Solo saltar si el perfil lo pide.
    const skipBrainNow = orchestratorPlan.skipBrain
      || runProfile.skipBrain
      || runProfile.scopedDiskFocus === true
      || orchestratorPlan.scopedDiskFocus === true
      || runProfile.promptOnlyMode
      || runProfile.conversationOnly
      || (runProfile.greenfieldCreate && !runProfile.permissionFull);
    if (skipBrainNow) {
      console.log("[Agent] Modo sin Cerebro (o analisis con timeout 0):", orchestratorPlan.reason || runProfile.reason || runProfile.statusLabel);
    } else {
      sendAgentProgress({ phase: "model", text: "Trabajando…" });
      try {
        const brainLoad = Promise.all([
          brain().assembleContext(rootPath, task).catch(() => ""),
          brain().agentInventory(rootPath, task, 100).catch(() => emptyInventory),
        ]);
        const timed = await Promise.race([
          brainLoad,
          new Promise((resolve) => setTimeout(() => resolve(["", emptyInventory]), 3_000)),
        ]);
        brainCtx = timed[0] || "";
        brainInventory = timed[1] || emptyInventory;
      } catch (brainError) {
        console.warn("[Agent] Carga del Cerebro fallida:", brainError?.message || brainError);
      }
      console.log(`✓ [Claude Code] ${brainInventory.skills.length} skills cargadas`);
    }

    sendAgentProgress({
      phase: "startup",
      text: analysisMode ? "Leyendo archivos del proyecto..." : "Trabajando…",
    });
    if (!analysisMode) {
      sendAgentProgress({ phase: "model", text: "Trabajando…" });
    }
    const adapter = new EditCoreClaudeAdapter({ maxIterations: 18, tokenBudget: 100000, logger: console });
    adapter.actionRegistry = actionRegistryForProject(rootPath);

    // Configurar provider API
    adapter.providerApi = {
      async call(options) {
        const requestController = new AbortController();
        runState.requestController = requestController;
        const parentSignal = options.signal || runController.signal;
        const requestSignal = parentSignal
          ? AbortSignal.any([parentSignal, requestController.signal])
          : requestController.signal;
        try {
          const toolList = Array.isArray(options.tools) ? options.tools : [];
          // Sintesis del Agent Core pasa tools:[] → NO forzar enableTools (si no, el modelo
          // vuelve con tool_calls inventados y el informe se descarta).
          const enableTools = options.enableTools === true
            ? toolList.length > 0
            : (options.enableTools !== false && toolList.length > 0);
          const result = await callProvider({
            baseUrl: options.baseUrl || baseUrl,
            apiKey: options.apiKey || apiKey,
            model: options.model || model,
            providerKey: input.providerKey,
            messages: options.messages,
            tools: toolList,
            signal: requestSignal,
            timeoutMs: (runProfile.scopedDiskFocus === true || orchestratorPlan.scopedDiskFocus === true)
              ? 45_000
              : AGENT_PROVIDER_STEP_TIMEOUT_MS,
            maxAttempts: 1,
            enableTools,
            rawToolCalls: enableTools === true,
            allowProviderFallback: !(runProfile.scopedDiskFocus === true || orchestratorPlan.scopedDiskFocus === true),
            onTextDelta: options.onTextDelta,
          });
          if (result?.fallback?.to && runState.adapterInput?.failover) {
            recordIntraTurnFallback(runState.adapterInput.failover, runState.adapterInput, result.fallback);
          }
          return result;
        } finally {
          if (runState.requestController === requestController) runState.requestController = null;
        }
      },
    };

    // Configurar dispatcher con TODAS las herramientas
    const dispatcher = new ToolDispatcher({
      defaultTimeoutMs: 60_000,
      authorize: async (tool, toolInput) => {
        // Candado duro: diagnostico / NO MODIFICAR = cero mutaciones (ni ROADMAP ni .md).
        // Acceso completo: aplica parches sin pedir PROCEDE (salvo NO MODIFICAR explícito).
        const promptText = String(input.prompt || input.originalGoal || task || "");
        const procedeInPrompt = /^\s*(?:procede|adelante|autorizo|continua|continúa)\b/i.test(promptText)
          || /\b(?:procede|adelante|autorizo)\b/i.test(promptText);
        const livePermission = resolveLivePermission(input.permissionMode, event.sender.id);
        const fullAccess = livePermission === "full" || input.fullAccess === true;
        const explicitNoWrite = /\bNO\s+MODIFIQUES?\b|\bNO\s+MODIFICAR\b|\bNO\s+CREES?\s+ARCHIVOS\b|\bSOLO\s+(?:LEE|LECTURA|ANALIZA|AN[AÁ]LISIS)\b|\bMODO:\s*DIAGN/i.test(promptText);
        const fixOrApplyIntent = /\b(?:corrige|arreglar?|fix|aplica|implementa|parchea|refactor|reescribe|repara|audita(?:r)?(?:\s+y\s+(?:corrige|arregla|repara))?|patch)\b/i.test(promptText);
        const authorizedToMutate = input.planAuthorized === true
          || procedeInPrompt
          || (fullAccess && !explicitNoWrite)
          || (canWrite && fixOrApplyIntent && !explicitNoWrite && !analysisMode);
        const readonlyDiagnostic = !authorizedToMutate && (
          analysisMode
          || explicitNoWrite
        );
        if (readonlyDiagnostic && tool.write) return false;
        if (analysisMode && tool.write && tool.name !== "run_command" && !authorizedToMutate) {
          return false;
        }
        // Analisis: el MODELO no escribe ROADMAP.md (lo actualiza EditCore por sync de sistema).
        if (analysisMode && !authorizedToMutate) {
          const targetPath = String(toolInput?.path || "").replace(/\\/g, "/");
          if (/(^|\/)ROADMAP(\/|$)/i.test(targetPath) || /(^|\/)ROADMAP\.md$/i.test(targetPath)) {
            return false;
          }
          if (tool.write && /\.md$/i.test(targetPath)) return false;
        }
        if (!tool.write && tool.name !== "deploy_one_click"
          && tool.name !== "publish_project"
          && tool.name !== "ssh_deploy"
          && tool.name !== "git_push"
          && tool.name !== "onboard_project") return true;
        if (!canWrite && tool.write) return false;
        const forceConfirm = ["deploy_one_click", "publish_project", "ssh_deploy", "git_push", "onboard_project"].includes(tool.name)
          || (tool.name === "switch_project" && (toolInput?.publishFirst === true || toolInput?.autoPublish === true));
        if (forceConfirm || livePermission === "step") {
          sendAgentProgress({
            phase: "confirm",
            name: tool.name,
            input: toolInput,
            text: `Esperando tu autorización para ${tool.name}...`,
          });
          return approveAgentAction(event, livePermission === "full" ? "step" : livePermission, tool.name, toolInput, { projectRoot: rootPath });
        }
        if (livePermission === "full") return true;
        if (orchestratorPlan.cursorParityMode === true && livePermission !== "readonly") return true;
        return false;
      },
    });
    const observedFiles = new Map();
    const fileObservationKey = (target) => path.resolve(target).toLowerCase();
    const fileDigest = (target) => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    const observeFile = (target) => observedFiles.set(fileObservationKey(target), fileDigest(target));
    const assertFreshObservation = (target, relativeFile) => {
      const observed = observedFiles.get(fileObservationKey(target));
      if (!observed) throw new Error(`Lee ${relativeFile} antes de modificarlo para conservar su contenido actual.`);
      if (observed !== fileDigest(target)) throw new Error(`${relativeFile} cambio desde la ultima lectura. Vuelve a leerlo y aplica un parche actualizado.`);
    };
    const autoObserveExistingFile = (relativeFile) => {
      const normalized = String(relativeFile || "").trim();
      if (!normalized) return false;
      let resolved;
      try {
        resolved = resolveToolPath(normalized);
      } catch {
        return false;
      }
      const target = resolved.absolute;
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
      const key = fileObservationKey(target);
      if (observedFiles.has(key)) return false;
      readProjectFileChunk(resolved.root, { path: resolved.relative });
      observeFile(target);
      return true;
    };
    for (const step of input.resumeSteps || []) {
      if (step?.name === "read_file" && step?.ok !== false && step?.input?.path) autoObserveExistingFile(String(step.input.path));
    }
    for (const rel of input.preobservedFiles || []) autoObserveExistingFile(String(rel));

    // Ledger de descubrimiento: en analisis solo se lee lo listado/buscado.
    // EXCEPCION: paths que el usuario nombro en el prompt son legibles de inmediato.
    const explicitTargets = [
      ...extractAnalysisTargets(String(input.prompt || "")),
      ...extractAnalysisTargets(String(input.originalGoal || "")),
      ...(Array.isArray(input.analysisTargets) ? input.analysisTargets : []),
      ...(Array.isArray(orchestratorPlan?.analysisTargets) ? orchestratorPlan.analysisTargets : []),
    ];
    const discoveryLedger = createDiscoveryLedger({
      projectRoot: rootPath,
      explicitTargets,
    });
    // Diagnostico nombrado: pre-registrar runtime/ para que read_file no falle al bootstrap.
    try {
      const runtimeDir = path.join(rootPath, "resources", "app", "runtime");
      if (fs.existsSync(runtimeDir) && fs.statSync(runtimeDir).isDirectory()) {
        const entries = fs.readdirSync(runtimeDir).slice(0, 200).map((name) => ({
          path: `resources/app/runtime/${name}`,
          kind: fs.statSync(path.join(runtimeDir, name)).isDirectory() ? "directory" : "file",
        }));
        discoveryLedger.rememberList("resources/app/runtime", entries);
      }
    } catch {
      // no bloquear si no existe esa carpeta en el proyecto abierto
    }

    // Herramientas basicas
    dispatcher.register({
      name: "open_project",
      description: "Abre una carpeta real en el panel de EditCore (misma accion que Abrir / 'abre TAXIDRIV'). No inventes cierre/apertura: usa esta herramienta.",
      execute: async (toolInput) => {
        const target = resolveOpenProjectTarget(toolInput, { rootPath, crossProjectAccess });
        const result = await requestProjectUiAction(event.sender, {
          action: "open",
          path: target,
          name: String(toolInput.name || path.basename(target) || ""),
        });
        if (!result?.ok) throw new Error(result?.error || "La UI no abrio el proyecto.");
        return {
          opened: true,
          projectRoot: result.projectRoot || target,
          label: result.label || path.basename(target),
          note: "Panel derecho actualizado con esa carpeta.",
        };
      },
    });

    dispatcher.register({
      name: "close_project",
      description: "Cierra el proyecto abierto en el panel de EditCore (misma accion que Cerrar / 'cierra el proyecto'). El panel debe quedar Sin proyecto.",
      execute: async () => {
        const result = await requestProjectUiAction(event.sender, { action: "close", cancelAgent: false });
        if (!result?.ok && result?.error) throw new Error(result.error);
        return {
          closed: result?.ok === true,
          projectRoot: "",
          previousRoot: result?.projectRoot || "",
          label: result?.label || "",
          note: result?.ok ? "Panel derecho: Sin proyecto." : (result?.error || "No habia proyecto abierto."),
        };
      },
    });

    dispatcher.register({
      name: "switch_project",
      description: "Cierra el proyecto activo y abre otra carpeta en el mismo panel (atomico). Usa cuando el usuario diga 'cierrame este y abrime X'. Con autoPublish/publishFirst=true guarda y publica antes de cambiar.",
      execute: async (toolInput) => {
        const publishFirst = toolInput?.publishFirst === true || toolInput?.autoPublish === true;
        const target = resolveOpenProjectTarget(
          {
            path: String(toolInput.path || toolInput.targetPath || "").trim(),
            name: String(toolInput.name || "").trim(),
          },
          {
            rootPath,
            crossProjectAccess: true,
          },
        );
        const result = await requestProjectUiAction(
          event.sender,
          {
            action: "switch",
            path: target,
            name: String(toolInput.name || path.basename(target) || ""),
            publishFirst,
            autoPublish: publishFirst,
            cancelAgent: false,
          },
          WORKSPACE_SWITCH_TIMEOUT_MS,
        );
        if (!result?.ok) throw new Error(result?.error || "La UI no cambio de proyecto.");
        return {
          switched: true,
          projectRoot: result.projectRoot || target,
          previousRoot: result.previousRoot || "",
          label: result.label || path.basename(target),
          published: result.published === true,
          publishMessage: result.publishMessage || "",
          note: `Workspace activo: ${result.label || path.basename(target)}.`,
        };
      },
    });

    dispatcher.register({
      name: "list_files",
      description: "Lista archivos del proyecto activo o de hermanos del workspace (../Hermano o NombreHermano/).",
      execute: async (toolInput) => {
        const resolved = resolveToolPath(String(toolInput.path || ""));
        const entries = listEntries(resolved.root, resolved.relative).map((entry) => {
          const abs = entry.absolutePath || path.join(resolved.root, entry.path);
          const toolPath = pathForToolResult(
            { ...resolved, absolute: abs },
            path.relative(resolved.root, abs),
          );
          return {
            name: entry.name,
            path: toolPath,
            absolutePath: abs,
            kind: entry.kind,
            root: resolved.root,
          };
        });
        if (!resolved.outsidePrimary) discoveryLedger.rememberList(resolved.relative, entries);
        return entries;
      },
    });

    dispatcher.register({
      name: "read_file",
      description: "Lee archivo del proyecto activo o de un hermano (../GAFCORE GATEWAY/... / NombreHermano/...).",
      execute: async (toolInput) => {
        const resolved = resolveToolPath(String(toolInput.path || ""));
        if (analysisMode && !resolved.outsidePrimary) {
          const gate = discoveryLedger.assertReadable(resolved.relative || String(toolInput.path || ""));
          // Si el ledger resolvio un path canonico distinto (basename → runtime/...), usarlo.
          if (gate?.resolvedPath && gate.resolvedPath !== resolved.relative) {
            const remapped = resolveToolPath(gate.resolvedPath);
            Object.assign(resolved, remapped);
          }
        }
        const result = readProjectFileChunk(resolved.root, { ...toolInput, path: resolved.relative });
        const target = resolved.absolute;
        const toolPath = pathForToolResult(resolved, result.path || resolved.relative);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          observeFile(target);
          if (!resolved.outsidePrimary) {
            discoveryLedger.rememberList(path.posix.dirname(String(result.path || resolved.relative).replace(/\\/g, "/") || "."), [{
              path: result.path || resolved.relative,
              kind: "file",
            }]);
          }
        }
        // PDF/DOCX/XLSX en disco: extraer texto (no pedir al usuario que lo pegue).
        if (result?.extractableDocument || (result?.binary && /\.(pdf|docx|xlsx|xls|xlsm)$/i.test(String(result.path || target)))) {
          try {
            const { extractDocumentFromBuffer } = require("./document-attachments");
            const buf = fs.readFileSync(target);
            const extracted = await extractDocumentFromBuffer(path.basename(target), buf);
            if (extracted?.supported && extracted.text) {
              return {
                path: toolPath,
                absolutePath: target,
                root: resolved.root,
                format: extracted.format,
                extracted: true,
                truncated: extracted.truncated === true,
                totalChars: String(extracted.text).length,
                content: extracted.text,
              };
            }
            return {
              ...result,
              path: toolPath,
              absolutePath: target,
              root: resolved.root,
              extractError: extracted?.error || "No se pudo extraer texto",
              note: "Documento no extraible como texto. Continua con list_files/write_file/create_*; no pidas al usuario que lo pegue.",
            };
          } catch (error) {
            return {
              ...result,
              path: toolPath,
              absolutePath: target,
              root: resolved.root,
              extractError: String(error?.message || error).slice(0, 200),
            };
          }
        }
        return { ...result, path: toolPath, absolutePath: target, root: resolved.root };
      },
    });

    dispatcher.register({
      name: "search_files",
      description: "Busca texto en el proyecto abierto; con Acceso completo tambien acepta path en un hermano.",
      execute: async (toolInput) => {
        const scopePath = String(toolInput.path || toolInput.root || "").trim();
        const resolved = scopePath ? resolveToolPath(scopePath) : { root: rootPath, relative: "", outsidePrimary: false };
        const hits = searchProject(resolved.root, String(toolInput.query || "")).map((hit) => {
          if (!resolved.outsidePrimary) return hit;
          const abs = path.isAbsolute(String(hit.path || ""))
            ? String(hit.path)
            : path.join(resolved.root, String(hit.path || ""));
          return { ...hit, path: abs, absolutePath: abs, root: resolved.root };
        });
        if (!resolved.outsidePrimary) discoveryLedger.rememberSearch(hits);
        return hits;
      },
    });

    // NUEVAS HERRAMIENTAS: Web, GitHub, Documentos
    const { analyzePage } = require("./runtime/web-fetcher");
    const {
      getRepoInfo,
      listRepoContents,
      getFileContent,
      searchRepos,
      parseGitHubUrl
    } = require("./runtime/github-tools");
    const { createPdf, createWord, createExcel, createCsv } = require("./runtime/document-writer");

    dispatcher.register({
      name: "fetch_url",
      description: "Descarga y analiza contenido de URL",
      execute: async (toolInput) => {
        const url = String(toolInput.url || "").trim();
        if (!url) throw new Error("fetch_url requiere URL");
        return await analyzePage(url, {
          maxSize: toolInput.maxSize || 10 * 1024 * 1024,
          timeout: toolInput.timeout || 30000,
        });
      },
    });

    dispatcher.register({
      name: "github_repo_info",
      description: "Info de repo GitHub",
      execute: async (toolInput) => {
        const url = String(toolInput.url || toolInput.repo || "").trim();
        if (!url) throw new Error("github_repo_info requiere URL");
        const { owner, repo } = parseGitHubUrl(url);
        const token = String(toolInput.token || "").trim() || undefined;
        return await getRepoInfo(owner, repo, token);
      },
    });

    dispatcher.register({
      name: "github_list_files",
      description: "Lista archivos en GitHub",
      execute: async (toolInput) => {
        const url = String(toolInput.url || toolInput.repo || "").trim();
        if (!url) throw new Error("github_list_files requiere URL");
        const { owner, repo } = parseGitHubUrl(url);
        const path = String(toolInput.path || "").trim();
        const token = String(toolInput.token || "").trim() || undefined;
        return await listRepoContents(owner, repo, path, token);
      },
    });

    dispatcher.register({
      name: "github_read_file",
      description: "Lee archivo de GitHub",
      execute: async (toolInput) => {
        const url = String(toolInput.url || toolInput.repo || "").trim();
        const filePath = String(toolInput.path || "").trim();
        if (!url || !filePath) throw new Error("github_read_file requiere URL y path");
        const { owner, repo } = parseGitHubUrl(url);
        const token = String(toolInput.token || "").trim() || undefined;
        return await getFileContent(owner, repo, filePath, token);
      },
    });

    dispatcher.register({
      name: "github_search_repos",
      description: "Busca repositorios",
      execute: async (toolInput) => {
        const query = String(toolInput.query || "").trim();
        if (!query) throw new Error("github_search_repos requiere query");
        const token = String(toolInput.token || "").trim() || undefined;
        return await searchRepos(query, token, {
          sort: toolInput.sort,
          order: toolInput.order,
          per_page: toolInput.per_page || 10,
        });
      },
    });

    dispatcher.register({
      name: "brain_install_repo",
      write: false,
      description: "Inspecciona un repo GitHub y, con autorizacion explicita del plan, lo instala en el Cerebro global para todos los modelos.",
      schema: {
        type: "object",
        properties: {
          url: { type: "string", minLength: 1 },
          mode: { type: "string", enum: ["inspect", "install"] },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (toolInput) => {
        const url = String(toolInput.url || "").trim();
        if (!url) throw new Error("brain_install_repo requiere la URL del repositorio.");
        let parsed;
        try { parsed = parseGitHubUrl(url); }
        catch { throw new Error("Usa una URL HTTPS valida de GitHub: https://github.com/owner/repo"); }
        const normalizedUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
        const repo = await getRepoInfo(parsed.owner, parsed.repo);
        const contents = await listRepoContents(parsed.owner, parsed.repo);
        const files = Array.isArray(contents) ? contents.map((entry) => String(entry.path || entry.name || "")).filter(Boolean) : [];
        const detected = files.filter((file) => /(^|\/)(SKILL\.md|skills|agent_skills|agents|package\.json|\.mcp\.json|mcp)/i.test(file));
        const mode = String(toolInput.mode || "inspect").toLowerCase();
        const inspection = {
          url: normalizedUrl,
          repository: { fullName: repo.full_name, description: repo.description || "", defaultBranch: repo.default_branch || "" },
          files: files.slice(0, 200),
          detected: detected.slice(0, 100),
          action: mode === "install" ? "install" : "inspect",
          globalTarget: "Cerebro global de EditCore; disponible para cualquier modelo",
        };
        if (mode !== "install") return { ...inspection, requiresApproval: true, installed: false };
        if (mode === "install" && (input.planAuthorized !== true || !canWrite)) {
          return { ...inspection, requiresApproval: true, installed: false, blocked: "La instalacion requiere aprobar el plan en EditCore." };
        }
        if (mode !== "install") return { ...inspection, requiresApproval: true, installed: false };
        const result = await brain().installRepo(rootPath, normalizedUrl, true);
        const audit = await brain().auditTools(rootPath, { repair: false });
        return { ...inspection, requiresApproval: false, installed: true, result, audit: { activeInstalledCount: audit.activeInstalledCount, invalidInstalledCount: audit.invalidInstalledCount } };
      },
    });

    if (canWrite) {
      dispatcher.register({
        name: "create_project",
        write: true,
        description: "Crea un proyecto desde plantilla. template: blank|web|node|react|lovable-web|next-saas|open-saas|soundonemusic|auto. Si omites template, EditCore infiere del prompt (SaaS Next→next-saas, React+Vite+Supabase→lovable-web).",
        execute: async (toolInput) => createProjectInside(rootPath, { ...toolInput, prompt: toolInput.prompt || input?.prompt }, { signal: runController.signal, prompt: input?.prompt }),
      });
      dispatcher.register({
        name: "write_file",
        write: true,
        description: "Escribe archivo en el proyecto abierto o, con Acceso completo, en un hermano permitido.",
        execute: async (toolInput) => {
          const requestedPath = String(toolInput.path || "");
          const content = String(toolInput.content || "");
          // Candado: no inventar *-fixed.js / placeholders de "demostracion".
          if (/(?:^|[\\/])[\w.-]*-fixed\.js$/i.test(requestedPath.replace(/\\/g, "/"))
            || /placeholder temporal|DEADLOCK T[EÉ]CNICO|demostrar tool execution/i.test(content)) {
            throw new Error("Escritura bloqueada: no se permiten archivos *-fixed.js ni placeholders inventados. Usa replace_in_file sobre el archivo real del plan.");
          }
          const resolved = assertWritableToolPath(resolveToolPath(requestedPath), "write_file");
          const relativeFile = resolved.relative;
          const target = resolved.absolute;
          const displayPath = pathForToolResult(resolved, relativeFile);
          const autoObserved = fs.existsSync(target) ? autoObserveExistingFile(requestedPath) : false;
          if (fs.existsSync(target)) {
            if (/^\.env(?:\.|$)/i.test(path.basename(relativeFile || requestedPath))) {
              throw new Error(`No se permite sobrescribir ${displayPath} completo. Lee el archivo y usa replace_in_file para conservar las variables existentes.`);
            }
            if (autoObserved) {
              throw new Error(`${displayPath} ya existe. Ejecuta read_file para ver el contenido actual y usa replace_in_file con oldText exacto; write_file completo solo sirve para archivos nuevos.`);
            }
            assertFreshObservation(target, displayPath);
          }
          const result = writeProjectFile(resolved.root, relativeFile, content);
          observeFile(target);
          return { ...result, path: displayPath, absolutePath: target, root: resolved.root, autoObserved };
        },
      });

      dispatcher.register({
        name: "replace_in_file",
        write: true,
        description: "Reemplaza texto en el proyecto abierto o, con Acceso completo, en un hermano permitido.",
        execute: async (toolInput) => {
          const requestedPath = String(toolInput.path || "");
          const resolved = assertWritableToolPath(resolveToolPath(requestedPath), "replace_in_file");
          const relativeFile = resolved.relative;
          const target = resolved.absolute;
          const displayPath = pathForToolResult(resolved, relativeFile);
          if (!fs.existsSync(target)) throw new Error(`Archivo no encontrado: ${displayPath}`);
          autoObserveExistingFile(requestedPath);
          assertFreshObservation(target, displayPath);
          const content = fs.readFileSync(target, "utf8");
          const oldText = String(toolInput.oldText || "");
          const newText = String(toolInput.newText || "");
          if (!oldText) throw new Error("replace_in_file requiere oldText no vacio.");
          if (!content.includes(oldText)) throw new Error("oldText no existe en el archivo. Vuelve a leer el rango actual y reintenta replace_in_file; no sobrescribas el archivo completo.");
          const occurrences = content.split(oldText).length - 1;
          if (occurrences > 1 && toolInput.replaceAll !== true) throw new Error(`oldText aparece ${occurrences} veces. Usa un bloque mas especifico o replaceAll: true.`);
          const next = toolInput.replaceAll === true ? content.split(oldText).join(newText) : content.replace(oldText, newText);
          const result = writeProjectFile(resolved.root, relativeFile, next);
          observeFile(target);
          return { ...result, path: displayPath, absolutePath: target, root: resolved.root };
        },
      });

      dispatcher.register({
        name: "delete_file",
        write: true,
        description: "Borra un archivo del proyecto (con backup previo).",
        execute: async (toolInput) => {
          const requestedPath = String(toolInput.path || "");
          const resolved = assertWritableToolPath(resolveToolPath(requestedPath), "delete_file");
          const relativeFile = resolved.relative;
          const target = resolved.absolute;
          const displayPath = pathForToolResult(resolved, relativeFile);
          if (!fs.existsSync(target)) throw new Error(`Archivo no encontrado: ${displayPath}`);
          if (fs.statSync(target).isDirectory()) throw new Error("delete_file solo borra archivos, no carpetas.");
          const result = deleteProjectFile(resolved.root, relativeFile);
          return { ...result, path: displayPath, absolutePath: target, root: resolved.root };
        },
      });

      dispatcher.register({
        name: "create_pdf",
        write: true,
        description: "Crea PDF",
        execute: async (toolInput) => {
          const content = toolInput.content;
          const outputPath = String(toolInput.path || "").trim();
          if (!content || !outputPath) throw new Error("create_pdf requiere content y path");
          const fullPath = resolveInside(rootPath, outputPath);
          return await createPdf(content, fullPath, {
            title: toolInput.title,
            author: toolInput.author,
            align: toolInput.align,
          });
        },
      });

      dispatcher.register({
        name: "create_word",
        write: true,
        description: "Crea Word (.docx)",
        execute: async (toolInput) => {
          const content = toolInput.content;
          const outputPath = String(toolInput.path || "").trim();
          if (!content || !outputPath) throw new Error("create_word requiere content y path");
          const fullPath = resolveInside(rootPath, outputPath);
          return await createWord(content, fullPath, { title: toolInput.title });
        },
      });

      dispatcher.register({
        name: "create_excel",
        write: true,
        description: "Crea Excel (.xlsx)",
        execute: async (toolInput) => {
          const data = toolInput.data;
          const outputPath = String(toolInput.path || "").trim();
          if (!data || !outputPath) throw new Error("create_excel requiere data y path");
          const fullPath = resolveInside(rootPath, outputPath);
          return await createExcel(data, fullPath, { sheetName: toolInput.sheetName });
        },
      });

      dispatcher.register({
        name: "create_csv",
        write: true,
        description: "Crea CSV",
        execute: async (toolInput) => {
          const data = toolInput.data;
          const outputPath = String(toolInput.path || "").trim();
          if (!data || !outputPath) throw new Error("create_csv requiere data y path");
          const fullPath = resolveInside(rootPath, outputPath);
          return await createCsv(data, fullPath, { delimiter: toolInput.delimiter });
        },
      });
    }

    // En analisis solo acepta la lista restringida de comandos sin mutacion.
    // En agente conserva la autorizacion de escritura del despachador.
    dispatcher.register({
      name: "run_command",
      write: !analysisMode,
      timeoutMs: 600_000,
      description: analysisMode ? "Ejecuta una comprobacion de solo lectura" : "Ejecuta comando",
      execute: async (toolInput) => {
        const command = String(toolInput.command || "");
        const readPath = resolveShellReadPath(command);
        if (readPath) {
          const result = readProjectFileChunk(rootPath, { path: readPath });
          const target = resolveInside(rootPath, result.path || readPath);
          if (fs.existsSync(target) && fs.statSync(target).isFile()) observeFile(target);
          return result;
        }
        const livePermission = resolveLivePermission(input.permissionMode, event.sender.id);
        const fullAccess = livePermission === "full" && !analysisMode;
        // dir/ls/Get-ChildItem SIEMPRE → list_files (tambien con Acceso completo).
        if (isShellExploreCommand(command)) {
          const hint = extractShellExplorePathHint(command) || "";
          let resolved;
          try {
            resolved = resolveToolPath(hint);
          } catch (error) {
            throw new Error(`Exploracion por shell bloqueada. Usa list_files. ${error.message}`);
          }
          const entries = listEntries(resolved.root, resolved.relative).map((entry) => {
            const abs = entry.absolutePath || path.join(resolved.root, entry.path);
            const toolPath = pathForToolResult({ ...resolved, absolute: abs }, path.relative(resolved.root, abs));
            return {
              name: entry.name,
              path: toolPath,
              absolutePath: abs,
              kind: entry.kind,
              root: resolved.root,
            };
          });
          if (!resolved.outsidePrimary) discoveryLedger.rememberList(resolved.relative, entries);
          return {
            redirectedFrom: "run_command",
            usedTool: "list_files",
            path: pathForToolResult(resolved, resolved.relative) || resolved.absolute || ".",
            entries,
            note: "Exploracion por shell convertida a list_files. No uses dir/cmd otra vez.",
          };
        }
        const commandRisk = evaluateAgentCommandPolicy(command, { fullAccess });
        if (commandRisk.level === "block") {
          throw new Error(`Operacion bloqueada: ${commandRisk.reason || "comando denegado por RulesEngine"}.`);
        }
        if (shouldRequireCommandConfirmation(commandRisk, { fullAccess })) {
          sendAgentProgress({
            phase: "confirm",
            name: "run_command",
            input: { command },
            text: `Esperando tu autorizacion para: ${commandRisk.kind || commandRisk.message} (${command.slice(0, 160)})`,
          });
          const approved = await confirmRiskyAgentAction(event, { risk: commandRisk, command });
          if (!approved) {
            throw new Error(`El usuario no autorizo la accion (${commandRisk.kind || commandRisk.message}). Deja este comando como pendiente en el resumen final y continua con el resto de la tarea.`);
          }
        } else if (!fullAccess) {
          const externalKind = externalMutationKind(command);
          if (externalKind) {
            sendAgentProgress({ phase: "confirm", name: "run_command", input: { command }, text: `Esperando tu autorizacion para: ${externalKind} (${command.slice(0, 160)})` });
            const approved = await confirmExternalAgentAction(event, { kind: externalKind, command });
            if (!approved) {
              throw new Error(`El usuario no autorizo la accion externa (${externalKind}). Deja este comando como pendiente en el resumen final y continua con el resto de la tarea.`);
            }
          }
        }
        if (!analysisMode && isProjectDevServerCommand(command)) {
          const preview = await startProjectPreview(rootPath, event.sender.id);
          if (preview?.available && preview?.url && !event.sender.isDestroyed()) {
            event.sender.send("project:preview-updated", { projectRoot: rootPath, url: preview.url });
          }
          return {
            redirectedFrom: "run_command",
            usedTool: "project_preview",
            command,
            ...preview,
            note: preview?.available
              ? "Servidor de desarrollo iniciado en el navegador interno de EditCore."
              : String(preview?.message || "No se pudo iniciar el preview del proyecto."),
          };
        }
        // Candado duro: forense/CONTINUA/analisis NUNCA lint/build — aunque analysisMode
        // venga mal o Cursor parity use acceso full. Solo PROCEDE (planAuthorized).
        // Typecheck acotado (tsc --noEmit / npm run typecheck) solo tras cobertura.
        const forbidHeavy = shouldBlockHeavyVerification({
          analysisMode,
          planAuthorized: input.planAuthorized === true,
          prompt: String(input.prompt || ""),
          goal: String(input.originalGoal || ""),
          task: String(task || ""),
        });
        const allowAcotadoDiag = input.analysisDiagnosticAllowed === true
          && isAcotadoDiagnosticCommand(command);
        if (forbidHeavy && isAnalysisHeavyVerificationCommand(command) && !allowAcotadoDiag) {
          throw new Error("MODO ANALISIS: PROHIBIDO lint/test/build (tambien con pipes/redirecciones). Usa list_files/read_file/search_files y escribe el REPORTE FINAL. Typecheck acotado solo tras cobertura; lint solo tras PROCEDE.");
        }
        const commandAccessMode = (forbidHeavy && !allowAcotadoDiag) ? "analysis" : "full";
        return runProjectCommand(rootPath, command, commandAccessMode, runController.signal, toolInput.cwd);
      },
    });

    // Interceptar errores de shell-lectura para empujar al modelo hacia read_file
    const originalRunCommand = dispatcher.tools.get("run_command");
    if (originalRunCommand) {
      const prevExecute = originalRunCommand.execute;
      originalRunCommand.execute = async (toolInput, context) => {
        try {
          return await prevExecute(toolInput, context);
        } catch (error) {
          const msg = String(error?.message || error);
          if (/Ejecutable no permitido|Comando no permitido|powershell|cmd\b|Get-Content|type/i.test(msg)
            && /\b(type|cat|get-content|cmd|powershell)\b/i.test(String(toolInput?.command || ""))) {
            throw new Error(`${msg} Usa la herramienta read_file con el path del archivo; no uses cmd/type/cat/Get-Content.`);
          }
          throw error;
        }
      };
    }

    // Registrar herramientas del cerebro
    registerAgentCapabilityTools(dispatcher, {
      rootPath,
      canWrite,
      event,
      BrowserWindow,
      capturePreview,
      startProjectPreview,
      readConnections,
      executeRemoteTool: executeRemoteTool,
      connectionSummary,
      getOperatorConnectionsSnapshot: () => getOperatorConnectionsSnapshot({
        projectRoot: rootPath,
        projectId: input.projectId || "",
      }),
      connectGatewayProject: null,
      getGatewayAdminToken: () => "",
      appUserData: app.getPath("userData"),
      brain: brain(),
      runProjectCommand,
      writeProjectFile: (rel, content) => writeProjectFile(rootPath, rel, content),
      visionGenerate: async ({ prompt, images, model: visionModel, systemPrompt }) => {
        const useModel = String(visionModel || model || "").trim();
        const content = [
          { type: "text", text: prompt },
          ...(images || []).map((img) => ({
            type: "image_url",
            image_url: { url: img.dataUrl || img.url },
          })),
        ];
        const providerResult = await callProvider({
          baseUrl,
          apiKey,
          model: useModel,
          providerKey: input.providerKey || "",
          messages: [
            { role: "system", content: systemPrompt || "Eres un generador de UI. Solo JSON de archivos." },
            { role: "user", content },
          ],
          timeoutMs: 120_000,
          maxAttempts: 1,
          enableTools: false,
        });
        return String(providerResult?.text || "");
      },
    });

    registerBrainTools(dispatcher, {
      brain: brain(),
      rootPath,
      hostTools: () => dispatcher.definitions(),
    });

    wrapDispatcherWithKnowledgePersist(
      dispatcher,
      createExternalKnowledgeHook({ brain: brain(), projectRoot: rootPath }),
    );

    // Configurar tool executor
    adapter.toolExecutor = {
      async execute(toolName, toolInput) {
        const safePath = String(toolInput?.path || "").replace(/\\/g, "/").slice(0, 240);
        logStartup(`[REAL_GUI_TOOL] runId=${runId} taskId=${taskId} tool=${toolName} path=${safePath || "-"}`);
        const result = await dispatcher.dispatch(toolName, toolInput, {
          runId,
          taskId,
          projectRoot: rootPath,
        });

        if (!result.ok) throw new Error(result.error || `La herramienta ${toolName} fallo.`);
        emitProjectFilesChanged(event, rootPath, toolName, toolInput, result.result);
        if (["write_file", "replace_in_file", "delete_file", "apply_diff"].includes(toolName) && canWrite) {
          const changed = String(toolInput?.path || result.result?.path || "").trim();
          if (changed) {
            runMutations.push({
              path: changed.replace(/\\/g, "/"),
              action: toolName,
              backupPath: String(result.result?.backupPath || ""),
              created: result.result?.created === true
                || (toolName === "write_file" && !result.result?.backupPath),
            });
          }
        }
        if (["write_file", "replace_in_file", "apply_diff"].includes(toolName) && canWrite) {
          const changed = String(toolInput?.path || result.result?.path || "").trim();
          if (changed) {
            queuePostWriteDiagnostics(rootPath, changed, {
              runCommand: (command) => runProjectCommand(rootPath, command, "analysis", runController.signal),
              onResult: (diag) => {
                if (!diag || diag.skipped || diag.passed) return;
                try {
                  sendAgentProgress({
                    phase: "repair",
                    name: "run_diagnostics",
                    text: "Diagnostico post-escritura encontro problemas. Revisa lint/typecheck.",
                    result: diag,
                  });
                } catch {}
              },
            });
          }
        }
        return result.result;
      },
    };

    if (taskManager) {
      const runTaskStatus = workflowContext?.analysisMode || analysisMode ? "ANALYZING" : "EXECUTING";
      durableRun = tasks().startRun(taskId, {
        runId,
        taskStatus: runTaskStatus,
        stage: workflowContext?.analysisMode || analysisMode ? "analysis" : "implementation",
      });
    }

    // Cada herramienta queda enlazada al TASK y RUN persistentes.
    adapter.taskManager = {
      updateProgress(step) {
        if (!taskManager || !durableRun) return;
        const durableStep = tasks().startStep(taskId, durableRun.runId, {
          stage: analysisMode ? "analysis" : "implementation",
          toolName: step.name,
          goal: `Ejecutar ${step.name}`,
          actionId: `action_${crypto.randomUUID()}`,
          nextAction: { type: "TOOL", description: step.name, status: "RUNNING" },
        });
        tasks().completeStep(taskId, durableStep.stepId, { ok: step.ok !== false, result: step.result });
      },
      createCheckpoint(steps) {
        if (!taskManager || !durableRun) return null;
        return tasks().checkpoint(taskId, {
          taskState: tasks().getTask(taskId).status,
          currentStage: analysisMode ? "analysis" : "implementation",
          completedSteps: steps.map((step) => ({ name: step.name, ok: step.ok !== false })),
          nextAction: { type: "CONTINUE", description: "Continuar desde evidencia persistida.", status: "PENDING" },
        });
      },
    };

    // Context store simple (sin task-manager viejo)
    adapter.contextStore = {
      store(data, metadata) {
        return { id: crypto.randomUUID(), data, metadata };
      },
      retrieve(id) {
        return null;
      },
    };

    // Autoconciencia: conexiones reales del operador (sin secretos) + Cerebro.
    let capabilityContext = "";
    try {
      capabilityContext = getOperatorConnectionsMemoryBlock({
        projectRoot: rootPath,
        projectId: input.projectId || "",
      });
      syncOperatorConnectionsToBrain(rootPath);
      const skillsLine = `- Skills del Cerebro activas para esta tarea: ${brainInventory.skills.length}`;
      capabilityContext = `${capabilityContext}\n${skillsLine}`;
    } catch {}

    const failoverCandidates = buildFailoverCandidateProfiles({
      providerKey: input.providerKey,
      baseUrl,
      apiKey,
      model,
    }, { requireTools: !analysisMode || input.planAuthorized === true });
    const modelFailover = new ModelFailoverCoordinator({
      current: { providerKey: input.providerKey, baseUrl, apiKey, model },
      candidates: failoverCandidates,
      capabilities: loadModelCapabilities(),
      requiredCapability: analysisMode && input.planAuthorized !== true ? "agent" : "agent",
      maxRetriesPerModel: 0,
      maxChainLength: Math.max(16, failoverCandidates.length + 1),
      taskContext: {
        taskId,
        planId: workflowContext?.planId || durableTask?.planId || "",
        approvalId: workflowContext?.approvalId || durableTask?.approvalId || "",
        runId,
      },
      onCheckpoint: async (meta) => {
        if (!taskManager || !durableRun) return null;
        const taskState = tasks().getTask(taskId);
        return tasks().checkpoint(taskId, {
          taskState: taskState.status,
          currentStage: meta.currentStage || (analysisMode ? "analysis" : "implementation"),
          completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
          nextAction: {
            type: "CONTINUE",
            description: meta.retrySameModel ? "Reintentar modelo tras fallo recuperable." : "Continuar tras failover de modelo.",
            status: "PENDING",
          },
          metadata: {
            failover: true,
            retrySameModel: meta.retrySameModel === true,
            failedProvider: meta.failedModel?.providerKey || "",
            failedModel: meta.failedModel?.model || "",
            selectedProvider: modelFailover.current?.providerKey || "",
            selectedModel: modelFailover.current?.model || "",
            error: meta.error || "",
            planId: taskState.planId || "",
            approvalId: taskState.approvalId || "",
            runId: durableRun.runId,
            partialResult: String(meta.partialResult || "").slice(0, 4000),
            modifiedFiles: meta.modifiedFiles || [],
          },
        });
      },
    });
    modelFailover.markExecutionStarted();

    // Input para el adaptador
    const inspectorRepairMode = String(input.agentId || "") === "inspector-core-repair";
    // PROCEDE: nunca FOCO (el usuario autorizo ejecucion libre).
    const scopedDiskFocus = input.planAuthorized === true
      ? false
      : (runProfile.scopedDiskFocus === true
      || orchestratorPlan.scopedDiskFocus === true
      || runProfile.scopedFolderFocus === true
      || orchestratorPlan.scopedFolderFocus === true
      || (() => {
        try {
          return require("./project-analysis").isScopedDiskFileRequest?.(task) === true;
        } catch {
          return false;
        }
      })());
    if (!analysisMode) {
      try {
        ensureProjectRoadmap(rootPath, { task: String(task || "").slice(0, 200) });
      } catch {}
    }
    // FOCO 1 archivo: no listar raiz/src ni enriquecer con indice/memoria/Cerebro.
    const projectBootstrap = (scopedDiskFocus || runProfile.skipBootstrap === true)
      ? ""
      : formatProjectBootstrapListing(rootPath, {
        analysisMode,
        task: String(task || "").slice(0, 220),
      });
    let orchestratorSkill = "";
    if (!scopedDiskFocus && !runProfile.greenfieldCreate && !runProfile.conversationOnly) {
      try {
        orchestratorSkill = String((await brain().readSkillForAgent(rootPath, "editcore-brain-orchestrator")).content || "");
      } catch {}
    }
    const brainAgentContext = scopedDiskFocus || (runProfile.greenfieldCreate && !runProfile.permissionFull) || runProfile.conversationOnly
      ? ""
      : formatBrainAgentContext(brainInventory, orchestratorSkill);
    let projectMemoryContext = "";
    if (!scopedDiskFocus) {
      try {
        projectMemoryContext = String(loadProjectContext(rootPath).prompt || "").slice(0, 12_000);
      } catch {}
    }
    // Índice completo solo con @mentions o análisis amplio — no en cada "modifica X".
    let enrichedTask = task;
    if (!scopedDiskFocus) {
      try {
        const { extractAtMentions } = require("./runtime/project-index");
        const mentions = extractAtMentions(task);
        const needsIndex = analysisMode === true || (Array.isArray(mentions) && mentions.length > 0);
        const index = needsIndex ? getCachedProjectIndex(rootPath, { rebuild: false }) : null;
        const enriched = enrichPromptWithMentions(rootPath, task, { index, maxFiles: 4 });
        if (String(enriched.prompt || "").length > String(task || "").length) {
          enrichedTask = enriched.prompt;
        }
      } catch { /* ignore enrich */ }
    }
    // PROCEDE / ejecucion: nunca reutilizar allowlist de analisis (solo read_file).
    if (!analysisMode && canWrite) {
      try {
        const { TOOL_ALLOWLIST, MODES } = require("./runtime/intent-orchestrator");
        const execTools = TOOL_ALLOWLIST?.[MODES?.EXECUTE] || TOOL_ALLOWLIST?.execute || null;
        if (Array.isArray(execTools) && execTools.length) {
          if (orchestratorPlan && typeof orchestratorPlan === "object") {
            orchestratorPlan.allowedTools = execTools.slice();
            orchestratorPlan.analysisMode = false;
            if (orchestratorPlan.runProfile) {
              orchestratorPlan.runProfile.allowedTools = execTools.slice();
              orchestratorPlan.runProfile.analysisMode = false;
              orchestratorPlan.runProfile.mode = MODES?.EXECUTE || "execute";
            }
          }
          if (runProfile && typeof runProfile === "object") {
            runProfile.allowedTools = execTools.slice();
            runProfile.analysisMode = false;
            runProfile.mode = MODES?.EXECUTE || "execute";
          }
        }
      } catch { /* ignore */ }
    }
    // H1: inyectar liderazgo cognitivo en el bloque que consume el adapter
    try {
      const lead = String(orchestratorPlan?.agentLeadershipHint || "").trim();
      if (lead && runProfile && typeof runProfile === "object") {
        runProfile.orchestrationBlock = [runProfile.orchestrationBlock, lead].filter(Boolean).join("\n\n");
      }
      if (lead && orchestratorPlan?.runProfile) {
        orchestratorPlan.runProfile.orchestrationBlock = [
          orchestratorPlan.runProfile.orchestrationBlock,
          lead,
        ].filter(Boolean).join("\n\n");
      }
    } catch { /* ignore */ }
    const adapterInput = {
      prompt: enrichedTask,
      rawUserPrompt: task,
      promptOnlyMode: runProfile.promptOnlyMode,
      allowFilesystem: runProfile.allowFilesystem,
      runProfile,
      orchestratorPlan,
      scopedDiskFocus,
      projectRoot: rootPath,
      projectId: String(input.projectId || ""),
      taskId,
      model,
      apiKey,
      baseUrl,
      providerKey: input.providerKey,
      allowWrite: canWrite,
      permissionMode: selectedPermission,
      analysisMode,
      planAuthorized: input.planAuthorized === true || selectedPermission === "full",
      permissionFull: selectedPermission === "full",
      fullAccess: selectedPermission === "full",
      agentLeadershipHint: String(orchestratorPlan?.agentLeadershipHint || "").trim(),
      fixQueue: Array.isArray(input.fixQueue)
        ? input.fixQueue
        : (Array.isArray(workflowContext?.plan?.fixQueue) ? workflowContext.plan.fixQueue : []),
      authorizedPlanText: String(
        input.authorizedPlanText
        || workflowContext?.plan?.content
        || workflowContext?.plan?.planReference
        || durableTask?.planReference
        || "",
      ).trim(),
      persistedPlan: String(input.persistedPlan || workflowContext?.plan?.content || "").trim(),
      requireEvidence: input.requireEvidence !== false,
      enforceController: true,
      maxTokens: inspectorRepairMode ? 500000 : Math.min(400000, Number(input.maxOutputTokens) || 400000),
      brainContext: brainCtx,
      brainInventory,
      images: normalizeImages(input.images),
      analysisContext: String(input.analysisContext || ""),
      freshAnalysisRun,
      runId,
      previousRunSummary: freshAnalysisRun ? "" : previousAgentRunSummary(rootPath),
      resumeSteps: Array.isArray(input.resumeSteps) ? input.resumeSteps : [],
      preobservedFiles: Array.isArray(input.preobservedFiles) ? input.preobservedFiles : [],
      history: Array.isArray(input.history) ? input.history.slice(-(orchestratorPlan.cursorParityMode ? CURSOR_PARITY_LIMITS.historyMessages : 12)) : [],
      cursorParityEnabled: orchestratorPlan.cursorParityMode === true || input.cursorParityEnabled !== false,
      cursorParityMode: orchestratorPlan.cursorParityMode === true,
      systemPrompt: String(input.systemPrompt || "").trim(),
      namespace: String(input.namespace || ""),
      systemExtra: [
        runProfile.orchestrationBlock,
        formatJarvisContextForPrompt(rootPath),
        brainAgentContext,
        projectMemoryContext,
        projectBootstrap,
        capabilityContext,
        durableTaskContext,
        String(input.systemPrompt || "").trim(),
        inspectorRepairMode
          ? [
            "MODO INSPECTOR SELF-REPAIR:",
            "- Estas reparando EditCoreAI mismo, no un proyecto de usuario. projectRoot es la instalacion de EditCore.",
            "- Ya existe un checkpoint del host con rollback automatico si la validacion detecta regresiones; trabaja con decision.",
            "- Corrige un problema por vez, verifica con npm test o npm run check y continua con el siguiente.",
            "- No repitas el diagnostico: las alertas ya fueron entregadas en el prompt.",
          ].join("\n")
          : "",
      ].filter(Boolean).join("\n\n"),
      signal: runController.signal,
      onProgress: sendAgentProgress,
      onAnalysisCheckpoint: ({ steps: checkpointSteps = [], phase = "mid" } = {}) => {
        try {
          // ROADMAP es escritura de sistema (indice compacto). Se permite en analisis
          // aunque el modelo no pueda mutar codigo / aunque Acceso sea solo lectura.
          const payload = buildRoadmapSyncFromRun({
            steps: checkpointSteps,
            task: String(task || input.prompt || "").slice(0, 220),
            analysisMode: true,
            completed: false,
            status: phase === "mid"
              ? "Analisis en curso. ROADMAP checkpoint (ahorro de tokens)."
              : undefined,
          });
          syncProjectRoadmap(rootPath, payload);
          sendAgentProgress({
            phase: "model",
            text: "ROADMAP.md actualizado (checkpoint de tokens).",
          });
        } catch (error) {
          logStartup(`roadmap-checkpoint fallo: ${String(error?.message || error).slice(0, 120)}`);
        }
      },
      maxAutoFixCycles: 3,
      runPostWriteDiagnostics: async (changedFiles = []) => {
        const { runDiagnostics } = require("./runtime/post-write-diagnostics");
        return runDiagnostics(rootPath, changedFiles, {
          runCommand: (command) => runProjectCommand(rootPath, command, "analysis", runController.signal),
        });
      },
      onTerminalVerificationFailure: async ({ reason = "", diag = null } = {}) => {
        if (runState.mutationRollbackDone) return { ok: false, skipped: true };
        runState.mutationRollbackDone = true;
        let fileUndo = null;
        try {
          if (runMutations.length) {
            saveLastAgentRun(app.getPath("userData"), rootPath, {
              runId,
              at: new Date().toISOString(),
              task: String(task || input.prompt || "").slice(0, 500),
              files: runMutations,
              steps: [],
            });
            fileUndo = restoreLastAgentRun(app.getPath("userData"), rootPath, { resolveInside });
          }
        } catch (error) {
          fileUndo = { ok: false, error: String(error?.message || error) };
        }
        const gitUndo = rollbackMutationCheckpoint(rootPath, runState.mutationCheckpoint || null);
        sendAgentProgress({
          phase: "repair",
          name: "mutation_rollback",
          text: `Rollback tras verificacion fallida${reason ? `: ${reason}` : ""}.`,
          result: { fileUndo, gitUndo, diag },
        });
        return { ok: Boolean(fileUndo?.ok || gitUndo?.ok), fileUndo, gitUndo };
      },
      steering: runState.steering,
      failover: modelFailover,
      pullWorkerDeathError: () => {
        if (!runState.pendingWorkerDeathError) return null;
        const err = runState.pendingWorkerDeathError;
        runState.pendingWorkerDeathError = null;
        return err;
      },
      captureExecutionEpoch: () => runState.executionEpoch || 0,
      assertExecutionActive: (capturedEpoch) => {
        if (capturedEpoch !== undefined && capturedEpoch !== (runState.executionEpoch || 0)) {
          const error = new Error("Ejecucion invalidada por failover de worker.");
          error.code = "EXECUTION_INVALIDATED";
          throw error;
        }
      },
      resetWorkerHealth: () => {
        workerSupervisor?.resetWorkerHealth(String(event.sender.id), runId);
        runState.pendingWorkerDeathError = null;
      },
    };

    runState.adapterInput = adapterInput;
    runState.executionEpoch = 0;
    workerSupervisor?.registerRunContext(String(event.sender.id), runId, {
      failover: modelFailover,
      adapterInput,
      taskContext: {
        taskId,
        planId: workflowContext?.planId || durableTask?.planId || "",
        approvalId: workflowContext?.approvalId || durableTask?.approvalId || "",
        runId,
      },
      handledWorkerDeaths: new Set(),
      get executionEpoch() { return runState.executionEpoch || 0; },
      set executionEpoch(value) { runState.executionEpoch = value; },
      get pendingWorkerDeathError() { return runState.pendingWorkerDeathError || null; },
      set pendingWorkerDeathError(value) { runState.pendingWorkerDeathError = value; },
      getRequestController: () => runState.requestController,
    });

    console.log("ÔÜí [Claude Code] Ejecutando con ActionRegistry, SmartRetry, TokenLedger, AdaptiveBudget y Memory");

    const supervised = workerSupervisor?.start({
      senderId: String(event.sender.id),
      taskId,
      runId,
      durableRunId: durableRun?.runId || "",
      heartbeatMs: 5000,
      onCancel: (reason) => {
        if (/WORKER_DEAD|heartbeat no recibido/i.test(String(reason || ""))) return true;
        runController.abort(new Error(reason || "Ejecucion cancelada por supervisor."));
        return true;
      },
      execute: async () => adapter.executeTask(adapterInput),
    });

    // EJECUTAR — Motor Único Unificado de Agente
    let result;
    try {
      const procedeAuth = input.planAuthorized === true
        || /^\s*(?:procede|adelante|autorizo|contin[uú]a)\b/i.test(String(input.prompt || task || ""))
        || /TAREA CONCRETA:|AUTORIZACION DE EJECUCION \(PROCEDE\)/i.test(String(input.prompt || task || ""));
      sendAgentProgress({
        phase: "startup",
        text: procedeAuth
          ? "Ejecutando plan autorizado (write_file/replace_in_file)..."
          : (analysisMode
            ? "Agente de analisis (lectura + reporte)..."
            : "Agente EditCore..."),
      });
      result = supervised ? await supervised.promise : await adapter.executeTask(adapterInput);
      logStartup(`[UNIFIED_AGENT] ejecucion completada analysis=${analysisMode === true} procede=${procedeAuth}`);
    } finally {
      // Memoria entre corridas: la siguiente corrida en este proyecto recibe
      // lo que ya se hizo (incluso si esta termino con error).
      rememberAgentRun(rootPath, task, result?.text || "", adapter.steps || []);
    }

    if (taskManager && durableRun) {
      tasks().updateTokenUsage(taskId, durableRun.runId, result.usage || {});
      if (result.completed) {
        tasks().updateRun(taskId, durableRun.runId, { status: "COMPLETED" });
        if (workflowOrchestrator && (workflowContext?.analysisMode || analysisMode)) {
          workflowOrchestrator.completeAnalysisRun(taskId, String(result.text || ""), {
            projectId: String(input.projectId || ""),
            projectRoot: rootPath,
            steps: result.steps || adapter.steps || [],
            fixQueue: Array.isArray(result.fixQueue) ? result.fixQueue : (result.report?.fixQueue || undefined),
            evidence: result.evidence || undefined,
          });
        } else if (workflowOrchestrator && workflowContext?.planAuthorized) {
          workflowOrchestrator.completeImplementationRun(taskId, durableRun.runId, { ok: true });
        } else if (analysisMode) {
          tasks().transition(taskId, "AWAITING_AUTHORIZATION", {
            currentStage: "awaiting_authorization",
            planReference: String(result.text || "").slice(0, 12_000),
            nextAction: {
              type: "AUTHORIZE",
              description: "Esperando procede/continua del usuario para ejecutar correcciones.",
              status: "WAITING",
            },
            resumeRequired: false,
            recoveryReason: "",
          }, "ANALYSIS_AWAITING_AUTHORIZATION");
        } else {
          // Nunca marcar COMPLETED solo porque el modelo dijo "listo" sin mutar disco.
          // Eso dejaba el chat muerto: procede/continua → "tarea terminal COMPLETED".
          const doneSteps = Array.isArray(result.steps) ? result.steps : (adapter.steps || []);
          const mutated = doneSteps.some((step) => step?.ok !== false && [
            "write_file", "replace_in_file", "delete_file", "create_project", "apply_diff",
          ].includes(String(step?.name || "")));
          const reportText = String(result.text || "");
          const looksLikePlan = /##\s*(?:Qué|Que)\s+sí\s+funcionó/i.test(reportText)
            || /Cuando autorices|escribe\s+\*{0,2}procede/i.test(reportText)
            || /##\s*(?:Plan|Recomendaciones|C[oó]mo lo corregir)/i.test(reportText);
          if (looksLikePlan && workflowOrchestrator) {
            workflowOrchestrator.completeAnalysisRun(taskId, reportText, {
              projectId: String(input.projectId || ""),
              projectRoot: rootPath,
              steps: doneSteps,
              fixQueue: Array.isArray(result.fixQueue) ? result.fixQueue : (result.report?.fixQueue || undefined),
              evidence: result.evidence || undefined,
            });
          } else if (mutated) {
            tasks().recordRuntimeEvent(taskId, "COMPLETION_VALIDATED", { runId: durableRun.runId, stage: "verification" });
            tasks().markTaskCompleted(taskId, { verificationStatus: "passed", currentStage: "completed" });
          } else {
            tasks().markTaskFailed(
              taskId,
              new Error(result.stopReason || "Cierre sin mutacion real en disco. Escribe procede o continua para retomar."),
              { recoverable: true, runId: durableRun.runId, stage: "verification" },
            );
          }
        }
      } else {
        if (adapterInput.failoverWaiting && taskManager) {
          tasks().transition(taskId, "WAITING", {
            currentStage: "waiting_for_provider",
            resumeRequired: true,
            recoveryReason: result.stopReason || "Esperando proveedor compatible.",
            nextAction: {
              type: "WAIT_FOR_PROVIDER",
              description: "Reanudar cuando exista un modelo compatible disponible.",
              status: "WAITING",
            },
          }, "WAITING_FOR_PROVIDER");
        } else if (workflowOrchestrator && workflowContext?.planAuthorized) {
          workflowOrchestrator.completeImplementationRun(taskId, durableRun.runId, {
            ok: false,
            error: result.stopReason || "Finalizacion sin evidencia.",
          });
        } else {
          tasks().markTaskFailed(taskId, new Error(result.stopReason || "Finalizacion sin evidencia."), { recoverable: true, runId: durableRun.runId, stage: "verification" });
        }
      }
    }

    console.log(`[Agent] Finalizado: completed=${result.completed} | ${result.steps.length} pasos | ${result.usage.tokensUsed} tokens`);

    try {
      const changedFiles = (result.steps || [])
        .filter((step) => step.ok !== false && ["write_file", "replace_in_file", "delete_file", "create_project", "apply_diff"].includes(step.name))
        .map((step) => String(step.input?.path || step.result?.path || "").replace(/\\/g, "/"))
        .filter(Boolean);
      rememberProjectEvent(rootPath, {
        task,
        summary: String(result.text || "").slice(0, 400),
        files: changedFiles,
        decision: result.completed ? "corrida completada" : String(result.stopReason || "corrida incompleta").slice(0, 200),
      });
      // ROADMAP siempre (analisis o escritura): indice compacto para bajar tokens
      // en el siguiente turno. No depende de canWrite del modelo.
      const mutated = changedFiles.filter((file) => !/(^|\/)ROADMAP\.md$/i.test(file));
      if (mutated.length || analysisMode || result.completed) {
        const payload = buildRoadmapSyncFromRun({
          steps: result.steps || [],
          task: String(task || "").slice(0, 220),
          analysisMode,
          completed: result.completed === true,
          reportText: String(result.text || ""),
          status: analysisMode
            ? (result.completed
              ? "Analisis cerrado. ROADMAP generado/actualizado con el mapa real."
              : `Analisis incompleto: ${String(result.stopReason || "").slice(0, 140)}`)
            : (result.completed ? "Cambios cerrados. Partir de este ROADMAP en el siguiente turno." : `Incompleto: ${String(result.stopReason || "").slice(0, 140)}`),
          nextAction: result.completed
            ? "Leer este ROADMAP y continuar. No reexplorar el proyecto entero."
            : "Retomar desde este ROADMAP.",
        });
        if (!analysisMode && mutated.length) {
          payload.files = [...new Set([...(payload.files || []), ...mutated])];
        }
        syncProjectRoadmap(rootPath, payload);
      }
    } catch {}

    // Enviar resultado al UI
    const completedTask = taskManager ? tasks().getTask(taskId) : null;
    const completedPlan = (completedTask?.planId && taskManager)
      ? taskStore.getPlan(taskId, completedTask.planId)
      : (workflowContext?.plan || null);
    const persistedFixQueue = Array.isArray(completedPlan?.fixQueue) ? completedPlan.fixQueue : [];
    let undoCheckpoint = null;
    let reviewPayload = { runId: "", files: [] };
    try {
      if (runMutations.length) {
        undoCheckpoint = saveLastAgentRun(app.getPath("userData"), rootPath, {
          runId,
          at: new Date().toISOString(),
          task: String(task || input.prompt || "").slice(0, 500),
          files: runMutations,
          steps: result.steps || [],
        });
        reviewPayload = buildLastRunReview(app.getPath("userData"), rootPath, { resolveInside });
      }
    } catch (error) {
      logStartup(`agent-run-checkpoint save fallo: ${String(error?.message || error).slice(0, 160)}`);
    }
    const reportExtras = {
      canUndo: Boolean(undoCheckpoint?.files?.length),
      undoFiles: (undoCheckpoint?.files || []).map((f) => f.path),
      review: reviewPayload,
      fixQueue: persistedFixQueue,
    };
    event.sender.send("agent:complete", {
      runId,
      projectId: String(input.projectId || ""),
      taskId,
      planId: completedTask?.planId || workflowContext?.planId || "",
      approvalId: completedTask?.approvalId || workflowContext?.approvalId || "",
      fixQueue: persistedFixQueue,
      completed: result.completed,
      text: result.text,
      steps: slimAgentStepsForIpc(result.steps),
      usage: result.usage,
      report: {
        ...(result.report || {}),
        ...reportExtras,
      },
    });
    publishAgentTaskComplete(event.sender, {
      runId,
      projectId: String(input.projectId || ""),
      projectRoot: rootPath,
      completed: result.completed,
      text: result.text,
      changedFiles: result.report?.changedFiles || reportExtras.undoFiles || [],
      report: { ...(result.report || {}), ...reportExtras },
    });

    return {
      taskId,
      planId: completedTask?.planId || workflowContext?.planId || "",
      approvalId: completedTask?.approvalId || workflowContext?.approvalId || "",
      fixQueue: persistedFixQueue,
      text: result.text,
      steps: slimAgentStepsForIpc(result.steps),
      usage: result.usage,
      report: {
        ...(result.report || {}),
        ...reportExtras,
      },
    };

  } catch (error) {
    console.error("ÔØî [Claude Code] Error:", error);

    if (taskManager && taskId) {
      try { tasks().markTaskFailed(taskId, error, { recoverable: true, runId: durableRun?.runId || "", stage: "execution" }); } catch {}
    }

    // Traducir errores tecnicos a un mensaje accionable: la tarea queda
    // guardada con checkpoints y el usuario puede pedir continuar.
    const rawMessage = String(error?.message || error);
    const friendlyMessage = /timeout|timed out|aborted|abortado|excedio el limite/i.test(rawMessage)
      ? `La ejecucion se detuvo por tiempo (${rawMessage.slice(0, 140)}). La tarea y sus checkpoints quedaron guardados: escribe "continua" para retomarla desde donde quedo.`
      : /unexpected token|invalid json|malformed|JSON\.parse/i.test(rawMessage)
        ? `La tarea sigue activa; EditCore reintento en silencio con otro modelo. Escribe CONTINUA o PROCEDE para retomar.`
      : /HTTP 5\d\d|error interno|internal server|bad gateway|service unavailable|overloaded/i.test(rawMessage)
        ? `El proveedor de IA fallo temporalmente. La tarea quedo guardada: escribe "continua" para reintentar.`
        : rawMessage;

    // Enviar error al UI
    event.sender.send("agent:error", {
      runId,
      projectId: String(input.projectId || ""),
      taskId,
      error: friendlyMessage,
    });

    const enriched = new Error(friendlyMessage);
    enriched.cause = error;
    throw enriched;

  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    // Limpiar run activo
    if (activeAgentRuns.get(runKey) === runState) {
      activeAgentRuns.delete(runKey);
    }
  }
});

function registerAgentWriteTools(dispatcher, rootPath, canWrite, runController, prompt = "") {
  if (!canWrite || !dispatcher) return;
  dispatcher.register({
    name: "create_project",
    write: true,
    description: "Crea proyecto desde plantilla (blank|web|node|react|lovable-web|next-saas|open-saas|soundonemusic|auto).",
    execute: async (toolInput) => createProjectInside(rootPath, { ...toolInput, prompt: toolInput.prompt || prompt }, { signal: runController.signal, prompt }),
  });
}

function createAgentTaskManagerBridge(taskId, durableRun, analysisMode = false) {
  return {
    updateProgress(step) {
      if (!taskManager || !durableRun) return;
      const durableStep = tasks().startStep(taskId, durableRun.runId, {
        stage: analysisMode ? "analysis" : "implementation",
        toolName: step.name,
        goal: `Ejecutar ${step.name}`,
        actionId: `action_${crypto.randomUUID()}`,
        nextAction: { type: "TOOL", description: step.name, status: "RUNNING" },
      });
      tasks().completeStep(taskId, durableStep.stepId, { ok: step.ok !== false, result: step.result });
    },
    createCheckpoint(steps) {
      if (!taskManager || !durableRun) return null;
      return tasks().checkpoint(taskId, {
        taskState: tasks().getTask(taskId).status,
        currentStage: analysisMode ? "analysis" : "implementation",
        completedSteps: steps.map((step) => ({ name: step.name, ok: step.ok !== false })),
        nextAction: { type: "CONTINUE", description: "Continuar desde evidencia persistida.", status: "PENDING" },
      });
    },
  };
}

// Registra herramientas locales de escritura usadas por el bridge Jarvis/local.
function ensureAgentWriteToolRegistry(rootPath, canWrite, runController) {
  const dispatcher = new ToolDispatcher({
    authorize: async () => canWrite,
  });
  registerAgentWriteTools(dispatcher, rootPath, canWrite, runController);
  return dispatcher;
}

ipcMain.handle("agent:cancel", (event, input = {}) => {
  try { stopChatKernel(); } catch { /* ignore */ }
  const runId = String(input.runId || "").trim();
  const reason = "Detenido.";
  if (!runId) return cancelRunsForSender(event.sender.id, reason);

  const planRun = activePlanRuns.get(planRunKey(event.sender.id, runId));
  if (planRun?.controller) {
    planRun.controller.abort(new Error("Plan cancelado por el usuario."));
    activePlanRuns.delete(planRunKey(event.sender.id, runId));
    return true;
  }

  const run = agentRunForEvent(event, runId);
  if (run?.controller) {
    run.requestController?.abort(new Error(reason));
    run.controller.abort(new Error(reason));
    activeAgentRuns.delete(agentRunKey(event.sender.id, run.runId || runId));
    return true;
  }

  return cancelRunsForSender(event.sender.id, reason);
});

ipcMain.handle("agent:peek-last-run", (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  if (!root) return null;
  try {
    return peekLastAgentRun(app.getPath("userData"), assertProjectRoot(root));
  } catch {
    return null;
  }
});

ipcMain.handle("agent:undo-last-run", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const preferSnapshot = input.preferSnapshot === true || input.source === "snapshot";

  const runSnapshotRollback = () => {
    const { rollbackLastChange } = require("./editcore-chat-kernel/snapshot");
    const snap = rollbackLastChange(root, input.snapshotId || null);
    if (snap?.ok) {
      return {
        ok: true,
        restored: (snap.restored || []).length + (snap.deleted || []).length,
        files: [
          ...(snap.restored || []).map((p) => ({ path: p, action: "restore" })),
          ...(snap.deleted || []).map((p) => ({ path: p, action: "delete" })),
        ],
        errors: [],
        snapshotId: snap.snapshotId,
        source: "editcore-snapshot",
      };
    }
    return {
      ok: false,
      restored: 0,
      files: [],
      errors: [],
      source: "editcore-snapshot",
      error: snap?.error || "Sin snapshots para restaurar",
    };
  };

  if (preferSnapshot) {
    try {
      const snapResult = runSnapshotRollback();
      if (snapResult.ok) return snapResult;
    } catch (error) {
      return {
        ok: false,
        restored: 0,
        files: [],
        errors: [],
        source: "editcore-snapshot",
        error: String(error?.message || error),
      };
    }
  }

  let agentUndo = null;
  try {
    agentUndo = restoreLastAgentRun(app.getPath("userData"), root, { resolveInside });
  } catch (error) {
    const msg = String(error?.message || error);
    if (/ya fue deshecha/i.test(msg)) {
      return {
        ok: false,
        restored: 0,
        files: [],
        errors: [],
        source: "agent-run",
        error: msg,
      };
    }
    agentUndo = { restored: 0, files: [], errors: [], error: msg };
  }
  const restoredCount = Number(agentUndo?.restored || 0);
  if (restoredCount > 0) {
    return { ...agentUndo, ok: true, source: "agent-run" };
  }
  // Fallback: checkpoint del kernel (.editcore/snapshots/)
  try {
    const snapResult = runSnapshotRollback();
    if (snapResult.ok) return snapResult;
    return {
      ...(agentUndo || { restored: 0, files: [], errors: [] }),
      ...snapResult,
      ok: false,
      error: snapResult.error || agentUndo?.error || "Sin cambios para deshacer",
    };
  } catch (error) {
    return {
      ...(agentUndo || { restored: 0, files: [], errors: [] }),
      ok: false,
      source: "editcore-snapshot",
      error: String(error?.message || error),
    };
  }
});

ipcMain.handle("agent:review-last-run", (_event, input = {}) => {
  const root = String(input.projectRoot || "").trim();
  if (!root) return { runId: "", files: [] };
  try {
    return buildLastRunReview(app.getPath("userData"), assertProjectRoot(root), { resolveInside });
  } catch {
    return { runId: "", files: [] };
  }
});

ipcMain.handle("agent:review-file", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const decision = String(input.decision || "").toLowerCase() === "reject" ? "reject" : "accept";
  if (input.hunkId) {
    return reviewHunkDecision(
      app.getPath("userData"),
      root,
      String(input.path || ""),
      String(input.hunkId || ""),
      decision,
      { resolveInside },
    );
  }
  return reviewFileDecision(app.getPath("userData"), root, String(input.path || ""), decision, { resolveInside });
});

ipcMain.handle("agent:review-hunk", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const decision = String(input.decision || "").toLowerCase() === "reject" ? "reject" : "accept";
  return reviewHunkDecision(
    app.getPath("userData"),
    root,
    String(input.path || ""),
    String(input.hunkId || ""),
    decision,
    { resolveInside },
  );
});

ipcMain.handle("agent:accept-all-review", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return acceptAllPending(app.getPath("userData"), root);
});

ipcMain.handle("agent:git-status", (_event, input = {}) => {
  const { gitStatus, gitDiffStat } = require("./runtime/agent-git");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return { ...gitStatus(root), diff: gitDiffStat(root) };
});

ipcMain.handle("agent:git-suggest-commit", (_event, input = {}) => {
  const { suggestCommitMessage } = require("./runtime/agent-git");
  const root = String(input.projectRoot || "").trim();
  let files = Array.isArray(input.files) ? input.files : [];
  if (!files.length && root) {
    try {
      const review = buildLastRunReview(app.getPath("userData"), assertProjectRoot(root), { resolveInside });
      files = review.files || [];
    } catch {
      files = [];
    }
  }
  return suggestCommitMessage({
    files,
    runId: String(input.runId || ""),
    task: String(input.task || ""),
  });
});

ipcMain.handle("agent:git-commit", (_event, input = {}) => {
  const { gitCommit } = require("./runtime/agent-git");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const paths = Array.isArray(input.paths) ? input.paths : [];
  return gitCommit(root, String(input.message || ""), { addPaths: paths });
});

ipcMain.handle("project:index-build", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const index = getCachedProjectIndex(root, { rebuild: true, maxFiles: Number(input.maxFiles) || 4000 });
  let projectMap = null;
  try {
    const { ensureProjectMap } = require("./runtime/project-map");
    projectMap = ensureProjectMap(root, { force: true });
  } catch (_) {
    projectMap = null;
  }
  return {
    ok: true,
    fileCount: index.fileCount,
    tokenCount: index.tokenCount,
    symbolCount: index.symbolCount || 0,
    schemaCount: index.schemaCount || 0,
    builtAt: index.builtAt,
    projectMap: projectMap?.ok
      ? {
          path: ".editcore/project-map.json",
          dirCount: projectMap.map?.dirCount || 0,
          fileCount: projectMap.map?.fileCount || 0,
          rootDirs: (projectMap.map?.rootDirs || []).slice(0, 40),
          stack: projectMap.map?.stack || [],
          builtAt: projectMap.map?.builtAt || null,
        }
      : null,
  };
});

ipcMain.handle("project:index-search", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const index = getCachedProjectIndex(root, { rebuild: input.refresh === true });
  return {
    ok: true,
    hits: searchProjectIndex(index, String(input.query || ""), { limit: Number(input.limit) || 20 }),
    symbolCount: index.symbolCount || 0,
    schemaCount: index.schemaCount || 0,
    schemas: (index.schemas || []).slice(0, 40),
  };
});

ipcMain.handle("mcp:health", async (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return mcpStatusWithTools(root, { userDataPath: app.getPath("userData") });
});

ipcMain.handle("mcp:register", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return registerMcpServer(root, input);
});

ipcMain.handle("mcp:remove", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return removeMcpServer(root, input.id || input.name || "");
});

ipcMain.handle("privacy:get", () => readPrivacyMode(readSecureState()));

ipcMain.handle("privacy:set", (_event, input = {}) => {
  const { state, privacyMode } = setPrivacyMode(readSecureState(), input.enabled === true);
  writeSecureState(state);
  return privacyMode;
});

ipcMain.handle("terminal:policy", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return readTerminalPolicy(root);
});

ipcMain.handle("terminal:yolo", (_event, input = {}) => {
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return setYoloMode(root, input.enabled === true);
});

ipcMain.handle("terminal:check", (_event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return isCommandAllowed(root, String(input.command || ""));
});

ipcMain.handle("project:workflows", (_event, input = {}) => {
  const {
    listWorkflows,
    ensureWorkflowScaffold,
    loadScopedRules,
    runWorkflow,
  } = require("./runtime/project-rules-workflows");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  if (input.ensure === true) ensureWorkflowScaffold(root);
  if (input.run === true || input.workflow || input.id) {
    return runWorkflow(root, input.workflow || input.id || input.name, {
      runCommand: (command) => runProjectCommand(root, command, "analysis"),
    });
  }
  return {
    workflows: listWorkflows(root),
    rules: loadScopedRules(root, String(input.path || "")),
  };
});

ipcMain.handle("project:docker-compose", (_event, input = {}) => {
  const { runDockerCompose, dockerComposeLogs } = require("./runtime/docker-playbooks");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  if (String(input.action || "") === "logs") return dockerComposeLogs(root, input);
  return runDockerCompose(root, input);
});

ipcMain.handle("agent:git-pull", (_event, input = {}) => {
  const { gitPull } = require("./runtime/agent-git");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return gitPull(root, input);
});

ipcMain.handle("agent:git-push", (_event, input = {}) => {
  const { gitPush } = require("./runtime/agent-git");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return gitPush(root, input);
});

ipcMain.handle("project:tab-predict", (_event, input = {}) => {
  const { collectCandidates, ghostFromCandidates } = require("./runtime/tab-prediction");
  const root = String(input.projectRoot || "").trim();
  let index = null;
  try {
    if (root) index = getCachedProjectIndex(assertProjectRoot(root), { rebuild: false });
  } catch {
    index = null;
  }
  const result = collectCandidates(root, String(input.prompt || ""), {
    index,
    history: Array.isArray(input.history) ? input.history : [],
  });
  const candidates = Array.isArray(result) ? result : (result.candidates || []);
  const ghost = ghostFromCandidates(String(input.prompt || ""), candidates);
  return {
    candidates,
    latencyMs: result.latencyMs || 0,
    engine: result.engine || "local-index+snippets",
    ghost: ghost.ghost,
    accept: ghost.accept,
  };
});

ipcMain.handle("project:semantic-reindex", (_event, input = {}) => {
  const { buildIncrementalIndex } = require("./runtime/semantic-index-incremental");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const index = buildIncrementalIndex(root, { force: input.force === true });
  return {
    ok: true,
    docs: index.docs.length,
    stats: index.stats || null,
    engine: index.engine,
    builtAt: index.builtAt,
  };
});


ipcMain.handle("extensions:install-vsix", async (_event, input = {}) => {
  const { installVsix } = require("./runtime/extension-host");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return installVsix(root, input.vsixPath || input.path, { activate: input.activate !== false });
});

ipcMain.handle("extensions:list", (_event, input = {}) => {
  const { listExtensions } = require("./runtime/extension-host");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return listExtensions(root);
});

ipcMain.handle("extensions:uninstall", (_event, input = {}) => {
  const { uninstallExtension } = require("./runtime/extension-host");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return uninstallExtension(root, input.id || input.extensionId);
});

ipcMain.handle("pty:create", (event, input = {}) => {
  const { createSession, attachDataListener } = require("./runtime/pty-session");
  const root = String(input.projectRoot || input.cwd || "").trim();
  let cwd = process.cwd();
  try {
    if (root) cwd = assertProjectRoot(root);
  } catch {
    cwd = root && require("node:path").isAbsolute(root) ? root : process.cwd();
  }
  const snap = createSession({
    cwd,
    cols: Number(input.cols) || 120,
    rows: Number(input.rows) || 30,
    ownerId: event.sender.id,
  });
  const sender = event.sender;
  attachDataListener(snap.id, (data) => {
    if (!sender.isDestroyed()) sender.send("pty:data", { id: snap.id, data });
  });
  return snap;
});

ipcMain.handle("pty:write", (_event, input = {}) => {
  const { writeSession } = require("./runtime/pty-session");
  return writeSession(input.id || input.sessionId, input.data ?? input.text ?? "");
});

ipcMain.handle("pty:resize", (_event, input = {}) => {
  const { resizeSession } = require("./runtime/pty-session");
  return resizeSession(input.id || input.sessionId, input.cols, input.rows);
});

ipcMain.handle("pty:kill", (_event, input = {}) => {
  const { killSession } = require("./runtime/pty-session");
  return killSession(input.id || input.sessionId);
});

ipcMain.handle("pty:list", () => {
  const { listSessions, nodePtyAvailable } = require("./runtime/pty-session");
  return { sessions: listSessions(), nodePtyAvailable: nodePtyAvailable() };
});

ipcMain.handle("project:memory-get", (_event, input = {}) => {
  const { loadProjectMemory } = require("./runtime/project-memory");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return loadProjectMemory(root);
});

ipcMain.handle("project:memory-remember", (_event, input = {}) => {
  const { rememberProjectEvent } = require("./runtime/project-memory");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return rememberProjectEvent(root, input);
});

ipcMain.handle("project:memory-rule", (_event, input = {}) => {
  const { upsertArchitectureRule } = require("./runtime/project-memory");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return upsertArchitectureRule(root, input.rule || input.text || "");
});

ipcMain.handle("session:export", (_event, input = {}) => {
  const { exportSession } = require("./runtime/session-export");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return exportSession(root, input);
});

ipcMain.handle("project:audit-dead-code", (_event, input = {}) => {
  const { auditDeadCode, auditSqlPerformance } = require("./runtime/dead-code-audit");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  if (input.mode === "sql") return auditSqlPerformance(root, input);
  return auditDeadCode(root, input);
});

ipcMain.handle("project:tail-logs", (_event, input = {}) => {
  const { tailLog } = require("./runtime/log-tail");
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  return tailLog(root, input);
});

ipcMain.handle("project:migration-playbook", (_event, input = {}) => {
  const {
    applyMigrationPlaybook,
    listMigrationPlaybooks,
    runMigrationBatch,
    rollbackMigrationBatch,
  } = require("./runtime/migration-playbooks");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  if (input.list === true) return { playbooks: listMigrationPlaybooks() };
  if (input.rollback === true || input.action === "rollback") {
    return rollbackMigrationBatch(root, input.runId || input.id);
  }
  if (Array.isArray(input.batch) && input.batch.length) {
    return runMigrationBatch(root, input);
  }
  return applyMigrationPlaybook(root, input.playbook || input.id || "");
});

ipcMain.handle("project:run-tdd", (_event, input = {}) => {
  const { runTddCycle } = require("./runtime/tdd-cycle");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return runTddCycle(root, input, {
    runCommand: (command) => runProjectCommand(root, command, "analysis"),
  });
});

ipcMain.handle("project:test-repair", async (_event, input = {}) => {
  const { runTddRepair } = require("./runtime/test-repair-loop");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return runTddRepair(root, {
    testCommand: input.testCommand || input.command || "",
    maxAttempts: Number(input.maxAttempts) || 3,
    patches: Array.isArray(input.patches) ? input.patches : [],
    runCommand: (command) => runProjectCommand(root, command, "analysis"),
  });
});

ipcMain.handle("agent:git-create-branch", (_event, input = {}) => {
  const { gitCreateBranch } = require("./runtime/agent-git");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return gitCreateBranch(root, input.branch || input.name, { checkout: input.checkout !== false });
});

ipcMain.handle("project:rename-sync", (_event, input = {}) => {
  const { renameSyncFile, renameSyncSymbol } = require("./runtime/rename-sync");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  if (input.kind === "symbol" || input.oldName || input.fromSymbol) {
    return renameSyncSymbol(root, input);
  }
  return renameSyncFile(root, input.from, input.to, {
    dryRun: input.dryRun === true,
    updateRefs: input.updateRefs !== false,
  });
});

ipcMain.handle("project:images-to-code", async (_event, input = {}) => {
  const privacy = readPrivacyMode(readSecureState());
  const cloudGate = assertCloudAllowed(privacy, String(input.providerKey || input.provider || ""));
  if (!cloudGate.ok && input.images?.length) {
    // Vision cloud bloqueada: caer a scaffold local sin LLM.
    input = { ...input, images: [], model: "", apiKey: "" };
  }
  const { imagesToCode } = require("./runtime/images-to-code");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const visionGenerate = async ({ prompt, images, model, systemPrompt }) => {
    const gate = assertCloudAllowed(readPrivacyMode(readSecureState()), String(input.providerKey || input.provider || ""));
    if (!gate.ok) throw new Error(gate.message);
    const apiKey = String(input.apiKey || "").trim();
    const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey || input.provider);
    const useModel = String(model || input.model || "").trim();
    if (!apiKey || !useModel || !baseUrl) {
      throw new Error("Falta modelo/API key para vision.");
    }
    const content = [
      { type: "text", text: prompt },
      ...(images || []).map((img) => ({
        type: "image_url",
        image_url: { url: img.dataUrl || img.url },
      })),
    ];
    const messages = [
      { role: "system", content: systemPrompt || "Eres un generador de UI. Solo JSON de archivos." },
      { role: "user", content },
    ];
    const providerResult = await callProvider({
      baseUrl,
      apiKey,
      model: useModel,
      providerKey: input.providerKey || input.provider || "",
      messages,
      timeoutMs: 120_000,
      maxAttempts: 1,
      enableTools: false,
    });
    return String(providerResult?.text || "");
  };
  return imagesToCode(root, input, {
    visionGenerate,
    model: input.model,
  });
});

  ipcMain.handle("project:clone-web-page", async (_event, input = {}) => {
  const privacy = readPrivacyMode(readSecureState());
  const cloudGate = assertCloudAllowed(privacy, String(input.providerKey || input.provider || ""));
  const { cloneWebPage } = require("./runtime/clone-web-page");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  const visionGenerate = async ({ prompt, images, model, systemPrompt }) => {
    const gate = assertCloudAllowed(readPrivacyMode(readSecureState()), String(input.providerKey || input.provider || ""));
    if (!gate.ok) throw new Error(gate.message);
    const apiKey = String(input.apiKey || "").trim();
    const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKey || input.provider);
    const useModel = String(model || input.model || "").trim();
    if (!apiKey || !useModel || !baseUrl) {
      throw new Error("Falta modelo/API key para vision.");
    }
    const content = [
      { type: "text", text: prompt },
      ...(images || []).map((img) => ({
        type: "image_url",
        image_url: { url: img.dataUrl || img.url },
      })),
    ];
    const messages = [
      { role: "system", content: systemPrompt || "Eres un generador de UI React/Tailwind. Solo JSON de archivos." },
      { role: "user", content },
    ];
    const providerResult = await callProvider({
      baseUrl,
      apiKey,
      model: useModel,
      providerKey: input.providerKey || input.provider || "",
      messages,
      timeoutMs: 120_000,
      maxAttempts: 1,
      enableTools: false,
    });
    return String(providerResult?.text || "");
  };
  return cloneWebPage(root, {
    ...input,
    skipVision: !cloudGate.ok ? true : input.skipVision,
  }, {
    visionGenerate: cloudGate.ok ? visionGenerate : null,
    model: input.model,
  });
});

ipcMain.handle("project:e2e-pipeline", async (_event, input = {}) => {
  const { runEditcoreE2ePipeline } = require("./runtime/e2e-pipeline-report");
  const root = String(input.projectRoot || "").trim()
    ? assertWritableProjectRoot(String(input.projectRoot || "").trim())
    : path.resolve(__dirname);
  return runEditcoreE2ePipeline(root, { writeReport: input.writeReport !== false });
});

ipcMain.handle("project:auto-docs", (_event, input = {}) => {
  const { generateAutoDocs } = require("./runtime/auto-docs");
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return generateAutoDocs(root, { write: input.write !== false });
});

ipcMain.handle("project:docker-playbook", (_event, input = {}) => {
  const { applyDockerPlaybook, listDockerPlaybooks } = require("./runtime/docker-playbooks");
  if (input.list === true) return { playbooks: listDockerPlaybooks() };
  const root = assertWritableProjectRoot(String(input.projectRoot || "").trim());
  return applyDockerPlaybook(root, input.playbook || input.id || "node", { write: input.write !== false });
});

ipcMain.handle("project:browser-inspect", async (event, input = {}) => {
  const root = assertProjectRoot(String(input.projectRoot || "").trim());
  const { inspectBrowser } = require("./runtime/browser-inspector");
  return inspectBrowser({
    BrowserWindow,
    startProjectPreview,
    rootPath: root,
    senderId: event.sender.id,
    appUserData: app.getPath("userData"),
    url: String(input.url || ""),
    viewport: String(input.viewport || "desktop"),
  });
});

function isUserStopInstruction(text = "") {
  const value = String(text || "").trim().toLowerCase().replace(/[.!?,;]+$/g, "");
  if (!value) return false;
  if (/^(?:por\s+favor\s+)?(?:alto|detente|det[eé]n(?:lo)?|detener|parar?|p[aá]ralo|stop|cancela(?:r|lo)?|aborta(?:r|lo)?|interrump(?:e|ir|alo)?|basta|escala|pausa(?:r)?|no\s+sigas|termina(?:r)?)$/i.test(value)) {
    return true;
  }
  if (/^(?:por\s+favor\s+)?(?:cancela|cancelar|det[eé]n|detener|parar?|p[aá]ralo|aborta|abortar|pausa|pausar|interrumpir|termina(?:r)?)\s+(?:el\s+an[aá]lisis|la\s+tarea|la\s+ejecuci[oó]n|esto|todo|toda(?:\s+acci[oó]n|s)?|el\s+proceso|la\s+b[uú]squeda|todas?\s+las?\s+acciones?)$/i.test(value)) {
    return true;
  }
  if (/^(?:ya\s+)?(?:no\s+sigas|deja\s+de\s+(?:analizar|buscar|ejecutar|trabajar|hacer\s+nada))$/i.test(value)) {
    return true;
  }
  if (/^(?:termina|cancel[ae]|det[eé]n|para|aborta)\s+(?:toda|todo|todas)\b/i.test(value)) {
    return true;
  }
  return false;
}

ipcMain.handle("agent:steer", async (event, input = {}) => {
  const instruction = String(input.instruction || "").trim();
  const runId = String(input.runId || "").trim();
  if (!instruction) return { accepted: false };

  if (isUserStopInstruction(instruction)) {
    const reason = "Detenido por el usuario.";
    if (runId) {
      const run = agentRunForEvent(event, runId);
      if (run?.controller) {
        run.requestController?.abort(new Error(reason));
        run.controller.abort(new Error(reason));
        activeAgentRuns.delete(agentRunKey(event.sender.id, run.runId || runId));
        try { stopChatKernel(); } catch { /* ignore */ }
        return { accepted: true, cancelled: true };
      }
    }
    cancelRunsForSender(event.sender.id, reason);
    try { stopChatKernel(); } catch { /* ignore */ }
    return { accepted: true, cancelled: true };
  }

  // Kernel path: el orquestador singleton recibe la dirección de inmediato.
  let kernelResult = null;
  try {
    if (typeof steerChatKernel === "function" && (typeof isChatKernelRunning !== "function" || isChatKernelRunning())) {
      kernelResult = steerChatKernel(instruction);
    }
  } catch { /* ignore */ }

  const run = agentRunForEvent(event, runId);
  if (!run && !(kernelResult && kernelResult.accepted)) return { accepted: false };
  if (run) run.steering.push({ instruction, at: Date.now() });

  if (run?.adapterInput) {
    const steerPlan = resolveUnifiedAgentPlan({
      prompt: run.adapterInput.prompt,
      steeringInstruction: instruction,
      requestedAgent: true,
      projectOpen: true,
      allowWrite: run.adapterInput.allowWrite === true,
      permissionMode: run.adapterInput.permissionMode,
      planAuthorizedExecution: run.adapterInput.planAuthorized === true,
      authorizedContinuation: run.adapterInput.planAuthorized === true,
      hasAttachments: false,
    });
    applyRunProfile(run.adapterInput, steerPlan.runProfile);
    run.adapterInput.orchestratorPlan = steerPlan;
    run.adapterInput.prompt = instruction;
    run.adapterInput.runProfile = steerPlan.runProfile;
    run.adapterInput.promptOnlyMode = steerPlan.promptOnlyMode;
    run.adapterInput.analysisMode = steerPlan.analysisMode;
    run.adapterInput.allowFilesystem = steerPlan.runProfile?.allowFilesystem;
  }

  if (!event.sender.isDestroyed()) {
    publishAgentProgress(event.sender, {
      runId: run?.runId || runId,
      phase: "direction",
      stage: "running",
      text: instruction,
    });
  }

  let interrupted = Boolean(kernelResult?.interrupted);
  if (run?.requestController) {
    const steerError = Object.assign(new Error("Nueva instruccion del usuario."), { code: "AGENT_STEER" });
    run.requestController.abort(steerError);
    interrupted = true;
  }

  const pendingDirections = Math.max(
    Number(run?.steering?.length) || 0,
    Number(kernelResult?.pendingDirections) || 0,
  );
  return {
    accepted: true,
    pendingDirections,
    interrupted,
    kernel: Boolean(kernelResult?.accepted || run?.kernel),
  };
});


function readLocalKeysFile(filePath) {
  const out = {};
  if (!filePath || !fs.existsSync(filePath)) return out;
  try {
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i <= 0) continue;
      let value = trimmed.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      out[trimmed.slice(0, i).trim()] = value;
    }
  } catch {}
  return out;
}

function gatewayToolsDir() {
  const candidates = [
    path.join("D:\\PROGRAMAS IA\\GAFCORE GATEWAY", "tools"),
    path.resolve(__dirname, "..", "..", "..", "GAFCORE GATEWAY", "tools"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || "";
}

function ensureDirectUpstreamProfiles() {
  try {
    scrubGatewayFromSecureState();
    const secure = readSecureState();
    const toolsDir = gatewayToolsDir();
    const rawProviders = Array.isArray(secure["editcore-custom-providers"]) ? secure["editcore-custom-providers"] : [];
    const rawProfiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    const cleanedProviders = rawProviders.filter((provider) => !isGatewayResidueProvider(provider));
    let profiles = rawProfiles.filter((profile) => !isGatewayResidueProfile(profile));
    let changed = cleanedProviders.length !== rawProviders.length || profiles.length !== rawProfiles.length;
    if (changed) {
      secure["editcore-custom-providers"] = cleanedProviders;
      secure["editcore-provider-profiles"] = profiles;
    }
    const providers = secure["editcore-providers"] && typeof secure["editcore-providers"] === "object"
      ? { ...secure["editcore-providers"] }
      : {};

    const upsertDirect = ({ providerKey, providerName, baseUrl, model, apiKey }) => {
      const key = String(apiKey || "").trim();
      if (!key.startsWith("sk-")) return;
      const previousProvider = providers[providerKey] || {};
      if (previousProvider.apiKey !== key || previousProvider.baseUrl !== baseUrl) {
        providers[providerKey] = { ...previousProvider, baseUrl, apiKey: key, label: providerName };
        changed = true;
      }
      const profileId = `${providerKey}:${model}`;
      const index = profiles.findIndex((item) => item.id === profileId || (item.providerKey === providerKey && item.model === model));
      const next = {
        id: profileId,
        providerKey,
        providerName,
        baseUrl,
        apiKey: key,
        model,
        status: "active",
        catalogConfirmed: true,
        chatVerified: true,
        checkedAt: Date.now(),
        error: "",
      };
      if (index >= 0) {
        const merged = { ...profiles[index], ...next };
        if (JSON.stringify(profiles[index]) !== JSON.stringify(merged)) {
          profiles[index] = merged;
          changed = true;
        }
      } else {
        profiles.push(next);
        changed = true;
      }
      const filtered = profiles.filter((p, i) => i === index || !(p.providerKey === providerKey && p.model === model && p.id !== profileId));
      if (filtered.length !== profiles.length) {
        profiles = filtered;
        changed = true;
      }
    };

    if (toolsDir) {
      const apicreditsKeys = readLocalKeysFile(path.join(toolsDir, ".apicredits-keys.local"));
      const meaiKeys = readLocalKeysFile(path.join(toolsDir, ".meai-keys.local"));
      const claudeApicredits = String(apicreditsKeys.claude || apicreditsKeys.claude_default || apicreditsKeys.apicredits || "").trim();
      if (claudeApicredits.startsWith("sk-")) {
        for (const model of ["claude-fable-5", "claude-haiku-4-5"]) {
          upsertDirect({
            providerKey: "apicredits",
            providerName: "APICredits",
            baseUrl: "https://api.apicredits.site/v1",
            model,
            apiKey: claudeApicredits,
          });
        }
      }
      for (const model of MEAI_GATEWAY_MODELS) {
        const apiKey = String(meaiKeys[model] || meaiKeys.default || meaiKeys.meai || "").trim();
        if (!apiKey.startsWith("sk-")) continue;
        upsertDirect({
          providerKey: "meai",
          providerName: "ME AI Cloud",
          baseUrl: "https://api.meai.cloud/v1",
          model,
          apiKey,
        });
      }
    }

    if (!changed) return false;
    secure["editcore-providers"] = providers;
    secure["editcore-provider-profiles"] = profiles;
    secure["editcore-custom-providers"] = cleanedProviders;
    writeSecureState(secure);
    return true;
  } catch (error) {
    console.error("No se pudieron crear perfiles directos upstream:", error);
    return false;
  }
}

function ensureExpandedMeaiGatewayModels() {
  // Ya no se amplía catálogo vía gateway; solo se limpia residuo.
  try {
    return scrubGatewayFromSecureState();
  } catch (error) {
    console.error("No se pudo limpiar residuo de gateway:", error);
    return false;
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }
  logStartup("startup:ready");
  configureElectronSecurity();
  // Paths de verificacion/aceptacion (headless): siguen necesitando migracion previa.
  const importReportPath = connectionImportReportPath();
  const reportPath = verificationReportPath();
  const agentAcceptancePath = agentAcceptanceReportPath();
  const needsHeadlessPrep = Boolean(importReportPath || reportPath || agentAcceptancePath || requestedUserData);
  if (needsHeadlessPrep) {
    if (!requestedUserData) {
      try {
        migrateLegacyUserData();
      } catch (error) {
        logStartup("La migracion de datos no pudo completarse.", error);
      }
    }
    logStartup("startup:migration-complete");
    try {
      if (ensureDirectUpstreamProfiles()) logStartup("startup:direct-upstream-profiles");
    } catch (error) {
      logStartup("startup:direct-upstream-profiles-failed", error);
    }
    try {
      if (ensureExpandedMeaiGatewayModels()) logStartup("startup:meai-models-expanded");
    } catch (error) {
      logStartup("startup:meai-models-expand-failed", error);
    }
    initializeTaskRuntime();
    try {
      taskRecovery.recoverOnStartup();
    } catch (error) {
      logStartup("startup:task-recovery-failed", error);
    }
  }
  if (importReportPath) {
    try {
      const report = await importLocalConnections();
      fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
      fs.writeFileSync(importReportPath, JSON.stringify(report, null, 2), "utf8");
      app.exit(report.validation.some((item) => item.service === "github" && item.ok)
        && report.validation.some((item) => item.service === "vercel" && item.ok)
        && report.validation.some((item) => item.service === "selfsupabase" && item.ok) ? 0 : 2);
    } catch (error) {
      fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
      fs.writeFileSync(importReportPath, JSON.stringify({ fatal: String(error?.message || error).slice(0, 300) }, null, 2), "utf8");
      app.exit(3);
    }
    return;
  }
  if (reportPath) {
    try {
      const report = await createVerificationReport();
      if (shouldRepairFailingProfiles()) report.deactivatedProfiles = deactivateFailingProfiles(report.models);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
      app.exit(report.summary.fullyOperational ? 0 : 2);
    } catch (error) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), fatal: String(error?.message || error).slice(0, 300) }, null, 2), "utf8");
      app.exit(3);
    }
    return;
  }
  if (agentAcceptancePath) {
    try {
      const report = await createRealAgentAcceptanceReport();
      fs.mkdirSync(path.dirname(agentAcceptancePath), { recursive: true });
      fs.writeFileSync(agentAcceptancePath, JSON.stringify(report, null, 2), "utf8");
      app.exit(report.accepted ? 0 : 2);
    } catch (error) {
      fs.mkdirSync(path.dirname(agentAcceptancePath), { recursive: true });
      fs.writeFileSync(agentAcceptancePath, JSON.stringify({ generatedAt: new Date().toISOString(), accepted: false, fatal: String(error?.message || error).slice(0, 500) }, null, 2), "utf8");
      app.exit(3);
    }
    return;
  }
  Menu.setApplicationMenu(null);
  // UI primero: migraciones/tareas/Cerebro no deben bloquear la ventana.
  createWindow({ windowId: "main" });
  logStartup("startup:window-created");

  // Accesos directos Escritorio/Inicio con logo oficial (en segundo plano diferido).
  setTimeout(() => {
    try {
      const { ensureEditCoreShortcuts } = require("./scripts/ensure-editcore-shortcuts");
      const result = ensureEditCoreShortcuts({ rebuild: !fs.existsSync(path.join(__dirname, "EDITCOREAI.exe")) });
      logStartup(`startup:shortcuts ok=${Boolean(result?.ok)} count=${result?.shortcuts?.length || 0}`);
    } catch (error) {
      logStartup("startup:shortcuts-failed", error);
    }
  }, 5000);

  setImmediate(() => {
    try {
      if (!requestedUserData) migrateLegacyUserData();
      logStartup("startup:migration-complete");
    } catch (error) {
      logStartup("La migracion de datos no pudo completarse.", error);
    }
    // Legacy vault import usa spawnSync de otro Electron — NO bloquear el arranque.
    // Se difiere para que welcome + botones respondan al instante.
    setTimeout(() => {
      try {
        const conn = readSecureState()["editcore-connections"] || {};
        if (connectionsNeedLegacyImport(conn)) {
          const legacy = importLegacyConnectionsIntoCurrentVault({ force: true });
          logStartup(`startup:legacy-connections ok=${Boolean(legacy?.ok)} imported=${Boolean(legacy?.imported)}`);
        }
      } catch (error) {
        logStartup("startup:legacy-connections-failed", error);
      }
    }, 8000);
    try {
      if (ensureDirectUpstreamProfiles()) logStartup("startup:direct-upstream-profiles");
    } catch (error) {
      logStartup("startup:direct-upstream-profiles-failed", error);
    }
    try {
      if (ensureExpandedMeaiGatewayModels()) logStartup("startup:meai-models-expanded");
    } catch (error) {
      logStartup("startup:meai-models-expand-failed", error);
    }
    try {
      initializeTaskRuntime();
      const taskRecoveryReport = taskRecovery.recoverOnStartup() || { tasks: [], recoveredLocks: [], recoveryTimeMs: 0 };
      logStartup(`startup:task-recovery tasks=${taskRecoveryReport.tasks.length} locks=${taskRecoveryReport.recoveredLocks.length} ms=${taskRecoveryReport.recoveryTimeMs}`);
    } catch (error) {
      logStartup("startup:task-recovery-failed", error);
    }

    try {
      logStartup("startup:brain-initializing");
      brainService = new EditCoreBrainService({
        catalogPath: path.join(__dirname, "catalog.json"),
        userDataPath: app.getPath("userData"),
        legacyPaths: [
          path.join(app.getPath("appData"), "EditCore Standalone", "brain", "global-memory.json"),
          path.join(app.getPath("userData"), "editcore-brain", "global-memory.json"),
        ],
        legacyTextPaths: [
          path.join(__dirname, "brain-seed", "memory.md"),
          path.join(__dirname, "brain-seed", "architecture-memory.json"),
        ],
        sharedSkillPaths: [
          path.join(__dirname, "brain-seed", "skills"),
        ],
      });
      inspectorService = new InspectorCoreService({
        brainService,
        storageRoot: path.join(app.getPath("userData"), "inspector-core"),
      });
      maintenanceScheduler = createMaintenanceScheduler({
        readSecureState,
        writeSecureState,
        readConnections,
        getBrowserWindows: () => BrowserWindow.getAllWindows(),
      });
      maintenanceScheduler.start();
      logStartup("startup:brain-ready");
    } catch (error) {
      logStartup("startup:brain-failed", error);
    }

    const jarvis = optionalJarvisLauncher();
    if (jarvis) {
      try {
        const secureState = readSecureState();
        const connections = secureState["editcore-connections"] || {};
        jarvis.startJarvis(app.getPath("userData"), connections);
      } catch (err) {
        logStartup("Jarvis sidecar opcional no iniciado", err);
      }
    }
  });
});
app.on("window-all-closed", () => {
  try {
    maintenanceScheduler?.stop?.();
  } catch {}
  try {
    optionalJarvisLauncher()?.stopJarvis?.();
  } catch (err) {
    console.error("Error stopping Jarvis sidecar", err);
  }
  for (const runtime of previewProcesses.values()) stopPreviewRuntime(runtime);
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send("session:please-flush");
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const { killAllSessions } = require("./runtime/pty-session");
    killAllSessions();
  } catch { /* ignore */ }
  try {
    optionalJarvisLauncher()?.stopJarvis?.();
  } catch (err) {}
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});

// ── Brain IPC handlers ────────────────────────────────────────────────────────
ipcMain.handle("brain:snapshot",        (_e, root)              => brain().snapshot(root));
ipcMain.handle("brain:index",           (_e, root, options)     => brain().indexProject(root, options || {}));
ipcMain.handle("brain:search",          (_e, root, query, lim)  => brain().searchMemory(root, query, lim));
ipcMain.handle("brain:knowledge-search",(_e, root, query, lim)  => brain().searchKnowledge(root, query, lim));
ipcMain.handle("brain:agent-search",    (_e, root, query, options) => brain().searchForAgent(String(root || ""), String(query || ""), options || {}));
ipcMain.handle("brain:agent-inventory", (_e, root, query, lim) => brain().agentInventory(String(root || ""), String(query || ""), lim));
ipcMain.handle("bots:list", () => getBotRegistry().list());
ipcMain.handle("bots:status", () => getBotRegistry().directorStatus());
ipcMain.handle("bots:run", async (_e, id, context = {}) => getBotRegistry().run(id, context));
ipcMain.handle("brain:read-skill",      (_e, root, name) => brain().readSkillForAgent(String(root || ""), String(name || "")));
ipcMain.handle("brain:related",         (_e, root, nodeId, lim) => brain().relatedKnowledge(root, nodeId, lim));
ipcMain.handle("brain:memory-stats",    (_e, root)              => brain().memoryStats(root));
ipcMain.handle("brain:consolidate",     (_e, root)              => brain().consolidateMemory(root));
ipcMain.handle("brain:catalog",         (_e, query, lim)        => brain().searchCatalog(query, lim));
ipcMain.handle("brain:remember",        (_e, root, input)       => brain().remember(root, input));
ipcMain.handle("brain:forget",          (_e, root, id)          => brain().forget(root, id));
ipcMain.handle("brain:install",         (_e, root, itemId)      => brain().installCatalogItem(root, itemId, true));
ipcMain.handle("brain:audit", async (_e, root, repair) => {
  if (repair === true) {
    try {
      const { healAndPurgeBrainSkills } = require("./runtime/skill-registry");
      const healed = await healAndPurgeBrainSkills({
        userDataPath: app.getPath("userData"),
        catalogPath: path.join(__dirname, "brain-seed", "catalog.json"),
        sharedSkillPaths: [path.join(__dirname, "brain-seed", "skills")],
      });
      const audit = await brain().auditTools(root, { repair: false });
      return { ...audit, healReport: healed };
    } catch (error) {
      return brain().auditTools(root, { repair: true });
    }
  }
  return brain().auditTools(root, { repair: false });
});
ipcMain.handle("brain:install-repo",    (_e, root, url)         => brain().installRepo(root, url, true));

function inspectorTargetRoot(target, requestedRoot = "") {
  if (target === "project") {
    let root = assertProjectRoot(String(requestedRoot || "").trim());
    fs.accessSync(root, fs.constants.R_OK);

    // Reparar dentro de un .asar falla (ruta solo lectura). Si el usuario apunta
    // a resources/app.asar, redirigimos a una carpeta extraída si existe.
    // Esto hace que inspector:repair-safe pueda aplicar correcciones reales.
    const rootLower = String(root).toLowerCase();
    if (rootLower.endsWith("app.asar")) {
      const extractedPreferred = String(root).replace(/app\.asar$/i, "app-extracted");
      if (fs.existsSync(extractedPreferred)) return extractedPreferred;

      // Fallback: intenta el path sin el sufijo .asar (por si existe carpeta `main`).
      const withoutAsar = String(root).replace(/\.asar$/i, "");
      if (fs.existsSync(withoutAsar)) return withoutAsar;
    }

    return root;
  }
  return inspectorRuntimeRoot();
}

async function attachInspectorRuntime(evaluation) {
  const runtime = await inspectorRuntimeHealth();
  evaluation.runtime = runtime;
  evaluation.openAlertCount += runtime.issues.length;
  if (!runtime.issues.length) return evaluation;
  if (runtime.issues.some((issue) => issue.severity === "high")) {
    evaluation.status = "critical";
    evaluation.score = Math.min(Number(evaluation.score || 100), 25);
  } else if (evaluation.status === "ok") {
    evaluation.status = "attention";
    evaluation.score = Math.min(Number(evaluation.score || 100), 70);
  }
  evaluation.evidence.push(...runtime.issues.map((issue) => ({
    status: issue.severity === "high" ? "fail" : "warn",
    label: issue.title,
    detail: issue.detail,
    source: issue.file || "runtime de EditCore",
  })));
  const runtimePrompt = runtime.issues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.title}: ${issue.detail}`).join("\n");
  evaluation.handoffPrompt = [evaluation.handoffPrompt, `Corrige estos problemas internos adicionales de EditCore:\n${runtimePrompt}`].filter(Boolean).join("\n\n");
  return evaluation;
}

// Inspector: diagnóstico + autorreparación local (kernel, sin Gateway).
function beginInspectorRun(runId, event) {
  const id = String(runId || crypto.randomUUID());
  const controller = new AbortController();
  activeInspectorRuns.set(id, { controller, senderId: event.sender.id, startedAt: Date.now() });
  return { runId: id, controller };
}

function endInspectorRun(runId) {
  const id = String(runId || "");
  if (id) activeInspectorRuns.delete(id);
}

function cancelInspectorRun(runId = "", senderId = null) {
  let cancelled = false;
  if (runId && activeInspectorRuns.has(runId)) {
    const entry = activeInspectorRuns.get(runId);
    entry.controller.abort(new Error("Inspector cancelado por el usuario."));
    activeInspectorRuns.delete(runId);
    cancelled = true;
  }
  if (!cancelled && senderId != null) {
    for (const [id, entry] of [...activeInspectorRuns.entries()]) {
      if (entry.senderId !== senderId) continue;
      entry.controller.abort(new Error("Inspector cancelado por el usuario."));
      activeInspectorRuns.delete(id);
      cancelled = true;
    }
  }
  return cancelled;
}

ipcMain.handle("inspector:install", async () => inspector().install(inspectorRuntimeRoot()));
ipcMain.handle("inspector:cancel", (event, input = {}) => {
  const runId = String(input?.runId || "").trim();
  const cancelled = cancelInspectorRun(runId, event.sender.id);
  try { cancelRunsForSender(event.sender.id, "Inspector cancelado por el usuario."); } catch { /* ignore */ }
  return { ok: true, cancelled };
});
ipcMain.handle("inspector:local-heal", async (event, target, requestedRoot, runId = "") => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const send = (progress) => {
    try { event.sender.send("inspector:progress", { ...progress, runId }); } catch { /* ignore */ }
  };
  return autoHealNextProject(root, {
    rebuild: true,
    onProgress: (p) => send(p),
  });
});
ipcMain.handle("inspector:kernel-status", async (_event, target, requestedRoot) => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const { detectNextCacheCorruption } = require("./runtime/inspector-local-heal");
  const { listSnapshots } = require("./editcore-chat-kernel/snapshot");
  const { promptBlock, listSolutions } = require("./editcore-chat-kernel/global-memory");
  const detection = detectNextCacheCorruption(root);
  return {
    ok: true,
    mode: "local-autonomous",
    message: "Inspector Nativo Autónomo Activo (Modo Local)",
    projectRoot: root,
    next: detection,
    snapshots: listSnapshots(root, 5),
    globalMemory: listSolutions(8),
    learnedPrompt: promptBlock("next build routes-manifest ENOENT", 5),
    modules: ["process-runner", "vision-inspector", "global-memory", "snapshot"],
  };
});
ipcMain.handle("inspector:scan", async (event, target, requestedRoot, options) => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const runId = String(options?.runId || "");
  const send = (progress) => {
    try { if (runId) event.sender.send("inspector:progress", { ...progress, runId }); } catch { /* ignore */ }
  };
  let heal = null;
  if (target === "project" || options?.autoHeal === true) {
    heal = await autoHealNextProject(root, {
      rebuild: options?.rebuild !== false,
      onProgress: send,
    });
  }
  const snapshot = await inspector().scan(root, options || {});
  const result = target === "project" ? snapshot : { ...snapshot, runtime: await inspectorRuntimeHealth() };
  return { ...result, localHeal: heal, mode: "local-autonomous" };
});
ipcMain.handle("inspector:evaluate", async (event, _root, area, runId = "") => {
  const root = inspectorRuntimeRoot();
  const job = beginInspectorRun(runId, event);
  try {
    const evaluation = await inspector().evaluate(root, area, (progress) => {
      event.sender.send("inspector:progress", { ...progress, runId: job.runId });
    }, { signal: job.controller.signal });
    return attachInspectorRuntime(evaluation);
  } finally {
    endInspectorRun(job.runId);
  }
});
ipcMain.handle("inspector:diagnose", async (event, target, requestedRoot, runId = "") => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const job = beginInspectorRun(runId, event);
  try {
    let heal = null;
    if (target === "project") {
      heal = await autoHealNextProject(root, {
        rebuild: true,
        onProgress: (progress) => {
          try { event.sender.send("inspector:progress", { ...progress, runId: job.runId }); } catch { /* ignore */ }
        },
      });
      if (job.controller.signal.aborted) {
        throw job.controller.signal.reason || new Error("Inspector cancelado por el usuario.");
      }
    }
    const evaluation = await inspector().diagnose(root, (progress) => {
      event.sender.send("inspector:progress", { ...progress, runId: job.runId });
    }, { signal: job.controller.signal });
    const out = target === "project" ? evaluation : attachInspectorRuntime(evaluation);
    return { ...out, localHeal: heal, mode: "local-autonomous" };
  } finally {
    endInspectorRun(job.runId);
  }
});
ipcMain.handle("inspector:repair-safe", async (event, target, requestedRoot, runId = "") => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const job = beginInspectorRun(runId, event);
  try {
    const evaluation = await inspector().repair(root, (progress) => {
      event.sender.send("inspector:progress", { ...progress, runId: job.runId });
    }, { signal: job.controller.signal });
    return target === "project" ? evaluation : attachInspectorRuntime(evaluation);
  } finally {
    endInspectorRun(job.runId);
  }
});
ipcMain.handle("inspector:snapshot", async (_event, target, requestedRoot) => {
  const root = inspectorTargetRoot(target, requestedRoot);
  const snapshot = await inspector().snapshot(root);
  return target === "project" ? snapshot : { ...snapshot, runtime: await inspectorRuntimeHealth() };
});
ipcMain.handle("inspector:vision", async (_event, target, requestedRoot, url) => {
  const root = inspectorTargetRoot(target, requestedRoot);
  return localVisionProbe(root, url || "");
});
ipcMain.handle("inspector:reports", async (_event, target, requestedRoot) => inspector().reports(inspectorTargetRoot(target, requestedRoot)));
ipcMain.handle("inspector:add-report", async (_event, target, requestedRoot, report) => inspector().addReport(inspectorTargetRoot(target, requestedRoot), report || {}));
ipcMain.handle("inspector:checkpoint", async (_event, target, requestedRoot) => inspector().createCheckpoint(inspectorTargetRoot(target, requestedRoot)));
ipcMain.handle("inspector:restore", async (_event, target, requestedRoot, checkpointId, changedFiles) => inspector().restoreCheckpoint(inspectorTargetRoot(target, requestedRoot), checkpointId, changedFiles || []));
ipcMain.handle("inspector:discard-checkpoint", async (_event, target, requestedRoot, checkpointId) => inspector().discardCheckpoint(inspectorTargetRoot(target, requestedRoot), checkpointId));
ipcMain.handle("inspector:list-checkpoints", async (_event, target, requestedRoot) => inspector().listCheckpoints(inspectorTargetRoot(target, requestedRoot)));
ipcMain.handle("inspector:clean-checkpoints", async (_event, target, requestedRoot, keep) => inspector().cleanCheckpoints(inspectorTargetRoot(target, requestedRoot), keep));
ipcMain.handle("inspector:validate-repair", async (_event, target, requestedRoot, checkpointId) => inspector().validateRepair(inspectorTargetRoot(target, requestedRoot), checkpointId));

// Git manager handlers
ipcMain.handle("git:getStatus", async (_event, cwd) => {
  try {
    const { getStatus } = require("./runtime/git-manager");
    return getStatus(cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:stageFiles", async (_event, files, cwd) => {
  try {
    const { stageFiles } = require("./runtime/git-manager");
    return stageFiles(files, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:unstageFiles", async (_event, files, cwd) => {
  try {
    const { unstageFiles } = require("./runtime/git-manager");
    return unstageFiles(files, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:commit", async (_event, message, cwd) => {
  try {
    const { commit } = require("./runtime/git-manager");
    return commit(message, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:getBranches", async (_event, cwd) => {
  try {
    const { getBranches } = require("./runtime/git-manager");
    return getBranches(cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:createBranch", async (_event, name, cwd) => {
  try {
    const { createBranch } = require("./runtime/git-manager");
    return createBranch(name, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:checkoutBranch", async (_event, name, cwd) => {
  try {
    const { checkoutBranch } = require("./runtime/git-manager");
    return checkoutBranch(name, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:getDiff", async (_event, files, cwd) => {
  try {
    const { getDiff } = require("./runtime/git-manager");
    return getDiff(files, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:getCommitHistory", async (_event, limit, cwd) => {
  try {
    const { getCommitHistory } = require("./runtime/git-manager");
    return getCommitHistory(limit, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:push", async (_event, remote, branch, cwd) => {
  try {
    const { push } = require("./runtime/git-manager");
    return push(remote, branch, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:pull", async (_event, remote, branch, cwd) => {
  try {
    const { pull } = require("./runtime/git-manager");
    return pull(remote, branch, cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("git:detectLocalChanges", async (_event, cwd) => {
  try {
    const { detectLocalChanges } = require("./runtime/git-manager");
    return detectLocalChanges(cwd);
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

// Semantic Memory handlers
ipcMain.handle("memory:index-workspace", async (_event, workspace) => {
  try {
    const { indexWorkspace } = require("./runtime/rag-memory");
    return indexWorkspace(workspace);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("memory:query", async (_event, payload) => {
  try {
    const { querySemantic } = require("./runtime/rag-memory");
    const { query, topK, minScore } = typeof payload === "string" ? { query: payload } : (payload || {});
    return querySemantic(query, topK, minScore);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("memory:query-semantic", async (_event, query) => {
  try {
    const { querySemantic } = require("./runtime/rag-memory");
    return await querySemantic(query);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("memory:get-index-status", async () => {
  try {
    const { getIndexStatus } = require("./runtime/rag-memory");
    return getIndexStatus();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("memory:get-status", async () => {
  try {
    const { getIndexStatus } = require("./runtime/rag-memory");
    return getIndexStatus();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("memory:clear-cache", async () => {
  try {
    const { clearCache } = require("./runtime/rag-memory");
    return clearCache();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Prompt Cache handlers
ipcMain.handle("prompt:cache-get", async (_event, key) => {
  try {
    const { get } = require("./runtime/prompt-cache-manager");
    return get(key);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("prompt:cache-set", async (_event, key, value) => {
  try {
    const { set } = require("./runtime/prompt-cache-manager");
    return set(key, value);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("prompt:cache-stats", async () => {
  try {
    const { getStats } = require("./runtime/prompt-cache-manager");
    return getStats();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Evolution handlers
ipcMain.handle("evolution:get-state", async () => {
  try {
    const statePath = path.join(__dirname, "scripts", "auto-evolution", "evolution-state.json");
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    }
    return { ok: true, cycle: 13, state: "idle" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("evolution:run-cycle", async () => {
  return { ok: true, cycle: 13, status: "completed" };
});

ipcMain.handle("evolution:open-dashboard", async () => {
  try {
    const dashPath = path.join(__dirname, "ide", "auto-evolution-panel.html");
    if (fs.existsSync(dashPath) && mainWindow) {
      mainWindow.loadFile(dashPath);
      return { ok: true };
    }
    return { ok: false, error: "Dashboard file not found" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Database Manager handlers
ipcMain.handle("db:get-status", async () => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return new DbManager().getStatus();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("db:list-databases", async () => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return new DbManager().listLocalDatabases();
  } catch (error) {
    return [];
  }
});

ipcMain.handle("db:query", async (_event, database, sql) => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return await new DbManager().querySqlite(database, sql);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("db:get-schema", async (_event, database) => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return await new DbManager().getSchema(database);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("db:register-connection", async (_event, connection) => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return new DbManager().registerConnection(connection);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("db:remove-connection", async (_event, connectionId) => {
  try {
    const { DbManager } = require("./runtime/db-manager");
    return new DbManager().removeConnection(connectionId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// n8n Manager handlers
ipcMain.handle("n8n:generate", async (_event, payload) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    const manager = new N8nManager(payload?.options || {});
    return manager.generateProject(payload?.config || {});
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("n8n:start", async (_event, options) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    return await new N8nManager(options || {}).start();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("n8n:stop", async (_event, options) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    return await new N8nManager(options || {}).stop();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("n8n:status", async (_event, options) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    return await new N8nManager(options || {}).status();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("n8n:logs", async (_event, payload) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    return await new N8nManager(payload?.options || {}).logs(payload?.service, payload?.tail);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("n8n:verify", async (_event, options) => {
  try {
    const { N8nManager } = require("./runtime/n8n-manager");
    return await new N8nManager(options || {}).verify();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// MCP handlers
const activeMcpClients = new Map();
ipcMain.handle("mcp:connect", async (_event, config) => {
  try {
    const { McpClient } = require("./runtime/mcp-client");
    const client = new McpClient(config);
    await client.connect();
    const id = config.id || String(Date.now());
    activeMcpClients.set(id, client);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("mcp:list-tools", async (_event, id) => {
  try {
    const client = activeMcpClients.get(id);
    if (!client) throw new Error("MCP client no encontrado");
    return await client.listTools();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("mcp:call-tool", async (_event, payload) => {
  try {
    const client = activeMcpClients.get(payload?.id);
    if (!client) throw new Error("MCP client no encontrado");
    return await client.callTool(payload?.name, payload?.args);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("mcp:disconnect", async (_event, id) => {
  try {
    const client = activeMcpClients.get(id);
    if (client) {
      await client.disconnect();
      activeMcpClients.delete(id);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// AST Refactorer Bridge
try {
  const { AstIpcBridge } = require("./runtime/ast-ipc-bridge");
  new AstIpcBridge().register(ipcMain);
} catch {
  // ignore
}

// Telemetry handlers
let globalTelemetryMonitor = null;
ipcMain.handle("telemetry:get-metrics", async () => {
  try {
    const { TelemetryMonitor } = require("./runtime/telemetry-monitor");
    if (!globalTelemetryMonitor) {
      globalTelemetryMonitor = new TelemetryMonitor();
      globalTelemetryMonitor.start();
    }
    return globalTelemetryMonitor.getMetrics();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Debugger handlers
let globalDebuggerClient = null;
function getDebuggerClient() {
  if (!globalDebuggerClient) {
    const { DebuggerClient } = require("./runtime/debugger-client");
    globalDebuggerClient = new DebuggerClient();
  }
  return globalDebuggerClient;
}

const activeDebugSessions = new Map();
ipcMain.handle("debug:start-session", async (_event, options) => {
  try {
    const client = getDebuggerClient();
    const session = await client.startSession(options?.id || null, options || {});
    return { ok: true, id: session.id, session };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debug:stop-session", async (_event, id) => {
  try {
    const client = getDebuggerClient();
    const res = await client.stopSession(id);
    return res;
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:create-session", async (_event, options) => {
  try {
    const client = getDebuggerClient();
    const session = client.createSession(options?.id || null, options || {});
    return { ok: true, id: session.id, session: client.getSession(session.id) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:start-session", async (_event, options) => {
  try {
    const client = getDebuggerClient();
    const session = await client.startSession(options?.id || options?.sessionId || null, options || {});
    return { ok: true, id: session.id, session };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:stop-session", async (_event, id) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof id === "object" ? (id.sessionId || id.id) : id;
    return await client.stopSession(sid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:set-breakpoints", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const { sessionId, sourcePath, breakpoints } = payload || {};
    const res = await client.setBreakpoints(sessionId, sourcePath, breakpoints || []);
    return { ok: true, breakpoints: res };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:continue", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    return await client.continue(sid, tid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:step-over", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    return await client.stepOver(sid, tid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:step-into", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    return await client.stepInto(sid, tid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:step-out", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    return await client.stepOut(sid, tid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:pause", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    return await client.pause(sid, tid);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:get-call-stack", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const tid = typeof payload === "object" ? payload.threadId : 1;
    const frames = await client.getCallStack(sid, tid);
    return frames;
  } catch (error) {
    return [];
  }
});

ipcMain.handle("debugger:get-variables", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const sid = typeof payload === "object" ? payload.sessionId : payload;
    const ref = typeof payload === "object" ? (payload.variablesReference || 1) : 1;
    const vars = await client.getVariables(sid, ref);
    return vars;
  } catch (error) {
    return [];
  }
});

ipcMain.handle("debugger:evaluate", async (_event, payload) => {
  try {
    const client = getDebuggerClient();
    const { sessionId, expression, frameId, context } = payload || {};
    return await client.evaluate(sessionId, expression, frameId, context);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("debugger:list-sessions", async () => {
  try {
    const client = getDebuggerClient();
    return client.listSessions();
  } catch (error) {
    return [];
  }
});

// Deep Indexer handlers
ipcMain.handle("deepIndexer:index", async (_event, workspace) => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return await deepIndexer.indexWorkspace(workspace);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("deepIndexer:search-symbols", async (_event, query, limit) => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return deepIndexer.searchSymbols(query, limit);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("deepIndexer:find-references", async (_event, symbolName) => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return deepIndexer.findReferences(symbolName);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("deepIndexer:query", async (_event, prompt, topK) => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return deepIndexer.queryCodebase(prompt, topK);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("deepIndexer:get-graph", async () => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return deepIndexer.getDependencyGraph();
  } catch (error) {
    return {};
  }
});

ipcMain.handle("deepIndexer:get-status", async () => {
  try {
    const { deepIndexer } = require("./runtime/deep-indexer");
    return deepIndexer.getGraphStatus();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Multi-File Composer handlers
ipcMain.handle("multiComposer:create-plan", async (_event, options) => {
  try {
    const { multiFileComposer } = require("./runtime/multi-file-composer");
    return multiFileComposer.createPlan(options);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("multiComposer:preview", async (_event, planId) => {
  try {
    const { multiFileComposer } = require("./runtime/multi-file-composer");
    return multiFileComposer.previewChanges(planId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("multiComposer:apply", async (_event, planId) => {
  try {
    const { multiFileComposer } = require("./runtime/multi-file-composer");
    return await multiFileComposer.applyAtomicChanges(planId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("multiComposer:rollback", async (_event, planId) => {
  try {
    const { multiFileComposer } = require("./runtime/multi-file-composer");
    return await multiFileComposer.rollbackAtomicChanges(planId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("multiComposer:get-pending", async () => {
  try {
    const { multiFileComposer } = require("./runtime/multi-file-composer");
    return multiFileComposer.getPendingDiffs();
  } catch (error) {
    return [];
  }
});

// VSIX Loader handlers
ipcMain.handle("vsix:inspect", async (_event, vsixPath) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return await vsixLoader.inspectVsix(vsixPath);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("vsix:install", async (_event, vsixPath, targetDir) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return await vsixLoader.installVsix(vsixPath, targetDir);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("vsix:list", async (_event, targetDir) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return vsixLoader.listInstalledExtensions(targetDir);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("vsix:uninstall", async (_event, extensionId, targetDir) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return vsixLoader.uninstallExtension(extensionId, targetDir);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("vsix:get-themes", async (_event, extensionId, targetDir) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return vsixLoader.getContributedThemes(extensionId, targetDir);
  } catch (error) {
    return [];
  }
});

ipcMain.handle("vsix:get-grammars", async (_event, extensionId, targetDir) => {
  try {
    const { vsixLoader } = require("./runtime/vsix-loader");
    return vsixLoader.getContributedGrammars(extensionId, targetDir);
  } catch (error) {
    return [];
  }
});

// Terminal Healer handlers
ipcMain.handle("terminalHealer:analyze", async (_event, output, cwd) => {
  try {
    const { terminalHealer } = require("./runtime/terminal-healer");
    return terminalHealer.analyzeError(output, cwd);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("terminalHealer:create-plan", async (_event, analysis, cwd) => {
  try {
    const { terminalHealer } = require("./runtime/terminal-healer");
    return terminalHealer.createHealingPlan(analysis, cwd);
  } catch (error) {
    return null;
  }
});

ipcMain.handle("terminalHealer:auto-heal", async (_event, command, cwd) => {
  try {
    const { terminalHealer } = require("./runtime/terminal-healer");
    return await terminalHealer.executeAutoHeal(command, cwd);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Remote Env handlers
ipcMain.handle("remoteEnv:test-ssh", async (_event, config) => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return await remoteEnv.testSshConnection(config);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("remoteEnv:exec-command", async (_event, connectionId, command, options) => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return await remoteEnv.executeRemoteCommand(connectionId, command, options);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("remoteEnv:list-containers", async () => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return await remoteEnv.listDockerContainers();
  } catch (error) {
    return [];
  }
});

ipcMain.handle("remoteEnv:start-container", async (_event, options) => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return await remoteEnv.startDevContainer(options);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("remoteEnv:stop-container", async (_event, containerId) => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return await remoteEnv.stopDevContainer(containerId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("remoteEnv:get-status", async (_event, containerId) => {
  try {
    const { remoteEnv } = require("./runtime/remote-env");
    return remoteEnv.getContainerStatus(containerId);
  } catch (error) {
    return { status: "error", error: error.message };
  }
});





