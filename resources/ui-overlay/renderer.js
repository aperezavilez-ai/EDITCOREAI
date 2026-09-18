const $ = (id) => document.getElementById(id);
const _appParams = new URLSearchParams(location.search || (location.hash ? location.hash.replace(/^#\??/, "") : ""));
const WINDOW_ID = _appParams.get("windowId") || "main";
const ProjectAnalysis = window.EditCoreProjectAnalysis;
const AgentOrchestrator = window.EditCoreAgentOrchestrator;
const PromptJobModel = window.EditCorePromptJobModel;
const ProjectFilesUi = window.EditCoreProjectFilesUi;
const AgentPlanView = window.EditCoreAgentPlanView;
const AutoModel = window.EditCoreAutoModel;
const CONFIGURE_MODELS_SELECTION = "__configure_models__";
const PROJECTS_STORAGE_KEY = "editcore-projects";
const RECENT_PROJECT_ROOTS_KEY = "editcore-recent-project-roots";
const RECENT_PROJECTS_LIMIT = 4;
const ACTIVE_PROJECT_STORAGE_KEY = WINDOW_ID === "main" ? "editcore-active-project" : "editcore-active-project-" + WINDOW_ID;
const PREVIEW_MODE_STORAGE_KEY = WINDOW_ID === "main" ? "editcore-preview-mode" : "editcore-preview-mode-" + WINDOW_ID;
const DESKTOP_PREVIEW_WIDTH = 1440;
const INSPECTOR_CHAT_VERSION = 3;

const PROVIDERS = {
  openai:   { label: "OpenAI",    baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic:{ label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6" },
  gemini:   { label: "Gemini",    baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" },
  meai:     { label: "ME AI Cloud", baseUrl: "https://api.meai.cloud/v1", model: "claude-sonnet-4.6" },
  apicredits: { label: "APICredits", baseUrl: "https://api.apicredits.site/v1", model: "claude-sonnet-4-6" },
  claude:   { label: "Claude",    baseUrl: "https://api.apicredits.site/v1", model: "claude-sonnet-4-6" },
  gpt:      { label: "ChatGPT",   baseUrl: "https://api.apicredits.site/v1", model: "gpt-5.6-sol" },
  kimi:     { label: "Kimi",      baseUrl: "https://api.moonshot.cn/v1",   model: "moonshot-v1-8k" },
  deepseek: { label: "DeepSeek",  baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen:     { label: "Qwen",      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
};
const PRIMARY_PROVIDER_KEYS = ["meai", "apicredits"];

const PROVIDER_MODELS = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro"],
  meai: [],
  apicredits: [],
  claude: [
    "claude-fable-5", "claude-haiku-4-5", "claude-opus-4-7", "claude-opus-4-8",
    "claude-sonnet-4-6", "claude-sonnet-5",
  ],
  gpt: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
  kimi: [
    "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k",
    "kimi-k2-0711-preview",
  ],
  deepseek: [
    "deepseek-chat", "deepseek-coder", "deepseek-reasoner",
    "deepseek-r1-0528",
  ],
  qwen: [
    "qwen-plus", "qwen-turbo", "qwen-max", "qwen-long",
    "qwen2.5-72b-instruct", "qwen2.5-32b-instruct", "qwen3-235b-a22b",
  ],
};

// ME AI: set recomendado para EditCore (agente + fallbacks).
const MEAI_PROVIDER_MODELS = [
  "claude-sonnet-4.6",
  "claude-haiku-4-5",
  "claude-opus-4.8",
  "qwen3.6-plus",
  "glm-5",
  "deepseek-v4-pro",
  "kimi-k2.6",
];
// APICredits: live GET /v1/models por key (a6-claude/openai/gemini/grok/deepseek).
const APICREDITS_PROVIDER_MODELS = [
  "claude-fable-5", "claude-haiku-4-5", "claude-opus-4-7", "claude-opus-4-8",
  "claude-sonnet-4-6", "claude-sonnet-5",
  "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra",
  "gemini-2.5-flash",
  "grok-4.3", "grok-4.5",
  "deepseek-v4-pro",
];
PROVIDER_MODELS.meai = MEAI_PROVIDER_MODELS;
PROVIDER_MODELS.apicredits = APICREDITS_PROVIDER_MODELS;

const state = {
  mode: "claude",
  history: [],
  projects: [],
  activeProjectId: "",
  projectRoot: "",
  metrics: {
    confirmedUsedTokens: 0,
    confirmedInputTokens: 0,
    confirmedOutputTokens: 0,
    providerCacheReadTokens: 0,
    localSavedConfirmedTokens: 0,
    localSavedEstimatedTokens: 0,
    estimatedTokens: 0,
    localCacheHits: 0,
    externalCallsAvoided: 0,
    byModel: {},
  },
  allowWrite: false,
  permissionMode: "full",
  attachments: [],
  activeAgentId: "",
  inspectorSnapshot: null,
  inspectorProjectSnapshot: null,
  cacheStats: { responses: {}, tools: {}, harness: {} },
  modelSelectionAuto: false,
  lastAutoResolvedModel: "",
  autoUpstreamUsage: { meai: 0, apicredits: 0 },
  autoModelUsage: {},
  fileListRelativePath: "",
  lastUserPrompt: "",
  fileListHighlightNames: [],
  fileListWritingNames: [],
  touchedHighlightNames: [],
  touchedRelativePaths: [],
  fileListRenderToken: 0,
  fileListRefreshTimer: null,
  fileListHighlightClearTimer: null,
  lastListedRoot: "",
  brainSnapshot: null,
};
window.state = state;
const SECURE_STORAGE_KEYS = new Set([
  "editcore-chat-config",
  "editcore-connections",
  "editcore-providers",
  "editcore-provider-profiles",
  "editcore-custom-providers",
  "editcore-fallback-providers",
  "editcore-rtk",
  "editcore-agent-task-prompts",
]);
let secureState = {};
let cachedModelCapabilities = {};
let capabilitiesLoadedAt = 0;
let promptQueue = [];
const activePromptRequests = new Map();
const activePromptTasks = new Map();
const activePlanStreams = new Map();
const activeAgentThinkingRuns = new Map();
const pendingPromptFingerprints = new Set();
const pendingAgentApprovalCards = new Map();
/** Tras ALTO/CANCEL: ignorar progress que reencendería bolitas/Pensamiento. */
let agentUiHardStopUntil = 0;
let promptProcessorRunning = false;
const MAX_PARALLEL_AGENTS = 4;
const MIN_AGENT_CONTINUATION_TOKENS = 1000;
const inspectorClientErrors = [];
const previewRuntimeErrors = [];

/** Avisos internos de Electron/Vite en dev — no son errores de la app del usuario. */
function normalizePreviewConsoleMessage(message = "") {
  return String(message || "")
    .replace(/%c/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnorablePreviewConsoleMessage(message = "") {
  const text = normalizePreviewConsoleMessage(message).toLowerCase();
  if (!text) return true;
  return /electron security warning/.test(text)
    || /insecure content-security-policy/.test(text)
    || /content security policy.*unsafe-eval/.test(text)
    || /this renderer process has either no content security policy/.test(text)
    || /devtools failed to load source map/.test(text)
    || /download the react devtools/.test(text)
    // Ruido Chromium/Electron (no es error del proyecto web)
    || /gpu_ipc_service|gpu_channel_manager|shared context for virtualization/.test(text)
    || /contextresult::kfatalfailure/.test(text)
    || /failed to create shared context/.test(text)
    || /gl_surface|viz_main_impl|command_buffer/.test(text)
    || /passthrough is not supported|angle/.test(text)
    || /autofill\.cc|autofill_agent/.test(text)
    // CORS / red del preview local → API remota: no es fallo de EditCoreAI ni del panel
    || /cors policy/.test(text)
    || /access-control-allow-origin/.test(text)
    || /blocked by cors/.test(text)
    || /access to fetch at .+ failed/.test(text)
    || /from origin ['"]?https?:\/\/127\.0\.0\.1/.test(text)
    || /from origin ['"]?https?:\/\/localhost/.test(text)
    || (/supabase\.(gafcore|qatcore)\.com/.test(text) && /fetch|cors|failed|preflight/.test(text))
    || /net::err_failed/.test(text)
    || /net::err_connection_refused/.test(text)
    || /net::err_name_not_resolved/.test(text)
    || /net::err_aborted/.test(text)
    || /failed to fetch/.test(text)
    || /load failed/.test(text)
    || /networkerror when attempting to fetch/.test(text)
    || /the fetch has been aborted/.test(text)
    // Ruido del propio EDITCOREAI (desktop), no del preview web del usuario
    || /cannot find module ['"]?main\.js['"]?/.test(text)
    || /cannot find module ['"]?preload\.js['"]?/.test(text)
    || /\bmain\.js\s+error:/.test(text)
    || /\bpreload\.js\s+error:/.test(text)
    || /importreportpath/.test(text)
    || /connectionimportreportpath/.test(text)
    || /fs\.writefilesync\(importreportpath/.test(text);
}

function pushPreviewRuntimeError(message = "", level = "error") {
  const text = normalizePreviewConsoleMessage(message);
  if (!text || isIgnorablePreviewConsoleMessage(text)) return;
  // Sin URL de preview activa: no mostrar panel de errores del navegador.
  if (!previewExpectedUrl && !$("previewUrl")?.value?.trim()) return;
  previewRuntimeErrors.push({ level, message: text.slice(0, 240), at: Date.now() });
  if (previewRuntimeErrors.length > 40) previewRuntimeErrors.splice(0, previewRuntimeErrors.length - 40);
  renderPreviewRuntimeErrors();
}

function renderPreviewRuntimeErrors() {
  const el = $("previewRuntimeErrors");
  if (!el) return;
  const recent = previewRuntimeErrors.slice(-5);
  if (!recent.length) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.replaceChildren();
  const title = document.createElement("div");
  title.className = "preview-runtime-errors-title";
  title.textContent = `Errores del preview (${previewRuntimeErrors.length})`;
  el.appendChild(title);
  for (const row of recent) {
    const line = document.createElement("div");
    line.className = "preview-runtime-error-line";
    line.textContent = row.message;
    el.appendChild(line);
  }
}

function updateAgentPlanPanel({ steps = null, planText = "", checkpoints = null } = {}) {
  const panel = $("agentPlanPanel");
  if (!panel) return;
  // UX Cursor: el progreso se escribe en el chat/thinking, no en un recuadro Plan.
  panel.classList.add("hidden");
  panel.setAttribute("hidden", "true");
  return;
}

$("agentPlanToggle")?.addEventListener("click", () => {
  const list = $("agentPlanTodos");
  const cps = $("agentPlanCheckpoints");
  const hidden = list?.classList.toggle("hidden");
  cps?.classList.toggle("hidden", hidden);
  const btn = $("agentPlanToggle");
  if (btn) btn.textContent = hidden ? "+" : "−";
});

function clearPreviewRuntimeErrors() {
  previewRuntimeErrors.length = 0;
  renderPreviewRuntimeErrors();
}

function reportInspectorTelemetry() {
  const request = window.editcoreInspector?.telemetry?.({
    errors: inspectorClientErrors.slice(-20),
    queueLength: promptQueue.length,
    activeRequests: activePromptRequests.size,
    metrics: {
      input: state.metrics.confirmedInputTokens,
      output: state.metrics.confirmedOutputTokens,
      cacheRead: state.metrics.providerCacheReadTokens,
      calls: state.metrics.externalCallsAvoided,
    },
  });
  request?.catch?.(() => undefined);
}

window.addEventListener("error", (event) => {
  inspectorClientErrors.push(`error: ${event.message || "error de interfaz"}`);
  reportInspectorTelemetry();
});
window.addEventListener("unhandledrejection", (event) => {
  inspectorClientErrors.push(`unhandledrejection: ${event.reason?.message || event.reason || "promesa rechazada"}`);
  reportInspectorTelemetry();
});
setInterval(reportInspectorTelemetry, 15_000);
let responseTimer = null;
let projectTemplates = [];
let activeProjectCreateRunId = "";
let projectCreateRunning = false;
const agentModelCapabilities = new Map();

const CP1252_BYTES = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F],
]);

function repairMojibakeText(value) {
  const text = String(value || "");
  if (!/[ÃÂâð]|\uFFFD/.test(text)) return text;
  const decodeCandidate = (candidate) => {
    const bytes = [];
    for (const char of candidate) {
      const code = char.codePointAt(0);
      if (code <= 0xFF) bytes.push(code);
      else if (CP1252_BYTES.has(code)) bytes.push(CP1252_BYTES.get(code));
      else return candidate;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
    if (decoded.includes("\uFFFD") || decoded === candidate) return candidate;
    return /[ÃÂâð]/.test(decoded) ? decodeCandidate(decoded) : decoded;
  };
  const decoded = decodeCandidate(text);
  if (decoded !== text) return decoded;
  const repairedRuns = text.replace(/[\u0000-\u00FF\u0192\u02C6\u02DC\u0160\u0161\u0152\u0153\u0178\u017D\u017E\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]+/g, (candidate) => {
    return /[ÃÂâð]/.test(candidate) ? decodeCandidate(candidate) : candidate;
  });
  return repairedRuns.replace(/\u00F0\u0178(?=[\s"'.,;:!?)]|$)/g, "emoji");
}

/** Quita XML de tools que el modelo a veces pega en el chat (no debe verse). */
function stripAgentToolXml(value, { trim = true } = {}) {
  const names = [
    "list_directory", "list_dir", "list_files", "read_file", "write_file",
    "replace_in_file", "search_files", "execute_command", "run_command",
    "run_shell", "bash", "shell", "audit_env", "supabase_migrate",
    "scaffold_project", "capture_preview", "str_replace", "search_replace",
  ].join("|");
  const re = new RegExp(`<(${names})>[\\s\\S]*?<\\/\\1>`, "gi");
  let out = String(value || "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/function>/gi, "")
    .replace(/<parameter\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/parameter>/gi, "")
    .replace(re, "");
  // Bloques incompletos / stream cortado: cortar desde el primer marcador de protocolo.
  const cut = out.search(/<(?:tool_call|tool_use|tool_invocation|function_calls?|function\s*=|parameter\s*=)\b/i);
  if (cut >= 0) out = out.slice(0, cut);
  out = out.replace(/\n{3,}/g, "\n\n");
  return trim ? out.trimEnd() : out;
}

function looksLikeAgentToolDump(value = "") {
  return /<(?:tool_call|tool_use|function\s*=|parameter\s*=)\b/i.test(String(value || ""));
}

/** Une chunks del agente sin pegar pasos (evita "correctamente.Entendido"). */
function joinAgentStreamText(prev = "", next = "") {
  const a = String(prev || "");
  const b = String(next || "");
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith(b)) return a;
  if (b.startsWith(a) && b.length >= a.length) return b;

  // Párrafo entero reenviado (falla clásica de doble escritura en el chat).
  const aTrimFull = a.trim();
  const bTrimFull = b.trim();
  if (bTrimFull.length >= 40) {
    if (aTrimFull === bTrimFull) return a;
    if (a.includes(bTrimFull)) return a;
    const lastPara = (a.split(/\n\n+/).pop() || "").trim();
    if (lastPara && lastPara === bTrimFull) return a;
    if (lastPara.length >= 40 && bTrimFull.startsWith(lastPara.slice(0, Math.min(80, lastPara.length)))
      && bTrimFull.length <= lastPara.length * 1.15) {
      return a;
    }
  }

  const aTrim = a.replace(/\s+$/g, "");
  const bTrim = b.replace(/^\s+/g, "");
  const bStart = bTrim.charAt(0);
  const newStep = /^(?:Entendido|Perfecto|Excelente|Ahora|Listo|Bien|Hecho|Voy |Primero |Luego |Despu[eé]s|Siguiente|Ok[,.]?\s)/i.test(bTrim)
    || (/[.!?:]$/.test(aTrim) && /^[A-ZÁÉÍÓÚÑ¿¡]/.test(bStart) && bTrim.length > 10);

  if (newStep) return `${aTrim}\n\n${bTrim}`;
  if (/[.!?,:;]$/.test(aTrim) && /^[A-Za-zÁ-ú0-9¿¡("]/.test(bStart)) return `${aTrim} ${bTrim}`;
  if (/\s$/.test(a) || /^\s/.test(b)) return `${a}${b}`;
  if (/[a-zA-Z0-9_áéíóúñ]$/i.test(aTrim) && /^[a-zA-Z0-9_áéíóúñ]/i.test(bStart) && b.length <= 64) {
    return `${a}${b}`;
  }
  if (/[.!?]$/.test(aTrim)) return `${aTrim} ${bTrim}`;
  return `${a}${b}`;
}

function repairPersistedText(value) {
  if (typeof value === "string") return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairPersistedText);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [repairMojibakeText(key), repairPersistedText(item)]));
}

function uid() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function userFacingError(message) {
  const text = String(message || "").trim();
  if (!text) return "No pude completar la acción. Intenta de nuevo.";
  // Nunca mostrar hostnames internos de proveedores en el chat.
  if (/gafcore/i.test(text)
    || /admin\s+de\s+/i.test(text)
    || /Tu modelo seleccionado se conserv/i.test(text)
    || /PROVIDER_TEMPORARILY_UNAVAILABLE/i.test(text)) {
    if (/saldo|balance|402/i.test(text)) {
      return "El proveedor no tiene saldo disponible ahora. Revisa ME AI o APICredits e intenta de nuevo.";
    }
    if (/401|403|api.?key|token|forbidden/i.test(text)) {
      return "No pude autenticar el modelo. Revisa la API key en Modelos e intenta de nuevo.";
    }
    return "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";
  }
  if (/Cannot find module|Require stack|ENOENT|\.asar[\\/]|node_modules|jarvis-adapter|ipcMain/i.test(text)) {
    return "No pude procesar tu mensaje ahora. Verifica que tengas un modelo verificado en Modelos y vuelve a intentar.";
  }
  if (/respuesta vacia|EMPTY_PROVIDER|gafcore-gateway|apicredits\/|meai\/|devolvio una respuesta|proveedor .+ devolvio|upstream|502|503|429|timeout|invalid.?token|no available accounts|no est[aá] disponible|tard[oó] demasiado/i.test(text)) {
    return "No pude completar la respuesta. Intenta de nuevo.";
  }
  if (typeof AutoModel !== "undefined" && AutoModel?.isProviderFailureMessage?.(text)) {
    return "No pude completar la respuesta. Intenta de nuevo.";
  }
  const cleaned = text
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/gafcore(?:\s*gateway)?/gi, "")
    .trim();
  return cleaned || "No pude completar la respuesta. Intenta de nuevo.";
}

function loadJson(key, fallback) {
  if (SECURE_STORAGE_KEYS.has(key)) {
    return Object.prototype.hasOwnProperty.call(secureState, key) ? secureState[key] : fallback;
  }
  try { return JSON.parse(localStorage.getItem(key) || ""); } catch { return fallback; }
}

async function saveSecureJson(key, value) {
  secureState[key] = value;
  try {
    await window.editcoreSecureConfig.save(secureState);
  } catch (error) {
    $("status").textContent = error?.message || "No se pudo guardar la configuracion segura";
    throw error;
  }
}

function agentTaskPrompt(taskId, fallback = "") {
  const prompts = loadJson("editcore-agent-task-prompts", {});
  return String(prompts?.[String(taskId || "")] || fallback || "");
}

async function saveAgentTaskPrompt(taskId, prompt) {
  const id = String(taskId || "").trim();
  if (!id) return;
  const prompts = { ...loadJson("editcore-agent-task-prompts", {}) };
  prompts[id] = String(prompt || "");
  await saveSecureJson("editcore-agent-task-prompts", prompts);
}

async function persistAgentOriginalRequest(project, prompt, { taskId } = {}) {
  if (!project || ProjectAnalysis.isAuthorization(prompt)) return "";
  const original = String(prompt || "").trim();
  if (!original || original.length < 15) return "";
  project.agentWorkflow = {
    ...(project.agentWorkflow || {}),
    task: original,
    taskId: taskId || project.agentWorkflow?.taskId || "",
    updatedAt: Date.now(),
    createdAt: project.agentWorkflow?.createdAt || Date.now(),
  };
  project.analysisMemory = {
    ...(project.analysisMemory || {}),
    request: original,
    projectRoot: project.projectRoot || state.projectRoot || "",
  };
  const id = taskId || project.agentWorkflow?.taskId;
  if (id) await saveAgentTaskPrompt(id, original);
  saveProjects();
  return original;
}

function resolveStoredAgentTask(project, prompt, taskId = "") {
  const id = String(taskId || project?.agentWorkflow?.taskId || "").trim();
  const fromStore = id ? agentTaskPrompt(id, "") : "";
  return ProjectAnalysis.findOriginalUserRequest(project, { storedPrompt: fromStore })
    || String(project?.agentWorkflow?.task || project?.analysisMemory?.request || "").trim()
    || (ProjectAnalysis.isAuthorization(prompt) ? "" : String(prompt || "").trim());
}

async function deleteAgentTaskPrompt(taskId) {
  const id = String(taskId || "").trim();
  const prompts = { ...loadJson("editcore-agent-task-prompts", {}) };
  if (!id || !Object.prototype.hasOwnProperty.call(prompts, id)) return;
  delete prompts[id];
  await saveSecureJson("editcore-agent-task-prompts", prompts);
}

async function initializeSecureState() {
  secureState = await window.editcoreSecureConfig.load().catch(() => ({}));
  const removedLegacyInspectorProvider = Object.prototype.hasOwnProperty.call(secureState, "editcore-inspector-provider");
  if (removedLegacyInspectorProvider) delete secureState["editcore-inspector-provider"];
  localStorage.removeItem("editcore-inspector-provider");
  const storedProfiles = Array.isArray(secureState["editcore-provider-profiles"])
    ? secureState["editcore-provider-profiles"]
    : [];
  const isGatewayProfile = (profile) => {
    const key = String(profile?.providerKey || "");
    const url = String(profile?.baseUrl || "").toLowerCase();
    const id = String(profile?.id || "").toLowerCase();
    return key === "custom:gafcore-gateway"
      || id.startsWith("gafcore-gateway")
      || url.includes("gafcore-gateway");
  };
  const isGatewayProvider = (provider) => {
    const id = String(provider?.id || "").toLowerCase();
    const url = String(provider?.baseUrl || "").toLowerCase();
    const name = String(provider?.name || "").toLowerCase();
    return id === "gafcore-gateway"
      || url.includes("gafcore-gateway")
      || name.includes("gafcore");
  };
  const cleanedProfiles = storedProfiles.filter((profile) => !isGatewayProfile(profile));
  const cleanedCustomProviders = (Array.isArray(secureState["editcore-custom-providers"])
    ? secureState["editcore-custom-providers"]
    : []).filter((provider) => !isGatewayProvider(provider));
  let removedGatewayResidue = false;
  if (cleanedProfiles.length !== storedProfiles.length
    || cleanedCustomProviders.length !== (secureState["editcore-custom-providers"] || []).length) {
    removedGatewayResidue = true;
    secureState["editcore-provider-profiles"] = cleanedProfiles;
    secureState["editcore-custom-providers"] = cleanedCustomProviders;
  }
  let compactedSecure = false;
  if (Array.isArray(secureState["editcore-provider-profiles"])) {
    secureState["editcore-provider-profiles"] = secureState["editcore-provider-profiles"].map((profile) => {
      if (!profile || typeof profile !== "object" || !Object.prototype.hasOwnProperty.call(profile, "models")) return profile;
      const { models: _duplicatedCatalog, ...compactProfile } = profile;
      compactedSecure = true;
      return compactProfile;
    });
  }
  const repairedSecureState = repairPersistedText(secureState);
  const repairedSecure = JSON.stringify(repairedSecureState) !== JSON.stringify(secureState);
  if (repairedSecure) secureState = repairedSecureState;
  let migrated = false;
  const migratedKeys = [];
  for (const key of SECURE_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    if (!Object.prototype.hasOwnProperty.call(secureState, key)) {
      try { secureState[key] = JSON.parse(raw); } catch {}
    }
    migratedKeys.push(key);
    migrated = true;
  }
  if (migrated || repairedSecure || compactedSecure || removedLegacyInspectorProvider || removedGatewayResidue) {
    await window.editcoreSecureConfig.save(secureState);
    migratedKeys.forEach((key) => localStorage.removeItem(key));
  }
}

function normalizeProjectRoot(rootPath) {
  return String(rootPath || "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

function dedupeProjectsByRoot() {
  const result = [];
  const byRoot = new Map();
  for (const project of state.projects) {
    const key = normalizeProjectRoot(project.projectRoot);
    if (!key) {
      result.push(project);
      continue;
    }
    const existingIndex = byRoot.get(key);
    if (existingIndex === undefined) {
      byRoot.set(key, result.length);
      result.push(project);
      continue;
    }
    const existing = result[existingIndex];
    const chatMap = new Map();
    for (const c of (Array.isArray(existing.chats) ? existing.chats : [])) chatMap.set(c.id, c);
    for (const c of (Array.isArray(project.chats) ? project.chats : [])) {
      if (!chatMap.has(c.id)) {
        chatMap.set(c.id, c);
      } else {
        const curC = chatMap.get(c.id);
        const curMsgs = Array.isArray(curC.messages) ? curC.messages : [];
        const newMsgs = Array.isArray(c.messages) ? c.messages : [];
        if (newMsgs.length >= curMsgs.length) {
          chatMap.set(c.id, { ...curC, ...c, messages: newMsgs });
        }
      }
    }
    const mergedChats = Array.from(chatMap.values());
    const keepCurrent = project.id === state.activeProjectId || (existing.id !== state.activeProjectId && (Number(project.updatedAt) || 0) >= (Number(existing.updatedAt) || 0));
    const merged = keepCurrent ? { ...existing, ...project, chats: mergedChats } : { ...project, ...existing, chats: mergedChats };
    result[existingIndex] = merged;
  }
  state.projects = result;
}

let _isSessionHydrated = false;
let _saveDiskDebounceTimer = null;
let _lastSyncedProjectsKey = "";

function saveProjects(options = {}) {
  dedupeProjectsByRoot();
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, state.activeProjectId);
  } catch (error) {
    console.warn("[session] localStorage fill/quota:", error?.message || error);
  }

  // Blindaje: no pisar el almacenamiento en disco si aún no se ha completado la hidratación inicial
  if (!_isSessionHydrated && !options.forceDisk) {
    return;
  }

  if (options.immediate) {
    if (_saveDiskDebounceTimer) {
      clearTimeout(_saveDiskDebounceTimer);
      _saveDiskDebounceTimer = null;
    }
    _flushDiskPersistenceNow(options);
    return;
  }

  if (!_saveDiskDebounceTimer) {
    _saveDiskDebounceTimer = setTimeout(() => {
      _saveDiskDebounceTimer = null;
      _flushDiskPersistenceNow();
    }, 600);
  }
}

function _flushDiskPersistenceNow(options = {}) {
  if (window.editcoreSession?.save) {
    window.editcoreSession.save({
      activeProjectId: state.activeProjectId,
      projects: state.projects,
      allowEmpty: options.allowEmpty === true,
    }).catch((error) => {
      console.warn("[session] save disk:", error?.message || error);
    });
  }
  persistActiveProjectChatsToDisk();
  syncProjectsToMaintenanceScheduler();
}

function persistProjectChatsToDisk(project) {
  if (!window.editcoreSession?.saveProjectChats || !project) return;
  const root = String(project.projectRoot || "").trim();
  if (!root) return;
  window.editcoreSession.saveProjectChats({
    projectRoot: root,
    chats: Array.isArray(project.chats) ? project.chats : [],
    activeChatId: project.activeChatId || "",
    messages: Array.isArray(project.messages) ? project.messages : [],
  }).catch(() => undefined);
}

function persistActiveProjectChatsToDisk() {
  const project = activeProject();
  if (project) persistProjectChatsToDisk(project);
}

function flushSessionSyncNow() {
  if (!_isSessionHydrated) return;
  if (_saveDiskDebounceTimer) {
    clearTimeout(_saveDiskDebounceTimer);
    _saveDiskDebounceTimer = null;
  }
  if (!window.editcoreSession?.flushSync) return;
  try {
    dedupeProjectsByRoot();
    window.editcoreSession.flushSync({
      activeProjectId: state.activeProjectId,
      projects: state.projects,
    });
  } catch { /* ignore */ }
}

async function hydrateProjectChatsFromDisk(project) {
  if (!project?.projectRoot || !window.editcoreSession?.loadProjectChats) return project;
  try {
    const disk = await window.editcoreSession.loadProjectChats({ projectRoot: project.projectRoot });
    if (!disk) return project;
    const memUpdated = Number(project.updatedAt) || 0;
    const diskUpdated = Number(disk.savedAt) || 0;
    if (memUpdated > diskUpdated && Array.isArray(project.chats) && project.chats.length > 0) {
      return project;
    }
    const diskCount = (disk.chats || []).reduce((n, c) => n + (c.messages || []).length, 0)
      + (disk.messages || []).length;
    const memCount = (project.chats || []).reduce((n, c) => n + (c.messages || []).length, 0)
      + (project.messages || []).length;
    if (diskCount === 0 && memCount > 0) return project;
    const chats = Array.isArray(disk.chats) && disk.chats.length
      ? disk.chats
      : [{
        id: project.activeChatId || uid(),
        title: "Chat 1",
        messages: disk.messages || [],
        updatedAt: disk.savedAt || Date.now(),
      }];
    project.chats = chats;
    project.activeChatId = disk.activeChatId || chats[0]?.id || project.activeChatId;
    const active = chats.find((c) => c.id === project.activeChatId) || chats[0];
    project.messages = active?.messages || disk.messages || project.messages || [];
    project.updatedAt = Math.max(Number(project.updatedAt) || 0, Number(disk.savedAt) || 0);
  } catch { /* ignore */ }
  return project;
}

function syncProjectsToMaintenanceScheduler() {
  if (!window.editcoreMaintenance?.syncProjects) return;
  const payload = state.projects.map((project) => ({
    id: project.id,
    name: project.name,
    projectRoot: project.projectRoot,
  }));
  const key = JSON.stringify(payload);
  if (key === _lastSyncedProjectsKey) return;
  _lastSyncedProjectsKey = key;
  window.editcoreMaintenance.syncProjects(payload).catch(() => undefined);
}

function loadMetrics() {
  const saved = loadJson("editcore-metrics", {});
  state.metrics = {
    confirmedUsedTokens: Number(saved.confirmedUsedTokens) || 0,
    confirmedInputTokens: Number(saved.confirmedInputTokens) || 0,
    confirmedOutputTokens: Number(saved.confirmedOutputTokens) || 0,
    providerCacheReadTokens: Number(saved.providerCacheReadTokens) || 0,
    localSavedConfirmedTokens: Number(saved.localSavedConfirmedTokens) || 0,
    localSavedEstimatedTokens: Number(saved.localSavedEstimatedTokens) || 0,
    estimatedTokens: Number(saved.estimatedTokens) || 0,
    localCacheHits: Number(saved.localCacheHits) || 0,
    externalCallsAvoided: Number(saved.externalCallsAvoided) || 0,
    byModel: saved.byModel && typeof saved.byModel === "object" ? saved.byModel : {},
  };
}

function saveMetrics() {
  localStorage.setItem("editcore-metrics", JSON.stringify(state.metrics));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer archivo."));
    reader.readAsDataURL(file);
  });
}

function isImageAttachment(item = {}) {
  const mime = String(item?.mimeType || "").toLowerCase();
  if (/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(mime)) return true;
  if (/^data:image\/(png|jpe?g|webp|gif|bmp)/i.test(String(item?.dataUrl || ""))) return true;
  return false;
}

function sniffMimeFromDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  let mime = match ? match[1].toLowerCase() : "";
  if (mime === "image/jpg") mime = "image/jpeg";
  return mime;
}

async function addFiles(files) {
  const incoming = [...(files || [])].filter(Boolean).slice(0, 8);
  for (const file of incoming) {
    const dataUrl = await readFileAsDataUrl(file);
    let mimeType = String(file.type || "").toLowerCase();
    if (mimeType === "image/jpg") mimeType = "image/jpeg";
    const name = String(file.name || `archivo-${Date.now()}`).slice(0, 120);
    if (!mimeType || mimeType === "application/octet-stream") {
      mimeType = sniffMimeFromDataUrl(dataUrl) || mimeFromFileName(name) || mimeType || "application/octet-stream";
    }
    state.attachments.push({ name, mimeType, size: file.size, dataUrl });
  }
  renderAttachments();
}

function mimeFromFileName(name = "") {
  const ext = String(name).toLowerCase().split(".").pop() || "";
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "";
}

function isAttachableFile(file) {
  if (!file) return false;
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  if (/^image\//i.test(mime)) return true;
  if (/pdf|msword|officedocument|ms-excel|ms-powerpoint|text\/|json|csv/i.test(mime)) return true;
  return /\.(png|jpe?g|webp|gif|bmp|pdf|docx?|xlsx?|xlsm|csv|txt|md|json|js|ts|tsx|jsx|css|html|pptx?)$/i.test(name);
}

function collectClipboardFiles(clipboardData) {
  const files = [];
  for (const item of [...(clipboardData?.items || [])]) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) {
    for (const f of [...(clipboardData?.files || [])]) files.push(f);
  }
  return files.filter(isAttachableFile);
}

function renderAttachments() {
  const lists = [$("attachmentList"), $("chatHomeAttachmentList")].filter(Boolean);
  for (const list of lists) {
    list.replaceChildren();
    list.style.display = state.attachments.length ? "" : "none";
    list.classList.toggle("is-empty", state.attachments.length === 0);
  }
  $("chatForm")?.classList.toggle("has-attachments", state.attachments.length > 0);
  $("chatHomeComposer")?.classList.toggle("has-attachments", state.attachments.length > 0);
  for (const item of state.attachments) {
    for (const list of lists) {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      chip.title = item.name;
      if (/^image\//i.test(item.mimeType) || isImageAttachment(item)) {
        chip.classList.add("has-image");
        const img = document.createElement("img");
        img.src = item.dataUrl;
        img.alt = item.name;
        chip.appendChild(img);
      } else {
        const name = document.createElement("span");
        name.textContent = item.name;
        chip.appendChild(name);
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chip-del";
      del.textContent = "×";
      del.onclick = () => {
        state.attachments = state.attachments.filter((c) => c !== item);
        renderAttachments();
      };
      chip.appendChild(del);
      list.appendChild(chip);
    }
  }
}

// ── Connections ──────────────────────────────────────────────────────────────

function gafcoreProjectSlugFromRoot(projectRoot = "") {
  const base = String(projectRoot || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "app";
}

function isGafcoreSupabaseUrl(url = "") {
  try {
    return /supabase\.gafcore\.com$/i.test(new URL(String(url || "").trim()).hostname);
  } catch {
    return /supabase\.gafcore\.com/i.test(String(url || ""));
  }
}

/** Bóveda global: solo origen de plataforma, nunca /taxidriv ni otro path de app. */
function vaultSafeSupabaseUrl(url = "") {
  const raw = String(url || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (/supabase\.gafcore\.com$/i.test(parsed.hostname)) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch { /* ignore */ }
  return raw;
}

/** URL que debe verse en el modal: del proyecto abierto, no de otro (taxidriv, etc.). */
function displaySupabaseUrlForActiveProject(savedUrl = "", projectRoot = "") {
  const root = String(projectRoot || "").trim();
  const raw = String(savedUrl || "").trim().replace(/\/+$/, "");
  if (!raw) {
    return root ? `https://supabase.gafcore.com/${gafcoreProjectSlugFromRoot(root)}` : "";
  }
  if (!isGafcoreSupabaseUrl(raw)) return raw;
  const origin = vaultSafeSupabaseUrl(raw) || "https://supabase.gafcore.com";
  if (!root) return origin;
  return `${origin}/${gafcoreProjectSlugFromRoot(root)}`;
}

function loadConnections() {
  const saved = loadJson("editcore-connections", {});
  const display = { ...saved };
  display.selfSupabaseUrl = displaySupabaseUrlForActiveProject(
    saved.selfSupabaseUrl,
    state.projectRoot || "",
  );
  document.querySelectorAll("[data-conn]").forEach((input) => {
    input.value = display[input.dataset.conn] || "";
  });
  const urlHint = $("selfSupabaseProjectHint");
  if (urlHint) {
    const root = String(state.projectRoot || "").trim();
    if (root && isGafcoreSupabaseUrl(display.selfSupabaseUrl || "https://supabase.gafcore.com")) {
      urlHint.textContent = `DB del proyecto: ${gafcoreProjectSlugFromRoot(root)}`;
      urlHint.hidden = false;
    } else {
      urlHint.textContent = "";
      urlHint.hidden = true;
    }
  }
  // Limpiar bóveda si aún guarda path ajeno (/taxidriv, ...).
  const safeVaultUrl = vaultSafeSupabaseUrl(saved.selfSupabaseUrl);
  if (safeVaultUrl && safeVaultUrl !== String(saved.selfSupabaseUrl || "").replace(/\/+$/, "")) {
    void saveSecureJson("editcore-connections", { ...saved, selfSupabaseUrl: safeVaultUrl });
  }
  renderConnectionStatus();
}

async function renderGatewayProjectStatus() {
  // Sección eliminada del panel Conexiones.
  return;
}

async function saveGafcoreAdminToken() {
  throw new Error("Esta integración ya no está disponible. Configura ME AI o APICredits en Modelos.");
}

async function connectGatewayProject() {
  throw new Error("Esta integración ya no está disponible. Configura ME AI o APICredits en Modelos.");
}

function pathBasename(filePath = "") {
  const raw = String(filePath || "").replace(/[\\/]+$/, "");
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

async function saveConnections() {
  // Recargar bóveda desde disco antes de fusionar, para no pisar secretos migrados.
  secureState = await window.editcoreSecureConfig.load().catch(() => secureState);
  const previous = { ...(loadJson("editcore-connections", {}) || {}) };
  const data = { ...previous };
  document.querySelectorAll("[data-conn]").forEach((input) => {
    const key = input.dataset.conn;
    const next = input.value.trim();
    const isSecret = /token|key|password|secret|host|path/i.test(String(key || ""));
    // Boveda: nunca pisar un secreto guardado con vacio (autofill / campo no tocado).
    if (isSecret) {
      if (!next) {
        if (previous[key]) data[key] = previous[key];
        return;
      }
      data[key] = next;
      return;
    }
    if (next || !(key in previous)) data[key] = next;
  });
  // Netlify retirado de la bóveda UI: no lo usamos.
  delete data.netlifyToken;
  delete data.netlifySiteId;
  // Cloud token / Org ID de Supabase Cloud: retirados de la UI (solo usamos Supabase propio URL+API Key).
  delete data.supabaseCloudToken;
  delete data.supabaseOrgId;
  delete data.supabaseManagementToken;
  if (data.selfSupabaseUrl) {
    data.selfSupabaseUrl = String(data.selfSupabaseUrl || "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/gafcore-gateway(?:\/api(?:\/openai(?:\/v1)?)?)?$/i, "")
      .replace(/\/api\/openai\/v1$/i, "")
      .replace(/\/rest\/v1$/i, "")
      .replace(/\/+$/, "");
    // Nunca persistir /taxidriv u otro slug en la bóveda global.
    data.selfSupabaseUrl = vaultSafeSupabaseUrl(data.selfSupabaseUrl) || data.selfSupabaseUrl;
    const urlInput = document.querySelector("[data-conn='selfSupabaseUrl']");
    if (urlInput) {
      urlInput.value = displaySupabaseUrlForActiveProject(data.selfSupabaseUrl, state.projectRoot || "");
    }
  }
  await saveSecureJson("editcore-connections", data);
  await saveSecureJson("editcore-rtk", { enabled: true });
  // Guardar = persistir boveda. No martillar APIs (GitHub rate-limit / falsos ERROR).
  await renderConnectionStatus(false);
  $("status").textContent = "Conexiones guardadas (boveda). Usa «Probar ahora» solo para validar red. Supabase se resuelve por proyecto activo (.env) si existe.";
}

async function renderConnectionStatus(validate = false) {
  const saved = loadJson("editcore-connections", {});
  const map = {
    github:      !!saved.githubToken,
    vercel:      !!saved.vercelToken,
    selfsupabase: !!(saved.selfSupabaseUrl && saved.selfSupabaseKey),
    ssh:         !!(saved.serverHost && saved.serverKeyPath),
  };
  Object.entries(map).forEach(([key, configured]) => {
    const badge = document.querySelector(`.conn-status[data-service="${key}"]`);
    if (!badge) return;
    badge.classList.remove("connected", "error");
    badge.removeAttribute("title");
    if (!configured) {
      badge.textContent = "sin configurar";
      return;
    }
    // Sin validate: mostrar "en boveda" (no ERROR por red/rate-limit).
    badge.textContent = "en boveda";
    badge.classList.add("connected");
  });
  if (!validate || !window.editcoreConnections?.validate) {
    if (window.editcoreConnections?.operatorMemory) {
      try {
        const mem = await window.editcoreConnections.operatorMemory({
          projectRoot: state.projectRoot || "",
          projectId: state.activeProjectId || "",
        });
        state.operatorConnectionsMemory = String(mem?.memory || "").trim();
      } catch { /* ignore */ }
    }
    return;
  }
  Object.keys(map).forEach((key) => {
    const badge = document.querySelector(`.conn-status[data-service="${key}"]`);
    if (badge && map[key]) badge.textContent = "verificando...";
  });
  const results = await window.editcoreConnections.validate().catch(() => []);
  for (const result of Array.isArray(results) ? results : [results]) {
    const badge = document.querySelector(`.conn-status[data-service="${result.service}"]`);
    if (!badge) continue;
    badge.textContent = result.ok ? (result.account || "verificada") : result.configured ? "error" : "sin configurar";
    badge.classList.toggle("connected", Boolean(result.ok));
    badge.classList.toggle("error", Boolean(result.configured && !result.ok));
    if (result.error) {
      badge.title = result.error;
      if (!result.ok && result.configured) {
        const detail = document.querySelector(`.conn-error-detail[data-service="${result.service}"]`);
        if (detail) {
          detail.textContent = result.error;
          detail.style.display = "block";
        }
      }
    } else if (result.account) {
      badge.title = "Conectado: " + result.account;
      const detail = document.querySelector(`.conn-error-detail[data-service="${result.service}"]`);
      if (detail) detail.style.display = "none";
    }
  }
  if (window.editcoreConnections?.operatorMemory) {
    try {
      const mem = await window.editcoreConnections.operatorMemory({
        projectRoot: state.projectRoot || "",
        projectId: state.activeProjectId || "",
      });
      state.operatorConnectionsMemory = String(mem?.memory || "").trim();
    } catch { /* ignore */ }
  }
}

async function detectConnections() {
  const button = $("detectConnectionsBtn");
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "Detectando...";
  try {
    const report = await window.editcoreConnections.importLocal({
      projectRoot: state.projectRoot || "",
      forceLegacy: true,
    });
    secureState = await window.editcoreSecureConfig.load().catch(() => secureState);
    loadConnections();
    const ok = (report?.validation || []).filter((item) => item.ok).map((item) => item.account || item.service);
    const legacyOk = report?.legacyImport?.imported || report?.imported?.legacy;
    const parts = [];
    if (legacyOk) parts.push("legacy");
    if (ok.length) parts.push(...ok);
    if (report?.imported?.gafcore || report?.gafcoreImported) {
      // Residuo legado ignorado: el gateway AI ya no se importa.
    }
    $("status").textContent = parts.length
      ? `Conexiones detectadas: ${parts.join(", ")}`
      : "No se detectaron conexiones locales válidas";
    await renderGatewayProjectStatus().catch(() => undefined);
  } catch (error) {
    $("status").textContent = error?.message || String(error);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function openExternal(url) {
  if (window.editcoreShell?.openExternal) window.editcoreShell.openExternal(url);
  else window.open(url, "_blank");
}

function connectGitHub() {
  const token = document.querySelector("[data-conn='githubToken']")?.value.trim();
  if (token) { saveConnections(); return; }
  openExternal("https://github.com/settings/tokens/new?scopes=repo,workflow&description=EditCore");
}

function connectVercel() {
  const token = document.querySelector("[data-conn='vercelToken']")?.value.trim();
  if (token) { saveConnections(); return; }
  openExternal("https://vercel.com/account/tokens");
}

function connectSelfSupabase() {
  const urlKey = "selfSupabaseUrl";
  const keyKey = "selfSupabaseKey";
  const url = document.querySelector(`[data-conn='${urlKey}']`)?.value.trim();
  const key = document.querySelector(`[data-conn='${keyKey}']`)?.value.trim();
  if (url && key) { saveConnections(); return; }
}

function renderDialogAfterOpen(dialog, render) {
  if (!dialog.open) dialog.showModal();
  if (dialog.open) render();
}

async function openConnections() {
  const dialog = $("connectionsDialog");
  if (!dialog.open) dialog.showModal();
  try {
    secureState = await window.editcoreSecureConfig.load().catch(() => secureState);
  } catch { /* ignore */ }
  setTimeout(() => { if (dialog.open) loadConnections(); }, 0);
}

function closeConnections() {
  $("connectionsDialog").close();
}

// ── Providers ─────────────────────────────────────────────────────────────────

function loadProviders() {
  const saved = loadJson("editcore-providers", {});
  PRIMARY_PROVIDER_KEYS.forEach((key) => {
    const def = PROVIDERS[key];
    const urlEl = document.querySelector(`[data-prov-url="${key}"]`);
    const keyEl = document.querySelector(`[data-prov-key="${key}"]`);
    const modEl = document.querySelector(`[data-prov-model="${key}"]`);
    if (urlEl) urlEl.value = saved[key]?.baseUrl || def.baseUrl;
    if (keyEl) keyEl.value = saved[key]?.apiKey || "";
    if (modEl) modEl.value = saved[key]?.model || def.model;
    renderProviderStatus(key, saved[key] || {});
  });
}

function renderProviderStatus(key, status = {}) {
  const badge = document.querySelector(`[data-provider-state="${key}"]`);
  if (!badge) return;
  const activeProfiles = loadProviderProfiles().filter((profile) =>
    profile.providerKey === key && profile.status === "active" && profile.model && profile.apiKey
  );
  if (activeProfiles.length) {
    badge.className = "provider-state active";
    badge.textContent = `Funcional · ${activeProfiles.length} ${activeProfiles.length === 1 ? "modelo" : "modelos"}`;
    badge.removeAttribute("title");
    return;
  }
  badge.className = `provider-state ${status.status || ""}`;
  badge.textContent = status.status === "active"
    ? `Funcional${status.modelCount ? ` · ${status.modelCount} modelos` : ""}`
    : status.status === "checking" ? "Verificando…"
      : status.status === "inactive" ? "No valida" : "Sin verificar";
  if (status.error) badge.title = String(status.error).slice(0, 240);
}

function resolveProviderApiKey(key, formKey = "") {
  const typed = String(formKey || "").trim();
  if (typed) return typed;
  const saved = loadJson("editcore-providers", {})[key] || {};
  if (String(saved.apiKey || "").trim()) return String(saved.apiKey).trim();
  const profile = loadProviderProfiles().find((item) =>
    item.providerKey === key && String(item.apiKey || "").trim(),
  );
  if (profile) return String(profile.apiKey).trim();
  const chat = loadJson("editcore-chat-config", {});
  if (String(chat.providerKey || "") === key && String(chat.apiKey || "").trim()) {
    return String(chat.apiKey).trim();
  }
  return "";
}

function sanitizeProviderIpcError(error) {
  const raw = String(error?.message || error || "");
  const unwrapped = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "").trim() || raw;
  if (/Falta la API key/i.test(unwrapped)) {
    return "Falta la API key. Pégala en Modelos y vuelve a verificar.";
  }
  if (/Error invoking remote method/i.test(unwrapped) && unwrapped.length < 80) {
    return "No se pudo verificar el proveedor. Revisa la API key y el endpoint.";
  }
  return unwrapped.slice(0, 240);
}

function readProviderForm(key) {
  const def = PROVIDERS[key] || {};
  const formKey = document.querySelector(`[data-prov-key="${key}"]`)?.value.trim() || "";
  return {
    baseUrl: document.querySelector(`[data-prov-url="${key}"]`)?.value.trim() || def.baseUrl || "",
    apiKey: resolveProviderApiKey(key, formKey),
    model: document.querySelector(`[data-prov-model="${key}"]`)?.value.trim() || def.model || "",
  };
}

async function saveProviderForm(key, extra = {}) {
  const data = loadJson("editcore-providers", {});
  const previous = data[key] || {};
  const form = readProviderForm(key);
  if (!form.apiKey && previous.apiKey) form.apiKey = previous.apiKey;
  data[key] = { ...previous, ...form, ...extra };
  if (!String(data[key].apiKey || "").trim() && previous.apiKey) data[key].apiKey = previous.apiKey;
  await saveSecureJson("editcore-providers", data);
  const keyEl = document.querySelector(`[data-prov-key="${key}"]`);
  if (keyEl && data[key].apiKey && !keyEl.value.trim()) keyEl.value = data[key].apiKey;
  return data[key];
}

async function verifyProvider(key) {
  renderProviderStatus(key, { status: "checking" });
  const provider = await saveProviderForm(key, { status: "checking", error: "" });
  if (!String(provider.apiKey || "").trim()) {
    const message = "Falta la API key. Pégala en Modelos y vuelve a verificar.";
    await saveProviderForm(key, { status: "inactive", checkedAt: Date.now(), error: message });
    renderProviderStatus(key, { status: "inactive", error: message });
    throw new Error(message);
  }
  try {
    const result = await window.editcoreProviders.test({ ...provider, providerKey: key });
    const verified = await saveProviderForm(key, {
      model: result.model,
      models: result.models,
      status: "active",
      modelCount: result.modelCount,
      checkedAt: Date.now(),
      error: "",
    });
    setChatModelOptions(result.models, result.model);
    renderProviderStatus(key, { status: "active", modelCount: result.modelCount });
    return { ...verified, providerKey: key };
  } catch (error) {
    const message = sanitizeProviderIpcError(error);
    await saveProviderForm(key, { status: "inactive", checkedAt: Date.now(), error: message });
    renderProviderStatus(key, { status: "inactive", error: message });
    throw new Error(message);
  }
}

async function saveProviders() {
  const data = loadJson("editcore-providers", {});
  PRIMARY_PROVIDER_KEYS.forEach((key) => {
    const urlEl = document.querySelector(`[data-prov-url="${key}"]`);
    const keyEl = document.querySelector(`[data-prov-key="${key}"]`);
    const previous = data[key] || {};
    const nextKey = keyEl?.value.trim() || previous.apiKey || "";
    data[key] = {
      ...previous,
      baseUrl: urlEl?.value.trim() || PROVIDERS[key].baseUrl,
      ...(nextKey ? { apiKey: nextKey } : {}),
    };
  });
  await saveSecureJson("editcore-providers", data);
  const customProviders = loadCustomProviders().filter((provider) => {
    const id = String(provider?.id || "").toLowerCase();
    const url = String(provider?.baseUrl || "").toLowerCase();
    const name = String(provider?.name || "").toLowerCase();
    return id !== "gafcore-gateway" && !url.includes("gafcore-gateway") && !name.includes("gafcore");
  });
  for (const provider of customProviders) {
    const provKey = `custom:${provider.id}`;
    const nameEl = document.querySelector(`[data-prov-name="${provKey}"]`);
    const urlEl = document.querySelector(`[data-prov-url="${provKey}"]`);
    if (nameEl) provider.name = nameEl.value.trim() || provider.name || "Endpoint personalizado";
    if (urlEl) provider.baseUrl = urlEl.value.trim() || provider.baseUrl || "";
    if (!provider?.apiKey || !provider?.baseUrl || !Array.isArray(provider.enabledModels) || !provider.enabledModels.length) continue;
    provider.status = "active";
    provider.error = "";
    await syncCustomProviderProfiles(provider);
  }
  await saveCustomProviders(customProviders);
  const privacyToggle = $("privacyModeToggle");
  if (privacyToggle && window.editcoreAgent?.privacySet) {
    await window.editcoreAgent.privacySet({ enabled: privacyToggle.checked === true });
  }
  syncChatModelFromConfig();
}

function openProviders() {
  renderDialogAfterOpen($("providersDialog"), () => {
    renderCustomProviders();
    loadProviders();
    syncChatModelFromConfig();
    if (window.editcoreAgent?.privacyGet) {
      window.editcoreAgent.privacyGet().then((pm) => {
        const toggle = $("privacyModeToggle");
        if (toggle) toggle.checked = pm?.enabled === true;
      }).catch(() => undefined);
    }
  });
}

function closeProviders() {
  $("providersDialog").close();
}

function loadProviderProfiles() { return loadJson("editcore-provider-profiles", []); }
async function saveProviderProfiles(profiles) { await saveSecureJson("editcore-provider-profiles", profiles); }

function providerKeyForEndpoint(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("api.openai.com")) return "openai";
  if (value.includes("api.anthropic.com")) return "anthropic";
  if (value.includes("generativelanguage.googleapis.com")) return "gemini";
  return PRIMARY_PROVIDER_KEYS.find((key) => value.includes(new URL(PROVIDERS[key].baseUrl).hostname)) || "apicredits";
}

function renderProviderProfiles() {
  const profiles = loadProviderProfiles();
  document.querySelectorAll("[data-provider-profiles]").forEach((host) => {
    const key = host.dataset.providerProfiles;
    host.replaceChildren();
    const providerProfiles = profiles.filter((profile) => profile.providerKey === key);
    if (key === "custom:gafcore-gateway") {
      const labels = { meai: "ME AI Cloud", apicredits: "APICredits" };
      providerProfiles.sort((a, b) => {
        const [aProvider, ...aModel] = String(a.model || "").split("/");
        const [bProvider, ...bModel] = String(b.model || "").split("/");
        return String(labels[aProvider] || aProvider).localeCompare(String(labels[bProvider] || bProvider), "es", { sensitivity: "base" })
          || aModel.join("/").localeCompare(bModel.join("/"), undefined, { sensitivity: "base", numeric: true });
      });
    }
    let renderedProviderGroup = "";
    providerProfiles.forEach((profile) => {
      const [modelProvider, ...modelParts] = String(profile.model || "").split("/");
      if (key === "custom:gafcore-gateway" && modelProvider !== renderedProviderGroup) {
        renderedProviderGroup = modelProvider;
        const heading = document.createElement("div");
        heading.className = "gateway-model-provider";
        heading.textContent = ({ meai: "ME AI Cloud", apicredits: "APICredits" }[modelProvider] || modelProvider);
        host.appendChild(heading);
      }
      const row = document.createElement("div"); row.className = "provider-profile"; row.dataset.profileId = profile.id;
      const model = document.createElement("input"); model.value = key === "custom:gafcore-gateway" ? modelParts.join("/") : (profile.model || ""); model.placeholder = "Modelo";
      model.dataset.fullModel = profile.model || "";
      if (key === "custom:gafcore-gateway") {
        model.readOnly = true;
        const status = document.createElement("span");
        status.className = `provider-profile-status ${profile.status || ""}`;
        status.textContent = profile.status === "active" ? "Funcional" : "No disponible";
        row.append(model, status);
        host.appendChild(row);
        return;
      }
      const api = document.createElement("input"); api.type = "password"; api.value = profile.apiKey || ""; api.placeholder = "API key del modelo";
      const status = document.createElement("span"); status.className = `provider-profile-status ${profile.status || ""}`;
      status.textContent = profile.status === "active" ? "Funcional" : profile.status === "inactive" ? "No valida" : "Sin verificar";
      const actions = document.createElement("div"); actions.className = "provider-profile-actions";
      const save = document.createElement("button"); save.type = "button"; save.className = "profile-save"; save.textContent = "Guardar";
      save.onclick = async () => { profile.model = model.value.trim(); profile.apiKey = api.value.trim(); profile.status = ""; await saveProviderProfiles(profiles); status.className = "provider-profile-status"; status.textContent = "Guardado · sin verificar"; };
      const verify = document.createElement("button"); verify.type = "button"; verify.className = "profile-verify"; verify.textContent = "Verificar y activar";
      verify.onclick = async () => {
        const parent = readProviderForm(key); profile.model = model.value.trim(); profile.apiKey = api.value.trim() || parent.apiKey;
        status.className = "provider-profile-status"; status.textContent = "Verificando…";
        try {
          const result = await window.editcoreProviders.test({ providerKey: key, baseUrl: parent.baseUrl, apiKey: profile.apiKey, model: profile.model });
          profile.status = "active"; delete profile.models; profile.model = result.model; profile.modelCount = result.modelCount; profile.checkedAt = Date.now(); profile.error = "";
          model.value = result.model;
          status.className = "provider-profile-status active";
          status.textContent = result.resolvedAlias ? `Funcional · ${result.model}` : `Funcional · ${result.modelCount}`;
          status.title = result.resolvedAlias ? `${result.resolvedAlias} se resolvio como ${result.model}` : "Modelo verificado con una respuesta real";
          profile.baseUrl = parent.baseUrl;
          profile.providerName = loadCustomProviders().find((item) => `custom:${item.id}` === key)?.name || profile.providerName || "";
          await saveProviderProfiles(profiles);
          renderProviderStatus(key);
          if (AutoModel.isAutoModelSelection($("chatModelSelect")?.selectedOptions?.[0])) {
            const scope = currentAutoProviderScope();
            await saveSecureJson("editcore-chat-config", {
              ...loadJson("editcore-chat-config", {}),
              remember: true,
              modelSelectionMode: "auto",
              autoProviderScope: scope,
            });
            setChatModelOptions([], AutoModel.autoSelectionValue(scope), "", "");
          } else {
            setChatModelOptions([], profile.model, key, profile.id);
            await activateProvider({ ...parent, ...profile, providerKey: key, profileId: profile.id });
          }
        } catch (error) { profile.status = "inactive"; profile.error = error?.message || String(error); status.className = "provider-profile-status inactive"; status.textContent = "No valida"; status.title = profile.error; await saveProviderProfiles(profiles); renderProviderStatus(key); }
      };
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "profile-delete"; remove.textContent = "×";
      remove.onclick = async () => { const next = profiles.filter((item) => item.id !== profile.id); await saveProviderProfiles(next); renderProviderProfiles(); renderProviderStatus(key); syncChatModelFromConfig(); };
      model.onchange = api.onchange = async () => {
        const newModel = model.value.trim();
        const newKey = api.value.trim();
        const wasVerified = ["active", "enabled"].includes(profile.status);
        const modelChanged = newModel !== (profile.model || "");
        const keyChanged = newKey !== (profile.apiKey || "");
        profile.model = newModel;
        profile.apiKey = newKey;
        // Solo resetear status si cambió el modelo o la key, no si no cambió nada
        if (wasVerified && (modelChanged || keyChanged)) profile.status = "";
        await saveProviderProfiles(profiles);
      };
      actions.append(save, verify, remove);
      row.append(model, api, status, actions); host.appendChild(row);
    });
  });
}

function modelsForProvider(key) {
  const profiles = loadProviderProfiles().filter((profile) => profile.providerKey === key && profile.status === "active");
  return [...new Set(profiles.map((profile) => String(profile.model || "").trim()).filter(Boolean))];
}

function verifiedProfileForModel(providerKey, model) {
  const profiles = loadProviderProfiles().filter((profile) => ["active", "enabled"].includes(profile.status));
  return profiles.find((profile) => profile.providerKey === providerKey && profile.model === model);
}

function currentAutoProviderScope() {
  const selectedOption = $("chatModelSelect")?.selectedOptions?.[0];
  if (selectedOption && AutoModel.isAutoModelSelection(selectedOption)) {
    return AutoModel.parseAutoSelectionScope(selectedOption);
  }
  const config = loadJson("editcore-chat-config", {});
  if (config.modelSelectionMode === "auto") {
    return AutoModel.normalizeAutoProviderScope(config.autoProviderScope);
  }
  return "";
}

function isChatModelAutoMode() {
  const config = loadJson("editcore-chat-config", {});
  const selectedOption = $("chatModelSelect")?.selectedOptions?.[0];
  return AutoModel.isAutoModelSelection(selectedOption) || config.modelSelectionMode === "auto";
}

async function refreshModelCapabilities(force = false) {
  const stale = Date.now() - capabilitiesLoadedAt > 5000;
  if (!force && !stale && Object.keys(cachedModelCapabilities).length) return cachedModelCapabilities;
  try {
    cachedModelCapabilities = await window.editcoreModels?.capabilities?.() || {};
  } catch {
    cachedModelCapabilities = cachedModelCapabilities || {};
  }
  capabilitiesLoadedAt = Date.now();
  return cachedModelCapabilities;
}

function isGatewayProviderFailure(message, model = "") {
  if (AutoModel.isProviderFailureMessage?.(message)) return true;
  const text = String(message || "").toLowerCase();
  const group = AutoModel.gatewayUpstreamGroup(model);
  if (group === "apicredits") return /502|503|401|403|timeout|invalid|无效|令牌|upstream|no est[aá] disponible|tard[oó] demasiado/i.test(text);
  return /apicredits/.test(text)
    && (/no est[aá] disponible|tard[oó] demasiado|502|503|upstream|forbidden|temporarily unavailable|no available accounts/i.test(text));
}

async function quarantineModelForAuto(job = {}, message = "") {
  const model = String(job.model || "").trim();
  if (!model) return;
  try {
    await window.editcoreModels?.recordCapability?.({
      baseUrl: job.baseUrl || "",
      model,
      providerKey: job.providerKey || "",
      ok: false,
      error: String(message || "Proveedor no respondio").slice(0, 240),
    });
  } catch {}
  await refreshModelCapabilities(true);
  if (isChatModelAutoMode()) {
    $("status").textContent = "Listo";
    if ($("modelPickerMenu") && !$("modelPickerMenu").classList.contains("hidden")) renderModelPickerMenu();
  }
}

async function handleProviderFailureForAuto(message, job = {}) {
  // Timeouts / 503 temporales: NO cuarentenar 20 min (mataba APICredits con saldo).
  const shouldQuarantine = typeof AutoModel?.shouldQuarantineModelForAuto === "function"
    ? AutoModel.shouldQuarantineModelForAuto(message)
    : /401|403|402|invalid.?token|forbidden|no est[aá] permitido|EMPTY_PROVIDER|saldo|balance/i.test(String(message || ""));
  if (!shouldQuarantine) return;
  if (!isGatewayProviderFailure(message, job.model) && !AutoModel.isProviderFailureMessage?.(message)) return;
  await quarantineModelForAuto(job, message);
}

function resolveActiveChatProfile(context = {}) {
  if (isChatModelAutoMode()) {
    // Auto debe rotar sobre modelos activos del proveedor (scope ME AI / APICredits).
    const options = verifiedChatModelOptions();
    const profiles = loadProviderProfiles();
    return AutoModel.resolveAutoModelProfile(options, profiles, {
      ...context,
      profiles,
      autoProviderScope: context.autoProviderScope ?? currentAutoProviderScope(),
      requireAgentTools: context.requireAgentTools === true
        || Boolean(context.isAgent && context.usesProjectTools),
      capabilities: cachedModelCapabilities,
      lastAutoResolvedModel: state.lastAutoResolvedModel || "",
      autoUpstreamUsage: state.autoUpstreamUsage || { meai: 0, apicredits: 0 },
      autoModelUsage: state.autoModelUsage || {},
      excludeModels: context.excludeModels || [],
    });
  }
  const config = loadJson("editcore-chat-config", {});
  const selectedOption = $("chatModelSelect")?.selectedOptions?.[0];
  const selectedModel = selectedOption?.dataset.model?.trim() || config.model || "";
  const selectedProviderKey = selectedOption?.dataset.providerKey || config.providerKey || providerKeyForEndpoint(config.baseUrl);
  const selectedProfileId = selectedOption?.dataset.profileId || config.providerProfileId || "";
  return loadProviderProfiles().find((profile) =>
    profile.id === selectedProfileId
    && profile.providerKey === selectedProviderKey
    && ["active", "enabled"].includes(profile.status)
    && profile.model === selectedModel
  ) || null;
}

function inferChatModeFromModel(model = "") {
  const value = String(model || "").toLowerCase();
  if (/claude/.test(value)) return "claude";
  if (/gpt|o1|o3|o4/.test(value)) return "gpt";
  return state.mode === "claude" || state.mode === "gpt" ? state.mode : "claude";
}

async function syncAutoResolvedProvider(profile, { keepPickerOpen = false } = {}) {
  if (!profile) return null;
  const modelFields = PromptJobModel?.resolvePromptJobModelFields
    ? PromptJobModel.resolvePromptJobModelFields(profile, loadJson("editcore-providers", {}), PROVIDERS)
    : null;
  if (!modelFields?.apiKey) return null;
  rememberAutoResolvedProfile(profile);
  await activateProvider({
    baseUrl: modelFields.baseUrl,
    apiKey: modelFields.apiKey,
    model: modelFields.model,
    providerKey: modelFields.providerKey,
    profileId: modelFields.providerProfileId || profile.id,
    preserveAuto: true,
  });
  if (!keepPickerOpen) setModelPickerOpen(false);
  return modelFields;
}

function rememberAutoResolvedProfile(profile) {
  if (!profile || !isChatModelAutoMode()) return;
  state.modelSelectionAuto = true;
  state.lastAutoResolvedModel = String(profile.model || "");
  if (typeof AutoModel.bumpUpstreamUsage === "function") {
    state.autoUpstreamUsage = AutoModel.bumpUpstreamUsage(state.autoUpstreamUsage, profile.model);
  } else {
    const bucket = String(profile.model || "").split("/")[0]?.toLowerCase();
    if (bucket === "meai" || bucket === "apicredits") {
      state.autoUpstreamUsage = state.autoUpstreamUsage || { meai: 0, apicredits: 0 };
      state.autoUpstreamUsage[bucket] = Number(state.autoUpstreamUsage[bucket] || 0) + 1;
    }
  }
  if (typeof AutoModel.bumpModelUsage === "function") {
    state.autoModelUsage = AutoModel.bumpModelUsage(state.autoModelUsage, profile.model);
  } else {
    const key = String(profile.model || "").toLowerCase();
    if (key) {
      state.autoModelUsage = state.autoModelUsage || {};
      state.autoModelUsage[key] = Number(state.autoModelUsage[key] || 0) + 1;
    }
  }
  try {
    localStorage.setItem("editcore-auto-upstream-usage", JSON.stringify(state.autoUpstreamUsage));
    localStorage.setItem("editcore-auto-model-usage", JSON.stringify(state.autoModelUsage || {}));
  } catch {}
  updateModelPickerLabel();
  updateStatus();
}

function updateModelPickerLabel() {
  const label = $("modelPickerLabel");
  if (!label) return;
  if (isChatModelAutoMode()) {
    label.textContent = AutoModel.formatAutoLabel(currentAutoProviderScope());
    return;
  }
  const option = $("chatModelSelect")?.selectedOptions?.[0];
  if (!option || AutoModel.isAutoModelSelection(option) || option.dataset?.configure === "1") {
    label.textContent = AutoModel.formatAutoLabel(currentAutoProviderScope());
    return;
  }
  label.textContent = AutoModel.formatChatModelLabel(option.dataset.model || "", option.dataset.providerKey || "") || "Modelo";
}

function positionFloatingMenu(menu, anchor, { align = "right", gap = 8 } = {}) {
  if (!menu || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 320;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  const height = menu.offsetHeight || 280;
  let top = rect.top - height - gap;
  if (top < 12) top = rect.bottom + gap;
  menu.style.position = "fixed";
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.zIndex = "10050";
}

function setPermissionMenuOpen(open, anchorEl = null) {
  const menu = $("permissionMenu");
  const button = $("permissionsBtn");
  if (!menu || !button) return;
  if (open) {
    // En Chat Home el menú debe vivir en body (main está off-screen / sin pointer-events).
    if (document.body.dataset.appMode === "chat") {
      if (!menu.dataset.homeParked) {
        menu.dataset.homeParked = "1";
        menu._editcoreOrigParent = menu.parentElement;
        document.body.appendChild(menu);
      }
    }
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
    syncPermissionMenuSelection(state.permissionMode);
    const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function"
      ? anchorEl
      : button;
    positionFloatingMenu(menu, anchor, { align: "left", gap: 6 });
  } else {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    if (menu.dataset.homeParked === "1" && menu._editcoreOrigParent) {
      menu._editcoreOrigParent.appendChild(menu);
      delete menu.dataset.homeParked;
      menu._editcoreOrigParent = null;
    }
  }
}

function syncPermissionMenuSelection(mode) {
  const selected = ["readonly", "step", "full"].includes(mode) ? mode : "step";
  $("permissionMenu")?.querySelectorAll("[data-permission]").forEach((btn) => {
    const active = btn.dataset.permission === selected;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
  });
}

function applyPermissionMode(mode) {
  const next = ["readonly", "step", "full"].includes(mode) ? mode : "step";
  state.permissionMode = next;
  // Solo lectura bloquea escrituras; Paso a paso y Acceso completo permiten escribir
  // (Paso a paso pide confirmacion por accion en main.js).
  state.allowWrite = next !== "readonly";
  const labels = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" };
  if ($("permissionsBtn")) {
    $("permissionsBtn").textContent = labels[next] || "Permisos";
    $("permissionsBtn").classList.toggle("danger", next === "full");
    $("permissionsBtn").dataset.permissionMode = next;
  }
  syncPermissionMenuSelection(next);
  window.editcoreAgent?.setPermission?.(next).catch(() => undefined);
  const project = activeProject();
  if (project) {
    project.permissionMode = next;
    // Acceso completo: salir de la puerta awaiting_authorization (no pedir PROCEDE).
    if (next === "full" && project.agentWorkflow?.phase === "awaiting_authorization") {
      project.agentWorkflow.phase = "executing";
      project.agentWorkflow.updatedAt = Date.now();
      if (project.durableWorkflow) {
        project.durableWorkflow.awaitingAuthorization = false;
        project.durableWorkflow.state = "EXECUTING";
      }
    }
    saveProjects();
  }
  return next;
}

function setModelPickerOpen(open, anchorEl = null) {
  const menu = $("modelPickerMenu");
  const button = $("modelPickerBtn");
  if (!menu || !button) return;
  if (open) {
    // En Chat Home el menú debe vivir en body (main está off-screen).
    if (document.body.dataset.appMode === "chat") {
      if (!menu.dataset.homeParked) {
        menu.dataset.homeParked = "1";
        menu._editcoreOrigParent = menu.parentElement;
        document.body.appendChild(menu);
      }
    }
    renderModelPickerMenu();
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
    const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function"
      ? anchorEl
      : (document.body.dataset.appMode === "chat" && $("chatHomeModelPill")) || button;
    positionFloatingMenu(menu, anchor, {
      align: document.body.dataset.appMode === "chat" ? "left" : "right",
      gap: 8,
    });
  } else {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    if (menu.dataset.homeParked === "1" && menu._editcoreOrigParent) {
      menu._editcoreOrigParent.appendChild(menu);
      delete menu.dataset.homeParked;
      menu._editcoreOrigParent = null;
    }
  }
}

function renderModelPickerMenu() {
  const menu = $("modelPickerMenu");
  if (!menu) return;
  menu.replaceChildren();
  const config = loadJson("editcore-chat-config", {});
  const autoActive = isChatModelAutoMode();
  const activeAutoScope = currentAutoProviderScope();
  let searchTerm = "";

  const searchWrap = document.createElement("div");
  searchWrap.className = "model-picker-search-wrap";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "model-picker-search";
  searchInput.placeholder = "Buscar modelos";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchWrap.appendChild(searchInput);
  menu.appendChild(searchWrap);

  const autoScopes = [
    { scope: "all", title: "Auto", hint: "ME AI Cloud + APICredits juntos." },
    { scope: "meai", title: "Auto · ME AI", hint: "Solo modelos ME AI Cloud." },
    { scope: "apicredits", title: "Auto · APICredits", hint: "Solo modelos APICredits." },
  ];
  autoScopes.forEach(({ scope, title, hint }) => {
    const autoRow = document.createElement("div");
    autoRow.className = "model-picker-auto-row";
    const autoCopy = document.createElement("div");
    autoCopy.className = "model-picker-auto-copy";
    autoCopy.innerHTML = `<strong>${title}</strong><span>${hint}</span>`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "model-toggle";
    toggle.setAttribute("role", "switch");
    const on = autoActive && AutoModel.normalizeAutoProviderScope(activeAutoScope) === scope;
    toggle.setAttribute("aria-checked", on ? "true" : "false");
    toggle.setAttribute("aria-label", `Activar ${title}`);
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const currentlyOn = isChatModelAutoMode()
        && AutoModel.normalizeAutoProviderScope(currentAutoProviderScope()) === scope;
      if (currentlyOn) {
        setAutoModelEnabled(false).then(() => {
          if (!menu.classList.contains("hidden")) renderModelPickerMenu();
        });
        return;
      }
      setAutoModelEnabled(true, scope).then(() => {
        if (!menu.classList.contains("hidden")) renderModelPickerMenu();
      });
    });
    autoRow.append(autoCopy, toggle);
    menu.appendChild(autoRow);
  });

  const paintModels = () => {
    menu.querySelector(".model-picker-scroll")?.remove();
    menu.querySelector(".model-picker-footer")?.remove();

    const scroll = document.createElement("div");
    scroll.className = "model-picker-scroll";
    const catalog = catalogChatModelOptions();
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = !normalizedSearch
      ? catalog
      : catalog.filter((entry) => {
        const label = entry.providerKey === "custom:gafcore-gateway"
          ? String(entry.model).split("/").slice(1).join("/")
          : entry.model;
        const haystack = `${label} ${entry.providerLabel || ""}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "model-picker-empty";
      empty.textContent = catalog.length
        ? "Ningún modelo coincide con la búsqueda"
        : "Verifica un modelo en Administrar modelos…";
      scroll.appendChild(empty);
    } else {
      let lastGroup = "";
      filtered.forEach((entry) => {
        const groupLabel = entry.providerLabel || entry.providerKey;
        if (groupLabel !== lastGroup) {
          lastGroup = groupLabel;
          const heading = document.createElement("div");
          heading.className = "model-picker-group";
          heading.textContent = groupLabel;
          scroll.appendChild(heading);
        }
        const label = entry.providerKey === "custom:gafcore-gateway"
          ? String(entry.model).split("/").slice(1).join("/")
          : entry.model;
        const active = !autoActive && config.providerProfileId === entry.profileId && config.model === entry.model;
        const row = document.createElement("div");
        row.className = `model-picker-row${active ? " active" : ""}${entry.enabled ? "" : " is-disabled"}`;

        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "model-picker-item";
        pick.setAttribute("role", "option");
        pick.setAttribute("aria-selected", active ? "true" : "false");
        const check = document.createElement("span");
        check.className = "model-picker-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        const name = document.createElement("span");
        name.className = "model-picker-name";
        name.textContent = label;
        pick.append(check, name);
        pick.title = autoActive
          ? "Modelo disponible para Auto cuando está activo"
          : "Usar este modelo";
        pick.addEventListener("click", () => {
          if (!entry.enabled) {
            setChatModelEnabled(entry, true).then(() => selectModelFromPicker({ entry }));
            return;
          }
          if (autoActive) {
            setAutoModelEnabled(false).then(() => selectModelFromPicker({ entry }));
            return;
          }
          selectModelFromPicker({ entry });
        });

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "model-toggle";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", entry.enabled ? "true" : "false");
        toggle.setAttribute("aria-label", `${entry.enabled ? "Desactivar" : "Activar"} ${label}`);
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          setChatModelEnabled(entry, !entry.enabled).then(() => {
            if (!menu.classList.contains("hidden")) renderModelPickerMenu();
          });
        });

        row.append(pick, toggle);
        scroll.appendChild(row);
      });
    }

    menu.appendChild(scroll);
    const footer = document.createElement("div");
    footer.className = "model-picker-footer";
    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "model-picker-manage";
    manageBtn.textContent = "Administrar modelos…";
    manageBtn.addEventListener("click", () => {
      setModelPickerOpen(false);
      openProviders();
    });
    footer.appendChild(manageBtn);
    menu.appendChild(footer);
    positionFloatingMenu(menu, $("modelPickerBtn"), { align: "right", gap: 8 });
  };

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value;
    paintModels();
    searchInput.focus();
  });
  searchInput.addEventListener("click", (event) => event.stopPropagation());
  paintModels();
}

async function setAutoModelEnabled(enabled, scope = "") {
  if (enabled) {
    await selectModelFromPicker({ auto: true, autoScope: scope, keepOpen: true });
    return;
  }
  const config = loadJson("editcore-chat-config", {});
  const options = visibleChatModelOptions(verifiedChatModelOptions());
  if (!options.length) {
    await saveSecureJson("editcore-chat-config", {
      ...config,
      remember: true,
      modelSelectionMode: "manual",
      autoProviderScope: "",
    });
    state.modelSelectionAuto = false;
    state.lastAutoResolvedModel = "";
    updateModelPickerLabel();
    updateStatus();
    return;
  }
  let entry = options.find((item) => item.profileId === config.providerProfileId && item.model === config.model);
  if (!entry || config.modelSelectionMode === "auto") entry = options[0];
  await selectModelFromPicker({ entry, keepOpen: true });
}

async function selectModelFromPicker({ auto = false, autoScope = "", entry, keepOpen = false } = {}) {
  if (!keepOpen) setModelPickerOpen(false);
  const select = $("chatModelSelect");
  if (!select) return;
  if (auto) {
    const value = AutoModel.autoSelectionValue(autoScope);
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      updateModelPickerLabel();
    }
    return;
  }
  const option = [...select.options].find((item) =>
    item.dataset.model === entry.model && item.dataset.profileId === entry.profileId
  );
  if (!option) {
    if (!keepOpen) openProviders();
    return;
  }
  if (select.value !== option.value) {
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    updateModelPickerLabel();
  }
}

function mapProfileToModelOption(profile, customProvidersByKey) {
  return {
    providerKey: profile.providerKey,
    providerLabel: profile.providerKey === "custom:gafcore-gateway"
      ? ({ meai: "ME AI Cloud", apicredits: "APICredits" }[String(profile.model).split("/", 1)[0]] || "Proveedor")
      : (PRIMARY_PROVIDER_KEYS.includes(profile.providerKey)
        ? PROVIDERS[profile.providerKey]?.label
        : customProvidersByKey.get(profile.providerKey)?.name || profile.providerName || profile.providerKey),
    modelProviderGroup: profile.providerKey === "custom:gafcore-gateway" ? String(profile.model).split("/", 1)[0] : profile.providerKey,
    profileId: profile.id,
    model: profile.model,
    profileStatus: profile.status,
    enabled: ["active", "enabled"].includes(profile.status),
  };
}

function catalogChatModelOptions() {
  const customProvidersByKey = new Map(loadCustomProviders().map((provider) => [`custom:${provider.id}`, provider]));
  const profiles = loadProviderProfiles().filter((profile) => profile.model && profile.apiKey);
  return profiles
    .map((profile) => mapProfileToModelOption(profile, customProvidersByKey))
    .sort((a, b) => {
      const gatewayRank = (entry) => entry.providerKey === "custom:gafcore-gateway" ? 0 : 1;
      return gatewayRank(a) - gatewayRank(b)
        || a.providerLabel.localeCompare(b.providerLabel, undefined, { sensitivity: "base" })
        || a.model.localeCompare(b.model, undefined, { sensitivity: "base", numeric: true });
    });
}

async function setChatModelEnabled(entry, enabled) {
  if (!entry?.profileId) return;
  const profiles = loadProviderProfiles();
  const profile = profiles.find((item) => item.id === entry.profileId);
  if (!profile) return;

  if (entry.providerKey === "custom:gafcore-gateway") {
    const providers = loadCustomProviders();
    const gateway = providers.find((item) => item.id === "gafcore-gateway");
    if (!gateway) return;
    const enabledSet = new Set((gateway.enabledModels || gateway.models || []).map((model) => String(model || "").trim()).filter(Boolean));
    if (enabled) enabledSet.add(entry.model);
    else enabledSet.delete(entry.model);
    if (!enabledSet.size) {
      $("status").textContent = "Debes dejar al menos un modelo activo";
      return;
    }
    gateway.enabledModels = [...enabledSet];
    await saveCustomProviders(providers.map((item) => (item.id === gateway.id ? gateway : item)));
    await syncCustomProviderProfiles(gateway);
  } else {
    const enabledCount = profiles.filter((item) => ["active", "enabled"].includes(item.status)).length;
    if (!enabled && enabledCount <= 1) {
      $("status").textContent = "Debes dejar al menos un modelo activo";
      return;
    }
    profile.status = enabled ? "active" : "disabled";
    await saveProviderProfiles(profiles);
  }

  const config = loadJson("editcore-chat-config", {});
  const stillEnabled = visibleChatModelOptions(verifiedChatModelOptions());
  if (!stillEnabled.length) {
    $("status").textContent = "No quedó ningún modelo activo";
    return;
  }
  const activeStillValid = stillEnabled.some((item) => item.profileId === config.providerProfileId && item.model === config.model);
  if (!activeStillValid && config.modelSelectionMode !== "auto") {
    await selectModelFromPicker({ entry: stillEnabled[0], keepOpen: true });
  } else {
    syncChatModelFromConfig();
    if ($("modelPickerMenu") && !$("modelPickerMenu").classList.contains("hidden")) renderModelPickerMenu();
  }
  updateStatus();
}

function verifiedChatModelOptions() {
  const verifiedProfiles = loadProviderProfiles().filter((profile) => ["active", "enabled"].includes(profile.status) && profile.model && profile.apiKey);
  const customProvidersByKey = new Map(loadCustomProviders().map((provider) => [`custom:${provider.id}`, provider]));
  return verifiedProfiles
    .filter((profile) => {
      const isLegacyClaude = /^claude-(?:3-|3\.|3_)/i.test(profile.model);
      if (!isLegacyClaude) return true;
      return !verifiedProfiles.some((candidate) => candidate.providerKey === profile.providerKey
        && /^claude-(?:sonnet|opus|haiku)-4(?:[.-]|$)/i.test(candidate.model));
    })
    .map((profile) => mapProfileToModelOption(profile, customProvidersByKey))
    .sort((a, b) => {
      const gatewayRank = (entry) => entry.providerKey === "custom:gafcore-gateway" ? 0 : 1;
      return gatewayRank(a) - gatewayRank(b)
        || a.providerLabel.localeCompare(b.providerLabel, undefined, { sensitivity: "base" })
        || a.model.localeCompare(b.model, undefined, { sensitivity: "base", numeric: true });
    });
}

async function syncCustomProviderProfiles(provider) {
  const providerKey = `custom:${provider.id}`;
  const selected = new Set((provider.enabledModels || []).map((model) => String(model || "").trim()).filter(Boolean));
  const profiles = loadProviderProfiles();
  const existingByModel = new Map(profiles
    .filter((profile) => profile.providerKey === providerKey && profile.model)
    .map((profile) => [profile.model, profile]));
  for (const model of selected) {
    const current = existingByModel.get(model);
    const next = {
      id: current?.id || `${provider.id}:${model}`,
      providerKey,
      providerName: provider.name || providerKey,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      modelCount: provider.modelCount || normalizedProviderModels(provider).length,
      status: "active",
      catalogConfirmed: true,
      chatVerified: current?.chatVerified === true || current?.status === "active" && current?.checkedAt > 0,
      checkedAt: current?.checkedAt || 0,
      error: current?.error || "",
    };
    const index = profiles.findIndex((profile) => profile.id === next.id);
    if (index >= 0) profiles[index] = { ...profiles[index], ...next };
    else profiles.push(next);
  }
  profiles.forEach((profile) => {
    if (profile.providerKey === providerKey && profile.model && !selected.has(profile.model)) profile.status = "disabled";
  });
  await saveProviderProfiles(profiles);
  return profiles;
}

function visibleChatModelOptions(options) {
  const providers = new Map(loadCustomProviders().map((provider) => [`custom:${provider.id}`, provider]));
  const visible = [];
  const grouped = new Map();
  options.forEach((entry) => {
    if (!grouped.has(entry.providerKey)) grouped.set(entry.providerKey, []);
    grouped.get(entry.providerKey).push(entry);
  });
  grouped.forEach((entries, providerKey) => {
    const provider = providers.get(providerKey);
    const limit = Number(provider?.visibleModelLimit || 0);
    if (!provider || !limit || entries.length <= limit) {
      visible.push(...entries);
      return;
    }
    const order = new Map((provider.enabledModels || []).map((model, index) => [model, index]));
    entries.sort((a, b) => (order.get(a.model) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.model) ?? Number.MAX_SAFE_INTEGER)
      || a.model.localeCompare(b.model, undefined, { sensitivity: "base", numeric: true }));
    visible.push(...entries.slice(0, limit));
  });
  return visible;
}

async function addProviderProfile(key) {
  const profiles = loadProviderProfiles();
  profiles.push({ id: uid(), providerKey: key, apiKey: "", model: "", status: "", models: [] });
  await saveProviderProfiles(profiles); renderProviderProfiles();
}

async function bulkAddProviderProfiles(key) {
  const models = PROVIDER_MODELS[key] || [];
  if (!models.length) return;
  const profiles = loadProviderProfiles();
  const existingApiKey = profiles.find((p) => p.providerKey === key && p.apiKey)?.apiKey || "";
  const existingModels = new Set(profiles.filter((p) => p.providerKey === key).map((p) => p.model));
  const toAdd = models.filter((m) => m && !existingModels.has(m));
  if (!toAdd.length) return;
  toAdd.forEach((m) => profiles.push({ id: uid(), providerKey: key, apiKey: existingApiKey, model: m, status: "", models: [] }));
  await saveProviderProfiles(profiles);
  renderProviderProfiles();
}

async function activateProvider({ baseUrl, apiKey, model, providerKey, profileId, preserveAuto = false }) {
  const resolvedMode = inferChatModeFromModel(model);
  state.mode = resolvedMode;
  $("baseUrl").value = baseUrl || "";
  $("apiKey").value = apiKey || "";
  if (model) {
    const modelSelect = $("model");
    if (![...modelSelect.options].some((option) => option.value === model)) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    }
    modelSelect.value = model;
  }
  await saveSecureJson("editcore-chat-config", {
    remember: true,
    mode: state.mode,
    baseUrl: String(baseUrl || "").trim(),
    apiKey: String(apiKey || "").trim(),
    model: preserveAuto ? String(loadJson("editcore-chat-config", {}).model || model || "").trim() : String(model || "").trim(),
    providerKey: providerKey || providerKeyForEndpoint(baseUrl),
    providerProfileId: preserveAuto ? String(loadJson("editcore-chat-config", {}).providerProfileId || profileId || "").trim() : String(profileId || "").trim(),
    modelSelectionMode: preserveAuto ? "auto" : "manual",
    autoProviderScope: preserveAuto
      ? AutoModel.normalizeAutoProviderScope(loadJson("editcore-chat-config", {}).autoProviderScope)
      : "",
  });
  const project = activeProject();
  if (project) {
    project.model = String(model || "").trim();
    project.provider = providerKey || providerKeyForEndpoint(baseUrl);
    project.providerProfileId = profileId || "";
    project.updatedAt = Date.now();
    saveProjects();
  }
  updateModeButtons();
  if (preserveAuto) {
    state.modelSelectionAuto = true;
    setChatModelOptions([], AutoModel.autoSelectionValue(loadJson("editcore-chat-config", {}).autoProviderScope), "", "");
  } else {
    state.modelSelectionAuto = false;
    state.lastAutoResolvedModel = "";
    setChatModelOptions([], model || "", providerKey || providerKeyForEndpoint(baseUrl), profileId || "");
  }
}

async function migrateLegacyProviderProfiles() {
  const original = loadProviderProfiles();
  const current = original.map((profile) => {
    const { models: _duplicatedCatalog, ...compactProfile } = profile || {};
    return compactProfile;
  });
  const providers = loadJson("editcore-providers", {});
  for (const key of PRIMARY_PROVIDER_KEYS) {
    const provider = providers[key];
    if (!provider?.apiKey || !provider?.model) continue;
    if (current.some((profile) => profile.providerKey === key && profile.apiKey === provider.apiKey && profile.model === provider.model)) continue;
    current.push({ id: uid(), providerKey: key, apiKey: provider.apiKey, model: provider.model, status: provider.status || "", modelCount: provider.modelCount || 0 });
  }
  const legacy = loadCustomProviders();
  for (const profile of legacy) {
    const providerKey = profile.providerKey || providerKeyForEndpoint(profile.baseUrl);
    if (current.some((item) => item.providerKey === providerKey && item.apiKey === profile.apiKey && item.model === profile.model)) continue;
    const { models: _duplicatedCatalog, ...compactProfile } = profile;
    current.push({ ...compactProfile, id: profile.id || uid(), providerKey, status: profile.status || "" });
  }
  if (JSON.stringify(current) !== JSON.stringify(original)) await saveProviderProfiles(current);
}

// ── Custom providers ──────────────────────────────────────────────────────────

function loadCustomProviders() {
  return loadJson("editcore-custom-providers", []);
}

function saveCustomProviders(list) {
  return saveSecureJson("editcore-custom-providers", list);
}

function normalizedProviderModels(provider) {
  return [...new Set((Array.isArray(provider?.models) ? provider.models : [])
    .map((model) => String(model || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function modelRecommendationScore(model) {
  const value = String(model || "").toLowerCase();
  let score = 0;
  if (/(opus|ultra|max|pro|reasoner|thinking|instruct)/.test(value)) score += 30;
  if (/(5(?:[.-]|$)|4\.8|4-8|4\.7|4-7|4\.6|4-6|v4|v3\.6|3\.6|2\.7|2\.6)/.test(value)) score += 25;
  if (/(flash|turbo|mini|small|lite|fast|haiku|free|trial)/.test(value)) score -= 12;
  if (/(vision|image|audio|embedding|moderation|tts|whisper|search)/.test(value)) score -= 18;
  if (/(preview|deprecated|legacy|old|test)/.test(value)) score -= 20;
  return score;
}

function recommendedProviderModels(provider) {
  return normalizedProviderModels(provider)
    .sort((a, b) => modelRecommendationScore(b) - modelRecommendationScore(a)
      || a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
    .slice(0, 16);
}

function renderCustomProviderBlock(prov, container, { readOnlyEndpoint = false } = {}) {
  const provKey = `custom:${prov.id}`;
  const item = document.createElement("details");
  item.className = "prov-item";
  item.open = prov.id !== "gafcore-gateway";

  const summary = document.createElement("summary");
  summary.className = "prov-summary";
  const dot = document.createElement("span");
  dot.className = "prov-dot";
  dot.style.background = prov.id === "gafcore-gateway" ? "#8e6bbf" : "#0ea5a4";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = prov.name || "Endpoint personalizado";
  const stateSpan = document.createElement("span");
  stateSpan.className = `provider-state${prov.status === "active" ? " active" : ""}`;
  stateSpan.dataset.providerState = provKey;
  stateSpan.textContent = prov.status === "active" ? "Funcional" : "Sin verificar";
  summary.append(dot, " ", nameSpan, " ", stateSpan);
  item.appendChild(summary);

  const fields = document.createElement("div");
  fields.className = "prov-fields";

  if (prov.id !== "gafcore-gateway") {
    const nameLbl = document.createElement("label");
    nameLbl.className = "field";
    const nameCap = document.createElement("span");
    nameCap.textContent = "Nombre";
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.value = prov.name || "";
    nameInp.placeholder = "Mi API OpenAI-compatible";
    nameInp.dataset.provName = provKey;
    nameLbl.append(nameCap, nameInp);
    fields.appendChild(nameLbl);
  }

  const urlLbl = document.createElement("label");
  urlLbl.className = "field";
  const urlCap = document.createElement("span");
  urlCap.textContent = "Endpoint";
  const urlInp = document.createElement("input");
  urlInp.type = "text";
  urlInp.value = prov.baseUrl || "";
  urlInp.placeholder = "https://api.example.com/v1";
  urlInp.dataset.provUrl = provKey;
  urlInp.readOnly = readOnlyEndpoint;
  urlLbl.append(urlCap, urlInp);
  fields.appendChild(urlLbl);

  const profilesDiv = document.createElement("div");
  profilesDiv.className = "provider-profiles";
  profilesDiv.dataset.providerProfiles = provKey;
  fields.appendChild(profilesDiv);

  const actions = document.createElement("div");
  actions.className = "provider-profile-actions";
  const addProfile = document.createElement("button");
  addProfile.type = "button";
  addProfile.className = "profile-save";
  addProfile.textContent = "+ Agregar modelo";
  addProfile.onclick = () => addProviderProfile(provKey);
  actions.appendChild(addProfile);
  if (prov.id !== "gafcore-gateway") {
    const removeProvider = document.createElement("button");
    removeProvider.type = "button";
    removeProvider.className = "profile-delete";
    removeProvider.textContent = "Eliminar endpoint";
    removeProvider.onclick = async () => {
      if (!confirm(`Eliminar el endpoint "${prov.name || "personalizado"}" y sus modelos?`)) return;
      await removeCustomProvider(prov.id);
    };
    actions.appendChild(removeProvider);
  }
  fields.appendChild(actions);
  item.appendChild(fields);
  container.appendChild(item);
}

function renderCustomProviders() {
  const container = $("customProvidersList");
  if (!container) return;
  const list = loadCustomProviders();
  container.replaceChildren();

  const hint = document.createElement("p");
  hint.className = "providers-hint";
  hint.textContent = "Selecciona Auto en el chat o fija un modelo. Cada endpoint puede tener varios modelos con su propia API key.";
  container.appendChild(hint);

  const integratedTitle = document.createElement("div");
  integratedTitle.className = "providers-section-title";
  integratedTitle.textContent = "APIs integradas";
  container.appendChild(integratedTitle);

  PRIMARY_PROVIDER_KEYS.forEach((key) => {
    const def = PROVIDERS[key];
    const item = document.createElement("details");
    item.className = "prov-item";
    item.open = ["openai", "anthropic", "gemini"].includes(key);

    const summary = document.createElement("summary");
    summary.className = "prov-summary";
    const dot = document.createElement("span");
    dot.className = "prov-dot";
    dot.style.background = key === "openai" ? "#10a37f" : key === "anthropic" ? "#c15f3c" : key === "gemini" ? "#4285f4" : "#8e6bbf";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = def.label || key;
    const stateSpan = document.createElement("span");
    stateSpan.className = "provider-state";
    stateSpan.dataset.providerState = key;
    stateSpan.textContent = "Sin verificar";
    summary.append(dot, " ", nameSpan, " ", stateSpan);
    item.appendChild(summary);

    const fields = document.createElement("div");
    fields.className = "prov-fields";
    const urlLbl = document.createElement("label"); urlLbl.className = "field";
    const urlCap = document.createElement("span"); urlCap.textContent = "Endpoint";
    const urlInp = document.createElement("input"); urlInp.type = "text"; urlInp.value = def.baseUrl || ""; urlInp.placeholder = "https://api.example.com/v1"; urlInp.dataset.provUrl = key;
    urlLbl.append(urlCap, urlInp); fields.appendChild(urlLbl);
    const keyLbl = document.createElement("label"); keyLbl.className = "field";
    const keyCap = document.createElement("span"); keyCap.textContent = "API key";
    const keyInp = document.createElement("input"); keyInp.type = "password"; keyInp.placeholder = "Clave del proveedor"; keyInp.dataset.provKey = key;
    keyLbl.append(keyCap, keyInp); fields.appendChild(keyLbl);
    const modelLbl = document.createElement("label"); modelLbl.className = "field";
    const modelCap = document.createElement("span"); modelCap.textContent = "Modelo";
    const modelInp = document.createElement("input"); modelInp.type = "text"; modelInp.value = def.model || ""; modelInp.placeholder = "modelo"; modelInp.dataset.provModel = key;
    modelLbl.append(modelCap, modelInp); fields.appendChild(modelLbl);
    const actions = document.createElement("div");
    actions.className = "provider-profile-actions";
    const verify = document.createElement("button");
    verify.type = "button";
    verify.className = "profile-verify";
    verify.dataset.provActivate = key;
    verify.textContent = "Verificar y activar";
    actions.appendChild(verify);
    fields.appendChild(actions);
    const profilesDiv = document.createElement("div");
    profilesDiv.className = "provider-profiles";
    profilesDiv.dataset.providerProfiles = key;
    fields.appendChild(profilesDiv);
    const addProfile = document.createElement("button");
    addProfile.type = "button";
    addProfile.className = "profile-save";
    addProfile.textContent = "+ Agregar modelo";
    addProfile.onclick = () => addProviderProfile(key);
    fields.appendChild(addProfile);
    item.appendChild(fields);
    container.appendChild(item);
  });

  const gafcore = null; // Gateway eliminado del panel Modelos (solo ME AI / APICredits).
  const userCustom = list.filter((provider) => {
    const id = String(provider?.id || "").toLowerCase();
    const url = String(provider?.baseUrl || "").toLowerCase();
    const name = String(provider?.name || "").toLowerCase();
    return id !== "gafcore-gateway" && !url.includes("gafcore-gateway") && !name.includes("gafcore");
  });
  if (userCustom.length) {
    const customTitle = document.createElement("div");
    customTitle.className = "providers-section-title";
    customTitle.textContent = "Tus endpoints";
    container.appendChild(customTitle);
  }

  userCustom.forEach((prov) => {
    renderCustomProviderBlock(prov, container, { readOnlyEndpoint: false });
  });

  renderProviderProfiles();
  container.dataset.providerRendered = "1";
}

function addCustomProvider() {
  const list = loadCustomProviders();
  list.push({
    id: uid(),
    name: "Endpoint personalizado",
    baseUrl: "",
    apiKey: "",
    model: "",
    status: "",
  });
  saveCustomProviders(list);
  renderCustomProviders();
  const container = $("customProvidersList");
  const last = container?.querySelector(".prov-item:last-of-type");
  if (last) {
    last.open = true;
    last.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function removeCustomProvider(id) {
  if (!id || id === "gafcore-gateway") return;
  const provKey = `custom:${id}`;
  await saveCustomProviders(loadCustomProviders().filter((provider) => provider.id !== id));
  await saveProviderProfiles(loadProviderProfiles().filter((profile) => profile.providerKey !== provKey));
  renderCustomProviders();
  syncChatModelFromConfig();
}

async function addGafCoreGateway() {
  // No reintroducir Gateway en Modelos. Solo proveedores directos ME AI / APICredits.
  const list = loadCustomProviders().filter((provider) => {
    const id = String(provider?.id || "").toLowerCase();
    const url = String(provider?.baseUrl || "").toLowerCase();
    return id !== "gafcore-gateway" && !url.includes("gafcore-gateway");
  });
  await saveCustomProviders(list);
  const profiles = loadProviderProfiles().filter((profile) => {
    const key = String(profile?.providerKey || "");
    const url = String(profile?.baseUrl || "").toLowerCase();
    return key !== "custom:gafcore-gateway" && !url.includes("gafcore-gateway");
  });
  await saveProviderProfiles(profiles);
  renderCustomProviders();
}

// ── Savings / status ──────────────────────────────────────────────────────────

function updateSavings() {
  const metrics = state.metrics;
  const total = Math.round(metrics.confirmedUsedTokens);
  const real = total.toLocaleString("es-MX");
  const providerCache = Math.round(metrics.providerCacheReadTokens).toLocaleString("es-MX");
  const localCache = Math.round(metrics.localSavedConfirmedTokens).toLocaleString("es-MX");
  const estimated = Math.round(metrics.estimatedTokens + metrics.localSavedEstimatedTokens).toLocaleString("es-MX");
  const calls = Math.round(metrics.externalCallsAvoided).toLocaleString("es-MX");
  const providerRate = total ? Math.min(100, (metrics.providerCacheReadTokens / total) * 100) : 0;
  const responseStats = state.cacheStats.responses || {};
  const toolStats = state.cacheStats.tools || {};
  const net = Math.max(0, total - Number(metrics.providerCacheReadTokens || 0)).toLocaleString("es-MX");
  const element = $("savingsStatus");
  element.textContent = `Uso ${real} · neto ${net} · prov ${providerRate.toFixed(1)}% · resp ${responseStats.hits || 0}/${responseStats.requests || 0} · tools ${toolStats.hits || 0}/${toolStats.requests || 0}`;
  const modelRows = Object.entries(metrics.byModel || {}).map(([key, row]) => `${key}: entrada ${Math.round(row.input || 0)}, salida ${Math.round(row.output || 0)}, cache ${Math.round(row.cacheRead || 0)}, llamadas ${Math.round(row.calls || 0)}`).join("\n");
  element.title = `Entrada confirmada desde esta version: ${Math.round(metrics.confirmedInputTokens).toLocaleString("es-MX")}. Salida confirmada: ${Math.round(metrics.confirmedOutputTokens).toLocaleString("es-MX")}. Uso confirmado acumulado: ${real}. Cache leido del proveedor: ${providerCache}. Consumo no cacheado aproximado: ${net}. Ahorro local confirmado: ${localCache}; estimado separado: ${estimated}. Llamadas evitadas: ${calls}. Harness: solo servicios conectados, no chat.${modelRows ? `\n\nPor modelo:\n${modelRows}` : ""}`;
}

async function refreshCacheStats() {
  if (!window.editcoreMetrics?.cacheStats) return;
  state.cacheStats = await window.editcoreMetrics.cacheStats().catch(() => state.cacheStats);
  updateSavings();
}

function recordUsage(usage) {
  const confirmedInput = Number(usage?.confirmed_input_tokens || 0);
  const confirmedOutput = Number(usage?.confirmed_output_tokens || 0);
  state.metrics.confirmedInputTokens += confirmedInput;
  state.metrics.confirmedOutputTokens += confirmedOutput;
  state.metrics.confirmedUsedTokens += confirmedInput + confirmedOutput;
  state.metrics.providerCacheReadTokens += Number(usage?.provider_cache_read_tokens || 0);
  state.metrics.localSavedConfirmedTokens += Number(usage?.local_cache_saved_confirmed_tokens || 0);
  state.metrics.localSavedEstimatedTokens += Number(usage?.local_cache_saved_estimated_tokens || 0);
  state.metrics.estimatedTokens += Number(usage?.estimated_input_tokens || 0) + Number(usage?.estimated_output_tokens || 0);
  state.metrics.localCacheHits += Number(usage?.local_cache_hits || (usage?.local_cache_hit ? 1 : 0));
  state.metrics.externalCallsAvoided += Number(usage?.external_calls_avoided || (usage?.local_cache_hit ? 1 : 0));
  const model = String(usage?.model || "").trim();
  if (model) {
    const provider = String(usage?.provider_host || "provider").trim();
    const key = `${provider}/${model}`;
    const row = state.metrics.byModel[key] || { input: 0, output: 0, cacheRead: 0, estimatedInput: 0, calls: 0, localSaved: 0 };
    row.input += confirmedInput;
    row.output += confirmedOutput;
    row.cacheRead += Number(usage?.provider_cache_read_tokens || 0);
    row.estimatedInput += Number(usage?.request_input_tokens_estimate || usage?.estimated_input_tokens || 0);
    row.calls += Number(usage?.provider_calls || 0);
    row.localSaved += Number(usage?.local_cache_saved_confirmed_tokens || usage?.local_cache_saved_estimated_tokens || 0);
    state.metrics.byModel[key] = row;
  }
  saveMetrics();
  updateSavings();
  reportInspectorTelemetry();
  refreshCacheStats().catch(() => undefined);
}

function usageMetaText(usage) {
  const confirmedInput = Number(usage?.confirmed_input_tokens || usage?.prompt_tokens || usage?.input_tokens || 0);
  const confirmedOutput = Number(usage?.confirmed_output_tokens || usage?.completion_tokens || usage?.output_tokens || 0);
  const estimatedInput = Number(usage?.estimated_input_tokens || 0);
  const estimatedOutput = Number(usage?.estimated_output_tokens || 0);
  const localConfirmed = Number(usage?.local_cache_saved_confirmed_tokens || 0);
  const localEstimated = Number(usage?.local_cache_saved_estimated_tokens || 0);
  const modelLabel = String(usage?.model || "").split("/").pop() || "";
  const modelBit = modelLabel ? ` · ${modelLabel}` : "";
  if (usage?.local_response) return "";
  if (usage?.local_cache_hit) {
    const saved = localConfirmed || localEstimated;
    return `cache local · ${saved} tokens evitados${localConfirmed ? " confirmados" : " estimados"}${modelBit}`;
  }
  if (confirmedInput || confirmedOutput) {
    const providerCache = Number(usage?.provider_cache_read_tokens || usage?.cached_input_tokens || 0);
    const netInput = Math.max(0, confirmedInput - providerCache);
    const calls = Number(usage?.provider_calls || 0);
    const peak = Number(usage?.peak_request_input_tokens_estimate || 0);
    const compacted = Number(usage?.context_compaction_count || 0);
    const total = Number(usage?.total_tokens || 0) || (confirmedInput + confirmedOutput);
    return `↑${confirmedInput} ↓${confirmedOutput} tokens · cache proveedor ${providerCache} · entrada neta aprox. ${netInput} · total ${total}${calls ? ` · ${calls} llamada(s)` : ""}${peak ? ` · pico contexto est. ${peak}` : ""}${compacted ? ` · contexto compactado ${compacted} vez/veces` : ""}${modelBit}`;
  }
  if (estimatedInput || estimatedOutput) {
    return `est. ↑${estimatedInput} ↓${estimatedOutput} tokens · medicion local${modelBit}`;
  }
  return "";
}

function activeProject() {
  return state.projects.find((p) => p.id === state.activeProjectId) || null;
}

function updateAgentCount() {
  const option = $("runMode")?.querySelector('option[value="agent"]');
  if (option) option.textContent = "Agente";
  if ($("runMode")) $("runMode").title = "Selecciona Chat o Agente. La coordinacion de agentes es interna.";
}

function ensureProjectAgent(project) {
  if (!project || typeof project !== "object") return project;
  if (!Array.isArray(project.agents) || !project.agents.length) {
    project.agents = [{
      id: uid(),
      name: "Agente principal",
      projectId: project.id,
      status: "idle",
      provider: project.mode || state.mode,
      model: project.model || PROVIDERS[project.mode || state.mode]?.model || "",
      permissionMode: project.permissionMode || state.permissionMode,
      messages: [],
      updatedAt: Date.now(),
    }];
  }
  if (!project.activeAgentId || !project.agents.some((agent) => agent.id === project.activeAgentId)) {
    project.activeAgentId = project.agents[0].id;
  }
  ensureProjectChats(project);
  return project;
}

function ensureProjectChats(project) {
  if (!project || typeof project !== "object") return project;
  if (!Array.isArray(project.chats) || !project.chats.length) {
    project.chats = [{
      id: uid(),
      title: project.title && project.title !== "Nuevo chat" ? project.title : "Chat 1",
      messages: Array.isArray(project.messages) ? [...project.messages] : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
  }
  if (!project.activeChatId || !project.chats.some((chat) => chat.id === project.activeChatId)) {
    project.activeChatId = project.chats[0].id;
  }
  const active = project.chats.find((chat) => chat.id === project.activeChatId) || project.chats[0];
  project.messages = active.messages;
  return project;
}

function activeChat(project = activeProject()) {
  if (!project) return null;
  ensureProjectChats(project);
  return project.chats.find((chat) => chat.id === project.activeChatId) || project.chats[0] || null;
}

function renderChatTabs() {
  const tabs = $("chatTabs");
  const bar = $("chatTabsBar");
  if (!tabs) return;
  const project = activeProject();
  ensureProjectChats(project || ensureProject());
  const p = activeProject();
  const chats = Array.isArray(p?.chats) ? p.chats : [];
  tabs.replaceChildren();
  if (bar) bar.hidden = false;
  for (const chat of chats) {
    const tab = document.createElement("div");
    tab.className = `chat-tab${chat.id === p.activeChatId ? " is-active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", chat.id === p.activeChatId ? "true" : "false");
    tab.dataset.chatId = chat.id;
    tab.title = String(chat.title || "Chat");

    const title = document.createElement("span");
    title.className = "chat-tab-title";
    title.textContent = String(chat.title || "Chat").slice(0, 28);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "chat-tab-close";
    close.title = "Cerrar chat";
    close.setAttribute("aria-label", `Cerrar ${chat.title || "chat"}`);
    close.textContent = "×";

    tab.addEventListener("click", (event) => {
      if (event.target === close || close.contains(event.target)) return;
      switchChatThread(chat.id);
    });
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeChatThread(chat.id);
    });

    tab.append(title, close);
    tabs.appendChild(tab);
  }
}

function renderChatThreadSelect() {
  // Compat: el select se elimino; las pestanas son la UI.
  renderChatTabs();
}

function createNewChatThread() {
  const project = ensureProject();
  ensureProjectChats(project);
  const chat = {
    id: uid(),
    title: `Chat ${project.chats.length + 1}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  project.chats.unshift(chat);
  project.activeChatId = chat.id;
  project.messages = chat.messages;
  project.updatedAt = Date.now();
  state.history = [];
  state.attachments = [];
  saveProjects();
  renderProjects();
  renderChatTabs();
  $("feed").replaceChildren();
  if (document.body.dataset.appMode !== "chat") {
    append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
  }
  renderAttachments();
  renderPromptQueue();
  scrollFeedToBottom();
  refreshUndoAgentRunButton();
  $("status").textContent = "Nuevo chat";
  try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { activeChatId: chat.id, projectId: project.id } })); } catch {}
  return chat;
}

async function switchChatThread(chatId, targetProjectId = "") {
  let project = activeProject() || ensureProject();
  ensureProjectChats(project);
  let chat = project.chats.find((item) => item.id === String(chatId || ""));
  if (!chat) {
    const foundProject = (state.projects || []).find((p) => {
      ensureProjectChats(p);
      return (p.chats || []).some((item) => item.id === String(chatId || ""));
    });
    if (foundProject && foundProject.id !== state.activeProjectId) {
      if (foundProject.projectRoot) {
        await selectProject(foundProject.id, { render: false, preview: false }).catch(() => undefined);
      } else {
        state.activeProjectId = foundProject.id;
      }
      project = activeProject() || foundProject;
      ensureProjectChats(project);
      chat = project.chats.find((item) => item.id === String(chatId || ""));
    }
  }
  if (!chat) return;
  project.activeChatId = chat.id;
  project.messages = chat.messages;
  state.history = [...(chat.messages || [])];
  state.attachments = [];
  saveProjects();
  renderChatTabs();
  $("feed").replaceChildren();
  if (!state.history.length) {
    if (document.body.dataset.appMode !== "chat") {
      append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
    }
  } else {
    for (const message of state.history) {
      append(message.role, message.content, message.usage, false, null, message.images || [], message.documents || []);
    }
  }
  renderAttachments();
  scrollFeedToBottom(true);
  $("status").textContent = `Chat: ${chat.title || "sin titulo"}`;
  try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { activeChatId: chat.id, projectId: project.id } })); } catch {}
}

function renameChatThread(chatId, newTitle) {
  const clean = String(newTitle || "").trim();
  if (!clean) return;
  for (const p of (state.projects || [])) {
    ensureProjectChats(p);
    const chat = (p.chats || []).find((c) => c.id === String(chatId || ""));
    if (chat) {
      chat.title = clean;
      chat.updatedAt = Date.now();
      saveProjects();
      renderChatTabs();
      try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { activeChatId: p.activeChatId, projectId: p.id } })); } catch {}
      return;
    }
  }
}

function closeChatThread(chatId, targetProjectId) {
  const id = String(chatId || "");
  if (!id) return;

  let targetProj = null;
  if (targetProjectId) {
    targetProj = (state.projects || []).find((p) => p.id === targetProjectId);
  }
  if (!targetProj) {
    targetProj = (state.projects || []).find((p) => (p.chats || []).some((c) => c.id === id)) || ensureProject();
  }
  ensureProjectChats(targetProj);
  const index = (targetProj.chats || []).findIndex((chat) => chat.id === id);
  if (index < 0) return;

  const isCurrentProject = targetProj.id === state.activeProjectId;
  const wasActive = targetProj.activeChatId === id;
  targetProj.chats.splice(index, 1);

  if (!targetProj.chats.length) {
    const fresh = {
      id: uid(),
      title: "Chat 1",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    targetProj.chats = [fresh];
    targetProj.activeChatId = fresh.id;
    if (isCurrentProject) {
      targetProj.messages = fresh.messages;
      state.history = [];
      state.attachments = [];
      $("feed").replaceChildren();
      if (document.body.dataset.appMode !== "chat") {
        append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
      }
      renderAttachments();
      scrollFeedToBottom();
      refreshUndoAgentRunButton();
    }
    targetProj.updatedAt = Date.now();
    saveProjects({ immediate: true });
    persistProjectChatsToDisk(targetProj);
    renderProjects();
    renderChatTabs();
    $("status").textContent = "Chat cerrado";
    try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { activeChatId: fresh.id, projectId: targetProj.id } })); } catch {}
    return;
  }

  if (wasActive) {
    const next = targetProj.chats[Math.min(index, targetProj.chats.length - 1)];
    targetProj.activeChatId = next.id;
    if (isCurrentProject) {
      targetProj.messages = next.messages;
      state.history = [...(next.messages || [])];
      $("feed").replaceChildren();
      if (!state.history.length) {
        if (document.body.dataset.appMode !== "chat") {
          append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
        }
      } else {
        for (const message of state.history) {
          append(message.role, message.content, message.usage, false, null, message.images || [], message.documents || []);
        }
      }
      renderAttachments();
      scrollFeedToBottom(true);
    }
  } else if (isCurrentProject) {
    const active = targetProj.chats.find((chat) => chat.id === targetProj.activeChatId) || targetProj.chats[0];
    targetProj.activeChatId = active.id;
    targetProj.messages = active.messages;
  }

  targetProj.updatedAt = Date.now();
  if (isCurrentProject) state.attachments = [];
  saveProjects({ immediate: true });
  persistProjectChatsToDisk(targetProj);
  renderProjects();
  renderChatTabs();
  $("status").textContent = "Chat cerrado";
  try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { activeChatId: targetProj.activeChatId, projectId: targetProj.id } })); } catch {}
}

function isAgentAuthorization(value) {
  return ProjectAnalysis.isAuthorization(value);
}

function classifyPromptIntent(value) {
  return ProjectAnalysis.classifyPromptIntent(value, Boolean(activeProject()?.analysisMemory));
}

function cleanHistoricalProjectMessages(messages = []) {
  return messages.filter((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return false;
    const content = String(message.content || "");
    return !/<(?:tool_call|tool_use|tool_invocation)\b|\btool_calls?\b/i.test(content);
  });
}

function hasResumableAgentTask(project) {
  const durable = project?.durableWorkflow || {};
  if (durable.awaitingAuthorization && durable.taskId) return true;
  const workflow = project?.agentWorkflow || {};
  // interrupted/executing siguen vivos aunque durable diga COMPLETED (cierre prematuro).
  if (Boolean(workflow.task?.trim()) && ["awaiting_authorization", "interrupted", "executing"].includes(workflow.phase)) {
    return true;
  }
  // completed prematuro: aún hay tarea + narración/resultado → CONTINUA debe reanudar.
  if (Boolean(workflow.task?.trim()) && workflow.phase === "completed") {
    const leftover = String(workflow.lastNarration || workflow.result || workflow.error || "").trim();
    if (leftover.length > 20 || Array.isArray(workflow.resumeSteps) && workflow.resumeSteps.length) {
      return true;
    }
  }
  if (workflow.taskId && ["interrupted", "executing", "awaiting_authorization"].includes(workflow.phase)) {
    return true;
  }
  if (workflow.taskId && durable.taskId === workflow.taskId && [
    "AWAITING_AUTHORIZATION", "RECOVERABLE", "RECOVERING", "PAUSED", "WAITING", "COMPLETED", "FAILED",
  ].includes(String(durable.state || ""))) {
    if (durable.state === "COMPLETED" || durable.state === "FAILED") {
      // COMPLETED prematuro: sigue reanudable si hay plan/pendiente o fase no final.
      const pendingPlan = String(workflow.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
      if (pendingPlan || workflow.phase === "interrupted" || durable.resumeRequired) return true;
      if (String(workflow.task || "").trim().length > 15) return true;
    } else {
      return true;
    }
  }
  if (workflow.taskId && durable.taskId === workflow.taskId && durable.state === "AWAITING_AUTHORIZATION") {
    return true;
  }
  const pendingPlan = String(workflow.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
  if (/Verificacion completada con evidencia real/i.test(pendingPlan)) return false;
  return ProjectAnalysis.isAnalysisReport(pendingPlan) || ProjectAnalysis.isPendingAnalysisPlan(pendingPlan);
}

function isPlanAuthorizedExecution(project, prompt, isAgent) {
  if (!isAgent) return false;
  const text = String(prompt || "").trim();
  // CONTINUA solo reanuda analisis/checkpoint. NO autoriza correcciones.
  // PROCEDE / ADELANTE / AUTORIZO, "continua con correcciones", o pedidos explícitos de CORREGIR/ARREGLAR.
  const strictProceed = /^\s*(?:procede|adelante|autorizo)\b/i.test(text);
  // Acceso completo: PROCEDE/ADELANTE autoriza siempre (sin depender de fase awaiting).
  if (strictProceed && state.permissionMode === "full") return true;
  const continuaWithFixes = /^\s*contin[uú]a\b/i.test(text)
    && /\b(correcciones?|cambios?|el plan|la propuesta|implementaci[oó]n|arregla|corrige|corrije|crear?|construir)\b/i.test(text);
  // Usuario pide corregir directamente (con o sin plan previo): "corrije A", "corrige el error", "arregla X"
  const directFixOrder = /^\s*(?:corrije|corrige|arregla|arregla[rn]?|implementa|aplica|haz|realiza)\b/i.test(text)
    && /\b(opci[oó]n\s*[a-d]|correcciones?|errores?|bugs?|el plan|la propuesta|validaci[oó]n|timeout|timeouts|entorno|env|todo el plan|complet[oa]|consecutiv)\b/i.test(text);
  const directFixShort = /^\s*(?:corrije|corrige|arregla|implementa|aplica)\b.{0,200}$/i.test(text)
    && !/\b(analiza|audita|diagnostica|revisa|explora|reporte|solo lectura)\b/i.test(text);
  if (!strictProceed && !continuaWithFixes && !directFixOrder && !directFixShort) return false;
  const durable = project?.durableWorkflow || {};
  if (durable.awaitingAuthorization && durable.taskId) return true;
  if (/\b(?:crear?|construir|implementar?|scaffold|armar|montar)\b/i.test(text)) return true;
  if (!hasResumableAgentTask(project)) return false;
  const phase = project?.agentWorkflow?.phase || "";
  if (phase === "awaiting_authorization") return true;
  if (phase === "interrupted" && ProjectAnalysis.isAnalysisReport(project?.agentWorkflow?.plan || "")) return true;
  if (durable.state === "AWAITING_AUTHORIZATION" && durable.taskId) return true;
  const pendingPlan = String(project?.agentWorkflow?.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
  if (/Verificacion completada con evidencia real/i.test(pendingPlan)) return false;
  return ProjectAnalysis.isAnalysisReport(pendingPlan) || ProjectAnalysis.isPendingAnalysisPlan(pendingPlan);
}

function isFullAccessMode(job = {}) {
  return (job.permissionMode || state.permissionMode) === "full";
}

function allowsImmediateAgentExecution(job, project, prompt, isAgent, flags = {}) {
  if (!isAgent || job.directReadOnly) return false;
  if (isFullAccessMode(job)) return true;
  if (flags.continueAuthorized || flags.authorizedContinuation || flags.planAuthorizedExecution) return true;
  if (hasResumableAgentTask(project)) return true;
  if (ProjectAnalysis.isGreenfieldCreateRequest(prompt)) return true;
  if (ProjectAnalysis.isGreenfieldContinuationRequest(prompt, { scaffoldIncomplete: Boolean(project?.scaffoldIncomplete) })) return true;
  if (job.orchestratorPlan?.greenfieldCreate) return true;
  if (ProjectAnalysis.isChangeRequest(prompt)) return true;
  if (/^\s*(?:procede|adelante|autorizo)\b/i.test(String(prompt || "").trim())) return true;
  return false;
}

function findPendingAnalysisPlan(project) {
  const workflowPlan = String(project?.agentWorkflow?.plan || "").trim();
  if (ProjectAnalysis.isAnalysisReport(workflowPlan) || ProjectAnalysis.isPendingAnalysisPlan(workflowPlan)) {
    return { plan: workflowPlan, task: project?.agentWorkflow?.task || project?.analysisMemory?.request || "" };
  }
  const memoryPlan = String(project?.analysisMemory?.resultSummary || "").trim();
  if (ProjectAnalysis.isAnalysisReport(memoryPlan) || ProjectAnalysis.isPendingAnalysisPlan(memoryPlan)) {
    return { plan: memoryPlan, task: project?.analysisMemory?.request || project?.agentWorkflow?.task || "" };
  }
  const messages = [...(project?.messages || []), ...(state.history || [])];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const content = String(message.content || "").trim();
    if (ProjectAnalysis.isAnalysisReport(content) || ProjectAnalysis.isPendingAnalysisPlan(content)) {
      return { plan: content, task: project?.analysisMemory?.request || project?.agentWorkflow?.task || "" };
    }
  }
  return null;
}

async function syncDurableWorkflow(project) {
  if (!project?.agentWorkflow?.taskId || !window.editcoreTasks?.describeWorkflow) return null;
  const durable = await window.editcoreTasks.describeWorkflow(project.agentWorkflow.taskId).catch(() => null);
  if (!durable) return null;
  project.durableWorkflow = durable;
  if (durable.awaitingAuthorization) {
    project.agentWorkflow = {
      ...(project.agentWorkflow || {}),
      taskId: durable.taskId,
      phase: "awaiting_authorization",
      task: durable.goal || project.agentWorkflow?.task || "",
      plan: durable.planContent || project.agentWorkflow?.plan || "",
      planId: durable.planId || project.agentWorkflow?.planId || "",
      fixQueue: Array.isArray(durable.fixQueue) ? durable.fixQueue : (project.agentWorkflow?.fixQueue || []),
      approvalId: durable.approvalId || "",
      updatedAt: Date.now(),
    };
  }
  return durable;
}

async function ensureWorkflowFromPendingPlan(project, prompt) {
  if (!project || !isAgentAuthorization(prompt)) return false;
  await syncDurableWorkflow(project);
  if (project.durableWorkflow?.awaitingAuthorization) return true;
  if (project.agentWorkflow?.phase === "awaiting_authorization" && project.agentWorkflow?.taskId && project.agentWorkflow?.planId) {
    return true;
  }
  const pending = findPendingAnalysisPlan(project);
  if (!pending?.plan) return false;
  markWorkflowAwaitingAuthorization(project, {
    taskId: project.agentWorkflow?.taskId || project.durableWorkflow?.taskId || "",
    task: pending.task || "Aplicar correcciones del analisis autorizado",
    plan: pending.plan,
    fixQueue: project.agentWorkflow?.fixQueue || project.durableWorkflow?.fixQueue || [],
  });
  if (window.editcoreTasks?.persistPlan) {
    try {
      const persisted = await window.editcoreTasks.persistPlan({
        taskId: project.agentWorkflow?.taskId || "",
        projectId: project.id || "",
        projectRoot: project.root || project.path || "",
        goal: project.agentWorkflow?.task || pending.task || "Analisis autorizado",
        content: pending.plan,
        fixQueue: project.agentWorkflow?.fixQueue || [],
      });
      if (persisted?.taskId) project.agentWorkflow.taskId = persisted.taskId;
      if (persisted?.planId) project.agentWorkflow.planId = persisted.planId;
      if (Array.isArray(persisted?.plan?.fixQueue)) project.agentWorkflow.fixQueue = persisted.plan.fixQueue;
      if (persisted?.workflow) project.durableWorkflow = persisted.workflow;
    } catch (error) {
      console.warn("persistPlan fallo:", error?.message || error);
    }
  }
  saveProjects();
  return true;
}

function markWorkflowAwaitingAuthorization(project, { taskId, task, plan, planId = "", images = [], documents = [], fixQueue = null } = {}) {
  if (!project) return;
  let reportText = String(plan || "").trim();
  if (!ProjectAnalysis.isAnalysisReport(reportText) && !ProjectAnalysis.isPendingAnalysisPlan(reportText)) return;
  if (!ProjectAnalysis.isAnalysisReport(reportText)) reportText = ProjectAnalysis.normalizeAnalysisReport(reportText);
  let queue = Array.isArray(fixQueue) ? fixQueue : (project.agentWorkflow?.fixQueue || []);
  if (!queue.length) {
    try {
      const paths = reportText.match(/\b(?:src|app|api|lib|components|pages|runtime)(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,10}\b/gi) || [];
      queue = [...new Set(paths)].slice(0, 12).map((target, index) => ({
        id: `fix-${index + 1}`,
        index: index + 1,
        target,
        action: `Corregir ${target}`,
        evidence: "report",
        status: "pending",
      }));
    } catch {
      queue = [];
    }
  }
  project.agentWorkflow = {
    ...(project.agentWorkflow || {}),
    taskId: taskId || project.agentWorkflow?.taskId || "",
    planId: planId || project.agentWorkflow?.planId || "",
    phase: "awaiting_authorization",
    task: String(task || project.agentWorkflow?.task || "").trim(),
    plan: ProjectAnalysis.redactCredentials(reportText),
    fixQueue: queue,
    images: images.length ? images : (project.agentWorkflow?.images || []),
    documents: documents.length ? documents : (project.agentWorkflow?.documents || []),
    error: "",
    updatedAt: Date.now(),
    createdAt: project.agentWorkflow?.createdAt || Date.now(),
  };
}

function isAgentStatusQuestion(value) {
  return /^\s*(qu[e\u00e9] pas[o\u00f3]|qu[e\u00e9] pasa|por qu[e\u00e9] no (?:termina|contesta|responde)|estado(?: de la tarea)?|sigues (?:trabajando|ah[i\u00ed]))[.!? ]*$/i.test(String(value || ""));
}

function agentWorkflowStatusText(workflow) {
  const checkpoints = Array.isArray(workflow?.checkpoints) ? workflow.checkpoints.filter((item) => item?.ok !== false) : [];
  const changedFiles = new Set(checkpoints.flatMap((item) => Array.isArray(item.changedFiles) ? item.changedFiles : []));
  const task = String(workflow?.task || "").trim();
  if (workflow?.phase === "executing") {
    return `El agente sigue ejecutando la tarea: ${task}\n\nProgreso verificado: ${checkpoints.length} accion(es), ${changedFiles.size} archivo(s) modificado(s).`;
  }
  if (workflow?.phase === "interrupted") {
    const error = String(workflow.error || "La ejecucion se interrumpio antes de terminar.").trim();
    return `La tarea quedo interrumpida, no se marco como completada.\n\nTarea conservada: ${task}\nProgreso verificado: ${checkpoints.length} accion(es), ${changedFiles.size} archivo(s) modificado(s).\nUltimo error: ${error}\n\nEscribe CONTINUA o PROCEDE para reanudar desde este punto.`;
  }
  return `La tarea esta lista. Con Acceso completo se aplican correcciones sin pedir PROCEDE; si el modo es paso a paso, escribe **procede**, **autorizo** o **continua**.\n\nTarea: ${task}`;
}

async function durableAgentWorkflowStatusText(project) {
  const workflow = project?.agentWorkflow || {};
  const durable = workflow.taskId && window.editcoreTasks
    ? await window.editcoreTasks.status(workflow.taskId).catch(() => null)
    : null;
  const stage = durable?.currentStage || workflow.currentStage || workflow.phase || "sin etapa";
  const next = durable?.nextAction?.description || workflow.nextAction?.description || "Continuar desde el ultimo estado guardado.";
  const checkpoint = durable?.lastCheckpoint;
  const completed = Number(checkpoint?.completedSteps?.length || workflow.checkpoints?.filter((item) => item?.ok !== false).length || 0);
  const stateName = String(durable?.state || workflow.phase || "sin tarea");
  const error = String(durable?.taskGoal ? workflow.error || "" : workflow.error || durable?.recoveryReason || "").trim();
  const task = String(workflow.task || durable?.taskGoal || "").trim();
  const awaiting = /AWAITING_AUTHORIZATION|awaiting_authorization|PLAN_READY/i.test(stateName) || workflow.phase === "awaiting_authorization";
  if (awaiting) {
    return [
      "El analisis ya termino y el plan esta listo.",
      task ? `Tarea: ${task}` : "",
      "Para aplicar las correcciones escribe **procede**, **autorizo** o **continua**.",
      completed ? `Progreso ya verificado: ${completed} accion(es).` : "",
      error ? `Ultimo bloqueo: ${error}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    `Estado: ${stateName}.`,
    `Etapa: ${stage}.`,
    completed ? `Acciones guardadas: ${completed}.` : "",
    `Siguiente: ${next}`,
    error ? `Ultimo bloqueo: ${error}` : "",
  ].filter(Boolean).join("\n");
}

async function answerAgentWorkflowQuestion(project, question) {
  const workflow = project?.agentWorkflow || {};
  const memory = project?.analysisMemory || null;
  const context = ProjectAnalysis.workflowQuestionContext(workflow, memory);
  // Sin plantillas CONTINUA/PROCEDE ni historias inventadas de .editcore.
  const { baseUrl, apiKey, model, providerKey } = (() => {
    const selectedProfile = resolveActiveChatProfile({
      prompt: question,
      isAgent: false,
      usesProjectTools: false,
    });
    const selectedProviderKey = selectedProfile?.providerKey || loadJson("editcore-chat-config", {}).providerKey || "";
    const providerData = loadJson("editcore-providers", {})[selectedProviderKey] || {};
    return {
      baseUrl: selectedProfile?.baseUrl || providerData.baseUrl || PROVIDERS[selectedProviderKey]?.baseUrl || "",
      apiKey: selectedProfile?.apiKey || "",
      model: selectedProfile?.model || "",
      providerKey: selectedProviderKey,
    };
  })();
  if (!apiKey) {
    return context.trim()
      || "No hay evidencia de corrida guardada. En modo Agente vuelve a pedir la tarea.";
  }
  const result = await window.editcoreChat.chat({
    mode: state.mode,
    baseUrl,
    apiKey,
    model,
    providerKey,
    prompt: question,
    projectRoot: project?.projectRoot || state.projectRoot || "",
    projectId: project?.id || "",
    permissionMode: "readonly",
    history: [],
    systemPrompt: [
      (window.EditCoreEliteCommunication?.withEliteCommunicationPolicy
        || ((s) => s))([
        "Eres EditCoreAI. Responde en español, breve y con hechos.",
        "Usa SOLO la evidencia abajo. No inventes bucles .editcore ni pidas CONTINUA/PROCEDE si Acceso completo.",
        "Si el contexto está vacío, dilo y ofrece retomar la tarea real.",
        "No reabras exploración del repo solo para contestar.",
        context ? `\nEVIDENCIA:\n${String(context).slice(0, 12000)}` : "\nEVIDENCIA: (vacía)",
      ].join("\n\n")),
    ].join("\n\n"),
  });
  const answer = String(result?.text || "").trim();
  return answer || context || "Sin respuesta del modelo.";
}

function analysisRepairPrompt(_memory = {}, authorization = "procede") {
  // Sin metainstrucciones: solo lo que escribió el usuario (PROCEDE / HAZLO).
  // diagnostico NO MODIFICAR queda ANULADO; PROHIBIDO usar replace_in_file solo para .claude.
  return String(authorization || "PROCEDE").trim();
}

function ensureProject() {
  if (activeProject()) return activeProject();
  if (Array.isArray(state.projects) && state.projects.length) {
    const candidate = (state.activeProjectId && state.projects.find((p) => p.id === state.activeProjectId))
      || state.projects.find((p) => p.projectRoot)
      || state.projects[0];
    if (candidate) {
      state.activeProjectId = candidate.id;
      state.projectRoot = candidate.projectRoot || "";
      ensureProjectChats(candidate);
      return candidate;
    }
  }
  const project = {
    id: uid(),
    title: "Nuevo chat",
    mode: state.mode,
    model: PROVIDERS[state.mode]?.model || "claude-sonnet-4.6",
    messages: [],
    projectRoot: "",
    provider: state.mode,
    permissionMode: state.permissionMode,
    agents: [],
    agentState: "idle",
    brainSnapshot: null,
    updatedAt: Date.now(),
  };
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  saveProjects();
  return project;
}

function projectDisplayName(project) {
  if (!project) return "Sin proyecto";
  if (project.title && project.title !== "Nuevo chat") return project.title;
  if (project.projectRoot) return project.projectRoot.split(/[\\/]/).filter(Boolean).pop() || "Proyecto";
  return "Nuevo proyecto";
}

function projectCatalogParent() {
  return "D:\\PROGRAMAS IA";
}

async function loadProjectCatalogFromDisk() {
  const parent = projectCatalogParent();
  if (!parent || !window.editcoreProject?.catalog) return;
  const rows = await window.editcoreProject.catalog(parent);
  let updatedAny = false;
  for (const row of rows || []) {
    const root = String(row?.root || "").trim();
    if (!root) continue;
    const existing = state.projects.find((project) => normalizeProjectRoot(project.projectRoot) === normalizeProjectRoot(root));
    if (existing && row.name && existing.title !== row.name) {
      existing.title = String(row.name).trim();
      updatedAny = true;
    }
  }
  if (updatedAny) {
    saveProjects();
    try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
    try { renderProjects(); } catch { /* ignore */ }
  }
}

let projectCatalogRefreshInFlight = null;
async function refreshProjectCatalog() {
  if (projectCatalogRefreshInFlight) return projectCatalogRefreshInFlight;
  projectCatalogRefreshInFlight = loadProjectCatalogFromDisk();
  try {
    return await projectCatalogRefreshInFlight;
  } finally {
    projectCatalogRefreshInFlight = null;
  }
}

function projectForRoot(rootPath, fallbackName = "") {
  const normalized = normalizeProjectRoot(rootPath);
  let project = state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalized);
  if (project) return project;
  const active = activeProject();
  project = active && !active.projectRoot ? active : null;
  if (!project) {
    project = {
      id: uid(),
      title: "",
      mode: state.mode,
      model: PROVIDERS[state.mode]?.model || "claude-sonnet-4.6",
      messages: [],
      projectRoot: "",
      provider: state.mode,
      permissionMode: state.permissionMode,
      agents: [],
      agentState: "idle",
      brainSnapshot: null,
      updatedAt: Date.now(),
    };
    state.projects.unshift(project);
  }
  project.projectRoot = rootPath;
  project.title = fallbackName || rootPath.split(/[\\/]/).filter(Boolean).pop() || project.title || "Proyecto";
  project.permissionMode = state.permissionMode;
  project.chatCleared = false;
  project.updatedAt = Date.now();
  if (!project.agents?.length) {
    project.agents = [{ id: uid(), name: "Agente principal", projectId: project.id, status: "idle", provider: state.mode, model: PROVIDERS[state.mode]?.model || "", permissionMode: state.permissionMode, messages: [], updatedAt: Date.now() }];
    project.activeAgentId = project.agents[0].id;
  }
  return project;
}

function removeProject(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return;
  const project = (state.projects || []).find((item) => item.id === id);
  if (!project) return;
  const isCurrent = project.id === state.activeProjectId;
  state.projects = state.projects.filter((item) => item.id !== id);

  if (isCurrent) {
    const next = state.projects.find((p) => p.projectRoot) || state.projects[0];
    if (next) {
      state.activeProjectId = next.id;
      state.projectRoot = next.projectRoot || "";
      ensureProjectChats(next);
      const curChat = activeChat(next);
      state.history = [...(curChat?.messages || next.messages || [])];
    } else {
      state.activeProjectId = "";
      state.projectRoot = "";
      state.history = [];
      const fresh = ensureProject();
      state.activeProjectId = fresh.id;
    }
    renderFeed({ force: true });
  }
  saveProjects({ immediate: true });
  renderProjects();
  try { window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { projectId: id } })); } catch {}
  try { window.dispatchEvent(new CustomEvent("editcore:project-updated", { detail: { projectId: id } })); } catch {}
}

function renderProjects() {
  const host = $("projectsManagerList");
  if (!host) return;
  host.replaceChildren();
  const projects = [...state.projects].filter((item) => item.projectRoot).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "projects-manager-empty";
    empty.textContent = "Todavía no hay proyectos guardados.";
    host.appendChild(empty);
    renderWelcomeRecents();
    return;
  }
  for (const project of projects) {
    const row = document.createElement("div");
    row.className = "projects-manager-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-item ${project.id === state.activeProjectId ? "active" : ""}`;
    const title = document.createElement("span");
    title.textContent = projectDisplayName(project);
    const meta = document.createElement("small");
    meta.textContent = project.projectRoot;
    button.append(title, meta);
    button.onclick = () => {
      selectProject(project.id).catch((error) => { $("status").textContent = error?.message || String(error); });
      $("projectsDialog")?.close();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "project-remove-btn";
    remove.textContent = "Quitar";
    remove.title = "Quitar de Mis proyectos sin borrar carpeta";
    remove.onclick = () => {
      removeProject(project.id);
    };
    row.append(button, remove);
    host.appendChild(row);
  }
  renderWelcomeRecents();
}

function touchRecentProjectRoot(rootPath = "") {
  const key = normalizeProjectRoot(rootPath);
  if (!key) return;
  let list = [];
  try {
    const raw = loadJson(RECENT_PROJECT_ROOTS_KEY, []);
    list = Array.isArray(raw) ? raw.map((item) => normalizeProjectRoot(item)).filter(Boolean) : [];
  } catch {
    list = [];
  }
  list = [key, ...list.filter((item) => item !== key)].slice(0, RECENT_PROJECTS_LIMIT);
  try {
    localStorage.setItem(RECENT_PROJECT_ROOTS_KEY, JSON.stringify(list));
  } catch { /* ignore quota */ }
}

function seedRecentRootsFromProjects() {
  let list = loadJson(RECENT_PROJECT_ROOTS_KEY, []);
  if (Array.isArray(list) && list.length) return;
  const opened = [...(state.projects || [])]
    .filter((item) => item?.projectRoot && Number(item.lastOpenedAt) > 0)
    .sort((a, b) => Number(b.lastOpenedAt) - Number(a.lastOpenedAt))
    .slice(0, RECENT_PROJECTS_LIMIT);
  if (!opened.length) return;
  try {
    localStorage.setItem(
      RECENT_PROJECT_ROOTS_KEY,
      JSON.stringify(opened.map((item) => normalizeProjectRoot(item.projectRoot)).filter(Boolean)),
    );
  } catch { /* ignore */ }
}

function recentProjectsForWelcome(limit = RECENT_PROJECTS_LIMIT) {
  const cap = Math.max(1, Math.min(Number(limit) || RECENT_PROJECTS_LIMIT, RECENT_PROJECTS_LIMIT));
  seedRecentRootsFromProjects();
  const byRoot = new Map();
  for (const project of state.projects || []) {
    const key = normalizeProjectRoot(project?.projectRoot);
    if (!key) continue;
    byRoot.set(key, project);
  }
  const ordered = [];
  const recentRoots = loadJson(RECENT_PROJECT_ROOTS_KEY, []);
  if (Array.isArray(recentRoots)) {
    for (const root of recentRoots) {
      const project = byRoot.get(normalizeProjectRoot(root));
      if (!project) continue;
      ordered.push(project);
      if (ordered.length >= cap) return ordered;
    }
  }
  // Solo proyectos realmente abiertos (nunca entradas del catalogo sin uso).
  const opened = [...(state.projects || [])]
    .filter((item) => item?.projectRoot && Number(item.lastOpenedAt) > 0)
    .sort((a, b) => Number(b.lastOpenedAt) - Number(a.lastOpenedAt));
  for (const project of opened) {
    const key = normalizeProjectRoot(project.projectRoot);
    if (ordered.some((item) => normalizeProjectRoot(item.projectRoot) === key)) continue;
    ordered.push(project);
    if (ordered.length >= cap) break;
  }
  return ordered.slice(0, cap);
}

function parentDirLabel(root) {
  const parts = String(root || "").split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return String(root || "");
  return parts.slice(0, -1).join("\\");
}

function renderWelcomeRecents() {
  const host = $("welcomeRecentList");
  if (!host) return;
  host.replaceChildren();
  const projects = recentProjectsForWelcome(RECENT_PROJECTS_LIMIT);
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "welcome-recent-empty";
    empty.textContent = "Aun no hay proyectos recientes. Abre una carpeta o crea uno nuevo.";
    host.appendChild(empty);
    return;
  }
  for (const project of projects) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "welcome-recent-row";
    row.setAttribute("role", "listitem");
    row.title = project.projectRoot;
    const name = document.createElement("span");
    name.className = "welcome-recent-name";
    name.textContent = projectDisplayName(project);
    const pathEl = document.createElement("span");
    pathEl.className = "welcome-recent-path";
    pathEl.textContent = String(project.projectRoot || "");
    row.append(name, pathEl);
    row.addEventListener("click", () => {
      selectProject(project.id).catch((error) => {
        $("status").textContent = error?.message || String(error);
      });
    });
    host.appendChild(row);
  }
}

function showWelcomeScreen() {
  // En modo Chat Home el welcome de proyectos no debe tapar el agente generalista.
  if (document.body.dataset.appMode === "chat") {
    hideWelcomeScreen();
    return;
  }
  const screen = $("welcomeScreen");
  if (!screen) return;
  renderWelcomeRecents();
  screen.hidden = false;
  screen.setAttribute("aria-hidden", "false");
  document.body.classList.add("welcome-open");
  $("status").textContent = "Elige un proyecto";
}

function hideWelcomeScreen() {
  const screen = $("welcomeScreen");
  if (!screen) return;
  screen.hidden = true;
  screen.setAttribute("aria-hidden", "true");
  document.body.classList.remove("welcome-open");
}

function isWelcomeScreenVisible() {
  const screen = $("welcomeScreen");
  return Boolean(screen && !screen.hidden);
}

function renderFeed(options = {}) {
  const agentLive = activePromptRequests.size > 0 || activeAgentThinkingRuns.size > 0 || document.querySelector(".thinking-msg");
  if (!options.force && agentLive) return;
  $("feed").replaceChildren();
  const project = activeProject();
  if (!project) {
    state.projectRoot = "";
    state.history = [];
    $("projectPathLabel").textContent = "Sin proyecto";
    updateCloseProjectButton();
    // Chat Home generalista: vacío silencioso (el empty-state lo pinta chat-home).
    if (document.body.dataset.appMode === "chat") {
      try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
      return;
    }
    append("assistant", "Abre un proyecto para comenzar.", null, false);
    return;
  }
  state.mode = project.mode || state.mode;
  state.projectRoot = project.projectRoot || "";
  state.permissionMode = ["readonly", "step", "full"].includes(project.permissionMode)
    ? project.permissionMode
    : "step";
  state.allowWrite = state.permissionMode !== "readonly";
  window.editcoreAgent.setPermission(state.permissionMode).catch((error) => {
    $("status").textContent = error?.message || "No se pudo restaurar el permiso del proyecto";
  });
  state.activeAgentId = project.activeAgentId || project.agents?.[0]?.id || "";
  ensureProjectChats(project);
  const chat = activeChat(project);
  state.history = [...(chat?.messages || project.messages || [])];
  updateAgentCount();
  updateStatus();
  renderChatThreadSelect();
  $("permissionsBtn").textContent = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" }[state.permissionMode] || "Permisos";
  $("permissionsBtn").classList.toggle("danger", state.permissionMode === "full");
  $("permissionsBtn").dataset.permissionMode = state.permissionMode;
  syncPermissionMenuSelection(state.permissionMode);
  $("projectPathLabel").textContent = state.projectRoot || "Sin proyecto";
  refreshAppStatusBar();
  renderProjectFiles().catch(() => undefined);
  updateCloseProjectButton();
  if (!state.history.length) {
    if (project.chatCleared) return;
    append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
    return;
  }
  for (const message of state.history) append(message.role, message.content, message.usage, false, null, message.images || [], message.documents || []);
  scrollFeedToBottom(true);
}

/** Auto-scroll del chat: solo si el usuario está abajo; si sube a leer, no lo arrastra. */
const FEED_STICK_BOTTOM_PX = 96;
let feedStickToBottom = true;
let feedScrollGuardBound = false;
let feedScrollingProgrammatically = false;

function isFeedNearBottom(feed, threshold = FEED_STICK_BOTTOM_PX) {
  const roots = getFeedScrollRoots();
  const el = roots[0] || feed;
  if (!el) return true;
  return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
}

function getFeedScrollRoots() {
  const roots = [];
  const chatMode = document.body?.dataset?.appMode === "chat";
  if (chatMode) {
    const host = $("chatHomeFeedHost");
    const stage = $("chatHomeStage");
    if (host) roots.push(host);
    if (stage && stage !== host) roots.push(stage);
  }
  const feed = $("feed");
  if (feed) roots.push(feed);
  return roots;
}

function bindFeedScrollGuard() {
  if (feedScrollGuardBound) return;
  const roots = getFeedScrollRoots();
  if (!roots.length) return;
  feedScrollGuardBound = true;
  const syncStick = () => {
    if (feedScrollingProgrammatically) return;
    feedStickToBottom = isFeedNearBottom($("feed"));
  };
  for (const el of roots) {
    el.addEventListener("scroll", syncStick, { passive: true });
    el.addEventListener("wheel", () => {
      feedScrollingProgrammatically = false;
      requestAnimationFrame(syncStick);
    }, { passive: true });
    el.addEventListener("touchmove", () => {
      feedScrollingProgrammatically = false;
      requestAnimationFrame(syncStick);
    }, { passive: true });
  }
}

function scrollFeedToBottom(force = false) {
  const feed = $("feed");
  if (!feed) return;
  // Rebind si cambió el modo Chat/IDE (el scroll root no es el mismo).
  feedScrollGuardBound = false;
  bindFeedScrollGuard();
  if (force === true) feedStickToBottom = true;
  if (!feedStickToBottom && force !== true) return;
  feedScrollingProgrammatically = true;
  const apply = () => {
    for (const el of getFeedScrollRoots()) {
      try { el.scrollTop = el.scrollHeight; } catch { /* ignore */ }
    }
    try {
      const last = feed.lastElementChild;
      last?.scrollIntoView?.({ block: "end", behavior: "auto" });
    } catch { /* ignore */ }
    feedStickToBottom = true;
  };
  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 40);
  setTimeout(() => {
    apply();
    feedScrollingProgrammatically = false;
  }, 160);
}

window.EditCoreChatScroll = {
  toBottom: (force = true) => scrollFeedToBottom(force === true),
};

function notifyVoiceAssistant(text) {
  window.EditCoreVoiceMode?.notifyAssistant?.(String(text || "").trim());
}

function notifyVoiceTurnComplete() {
  window.EditCoreVoiceMode?.notifyTurnComplete?.();
}

function fileIcon(kind) {
  return kind === "directory" ? "📁" : "📄";
}

function normalizePromptSnippet(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function shouldSkipDirectionProgress(text = "") {
  const snippet = normalizePromptSnippet(text);
  const last = normalizePromptSnippet(state.lastUserPrompt);
  if (!snippet || !last) return false;
  if (last === snippet) return true;
  if (last.includes(snippet) || snippet.includes(last)) return true;
  return false;
}

function mergeHighlightNames(...lists) {
  const out = new Set();
  for (const list of lists) {
    for (const name of Array.isArray(list) ? list : []) {
      const key = String(name || "").trim().toLowerCase();
      if (key) out.add(key);
    }
  }
  return [...out];
}

function clearAgentTouchedHighlights() {
  if (state.fileListHighlightClearTimer) {
    clearTimeout(state.fileListHighlightClearTimer);
    state.fileListHighlightClearTimer = null;
  }
  state.touchedHighlightNames = [];
  state.touchedRelativePaths = [];
  state.fileListHighlightNames = [];
  state.fileListWritingNames = [];
}

function scheduleClearAgentTouchedHighlights(delayMs = 180000) {
  if (state.fileListHighlightClearTimer) clearTimeout(state.fileListHighlightClearTimer);
  state.fileListHighlightClearTimer = setTimeout(() => {
    state.fileListHighlightClearTimer = null;
    clearAgentTouchedHighlights();
    renderProjectFiles(state.fileListRelativePath || "").catch(() => undefined);
  }, delayMs);
}

function markAgentTouchedFromPayload(payload = {}, { writing = false } = {}) {
  const root = normalizeProjectRoot(state.projectRoot);
  const writtenPath = String(payload.writtenPath || payload.path || payload.relativePath || "");
  const names = Array.isArray(payload.highlightNames) && payload.highlightNames.length
    ? payload.highlightNames
    : (ProjectFilesUi?.resolveHighlightNames
      ? ProjectFilesUi.resolveHighlightNames(root, writtenPath)
      : []);
  state.touchedHighlightNames = mergeHighlightNames(state.touchedHighlightNames, names);
  const rel = String(
    payload.relativePath
    || ProjectFilesUi?.resolveTouchedRelativePath?.(root, writtenPath)
    || "",
  ).replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel && !state.touchedRelativePaths.includes(rel)) {
    state.touchedRelativePaths = [...state.touchedRelativePaths, rel].slice(-80);
  }
  state.fileListHighlightNames = mergeHighlightNames(state.touchedHighlightNames, names);
  if (writing) {
    state.fileListWritingNames = mergeHighlightNames(names);
  } else {
    state.fileListWritingNames = [];
  }
  scheduleClearAgentTouchedHighlights(180000);
  try {
    if (document.body.dataset.appMode === "chat") {
      // Debounce: no refrescar el panel en cada write del agente (mata la UI).
      clearTimeout(window.__editcoreCtxRefreshTimer);
      window.__editcoreCtxRefreshTimer = setTimeout(() => {
        window.__editcoreCtxRefreshTimer = null;
        try { window.EditCoreChatHome?.refreshContextPanel?.(); } catch { /* ignore */ }
      }, 700);
    }
  } catch { /* ignore */ }
  return {
    viewDir: Object.prototype.hasOwnProperty.call(payload, "viewDir")
      ? String(payload.viewDir ?? "")
      : (ProjectFilesUi?.resolveWrittenFileViewDir?.(root, writtenPath) || ""),
    highlightNames: state.fileListHighlightNames,
  };
}

function isFileRowTouched(row = {}, viewPath = "") {
  const name = String(row.name || "").toLowerCase();
  if (!name) return false;
  if (state.fileListHighlightNames.includes(name) || state.touchedHighlightNames.includes(name)) return true;
  const view = String(viewPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = view ? `${view}/${row.name}` : String(row.name || "");
  const candidateNorm = candidate.replace(/\\/g, "/").toLowerCase();
  return state.touchedRelativePaths.some((rel) => {
    const r = String(rel || "").replace(/\\/g, "/").toLowerCase();
    if (!r) return false;
    if (row.kind === "directory") return r === candidateNorm || r.startsWith(`${candidateNorm}/`);
    return r === candidateNorm || r.endsWith(`/${name}`);
  });
}

function refreshProjectFilesFromDisk(options = {}) {
  const hasViewDir = Object.prototype.hasOwnProperty.call(options, "viewDir");
  const viewDir = hasViewDir ? String(options.viewDir ?? "") : String(state.fileListRelativePath || "");
  const highlights = Array.isArray(options.highlightNames) ? options.highlightNames : state.touchedHighlightNames;
  state.fileListHighlightNames = mergeHighlightNames(state.touchedHighlightNames, highlights);
  // No limpiar highlights al terminar el render: deben persistir durante la corrida.
  return renderProjectFiles(viewDir);
}

function handleProjectFilesChanged(payload = {}) {
  if (!payload || !state.projectRoot) return;
  if (state.fileListRefreshTimer) clearTimeout(state.fileListRefreshTimer);
  state.fileListRefreshTimer = setTimeout(() => {
    state.fileListRefreshTimer = null;
    const root = normalizeProjectRoot(state.projectRoot);
    const eventRoot = normalizeProjectRoot(payload.projectRoot || root);
    if (eventRoot && eventRoot !== root) return;
    const writtenPath = String(payload.writtenPath || payload.path || "");
    const fileName = String(payload.fileName || ProjectFilesUi?.resolveWrittenFileName?.(writtenPath) || "");
    const nav = markAgentTouchedFromPayload(payload, { writing: false });
    // En raíz: permanecer para que aparezcan carpetas nuevas (src/, etc.).
    // Si el usuario ya navegó a una subcarpeta, abrir la carpeta del archivo tocado.
    const currentView = String(state.fileListRelativePath || "");
    const viewDir = !currentView ? "" : String(nav.viewDir || currentView);
    refreshProjectFilesFromDisk({ viewDir, highlightNames: nav.highlightNames });
    if (payload.autoPreview || ProjectFilesUi?.shouldAutoStartPreview?.(fileName)) {
      maybeRefreshPreviewAfterWrite(fileName).catch(() => undefined);
    } else if (payload.hotReload || ProjectFilesUi?.shouldHotReloadPreview?.(fileName)) {
      softHotReloadPreview().catch(() => undefined);
    }
  }, 80);
}

function addAgentCodeFragment(thinkingItem, progress) {
  const log = thinkingItem?._narrativeLog || document.querySelector(".thinking-msg .agent-narrative-log");
  if (!log) return;
  const fragment = ProjectFilesUi?.buildMutationFragment?.(progress, state.projectRoot)
    || (progress?.fragment || null);
  if (!fragment || !fragment.path) return;
  const fragKey = `frag:${fragment.kind}:${fragment.path}:${progress?.stage || ""}:${progress?.index ?? ""}`;
  thinkingItem._fragmentSeen ||= new Set();
  if (thinkingItem._fragmentSeen.has(fragKey)) return;
  // Una sola tarjeta por archivo+etapa (running/done); running se actualiza si reaparece.
  const stableKey = `frag:${fragment.kind}:${fragment.path}`;
  const existing = thinkingItem._fragmentRows?.get?.(stableKey);
  if (existing && progress?.stage === "running") return;
  if (existing && progress?.stage === "done") {
    // Reemplaza el preview "escribiendo" por el definitivo.
    existing.remove();
    thinkingItem._fragmentRows.delete(stableKey);
  }
  thinkingItem._fragmentSeen.add(fragKey);
  thinkingItem._fragmentRows ||= new Map();

  const card = document.createElement("div");
  card.className = "agent-code-fragment";
  const head = document.createElement("div");
  head.className = "agent-code-fragment-head";
  head.textContent = fragment.summary || fragment.path;
  const body = document.createElement("pre");
  body.className = "agent-code-fragment-body";
  if (fragment.kind === "replace") {
    if (fragment.oldText) {
      const oldEl = document.createElement("span");
      oldEl.className = "frag-old";
      oldEl.textContent = `- ${fragment.oldText.split("\n").join("\n- ")}`;
      body.appendChild(oldEl);
    }
    if (fragment.oldText && fragment.newText) {
      const sep = document.createElement("span");
      sep.className = "frag-sep";
      sep.textContent = "───";
      body.appendChild(sep);
    }
    if (fragment.newText) {
      const newEl = document.createElement("span");
      newEl.className = "frag-new";
      newEl.textContent = `+ ${fragment.newText.split("\n").join("\n+ ")}`;
      body.appendChild(newEl);
    }
    if (!fragment.oldText && !fragment.newText) {
      body.textContent = "(reemplazo en curso…)";
    }
  } else if (fragment.content) {
    body.textContent = fragment.content;
  } else {
    body.textContent = "(escribiendo…)";
  }
  card.appendChild(head);
  card.appendChild(body);
  log.appendChild(card);
  thinkingItem._fragmentRows.set(stableKey, card);
  showThinkingIndicator(thinkingItem);
  scrollFeedToBottom();
}

function notifyAgentFileMutationProgress(thinkingEl, progress) {
  if (!progress || typeof progress !== "object") return;
  const tool = String(progress?.name || "").toLowerCase();
  const payload = ProjectFilesUi?.filesChangedPayload
    ? ProjectFilesUi.filesChangedPayload(progress, state.projectRoot)
    : {
      writtenPath: String(progress?.input?.path || progress?.input?.filePath || progress?.input?.TargetFile || progress?.input?.targetPath || progress?.input?.AbsolutePath || progress?.path || ""),
      highlightNames: [],
      fileName: "",
    };
  const isWriteTool = /write|replace|diff|patch|mutate|edit|create|delete|append|save|touch/i.test(tool);
  const writing = isWriteTool && (progress?.stage === "running" || (progress?.ok === undefined && progress?.stage !== "done"));
  const done = progress?.stage === "done" || progress?.ok === true;
  const hasTarget = Boolean(payload.writtenPath || payload.fileName || (payload.highlightNames && payload.highlightNames.length > 0));
  if (!isWriteTool && !hasTarget) return;

  const nav = markAgentTouchedFromPayload(payload, { writing });
  // Refrescar siempre: en "running" el árbol puede anticipar; en "done" confirma lo ya escrito en disco.
  // Si el usuario está en la raíz, quedarse ahí para que aparezcan carpetas nuevas (src/, etc.).
  if (writing || done || hasTarget) {
    const currentView = String(state.fileListRelativePath || "");
    const refreshView = (!currentView || writing)
      ? currentView
      : String(nav.viewDir || currentView);
    refreshProjectFilesFromDisk({ viewDir: refreshView, highlightNames: nav.highlightNames }).catch(() => undefined);
  }
  // Si hay tarjeta Cursor con diffs inline, no duplicar el fragmento legacy oscuro.
  if (thinkingEl?._inlineDiffs) return;
  if (isWriteTool || payload.fragment) {
    addAgentCodeFragment(thinkingEl, { ...progress, fragment: payload.fragment });
  }
}

async function softHotReloadPreview() {
  const webview = $("previewWebview");
  const url = String($("previewUrl")?.value || previewExpectedUrl || "").trim();
  if (!webview || !url) return;
  try {
    if (typeof webview.reloadIgnoringCache === "function") webview.reloadIgnoringCache();
    else if (typeof webview.reload === "function") webview.reload();
    else await openPreview({ forceReload: true });
    $("status").textContent = "Preview actualizado (hot-reload)";
  } catch (error) {
    showPreviewStatus(`Hot-reload: ${error?.message || String(error)}`);
  }
}

function isLocalPreviewUrl(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)
      || /^https?:\/\/localhost(?::\d+)?/i.test(String(url || ""));
  } catch {
    return false;
  }
}

function buildPreviewInteractScript(action, selector, text = "") {
  const sel = JSON.stringify(String(selector || ""));
  const value = JSON.stringify(String(text || ""));
  const kind = JSON.stringify(String(action || ""));
  return `(() => {
    const action = ${kind};
    const selector = ${sel};
    const text = ${value};
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: "No hay elemento para " + selector };
    if (action === "click") {
      el.focus?.();
      el.click?.();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return { ok: true, action: "click", selector };
    }
    if (action === "type") {
      el.focus?.();
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, action: "type", selector, length: text.length };
    }
    return { ok: false, error: "Accion no soportada: " + action };
  })()`;
}

async function runPreviewInteract(action) {
  const webview = $("previewWebview");
  const selector = String($("browserInspectSelector")?.value || "").trim();
  const text = String($("browserInspectText")?.value || "");
  const body = $("browserInspectBody");
  if (!selector) {
    $("status").textContent = "Indica un selector CSS";
    return;
  }
  if (!webview || typeof webview.executeJavaScript !== "function") {
    $("status").textContent = "Preview no listo";
    return;
  }
  const currentUrl = String(webview.getURL?.() || $("previewUrl")?.value || "");
  if (currentUrl && !isLocalPreviewUrl(currentUrl)) {
    $("status").textContent = "Click/Escribir solo en preview local";
    return;
  }
  try {
    const result = await webview.executeJavaScript(buildPreviewInteractScript(action, selector, text));
    if (!result?.ok) throw new Error(result?.error || "Accion fallida");
    $("status").textContent = action === "type"
      ? `Escrito en ${selector}`
      : `Click en ${selector}`;
    if (body) {
      const note = `\n\n### Ultima accion\n- ${action} → \`${selector}\`${action === "type" ? ` (${text.length} chars)` : ""}\n`;
      body.textContent = `${String(body.textContent || "").replace(/\n### Ultima accion[\s\S]*$/m, "")}${note}`;
    }
    setTimeout(() => {
      inspectPreviewFromUi().catch(() => undefined);
    }, 120);
  } catch (error) {
    $("status").textContent = error?.message || String(error);
  }
}

async function inspectPreviewFromUi() {
  const panel = $("browserInspectPanel");
  const body = $("browserInspectBody");
  const webview = $("previewWebview");
  const root = String(state.projectRoot || "").trim();
  if (!root) {
    $("status").textContent = "Abre un proyecto para inspeccionar";
    return;
  }
  panel?.classList.remove("hidden");
  if (body) body.textContent = "Inspeccionando preview local...";

  // Prefer in-webview DOM probe (fast); fallback a inspect_browser main.
  try {
    if (webview && typeof webview.executeJavaScript === "function") {
      const probe = await webview.executeJavaScript(`(() => {
        const cssPath = (el) => {
          if (!el || el.nodeType !== 1) return "";
          if (el.id) return "#" + CSS.escape(el.id);
          const parts = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && parts.length < 5) {
            let part = cur.tagName.toLowerCase();
            if (cur.classList?.length) part += "." + [...cur.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".");
            const parent = cur.parentElement;
            if (parent) {
              const siblings = [...parent.children].filter((n) => n.tagName === cur.tagName);
              if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";
            }
            parts.unshift(part);
            if (cur.id) break;
            cur = parent;
          }
          return parts.join(" > ");
        };
        const title = document.title || "";
        const url = location.href;
        const headings = [...document.querySelectorAll("h1,h2")].slice(0, 12).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 120),
          selector: cssPath(el),
        }));
        const controls = [...document.querySelectorAll("button,a[href],input,textarea,select")].slice(0, 24).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute("type") || "").toLowerCase(),
          text: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.value || "").trim().slice(0, 80),
          selector: cssPath(el),
        }));
        const images = document.images?.length || 0;
        const issues = [];
        if (!document.querySelector("main, [role=main], h1")) issues.push("Falta h1/main visible");
        return { ok: true, title, url, headings, controls, images, issues };
      })()`);
      const lines = [
        "## Browser · DOM",
        "",
        `URL: \`${probe.url || ""}\``,
        `Titulo: ${probe.title || "(sin titulo)"}`,
        `Imagenes: ${probe.images ?? 0}`,
        "",
        "### Headings",
        ...((probe.headings || []).map((h) => `- <${h.tag}> ${h.text}${h.selector ? ` · \`${h.selector}\`` : ""}`) || ["- (ninguno)"]),
        "",
        "### Controles (selector listo para Click/Escribir)",
        ...((probe.controls || []).slice(0, 16).map((b) => `- <${b.tag}${b.type ? ` type=${b.type}` : ""}> ${b.text || "(sin texto)"} · \`${b.selector || "?"}\``) || ["- (ninguno)"]),
      ];
      if (probe.issues?.length) lines.push("", "### Avisos", ...probe.issues.map((i) => `- ${i}`));
      if (body) body.textContent = lines.join("\n");
      const firstInteractive = (probe.controls || []).find((c) => c.selector);
      if (firstInteractive && $("browserInspectSelector") && !$("browserInspectSelector").value) {
        $("browserInspectSelector").value = firstInteractive.selector;
      }
      $("status").textContent = "Inspeccion DOM lista";
      return;
    }
  } catch (error) {
    if (body) body.textContent = `DOM probe: ${error?.message || error}\nIntentando captura main...`;
  }

  try {
    const result = await window.editcoreProject.browserInspect({
      projectRoot: root,
      url: String($("previewUrl")?.value || ""),
      viewport: document.querySelector(".viewer")?.dataset?.previewMode === "mobile" ? "mobile" : "desktop",
    });
    if (body) {
      body.textContent = JSON.stringify({
        available: result.available,
        message: result.message,
        previewUrl: result.previewUrl,
        inspectedUrl: result.inspectedUrl,
        findings: result.findings || result.summary || result,
      }, null, 2).slice(0, 8000);
    }
    $("status").textContent = result.available ? "Inspeccion browser OK" : (result.message || "Inspeccion fallida");
  } catch (error) {
    if (body) body.textContent = String(error?.message || error);
    $("status").textContent = "Inspeccion fallida";
  }
}

async function syncScaffoldStatusFromDisk() {
  if (!state.projectRoot) return;
  try {
    const rows = await window.editcoreProject.list(state.projectRoot, "");
    const project = activeProject();
    if (!project) return;
    const visible = rows.filter((row) => row?.name && !String(row.name).startsWith("."));
    project.scaffoldIncomplete = visible.length < 8;
    saveProjects();
  } catch {
    // ignore list errors during preview refresh
  }
}

async function maybeRefreshPreviewAfterWrite(fileName = "") {
  if (!state.projectRoot) return;
  const base = String(fileName || "").trim().toLowerCase();
  const forcePreview = ProjectFilesUi?.shouldAutoStartPreview?.(base);
  if (!forcePreview) {
    await syncScaffoldStatusFromDisk();
    const project = activeProject();
    if (project?.scaffoldIncomplete) return;
  }
  if (base && ProjectFilesUi?.shouldAutoStartPreview && !ProjectFilesUi.shouldAutoStartPreview(base)) return;
  try {
    const preview = await window.editcoreProject.startPreview(state.projectRoot);
    if (!preview?.available || !preview.url) return;
    $("previewUrl").value = preview.url;
    await openPreview({ forceReload: true });
    $("status").textContent = "Navegador interno conectado al proyecto";
  } catch (error) {
    showPreviewStatus(`Vista previa pendiente: ${error?.message || String(error)}`);
  }
}

function joinProjectRel(...parts) {
  return parts
    .map((p) => String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function hideFileContextMenu() {
  const menu = $("fileContextMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.replaceChildren();
}

function positionFileContextMenu(menu, clientX, clientY) {
  menu.hidden = false;
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
  if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function buildFileContextItems(target) {
  const isBlank = !target || target.blank === true;
  const isDir = target?.kind === "directory";
  const items = [];

  if (isBlank) {
    items.push(
      { id: "new-file", label: "Nuevo archivo…" },
      { id: "new-folder", label: "Nueva carpeta…" },
      { sep: true },
      { id: "refresh", label: "Actualizar" },
      { id: "reveal-root", label: "Mostrar proyecto en Explorador" },
    );
    return items;
  }

  if (isDir) {
    items.push({ id: "open", label: "Abrir carpeta" });
  } else {
    items.push({ id: "open", label: "Abrir con app predeterminada" });
    if (/\.html?$/i.test(String(target.name || ""))) {
      items.push({ id: "preview", label: "Abrir en preview" });
    }
  }

  items.push(
    { id: "reveal", label: "Mostrar en Explorador" },
    { sep: true },
    { id: "copy-rel", label: "Copiar ruta relativa" },
    { id: "copy-abs", label: "Copiar ruta absoluta" },
    { sep: true },
    { id: "new-file", label: "Nuevo archivo aquí…" },
    { id: "new-folder", label: "Nueva carpeta aquí…" },
    { id: "rename", label: "Renombrar…" },
    { sep: true },
    { id: "delete", label: "Eliminar…", danger: true },
    { id: "refresh", label: "Actualizar" },
  );
  return items;
}

async function runFileContextAction(actionId, target) {
  const root = state.projectRoot;
  if (!root) return;
  const viewPath = String(state.fileListRelativePath || "");
  const rel = target?.path ? String(target.path).replace(/\\/g, "/") : "";
  const parentRel = target?.kind === "directory"
    ? rel
    : (rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : viewPath.replace(/\\/g, "/"));

  try {
    if (actionId === "refresh") {
      await renderProjectFiles(viewPath);
      return;
    }
    if (actionId === "reveal-root") {
      await window.editcoreProject.revealInFolder({ projectRoot: root, path: "." });
      $("status").textContent = "Proyecto en Explorador";
      return;
    }
    if (actionId === "open") {
      if (!rel) return;
      if (target.kind === "directory") {
        await renderProjectFiles(target.path);
      } else {
        await window.editcoreProject.openPath({ projectRoot: root, path: rel });
      }
      return;
    }
    if (actionId === "preview") {
      if (!target?.absolutePath) return;
      $("previewWebview").src = `file:///${String(target.absolutePath).replace(/\\/g, "/")}`;
      return;
    }
    if (actionId === "reveal") {
      if (!rel) return;
      await window.editcoreProject.revealInFolder({ projectRoot: root, path: rel });
      $("status").textContent = `Explorador: ${rel}`;
      return;
    }
    if (actionId === "copy-rel" || actionId === "copy-abs") {
      if (!rel) return;
      const out = await window.editcoreProject.copyPath({
        projectRoot: root,
        path: rel,
        absolute: actionId === "copy-abs",
      });
      $("status").textContent = `Copiado: ${out.path}`;
      return;
    }
    if (actionId === "new-file") {
      const name = String(window.prompt("Nombre del archivo:", "nuevo-archivo.js") || "").trim();
      if (!name || /[\\/]/.test(name)) return;
      const dest = joinProjectRel(parentRel || viewPath.replace(/\\/g, "/"), name);
      await window.editcoreProject.createFile({ projectRoot: root, path: dest, content: "" });
      await renderProjectFiles(parentRel || viewPath);
      $("status").textContent = `Creado: ${dest}`;
      return;
    }
    if (actionId === "new-folder") {
      const name = String(window.prompt("Nombre de la carpeta:", "nueva-carpeta") || "").trim();
      if (!name || /[\\/]/.test(name)) return;
      const dest = joinProjectRel(parentRel || viewPath.replace(/\\/g, "/"), name);
      await window.editcoreProject.mkdir({ projectRoot: root, path: dest });
      await renderProjectFiles(parentRel || viewPath);
      $("status").textContent = `Carpeta: ${dest}`;
      return;
    }
    if (actionId === "rename") {
      if (!rel) return;
      const nextName = String(window.prompt("Nuevo nombre:", target.name) || "").trim();
      if (!nextName || nextName === target.name || /[\\/]/.test(nextName)) return;
      const parent = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
      const to = joinProjectRel(parent, nextName);
      await window.editcoreProject.renameEntry({ projectRoot: root, from: rel, to });
      await renderProjectFiles(viewPath);
      $("status").textContent = `Renombrado → ${to}`;
      return;
    }
    if (actionId === "delete") {
      if (!rel) return;
      const isDir = target.kind === "directory";
      const ok = window.confirm(
        isDir
          ? `¿Eliminar la carpeta "${target.name}" y todo su contenido?`
          : `¿Eliminar el archivo "${target.name}"?`,
      );
      if (!ok) return;
      await window.editcoreProject.deleteEntry({
        projectRoot: root,
        path: rel,
        recursive: isDir,
      });
      await renderProjectFiles(viewPath);
      $("status").textContent = `Eliminado: ${rel}`;
    }
  } catch (error) {
    $("status").textContent = error?.message || String(error);
  }
}

function showFileContextMenu(event, target) {
  event.preventDefault();
  event.stopPropagation();
  if (!state.projectRoot) return;

  let menu = $("fileContextMenu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "fileContextMenu";
    menu.className = "file-ctx-menu";
    menu.hidden = true;
    document.body.appendChild(menu);
  }

  const items = buildFileContextItems(target);
  menu.replaceChildren();
  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "file-ctx-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `file-ctx-item${item.danger ? " is-danger" : ""}`;
    btn.textContent = item.label;
    btn.onclick = async () => {
      hideFileContextMenu();
      await runFileContextAction(item.id, target);
    };
    menu.appendChild(btn);
  }

  positionFileContextMenu(menu, event.clientX, event.clientY);
}

function initFileListContextMenu() {
  const list = $("fileList");
  if (!list || list.dataset.ctxBound === "1") return;
  list.dataset.ctxBound = "1";
  list.addEventListener("contextmenu", (event) => {
    const item = event.target?.closest?.(".file-item");
    if (item?.dataset?.filePath) {
      showFileContextMenu(event, {
        name: item.dataset.fileName || "",
        path: item.dataset.filePath,
        absolutePath: item.dataset.fileAbs || "",
        kind: item.dataset.fileKind || "file",
      });
      return;
    }
    showFileContextMenu(event, { blank: true });
  });
  document.addEventListener("click", (event) => {
    const menu = $("fileContextMenu");
    if (!menu || menu.hidden) return;
    if (menu.contains(event.target)) return;
    hideFileContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideFileContextMenu();
  });
  window.addEventListener("blur", hideFileContextMenu);
  window.addEventListener("resize", hideFileContextMenu);
}

async function renderProjectFiles(relativePath = "") {
  const renderToken = ++state.fileListRenderToken;
  const viewPath = String(relativePath || "");
  state.fileListRelativePath = viewPath;
  hideFileContextMenu();
  $("fileList").replaceChildren();
  if (!state.projectRoot) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "Abre un proyecto para ver archivos.";
    $("fileList").appendChild(empty);
    return;
  }
  const header = document.createElement("div");
  header.className = "file-list-header";
  const crumbs = document.createElement("div");
  crumbs.className = "file-list-crumbs";
  crumbs.textContent = viewPath ? viewPath.replace(/\\/g, "/") : "Raíz del proyecto";
  header.appendChild(crumbs);
  if (viewPath) {
    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "file-root-btn";
    rootBtn.textContent = "Ir a raíz";
    rootBtn.onclick = () => renderProjectFiles("");
    header.appendChild(rootBtn);
  }
  $("fileList").appendChild(header);
  if (viewPath) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "file-item";
    up.textContent = "← Volver";
    up.onclick = () => renderProjectFiles(viewPath.split(/[\\/]/).slice(0, -1).join("\\"));
    $("fileList").appendChild(up);
  }
  try {
    const rows = await window.editcoreProject.list(state.projectRoot, viewPath);
    if (renderToken !== state.fileListRenderToken) return;
    const seen = new Set();
    for (const row of rows) {
      const key = String(row.path || row.name || "").replace(/\\/g, "/").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-item ${row.kind}`;
      button.dataset.fileName = String(row.name || "");
      button.dataset.filePath = String(row.path || "").replace(/\\/g, "/");
      button.dataset.fileAbs = String(row.absolutePath || "");
      button.dataset.fileKind = String(row.kind || "file");
      const touched = isFileRowTouched(row, viewPath);
      if (touched) {
        button.classList.add("is-touched");
        if (row.kind === "file") button.classList.add("is-new");
      }
      const writingName = state.fileListWritingNames.includes(String(row.name || "").toLowerCase());
      if (writingName && row.kind === "file") button.classList.add("is-writing");
      // Bolita anclada a la izquierda del panel; nombre/carpeta a la derecha.
      const dot = document.createElement("span");
      dot.className = writingName
        ? "file-item-dot is-writing-dot"
        : (touched ? "file-item-dot" : "file-item-dot is-idle");
      dot.title = touched ? (writingName ? "Escribiendo…" : "Modificado por el agente") : "";
      dot.setAttribute("aria-hidden", "true");
      button.appendChild(dot);
      const label = document.createElement("span");
      label.className = "file-item-label";
      label.textContent = `${fileIcon(row.kind)} ${row.name}`;
      button.appendChild(label);
      button.onclick = () => {
        if (row.kind === "directory") {
          renderProjectFiles(row.path);
        } else {
          openPathInEditor(row.path).catch((error) => {
            $("status").textContent = error?.message || String(error);
            if (/\.html?$/i.test(row.name) && row.absolutePath) {
              window.EditCoreEditor?.showWebMode?.();
              $("previewWebview").src = `file:///${row.absolutePath.replace(/\\/g, "/")}`;
            }
          });
        }
      };
      $("fileList").appendChild(button);
    }
    if (!viewPath) {
      const project = activeProject();
      if (project) {
        const visible = rows.filter((row) => row?.name && !String(row.name).startsWith("."));
        const nextIncomplete = visible.length < 8;
        if (project.scaffoldIncomplete !== nextIncomplete) {
          project.scaffoldIncomplete = nextIncomplete;
          saveProjects();
        }
      }
    }
  } catch (error) {
    if (renderToken !== state.fileListRenderToken) return;
    const item = document.createElement("div");
    item.className = "file-empty";
    item.textContent = error?.message || String(error);
    $("fileList").appendChild(item);
  }
}

async function pickProject() {
  const picked = await window.editcoreProject.pick();
  if (!picked) return;
  const project = projectForRoot(picked);
  await selectProject(project.id);
  localStorage.setItem("editcore-project-root", picked);
}

function findCatalogProjectByName(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  const exact = state.projects.find((project) => {
    if (!project?.projectRoot) return false;
    const title = String(project.title || "").trim().toLowerCase();
    const folder = String(project.projectRoot || "").split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() || "";
    return title === needle || folder === needle;
  });
  if (exact) return exact;
  return state.projects.find((project) => {
    if (!project?.projectRoot) return false;
    const title = String(project.title || "").trim().toLowerCase();
    const folder = String(project.projectRoot || "").split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() || "";
    return title.includes(needle) || folder.includes(needle);
  }) || null;
}

async function resolveProjectRootFromPrompt(prompt) {
  const absoluteHints = ProjectAnalysis.extractAbsolutePathHints?.(prompt) || [];
  const name = ProjectAnalysis.extractReferencedProjectName?.(prompt)
    || ProjectAnalysis.extractOpenProjectName?.(prompt)
    || "";
  const aliasKey = ProjectAnalysis.knownFolderAliasKey?.(name) || "";
  await refreshProjectCatalog().catch(() => undefined);

  let root = "";
  let label = name;
  if (absoluteHints.length) {
    root = String(absoluteHints[0] || "").trim();
    label = root.split(/[\\/]/).filter(Boolean).pop() || root;
  } else if (aliasKey && window.editcoreProject?.resolveSpecialFolder) {
    root = String(await window.editcoreProject.resolveSpecialFolder(aliasKey).catch(() => "") || "").trim();
    label = name || aliasKey;
  } else if (name) {
    const match = findCatalogProjectByName(name);
    root = match?.projectRoot || "";
    // Nunca inventar D:\...\porque si no existe en catálogo / disco.
    if (!root) {
      const parent = String(state.lastListedRoot || projectCatalogParent() || "").trim();
      if (parent && window.editcoreProject?.list) {
        const candidate = ProjectAnalysis.resolveNamedProjectPath?.(name, parent) || "";
        if (candidate) {
          try {
            await window.editcoreProject.list(candidate, "");
            root = candidate;
          } catch {
            root = "";
          }
        }
      }
    }
  }
  return { root, label, name };
}

/**
 * Abre un proyecto. Por defecto NO ensucia el chat con la ruta:
 * la ruta vive en la barra de estado / selector; el chat es para progreso del agente.
 */
async function openNamedProjectFromPrompt(prompt, options = {}) {
  const silent = options.silent === true || options.continueWork === true;
  const continueWork = options.continueWork === true;
  const { root, label, name } = await resolveProjectRootFromPrompt(prompt);

  if (!root && !name && !ProjectAnalysis.extractAbsolutePathHints?.(prompt)?.length) {
    // "abre" sin nombre → dialogo Abrir
    if (!silent) {
      appendUserWithImages(prompt, []);
      rememberMessage("user", prompt);
    }
    try {
      const picked = await window.editcoreProject.pick();
      if (!picked) {
        if (!silent) {
          const response = "Cancelaste el dialogo. Usa Abrir o indica un nombre (ej. TAXIDRIV).";
          const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
          append("assistant", response, usage, true, 0);
          rememberMessage("assistant", response, usage);
        }
        return { handled: true, opened: false, continueWork: false };
      }
      const project = projectForRoot(picked);
      await selectProject(project.id);
      localStorage.setItem("editcore-project-root", picked);
      $("status").textContent = `Proyecto activo: ${projectDisplayName(project)}`;
      if (!silent && !continueWork) {
        const response = `Proyecto activo: **${projectDisplayName(project)}**. Dime qué analizamos o corregimos.`;
        const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
        append("assistant", response, usage, true, 0);
        rememberMessage("assistant", response, usage);
      }
      return { handled: !continueWork, opened: true, continueWork, project };
    } catch (error) {
      if (!silent) {
        const response = `No pude abrir la carpeta: ${error?.message || error}`;
        const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
        append("assistant", response, usage, true, 0);
        rememberMessage("assistant", response, usage);
      }
      return { handled: true, opened: false, continueWork: false };
    }
  }

  if (!root) {
    if (!silent) {
      appendUserWithImages(prompt, []);
      rememberMessage("user", prompt);
      const response = name
        ? `No encontre "${name}". Usa Abrir o la ruta completa.`
        : "Indica un proyecto del catalogo (ej. TAXIDRIV) o usa Abrir.";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
    }
    $("status").textContent = "Proyecto no encontrado";
    return { handled: true, opened: false, continueWork: false };
  }

  if (normalizeProjectRoot(root) === normalizeProjectRoot(projectCatalogParent())) {
    if (!silent) {
      appendUserWithImages(prompt, []);
      rememberMessage("user", prompt);
      const response = "Abre un proyecto hijo del catalogo (ej. TAXIDRIV), no la carpeta padre.";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
    }
    return { handled: true, opened: false, continueWork: false };
  }

  const project = projectForRoot(root, label);
  if (!silent && !continueWork) {
    appendUserWithImages(prompt, []);
    rememberMessage("user", prompt);
  }
  try {
    await selectProject(project.id);
    localStorage.setItem("editcore-project-root", root);
    $("status").textContent = `Proyecto activo: ${projectDisplayName(project)}`;
    if (!silent && !continueWork) {
      // Sin volcar la ruta en el chat: el progreso del agente es lo que importa.
      const response = `Proyecto activo: **${projectDisplayName(project)}**. Dime qué analizamos o corregimos.`;
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
    }
    return { handled: !continueWork, opened: true, continueWork, project, root };
  } catch (error) {
    if (!silent) {
      const response = `No pude activar **${label || root}**: ${error?.message || error}`;
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
    }
    $("status").textContent = "No se pudo abrir el proyecto";
    return { handled: true, opened: false, continueWork: false };
  }
}

async function applyProjectUiCommand(cmd = {}) {
  const requestId = String(cmd.requestId || "");
  const action = String(cmd.action || "").toLowerCase();
  const reply = (payload) => {
    if (!requestId || !window.editcoreProject?.replyUiCommand) return;
    return window.editcoreProject.replyUiCommand({ requestId, action, ...payload });
  };
  try {
    if (action === "close") {
      const previousRoot = String(state.projectRoot || "").trim();
      const previousLabel = projectDisplayName(activeProject()) || previousRoot.split(/[\\/]/).filter(Boolean).pop() || "";
      if (!previousRoot) {
        await reply({ ok: false, projectRoot: "", label: "", error: "No hay proyecto abierto." });
        return;
      }
      await closeOpenProject({
        message: `Proyecto **${previousLabel}** cerrado por el agente.\n\nPanel derecho: Sin proyecto.`,
        cancelAgent: cmd.cancelAgent !== false ? true : false,
        quiet: cmd.cancelAgent === false,
      });
      // Si quiet, aun asi informar en status; el agente narra el resultado.
      if (cmd.cancelAgent === false) {
        $("status").textContent = `Cerrado: ${previousLabel}`;
      }
      await reply({ ok: true, projectRoot: previousRoot, previousRoot, label: previousLabel });
      return;
    }
    if (action === "open") {
      const root = String(cmd.path || "").trim();
      if (!root) {
        await reply({ ok: false, error: "Falta path para open_project." });
        return;
      }
      if (normalizeProjectRoot(root) === normalizeProjectRoot(projectCatalogParent())) {
        await reply({ ok: false, error: "La carpeta catalogo no se abre como un solo proyecto." });
        return;
      }
      // Al abrir otra carpeta sin switch, detener preview del proyecto anterior.
      const priorRoot = String(state.projectRoot || "").trim();
      if (priorRoot && normalizeProjectRoot(priorRoot) !== normalizeProjectRoot(root)) {
        try { await window.editcoreAgent?.cancel?.({}); } catch { /* ignore */ }
        if (window.editcoreProject?.stopPreview) {
          window.editcoreProject.stopPreview(priorRoot).catch(() => undefined);
        }
      }
      const label = String(cmd.name || "").trim() || root.split(/[\\/]/).filter(Boolean).pop() || root;
      const project = projectForRoot(root, label);
      await selectProject(project.id);
      localStorage.setItem("editcore-project-root", root);
      await reply({
        ok: true,
        projectRoot: project.projectRoot,
        label: projectDisplayName(project),
      });
      return;
    }
    if (action === "switch") {
      const result = await switchOpenProject({
        targetPath: String(cmd.path || "").trim(),
        name: String(cmd.name || "").trim(),
        publishFirst: cmd.publishFirst === true || cmd.autoPublish === true,
        cancelAgent: false,
        fromAgent: true,
      });
      await reply({
        ok: result.ok === true,
        projectRoot: result.projectRoot || "",
        previousRoot: result.previousRoot || "",
        label: result.label || "",
        published: result.published === true,
        publishMessage: result.publishMessage || "",
        error: result.error || "",
      });
      return;
    }
    await reply({ ok: false, error: `Accion UI desconocida: ${action}` });
  } catch (error) {
    await reply({ ok: false, error: error?.message || String(error) });
  }
}

function projectUrlKey(rootPath) {
  return `editcore-browser-url-${rootPath}`;
}

let projectKnowledgeTimer = null;
function scheduleProjectKnowledgeRefresh(projectRoot) {
  const root = String(projectRoot || "").trim();
  if (!root) return;
  if (projectKnowledgeTimer) clearTimeout(projectKnowledgeTimer);
  const run = async () => {
    if (root !== state.projectRoot) return;
    await window.editcoreBrain?.index(root, {}).catch(() => undefined);
    if (root === state.projectRoot) await refreshInspectorForProject({ silent: true }).catch(() => undefined);
  };
  projectKnowledgeTimer = setTimeout(run, 2_000);
}

let previewExpectedUrl = "";
let previewNavigationId = 0;
let projectSelectionId = 0;
let previewHealthCheckPending = false;
let previewRecoveryPromise = null;
let previewRecoveryFailures = 0;
let previewRecoveryBlockedUntil = 0;
let previewDocumentValidationId = 0;
let newWindowOpening = false;
let previewNavigationHistory = [];
let previewHistoryIndex = -1;
let previewHistoryNavigating = false;
let previewLastSuccessfulUrl = "";
const PREVIEW_PARTITION = "persist:editcore-browser";

function normalizedPreviewUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "") || "/"}${url.search}${url.hash}`;
  } catch {
    return String(value || "").trim();
  }
}

function currentPreviewUrl(webview) {
  try { return webview.getURL?.() || ""; } catch { return ""; }
}

function previewOrigin(value) {
  try { return new URL(String(value || "")).origin; } catch { return ""; }
}

function previewEventMatches(webview, event = {}) {
  const candidates = [event.url, currentPreviewUrl(webview), webview.getAttribute("src")];
  const expectedOrigin = previewOrigin(previewExpectedUrl);
  return candidates.some((candidate) => {
    const normalized = normalizedPreviewUrl(candidate);
    return normalized === previewExpectedUrl
      || Boolean(expectedOrigin && previewOrigin(normalized) === expectedOrigin);
  });
}

function updatePreviewNavigationControls(webview = $("previewWebview")) {
  let canGoBack = false;
  try { canGoBack = Boolean(webview?.canGoBack?.()); } catch {}
  $("previewBackBtn").disabled = !(canGoBack || previewHistoryIndex > 0);
}

function syncPreviewNavigation(webview, event = {}) {
  const value = String(event.url || currentPreviewUrl(webview) || "").trim();
  let parsed;
  try { parsed = new URL(value); } catch { return; }
  if (!["http:", "https:"].includes(parsed.protocol)) return;
  previewExpectedUrl = normalizedPreviewUrl(parsed.href);
  if (previewHistoryNavigating) {
    previewHistoryNavigating = false;
    const knownIndex = previewNavigationHistory.lastIndexOf(previewExpectedUrl);
    if (knownIndex >= 0) previewHistoryIndex = knownIndex;
    else if (previewHistoryIndex >= 0) previewNavigationHistory[previewHistoryIndex] = previewExpectedUrl;
  } else if (previewNavigationHistory[previewHistoryIndex] !== previewExpectedUrl) {
    previewNavigationHistory = previewNavigationHistory.slice(0, previewHistoryIndex + 1);
    previewNavigationHistory.push(previewExpectedUrl);
    previewHistoryIndex = previewNavigationHistory.length - 1;
  }
  $("previewUrl").value = parsed.href;
  if (state.projectRoot) localStorage.setItem(projectUrlKey(state.projectRoot), parsed.href);
  updatePreviewNavigationControls(webview);
}

function navigatePreviewHistory(targetIndex) {
  const webview = $("previewWebview");
  const targetUrl = previewNavigationHistory[targetIndex];
  if (!targetUrl || targetIndex < 0 || targetIndex >= previewNavigationHistory.length) {
    updatePreviewNavigationControls(webview);
    return;
  }
  previewHistoryIndex = targetIndex;
  previewHistoryNavigating = true;
  previewExpectedUrl = normalizedPreviewUrl(targetUrl);
  previewNavigationId += 1;
  webview.dataset.previewReady = "0";
  $("previewUrl").value = targetUrl;
  if (state.projectRoot) localStorage.setItem(projectUrlKey(state.projectRoot), targetUrl);
  showPreviewLoading("Cargando pagina anterior...");
  updatePreviewNavigationControls(webview);
  // src en lugar de loadURL: loadURL cruza GUEST_VIEW_MANAGER_CALL y el proceso
  // principal registra el rechazo antes de que el .catch del renderer corra, asi
  // que un ERR_ABORTED normal (una redireccion) ensuciaba el log como si fuera
  // un fallo y tapaba los errores de verdad.
  webview.setAttribute("src", targetUrl);
}

function restoreLastSuccessfulPreview(webview, failedUrl) {
  const recoveryUrl = normalizedPreviewUrl(previewLastSuccessfulUrl);
  if (!recoveryUrl || recoveryUrl === normalizedPreviewUrl(failedUrl)) return false;
  const knownIndex = previewNavigationHistory.lastIndexOf(recoveryUrl);
  if (knownIndex >= 0) previewHistoryIndex = knownIndex;
  previewHistoryNavigating = true;
  previewExpectedUrl = recoveryUrl;
  $("previewUrl").value = recoveryUrl;
  showPreviewLoading("Restaurando la ultima pagina disponible...");
  setTimeout(() => {
    webview.setAttribute("src", recoveryUrl);
  }, 0);
  return true;
}

function showPreviewStatus(message, { clearDocument = false } = {}) {
  $("previewStatus").textContent = message;
  $("previewStatus").classList.remove("hidden");
  if (clearDocument) $("previewWebview").setAttribute("src", "about:blank");
}

function resetPreview(message = "Iniciando navegador del proyecto...") {
  previewExpectedUrl = "";
  previewNavigationId += 1;
  previewNavigationHistory = [];
  previewHistoryIndex = -1;
  previewHistoryNavigating = false;
  previewLastSuccessfulUrl = "";
  previewRecoveryFailures = 0;
  previewRecoveryBlockedUntil = 0;
  $("previewUrl").value = "";
  $("previewStatus").textContent = message;
  $("previewStatus").classList.remove("hidden");
  $("previewWebview").setAttribute("src", "about:blank");
  updatePreviewNavigationControls();
}

async function openPreview({ forceReload = false } = {}) {
  let raw = $("previewUrl").value.trim();
  if (!raw) { showPreviewStatus("Abre un proyecto con servidor para visualizarlo aqui."); return; }
  // A stored localhost URL can outlive the dev-server process. Recover it
  // before asking the webview to load a dead endpoint.
  if (state.projectRoot && !isRemotePreviewUrl(raw) && window.editcoreProject?.previewHealth) {
    const health = await window.editcoreProject.previewHealth(state.projectRoot).catch(() => ({ available: false }));
    if (!health?.available) {
      const preview = await window.editcoreProject.startPreview(state.projectRoot).catch((error) => ({
        available: false,
        message: error?.message || String(error),
      }));
      if (!preview?.available || !preview.url) {
        showPreviewStatus(preview?.message || "El servidor del proyecto no esta disponible.");
        return;
      }
      raw = preview.url;
      $("previewUrl").value = raw;
    }
  }
  let url;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("URL no permitida");
    url = parsed.href;
  } catch {
    showPreviewStatus("La vista previa solo permite URLs HTTP/HTTPS sin credenciales incrustadas.");
    return;
  }
  const webview = $("previewWebview");
  if (!webview) {
    showPreviewStatus("No se encontro el navegador interno.");
    return;
  }

  if (state.projectRoot) {
    localStorage.setItem(projectUrlKey(state.projectRoot), url);
  }

  const navigationId = ++previewNavigationId;
  previewExpectedUrl = normalizedPreviewUrl(url);
  previewNavigationHistory = [previewExpectedUrl];
  previewHistoryIndex = 0;
  previewHistoryNavigating = false;
  webview.dataset.previewReady = "0";
  showPreviewLoading("Cargando navegador del proyecto...");

  const navigate = async () => {
    if (navigationId !== previewNavigationId) return;
    if (forceReload && normalizedPreviewUrl(currentPreviewUrl(webview)) === previewExpectedUrl
      && typeof webview.reloadIgnoringCache === "function") {
      try {
        webview.reloadIgnoringCache();
        return;
      } catch { /* fall through */ }
    }
    if (typeof webview.loadURL === "function") {
      try {
        await webview.loadURL(url);
        return;
      } catch { /* fall through */ }
    }
    webview.setAttribute("src", url);
  };

  try {
    await navigate();
  } catch (error) {
    showPreviewStatus(`No se pudo abrir el navegador: ${error?.message || error}`);
    return;
  }

  // Seguridad: si settlePreviewDocument no confirma, no dejar overlay eterno.
  setTimeout(() => {
    if (navigationId !== previewNavigationId) return;
    const current = currentPreviewUrl(webview);
    if ($("previewStatus")?.classList.contains("hidden")) return;
    if (previewOrigin(current) === previewOrigin(previewExpectedUrl) && current && current !== "about:blank") {
      webview.dataset.previewReady = "1";
      $("previewStatus")?.classList.add("hidden");
    }
  }, 4000);
}

function showPreviewLoading(message = "Cargando navegador del proyecto...") {
  $("previewStatus").textContent = message;
  $("previewStatus").classList.remove("hidden");
}

function hidePreviewLoading() {
  $("previewStatus")?.classList.add("hidden");
}

function isRemotePreviewUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function monitorPreviewHealth({ forceRecovery = false } = {}) {
  if (!state.projectRoot || !window.editcoreProject?.previewHealth || previewHealthCheckPending) return;
  if (previewRecoveryPromise) return previewRecoveryPromise;
  if (!forceRecovery && Date.now() < previewRecoveryBlockedUntil) return;
  const selectionId = projectSelectionId;
  const rootAtStart = String(state.projectRoot);
  const activeUrl = currentPreviewUrl($("previewWebview")) || $("previewUrl").value;
  if (isRemotePreviewUrl(activeUrl)) return;
  previewHealthCheckPending = true;
  previewRecoveryPromise = (async () => { try {
    const health = await window.editcoreProject.previewHealth(rootAtStart);
    if (health?.available && !forceRecovery) return;
    const preview = await window.editcoreProject.startPreview(rootAtStart);
    if (!preview?.available) return;
    if (selectionId !== projectSelectionId || normalizeProjectRoot(state.projectRoot) !== normalizeProjectRoot(rootAtStart)) return;
    $("previewUrl").value = preview.url;
    showPreviewLoading("Cargando navegador del proyecto...");
    await openPreview({ forceReload: true });
    previewRecoveryFailures = 0;
    previewRecoveryBlockedUntil = 0;
    $("status").textContent = "Navegador del proyecto recuperado";
  } catch (error) {
    previewRecoveryFailures += 1;
    if (previewRecoveryFailures >= 2) previewRecoveryBlockedUntil = Date.now() + 60_000;
    const message = error?.message || String(error);
    showPreviewStatus(`No se pudo abrir el navegador del proyecto. ${message}`);
    $("status").textContent = "Navegador del proyecto no disponible";
  } finally {
    previewHealthCheckPending = false;
    previewRecoveryPromise = null;
  } })();
  return previewRecoveryPromise;
}

async function renderedPreviewIsDocument(webview) {
  try {
    const snapshot = await webview.executeJavaScript(`(() => {
      const contentType = String(document.contentType || "").toLowerCase();
      const body = document.body;
      const html = String(document.documentElement?.outerHTML || "").slice(0, 8000);
      const text = String(body?.innerText || "").trim().slice(0, 4000);
      const onlyPre = Boolean(body && body.children.length === 1 && body.firstElementChild?.tagName === "PRE");
      const normalizedText = text.toLowerCase();
      const apiDocument = normalizedText.includes('"swagger"')
        || normalizedText.includes('"openapi"')
        || normalizedText.includes("postgrest")
        || normalizedText.includes("application/vnd.pgrst");
      const serverError = /internal server error|application error|failed to compile|module not found|enoent|cannot find module/i.test(text + "\\n" + html);
      const nextShell = Boolean(
        document.getElementById("__next")
        || document.querySelector("[data-nextjs-scroll-focus-boundary], nextjs-portal, #__next-build-watcher")
        || /__NEXT_DATA__|\\/_next\\/static/i.test(html)
      );
      const viteShell = Boolean(
        document.getElementById("root")
        || document.getElementById("app")
        || document.getElementById("__nuxt")
        || document.querySelector('script[type="module"][src*="/src/"], script[src*="/@vite/client"], script[src*="vite"]')
        || /@vite\/client|<div id="root"|<div id="app"/i.test(html)
      );
      const renderedElements = body ? body.querySelectorAll("body *").length : 0;
      const visibleText = text.length > 0;
      const visibleElement = Boolean(body && [...body.querySelectorAll("body *")].some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      }));
      return {
        contentType,
        onlyPre,
        apiDocument,
        serverError,
        nextShell,
        viteShell,
        renderedElements,
        hasVisibleContent: visibleText || visibleElement,
      };
    })()`);
    if (!/(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(String(snapshot?.contentType || ""))) return false;
    if (snapshot?.onlyPre && snapshot?.apiDocument) return "api";
    if (snapshot?.serverError) return "server-error";
    if (snapshot?.hasVisibleContent) return "ready";
    // Vite / Next.js: shell inicial vacio (#root / #app / #__next) sin paint aún → esperar compilación
    if (snapshot?.nextShell || snapshot?.viteShell) return "loading";
    return "blank";
  } catch {
    return false;
  }
}

async function settlePreviewDocument() {
  const webview = $("previewWebview");
  if (!previewEventMatches(webview)) return;
  const navigationId = previewNavigationId;
  const validationId = ++previewDocumentValidationId;
  let documentState = await renderedPreviewIsDocument(webview);
  // Vite/Next: primer paint suele ser shell vacio mientras compila; esperar mas antes de fallar.
  if (documentState === "blank" || documentState === "loading") {
    showPreviewLoading(documentState === "loading"
      ? "El servidor de desarrollo está cargando la aplicación..."
      : "Esperando a que la aplicacion pinte contenido...");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 150));
      if (validationId !== previewDocumentValidationId || navigationId !== previewNavigationId || !previewEventMatches(webview)) return;
      documentState = await renderedPreviewIsDocument(webview);
      if (documentState === "ready" || documentState === "api" || documentState === "server-error" || documentState === false) break;
    }
  }
  if (validationId !== previewDocumentValidationId || navigationId !== previewNavigationId || !previewEventMatches(webview)) return;
  if (documentState === "api") {
    webview.dataset.previewReady = "0";
    webview.dataset.previewRejected = "api-document";
    previewExpectedUrl = "";
    showPreviewStatus("La direccion respondio con datos de API, no con la pagina del proyecto. Recuperando el navegador...", { clearDocument: true });
    void monitorPreviewHealth({ forceRecovery: true });
    return;
  }
  if (documentState === "server-error") {
    webview.dataset.previewReady = "0";
    showPreviewStatus("El servidor del proyecto respondio con error (posible caché .next). Reparando automáticamente...");
    $("status").textContent = "Preview: error de servidor · auto-heal";
    if (state.projectRoot && window.editcoreInspector?.localHeal) {
      window.editcoreInspector.localHeal("project", state.projectRoot, `preview-heal-${Date.now()}`)
        .then((heal) => {
          const msg = heal?.uiMessage || (heal?.ok ? "Caché de Next.js regenerada exitosamente" : "Heal incompleto");
          $("status").textContent = msg;
          if (heal?.ok) refreshPreview().catch(() => undefined);
        })
        .catch(() => undefined);
    } else {
      void monitorPreviewHealth({ forceRecovery: true });
    }
    return;
  }
  if (documentState === "blank" || documentState === "loading") {
    // Si el webview tiene URL activa local o coincide con el origen esperado, conectar y quitar overlay
    const current = currentPreviewUrl(webview);
    if (current && current !== "about:blank") {
      webview.dataset.previewReady = "1";
      previewLastSuccessfulUrl = normalizedPreviewUrl(current);
      $("previewStatus").classList.add("hidden");
      $("status").textContent = "Navegador conectado";
      return;
    }
    webview.dataset.previewReady = "0";
    const root = String(state.projectRoot || "").toLowerCase();
    const isEditCoreDesktop = /editcoreai|editcore\s*ai|\\resources\\app(\\|$)/i.test(root)
      || /editcoreai$|editcore ai$/i.test(root.replace(/[\\/]+$/, ""));
    showPreviewStatus(isEditCoreDesktop
      ? "Este proyecto es EditCoreAI (app de escritorio). El panel Web no aplica; usa el chat a la izquierda."
      : "El servidor respondio, pero la aplicacion no mostro contenido. Revisa el error de inicio del proyecto.");
    $("status").textContent = isEditCoreDesktop
      ? "Preview web no aplica a EditCoreAI desktop"
      : "El proyecto abrio una pagina vacia";
    void monitorPreviewHealth({ forceRecovery: false });
    return;
  }
  if (documentState !== "ready") {
    const current = currentPreviewUrl(webview);
    if (current && current !== "about:blank") {
      webview.dataset.previewReady = "1";
      previewLastSuccessfulUrl = normalizedPreviewUrl(current);
      $("previewStatus").classList.add("hidden");
    }
    return;
  }
  webview.dataset.previewReady = "1";
  previewLastSuccessfulUrl = normalizedPreviewUrl(currentPreviewUrl(webview) || previewExpectedUrl);
  $("previewStatus").classList.add("hidden");
}

async function fitPreviewToPanel() {
  const panel = document.querySelector(".viewer-body");
  const webview = $("previewWebview");
  if (!panel || !webview) return;
  // CSS owns the geometry. Remove dimensions persisted by older builds so the
  // guest view always follows the complete browser panel after a resize.
  for (const property of ["width", "height", "left", "top", "right", "bottom", "transform"]) {
    webview.style.removeProperty(property);
  }
  const panelRect = panel.getBoundingClientRect();
  const previewMode = document.querySelector(".viewer")?.dataset.previewMode === "mobile" ? "mobile" : "web";
  const zoom = previewMode === "mobile"
    ? 1
    : Math.max(0.5, Math.min(1, panelRect.width / DESKTOP_PREVIEW_WIDTH));
  try { webview.setZoomFactor(zoom); } catch {}
  webview.dataset.fitZoom = String(zoom);
  webview.dataset.cssViewportWidth = String(Math.round(panelRect.width / zoom));
  webview.dataset.panelWidth = String(Math.round(panelRect.width));
  webview.dataset.panelHeight = String(Math.round(panelRect.height));
}

function schedulePreviewFit() { requestAnimationFrame(() => fitPreviewToPanel()); }

function setPreviewMode(mode) {
  // Código = Monaco encima; Web/Móvil = preview. El webview NUNCA se destruye.
  const next = mode === "code" ? "code" : (mode === "mobile" ? "mobile" : "web");
  try {
    localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, next);
  } catch { /* ignore */ }
  const viewer = document.querySelector(".viewer");
  if (viewer) viewer.dataset.previewMode = next === "code" ? "web" : next;

  $("webPreviewBtn")?.classList.toggle("active", next === "web");
  $("mobilePreviewBtn")?.classList.toggle("active", next === "mobile");
  $("codePreviewBtn")?.classList.toggle("active", next === "code");

  if (next === "code") {
    document.body.classList.add("ide-code-mode");
    document.body.classList.remove("ide-web-mode");
    window.EditCoreEditor?.showCodeModeAsync?.().catch((error) => {
      $("status").textContent = `Código: ${error?.message || error}`;
    });
    return;
  }

  document.body.classList.remove("ide-code-mode");
  document.body.classList.add("ide-web-mode");
  window.EditCoreEditor?.showWebMode?.();
  schedulePreviewFit();
}

async function openNewWindow() {
  if (newWindowOpening) return;
  newWindowOpening = true;
  const button = $("newWindowBtn");
  button.disabled = true;
  try {
    const result = await window.editcoreWindow.open();
    if (result && result.ok === false) {
      $("status").textContent = result.reason || `Maximo ${result.max || 4} ventanas`;
      return;
    }
    if (typeof window.editcoreWindow.status === "function") {
      const status = await window.editcoreWindow.status();
      if (status?.count != null) {
        button.title = `Nueva ventana (${status.count}/${status.max || 4})`;
      }
    }
  } catch (error) {
    $("status").textContent = error?.message || String(error);
  } finally {
    newWindowOpening = false;
    button.disabled = false;
  }
}

async function refreshPreview() {
  const button = $("openPreviewBtn");
  button?.classList.add("refreshing");
  button.disabled = true;
  const selectionId = projectSelectionId;
  const rootAtStart = String(state.projectRoot || "");
  try {
    if (!rootAtStart) {
      showPreviewStatus("Abre un proyecto para conectar su navegador.");
      return;
    }
    const stale = String($("previewUrl")?.value || "").trim();
    showPreviewLoading("Iniciando servidor del proyecto...");
    const preview = await window.editcoreProject.startPreview(rootAtStart);
    if (selectionId !== projectSelectionId || normalizeProjectRoot(state.projectRoot) !== normalizeProjectRoot(rootAtStart)) return;
    if (!preview?.available) { showPreviewStatus(preview?.message || "No se pudo iniciar el preview."); return; }
    let url = String(preview.url || "").replace(/\/$/, "");
    // Conservar subruta del mismo proyecto (si la había); nunca forzar rutas de otro app.
    try {
      if (stale) {
        const prev = new URL(stale.includes("://") ? stale : `http://127.0.0.1${stale.startsWith("/") ? stale : `/${stale}`}`);
        if (prev.pathname && prev.pathname !== "/") {
          url = `${url}${prev.pathname}${prev.search || ""}`;
        }
      }
    } catch { /* ignore */ }
    $("previewUrl").value = url;
    await openPreview({ forceReload: true });
    $("status").textContent = `Navegador → ${url}`;
  } catch (error) {
    showPreviewStatus("No se pudo actualizar: " + (error?.message || String(error)));
  } finally {
    button?.classList.remove("refreshing");
    button.disabled = false;
  }
}

function setupSplitter(splitterId) {
  const splitter = $(splitterId);
  if (!splitter) return;
  let dragging = false;
  let fixedBoundary = 0;
  splitter.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    if (splitterId === "splitChatBrowser") {
      const rightSplitter = $("splitBrowserProjects");
      fixedBoundary = document.body.classList.contains("projects-collapsed")
        ? document.body.getBoundingClientRect().right
        : rightSplitter.getBoundingClientRect().left;
    }
    splitter.classList.add("dragging");
    try { splitter.setPointerCapture(e.pointerId); } catch {}
  });
  splitter.addEventListener("pointerup", (e) => {
    dragging = false;
    splitter.classList.remove("dragging");
    try { splitter.releasePointerCapture(e.pointerId); } catch {}
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const bodyRect = document.body.getBoundingClientRect();
    const w = bodyRect.width;
    const x = e.clientX - bodyRect.left;
    const splitterWidth = splitter.offsetWidth || 3;
    if (splitterId === "splitChatBrowser") {
      const boundary = fixedBoundary - bodyRect.left;
      const chat = Math.max(430, Math.min(boundary - splitterWidth - 280, x));
      const browser = Math.max(280, boundary - chat - splitterWidth);
      document.body.style.setProperty("--chat-width", `${chat}px`);
      document.body.style.setProperty("--browser-width", `${browser}px`);
      localStorage.setItem("--chat-width", `${chat}px`);
      localStorage.setItem("--browser-width", `${browser}px`);
    } else {
      const collapsed = document.body.classList.contains("projects-collapsed");
      if (!collapsed) {
        const browserLeft = document.querySelector(".viewer").getBoundingClientRect().left - bodyRect.left;
        const divider = Math.max(browserLeft + 280, Math.min(w - splitterWidth - 260, x));
        const browser = divider - browserLeft;
        document.body.style.setProperty("--browser-width", `${browser}px`);
        localStorage.setItem("--browser-width", `${browser}px`);
      }
    }
  });
}

function loadPanelSizes() {
  if (!localStorage.getItem("editcore-layout-reset-252-files")) {
    localStorage.removeItem("--chat-width");
    localStorage.removeItem("--browser-width");
    localStorage.setItem("editcore-layout-reset-252-files", "true");
  }
  const chat = localStorage.getItem("--chat-width");
  const browser = localStorage.getItem("--browser-width");
  if (chat) document.body.style.setProperty("--chat-width", chat);
  if (browser) document.body.style.setProperty("--browser-width", browser);
}

async function selectProject(id, options = {}) {
  const selected = state.projects.find((project) => project.id === id) || null;
  if (!selected?.projectRoot) throw new Error("Selecciona una carpeta de proyecto valida.");
  if (normalizeProjectRoot(selected.projectRoot) === normalizeProjectRoot(projectCatalogParent())) {
    throw new Error("Selecciona un proyecto por su nombre; la carpeta que contiene todos los proyectos no puede abrirse como proyecto.");
  }
  hideWelcomeScreen();
  // Recuperar chat durable del disco del proyecto (.editcore/chats.json).
  await hydrateProjectChatsFromDisk(selected);
  const wasActiveProject = state.activeProjectId === id;
  const selectionId = ++projectSelectionId;
  state.activeProjectId = id;
  state.projectRoot = selected.projectRoot;
  selected.lastOpenedAt = Date.now();
  selected.updatedAt = Date.now();
  selected.catalogEntry = false;
  touchRecentProjectRoot(selected.projectRoot);
  state.fileListRelativePath = "";
  updateCloseProjectButton();
  syncPreviewChromeForTheme();
  if ($("connectionsDialog")?.open) loadConnections();
  // Preview solo en IDE: en Chat Home arrancar servidor frena UI y navegación.
  const wantPreview = options.preview !== false && document.body.dataset.appMode !== "chat";
  if (wantPreview) {
    resetPreview("Iniciando servidor del proyecto...");
  }
  $("projectPathLabel").textContent = selected.projectRoot;
  if (options.render !== false) {
    saveProjects({ immediate: true });
    renderProjects();
    renderWelcomeRecents();
    const preserveLiveChat = !options.force
      && wasActiveProject
      && (activePromptRequests.size > 0 || activeAgentThinkingRuns.size > 0 || document.querySelector(".thinking-msg"));
    if (!preserveLiveChat) renderFeed({ force: options.force });
    syncChatModelFromConfig();
  } else {
    try { saveProjects({ immediate: true }); } catch { /* ignore */ }
  }
  try {
    window.dispatchEvent(new CustomEvent("editcore:project-updated", { detail: { projectId: selected.id, projectRoot: selected.projectRoot } }));
    window.dispatchEvent(new CustomEvent("editcore:chats-updated", { detail: { projectId: selected.id, activeChatId: selected.activeChatId } }));
    window.EditCoreChatHome?.refresh?.();
  } catch { /* ignore */ }
  const project = activeProject();
  // Preview / archivos en background: el clic no debe esperar al servidor.
  void (async () => {
    if (project?.projectRoot && (project?.gafcoreProjectId || project?.provider === "custom:gafcore-gateway")) {
      delete project.gafcoreProjectId;
      delete project.gafcoreProjectName;
      delete project.gafcoreConnectedAt;
      delete project.gafcoreModelCount;
      if (project.provider === "custom:gafcore-gateway") {
        project.provider = "meai";
        project.providerProfileId = "";
      }
      saveProjects();
      try { await addGafCoreGateway(); } catch { /* ignore */ }
    }
    if (!project?.projectRoot) return;
    if (selectionId !== projectSelectionId || activeProject()?.id !== project.id) return;
    state.projectRoot = project.projectRoot;
    $("projectPathLabel").textContent = project.projectRoot;
    if (!wantPreview) {
      // Chat Home: no listar archivos ni levantar preview hasta entrar al IDE.
      try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
      return;
    }
    renderProjectFiles("").catch(() => undefined);
    try {
      const preview = await window.editcoreProject.startPreview(project.projectRoot);
      if (selectionId !== projectSelectionId || activeProject()?.id !== project.id || normalizeProjectRoot(state.projectRoot) !== normalizeProjectRoot(project.projectRoot)) return;
      if (!preview?.available) {
        showPreviewStatus(preview?.message || "No se pudo iniciar el navegador del proyecto.");
        $("status").textContent = "Servidor no iniciado";
      } else {
        $("previewUrl").value = preview.url;
        await openPreview({ forceReload: true });
        $("status").textContent = preview.remote
          ? "Proyecto conectado mediante la vista previa remota del despliegue"
          : preview.fallback
          ? "Proyecto conectado mediante la vista previa estatica del build"
          : preview.dependencyReport?.installed
          ? `Dependencias instaladas con ${preview.dependencyReport.manager} · Proyecto conectado`
          : "Proyecto conectado";
      }
    } catch (error) {
      $("status").textContent = "Servidor no iniciado: " + (error?.message || String(error));
      showPreviewStatus(error?.message || String(error));
    }
    scheduleProjectKnowledgeRefresh(project.projectRoot);
  })();
}

function createProject() {
  const project = {
    id: uid(),
    title: "Nuevo chat",
    mode: state.mode,
    model: PROVIDERS[state.mode]?.model || "claude-sonnet-4.6",
    messages: [],
    projectRoot: "",
    provider: state.mode,
    permissionMode: state.permissionMode,
    agents: [{ id: uid(), name: "Agente principal", projectId: "", status: "idle", provider: state.mode, model: PROVIDERS[state.mode]?.model || "", permissionMode: state.permissionMode, messages: [], updatedAt: Date.now() }],
    agentState: "idle",
    updatedAt: Date.now(),
  };
  project.agents[0].projectId = project.id;
  project.activeAgentId = project.agents[0].id;
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  saveProjects();
  renderProjects();
  renderFeed();
  $("prompt").focus();
}

function openProjectsDialog() {
  const dialog = $("projectsDialog");
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  // Pintar lista ya conocida al instante; catalogo en idle.
  renderProjects();
  const idle = typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 800 })
    : (fn) => setTimeout(fn, 0);
  idle(() => {
    refreshProjectCatalog()
      .then(() => { if (dialog.open) renderProjects(); })
      .catch((error) => { $("status").textContent = `No se pudo leer la carpeta de proyectos: ${error?.message || String(error)}`; });
  });
}

function refreshVisibleProjectCatalog() {
  if (!$("projectsDialog")?.open) return;
  refreshProjectCatalog()
    .then(() => { if ($("projectsDialog")?.open) renderProjects(); })
    .catch((error) => { $("status").textContent = `No se pudo actualizar Proyectos: ${error?.message || String(error)}`; });
}

let _focusCatalogTimer = null;
window.addEventListener("focus", () => {
  if (!$("projectsDialog")?.open) return;
  if (_focusCatalogTimer) clearTimeout(_focusCatalogTimer);
  _focusCatalogTimer = setTimeout(() => {
    _focusCatalogTimer = null;
    refreshVisibleProjectCatalog();
  }, 400);
});
setInterval(() => {
  if ($("projectsDialog")?.open) refreshVisibleProjectCatalog();
}, 30_000);

async function saveCurrentProjectEntry() {
  const root = String(state.projectRoot || "").trim();
  if (!root) {
    $("status").textContent = "Abre o crea un proyecto antes de guardar.";
    openProjectsDialog();
    return;
  }
  await performProjectSave(root);
}

async function performProjectSave(root) {
  const projectRoot = String(root || state.projectRoot || "").trim();
  if (!projectRoot) {
    $("status").textContent = "Abre o crea un proyecto antes de guardar.";
    return;
  }
  const toolbarBtn = $("saveProjectBtn");
  const dialogBtn = $("confirmSaveProjectBtn");
  if (toolbarBtn) toolbarBtn.disabled = true;
  if (dialogBtn) dialogBtn.disabled = true;
  showPreviewLoading("Guardando proyecto...");
  try {
    const project = projectForRoot(projectRoot);
    const savePromise = window.editcoreProject?.saveChanges
      ? window.editcoreProject.saveChanges({
        projectRoot,
        name: projectDisplayName(project),
        mode: "project",
      })
      : window.editcoreProject.save({ root: projectRoot, name: projectDisplayName(project) });
    const saved = await Promise.race([
      savePromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("El guardado tardó demasiado (posible bloqueo de git).")), 25000);
      }),
    ]);
    if (!saved?.ok) throw new Error(saved?.message || "EditCoreAI no pudo confirmar el guardado.");
    state.projectRoot = projectRoot;
    state.activeProjectId = project.id;
    project.updatedAt = Date.now();
    saveProjects();
    renderProjects();
    if ($("saveProjectDialog")?.open) $("saveProjectDialog").close();
    $("status").textContent = saved.message || `Proyecto guardado en ${saved.path}`;
    // Restaurar el navegador automáticamente (sin clic manual en actualizar).
    await refreshPreview();
  } catch (error) {
    hidePreviewLoading();
    $("status").textContent = `No se pudo guardar: ${error?.message || String(error)}`;
    try { await refreshPreview(); } catch { /* ignore */ }
  } finally {
    if (toolbarBtn) toolbarBtn.disabled = false;
    if (dialogBtn) dialogBtn.disabled = false;
  }
}

async function confirmCurrentProjectSave(event) {
  event.preventDefault();
  const root = $("saveProjectLocation").value.trim() || String(state.projectRoot || "").trim();
  await performProjectSave(root);
}

async function saveEditCoreChanges() {
  let root = String(state.inspectorSnapshot?.runtime?.root || "").trim();
  if (!root && window.editcoreInspector?.kernelStatus) {
    const ks = await window.editcoreInspector.kernelStatus("editcore", "").catch(() => null);
    root = String(ks?.projectRoot || "").trim();
  }
  if (!root) {
    const msg = "No se pudo determinar la ruta de EditCoreAI. Ejecuta un escaneo primero.";
    inspectorAppend("assistant", msg);
    inspectorHealth("error", msg);
    return;
  }
  if (!window.editcoreProject?.saveChanges) {
    const msg = "Guardar cambios no disponible en esta build.";
    inspectorAppend("assistant", msg);
    return;
  }
  inspectorHealth("checking", "Guardando cambios de EditCoreAI...");
  const thinking = inspectorAppend("assistant", "Guardando metadatos + commit local (sin push)...");
  try {
    const result = await window.editcoreProject.saveChanges({
      projectRoot: root,
      name: "EditCoreAI",
      mode: "editcore",
    });
    thinking?.remove();
    const text = [
      "## Guardado EditCoreAI",
      "",
      result.message || "Guardado completado.",
      "",
      "- Guardar = commit local.",
      "- Publicar = push/deploy usando **Conexiones** de esta app (bóveda EditCoreAI; sin mezclar otras instalaciones).",
    ].join("\n");
    inspectorAppend("assistant", text);
    inspectorRemember("assistant", text);
    inspectorHealth(result.ok ? "ready" : "error", result.ok ? "EditCoreAI guardado" : (result.message || "Error al guardar"));
  } catch (error) {
    thinking?.remove();
    const msg = error?.message || String(error);
    inspectorAppend("assistant", `## Error al guardar\n\n${msg}`);
    inspectorHealth("error", msg);
  }
}

async function loadProjectTemplates() {
  // Catálogo sigue disponible para el agente / Cerebro; la UI de Nuevo ya no elige plantilla.
  if (!window.editcoreProject?.templates) {
    projectTemplates = [];
    return projectTemplates;
  }
  projectTemplates = await window.editcoreProject.templates();
  return projectTemplates;
}

function setProjectCreateUi(running) {
  projectCreateRunning = running;
  $("newProjectName").disabled = running;
  $("newProjectParent").disabled = running;
  $("pickProjectParentBtn").disabled = running;
  $("createProjectConfirmBtn").disabled = running;
  $("closeNewProjectBtn").disabled = running;
  $("cancelProjectCreateBtn").classList.toggle("hidden", !running);
}

function updateProjectCreateProgress(progress) {
  if (!activeProjectCreateRunId || progress?.runId !== activeProjectCreateRunId) return;
  const panel = $("projectCreateProgress");
  panel.classList.remove("hidden");
  if (progress.state) panel.dataset.state = progress.state;
  if (Number.isFinite(progress.percent)) {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    $("projectCreateProgressPercent").textContent = `${percent}%`;
    $("projectCreateProgressFill").style.width = `${percent}%`;
  }
  if (progress.stage !== "command-output" && progress.message) $("projectCreateProgressLabel").textContent = progress.message;
  if (progress.message) {
    const log = $("projectCreateLog");
    const line = String(progress.message).trim();
    if (line && !log.textContent.endsWith(`${line}\n`)) {
      log.textContent = `${log.textContent}${line}\n`.slice(-12000);
      log.scrollTop = log.scrollHeight;
    }
  }
}

async function openNewProjectDialog() {
  $("newProjectDialog").dataset.mode = "create";
  $("newProjectDialogTitle").textContent = "Nuevo proyecto";
  $("newProjectDialogDescription").textContent = "Crea una carpeta en blanco. Si necesitas un stack concreto, pidelo al agente (las plantillas viven en el Cerebro).";
  $("newProjectName").value = "";
  $("newProjectParent").value = loadJson("editcore-project-parent", "D:\\PROGRAMAS IA");
  if ($("newProjectOnboardServices")) $("newProjectOnboardServices").checked = false;
  $("projectCreateProgress").classList.add("hidden");
  $("projectCreateProgress").dataset.state = "idle";
  $("projectCreateProgressFill").style.width = "0%";
  $("projectCreateProgressPercent").textContent = "0%";
  $("projectCreateLog").textContent = "";
  $("newProjectDialog").showModal();
  $("newProjectName").focus();
}

async function createProjectFromDialog(event) {
  event.preventDefault();
  const name = $("newProjectName").value.trim();
  const parentPath = $("newProjectParent").value.trim();
  if (!name || !parentPath) return;
  localStorage.setItem("editcore-project-parent", JSON.stringify(parentPath));
  activeProjectCreateRunId = uid();
  setProjectCreateUi(true);
  updateProjectCreateProgress({ runId: activeProjectCreateRunId, percent: 0, stage: "select", state: "running", message: "Creando proyecto en blanco..." });
  try {
    const created = await window.editcoreProject.create({
      name,
      parentPath,
      template: "blank",
      install: false,
      runId: activeProjectCreateRunId,
    });
    if (!created) return;
    const saved = await window.editcoreProject.save({ root: created.root, name: created.name });
    if (!saved?.ok || !saved?.manifest?.root) throw new Error("El proyecto se creo, pero EditCore no confirmo su persistencia.");
    const project = projectForRoot(created.root, created.name);
    state.activeProjectId = project.id;
    saveProjects();
    $("newProjectDialog").close();
    await selectProject(project.id);
    $("status").textContent = `Proyecto ${created.name} creado en blanco`;
    if ($("newProjectOnboardServices")?.checked && window.editcoreProject?.onboard) {
      $("status").textContent = "Conectando servicios del operador...";
      const onboard = await window.editcoreProject.onboard({
        projectRoot: created.root,
        projectName: created.name,
        localProjectId: project.id,
        installDeps: false,
        confirm: false,
      });
      if (onboard?.ok) {
        $("status").textContent = `Proyecto ${created.name} creado y conectado`;
        await renderGatewayProjectStatus();
        if (typeof syncProjectsToMaintenanceScheduler === "function") syncProjectsToMaintenanceScheduler();
      } else if (!onboard?.cancelled) {
        $("status").textContent = `Proyecto creado; onboard parcial: ${onboard?.message || "revisa Conexiones"}`;
      }
    }
  } catch (error) {
    $("status").textContent = error?.message || String(error);
    updateProjectCreateProgress({ runId: activeProjectCreateRunId, percent: 100, stage: "error", state: "error", message: error?.message || String(error) });
  } finally {
    setProjectCreateUi(false);
    activeProjectCreateRunId = "";
  }
}

async function cancelProjectCreate() {
  if (!projectCreateRunning) return;
  $("projectCreateProgressLabel").textContent = "Cancelando proceso...";
  $("cancelProjectCreateBtn").disabled = true;
  try { await window.editcoreProject.cancelCreate(); }
  finally { $("cancelProjectCreateBtn").disabled = false; }
}

function clearActiveProject() {
  const project = ensureProject();
  ensureProjectChats(project);
  const chat = activeChat(project);
  if (chat) {
    chat.messages = [];
    chat.updatedAt = Date.now();
    project.messages = chat.messages;
  } else {
    project.messages = [];
  }
  project.chatCleared = false; // permitir de nuevo el welcome
  project.updatedAt = Date.now();
  state.history = [];
  state.attachments = [];
  saveProjects();
  renderProjects();
  renderChatThreadSelect();
  $("feed").replaceChildren();
  append("assistant", "Bienvenido a EditCoreAI. ¿Qué haremos hoy?", null, false);
  renderAttachments();
  renderPromptQueue();
  scrollFeedToBottom();
  refreshUndoAgentRunButton();
}

function refreshUndoAgentRunButton(forceEnabled = null) {
  const btn = $("undoAgentRunBtn");
  if (!btn) return;
  if (typeof forceEnabled === "boolean") {
    btn.disabled = !forceEnabled;
    return;
  }
  const root = String(state.projectRoot || "").trim();
  if (!root || !window.editcoreAgent?.peekLastRun) {
    btn.disabled = true;
    return;
  }
  window.editcoreAgent.peekLastRun({ projectRoot: root }).then((manifest) => {
    btn.disabled = !(manifest && Array.isArray(manifest.files) && manifest.files.length && manifest.restored !== true);
  }).catch(() => {
    btn.disabled = true;
  });
}

async function undoLastAgentRunFromUi(options = {}) {
  const root = String(state.projectRoot || "").trim();
  if (!root) {
    appendMessage("assistant", "Abre un proyecto antes de deshacer una corrida.");
    return false;
  }
  if (!window.editcoreAgent?.undoLastRun) {
    appendMessage("assistant", "Deshacer no esta disponible en esta build.");
    return false;
  }
  const confirm = window.editcoreWindow?.confirmDialog
    ? await window.editcoreWindow.confirmDialog(
      "Deshacer ultima corrida",
      "Se restauraran los archivos tocados por la ultima corrida del agente. ¿Continuar?",
      "Deshacer",
      "Cancelar",
    )
    : true;
  if (confirm === false) return false;
  try {
    $("status").textContent = "Deshaciendo ultima corrida...";
    const result = await window.editcoreAgent.undoLastRun({ projectRoot: root });
    const restored = Number(result?.restored || 0);
    if (!result?.ok && restored <= 0) {
      appendMessage("assistant", [
        "## Deshacer corrida",
        "",
        `No se pudo deshacer: ${result?.error || "sin checkpoint ni snapshot"}.`,
      ].join("\n"));
      $("status").textContent = "Deshacer: sin cambios";
      return false;
    }
    const files = (result?.files || []).map((f) => `- \`${f.path}\` (${f.action})`).join("\n");
    appendMessage("assistant", [
      "## Deshacer corrida",
      "",
      `Restaurados: **${restored}** archivo(s)` +
        (result?.source ? ` · fuente: \`${result.source}\`` : "") + ".",
      files ? `\n${files}` : "",
      (result?.errors || []).length ? `\nErrores:\n${result.errors.map((e) => `- ${e.path}: ${e.error}`).join("\n")}` : "",
    ].filter(Boolean).join("\n"));
    refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
    refreshUndoAgentRunButton(false);
    $("status").textContent = `Ultima corrida deshecha (${restored})`;
    if (options.fromChat) return true;
    return true;
  } catch (error) {
    appendMessage("assistant", `No pude deshacer: ${error?.message || error}`);
    refreshUndoAgentRunButton();
    $("status").textContent = "Deshacer fallido";
    return false;
  }
}

function renderAgentDiffReview(review = {}) {
  const files = Array.isArray(review?.files) ? review.files.filter((f) => f && f.path) : [];
  if (!files.length || !window.editcoreAgent?.reviewFile) return;

  const root = String(state.projectRoot || "").trim();
  const item = document.createElement("article");
  item.className = "msg assistant agent-diff-review";
  item.dataset.runId = String(review.runId || "");

  const header = document.createElement("div");
  header.className = "msg-head agent-approval-head";
  header.innerHTML = '<span class="agent-approval-icon" aria-hidden="true"></span><span>Revisar cambios</span>';

  const body = document.createElement("div");
  body.className = "msg-body agent-approval-body";
  const intro = document.createElement("p");
  intro.className = "agent-approval-title";
  intro.textContent = `${files.length} archivo(s) modificados. Acepta o rechaza cada diff.`;
  body.appendChild(intro);

  const cards = document.createElement("div");
  cards.className = "agent-diff-review-list";

  const updateChrome = () => {
    const pending = [...cards.querySelectorAll(".agent-diff-file")].filter((el) => el.dataset.status === "pending");
    acceptAllBtn.disabled = pending.length === 0;
    rejectAllBtn.disabled = pending.length === 0;
    if (pending.length === 0) {
      refreshUndoAgentRunButton();
      intro.textContent = "Revision completada.";
    }
  };

  for (const file of files) {
    const card = document.createElement("div");
    card.className = "agent-diff-file";
    card.dataset.path = file.path;
    card.dataset.status = file.status || "pending";

    const title = document.createElement("div");
    title.className = "agent-diff-file-title";
    title.textContent = `${file.path} · ${file.action || "write"}`;

    const hunks = Array.isArray(file.hunks) ? file.hunks.filter((h) => h && h.id) : [];
    const actions = document.createElement("div");
    actions.className = "agent-approval-actions";

    if (hunks.length > 1) {
      const hunkList = document.createElement("div");
      hunkList.className = "agent-diff-hunk-list";
      for (const hunk of hunks) {
        const hunkCard = document.createElement("div");
        hunkCard.className = "agent-diff-hunk";
        hunkCard.dataset.hunkId = hunk.id;
        hunkCard.dataset.status = hunk.status || "pending";
        const hunkTitle = document.createElement("div");
        hunkTitle.className = "agent-diff-hunk-title";
        hunkTitle.textContent = `${hunk.id}`;
        const hunkDiff = document.createElement("pre");
        hunkDiff.className = "agent-approval-diff";
        hunkDiff.textContent = String(hunk.text || hunk.summary || "").slice(0, 2500);
        const hunkActions = document.createElement("div");
        hunkActions.className = "agent-approval-actions";
        const hReject = document.createElement("button");
        hReject.type = "button";
        hReject.className = "approval-btn approval-btn-cancel";
        hReject.textContent = "Rechazar hunk";
        const hAccept = document.createElement("button");
        hAccept.type = "button";
        hAccept.className = "approval-btn approval-btn-approve";
        hAccept.textContent = "Aceptar hunk";
        const settleHunk = async (decision) => {
          if (hunkCard.dataset.status !== "pending") return;
          hAccept.disabled = true;
          hReject.disabled = true;
          try {
            const result = await window.editcoreAgent.reviewFile({
              projectRoot: root,
              path: file.path,
              hunkId: hunk.id,
              decision,
            });
            hunkCard.dataset.status = result.hunkStatus || decision;
            const isAcc = /accept/i.test(hunkCard.dataset.status);
            hunkCard.classList.add("is-decided");
            hunkCard.classList.toggle("is-accepted", isAcc);
            hunkCard.classList.toggle("is-rejected", !isAcc);

            hunkActions.innerHTML = "";
            const hBadge = document.createElement("span");
            hBadge.className = `agent-diff-status-badge ${isAcc ? "badge-accepted" : "badge-rejected"}`;
            hBadge.textContent = isAcc ? "✓ Hunk Aceptado" : "✕ Hunk Rechazado";
            hunkActions.appendChild(hBadge);

            if (result.allHunksDecided) {
              card.dataset.status = result.fileStatus || "accepted";
              const isFileAcc = card.dataset.status === "accepted";
              card.classList.add("is-decided");
              card.classList.toggle("is-accepted", isFileAcc);
              card.classList.toggle("is-rejected", !isFileAcc);
              title.textContent = `${file.path} · ${isFileAcc ? "✓ Aceptado" : "✕ Rechazado"}`;
              actions.innerHTML = "";
              const badge = document.createElement("span");
              badge.className = `agent-diff-status-badge ${isFileAcc ? "badge-accepted" : "badge-rejected"}`;
              badge.textContent = isFileAcc ? "✓ Aceptado" : "✕ Rechazado";
              actions.appendChild(badge);
              refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
              updateChrome();
            }
          } catch (error) {
            hAccept.disabled = false;
            hReject.disabled = false;
            appendMessage("assistant", `Hunk ${hunk.id}: ${error?.message || error}`);
          }
        };
        hAccept.addEventListener("click", () => settleHunk("accept"));
        hReject.addEventListener("click", () => settleHunk("reject"));
        hunkActions.append(hReject, hAccept);
        hunkCard.append(hunkTitle, hunkDiff, hunkActions);
        hunkList.appendChild(hunkCard);
      }
      card.append(title, hunkList, actions);
    } else {
      const diff = document.createElement("pre");
      diff.className = "agent-approval-diff";
      diff.textContent = String(file.diff || "(sin diff)").slice(0, 6000);

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "approval-btn approval-btn-cancel";
      rejectBtn.textContent = "Rechazar";
      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "approval-btn approval-btn-approve";
      acceptBtn.textContent = "Aceptar";

      const settle = async (decision) => {
        if (card.dataset.status !== "pending") return;
        acceptBtn.disabled = true;
        rejectBtn.disabled = true;
        try {
          const result = await window.editcoreAgent.reviewFile({
            projectRoot: root,
            path: file.path,
            decision,
          });
          card.dataset.status = result.status || decision;
          const isAcc = card.dataset.status === "accepted";
          card.classList.add("is-decided");
          card.classList.toggle("is-accepted", isAcc);
          card.classList.toggle("is-rejected", !isAcc);
          title.textContent = `${file.path} · ${isAcc ? "✓ Aceptado" : "✕ Rechazado"}`;

          actions.innerHTML = "";
          const badge = document.createElement("span");
          badge.className = `agent-diff-status-badge ${isAcc ? "badge-accepted" : "badge-rejected"}`;
          badge.textContent = isAcc ? "✓ Aceptado" : "✕ Rechazado";
          actions.appendChild(badge);

          if (decision === "reject") {
            refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
          }
          updateChrome();
        } catch (error) {
          acceptBtn.disabled = false;
          rejectBtn.disabled = false;
          appendMessage("assistant", `No pude ${decision === "reject" ? "rechazar" : "aceptar"} ${file.path}: ${error?.message || error}`);
        }
      };

      acceptBtn.addEventListener("click", () => settle("accept"));
      rejectBtn.addEventListener("click", () => settle("reject"));
      actions.append(rejectBtn, acceptBtn);
      card.append(title, diff, actions);
    }

    title.style.cursor = "pointer";
    title.title = "Haz clic para mostrar u ocultar los detalles del diff";
    title.addEventListener("click", () => {
      if (card.classList.contains("is-decided")) {
        card.classList.toggle("is-expanded");
      }
    });

    if (card.dataset.status !== "pending") {
      actions.innerHTML = "";
      const isAcc = card.dataset.status === "accepted";
      card.classList.add("is-decided");
      card.classList.toggle("is-accepted", isAcc);
      card.classList.toggle("is-rejected", !isAcc);
      title.textContent = `${file.path} · ${isAcc ? "✓ Aceptado" : "✕ Rechazado"}`;
      const badge = document.createElement("span");
      badge.className = `agent-diff-status-badge ${isAcc ? "badge-accepted" : "badge-rejected"}`;
      badge.textContent = isAcc ? "✓ Aceptado" : "✕ Rechazado";
      actions.appendChild(badge);
    }

    cards.appendChild(card);
  }

  const bulk = document.createElement("div");
  bulk.className = "agent-approval-actions agent-diff-review-bulk";
  const rejectAllBtn = document.createElement("button");
  rejectAllBtn.type = "button";
  rejectAllBtn.className = "approval-btn approval-btn-cancel";
  rejectAllBtn.textContent = "Rechazar todos";
  const acceptAllBtn = document.createElement("button");
  acceptAllBtn.type = "button";
  acceptAllBtn.className = "approval-btn approval-btn-approve";
  acceptAllBtn.textContent = "Aceptar todos";

  acceptAllBtn.addEventListener("click", async () => {
    try {
      await window.editcoreAgent.acceptAllReview({ projectRoot: root });
      for (const el of cards.querySelectorAll('.agent-diff-file[data-status="pending"]')) {
        el.dataset.status = "accepted";
        el.classList.add("is-decided", "is-accepted");
        el.classList.remove("is-rejected");
        const t = el.querySelector(".agent-diff-file-title");
        if (t) t.textContent = `${el.dataset.path} · ✓ Aceptado`;
        const act = el.querySelector(".agent-approval-actions");
        if (act) {
          act.innerHTML = "";
          const badge = document.createElement("span");
          badge.className = "agent-diff-status-badge badge-accepted";
          badge.textContent = "✓ Aceptado";
          act.appendChild(badge);
        }
      }
      bulk.style.display = "none";
      updateChrome();
      $("status").textContent = "Cambios aceptados";
    } catch (error) {
      appendMessage("assistant", `No pude aceptar todos: ${error?.message || error}`);
    }
  });

  rejectAllBtn.addEventListener("click", async () => {
    try {
      await window.editcoreAgent.undoLastRun({ projectRoot: root });
      for (const el of cards.querySelectorAll(".agent-diff-file")) {
        el.dataset.status = "rejected";
        el.classList.add("is-decided", "is-rejected");
        el.classList.remove("is-accepted");
        const t = el.querySelector(".agent-diff-file-title");
        if (t) t.textContent = `${el.dataset.path} · ✕ Rechazado`;
        const act = el.querySelector(".agent-approval-actions");
        if (act) {
          act.innerHTML = "";
          const badge = document.createElement("span");
          badge.className = "agent-diff-status-badge badge-rejected";
          badge.textContent = "✕ Rechazado";
          act.appendChild(badge);
        }
      }
      bulk.style.display = "none";
      refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
      refreshUndoAgentRunButton(false);
      updateChrome();
      $("status").textContent = "Cambios rechazados";
    } catch (error) {
      appendMessage("assistant", `No pude rechazar todos: ${error?.message || error}`);
    }
  });

  bulk.append(rejectAllBtn, acceptAllBtn);
  body.append(cards, bulk);
  item.append(header, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();
  updateChrome();
}

function updateCloseProjectButton() {
  const btn = $("closeProjectBtn");
  if (!btn) return;
  const open = Boolean(String(state.projectRoot || "").trim());
  btn.disabled = !open;
}

async function closeOpenProject(options = {}) {
  const closingRoot = String(state.projectRoot || "").trim();
  const closingLabel = projectDisplayName(activeProject()) || closingRoot.split(/[\\/]/).filter(Boolean).pop() || closingRoot;
  if (!closingRoot) {
    updateCloseProjectButton();
    $("status").textContent = "No hay proyecto abierto.";
    if (options.fromChat) {
      const prompt = String(options.userPrompt || "cierra el proyecto").trim();
      appendUserWithImages(prompt, []);
      rememberMessage("user", prompt);
      const response = "No hay proyecto abierto en el panel. Ya estas sin proyecto.";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
    }
    return false;
  }
  const project = activeProject();
  if (project) {
    // Conserva en catalogo: archivos en disco, chat, permisos y metadatos.
    const prior = Array.isArray(project.messages) ? [...project.messages] : [...state.history];
    if (options.fromChat && options.userPrompt) {
      prior.push({ role: "user", content: repairMojibakeText(options.userPrompt), usage: null, images: [], documents: [] });
    }
    project.messages = prior;
    project.permissionMode = state.permissionMode;
    project.mode = state.mode;
    project.model = $("model")?.value || project.model;
    project.updatedAt = Date.now();
  }
  projectSelectionId += 1;
  // No cancelar el agente cuando el cierre viene de una tool en curso (switch/close IPC).
  if (options.cancelAgent !== false) {
    try { await window.editcoreAgent?.cancel?.({}); } catch { /* ignore */ }
  }
  if (window.editcoreProject?.stopPreview) {
    window.editcoreProject.stopPreview(closingRoot).catch(() => undefined);
  }
  state.activeProjectId = "";
  state.projectRoot = "";
  state.fileListRelativePath = "";
  state.fileListHighlightNames = [];
  clearAgentTouchedHighlights();
  state.history = [];
  state.attachments = [];
  saveProjects({ immediate: true });
  renderProjects();
  updateCloseProjectButton();
  $("projectPathLabel").textContent = "Sin proyecto";
  $("fileList").replaceChildren();
  const empty = document.createElement("div");
  empty.className = "file-empty";
  empty.textContent = "Abre un proyecto para ver archivos.";
  $("fileList").appendChild(empty);
  resetPreview("Abre un proyecto con servidor para visualizarlo aqui.");
  $("feed").replaceChildren();
  if (options.fromChat && options.userPrompt) {
    append("user", options.userPrompt, null, false);
  }
  if (!options.quiet) {
    const response = String(options.message || "").trim()
      || `Proyecto **${closingLabel}** cerrado.\n\nPanel derecho: Sin proyecto. Archivos en disco y chat de ese proyecto quedan guardados.`;
    append("assistant", response, options.fromChat ? { local_response: true } : null, true, 0);
    if (options.fromChat) {
      // Mensaje en el chat vacio (sin proyecto activo); no reescribe el catalogo cerrado.
    }
  }
  renderAttachments();
  updateSendButtonState();
  updateStatus();
  $("status").textContent = `Cerrado: ${closingLabel}`;
  $("prompt")?.focus();
  showWelcomeScreen();
  return true;
}

/**
 * Cierra el workspace activo (opcionalmente publica) y abre otra carpeta.
 * Usado por IPC workspace:switch-project y tool switch_project.
 */
async function switchOpenProject(options = {}) {
  const targetPath = String(options.targetPath || options.path || "").trim();
  const publishFirst = options.publishFirst === true || options.autoPublish === true;
  if (!targetPath) {
    return { ok: false, error: "Falta targetPath para cambiar de proyecto." };
  }
  if (normalizeProjectRoot(targetPath) === normalizeProjectRoot(projectCatalogParent())) {
    return { ok: false, error: "La carpeta catalogo no se abre como un solo proyecto." };
  }

  const previousRoot = String(state.projectRoot || "").trim();
  const previousLabel = projectDisplayName(activeProject())
    || previousRoot.split(/[\\/]/).filter(Boolean).pop()
    || previousRoot;
  const nextLabel = String(options.name || "").trim()
    || targetPath.split(/[\\/]/).filter(Boolean).pop()
    || targetPath;

  let published = false;
  let publishMessage = "";

  // Flush de estado / buffers de sesion antes de desmontar.
  try {
    const project = activeProject();
    if (project) {
      project.messages = Array.isArray(project.messages) ? [...project.messages] : [...state.history];
      project.permissionMode = state.permissionMode;
      project.mode = state.mode;
      project.model = $("model")?.value || project.model;
      project.updatedAt = Date.now();
    }
    saveProjects({ immediate: true });
    try {
      window.editcoreSession?.flushSync?.({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      });
    } catch { /* ignore */ }
  } catch { /* ignore */ }

  if (publishFirst && previousRoot) {
    $("status").textContent = "Publicando antes de cambiar de proyecto...";
    const conn = loadJson("editcore-connections", {}) || {};
    if (!conn.githubToken) {
      return {
        ok: false,
        error: "Para publicar antes de cambiar hace falta GitHub en Conexiones.",
        previousRoot,
      };
    }
    try {
      const result = await window.editcoreProject.publish({
        projectRoot: previousRoot,
        mode: "project",
        deploy: true,
        supabasePush: true,
      });
      if (result?.cancelled) {
        return {
          ok: false,
          error: result.message || "Publicacion cancelada; no se cambio de proyecto.",
          previousRoot,
        };
      }
      if (!result?.ok) {
        return {
          ok: false,
          error: result?.message || "Publicacion incompleta; no se cambio de proyecto.",
          previousRoot,
          publishMessage: result?.message || "",
        };
      }
      published = true;
      publishMessage = result.message || "Publicacion OK";
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
        previousRoot,
      };
    }
  } else if (previousRoot && window.editcoreProject?.saveChanges) {
    // Guardado ligero (manifest + commit local) sin push/deploy.
    try {
      await Promise.race([
        window.editcoreProject.saveChanges({
          projectRoot: previousRoot,
          name: previousLabel,
          mode: "project",
        }),
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, skipped: true }), 20000)),
      ]);
    } catch { /* no bloquear el cambio de carpeta */ }
  }

  if (previousRoot && normalizeProjectRoot(previousRoot) !== normalizeProjectRoot(targetPath)) {
    await closeOpenProject({
      quiet: true,
      cancelAgent: options.cancelAgent === true,
      message: "",
    });
  }

  const project = projectForRoot(targetPath, nextLabel);
  await selectProject(project.id);
  localStorage.setItem("editcore-project-root", targetPath);
  $("status").textContent = `Proyecto activo: ${projectDisplayName(project)}`;

  if (!options.fromAgent) {
    const bits = [
      previousRoot
        ? `Cerrado **${previousLabel}**${published ? " (publicado)" : ""}.`
        : "Sin proyecto previo.",
      `Abierto **${projectDisplayName(project)}**.`,
    ];
    append("assistant", bits.join(" "), { local_response: true }, true, 0);
  }

  return {
    ok: true,
    projectRoot: project.projectRoot,
    previousRoot,
    label: projectDisplayName(project),
    published,
    publishMessage,
  };
}

async function handleCloseProjectFromPrompt(prompt) {
  return closeOpenProject({
    fromChat: true,
    userPrompt: prompt,
  });
}

/**
 * Si no hay projectRoot (welcome / estado vacio), rehidrata el proyecto activo
 * desde storage, catalogo, nombre en el prompt o el mas reciente — sin preguntar Abrir.
 */
async function ensureActiveProjectBound(prompt = "") {
  if (String(state.projectRoot || "").trim() && activeProject()?.projectRoot) {
    hideWelcomeScreen();
    return true;
  }

  const trySelect = async (project) => {
    if (!project?.id || !project?.projectRoot) return false;
    try {
      await selectProject(project.id, { render: true });
      return Boolean(String(state.projectRoot || "").trim());
    } catch {
      return false;
    }
  };

  const storedId = String(localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || "").trim();
  if (storedId) {
    const stored = state.projects.find((item) => item.id === storedId && item.projectRoot);
    if (stored && await trySelect(stored)) return true;
  }

  const named = ProjectAnalysis.extractReferencedProjectName?.(prompt)
    || ProjectAnalysis.extractOpenProjectName?.(prompt)
    || ProjectAnalysis.extractSwitchProjectName?.(prompt)
    || "";
  if (named) {
    const byCatalog = findCatalogProjectByName(named);
    if (byCatalog && await trySelect(byCatalog)) return true;
    const opened = await openNamedProjectFromPrompt(`abre el proyecto ${named}`, {
      silent: true,
      continueWork: true,
    });
    if (opened?.opened && String(state.projectRoot || "").trim()) return true;
  }

  if (/\beditcoreai\b/i.test(String(prompt || ""))) {
    const self = findCatalogProjectByName("EDITCOREAI");
    if (self && await trySelect(self)) return true;
  }

  const absoluteHints = ProjectAnalysis.extractAbsolutePathHints?.(prompt) || [];
  for (const hint of absoluteHints) {
    const normalized = normalizeProjectRoot(hint);
    if (!normalized) continue;
    const byRoot = state.projects.find(
      (item) => normalizeProjectRoot(item.projectRoot) === normalized,
    );
    if (byRoot && await trySelect(byRoot)) return true;
    // Rutas mal tipadas tipo D:PROYECTOS IA\EDITCOREAI → emparejar por basename.
    const base = normalized.split(/[\\/]/).filter(Boolean).pop() || "";
    if (base) {
      const byBase = findCatalogProjectByName(base);
      if (byBase && await trySelect(byBase)) return true;
    }
  }

  const recents = recentProjectsForWelcome(1);
  if (recents[0] && await trySelect(recents[0])) return true;

  return Boolean(String(state.projectRoot || "").trim());
}

async function handleSwitchProjectFromPrompt(prompt) {
  const userPrompt = String(prompt || "").trim();
  appendUserWithImages(userPrompt, []);
  rememberMessage("user", userPrompt);

  const switchName = ProjectAnalysis.extractSwitchProjectName?.(userPrompt) || "";
  const openHint = switchName ? `abre el proyecto ${switchName}` : userPrompt;
  const { root, label, name } = await resolveProjectRootFromPrompt(openHint);
  const targetLabel = label || name || switchName;

  if (!root) {
    // Si ya hay proyecto activo y el switch no resolvio destino, no bloquear con "Indica...".
    if (String(state.projectRoot || "").trim()) {
      const response = "Ya hay un proyecto activo. Indica el nombre del destino (ej. cierrame este y abrime TAXIDRIV) o usa Abrir.";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
      $("status").textContent = `Proyecto activo: ${projectDisplayName(activeProject()) || state.projectRoot}`;
      return false;
    }
    const response = targetLabel
      ? `No encontre el proyecto "${targetLabel}". Usa Abrir o escribe la ruta completa (ej. D:\\PROGRAMAS IA\\EDITCOREAI).`
      : "Indica el proyecto a abrir (ej. EDITCOREAI) o usa Abrir.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("status").textContent = "Proyecto no encontrado";
    return false;
  }

  $("status").textContent = `Cambiando a ${targetLabel || root}...`;
  const result = await switchOpenProject({
    targetPath: root,
    name: targetLabel || root.split(/[\\/]/).filter(Boolean).pop() || root,
    publishFirst: false,
    cancelAgent: true,
    fromAgent: true,
  });

  if (!result?.ok) {
    const response = `No pude cambiar de proyecto: ${result?.error || "error desconocido"}.`;
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("status").textContent = "Cambio de proyecto fallido";
    return false;
  }

  const prev = result.previousRoot
    ? result.previousRoot.split(/[\\/]/).filter(Boolean).pop()
    : "proyecto anterior";
  const response = `Proyecto **${prev}** cerrado. Activo: **${result.label || targetLabel}**. Dime qué hacemos.`;
  const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
  append("assistant", response, usage, true, 0);
  rememberMessage("assistant", response, usage);
  $("status").textContent = `Proyecto activo: ${result.label || targetLabel}`;
  return true;
}

function normalizeModel(model) {
  return String(model || "").trim();
}

function loadConfig() {
  const saved = loadJson("editcore-chat-config", {});
  if (saved.baseUrl) $("baseUrl").value = saved.baseUrl;
  if (saved.apiKey) $("apiKey").value = saved.apiKey;
  if (saved.mode) state.mode = saved.mode === "gpt" ? "gpt" : "claude";
  if (saved.model) {
    const m = normalizeModel(saved.model);
    const sel = $("model");
    if (m && ![...sel.options].some((o) => o.value === m)) {
      const opt = document.createElement("option");
      opt.value = m; opt.textContent = m;
      sel.appendChild(opt);
    }
    sel.value = m;
  }
  $("remember").checked = saved.remember !== false;
  updateModeButtons();
}

function saveConfig() {
  if (!$("remember").checked) {
    delete secureState["editcore-chat-config"];
    window.editcoreSecureConfig.save(secureState).catch(() => undefined);
    return;
  }
  saveSecureJson("editcore-chat-config", {
    remember: true,
    mode: state.mode,
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
  });
}

function openSettings() {
  openProviders();
}

function closeSettings() {
  closeProviders();
}

function updateModeButtons() {
  updateStatus();
}

function setMode(mode) {
  state.mode = mode === "gpt" ? "gpt" : "claude";
  $("model").value = PROVIDERS[state.mode]?.model || "";
  updateModeButtons();
}

function populateProviderSelect() {
  const sel = $("quickProviderSelect");
  if (!sel) return;
  sel.replaceChildren();
  const savedProviders = loadJson("editcore-providers", {});
  PRIMARY_PROVIDER_KEYS.forEach((key) => {
    const def = PROVIDERS[key];
    const url = savedProviders[key]?.baseUrl || def.baseUrl;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${def.label} — ${url}`;
    sel.appendChild(opt);
  });
  loadCustomProviders().forEach((p) => {
    if (!p.baseUrl) return;
    const opt = document.createElement("option");
    opt.value = `custom:${p.id || p.name}`;
    opt.textContent = `${p.name || "Custom"} — ${p.baseUrl}`;
    sel.appendChild(opt);
  });
  const currentUrl = $("baseUrl")?.value?.trim() || "";
  const matchHard = PRIMARY_PROVIDER_KEYS.map((key) => [key, PROVIDERS[key]]).find(([key, def]) => {
    const url = savedProviders[key]?.baseUrl || def.baseUrl;
    return url === currentUrl;
  });
  if (matchHard) {
    sel.value = matchHard[0];
  } else {
    const matchCustom = loadCustomProviders().find((p) => p.baseUrl === currentUrl);
    if (matchCustom) sel.value = `custom:${matchCustom.id || matchCustom.name}`;
  }
}

function loadProviderIntoSettings(key) {
  const savedProviders = loadJson("editcore-providers", {});
  let defaultModels = [];

  if (key.startsWith("custom:")) {
    const id = key.slice(7);
    const prov = loadCustomProviders().find((p) => (p.id || p.name) === id);
    if (!prov) return;
    $("baseUrl").value = prov.baseUrl || "";
    $("apiKey").value = prov.apiKey || "";
    state.mode = (prov.model || "").startsWith("claude") ? "claude" : "gpt";
    const url = (prov.baseUrl || "").toLowerCase();
    if (url.includes("moonshot") || url.includes("kimi"))   defaultModels = PROVIDER_MODELS.kimi;
    else if (url.includes("deepseek"))                       defaultModels = PROVIDER_MODELS.deepseek;
    else if (url.includes("dashscope") || url.includes("qwen")) defaultModels = PROVIDER_MODELS.qwen;
    else if (url.includes("openai") || prov.model?.startsWith("gpt") || prov.model?.startsWith("o1") || prov.model?.startsWith("o3")) defaultModels = PROVIDER_MODELS.gpt;
    else                                                     defaultModels = PROVIDER_MODELS.claude;
  } else {
    const def = PROVIDERS[key];
    if (!def) return;
    const s = savedProviders[key] || {};
    $("baseUrl").value = s.baseUrl || def.baseUrl;
    $("apiKey").value = s.apiKey || "";
    state.mode = key === "claude" || key === "meai" || key === "apicredits" ? "claude" : "gpt";
    defaultModels = PROVIDER_MODELS[key] || [];
  }

  // Pre-populate model select with known defaults immediately
  if (defaultModels.length > 0) {
    const sel = $("model");
    const savedModel = (savedProviders[key]?.model) || PROVIDERS[key]?.model || "";
    sel.replaceChildren();
    defaultModels.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m; opt.textContent = m;
      sel.appendChild(opt);
    });
    if (savedModel && !defaultModels.includes(savedModel)) {
      const opt = document.createElement("option");
      opt.value = savedModel; opt.textContent = savedModel;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = savedModel || defaultModels[0];
  }

  updateStatus();
  if ($("apiKey").value.trim()) {
    fetchModels();
  } else {
    $("fetchModelsBtn").textContent = defaultModels.length
      ? `${defaultModels.length} modelos (predeterminados)`
      : "↓ Ver modelos disponibles";
  }
}

function getProviderLabel() {
  const baseUrl = $("baseUrl")?.value?.trim() || "";
  const match = PRIMARY_PROVIDER_KEYS.map((key) => [key, PROVIDERS[key]])
    .find(([, def]) => def.baseUrl === baseUrl);
  if (match) return match[1].label;
  return state.mode === "gpt" ? "ChatGPT" : "Claude";
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

function updateStatus() {
  updateModelPickerLabel();
  const providerLabel = getProviderLabel();
  const selectedOption = $("chatModelSelect")?.selectedOptions?.[0];
  if (AutoModel.isAutoModelSelection(selectedOption) || state.modelSelectionAuto) {
    const scope = currentAutoProviderScope();
    const resolved = state.lastAutoResolvedModel
      ? ` → ${AutoModel.formatChatModelLabel(state.lastAutoResolvedModel, "custom:gafcore-gateway")}`
      : "";
    $("status").textContent = `${providerLabel} via EditCore · ${AutoModel.formatAutoLabel(scope)}${resolved}`;
    updateSavings();
    return;
  }
  const model = selectedOption?.dataset.model?.trim()
    || $("model")?.value?.trim()
    || PROVIDERS[state.mode]?.model
    || "";
  $("status").textContent = `${providerLabel} via EditCore · ${model}`;
  updateSavings();
}

// ── Chat rendering ────────────────────────────────────────────────────────────

function prepareChatProseForRender(text) {
  let value = repairMojibakeText(String(text || ""));
  if (/PROVIDER_TEMPORARILY_UNAVAILABLE|Tu modelo seleccionado se conserv/i.test(value)
    || /gafcore(?:\s*gateway)?|gafcore-gateway\.vercel\.app/i.test(value)
      && /no est[aá] disponible|tard[oó] demasiado|PROVIDER_TEMPORARILY/i.test(value)) {
    value = "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";
  } else {
    value = value
      .replace(/https?:\/\/[^\s)]*gafcore-gateway[^\s)]*/gi, "")
      .replace(/\bgafcore-gateway(?:\.vercel\.app)?\b/gi, "el proveedor de modelos")
      .replace(/\bGafCore\s+Gateway\b/gi, "el proveedor de modelos")
      .replace(/\bGafCore\b/gi, "el proveedor")
      .replace(/\bx-project-key\b/gi, "API key")
      .replace(/\bproject\s*keys?\b/gi, "API keys")
      .replace(
        /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi,
        "$1[REDACTED]",
      )
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  const Elite = window.EditCoreEliteCommunication;
  try {
    if (typeof Elite?.normalizeSpanishProse === "function") {
      value = Elite.normalizeSpanishProse(value);
    }
    if (typeof Elite?.ensureChatParagraphs === "function") {
      value = Elite.ensureChatParagraphs(value);
    }
  } catch { /* keep value */ }
  return value;
}

function renderMarkdown(text) {
  const prepared = prepareChatProseForRender(text);
  // Use secure markdown renderer (loaded from renderer-markdown.js)
  if (typeof window.renderMarkdownSecure === "function") {
    return window.renderMarkdownSecure(prepared);
  }

  // Fallback: escape everything (safe but no formatting) — conserva párrafos
  return String(prepared || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^(.*)$/s, "<p>$1</p>");
}

function append(role, text, usage, scroll = true, elapsedSeconds = null, images = [], documents = []) {
  const item = document.createElement("article");
  item.className = `msg ${role}`;

  const header = document.createElement("div");
  header.className = "msg-head";
  header.textContent = role === "user" ? "Tú" : `EditCoreAI${elapsedSeconds === null ? "" : ` ${formatElapsed(elapsedSeconds)}`}`;

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(repairMojibakeText(String(text || "")));

  item.append(header, body);

  if (usage && usageMetaText(usage)) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = usageMetaText(usage);
    item.appendChild(meta);
  }

  for (const image of images) {
    const imageElement = document.createElement("img");
    imageElement.src = image.dataUrl;
    imageElement.alt = image.name || "imagen adjunta";
    imageElement.className = "msg-img";
    item.appendChild(imageElement);
  }
  for (const documentItem of documents) {
    const attachment = document.createElement("div");
    attachment.className = "msg-attachment";
    attachment.textContent = documentItem.name || "archivo adjunto";
    item.appendChild(attachment);
  }

  $("feed").appendChild(item);
  if (scroll) scrollFeedToBottom(role === "user");
  if (role === "assistant" && window.EditCoreVoiceMode?.isActive?.()) {
    window.EditCoreVoiceMode.onAssistantMessage(text);
  }
  return item;
}

function appendMessage(role, text, usage = { local_response: true }) {
  const content = String(text || "").trim();
  if (!content) return null;
  const item = append(role, content, usage, true, 0);
  rememberMessage(role, content, usage);
  return item;
}

function rememberMessage(role, content, usage, images = [], documents = []) {
  const project = ensureProject();
  ensureProjectChats(project);
  const chat = activeChat(project);
  project.mode = state.mode;
  project.model = $("model").value.trim() || PROVIDERS[state.mode]?.model || "";
  project.chatCleared = false;
  const entry = { role, content: repairMojibakeText(content), usage: usage || null, images, documents };
  chat.messages.push(entry);
  project.messages = chat.messages;
  if (role === "user") {
    const titleSeed = content.replace(/\s+/g, " ").trim().slice(0, 44) || "Nuevo chat";
    if (!project.title || project.title === "Nuevo chat") project.title = titleSeed;
    if (!chat.title || /^Chat\s+\d+$/i.test(chat.title) || chat.title === "Nuevo chat" || chat.title === "Chat 1") {
      chat.title = titleSeed;
    }
  }
  chat.updatedAt = Date.now();
  project.updatedAt = Date.now();
  state.history = [...chat.messages];
  state.projects.sort((a, b) => b.updatedAt - a.updatedAt);
  state.activeProjectId = project.id;
  saveProjects();
  renderProjects();
  renderChatThreadSelect();
}

// ── Thinking indicator ────────────────────────────────────────────────────────

function appendThinking(statusText = "Pensando / razonando...", isAgent = false, runLabel = "") {
  document.querySelectorAll?.(".thinking-msg, .is-thinking-live")?.forEach?.((el) => {
    try { settleAgentTurnChrome(el, { failed: false, force: true }); } catch {}
  });
  const item = document.createElement("article");
  item.className = "msg assistant thinking-msg agent-execution-card";
  item.dataset.agentCard = "1";
  const head = document.createElement("div");
  head.className = "msg-head";
  head.textContent = runLabel ? `EditCoreAI · ${runLabel}` : "EditCoreAI";
  const body = document.createElement("div");
  body.className = "msg-body msg-thinking";

  const primary = document.createElement("div");
  primary.className = "thinking-primary";
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.innerHTML = "<span></span><span></span><span></span>";
  const status = document.createElement("span");
  status.className = "thinking-status";
  status.textContent = statusText;
  primary.append(dots, status);
  // En modo agente las bolitas van al final (después del contenido). En chat simple, arriba.

  if (isAgent) {
    const exec = document.createElement("div");
    exec.className = "agent-execution-container";

    // ── Thought accordion (default expanded, como Cursor) ──
    const thoughtWrap = document.createElement("details");
    thoughtWrap.className = "agent-thought-accordion";
    thoughtWrap.open = true;
    const thoughtSum = document.createElement("summary");
    thoughtSum.className = "agent-thought-summary";
    thoughtSum.textContent = "Pensamiento";
    const stream = document.createElement("div");
    stream.className = "agent-live-stream agent-thought-stream";
    stream.setAttribute("aria-live", "polite");
    thoughtWrap.append(thoughtSum, stream);
    exec.appendChild(thoughtWrap);

    // ── Exploration pill ──
    const explore = document.createElement("div");
    explore.className = "agent-explore-block";
    explore.hidden = true;
    const exploreBtn = document.createElement("button");
    exploreBtn.type = "button";
    exploreBtn.className = "agent-explore-pill";
    exploreBtn.textContent = "Explorados 0 archivos";
    const exploreList = document.createElement("ul");
    exploreList.className = "agent-explore-list";
    exploreList.hidden = true;
    exploreBtn.addEventListener("click", () => {
      const open = exploreList.hidden;
      exploreList.hidden = !open;
      exploreBtn.classList.toggle("is-open", open);
    });
    explore.append(exploreBtn, exploreList);
    exec.appendChild(explore);

    // ── Inline diffs host ──
    const diffs = document.createElement("div");
    diffs.className = "agent-inline-diffs";
    exec.appendChild(diffs);

    // ── Activity / tool lines (compat con _narrativeLog) ──
    const activityLog = document.createElement("div");
    activityLog.className = "agent-narrative-log agent-activity-log";
    exec.appendChild(activityLog);

    // ── Acciones post-turno (estilo Cursor: solo texto, sin Stop ni follow-up duplicados) ──
    const footer = document.createElement("div");
    footer.className = "agent-turn-footer";
    footer.hidden = true;
    const undoAllBtn = document.createElement("button");
    undoAllBtn.type = "button";
    undoAllBtn.className = "agent-footer-link";
    undoAllBtn.textContent = "Deshacer todo";
    undoAllBtn.title = "Deshacer el último turno del agente";
    undoAllBtn.addEventListener("click", async () => {
      try {
        undoAllBtn.disabled = true;
        const ok = await undoLastAgentRunFromUi({ fromChat: true });
        settleAgentTurnChrome(item, { failed: false });
        if (ok) {
          footer.querySelectorAll(".agent-footer-link").forEach((btn) => { btn.disabled = true; });
        } else {
          undoAllBtn.disabled = false;
        }
      } catch (error) {
        undoAllBtn.disabled = false;
        appendMessage("assistant", `No pude deshacer: ${error?.message || error}`);
        $("status").textContent = `Undo: ${error?.message || error}`;
      }
    });
    const keepAllBtn = document.createElement("button");
    keepAllBtn.type = "button";
    keepAllBtn.className = "agent-footer-link";
    keepAllBtn.textContent = "Aceptar todo";
    keepAllBtn.title = "Aceptar todos los cambios pendientes y guardarlos definitivamente";
    keepAllBtn.addEventListener("click", async () => {
      try {
        keepAllBtn.disabled = true;
        const root = String(state.projectRoot || "").trim();
        if (!root || !window.editcoreAgent?.acceptAllReview) {
          appendMessage("assistant", "Aceptar todo no está disponible (sin proyecto o API).");
          keepAllBtn.disabled = false;
          return;
        }
        const result = await window.editcoreAgent.acceptAllReview({ projectRoot: root });
        const n = Number(result?.accepted || 0);
        settleAgentTurnChrome(item, { failed: false });
        appendMessage("assistant", [
          "## Cambios Aceptados",
          "",
          n > 0
            ? `Aceptados **${n}** archivo(s) del último turno. Los cambios se han guardado con éxito.`
            : "No había cambios pendientes para aceptar (¿ya aceptados o sin checkpoint?).",
        ].join("\n"));
        $("status").textContent = n > 0 ? `Aceptar todo: ${n} archivo(s)` : "Aceptar todo: sin pendientes";
        if (n > 0) {
          footer.querySelectorAll(".agent-footer-link").forEach((btn) => { btn.disabled = true; });
        } else {
          keepAllBtn.disabled = false;
        }
      } catch (error) {
        keepAllBtn.disabled = false;
        appendMessage("assistant", `Aceptar todo falló: ${error?.message || error}`);
        $("status").textContent = `Aceptar: ${error?.message || error}`;
      }
    });
    const reviewBtn = document.createElement("button");
    reviewBtn.type = "button";
    reviewBtn.className = "agent-footer-link";
    reviewBtn.textContent = "Revisar";
    reviewBtn.addEventListener("click", () => reviewAgentTurnFromCard(item));
    footer.append(undoAllBtn, keepAllBtn, reviewBtn);
    exec.appendChild(footer);

    // Contenido primero; bolitas/estado al final (como Cursor: indicador abajo).
    body.appendChild(exec);
    body.appendChild(primary);

    item._thoughtAccordion = thoughtWrap;
    item._thoughtPanel = stream;
    item._thoughtStream = stream;
    item._narrativeLog = activityLog;
    item._exploreBlock = explore;
    item._explorePill = exploreBtn;
    item._exploreList = exploreList;
    item._inlineDiffs = diffs;
    item._turnFooter = footer;
    item._thinkingPrimary = primary;
    item._exploredItems = new Map();
    item._inlineDiffCards = new Map();
    item._changedFiles = [];
    item._narrativeSeen = new Set();
    item._narrativeRows = new Map();
  } else {
    body.appendChild(primary);
  }

  item.append(head, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();
  return item;
}

function revealAgentTurnActions(thinkingItem, { failed = false } = {}) {
  const footer = thinkingItem?._turnFooter || thinkingItem?.querySelector?.(".agent-turn-footer");
  if (!footer) return;
  const changed = Array.isArray(thinkingItem?._changedFiles)
    ? thinkingItem._changedFiles.filter(Boolean)
    : [];
  // Sin diffs reales: no mostrar Undo/Keep/Review (análisis de solo lectura).
  if (!failed && changed.length === 0) {
    footer.hidden = true;
    return;
  }
  footer.hidden = false;
  footer.classList.toggle("is-failed", failed === true);
  if (failed) {
    footer.querySelectorAll(".agent-footer-link").forEach((btn) => {
      if (btn.textContent === "Revisar") return;
      btn.disabled = true;
    });
  }
}

async function reviewAgentTurnFromCard(thinkingItem) {
  const root = String(state.projectRoot || "").trim();
  const files = Array.isArray(thinkingItem?._changedFiles) ? thinkingItem._changedFiles.filter(Boolean) : [];
  if (window.editcoreAgent?.reviewLastRun && root) {
    try {
      const review = await window.editcoreAgent.reviewLastRun({ projectRoot: root });
      if (review?.files?.length) {
        renderAgentDiffReview(review);
        const pending = review.files.filter((f) => (f.status || "pending") === "pending").length;
        appendMessage("assistant", [
          "## Review",
          "",
          `**${review.files.length}** archivo(s) en el último turno` +
            (pending ? ` · **${pending}** pendiente(s)` : " · sin pendientes"),
          "",
          "Revisa cada diff abajo: Accept / Reject por archivo o hunk.",
        ].join("\n"));
        $("status").textContent = `Review: ${review.files.length} archivo(s)`;
        return;
      }
      appendMessage("assistant", [
        "## Review",
        "",
        files.length
          ? `Hay ${files.length} archivo(s) tocados en el chat, pero no hay checkpoint con diffs (agent-last-run). Reinicia EditCore tras esta corrección y vuelve a pedir un cambio.`
          : "No hay cambios pendientes para revisar en este turno.",
      ].join("\n"));
      $("status").textContent = "Review: sin checkpoint";
      return;
    } catch (error) {
      appendMessage("assistant", `Review falló: ${error?.message || error}`);
      $("status").textContent = `Review: ${error?.message || error}`;
    }
  }
  const first = files[0];
  if (first && window.editcoreProject?.openPath) {
    try {
      await window.editcoreProject.openPath({ projectRoot: root, path: first });
      $("status").textContent = `Abierto: ${first}`;
      return;
    } catch {
      /* fall through */
    }
  }
  $("status").textContent = files.length
    ? `Archivos tocados: ${files.slice(0, 3).join(", ")}`
    : "Aún no hay diffs para revisar en esta corrida";
}

function resolveThinkingForTransparency(payload = {}) {
  const runId = String(payload?.runId || "");
  const liveRun = runId ? activeAgentThinkingRuns.get(runId) : null;
  return liveRun?.thinking
    || (!runId ? document.querySelector(".thinking-msg.agent-execution-card, .thinking-msg") : null);
}

function appendCursorThought(thinkingItem, text, { delta = false } = {}) {
  if (!thinkingItem) return;
  const value = String(text || "");
  if (!value.trim()) return;
  // La prosa del agente va SOLO al stream de abajo. La caja Pensamiento es
  // para acciones/CoT cortas — nunca el mismo párrafo del chat.
  const looksLikeChatProse = value.length > 160
    || /\n\n/.test(value)
    || /^(?:La captura|Ahora |Voy a |He |Tras |Según |En `)/i.test(value.trim())
    || /##\s|```/.test(value);
  if (looksLikeChatProse) return;
  ensureThoughtPanel(thinkingItem);
  if (thinkingItem._thoughtAccordion) thinkingItem._thoughtAccordion.open = true;
  if (delta) {
    thinkingItem._thoughtOnlyBuffer = `${String(thinkingItem._thoughtOnlyBuffer || "")}${value}`;
    appendThoughtStreamText(thinkingItem, thinkingItem._thoughtOnlyBuffer);
  } else {
    thinkingItem._thoughtOnlyBuffer = value;
    appendThoughtStreamText(thinkingItem, value);
  }
  const summary = thinkingItem.querySelector?.(".agent-thought-summary");
  if (summary) {
    summary.textContent = delta || thinkingItem._thoughtOnlyBuffer
      ? "Pensamiento · en curso…"
      : "Pensamiento";
  }
}

function upsertExplorationUi(thinkingItem, { summary, items = [], count } = {}) {
  if (!thinkingItem?._exploreBlock) return;
  thinkingItem._exploredItems ||= new Map();
  for (const item of items) {
    const label = String(item?.label || item?.path || item?.query || item?.tool || "").trim();
    if (!label) continue;
    const key = `${item?.tool || "file"}:${label}`;
    thinkingItem._exploredItems.set(key, item);
  }
  const total = Number(count) || thinkingItem._exploredItems.size;
  thinkingItem._exploreBlock.hidden = total <= 0;
  if (thinkingItem._explorePill) {
    thinkingItem._explorePill.textContent = summary || `Explorados ${total} archivo${total === 1 ? "" : "s"}`;
  }
  const list = thinkingItem._exploreList;
  if (!list) return;
  list.replaceChildren();
  for (const entry of [...thinkingItem._exploredItems.values()].slice(-40)) {
    const li = document.createElement("li");
    const tool = String(entry.tool || "file").replace(/_/g, " ");
    const label = String(entry.label || entry.path || entry.query || "").trim();
    li.textContent = label ? `${tool}: ${label}` : tool;
    list.appendChild(li);
  }
}

function renderUnifiedDiffLines(pre, unifiedDiff = "") {
  pre.replaceChildren();
  const lines = String(unifiedDiff || "").split("\n").slice(0, 120);
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    pre.textContent = "(diff en curso…)";
    return;
  }
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "agent-diff-line";
    if (line.startsWith("+") && !line.startsWith("+++")) row.classList.add("is-add");
    else if (line.startsWith("-") && !line.startsWith("---")) row.classList.add("is-del");
    else if (line.startsWith("@@")) row.classList.add("is-hunk");
    row.textContent = line;
    pre.appendChild(row);
  }
}

function upsertInlineDiffCard(thinkingItem, payload = {}) {
  if (!thinkingItem) return;
  const host = thinkingItem._inlineDiffs;
  if (!host) {
    addAgentCodeFragment(thinkingItem, {
      name: "apply_diff",
      stage: "done",
      input: { path: payload.filePath },
      fragment: {
        kind: "replace",
        path: payload.filePath,
        summary: payload.summary || payload.filePath,
        oldText: "",
        newText: String(payload.unifiedDiff || "").slice(0, 4000),
      },
    });
    return;
  }
  const filePath = String(payload.filePath || "").trim();
  if (!filePath) return;
  thinkingItem._inlineDiffCards ||= new Map();
  thinkingItem._changedFiles ||= [];
  if (!thinkingItem._changedFiles.includes(filePath)) thinkingItem._changedFiles.push(filePath);

  let card = thinkingItem._inlineDiffCards.get(filePath);
  if (!card) {
    card = document.createElement("div");
    card.className = "agent-inline-diff-card";
    const head = document.createElement("div");
    head.className = "agent-inline-diff-head";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "agent-inline-diff-path";
    title.title = "Abrir en editor";
    title.addEventListener("click", () => {
      openPathInEditor(filePath, payload.unifiedDiff).catch((error) => {
        $("status").textContent = `Editor: ${error?.message || error}`;
      });
    });
    const deltas = document.createElement("span");
    deltas.className = "agent-inline-diff-deltas";
    head.append(title, deltas);
    const hunkHost = document.createElement("div");
    hunkHost.className = "agent-live-hunk-list";
    const body = document.createElement("pre");
    body.className = "agent-inline-diff-body";
    card.append(head, hunkHost, body);
    card._title = title;
    card._deltas = deltas;
    card._body = body;
    card._hunkHost = hunkHost;
    host.appendChild(card);
    thinkingItem._inlineDiffCards.set(filePath, card);
  }
  const rel = ProjectFilesUi?.resolveTouchedRelativePath?.(state.projectRoot, filePath) || filePath;
  card._title.textContent = rel;
  const add = Number(payload.additions) || 0;
  const del = Number(payload.deletions) || 0;
  card._deltas.innerHTML = `<span class="is-add">+${add}</span> <span class="is-del">−${del}</span>`;
  if (payload.unifiedDiff) {
    renderUnifiedDiffLines(card._body, payload.unifiedDiff);
    renderLiveHunkActions(card, rel, payload.unifiedDiff);
    // Gutter markers in Monaco when file is open
    if (window.EditCoreEditor?.getCurrentPath?.() === rel.replace(/\\/g, "/")
      || window.EditCoreEditor?.getCurrentPath?.() === String(filePath).replace(/\\/g, "/")) {
      const marks = window.EditCoreLiveHunks?.gutterMarksFromDiff?.(payload.unifiedDiff) || [];
      window.EditCoreEditor.applyGutterDiffs(marks);
    }
  } else if (!card._body.childNodes.length) {
    card._body.textContent = "Aplicando cambio…";
  }
  card.classList.toggle("is-applied", payload.applied === true);
  scrollFeedToBottom();
}

function renderLiveHunkActions(card, relativePath, unifiedDiff) {
  const host = card?._hunkHost;
  if (!host) return;
  const hunks = window.EditCoreLiveHunks?.parseUnifiedHunks?.(unifiedDiff) || [];
  host.replaceChildren();
  if (!hunks.length) return;
  for (const hunk of hunks) {
    const row = document.createElement("div");
    row.className = "agent-live-hunk";
    row.dataset.hunkId = hunk.id;
    const meta = document.createElement("div");
    meta.className = "agent-live-hunk-meta";
    meta.textContent = `${hunk.id} · +${hunk.additions || 0} −${hunk.deletions || 0} · L${hunk.newStart}`;
    const actions = document.createElement("div");
    actions.className = "agent-live-hunk-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Accept";
    accept.className = "agent-hunk-accept";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = "Reject";
    reject.className = "agent-hunk-reject";
    const setDone = (status) => {
      row.dataset.status = status;
      accept.disabled = true;
      reject.disabled = true;
      row.classList.add(status === "rejected" ? "is-rejected" : "is-accepted");
    };
    accept.addEventListener("click", async () => {
      try {
        if (window.editcoreAgent?.reviewHunk && state.projectRoot) {
          await window.editcoreAgent.reviewHunk({
            projectRoot: state.projectRoot,
            path: relativePath,
            hunkId: hunk.id,
            decision: "accept",
          });
        }
        setDone("accepted");
        $("status").textContent = `Hunk ${hunk.id} aceptado`;
      } catch (error) {
        $("status").textContent = `Accept: ${error?.message || error}`;
      }
    });
    reject.addEventListener("click", async () => {
      try {
        if (window.editcoreAgent?.reviewHunk && state.projectRoot) {
          await window.editcoreAgent.reviewHunk({
            projectRoot: state.projectRoot,
            path: relativePath,
            hunkId: hunk.id,
            decision: "reject",
          });
        }
        setDone("rejected");
        $("status").textContent = `Hunk ${hunk.id} rechazado`;
        if (window.EditCoreEditor?.getCurrentPath?.() === String(relativePath).replace(/\\/g, "/")) {
          await openPathInEditor(relativePath);
        }
      } catch (error) {
        $("status").textContent = `Reject: ${error?.message || error}`;
      }
    });
    actions.append(accept, reject);
    const preview = document.createElement("pre");
    preview.className = "agent-live-hunk-preview";
    preview.textContent = hunk.lines.slice(0, 12).join("\n");
    row.append(meta, actions, preview);
    host.appendChild(row);
  }
}

async function openPathInEditor(filePath, unifiedDiff = "") {
  const root = String(state.projectRoot || "").trim();
  const rel = ProjectFilesUi?.resolveTouchedRelativePath?.(root, filePath)
    || String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!root || !rel) {
    $("status").textContent = "Sin ruta de archivo";
    return;
  }
  if (!window.EditCoreEditor?.openFile) {
    $("status").textContent = `Archivo: ${rel} (editor no cargado)`;
    return;
  }
  try {
    setPreviewMode("code");
    await window.EditCoreEditor.openFile(root, rel, { unifiedDiff: unifiedDiff || "" });
    $("status").textContent = `Código: ${rel}`;
  } catch (error) {
    $("status").textContent = `No se pudo abrir ${rel}: ${error?.message || error}`;
    throw error;
  }
}

function markInlineDiffApplied(thinkingItem, filePath = "") {
  const path = String(filePath || "").trim();
  if (!thinkingItem || !path) return;
  const card = thinkingItem._inlineDiffCards?.get?.(path);
  if (card) card.classList.add("is-applied");
  thinkingItem._changedFiles ||= [];
  if (!thinkingItem._changedFiles.includes(path)) thinkingItem._changedFiles.push(path);
}

function setThinkingStatus(item, text) {
  const status = item?.querySelector?.(".thinking-status") || document.querySelector(".thinking-msg .thinking-status");
  if (!status) return;
  const value = String(text || "").trim();
  // Vacio = no-op: nunca borrar/ocultar la etiqueta (evita titileo con heartbeat).
  if (!value) {
    status.classList.remove("is-streaming");
    if (!String(status.textContent || "").trim()) status.textContent = "Trabajando...";
    return;
  }
  if (status.textContent === value) {
    status.classList.remove("is-streaming");
    return;
  }
  status.textContent = value;
  status.classList.remove("is-streaming");
}

/** Una sola linea de actividad dinamica en las bolitas de pensamiento. */
function setAgentLiveActivity(thinkingItem, text) {
  if (!thinkingItem) return;
  if (Date.now() < agentUiHardStopUntil) return;
  const value = String(text || "").trim();
  if (!value) return; // no borrar label ni scrollear en vacio
  setThinkingStatus(thinkingItem, value);
  if (thinkingItem._activityScrollTimer) return;
  thinkingItem._activityScrollTimer = setTimeout(() => {
    thinkingItem._activityScrollTimer = null;
    scrollFeedToBottom();
  }, 150);
}

/** Rail estático de subagentes eliminado: el feedback va al panel CoT. */
function ensureSubagentRail(_thinkingItem, _activeName, _detail) {
  return;
}

function ensureThoughtPanel(thinkingItem) {
  if (!thinkingItem) return null;
  if (thinkingItem._thoughtStream) return thinkingItem._thoughtPanel || thinkingItem._thoughtStream;
  const body = thinkingItem.querySelector?.(".msg-body") || thinkingItem;
  let stream = thinkingItem.querySelector?.(".agent-live-stream, .agent-thought-stream");
  if (!stream) {
    const exec = thinkingItem.querySelector?.(".agent-execution-container") || body;
    let accordion = thinkingItem.querySelector?.(".agent-thought-accordion");
    if (!accordion) {
      accordion = document.createElement("details");
      accordion.className = "agent-thought-accordion";
      accordion.open = true;
      const sum = document.createElement("summary");
      sum.className = "agent-thought-summary";
      sum.textContent = "Pensamiento";
      accordion.appendChild(sum);
      const primary = thinkingItem.querySelector?.(".thinking-primary");
      if (primary?.parentNode) primary.parentNode.insertBefore(accordion, primary.nextSibling);
      else exec.insertBefore(accordion, exec.firstChild);
      thinkingItem._thoughtAccordion = accordion;
    }
    stream = document.createElement("div");
    stream.className = "agent-live-stream agent-thought-stream";
    stream.setAttribute("aria-live", "polite");
    accordion.appendChild(stream);
  }
  thinkingItem._thoughtPanel = stream;
  thinkingItem._thoughtStream = stream;
  // NUNCA usar el Thought stream como log de narración (eso metía el chat dentro de la caja).
  if (!thinkingItem._narrativeLog) {
    thinkingItem._narrativeLog = thinkingItem.querySelector?.(".agent-activity-log, .agent-narrative-log") || null;
  }
  return stream;
}

function appendThoughtLine(thinkingItem, text, { kind = "line" } = {}) {
  if (!thinkingItem) return;
  const value = String(text || "").trim();
  if (!value) return;
  ensureThoughtPanel(thinkingItem);
  const stream = thinkingItem._thoughtStream;
  if (!stream) return;
  thinkingItem._thoughtSeen ||= new Set();
  const key = `${kind}:${value.slice(0, 160)}`;
  if (thinkingItem._thoughtSeen.has(key)) return;
  thinkingItem._thoughtSeen.add(key);
  if (thinkingItem._thoughtSeen.size > 80) {
    const first = thinkingItem._thoughtSeen.values().next().value;
    thinkingItem._thoughtSeen.delete(first);
  }
  const row = document.createElement("div");
  row.className = `agent-thought-line is-${kind}`;
  row.textContent = value;
  stream.appendChild(row);
  setAgentLiveActivity(thinkingItem, value.replace(/^[⚙️🔍📂✓○→✗]+\s*/, "").slice(0, 120));
  if (!thinkingItem._thoughtScrollTimer) {
    thinkingItem._thoughtScrollTimer = setTimeout(() => {
      thinkingItem._thoughtScrollTimer = null;
      scrollFeedToBottom();
    }, 80);
  }
}

function appendThoughtStreamText(thinkingItem, text) {
  if (!thinkingItem) return;
  const value = String(text || "");
  if (!value.trim()) return;
  ensureThoughtPanel(thinkingItem);
  const stream = thinkingItem._thoughtStream;
  if (!stream) return;
  let block = thinkingItem._thoughtLiveBlock;
  if (!block || !block.isConnected) {
    block = document.createElement("div");
    block.className = "agent-thought-line is-stream";
    stream.appendChild(block);
    thinkingItem._thoughtLiveBlock = block;
  }
  block.textContent = value;
  setAgentLiveActivity(thinkingItem, "…");
}

function normalizeSpecialistKey(nameOrText = "") {
  const raw = String(nameOrText || "").toLowerCase().trim();
  if (!raw) return "";
  if (/ui\s*\/?\s*ux|ui_ux|specialist.*ui|^ui$/.test(raw)) return "ui";
  if (/database|supabase|sql|prisma/.test(raw)) return "database";
  if (/devops|build|deploy/.test(raw)) return "devops";
  if (/security|auth/.test(raw)) return "security";
  if (/verifier|verif/.test(raw)) return "verifier";
  if (/auto-?heal/.test(raw)) return "auto-heal";
  if (/global-?memory|memoria global/.test(raw)) return "global-memory";
  if (/implementer|implement/.test(raw)) return "implementer";
  if (/explorer|explora/.test(raw)) return "explorer";
  if (/planner|plan/.test(raw)) return "planner";
  if (/analyst|analis/.test(raw)) return "analyst";
  return raw.replace(/[^a-z0-9_-]+/g, "-").slice(0, 32);
}

function setAgentSpecialistBadge(_nameOrText, _detail = "") {
  const badge = $("agentSpecialistBadge");
  if (!badge) return;
  badge.hidden = true;
  badge.classList.add("is-idle");
  badge.removeAttribute("data-kind");
  badge.textContent = "";
}

let previewHealBannerTimer = null;
function showPreviewHealBanner({ title, message, tone = "ok", ttlMs = 14000 } = {}) {
  const el = $("previewHealBanner");
  if (!el) return;
  const head = String(title || "Auto-heal").trim();
  const body = String(message || "").trim().slice(0, 280);
  el.classList.toggle("is-warn", tone === "warn" || tone === "error");
  el.classList.remove("hidden");
  el.hidden = false;
  el.replaceChildren();
  const content = document.createElement("div");
  content.className = "preview-heal-banner-body";
  const strong = document.createElement("strong");
  strong.textContent = head;
  content.appendChild(strong);
  if (body) {
    const p = document.createElement("div");
    p.textContent = body;
    content.appendChild(p);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Cerrar");
  close.textContent = "×";
  close.addEventListener("click", () => hidePreviewHealBanner());
  el.appendChild(content);
  el.appendChild(close);
  if (previewHealBannerTimer) clearTimeout(previewHealBannerTimer);
  if (ttlMs > 0) {
    previewHealBannerTimer = setTimeout(() => hidePreviewHealBanner(), ttlMs);
  }
}

function hidePreviewHealBanner() {
  const el = $("previewHealBanner");
  if (!el) return;
  el.classList.add("hidden");
  el.hidden = true;
  el.replaceChildren();
  if (previewHealBannerTimer) {
    clearTimeout(previewHealBannerTimer);
    previewHealBannerTimer = null;
  }
}

async function restoreSnapshotFromUi() {
  const root = String(state.projectRoot || "").trim();
  if (!root) {
    appendMessage("assistant", "Abre un proyecto antes de restaurar una versión.");
    return false;
  }
  if (!window.editcoreAgent?.undoLastRun) {
    appendMessage("assistant", "Restaurar no está disponible en esta build.");
    return false;
  }
  const confirm = window.editcoreWindow?.confirmDialog
    ? await window.editcoreWindow.confirmDialog(
      "Restaurar versión anterior",
      "Se restaurará el último checkpoint de `.editcore/snapshots/`. ¿Continuar?",
      "Restaurar",
      "Cancelar",
    )
    : true;
  if (confirm === false) return false;
  try {
    $("status").textContent = "Restaurando snapshot…";
    const result = await window.editcoreAgent.undoLastRun({
      projectRoot: root,
      preferSnapshot: true,
    });
    const files = (result?.files || []).map((f) => `- \`${f.path}\` (${f.action})`).join("\n");
    appendMessage("assistant", [
      "## Restaurar versión anterior",
      "",
      result?.ok === false
        ? `No se pudo restaurar: ${result?.error || "sin snapshots"}`
        : `Restaurados: ${result?.restored || 0} archivo(s) desde snapshot \`${result?.snapshotId || "último"}\`.`,
      files ? `\n${files}` : "",
    ].filter(Boolean).join("\n"));
    refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
    refreshUndoAgentRunButton(false);
    $("status").textContent = result?.ok === false ? "Restaurar fallido" : "Versión anterior restaurada";
    showPreviewHealBanner({
      title: result?.ok === false ? "Snapshot no restaurado" : "Checkpoint restaurado",
      message: result?.ok === false
        ? String(result?.error || "Sin snapshots")
        : `${result?.restored || 0} archivo(s) · ${result?.snapshotId || "latest"}`,
      tone: result?.ok === false ? "warn" : "ok",
    });
    return result?.ok !== false;
  } catch (error) {
    appendMessage("assistant", `No pude restaurar: ${error?.message || error}`);
    $("status").textContent = "Restaurar fallido";
    return false;
  }
}

function setAgentActivity(text) {
  const value = String(text || "").trim();
  if (value) $("status").textContent = value;
  inferPipelineFromText(value);
}

const agentPipelineState = {
  coverage: "—",
  coverageState: "",
  diagnostic: "—",
  diagnosticState: "",
  queue: "—",
  queueState: "",
  visible: false,
};

function setPipelinePill(_key, _value, _state = "") {
  // Chat limpio: sin pills/marcadores visibles. Estado solo en memoria.
}

function updateAgentPipelineUi(partial = {}) {
  // Interno: cobertura / typecheck / cola viven en agentPipelineState, nunca en el chat.
  if (partial.coverage != null) {
    agentPipelineState.coverage = String(partial.coverage);
    agentPipelineState.coverageState = partial.coverageState
      || (Number(partial.coveragePercent) >= 100 ? "ok" : Number(partial.coveragePercent) > 0 ? "run" : "warn");
  }
  if (partial.diagnostic != null) {
    agentPipelineState.diagnostic = String(partial.diagnostic);
    agentPipelineState.diagnosticState = partial.diagnosticState || "";
  }
  if (partial.queue != null) {
    agentPipelineState.queue = String(partial.queue);
    agentPipelineState.queueState = partial.queueState || "";
  }
  // Nunca mostrar franja en UI.
  agentPipelineState.visible = false;
}

function inferPipelineFromText(text = "") {
  const raw = String(text || "");
  if (!raw) return;
  if (/Walker cobertura|Cobertura:|COVERAGE_MAP/i.test(raw)) {
    const pct = /(\d+)\s*%/.exec(raw);
    updateAgentPipelineUi({
      coverage: raw.replace(/^Walker cobertura:\s*/i, "").slice(0, 80),
      coveragePercent: pct ? Number(pct[1]) : undefined,
      coverageState: /alcanzada|100\s*%/i.test(raw) ? "ok" : "run",
    });
  }
  if (/Diagnostico acotado|DIAGNOSTICO ACOTADO|typecheck|tsc --noEmit/i.test(raw)) {
    const fail = /fallo|error TS|FAIL/i.test(raw);
    const ok = /→ ok|sin errores|exitoso/i.test(raw);
    updateAgentPipelineUi({
      diagnostic: raw.replace(/^Diagnostico acotado:\s*/i, "").slice(0, 72),
      diagnosticState: fail ? "fail" : ok ? "ok" : "run",
    });
  }
  if (/Cola fixes:|FIX_QUEUE|FOCO OBLIGATORIO|FOCO ACTUAL/i.test(raw)) {
    const focus = /foco:\s*([^\s;]+)|FOCO[^:]*:\s*([^\s\n]+)/i.exec(raw);
    updateAgentPipelineUi({
      queue: (focus?.[1] || focus?.[2] || raw).slice(0, 72),
      queueState: /verificados;\s*foco:\s*ninguno|Cola completa|0\s*pending/i.test(raw) ? "ok" : "run",
    });
  }
}

function applyPipelineProgress(progress = {}) {
  const pipe = progress.pipeline || progress;
  if (!pipe || typeof pipe !== "object") return;
  const queueLabel = pipe.queueFocus
    ? `${pipe.queueVerified || 0}/${pipe.queueTotal || "?"} · ${pipe.queueFocus}`
    : (pipe.queueSummary || pipe.queue || null);
  updateAgentPipelineUi({
    coverage: pipe.coverage || pipe.coverageSummary || undefined,
    coveragePercent: pipe.coveragePercent,
    coverageState: pipe.coverageState,
    diagnostic: pipe.diagnosticDetail || pipe.diagnostic || undefined,
    diagnosticState: pipe.diagnosticState || (pipe.diagnostic === "ok" ? "ok" : pipe.diagnostic === "fail" ? "fail" : pipe.diagnostic === "running" ? "run" : ""),
    queue: queueLabel || undefined,
    queueState: pipe.queueState || (pipe.queueDone ? "ok" : pipe.queueFocus ? "run" : ""),
  });
}

function hideThinkingIndicator(_thinkingItem) {
  // Las 3 bolitas deben permanecer visibles mientras el agente trabaja.
  // No ocultar el indicador al empezar la narracion del modelo.
}

function showThinkingIndicator(thinkingItem) {
  if (!thinkingItem) return;
  if (Date.now() < agentUiHardStopUntil) return;
  if (thinkingItem._settled || thinkingItem.classList?.contains("agent-execution-done")) return;
  const runId = String(thinkingItem._runId || thinkingItem.dataset?.runId || "").trim();
  if (runId && !activeAgentThinkingRuns.has(runId)) return;
  thinkingItem.classList.remove("agent-execution-done");
  thinkingItem.classList.add("thinking-msg", "is-thinking-live");
  let primary = thinkingItem.querySelector?.(".thinking-primary");
  if (!primary) {
    const body = thinkingItem.querySelector?.(".msg-body") || thinkingItem;
    primary = document.createElement("div");
    primary.className = "thinking-primary";
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = "<span></span><span></span><span></span>";
    const status = document.createElement("span");
    status.className = "thinking-status";
    status.textContent = "Trabajando…";
    primary.append(dots, status);
    const exec = body.querySelector?.(".agent-execution-container");
    if (exec) exec.insertAdjacentElement("afterend", primary);
    else body.appendChild(primary);
  }
  primary.classList.remove("hidden");
  primary.hidden = false;
  primary.style.display = "";
  const dots = primary.querySelector?.(".thinking-dots");
  if (dots) {
    dots.hidden = false;
    dots.style.display = "";
    dots.querySelectorAll("span").forEach((span) => {
      span.style.animation = "";
    });
  }
}

function ensureAgentStreamRow(thinkingItem) {
  if (!thinkingItem) return null;
  if (thinkingItem._streamRow) return thinkingItem._streamRow;
  const log = thinkingItem._narrativeLog || thinkingItem.querySelector(".agent-narrative-log");
  if (!log) return null;
  const row = document.createElement("div");
  row.className = "agent-narrative-entry agent-narration agent-stream-content is-typing";
  log.appendChild(row);
  thinkingItem._streamRow = row;
  thinkingItem._streamBuffer = "";
  showThinkingIndicator(thinkingItem);
  return row;
}

function scheduleAgentStreamRender(thinkingItem) {
  if (!thinkingItem || thinkingItem._streamRenderTimer) return;
  thinkingItem._streamRenderTimer = setTimeout(() => {
    thinkingItem._streamRenderTimer = null;
    const row = thinkingItem._streamRow;
    if (!row) return;
    const next = thinkingItem._streamBuffer || "";
    if (thinkingItem._streamRenderedAt === next) return;
    thinkingItem._streamRenderedAt = next;
    row.innerHTML = renderMarkdown(repairMojibakeText(next));
    scrollFeedToBottom();
  }, 24);
}

function flushAgentStreamRender(thinkingItem) {
  if (thinkingItem?._streamRenderTimer) {
    clearTimeout(thinkingItem._streamRenderTimer);
    thinkingItem._streamRenderTimer = null;
  }
  const row = thinkingItem?._streamRow;
  if (!row) return;
  row.classList.remove("is-typing");
  if (thinkingItem._streamBuffer) {
    row.innerHTML = renderMarkdown(repairMojibakeText(thinkingItem._streamBuffer));
  }
}

function collapseDuplicateReportText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const sections = raw.split(/(?=##\s*(?:An[aá]lisis|Reporte\s+Final|Hallazgos|Resultados|Evidencia))/i);
  if (sections.length <= 1) return collapseDuplicateNarrations([raw]).join("\n\n");
  const seen = new Set();
  const kept = [];
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const part = sections[i].trim();
    if (!part) continue;
    const key = part.slice(0, 160).replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.unshift(part);
  }
  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function narrationStreamFingerprint(text = "") {
  return String(text || "")
    .replace(/[✅✓☑]/g, "")
    .slice(0, 280)
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function shouldAcceptNarrationProgress(thinkingEl, text, { delta = false } = {}) {
  // Deltas de token: nunca deduplicar (rompería el stream en vivo).
  if (delta) return true;
  const fp = narrationStreamFingerprint(text);
  if (!fp || fp.length < 36) return true;
  if (thinkingEl._lastNarrationFp === fp) return false;
  thinkingEl._lastNarrationFp = fp;
  return true;
}

function looksLikeAnalysisStreamChunk(text = "") {
  const Preserve = window.EditCoreChatStreamPreserve;
  if (Preserve?.looksLikeAnalysisStreamChunk) return Preserve.looksLikeAnalysisStreamChunk(text);
  const raw = String(text || "");
  if (raw.length < 120) return false;
  return /##\s*(?:Qué|Que)\s+sí\s+funcionó|##\s*(?:Qué|Que)\s+fall[oó]|##\s*Evidencia|##\s*C[oó]mo\s+lo\s+corregir|Cuando autorices procedo|REPORTE\s+DE\s+AN[AÁ]LISIS|##\s*An[aá]lisis\s+del\s+proyecto/i.test(raw);
}

function appendAgentStreamDelta(thinkingItem, text) {
  const raw = String(text || "");
  // Nunca pintar tool_call / function= / parameter= en el chat.
  if (thinkingItem?._toolDumpLocked) {
    if (looksLikeAgentToolDump(raw) || raw.length > 200) return;
  }
  if (looksLikeAgentToolDump(raw)) {
    const cleaned = stripAgentToolXml(raw, { trim: false });
    thinkingItem._toolDumpLocked = true;
    if (!String(thinkingItem._streamBuffer || "").trim() && !cleaned.trim()) {
      setAgentLiveActivity(thinkingItem, "Ejecutando herramienta…");
      return;
    }
    if (cleaned) {
      // Solo la prosa previa al markup de este chunk.
      text = cleaned;
    } else {
      setAgentLiveActivity(thinkingItem, "Ejecutando herramienta…");
      thinkingItem._streamBuffer = stripAgentToolXml(String(thinkingItem._streamBuffer || ""), { trim: false });
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
  }
  // No strip/trim agresivo en tokens normales: destroza espacios del stream.
  const value = humanizeAgentNarration(String(text || ""));
  if (!thinkingItem || !value) return;
  ensureAgentStreamRow(thinkingItem);
  const prev = String(thinkingItem._streamBuffer || "");
  // Anti-doble-escritura: snapshot completo o párrafo ya presente → no concatenar.
  if (prev) {
    const valueTrim = value.trim();
    if (valueTrim.length >= 40 && (prev.endsWith(value) || prev.includes(valueTrim))) {
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    if (value.length >= prev.length && value.startsWith(prev)) {
      thinkingItem._streamBuffer = stripAgentToolXml(value, { trim: false });
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
  }
  // Tokens cortos del LLM: unir con joinAgentStreamText (nunca "fin.Inicio").
  if (prev && value.length <= 64 && !/^#{1,6}\s*Avance\b/i.test(value.trim()) && !looksLikeAnalysisStreamChunk(value)) {
    if (prev.endsWith(value)) {
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    // Snapshot acumulado disfrazado de delta: reemplazar, no concatenar.
    if (value.length >= prev.length && value.startsWith(prev)) {
      thinkingItem._streamBuffer = stripAgentToolXml(value, { trim: false });
      if (looksLikeAgentToolDump(value)) thinkingItem._toolDumpLocked = true;
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    const merged = joinAgentStreamText(prev, value);
    if (looksLikeAgentToolDump(merged)) {
      thinkingItem._streamBuffer = stripAgentToolXml(merged, { trim: false });
      thinkingItem._toolDumpLocked = true;
      setAgentLiveActivity(thinkingItem, "Ejecutando herramienta…");
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    thinkingItem._streamBuffer = merged;
    scheduleAgentStreamRender(thinkingItem);
    return;
  }
  // Avance = progreso de tools (no informe). Acumular, pero topar a ~20 notas
  // para que el buffer nunca compita en tamaño con el reporte final.
  if (/^#{1,6}\s*Avance\b/i.test(value.trim())) {
    const note = value.trim();
    if (!prev) thinkingItem._streamBuffer = note;
    else if (prev.includes(note)) {
      scheduleAgentStreamRender(thinkingItem);
      return;
    } else {
      const merged = prev.endsWith("\n") ? `${prev}\n${note}` : `${prev}\n\n${note}`;
      const blocks = merged.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
      const capped = blocks.length > 20 ? blocks.slice(-20) : blocks;
      thinkingItem._streamBuffer = capped.join("\n\n");
    }
    scheduleAgentStreamRender(thinkingItem);
    return;
  }
  const Preserve = window.EditCoreChatStreamPreserve;
  if (prev && Preserve?.shouldKeepExistingStream?.(prev, value)) {
    scheduleAgentStreamRender(thinkingItem);
    return;
  }
  if (prev) {
    const norm = narrationStreamFingerprint;
    if (prev.includes(value)) return;
    if (value.length > 80 && norm(prev) === norm(value)) return;
    // No pisar un bloque de Avances con prosa corta del modelo.
    if (/^#{1,6}\s*Avance\b/im.test(prev) && value.length < 200 && !looksLikeAnalysisStreamChunk(value)) {
      thinkingItem._streamBuffer = prev.endsWith("\n") ? `${prev}\n${value}` : `${prev}\n\n${value}`;
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    // Dos borradores de reporte de analisis: REEMPLAZAR solo si el nuevo no es mas corto.
    if (looksLikeAnalysisStreamChunk(value) && (looksLikeAnalysisStreamChunk(prev) || prev.length > 400)) {
      const preferIncoming = value.length >= prev.length
        || (value.includes(prev.slice(0, Math.min(64, prev.length))) && value.length > prev.length * 0.85);
      thinkingItem._streamBuffer = preferIncoming ? value : prev;
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    // Snapshot / extension: reemplazar, nunca concatenar turnos enteros.
    if (value.includes(prev) && value.length >= prev.length) {
      thinkingItem._streamBuffer = value;
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    if (value.length > 160 && prev.length > 80 && (
      norm(value).startsWith(norm(prev).slice(0, 48))
      || norm(prev).startsWith(norm(value).slice(0, 48))
      || /##\s*(?:Qué|Que)\s+sí\s+funcionó|##\s*Evidencia|##\s*Resultado/i.test(value)
    )) {
      // Nunca comprimir: si el nuevo es mas corto, conservar el buffer actual.
      thinkingItem._streamBuffer = value.length >= prev.length ? value : prev;
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    // Nuevo turno narrativo: anexar como párrafo (nunca pisar ni pegar sin salto).
    if (/[a-záéíóúñ]$/i.test(prev.trim()) && /^(?:Entendido|He |Ya |Tienes |Reconozco|Analizando|Perfecto|Excelente|Ahora|## )/i.test(value.trim())) {
      thinkingItem._streamBuffer = joinAgentStreamText(prev, value.trim());
      scheduleAgentStreamRender(thinkingItem);
      return;
    }
    if (isGarbledAgentNarration(`${prev}${value}`) && !isGarbledAgentNarration(value)) {
      if (!(prev.length > 500 && value.length < prev.length * 0.6 && looksLikeAnalysisStreamChunk(prev))) {
        thinkingItem._streamBuffer = value;
        scheduleAgentStreamRender(thinkingItem);
        return;
      }
    }
  }
  // Cap duro: si el buffer ya es enorme, solo reemplazar con texto IGUAL o MAS largo.
  if (prev.length > 12_000) {
    thinkingItem._streamBuffer = value.length >= prev.length ? value : prev;
  } else if (!prev) {
    thinkingItem._streamBuffer = value;
  } else {
    thinkingItem._streamBuffer = joinAgentStreamText(prev, value);
  }
  scheduleAgentStreamRender(thinkingItem);
}

function addPlanDelta(thinkingItem, text) {
  appendAgentStreamDelta(thinkingItem, text);
}

function humanizeAgentNarration(text) {
  let cleaned = repairMojibakeText(String(text || ""))
    .replace(/\bbrain_tools\b/gi, "capacidades")
    .replace(/\bbrain_search\b/gi, "memoria del proyecto")
    .replace(/\bbrain_skill\b/gi, "habilidad")
    .replace(/\bai-debugging-and-error-recovery\b/gi, "depuración")
    .replace(/\bai-code-review-and-quality\b/gi, "revisión de código")
    .replace(/\bai-security-and-hardening\b/gi, "seguridad")
    .replace(/\bas-debugging-and-error-recovery\b/gi, "depuración")
    .replace(/\bas-code-review-and-quality\b/gi, "revisión de código")
    .replace(/\bas-security-and-hardening\b/gi, "seguridad");

  cleaned = cleaned
    .replace(/<thinking>\s*/gi, "💭 **Pensamiento del agente:**\n")
    .replace(/<\/thinking>\s*/gi, "\n\n")
    .replace(/<thought>\s*/gi, "💭 **Pensamiento del agente:**\n")
    .replace(/<\/thought>\s*/gi, "\n\n")
    .replace(/<reasoning>\s*/gi, "🧠 **Razonamiento:**\n")
    .replace(/<\/reasoning>\s*/gi, "\n\n");

  // No aplicar normalizeSpanishProse aqui: los deltas del agente traen tablas/paths
  // y normalizar por chunks destroza saltos de linea y pega secciones.
  return cleaned;
}

function addAgentNarrationDelta(thinkingItem, text) {
  const raw = String(text || "");
  if (!thinkingItem || !raw) return;
  // Deduplicar el mismo token si llega por dos canales casi a la vez.
  if (thinkingItem._lastNarrationDelta === raw && (Date.now() - (thinkingItem._lastNarrationDeltaAt || 0)) < 120) {
    return;
  }
  thinkingItem._lastNarrationDelta = raw;
  thinkingItem._lastNarrationDeltaAt = Date.now();
  // Prosa SOLO abajo. Limpiar cualquier texto viejo dentro de Pensamiento.
  if (thinkingItem._thoughtLiveBlock) {
    thinkingItem._thoughtLiveBlock.remove();
    thinkingItem._thoughtLiveBlock = null;
  }
  appendAgentStreamDelta(thinkingItem, raw);
  const summary = thinkingItem?.querySelector?.(".agent-thought-summary");
  if (summary && /Pensamiento/i.test(summary.textContent || "")) {
    summary.textContent = "Pensamiento · en curso…";
  }
}

function addAgentNarration(thinkingItem, text) {
  const value = humanizeAgentNarration(stripAgentToolXml(String(text || ""))).trim();
  if (!thinkingItem || !value) return;
  if (looksLikeAgentToolDump(text) && value.length < 8) return;
  // Líneas de acción del orquestador → panel CoT (no el stream markdown).
  if (/^[⚙️🔍📂✓○→✗]/.test(value) || /^(Creando|Editando|Leyendo|Verificando|Explorando)\b/i.test(value)) {
    appendThoughtLine(thinkingItem, value, { kind: "action" });
    thinkingItem._thoughtLiveBlock = null;
    return;
  }
  // Prosa: jamás dentro de la caja Pensamiento.
  if (thinkingItem._thoughtLiveBlock) {
    thinkingItem._thoughtLiveBlock.remove();
    thinkingItem._thoughtLiveBlock = null;
  }
  ensureAgentStreamRow(thinkingItem);
  const prev = String(thinkingItem._streamBuffer || "");
  const Preserve = window.EditCoreChatStreamPreserve;
  if (prev && Preserve?.shouldKeepExistingStream?.(prev, value)) {
    flushAgentStreamRender(thinkingItem);
    return;
  }
  // Ya streameado: no volver a pegar el mismo párrafo (doble escritura).
  if (prev) {
    const prevTrim = prev.trim();
    const valueTrim = value.trim();
    if (prevTrim === valueTrim || prev.includes(valueTrim)) {
      flushAgentStreamRender(thinkingItem);
      return;
    }
    if (valueTrim.includes(prevTrim) && valueTrim.length >= prevTrim.length) {
      thinkingItem._streamBuffer = value;
      flushAgentStreamRender(thinkingItem);
      scrollFeedToBottom();
      return;
    }
  }
  // No pisar un informe largo con un fragmento corto de phase "narration".
  if (prev.length > 400 && value.length < prev.length * 0.7
    && !(value.includes(prev.slice(0, Math.min(80, prev.length))) && value.length >= prev.length)) {
    thinkingItem._streamBuffer = joinAgentStreamText(prev, value);
    flushAgentStreamRender(thinkingItem);
    scrollFeedToBottom();
    return;
  }
  // Snapshot más largo que contiene el anterior → reemplazar.
  if (prev && value.includes(prev.slice(0, Math.min(64, prev.length))) && value.length >= prev.length) {
    thinkingItem._streamBuffer = value;
  } else if (prev) {
    thinkingItem._streamBuffer = joinAgentStreamText(prev, value);
  } else {
    thinkingItem._streamBuffer = value;
  }
  flushAgentStreamRender(thinkingItem);
  scrollFeedToBottom();
}

function progressDedupeKey(progress) {
  const phase = String(progress?.phase || "");
  const stage = String(progress?.stage || (progress?.ok === undefined ? "running" : progress?.ok ? "done" : "failed"));
  const name = String(progress?.name || "");
  const target = String(progress?.input?.path || progress?.input?.filePath || progress?.input?.query || progress?.input?.command || "").slice(0, 80);
  return `${phase}:${stage}:${name}:${target}`;
}

function progressRowKey(progress) {
  const phase = String(progress?.phase || "");
  const name = String(progress?.name || "");
  const target = String(progress?.input?.path || progress?.input?.filePath || progress?.input?.query || progress?.input?.command || "").slice(0, 120);
  if (name) return `tool:${name}:${target}`;
  if (phase === "startup" || phase === "model" || phase === "heartbeat") return `phase:${phase}`;
  return progressDedupeKey(progress);
}

function addAgentStepToThinking(thinkingItem, progress) {
  if (!thinkingItem) return;
  const text = agentProgressText(progress);
  if (!text) return;
  const cleanText = text.replace(/^[✓○→✗]\s*/, "");
  setThinkingStatus(thinkingItem, cleanText);
  setAgentLiveActivity(thinkingItem, cleanText);
  showThinkingIndicator(thinkingItem);
  scrollFeedToBottom();
}

function sanitizeLiveActivityLabel(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "Trabajando…";
  if (/^(?:esperando\s+al\s+modelo|consultando\s+al\s+modelo|verificando\s+(?:el\s+)?(?:agente\s+con\s+)?modelo|verificando\s+agente|cambiando\s+de\s+modelo|siguiente\s+paso\s+con\s+el\s+modelo|modelo\s+(?:razonando|preparando|colgado)|recibiendo\s+herramientas)/i.test(text)) {
    return "Trabajando…";
  }
  if (/\bes\s+solo\s+chat;\s+usando\b/i.test(text)) return "Trabajando…";
  if (/failover|fallback|cambiando\s+de\s+modelo|siguiente\s+modelo/i.test(text)
    && /modelo|provider|meai|apicredits|claude|gpt|deepseek/i.test(text)) {
    return "Trabajando…";
  }
  if (/^(?:meai|apicredits|anthropic|openai|gemini|claude|gpt|deepseek|grok)\b/i.test(text)
    && /modelo|provider|failover|fallback/i.test(text)) {
    return "Trabajando…";
  }
  return text
    .replace(/\b(?:meai|apicredits)\/[^\s…]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "Trabajando…";
}

function agentProgressText(progress) {
  if (!progress) return "";
  const phase = String(progress.phase || "");
  if (phase === "narration" || phase === "narration_delta") return "";
  if (progress.silentFailover === true) return "Trabajando…";
  if (phase === "background_start") {
    return String(progress.text || `Tarea ${progress.taskId || ""} en segundo plano…`);
  }
  if (phase === "background") {
    return String(progress.text || "Subagente en segundo plano…");
  }
  if (phase === "background_complete") {
    return String(progress.text || `Tarea ${progress.taskId || ""} finalizada en segundo plano.`);
  }
  if (phase === "background_error") {
    return String(progress.text || `Tarea en segundo plano falló.`);
  }
  if (phase === "confirm") return String(progress.text || "Esperando tu autorizacion en el chat para una accion del agente...");
  if (phase === "human_intervention") return "Se necesita intervencion humana para continuar con seguridad.";
  if (phase === "repair") return "Encontre un problema. Preparando una correccion...";
  if (phase === "direction") {
    if (shouldSkipDirectionProgress(progress.text)) return "";
    return "Reorientando la tarea activa...";
  }
  if (phase === "startup") {
    const startupText = String(progress.text || "");
    if (/FOCO/i.test(startupText)) return startupText;
    if (/cerebro|modelo|verificando/i.test(startupText)) return "Trabajando…";
    return startupText || (progress.stage === "analysis" ? "Iniciando analisis del proyecto..." : "Iniciando ejecucion...");
  }
  if (phase === "heartbeat") {
    const totalSec = Math.max(0, Math.floor(Number(progress.elapsedMs || 0) / 1000));
    if (totalSec <= 0) return "Trabajando…";
    return `Trabajando… ${formatElapsed(totalSec)}`;
  }
  if (phase === "model") {
    return sanitizeLiveActivityLabel(progress.text || "Trabajando…");
  }
  const name = String(progress.name || "");
  const input = progress.input || {};
  const running = progress.stage === "running" || (phase === "tool" && progress.ok === undefined && progress.stage !== "done");
  const done = progress.stage === "done" || progress.ok === true;
  const failed = progress.ok === false;
  const error = String(progress.result?.error || progress.result || "error").replace(/\s+/g, " ").slice(0, 160);
  const target = String(input.path || input.filePath || input.query || input.command || "").replace(/\s+/g, " ").slice(0, 120);
  if (failed) {
    if (name === "read_file" && /no aparecio al listar|Path no descubierto|Antes de leer|PATH_NOT_DISCOVERED/i.test(error)) {
      const file = target ? target.split(/[/\\]/).pop() : "archivo";
      return `○ ${file} omitido (no estaba en el listado real)`;
    }
    if (name === "read_file" && /ENOENT|no such file|Archivo no encontrado|no encontrado/i.test(error)) {
      const file = target ? target.split(/[/\\]/).pop() : "archivo";
      return `○ ${file} no existe (el agente seguira con los archivos reales del proyecto)`;
    }
    if (name === "run_command" && /not a git repository|no es un repositorio git|Git no inicializado/i.test(error)) {
      return "○ Git no inicializado (normal en proyecto nuevo)";
    }
    if (name === "run_command" && /no esta disponible|list_files|Argumentos de listado/i.test(error)) {
      return "○ Exploracion por shell bloqueada → usar list_files";
    }
    if (name === "run_command" && /Command failed|\(code\s*\d+\)|exit\s*\d+|verificacion finalizado/i.test(error)) {
      const cmd = (target || "comando").slice(0, 100);
      if (/\b(dir|ls|tree|get-childitem|gci)\b/i.test(cmd) || /cmd\s+\/c\s+dir/i.test(cmd)) {
        return `○ ${cmd} omitido → usar list_files`;
      }
      const codeMatch = error.match(/\(code\s*(\d+)\)|exit\s+(\d+)/i);
      const code = codeMatch?.[1] || codeMatch?.[2] || "?";
      return `○ ${cmd} → exit ${code} (evidencia de verificacion; no es fallo de la herramienta)`;
    }
    if (name === "read_file" && /No es archivo|carpeta|isDirectory/i.test(error)) {
      return `○ ${target || "Ruta"} es una carpeta; el agente listara archivos y continuara`;
    }
    return target
      ? `No pude completar ${name.replace(/_/g, " ")} en ${target}: ${error}`
      : `Fallo ${name.replace(/_/g, " ")}: ${error}`;
  }
  if (name === "list_files") {
    if (running) return target ? `→ Explorando ${target}...` : "→ Explorando archivos...";
    if (done) {
      if (Array.isArray(progress.result) && progress.result.length === 0 && target) {
        return `○ ${target} aun no existe (se creara al escribir archivos)`;
      }
      return target ? `✓ Explorado ${target}` : "✓ Archivos explorados";
    }
    if (failed && /ENOENT|no such file|no existe/i.test(error)) {
      return target ? `○ ${target} aun no existe → usar write_file` : "○ Carpeta no existe → usar write_file";
    }
  }
  if (name === "read_file") {
    const file = target ? target.split(/[/\\]/).pop() : "archivo";
    if (running) return `→ Leyendo ${file}...`;
    if (done) return progress.cached ? `✓ ${file} (caché)` : `✓ Leído ${file}`;
  }
  if (name === "search_files") {
    if (running) return target ? `→ Buscando "${target}"...` : "→ Buscando en el proyecto...";
    if (done) return target ? `✓ Búsqueda "${target}" lista` : "✓ Búsqueda completada";
  }
  if (name === "write_file" || name === "replace_in_file" || name === "apply_diff") {
    const rel = ProjectFilesUi?.resolveTouchedRelativePath?.(state.projectRoot, target) || "";
    const file = rel || (target ? target.split(/[/\\]/).pop() : "archivo");
    if (running) return `→ Escribiendo ${file}...`;
    if (done) return `✓ Escrito ${file}`;
  }
  if (name === "run_command") {
    if (progress?.result?.usedTool === "list_files") {
      const listed = String(progress.result.path || ".");
      return done ? `✓ Listado via list_files (${listed})` : `→ Listando via list_files (${listed})...`;
    }
    if (running) return target ? `→ Ejecutando: ${target.slice(0, 100)}` : "→ Ejecutando comando...";
    if (done) {
      const resultObj = progress.result && typeof progress.result === "object" ? progress.result : null;
      const resultText = typeof progress.result === "string" ? progress.result : String(progress.result?.output || progress.result || "");
      const failedDiag = (resultObj?.diagnostic === true && resultObj?.passed === false)
        || progress.verificationPassed === false
        || /verificacion finalizado con exit\s+[1-9]|Resultado de verificacion:\s*FALLO/i.test(resultText);
      if (failedDiag) {
        const codeMatch = resultText.match(/exit\s+(\d+)/i);
        const code = resultObj?.exitCode ?? codeMatch?.[1] ?? "≠0";
        return `✗ ${(target || "comando").slice(0, 80)} → FALLO exit ${code} (no cuenta como OK)`;
      }
      if (/verificacion finalizado con exit|exit\s+[1-9]/i.test(resultText)) {
        const codeMatch = resultText.match(/exit\s+(\d+)/i);
        return `○ ${(target || "comando").slice(0, 80)} → exit ${codeMatch?.[1] || "≠0"} (evidencia)`;
      }
      return target ? `✓ Comando listo: ${target.slice(0, 80)}` : "✓ Comando ejecutado";
    }
  }
  if (name === "project_discovery" || name === "codebase_map") {
    if (running) return "→ Mapeando el proyecto...";
    if (done) return "✓ Proyecto mapeado";
  }
  if (name === "brain_search") {
    if (running) return "→ Consultando memoria...";
    if (done) return "✓ Memoria consultada";
  }
  if (name === "brain_skill") {
    const skill = target ? target.split(/[/\\]/).pop() : "habilidad";
    if (running) return `→ Revisando ${skill}...`;
    if (done) return `✓ Revisado ${skill}`;
  }
  if (name === "brain_tools") {
    if (running) return "→ Revisando capacidades...";
    if (done) return "✓ Capacidades revisadas";
  }
  if (name === "connection_status" || name === "service_read") {
    if (running) return "→ Consultando servicio...";
    if (done) return "✓ Servicio consultado";
  }
  if (name) {
    const label = name.replace(/_/g, " ");
    if (running) return `→ ${label}...`;
    if (done) return `✓ ${label}`;
  }
  return "";
}

function stopThinkingAnimations(thinking) {
  for (const timer of thinking?._narrativeTimers || []) clearInterval(timer);
  if (thinking) thinking._narrativeTimers = [];
  if (!thinking) return;
  const dots = thinking.querySelector?.(".thinking-dots");
  if (dots) {
    dots.hidden = true;
    dots.style.display = "none";
    dots.querySelectorAll("span").forEach((span) => {
      span.style.animation = "none";
    });
  }
  // No borrar el nodo: CONTINUA / progreso mid-run necesitan reactivarlo.
  thinking.querySelector?.(".thinking-primary")?.classList.add("hidden");
  thinking.classList.remove("is-thinking-live");
}

/** Cierra UI de “trabajando…” sin borrar el historial del turno. */
function settleAgentTurnChrome(thinking, { failed = false, force = false } = {}) {
  if (!thinking) return;
  const runId = String(thinking._runId || thinking.dataset?.runId || "").trim();
  const stillLive = !force && (
    (runId && activeAgentThinkingRuns.has(runId))
    || [...activeAgentThinkingRuns.values()].some((entry) => entry?.thinking === thinking)
    || [...activePromptRequests.values()].some((job) => job.agentExecuting && (
      job.thinking === thinking
      || (runId && (String(job.runId || "") === runId || String(job.planRunId || "") === runId))
    ))
  );
  if (stillLive && !failed) {
    showThinkingIndicator(thinking);
    setAgentLiveActivity(thinking, "Trabajando…");
    return;
  }
  thinking._settled = true;
  stopThinkingAnimations(thinking);
  thinking.classList.remove("thinking-msg", "is-thinking-live");
  thinking.classList.add("assistant", "agent-execution-done");
  if (failed) thinking.classList.add("is-failed");
  const thoughtSummary = thinking.querySelector?.(".agent-thought-summary");
  if (thoughtSummary) thoughtSummary.textContent = "Pensamiento";
  if (thinking._thoughtAccordion) thinking._thoughtAccordion.open = false;
  const primary = thinking.querySelector?.(".thinking-primary");
  if (primary) {
    primary.classList.add("hidden");
    primary.hidden = true;
    primary.style.display = "none";
  }
  const dots = thinking.querySelector?.(".thinking-dots");
  if (dots) {
    dots.hidden = true;
    dots.style.display = "none";
  }
  setAgentLiveActivity(thinking, "");
  revealAgentTurnActions(thinking, { failed });
}

/** Mata bolitas + Pensamiento vivo de inmediato (ALTO / CANCELA TODO). */
function forceKillAllAgentUi(statusText = "Detenido.") {
  agentUiHardStopUntil = Date.now() + 8000;
  const thinkings = new Set();
  for (const entry of activeAgentThinkingRuns.values()) {
    if (entry?.thinking) thinkings.add(entry.thinking);
  }
  for (const job of activePromptRequests.values()) {
    job.agentExecuting = false;
    job.cancelled = true;
    if (job.thinking) thinkings.add(job.thinking);
  }
  document.querySelectorAll?.(".thinking-msg, .is-thinking-live, .msg.assistant.is-thinking")?.forEach?.((el) => {
    thinkings.add(el);
  });
  activeAgentThinkingRuns.clear();
  activePlanStreams.clear();
  for (const thinking of thinkings) {
    try {
      setThinkingStatus(thinking, statusText);
      settleAgentTurnChrome(thinking, { failed: true, force: true });
    } catch {}
  }
  if ($("status")) $("status").textContent = statusText;
  setRunningControls();
  updateSendButtonState?.();
}

function collapseDuplicateNarrations(parts = []) {
  const seen = new Set();
  const kept = [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = String(parts[i] || "").trim();
    if (!part) continue;
    const key = part.slice(0, 160).replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.unshift(part);
  }
  return kept;
}

function extractThinkingNarrativeFallback(thinking) {
  const narrations = thinking?.querySelectorAll?.(".agent-narrative-log .agent-narration") || [];
  const rawParts = [...narrations].map((row) => String(row.textContent || "").trim()).filter(Boolean);
  // Solo la ultima narracion coherente (evitar volcar historial pisado completo).
  for (let i = rawParts.length - 1; i >= 0; i -= 1) {
    if (!isGarbledAgentNarration(rawParts[i]) && rawParts[i].length > 40) return rawParts[i];
  }
  const parts = collapseDuplicateNarrations(rawParts);
  if (parts.length) return parts[parts.length - 1];
  // No incluir la fila de actividad (startup/model) ni duplicar la misma linea.
  const steps = thinking?.querySelectorAll?.(
    ".agent-narrative-log .agent-narrative-entry:not(.agent-narration):not(.agent-live-activity)",
  ) || [];
  const stepText = [];
  const seen = new Set();
  for (const row of steps) {
    const line = String(row.textContent || "").trim();
    if (!line) continue;
    // Ignorar frases de estado de inicio / transicion
    if (/^(?:iniciando|preparando|revisando|analizando|consultando|conectando)\b/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    stepText.push(line);
  }
  if (stepText.length) {
    return `Analisis interrumpido. Pasos ejecutados:\n${stepText.slice(-12).map((line) => `- ${line}`).join("\n")}`;
  }
  const live = String(thinking?._activityRow?.textContent || "").trim();
  if (live && !/^(?:iniciando|preparando|revisando|consultando|pensando)\b/i.test(live)) {
    return `Analisis interrumpido. Ultimo estado: ${live}`;
  }
  return "";
}

function isGarbledAgentNarration(text = "") {
  const Preserve = window.EditCoreChatStreamPreserve;
  if (Preserve?.isGarbledAgentNarration) return Preserve.isGarbledAgentNarration(text);
  const raw = String(text || "");
  if (!raw.trim()) return false;
  // Corte a mitad de palabra/titulo (ej. "**Arquit").
  if (/\*\*[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]{2,24}\s*$/m.test(raw.trim()) && raw.length < 2500) return true;
  if (/Bas[aá]ndome en los \d+ archivos/i.test(raw) && !/##\s*(?:Qué|Que)\s+sí\s+funcionó/i.test(raw)) return true;
  // Pegado de turnos: "archivo paEntendido" / "del pac`.La"
  if (/[a-záéíóúñ]{2,}(?:pa|de|con|el|la|un|en|del|pac)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(raw)) return true;
  if (/\bEntendido\b/i.test(raw) && /\b(?:Ya (?:entregu[eé]|complet)|He presentado)\b/i.test(raw) && raw.length < 4000) return true;
  if ((raw.match(/\bEntendido\b/gi) || []).length >= 2) return true;
  if (/`\s*[A-ZÁÉÍÓÚ]/.test(raw) && /propuesta|reporte|package/i.test(raw) && raw.length < 3500) return true;
  if (raw.length < 400) return false;
  const entendidos = (raw.match(/\bEntendido\b/gi) || []).length;
  const tienes = (raw.match(/\bTienes raz[oó]n\b/gi) || []).length;
  const reconozco = (raw.match(/\bReconozco\b/gi) || []).length;
  if (entendidos + tienes + reconozco >= 5) return true;
  if (raw.length > 6000 && (entendidos + tienes) >= 3) return true;
  const truncHits = (raw.match(/\b(?:reles|comenio|grouing|fundamtal|intific|halazgos|documenles|fcional|prpuesta|mbio|dription|descron)\b/gi) || []).length;
  if (truncHits >= 2) return true;
  return false;
}

function isGroundedAnalysisReportText(text = "") {
  const Preserve = window.EditCoreChatStreamPreserve;
  if (Preserve?.isGroundedAnalysisReportText) return Preserve.isGroundedAnalysisReportText(text);
  const raw = String(text || "");
  return /##\s*(?:Qué|Que)\s+sí\s+funcionó/i.test(raw)
    && /##\s*(?:Qué|Que)\s+fall[oó]/i.test(raw)
    && /##\s*Evidencia/i.test(raw);
}

function isAvanceProgressOnly(text = "") {
  const Preserve = window.EditCoreChatStreamPreserve;
  if (Preserve?.isAvanceProgressOnly) return Preserve.isAvanceProgressOnly(text);
  const raw = String(text || "").trim();
  if (!raw || isGroundedAnalysisReportText(raw)) return false;
  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const avanceBlocks = blocks.filter((b) => /^#{1,6}\s*Avance\b/i.test(b));
  return avanceBlocks.length > 0 && avanceBlocks.length >= Math.ceil(blocks.length * 0.55);
}

function finalizeThinkingAsAssistant(thinking, text, usage, elapsedSeconds, options = {}) {
  const runId = String(thinking?._runId || thinking?.dataset?.runId || "").trim();
  if (runId) activeAgentThinkingRuns.delete(runId);
  for (const [key, entry] of [...activeAgentThinkingRuns.entries()]) {
    if (entry?.thinking === thinking) activeAgentThinkingRuns.delete(key);
  }
  for (const job of activePromptRequests.values()) {
    if (job.thinking === thinking || (runId && (String(job.runId || "") === runId || String(job.planRunId || "") === runId))) {
      job.agentExecuting = false;
    }
  }
  settleAgentTurnChrome(thinking, { failed: false, force: true });
  flushAgentStreamRender(thinking);
  const serverText = collapseDuplicateReportText(repairMojibakeText(stripAgentToolXml(String(text || ""))).trim());
  const streamedRaw = stripAgentToolXml(String(thinking?._streamBuffer || "")).trim();
  const streamed = collapseDuplicateReportText(repairMojibakeText(streamedRaw));
  const narrativeFallback = collapseDuplicateReportText(stripAgentToolXml(extractThinkingNarrativeFallback(thinking)));
  const Preserve = window.EditCoreChatStreamPreserve;

  // Deber ser: el informe del orquestador (hallazgos + plan) pinta el chat.
  // Los ### Avance son solo progreso y nunca sustituyen el reporte final.
  let value = "";
  if (serverText && !isAvanceProgressOnly(serverText) && (
    isGroundedAnalysisReportText(serverText)
    || looksLikeAnalysisStreamChunk(serverText)
    || (serverText.length >= 200 && !isAvanceProgressOnly(serverText))
  )) {
    value = serverText;
  } else if (Preserve?.pickBestFinalChatText) {
    value = Preserve.pickBestFinalChatText(serverText, streamed, narrativeFallback);
  }
  if (!value) {
    value = (!isAvanceProgressOnly(serverText) && serverText)
      || (!isAvanceProgressOnly(streamed) && streamed)
      || narrativeFallback
      || "El agente termino sin generar un reporte visible. Reintenta el analisis.";
  }

  const groundedReport = isGroundedAnalysisReportText(value) || looksLikeAnalysisStreamChunk(value);
  const dropAvances = groundedReport || (serverText.length >= 120 && !isAvanceProgressOnly(serverText) && value === serverText);

  if (thinking) {
    thinking._streamBuffer = value;
  }
  if (!thinking) return append("assistant", value, usage, true, elapsedSeconds);
  // settleAgentTurnChrome ya quitó thinking-msg / bolitas
  const head = thinking.querySelector(".msg-head");
  if (head) head.textContent = `EditCoreAI ${formatElapsed(elapsedSeconds)}`;
  revealAgentTurnActions(thinking, { failed: false });
  // Evitar texto triplicado: cerrar Thought y limpiar stream intermedio; deja solo la respuesta final.
  if (thinking._thoughtAccordion) thinking._thoughtAccordion.open = false;
  const thoughtSummaryDone = thinking.querySelector?.(".agent-thought-summary");
  if (thoughtSummaryDone) thoughtSummaryDone.textContent = "Pensamiento";
  if (thinking._streamRow) {
    thinking._streamRow.remove();
    thinking._streamRow = null;
  }
  if (thinking._thoughtLiveBlock) {
    thinking._thoughtLiveBlock.remove();
    thinking._thoughtLiveBlock = null;
  }
  const body = thinking.querySelector(".msg-body");
  if (body) body.classList.remove("msg-thinking");
  let finalBody = body?.querySelector(".agent-final-response");
  if (!finalBody && body) {
    finalBody = document.createElement("div");
    finalBody.className = "agent-final-response";
    const exec = body.querySelector(".agent-execution-container");
    if (exec) exec.insertAdjacentElement("afterend", finalBody);
    else body.appendChild(finalBody);
  }
  if (finalBody) {
    finalBody.innerHTML = renderMarkdown(repairMojibakeText(value));
  }
  if (thinking._streamRow && !dropAvances && value) {
    thinking._streamRow.innerHTML = renderMarkdown(repairMojibakeText(value));
    thinking._streamRow.classList.remove("is-typing");
  }
  if (usage && !thinking.querySelector(".msg-meta")) {
    const metaText = usageMetaText(usage);
    if (metaText) {
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = metaText;
      thinking.appendChild(meta);
    }
  }
  scrollFeedToBottom();
  return thinking;
}

function removeThinking(item = null) {
  stopThinkingAnimations(item || document.querySelector(".thinking-msg"));
  if (item) item.remove();
  else document.querySelector(".thinking-msg")?.remove();
}

function startResponseTimer(head) {
  if (!head) return () => 0;
  head.textContent = "EditCoreAI";
  const startedAt = Date.now();
  return () => {
    head.textContent = "EditCoreAI";
    return Math.floor((Date.now() - startedAt) / 1000);
  };
}

function renderBrainSnapshot(snapshot) {
  const host = $("brainSnapshot");
  if (!host) return;
  host.replaceChildren();
  const values = [
    `Skills: ${snapshot?.skillCount || 0}`,
    `Instalados: ${snapshot?.installed?.items?.length || snapshot?.installed?.length || 0}`,
    `Memorias: ${snapshot?.memoryCount || 0}`,
    `RAG: ${snapshot?.index?.totalFiles || 0} archivos`,
  ];
  for (const value of values) {
    const chip = document.createElement("span");
    chip.className = "brain-chip";
    chip.textContent = value;
    host.appendChild(chip);
  }
  const health = $("brainHealth");
  if (health) {
    const count = Number(snapshot?.skillCount || 0);
    const ready = snapshot?.ready === true && count > 0;
    health.dataset.state = ready ? "ready" : "error";
    const strong = health.querySelector("strong");
    if (strong) {
      strong.textContent = ready
        ? `Cerebro operativo · ${count} skills disponibles para chat y agentes`
        : "Cerebro incompleto · revisa la copia local de herramientas";
    }
  }
}

async function loadBrainCatalog() {
  const query = $("brainSearch")?.value?.trim() || "";
  if ($("brainStatus")) $("brainStatus").textContent = "Consultando Bodega…";
  const [items, snapshot, audit] = await Promise.all([
    window.editcoreBrain.catalog(query, 50),
    window.editcoreBrain.snapshot(state.projectRoot || ""),
    window.editcoreBrain.audit(state.projectRoot || "", false),
  ]);
  const installedList = snapshot?.installed?.items || snapshot?.installed || [];
  const installedIds = new Set(installedList.map((item) => item.id));
  renderBrainSnapshot(snapshot);
  renderBrainAudit(audit);
  // Bodega es global: no exigir proyecto abierto. Guardar en proyecto activo si existe.
  const project = activeProject();
  if (project) {
    project.brainSnapshot = snapshot;
    saveProjects();
  } else {
    state.brainSnapshot = snapshot;
  }
  const host = $("brainCatalogList");
  if (!host) {
    if ($("brainStatus")) {
      $("brainStatus").textContent = `${(items || []).length} elementos · Cerebro común activo`;
    }
    return;
  }
  host.replaceChildren();
  for (const item of items || []) {
    const card = document.createElement("article"); card.className = "brain-card";
    const head = document.createElement("div"); head.className = "brain-card-head";
    const title = document.createElement("span"); title.className = "brain-card-title"; title.textContent = item.name || item.id;
    const button = document.createElement("button"); button.type = "button"; button.className = "brain-install-btn";
    const installed = installedIds.has(item.id); button.textContent = installed ? "Instalado" : "Instalar"; button.disabled = installed;
    button.addEventListener("click", async () => {
      if (!confirm(`Instalar ${item.name || item.id} en el Cerebro global de EditCore? Estará disponible para todos los agentes y proveedores.`)) return;
      button.disabled = true; button.textContent = "Instalando…";
      try { await window.editcoreBrain.install(state.projectRoot || "", item.id); await loadBrainCatalog(); }
      catch (error) { button.disabled = false; button.textContent = "Reintentar"; if ($("brainStatus")) $("brainStatus").textContent = error?.message || String(error); }
    });
    const meta = document.createElement("div"); meta.className = "brain-card-meta"; meta.textContent = `${item.type || "skill"} · ${item.status || "disponible"} · riesgo ${item.risk || "no indicado"}`;
    const desc = document.createElement("div"); desc.className = "brain-card-meta"; desc.textContent = item.description || "Sin descripción";
    head.append(title, button); card.append(head, meta, desc); host.appendChild(card);
  }
  if ($("brainStatus")) {
    $("brainStatus").textContent = `${(items || []).length} elementos · Cerebro común activo para chat y agentes`;
  }
}

function renderBrainAudit(audit) {
  const host = $("brainToolsAudit");
  if (!host) return;
  host.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "brain-audit-row";
  const invalid = Number(audit?.invalidInstalledCount || 0);
  summary.dataset.state = invalid ? "error" : "ok";
  summary.textContent = `Herramientas activas: ${audit?.activeInstalledCount || 0} · invalidas: ${invalid} · skills base: ${audit?.sharedSkillCount || 0}`;
  host.appendChild(summary);
  for (const item of (audit?.installed || []).filter(row => row.status !== "active").slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "brain-audit-row";
    row.dataset.state = item.status === "disabled" ? "disabled" : "error";
    row.textContent = `${item.name || item.id}: ${item.reason || item.status}`;
    host.appendChild(row);
  }
}

async function runBrainAudit() {
  const button = $("brainAuditBtn");
  button.disabled = true;
  button.textContent = "Auditando...";
  try {
    const audit = await window.editcoreBrain.audit(state.projectRoot || "", true);
    renderBrainAudit(audit);
    $("brainStatus").textContent = `Auditoria lista: ${audit.activeInstalledCount || 0} activas, ${audit.invalidInstalledCount || 0} revisadas, ${audit.repairedCount || 0} ajustadas`;
    await loadBrainCatalog();
  } catch (error) {
    $("brainStatus").textContent = error?.message || String(error);
  } finally {
    button.disabled = false;
    button.textContent = "Auditar herramientas";
  }
}

async function installBrainRepo() {
  const input = $("brainRepoUrl");
  const button = $("brainInstallRepoBtn");
  const url = input.value.trim();
  if (!url) { $("brainStatus").textContent = "Pega primero el link del repo GitHub."; return; }
  button.disabled = true;
  button.textContent = "Analizando...";
  try {
    const result = await window.editcoreBrain.installRepo(state.projectRoot || "", url);
    input.value = "";
    $("brainStatus").textContent = result.skillCount
      ? `Repo instalado: ${result.item.name} con ${result.skillCount} skill(s)`
      : `Repo revisado: ${result.item.name}; queda deshabilitado hasta que tenga SKILL.md compatible`;
    await loadBrainCatalog();
  } catch (error) {
    $("brainStatus").textContent = error?.message || String(error);
  } finally {
    button.disabled = false;
    button.textContent = "Añadir repo";
  }
}

function agentVerificationMarkdown(report) {
  const access = report?.projectAccess || {};
  const summary = report?.summary || {};
  const providerLines = (report?.providerModels || []).flatMap((provider) => {
    const rows = (provider.models || []).map((model) => {
      const state = model.ok ? "OK" : model.chatOK ? "CHAT OK / TOOL ERROR" : "ERROR";
      const detail = model.toolError || model.error || "";
      return `- ${model.label}: ${state}${detail ? ` - ${detail}` : ""}`;
    });
    return [
      `\n**Proveedor ${provider.providerKey}** - modelos: ${provider.totalModels || 0}, chat OK: ${provider.chatOK || 0}, tool OK: ${provider.toolOK || 0}${provider.modelListOK ? "" : `, lista modelos: ${provider.modelListError || "error"}`}`,
      ...rows,
    ];
  });
  return [
    "**Verificacion real de agente**",
    "",
    `Proyecto usado: ${access.projectRoot || "sin proyecto"}`,
    `Permiso efectivo: ${access.permissionMode || "sin permiso"}`,
    `Lectura/listado: ${access.list?.ok ? "OK" : "ERROR"}${access.list?.error ? ` - ${access.list.error}` : ""}`,
    `Leer archivo: ${access.read?.ok ? `OK (${access.read.path})` : "ERROR"}${access.read?.error ? ` - ${access.read.error}` : ""}`,
    `Escritura real: ${access.write?.skipped ? "BLOQUEADA POR SOLO LECTURA" : access.write?.ok ? `OK (${access.write.path})` : "ERROR"}${access.write?.error ? ` - ${access.write.error}` : ""}`,
    `Comando real: ${access.command?.skipped ? "BLOQUEADO POR SOLO LECTURA" : access.command?.ok ? `OK (${access.command.command}: ${access.command.output})` : "ERROR"}${access.command?.error ? ` - ${access.command.error}` : ""}`,
    `Limpieza temporal: ${access.cleanup?.ok ? "OK" : "ERROR"}${access.cleanup?.error ? ` - ${access.cleanup.error}` : ""}`,
    "",
    `Modelos probados: ${summary.modelsTested || 0}`,
    `Modelos que responden chat: ${summary.chatOK || 0}`,
    `Modelos aptos para agente/tools: ${summary.toolOK || 0}`,
    `Estado general: ${summary.fullyOperational ? "OPERATIVO" : "NO OPERATIVO"}`,
    ...providerLines,
  ].join("\n");
}

async function runAgentVerification() {
  const button = $("verifyAgentBtn");
  if (!state.projectRoot) {
    $("status").textContent = "Abre un proyecto para verificar agente";
    await pickProject().catch(() => undefined);
    if (!state.projectRoot) return;
  }
  if (button) button.disabled = true;
  const previousText = button?.textContent || "";
  if (button) button.textContent = "Verificando...";
  $("status").textContent = "Verificando permisos reales del agente y modelos...";
  try {
    const report = await window.editcoreAgent.verify({
      projectRoot: state.projectRoot,
      permissionMode: state.permissionMode,
    });
    const text = agentVerificationMarkdown(report);
    append("assistant", text);
    rememberMessage("assistant", text);
    $("status").textContent = report.summary?.fullyOperational
      ? `Agente operativo · ${report.summary.toolOK} modelos aptos`
      : `Verificacion con fallas · ${report.summary?.toolOK || 0} modelos aptos`;
  } catch (error) {
    const message = `Verificacion de agente fallida: ${error?.message || String(error)}`;
    append("assistant", message);
    rememberMessage("assistant", message);
    $("status").textContent = "Verificacion fallida";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

async function verifyAgentForCurrentProjectOnce() {
  if ($("runMode")?.value !== "agent" || !state.projectRoot) return;
  const job = buildPromptJob("Verificacion de compatibilidad del agente");
  if (!job) return;
  const key = `editcore-agent-model-verified:${normalizeProjectRoot(state.projectRoot)}:${agentCapabilityKey(job)}`;
  if (sessionStorage.getItem(key) === "1") return;
  sessionStorage.setItem(key, "1");
  try {
    const result = await ensureAgentModelCapability(job);
    $("status").textContent = "Listo";
  } catch (error) {
    sessionStorage.removeItem(key);
    if (typeof window.addLog === "function") {
      window.addLog("warn", String(error?.message || error));
    }
    $("status").textContent = "Listo";
  }
}

async function openBrain() {
  closeAllToolbarMenus();
  const dialog = $("brainDialog");
  if (!dialog) {
    appendMessage("assistant", "Cerebro no disponible en esta build.");
    return;
  }
  if (!window.editcoreBrain?.catalog) {
    appendMessage("assistant", "IPC del Cerebro no registrado. Reinicia EditCoreAI.");
    return;
  }
  dialog.showModal();
  await loadBrainCatalog().catch((error) => {
    $("brainStatus").textContent = error?.message || String(error);
    const health = $("brainHealth");
    if (health) {
      health.dataset.state = "error";
      const strong = health.querySelector("strong");
      if (strong) strong.textContent = "Cerebro con error";
    }
  });
}

function inspectorProjectMessages() {
  const project = activeProject();
  if (!project) return [];
  if (project.inspectorChatVersion !== INSPECTOR_CHAT_VERSION) {
    project.inspectorMessages = [];
    project.inspectorChatVersion = INSPECTOR_CHAT_VERSION;
    saveProjects();
  }
  project.inspectorMessages ||= [];
  return project.inspectorMessages;
}

function sanitizeInspectorText(value) {
  return String(value || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function inspectorInlineMarkdown(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderInspectorMarkdown(value) {
  const lines = sanitizeInspectorText(value).split(/\r?\n/);
  const html = [];
  const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${inspectorInlineMarkdown(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      html.push(`<table><thead><tr>${headers.map((cell) => `<th>${inspectorInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inspectorInlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      html.push(`<h${level}>${inspectorInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ""));
      html.push(`<ol>${items.map((item) => `<li>${inspectorInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*]\s+/, ""));
      html.push(`<ul>${items.map((item) => `<li>${inspectorInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (!line.trim()) html.push("<div class=\"inspector-spacer\"></div>");
    else html.push(`<div>${inspectorInlineMarkdown(line)}</div>`);
    index += 1;
  }
  return html.join("");
}

function inspectorSetTab(tab) {
  const isReports = tab === "reports";
  $("inspectorChatTab")?.classList.toggle("active", !isReports);
  $("inspectorReportsTab")?.classList.toggle("active", isReports);
  $("inspectorChatPane")?.classList.toggle("active", !isReports);
  $("inspectorReportsPane")?.classList.toggle("active", isReports);
}

function inspectorAppend(role, text) {
  const feed = $("inspectorFeed");
  if (!feed) return null;
  const item = document.createElement("article");
  item.className = `inspector-msg ${role}`;
  const head = document.createElement("div");
  head.className = "inspector-msg-head";
  head.textContent = role === "user" ? "Tu" : "Inspector";
  const body = document.createElement("div");
  body.className = "inspector-msg-body";
  if (role === "assistant") body.innerHTML = renderInspectorMarkdown(text);
  else body.textContent = String(text || "");
  item.append(head, body);
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
  return item;
}

function renderInspectorChat() {
  const feed = $("inspectorFeed");
  if (!feed) return;
  feed.replaceChildren();
  const messages = inspectorProjectMessages();
  if (!messages.length) {
    inspectorAppend("assistant", [
      "Inspector nativo de EditCore activo.",
      "",
      "Escanear observa archivos, validaciones, modelos, procesos, logs, memoria, colas y cache sin modificar archivos.",
      "",
      "Reparar crea un checkpoint, corrige hallazgos verificados, repite las pruebas y revierte cualquier regresion.",
      "",
      "El chat atiende diagnosticos especificos usando el ultimo escaneo real como evidencia.",
    ].join("\n"));
    return;
  }
  for (const msg of messages.slice(-60)) inspectorAppend(msg.role, msg.content);
}

function inspectorRemember(role, content) {
  const project = activeProject();
  if (!project) return;
  project.inspectorMessages ||= [];
  project.inspectorChatVersion = INSPECTOR_CHAT_VERSION;
  project.inspectorMessages.push({ role, content: role === "assistant" ? sanitizeInspectorText(content) : content, at: Date.now() });
  project.inspectorMessages = project.inspectorMessages.slice(-20);
  project.updatedAt = Date.now();
  saveProjects();
}

function renderInspectorReports(snapshot) {
  const summary = $("inspectorSummary");
  const list = $("inspectorReportsList");
  if (!summary || !list) return;
  const twin = snapshot?.twin || {};
  const reports = snapshot?.reports || [];
  summary.replaceChildren();
  const chips = [
    `Proyecto: ${twin.projectName || projectDisplayName(activeProject())}`,
    `Archivos: ${twin.fileCount || 0}`,
    `Alertas: ${snapshot?.openAlerts || 0}`,
    `Frameworks: ${(twin.frameworks || []).join(", ") || "sin detectar"}`,
  ];
  for (const value of chips) {
    const chip = document.createElement("span");
    chip.className = "inspector-chip";
    chip.textContent = value;
    summary.appendChild(chip);
  }
  list.replaceChildren();
  if (!reports.length) {
    const empty = document.createElement("div");
    empty.className = "inspector-report";
    empty.textContent = "Sin reportes todavia. Abre Inspector para ejecutar el primer escaneo.";
    list.appendChild(empty);
    return;
  }
  for (const report of reports.slice(0, 40)) {
    const card = document.createElement("article");
    card.className = "inspector-report";
    card.dataset.severity = report.severity || "info";
    const meta = document.createElement("div");
    meta.className = "inspector-report-meta";
    meta.textContent = `${report.severity || "info"} · ${new Date(report.createdAt || Date.now()).toLocaleString()}`;
    const title = document.createElement("div");
    title.className = "inspector-report-title";
    title.textContent = report.title || "Reporte Inspector";
    const summaryText = document.createElement("div");
    summaryText.textContent = report.summary || "";
    card.append(meta, title, summaryText);
    if (Array.isArray(report.findings) && report.findings.length) {
      const ul = document.createElement("ul");
      ul.className = "inspector-report-findings";
      for (const finding of report.findings.slice(0, 6)) {
        const li = document.createElement("li");
        li.textContent = `${finding.title || "Alerta"}${finding.recommendation ? `: ${finding.recommendation}` : ""}`;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    list.appendChild(card);
  }
}

function inspectorHealth(stateName, text) {
  const health = $("inspectorHealth");
  if (!health) return;
  health.dataset.state = stateName;
  health.querySelector("strong").textContent = text;
}

let inspectorProgressTimer = null;
let latestInspectorHandoff = null;
let activeInspectorRepairRun = null;
// El chat de diagnostico y la reparacion son runs distintos del agente:
// se distinguen por runId para no mezclar su progreso en la interfaz.
let activeInspectorChatRun = null;
let activeInspectorJob = null;

function setInspectorBusy(busy, { action = "", target = "", runId = "" } = {}) {
  const cancelBtn = $("inspectorCancelBtn");
  const actionButtons = [...document.querySelectorAll("#inspectorActions [data-inspector-action]")];
  if (!busy) {
    activeInspectorJob = null;
    actionButtons.forEach((button) => {
      if (button.dataset.inspectorAction === "cancel") return;
      button.disabled = false;
      button.classList.remove("is-active");
      button.dataset.busy = "0";
    });
    cancelBtn?.classList.add("hidden");
    if (cancelBtn) cancelBtn.disabled = false;
    return;
  }
  activeInspectorJob = { action, target, runId };
  actionButtons.forEach((button) => {
    if (button.dataset.inspectorAction === "cancel") return;
    const isActive = button.dataset.inspectorAction === action && button.dataset.inspectorTarget === target;
    button.disabled = !isActive;
    button.classList.toggle("is-active", isActive);
    button.dataset.busy = isActive ? "1" : "0";
  });
  cancelBtn?.classList.remove("hidden");
  if (cancelBtn) cancelBtn.disabled = false;
}

function markInspectorRepairAttention(needsAttention) {
  document.querySelectorAll('[data-inspector-action="repair"]').forEach((button) => {
    button.classList.toggle("needs-attention", Boolean(needsAttention));
  });
}

function setInspectorHandoff(evaluation = null) {
  let button = $("inspectorRepairResultBtn") || $("inspectorHandoffBtn");
  const prompt = String(evaluation?.handoffPrompt || "").trim();
  const openAlerts = Number(evaluation?.openAlertCount || 0);
  const targetRoot = String(evaluation?.targetRoot || evaluation?.runtime?.root || "").trim();
  const runtimeRoot = String(evaluation?.runtime?.root || state.inspectorSnapshot?.runtime?.root || "").trim();
  const hasFindings = Boolean(prompt) || openAlerts > 0;
  latestInspectorHandoff = hasFindings ? {
    prompt: prompt || `Corrige ${openAlerts} hallazgo(s) detectados por Inspector.`,
    targetRoot,
    target: runtimeRoot && normalizeProjectRoot(targetRoot) === normalizeProjectRoot(runtimeRoot) ? "editcore-runtime" : "project",
  } : null;
  markInspectorRepairAttention(Boolean(latestInspectorHandoff));
  if (!button && latestInspectorHandoff) {
    button = document.createElement("button");
    button.id = "inspectorRepairResultBtn";
    button.type = "button";
    button.className = "inspector-context-repair";
    $("inspectorActions")?.appendChild(button);
  }
  if (button) {
    // Los botones permanentes Reparar ya estan en la UI; este es un atajo contextual.
    button.classList.toggle("hidden", !latestInspectorHandoff);
    button.textContent = latestInspectorHandoff?.target === "editcore-runtime"
      ? "Reparar hallazgos EditCoreAI"
      : "Reparar hallazgos del proyecto";
    button.onclick = () => repairInspectorTarget(latestInspectorHandoff?.target === "editcore-runtime" ? "editcore" : "project");
  }
}

async function cancelInspectorJob() {
  const job = activeInspectorJob;
  if (!job) return;
  const cancelBtn = $("inspectorCancelBtn");
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = "Cancelando...";
  }
  inspectorHealth("checking", "Cancelando Inspector...");
  setInspectorProgress(Number($("inspectorProgressPercent")?.textContent?.replace("%", "") || 50), "Cancelando por el usuario...", "running");
  try {
    await window.editcoreInspector?.cancel?.({ runId: job.runId }).catch(() => undefined);
    if (job.action === "repair" && window.editcoreAgent?.cancel) {
      await window.editcoreAgent.cancel({ runId: job.runId }).catch(() => undefined);
    }
  } finally {
    if (cancelBtn) cancelBtn.textContent = "Cancelar";
  }
}

function inspectorProgressStatus(area, stateName = "running") {
  const messages = {
    overview: {
      running: "Analizando archivos, procesos y estado de EditCore...",
      complete: "Estado interno de EditCore analizado.",
    },
    security: {
      running: "Auditando seguridad y posibles secretos...",
      complete: "Auditoria de seguridad completada.",
    },
    tests: {
      running: "Ejecutando check y pruebas reales de EditCore...",
      complete: "Validacion interna de EditCore completada.",
    },
    deploy: {
      running: "Revisando runtime, Electron y empaquetado...",
      complete: "Validacion del runtime completada.",
    },
    database: {
      running: "Revisando conexiones y almacenamiento de EditCore...",
      complete: "Revision de conexiones completada.",
    },
    report: {
      running: "Generando reporte completo...",
      complete: "Reporte completo generado.",
    },
    alerts: {
      running: "Escaneando alertas reales del proyecto...",
      complete: "Alertas reales revisadas.",
    },
    pending: {
      running: "Buscando pendientes y bloqueos...",
      complete: "Revision de pendientes completada.",
    },
  };
  return messages[area]?.[stateName] || messages[area]?.running || "Inspector procesando evaluacion...";
}

function setInspectorProgress(percent, label, stateName = "running") {
  const progress = $("inspectorProgress");
  const fill = $("inspectorProgressFill");
  const percentLabel = $("inspectorProgressPercent");
  const textLabel = $("inspectorProgressLabel");
  if (!progress || !fill || !percentLabel || !textLabel) return;
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  progress.dataset.state = stateName;
  fill.style.width = `${value}%`;
  percentLabel.textContent = `${value}%`;
  textLabel.textContent = label || "Inspector procesando evaluacion...";
}

function stopInspectorProgressTimer() {
  if (inspectorProgressTimer) {
    clearInterval(inspectorProgressTimer);
    inspectorProgressTimer = null;
  }
}

function startInspectorProgress(area) {
  stopInspectorProgressTimer();
  let value = 1;
  setInspectorProgress(value, inspectorProgressStatus(area, "running"), "running");
}

function finishInspectorProgress(area) {
  stopInspectorProgressTimer();
  setInspectorProgress(100, inspectorProgressStatus(area, "complete"), "complete");
}

function failInspectorProgress(message) {
  stopInspectorProgressTimer();
  setInspectorProgress(100, message || "Inspector no pudo completar la evaluacion.", "error");
}

async function refreshInspectorForProject(options = {}) {
  if (!options.silent) inspectorHealth("checking", "Inspector verificando el runtime de EditCore...");
  const snapshot = await window.editcoreInspector.scan("editcore", "", { force: options.force === true });
  state.inspectorSnapshot = snapshot;
  $("inspectorSubtitle").textContent = `Supervision interna activa · ${snapshot.runtime?.root || snapshot.projectRoot || "EditCore"}`;
  const alertCount = Number(snapshot.openAlerts || 0) + Number(snapshot.runtime?.issues?.length || 0);
  const fixedCount = Number(snapshot.fixedAlerts || 0);
  const alertsBtn = $("inspectorAlertsBtn");
  if (alertsBtn) {
    alertsBtn.textContent = `Alertas ${alertCount}`;
    alertsBtn.title = `Alertas abiertas: ${alertCount}. Corregidas por Inspector: ${fixedCount}.`;
  }
  inspectorHealth(alertCount ? "checking" : "ready", alertCount ? `EditCore requiere atencion · ${alertCount} alerta(s)` : "EditCore operativo · sin alertas abiertas");
  renderInspectorReports(snapshot);
  return snapshot;
}

function activeModelConfigForInspector(requireTools = false) {
  const selectEl = $("inspectorModelSelect");
  const selectedValue = selectEl?.value || "";
  // Modo local: cualquier perfil activo (ME AI / APICredits / custom), sin Gateway.
  const active = loadProviderProfiles()
    .filter((profile) => ["active", "enabled"].includes(String(profile?.status || "").toLowerCase()) && profile?.apiKey && profile?.baseUrl && profile?.model)
    .filter((profile) => profile?.providerKey !== "custom:gafcore-gateway")
    .filter((profile) => !String(profile.baseUrl || "").toLowerCase().includes("gafcore-gateway.vercel.app"))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const selected = active.find((profile) => profile.id === selectedValue) || active[0];
  if (selected) {
    return { mode: "inspector", baseUrl: selected.baseUrl, apiKey: selected.apiKey, model: selected.model, provider: selected.providerKey, providerKey: selected.providerKey, providerProfileId: selected.id };
  }
  const chatProfile = resolveActiveChatProfile({
    prompt: "",
    isAgent: requireTools === true,
    usesProjectTools: requireTools === true,
  });
  if (chatProfile?.providerKey === "custom:gafcore-gateway"
    || String(chatProfile?.baseUrl || "").toLowerCase().includes("gafcore-gateway")) {
    // Ignorar perfiles Gateway residuales
  } else if (chatProfile?.apiKey && chatProfile?.baseUrl && chatProfile?.model) {
    return {
      mode: "inspector",
      baseUrl: chatProfile.baseUrl,
      apiKey: chatProfile.apiKey,
      model: chatProfile.model,
      provider: chatProfile.providerKey,
      providerKey: chatProfile.providerKey,
      providerProfileId: chatProfile.id,
    };
  }
  throw new Error("Inspector Nativo (Modo Local): configura un modelo directo en Modelos (ME AI / APICredits) para chat o reparación asistida. El escaneo local no requiere API.");
}

function populateInspectorModelSelect() {
  const provSel = $("inspectorProviderSelect");
  const modelSel = $("inspectorModelSelect");
  if (!provSel || !modelSel) return;

  const prevProvider = provSel.value;
  const prevModel = modelSel.value;

  // ── Build provider list ──────────────────────────────────────────────────
  provSel.innerHTML = "";

  const addProvOpt = (value, label) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    provSel.appendChild(opt);
  };

  const profiles = loadProviderProfiles();
  const activeProfiles = profiles.filter(
    (p) => ["active", "enabled"].includes(String(p?.status || "").toLowerCase())
      && p?.apiKey && p?.baseUrl && p?.model
      && p?.providerKey !== "custom:gafcore-gateway"
      && !String(p.baseUrl || "").toLowerCase().includes("gafcore-gateway.vercel.app"),
  );

  const providerMap = new Map();
  for (const p of activeProfiles) {
    let hostname = "";
    try { hostname = new URL(p.baseUrl).hostname.replace("www.", ""); } catch {}
    const upstream = String(p.model).split("/", 1)[0].toLowerCase();
    const key = p.providerKey || upstream || hostname || p.id;
    const upstreamLabel = ({ meai: "ME AI Cloud", apicredits: "APICredits" }[upstream]
      || ({ meai: "ME AI Cloud", apicredits: "APICredits" }[String(p.providerKey || "").replace(/^custom:/, "")] )
      || p.providerName
      || upstream
      || "Proveedor local");
    const label = `Directo · ${upstreamLabel}`;
    if (!providerMap.has(key)) providerMap.set(key, { label, key, profiles: [] });
    providerMap.get(key).profiles.push(p);
  }

  for (const { label, key } of providerMap.values()) {
    addProvOpt(key, label);
  }

  // Restore previous provider selection
  if (prevProvider && [...provSel.options].some((o) => o.value === prevProvider)) {
    provSel.value = prevProvider;
  }

  // ── Fill models for selected provider ───────────────────────────────────
  function fillModels(selectedProvKey) {
    modelSel.innerHTML = "";
    const addModelOpt = (value, label) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      modelSel.appendChild(opt);
    };

    const group = providerMap.get(selectedProvKey);
    if (group) {
      const sorted = [...group.profiles].sort((a, b) => {
        const aOK = a.agentToolOK === true || a.toolOK === true ? 1 : 0;
        const bOK = b.agentToolOK === true || b.toolOK === true ? 1 : 0;
        return bOK - aOK || String(a.model).localeCompare(String(b.model), undefined, { numeric: true });
      });
      for (const p of sorted) {
        const hasTools = p.agentToolOK === true || p.toolOK === true;
        const toolMark = hasTools ? "herramientas OK" : "modo local";
        const modelLabel = String(p.model).includes("/")
          ? String(p.model).split("/").slice(1).join("/") || p.model
          : p.model;
        addModelOpt(p.id, `${modelLabel} - ${toolMark}`);
      }
    }

    // Restore previous model selection if it's in this provider
    if (prevModel && [...modelSel.options].some((o) => o.value === prevModel)) {
      modelSel.value = prevModel;
    }
  }

  fillModels(provSel.value);

  // When provider changes → refill models
  provSel.onchange = () => fillModels(provSel.value);

  // Show/hide the row
  const row = $("inspectorModelSelectRow");
  if (row) row.style.display = provSel.options.length > 0 ? "" : "none";
  const status = $("inspectorApiStatus");
  if (status) {
    status.className = "inspector-api-status ok";
    status.textContent = "Inspector Nativo Autónomo Activo (Modo Local)";
  }
}

function inspectorContextPrompt(snapshot) {
  const twin = snapshot?.twin || {};
  const runtime = snapshot?.runtime || {};
  const reports = snapshot?.reports || [];
  const issues = twin.issues || [];
  const projectDiagnosis = state.inspectorProjectSnapshot || {};
  const conn = loadJson("editcore-connections", {});
  const operatorMem = state.operatorConnectionsMemory || "";
  const connLines = operatorMem
    ? operatorMem.split("\n").filter((line) => !/gafcore gateway/i.test(line)).slice(0, 14)
    : [
      `- GitHub: ${conn.githubToken ? "configurado" : "sin configurar"}`,
      `- Vercel: ${conn.vercelToken ? "configurado" : "sin configurar"}`,
      `- Supabase: ${conn.selfSupabaseUrl ? `configurado (${conn.selfSupabaseUrl})` : "sin configurar"}`,
      `- Servidor SSH: ${conn.serverHost ? conn.serverHost : "sin configurar"}`,
      `- Kernel local: process-runner · vision-inspector · global-memory · snapshot`,
    ];
  return [
    "Eres Inspector Core AI, supervisor NATIVO LOCAL de EditCore. Responde SIEMPRE en español.",
    "Modo: Inspector Nativo Autónomo Activo (Modo Local). Usa solo ME AI / APICredits.",
    "Herramientas de kernel disponibles: process-runner (spawn/logs), vision-inspector (captura preview), global-memory (aprendizajes), snapshot (checkpoints/rollback).",
    "Eres un solo inspector visible para el usuario, pero internamente razonas como Planner, Debug, QA, Security, DevOps y Report Agent.",
    "Tu objetivo principal es diagnosticar EditCore: runtime, interfaz, APIs, modelos, agentes, colas, logs, herramientas y empaquetado.",
    "El chat diagnostica solicitudes especificas y no escribe por si solo. Las modificaciones solo se ejecutan mediante Reparar EditCore o Reparar proyecto.",
    "Si detectas un problema corregible, explica causa, evidencia y solucion, y termina exactamente con: CORRECCION_EDITCORE:, luego DESTINO: EDITCORE o DESTINO: PROYECTO, luego PROMPT: y la instruccion ejecutable para el motor de reparacion.",
    "Formato obligatorio para cualquier modelo: profesional, sin emojis, sin iconos decorativos, sin checks visuales genericos y sin tablas de estado no verificadas.",
    "No uses palabras como listo, terminado o completo si no tienes evidencia concreta de archivos, scripts, pruebas o reportes.",
    "Cada afirmacion importante debe indicar base: archivo revisado, script detectado, reporte, memoria o 'no verificado'.",
    "Si la evidencia no existe, dilo como 'No verificado todavia' y propone el analisis ejecutable correspondiente.",
    "No prometas haber modificado archivos desde el chat. Inspector diagnostica y los botones Reparar ejecutan con checkpoint, herramientas, pruebas y reversion.",
    "Prioriza funcionamiento correcto, seguridad, pruebas y no romper arquitectura existente.",
    "Estructura preferida: Estado, Evidencia revisada, Hallazgos, Riesgo, Acciones recomendadas, Siguiente paso.",
    "",
    "EditCore inspeccionado:",
    `- Ruta interna: ${runtime.root || twin.projectRoot || "no verificada"}`,
    `- Version: ${runtime.version || "no verificada"}`,
    `- Archivos internos analizados: ${twin.fileCount || 0}`,
    `- Frameworks: ${(twin.frameworks || []).join(", ") || "sin detectar"}`,
    `- Scripts: ${Object.keys(twin.scripts || {}).join(", ") || "sin detectar"}`,
    `- Alertas: ${issues.length}`,
    `- Modelos activos: ${(runtime.activeModels || []).join(", ") || "ninguno"}`,
    `- Agentes ejecutando: ${runtime.process?.activeAgents || 0}`,
    `- Chats ejecutando: ${runtime.process?.activeChats || 0}`,
    `- Previews ejecutando: ${runtime.process?.activePreviews || 0}`,
    ...issues.slice(0, 8).map((issue) => `  * [${issue.severity}] ${issue.title}: ${issue.recommendation || issue.detail || ""}`),
    "",
    "Servicios conectados (operador — dependen todos los proyectos):",
    ...connLines,
    "",
    "Proyecto abierto:",
    `- Nombre: ${projectDisplayName(activeProject())}`,
    `- Ruta: ${state.projectRoot || "sin proyecto"}`,
    `- Ultimo diagnostico: ${projectDiagnosis.generatedAt || "no escaneado"}`,
    `- Alertas abiertas verificadas: ${projectDiagnosis.openAlertCount ?? "no verificadas"}`,
    "",
    "Reportes recientes:",
    ...reports.slice(0, 5).map((report) => `- [${report.severity || "info"}] ${report.title}: ${report.summary || ""}`),
  ].join("\n");
}

function inspectorAreaLabel(area) {
  return {
    overview: "Estado de EditCore",
    security: "Seguridad de EditCore",
    tests: "Validacion de EditCore",
    deploy: "Runtime y empaquetado",
    database: "Conexiones de EditCore",
    report: "Reporte completo",
    alerts: "Alertas",
    pending: "Pendientes",
  }[area] || area;
}

function inspectorStatusLabel(status) {
  return {
    ok: "Correcto",
    attention: "Requiere atencion",
    critical: "Critico",
    unverified: "No verificado",
  }[status] || status;
}

function inspectorEvaluationMarkdown(area, evaluation) {
  const evidenceRows = (evaluation?.evidence || []).map((row) =>
    `| ${row.status || "unknown"} | ${row.label || ""} | ${String(row.detail || "").replace(/\|/g, "/")} | ${row.source || "no verificado"} |`
  );
  const actions = (evaluation?.actions || []).map((item, index) => `${index + 1}. ${item}`);
  const commandRows = (evaluation?.commandResults || []).map((item) =>
    `| ${item.script || ""} | ${item.skipped ? "omitido" : item.ok ? "ok" : "fallo"} | ${String(item.command || item.reason || "").replace(/\|/g, "/")} | ${String(item.output || "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 240) || "sin salida"} |`
  );
  const alertRows = (evaluation?.alerts || []).map((item) =>
    `| ${item.status || "open"} | ${item.severity || "medium"} | ${String(item.title || "").replace(/\|/g, "/")} | ${String(item.file || "sin archivo").replace(/\|/g, "/")} | ${String(item.recommendation || item.detail || "").replace(/\|/g, "/")} |`
  );
  const fixRows = (evaluation?.fixes || []).map((item) =>
    `| ${String(item.title || "").replace(/\|/g, "/")} | ${String(item.path || "").replace(/\|/g, "/")} | ${String(item.backup || "nuevo archivo").replace(/\|/g, "/")} |`
  );
  const durationSeconds = Math.max(0, Number(evaluation?.durationMs || 0) / 1000).toFixed(1);
  const runtime = evaluation?.runtime || {};
  const runtimeIssues = runtime.issues || [];
  const nextStep = evaluation?.handoffPrompt
    ? "Inspector detecto hallazgos corregibles. Usa el boton Reparar correspondiente para ejecutar checkpoint, correccion y validacion."
    : "No se requiere una correccion. Conserva este reporte como evidencia del diagnostico.";
  return [
    `## Evaluacion: ${inspectorAreaLabel(area)}`,
    "",
    `Estado: ${inspectorStatusLabel(evaluation?.status || "unverified")}`,
    `Score: ${evaluation?.score ?? 0}/100`,
    `Duracion real: ${durationSeconds}s`,
    `Destino inspeccionado: ${runtime.root || evaluation?.targetRoot || "runtime de EditCore"}`,
    "",
    "### Evidencia revisada",
    "",
    "| Estado | Punto evaluado | Resultado | Fuente |",
    "|---|---|---|---|",
    ...(evidenceRows.length ? evidenceRows : ["| unknown | Sin evidencia | No se ejecuto evaluacion. | no verificado |"]),
    "",
    "### Comandos reales ejecutados",
    "",
    "| Script | Estado | Comando | Salida resumida |",
    "|---|---|---|---|",
    ...(commandRows.length ? commandRows : ["| sin script | omitido | No habia script real aplicable para esta area. | sin salida |"]),
    "",
    "### Alertas detectadas",
    "",
    "| Estado | Severidad | Alerta | Archivo | Recomendacion |",
    "|---|---|---|---|---|",
    ...(alertRows.length ? alertRows : ["| fixed | low | Sin alertas abiertas para esta evaluacion. | alerts.json | No requiere accion inmediata. |"]),
    "",
    "### Correcciones seguras aplicadas",
    "",
    "| Alerta | Archivo corregido | Respaldo |",
    "|---|---|---|",
    ...(fixRows.length ? fixRows : ["| Sin correccion automatica | No se modificaron archivos en esta ejecucion. | no aplica |"]),
    "",
    "### Estado nativo de EditCore",
    "",
    `- Archivos internos criticos: ${(runtime.files || []).filter((item) => item.exists).length}/${(runtime.files || []).length || 0}`,
    `- Modelos activos: ${(runtime.activeModels || []).length}`,
    `- Datos internos con escritura: ${runtime.userDataWritable ? "si" : "no"}`,
    `- Procesos: ${runtime.process?.activeAgents || 0} agente(s), ${runtime.process?.activeChats || 0} chat(s), ${runtime.process?.activePreviews || 0} preview(s)`,
    ...(runtimeIssues.length ? runtimeIssues.map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.detail}`) : ["- Sin fallos nativos adicionales detectados."]),
    "",
    "### Acciones recomendadas",
    "",
    ...(actions.length ? actions : ["1. No hay acciones recomendadas por esta evaluacion."]),
    "",
    "### Que debes hacer",
    "",
    nextStep,
    "",
    "Escanear no modifica archivos. Reparar utiliza herramientas reales, checkpoint y validacion posterior.",
  ].join("\n");
}

function inspectorTargetRoot(target) {
  if (target === "project") {
    const root = String(state.projectRoot || "").trim();
    if (!root) throw new Error("Abre un proyecto antes de escanearlo o repararlo.");
    return root;
  }
  // For editcore target, return the runtime root from the snapshot so verifyModel receives a valid directory.
  // Si la ruta apunta a un paquete .asar (solo lectura), redirigimos a la carpeta
  // extraída equivalente para que repair-safe pueda escribir correcciones.
  let root = String(state.inspectorSnapshot?.runtime?.root || "").trim();
  if (/\.asar$/i.test(root)) {
    const extracted = root.replace(/\.asar$/i, "-extracted");
    const withoutAsar = root.replace(/\.asar$/i, "");
    const siblingApp = root.replace(/[\\/][^\\/]*\.asar$/i, `${root.includes("\\") ? "\\" : "/"}app`);
    if (/-progress\.asar$/i.test(root)) root = siblingApp || extracted || withoutAsar;
    else root = extracted || withoutAsar;
  }
  return root;
}

function inspectorActionLabel(action, target) {
  return `${action === "repair" ? "Reparacion" : "Escaneo"} ${target === "project" ? "del proyecto" : "de EditCoreAI"}`;
}

async function runInspectorScan(target) {
  inspectorSetTab("chat");
  const root = inspectorTargetRoot(target);
  const label = inspectorActionLabel("scan", target);
  const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `inspector-scan-${Date.now()}`;
  setInspectorBusy(true, { action: "scan", target, runId });
  inspectorHealth("checking", `${label} en curso · modo local`);
  startInspectorProgress(target === "project" ? "overview" : "report");
  const thinking = inspectorAppend("assistant", `${label}: kernel local (snapshot · process-runner · global-memory)…`);
  const offProgress = window.editcoreInspector?.onProgress?.((progress) => {
    if (progress?.runId === runId) setInspectorProgress(progress.percent, progress.label, progress.state || "running");
  });
  try {
    // Preflight kernel: estado + autorreparación .next / routes-manifest
    if (window.editcoreInspector?.kernelStatus) {
      const ks = await window.editcoreInspector.kernelStatus(target, root).catch(() => null);
      if (ks?.message) {
        const statusEl = $("inspectorApiStatus");
        if (statusEl) {
          statusEl.className = "inspector-api-status ok";
          statusEl.textContent = ks.message;
        }
      }
    }
    if (target === "project" && window.editcoreInspector?.localHeal) {
      setInspectorProgress(12, "Autorreparación local si hay .next corrupto…", "running");
      const heal = await window.editcoreInspector.localHeal(target, root, runId).catch((err) => ({
        ok: false,
        error: err?.message || String(err),
      }));
      if (heal && heal.skipped !== true) {
        const healNote = heal.ok
          ? (heal.uiMessage || "Caché de Next.js regenerada exitosamente")
          : `Autorreparación local: ${heal.error || heal.build?.error || "revisar build"}.`;
        inspectorAppend("assistant", `### Kernel local\n\n${healNote}`);
        if (heal.ok) {
          $("status").textContent = heal.uiMessage || "Caché de Next.js regenerada exitosamente";
        }
      }
    }

    const evaluation = await window.editcoreInspector.diagnose(target, root, runId);
    thinking?.remove();
    if (target === "project") state.inspectorProjectSnapshot = evaluation;
    else state.inspectorSnapshot = await window.editcoreInspector.snapshot("editcore", "").catch(() => state.inspectorSnapshot);
    setInspectorHandoff({ ...evaluation, targetRoot: root, target: target === "project" ? "project" : "editcore-runtime" });
    const text = inspectorEvaluationMarkdown(target === "project" ? "project" : "report", evaluation);
    const healExtra = evaluation?.localHeal && evaluation.localHeal.skipped !== true
      ? `\n\n### Autorreparación\n${evaluation.localHeal.uiMessage || (evaluation.localHeal.ok ? "Caché de Next.js regenerada exitosamente" : "Quedaron avisos tras el heal local.")}`
      : "";
    inspectorAppend("assistant", text + healExtra);
    inspectorRemember("assistant", text);
    inspectorHealth(evaluation.status === "critical" ? "error" : evaluation.status === "attention" ? "checking" : "ready", `${label}: ${inspectorStatusLabel(evaluation.status)}`);
    finishInspectorProgress(target === "project" ? "overview" : "report");
  } catch (error) {
    thinking?.remove();
    const message = error?.message || String(error);
    const cancelled = /cancel/i.test(message);
    inspectorAppend("assistant", cancelled ? `## Escaneo cancelado\n\n${message}` : message);
    inspectorRemember("assistant", message);
    inspectorHealth(cancelled ? "ready" : "error", cancelled ? "Escaneo cancelado" : message);
    failInspectorProgress(cancelled ? "Escaneo cancelado por el usuario." : message);
  } finally {
    if (typeof offProgress === "function") offProgress();
    setInspectorBusy(false);
  }
}

async function repairInspectorTarget(target) {
  const root = inspectorTargetRoot(target);
  let checkpoint = null;
  let changedFiles = [];
  const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `inspector-repair-${Date.now()}`;
  setInspectorBusy(true, { action: "repair", target, runId });
  try {
    inspectorSetTab("chat");
    inspectorHealth("checking", `${inspectorActionLabel("repair", target)} en curso`);
    setInspectorProgress(3, "Ejecutando primero un diagnostico real de solo lectura...", "running");
    const diagnosis = await window.editcoreInspector.diagnose(target, root, `inspector-pre-repair-${Date.now()}`);
    setInspectorHandoff({ ...diagnosis, targetRoot: root, target: target === "project" ? "project" : "editcore-runtime" });
    setInspectorProgress(10, "Creando checkpoint y linea base de comprobaciones...", "running");
    checkpoint = await window.editcoreInspector.checkpoint(target, root);
    const baseline = new Map((checkpoint.commandResults || []).filter((item) => !item.skipped).map((item) => [item.script, Boolean(item.ok)]));
    setInspectorProgress(18, "Aplicando correcciones seguras verificadas...", "running");
    const safe = await window.editcoreInspector.repairSafe(target, root, runId);
    changedFiles = [...new Set((safe.fixes || []).map((fix) => fix.path).filter(Boolean))];
    let result = { report: { changedFiles: [], toolCount: 0 } };
    if (safe.handoffPrompt) {
      const modelConfig = activeModelConfigForInspector(true);
      inspectorHealth("checking", `Reparando con ${modelConfig.model} y herramientas reales...`);
      setInspectorProgress(35, "El modelo Inspector esta corrigiendo hallazgos no automaticos...", "running");
      const selectedProfile = loadProviderProfiles().find((profile) => profile.id === modelConfig.providerProfileId);
      const alreadyVerified = selectedProfile?.agentToolOK === true || selectedProfile?.toolOK === true;
      let capability;
      if (alreadyVerified) {
        capability = { chatOK: true, toolOK: true, model: modelConfig.model, cachedVerification: true };
      } else {
        capability = await window.editcoreAgent.verifyModel({ providerKey: modelConfig.providerKey, baseUrl: modelConfig.baseUrl, apiKey: modelConfig.apiKey, model: modelConfig.model, projectRoot: root }).catch((err) => ({ chatOK: false, toolOK: false, error: err?.message || String(err) }));
        if (!capability?.chatOK || !capability?.toolOK) throw new Error(`El modelo Inspector no puede usar herramientas reales: ${capability?.toolError || capability?.error || "sin verificacion"}`);
      }
      activeInspectorRepairRun = { runId, changedFiles: new Set() };
      const snapshot = state.inspectorSnapshot || await refreshInspectorForProject({ silent: true });
      const repairHistory = inspectorProjectMessages().slice(-8).map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      }));
      const repairSystemPrompt = inspectorChatToolPrompt(inspectorContextPromptCompact(snapshot));
      // La auto-reparacion usa permisos completos: hay checkpoint previo y
      // rollback automatico si la validacion detecta regresiones.
      result = await window.editcoreAgent.run({
        ...modelConfig,
        prompt: safe.handoffPrompt,
        systemPrompt: repairSystemPrompt,
        history: repairHistory,
        projectRoot: root,
        projectId: target === "project" ? (activeProject()?.id || "project") : "editcore-runtime",
        agentId: "inspector-core-repair",
        allowWrite: true,
        permissionMode: "full",
        planAuthorized: true,
        runId,
        resumeSteps: [],
      });
      changedFiles = [...new Set([...changedFiles, ...(result.report?.changedFiles || []), ...(activeInspectorRepairRun?.changedFiles || [])])];
    }
    setInspectorProgress(78, "Repitiendo el escaneo y las comprobaciones reales...", "running");
    const validation = await window.editcoreInspector.diagnose(target, root, `inspector-validation-${Date.now()}`);
    const regressions = (validation.commandResults || []).filter((item) => baseline.get(item.script) === true && !item.ok);
    if (regressions.length) {
      setInspectorProgress(90, "Regresion detectada; restaurando los archivos modificados...", "running");
      await window.editcoreInspector.restore(target, root, checkpoint.id, changedFiles);
      const restored = await window.editcoreInspector.diagnose(target, root, `inspector-restored-${Date.now()}`);
      const text = [`## Reparacion revertida`, ``, `Inspector detecto regresion en: ${regressions.map((item) => item.script).join(", ")}.`, `Archivos restaurados: ${changedFiles.join(", ") || "ninguno reportado"}.`, ``, inspectorEvaluationMarkdown(target === "project" ? "project" : "report", restored)].join("\n");
      inspectorAppend("assistant", text);
      inspectorRemember("assistant", text);
      inspectorHealth("error", "Reparacion revertida por regresion");
      failInspectorProgress("Cambios restaurados: la validacion detecto una regresion.");
      return;
    }
    await window.editcoreInspector.discardCheckpoint(target, root, checkpoint.id);
    checkpoint = null;
    const text = [`## Reparacion verificada`, ``, `Archivos modificados con respaldo: ${changedFiles.join(", ") || "ninguno"}.`, `Correcciones seguras: ${(safe.fixes || []).length}.`, `Acciones de herramienta: ${result.report?.toolCount || 0}.`, ``, inspectorEvaluationMarkdown(target === "project" ? "project" : "report", validation)].join("\n");
    inspectorAppend("assistant", text);
    inspectorRemember("assistant", text);
    if (target === "project") state.inspectorProjectSnapshot = validation;
    else state.inspectorSnapshot = await window.editcoreInspector.snapshot("editcore", "");
    const unresolved = Number(validation.openAlertCount || 0);
    setInspectorHandoff({ ...validation, targetRoot: root, target: target === "project" ? "project" : "editcore-runtime" });
    inspectorHealth(unresolved ? "checking" : "ready", unresolved ? `Reparacion verificada · ${unresolved} alerta(s) pendiente(s)` : `${inspectorActionLabel("repair", target)} verificada`);
    finishInspectorProgress(target === "project" ? "overview" : "report");
  } catch (error) {
    changedFiles = [...new Set([...changedFiles, ...(activeInspectorRepairRun?.changedFiles || [])])];
    const message = error?.message || String(error);
    const cancelled = /cancel/i.test(message);
    if (checkpoint?.id && changedFiles.length) await window.editcoreInspector.restore(target, root, checkpoint.id, changedFiles).catch(() => undefined);
    inspectorAppend("assistant", cancelled
      ? `## Reparacion cancelada\n\n${message}`
      : `## Reparacion detenida\n\n${message}\n\nInspector no declara una correccion sin validacion completa.`);
    inspectorRemember("assistant", `${cancelled ? "Reparacion cancelada" : "Reparacion detenida"}: ${message}`);
    inspectorHealth(cancelled ? "ready" : "error", cancelled ? "Reparacion cancelada" : message);
    failInspectorProgress(cancelled ? "Reparacion cancelada por el usuario." : message);
  } finally {
    activeInspectorRepairRun = null;
    // El disco pudo cambiar: las respuestas cacheadas describen el estado anterior.
    _inspectorCacheClear();
    if (checkpoint?.id) await window.editcoreInspector.discardCheckpoint(target, root, checkpoint.id).catch(() => undefined);
    setInspectorBusy(false);
  }
}

async function runInspectorEvaluation(area) {
  inspectorSetTab("chat");
  const buttons = [...document.querySelectorAll("[data-inspector-area]")];
  buttons.forEach((button) => { button.disabled = true; });
  inspectorHealth("checking", `Ejecutando evaluacion: ${inspectorAreaLabel(area)}`);
  startInspectorProgress(area);
  const thinking = inspectorAppend("assistant", `${inspectorProgressStatus(area, "running")} Resultado al finalizar la evaluacion real.`);
  const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `inspector-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const offProgress = window.editcoreInspector?.onProgress?.((progress) => {
    if (!progress || progress.runId !== runId) return;
    setInspectorProgress(progress.percent, progress.label, progress.state || "running");
  });
  try {
    const evaluation = await window.editcoreInspector.evaluate("", area, runId);
    thinking?.remove();
    setInspectorHandoff(evaluation);
    const text = inspectorEvaluationMarkdown(area, evaluation);
    inspectorAppend("assistant", text);
    inspectorRemember("assistant", text);
    const snapshot = await window.editcoreInspector.snapshot("").catch(() => null);
    if (snapshot) {
      state.inspectorSnapshot = snapshot;
      renderInspectorReports(snapshot);
    }
    inspectorHealth(evaluation.status === "critical" ? "error" : evaluation.status === "attention" ? "checking" : "ready", `Evaluacion ${inspectorAreaLabel(area)}: ${inspectorStatusLabel(evaluation.status)}`);
    finishInspectorProgress(area);
  } catch (error) {
    thinking?.remove();
    const message = error?.message || String(error);
    inspectorAppend("assistant", message);
    inspectorRemember("assistant", message);
    inspectorHealth("error", message);
    failInspectorProgress(message);
  } finally {
    if (typeof offProgress === "function") offProgress();
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function openInspector() {
  closeAllToolbarMenus();
  const dialog = $("inspectorDialog");
  if (!dialog) {
    appendMessage("assistant", "Inspector no disponible en esta build.");
    return;
  }
  if (!window.editcoreInspector?.scan && !window.editcoreInspector?.kernelStatus) {
    appendMessage("assistant", "IPC del Inspector no registrado. Reinicia EditCoreAI.");
    return;
  }
  dialog.showModal();
  inspectorSetTab("chat");
  populateInspectorModelSelect();
  const status = $("inspectorApiStatus");
  if (status) {
    status.className = "inspector-api-status ok";
    status.textContent = "Inspector Nativo Autónomo Activo (Modo Local)";
  }
  renderInspectorChat();
  reportInspectorTelemetry();
  try {
    if (window.editcoreInspector?.kernelStatus) {
      const ks = await window.editcoreInspector.kernelStatus("editcore", "").catch(() => null);
      if (ks?.message && status) status.textContent = ks.message;
    }
    await refreshInspectorForProject({ force: false });
  } catch (error) {
    inspectorHealth("error", error?.message || String(error));
  }
  // Salud de proyectos (antes "Mantenimiento") vive dentro del Inspector
  loadMaintenanceSchedulerUi().catch(() => undefined);
  refreshMaintenancePanel().catch(() => undefined);
}

async function publishChanges(target = "project") {
  // target: "project" = proyecto activo del usuario, "editcore" = el propio EditCoreAI
  const isEditCore = target === "editcore";
  const projectRoot = isEditCore
    ? (state.inspectorSnapshot?.runtime?.root || "")
    : (state.projectRoot || "");
  if (!projectRoot) {
    const msg = isEditCore
      ? "No se pudo determinar la ruta de EditCoreAI. Ejecuta un escaneo primero."
      : "Abre un proyecto antes de publicar.";
    if (isEditCore) { inspectorAppend("assistant", msg); inspectorHealth("error", msg); }
    else appendMessage("assistant", msg);
    return;
  }
  if (!window.editcoreProject?.publish) {
    const msg = "Publicacion deterministica no disponible en esta build.";
    if (isEditCore) { inspectorAppend("assistant", msg); inspectorHealth("error", msg); }
    else appendMessage("assistant", msg);
    return;
  }

  // Publicar siempre desde la bóveda de Conexiones de ESTA app (EditCoreAI), no EDITCOREAI.
  const conn = loadJson("editcore-connections", {}) || {};
  if (!conn.githubToken) {
    const msg = "Para publicar hace falta GitHub en Conexiones de EditCoreAI. Abre Conexiones y autoriza el token.";
    if (isEditCore) { inspectorAppend("assistant", msg); inspectorHealth("error", msg); }
    else appendMessage("assistant", msg);
    openConnections();
    return;
  }

  if (isEditCore) {
    inspectorSetTab("chat");
    inspectorHealth("checking", "Publicando EditCoreAI con Conexiones...");
    const thinking = inspectorAppend("assistant", "Publicacion via Conexiones (GitHub token de la bóveda EditCoreAI)...");
    try {
      const result = await window.editcoreProject.publish({
        projectRoot,
        mode: "editcore",
        deploy: false,
        supabasePush: false,
      });
      thinking?.remove();
      if (result?.cancelled) {
        inspectorAppend("assistant", result.message || "Publicacion cancelada.");
        inspectorHealth("ready", "Cancelado");
        return;
      }
      const text = formatPublishReport(result);
      inspectorAppend("assistant", text);
      inspectorRemember("assistant", text);
      inspectorHealth(result?.ok ? "ready" : "error", result?.ok ? "EditCoreAI publicado" : (result?.message || "Error al publicar"));
    } catch (error) {
      thinking?.remove();
      const msg = error?.message || String(error);
      inspectorAppend("assistant", `## Error al publicar\n\n${msg}`);
      inspectorHealth("error", msg);
    }
    return;
  }

  const project = activeProject();
  if (!project) { append("assistant", "Abre un proyecto antes de publicar.", null, true, 0); return; }
  appendUserWithImages("📦 Publicar cambios del proyecto", []);
  rememberMessage("user", "📦 Publicar cambios del proyecto");
  const thinking = appendThinking("Publicacion via Conexiones (git + supabase + deploy)...");
  try {
    // Primero asegura enlaces si faltan (sin forzar crear repo si el usuario cancela el dialogo de connect).
    if (window.editcoreProject.assessConnections) {
      const assessment = await window.editcoreProject.assessConnections({ projectRoot }).catch(() => null);
      if (assessment?.missing?.includes("git_remote") || assessment?.missing?.includes("git_repo")) {
        removeThinking(thinking);
        append("assistant", "El proyecto no tiene remote git. Usa **Conectar servicios** o configura origin antes de publicar.", null, true, 0);
        $("status").textContent = "Falta remote git";
        return;
      }
    }
    const result = await window.editcoreProject.publish({
      projectRoot,
      mode: "project",
      deploy: true,
      supabasePush: true,
    });
    removeThinking(thinking);
    if (result?.cancelled) {
      append("assistant", result.message || "Publicacion cancelada.", null, true, 0);
      $("status").textContent = "Publicacion cancelada";
      return;
    }
    const text = formatPublishReport(result);
    append("assistant", text, null, true, 0);
    rememberMessage("assistant", text);
    $("status").textContent = result?.ok ? "Cambios publicados" : "Error al publicar";
  } catch (error) {
    removeThinking(thinking);
    const msg = error?.message || String(error);
    append("assistant", `## Error al publicar\n\n${msg}`, null, true, 0);
    rememberMessage("assistant", `Error al publicar: ${msg}`);
    $("status").textContent = "Error al publicar";
  }
}

function formatPublishReport(result = {}) {
  return formatStepReport(result.ok ? "## Publicacion completada" : "## Publicacion incompleta", result).join("\n");
}

async function connectProjectServices() {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de conectar servicios.");
    return;
  }
  if (!window.editcoreProject?.connectServices) {
    appendMessage("assistant", "Conexion de servicios no disponible en esta build.");
    return;
  }
  $("status").textContent = "Conectando GitHub/Vercel/Supabase...";
  const thinking = appendThinking("Enlazando el proyecto a tus Conexiones...");
  try {
    const result = await window.editcoreProject.connectServices({ projectRoot: state.projectRoot });
    removeThinking(thinking);
    if (result?.cancelled) {
      append("assistant", result.message || "Conexion cancelada.", null, true, 0);
      $("status").textContent = "Conexion cancelada";
      return;
    }
    let envSync = null;
    if (result.ok && window.editcoreProject.syncVercelEnv) {
      envSync = await window.editcoreProject.syncVercelEnv({ projectRoot: state.projectRoot }).catch(() => null);
    }
    const lines = formatStepReport(result.ok ? "## Proyecto conectado" : "## Conexion parcial", result);
    if (envSync && !envSync.skipped) lines.push("", `Vercel env: ${envSync.message || (envSync.ok ? "OK" : "fallo")}`);
    if (result.assessment?.remoteUrl) lines.push("", `Remote: ${result.assessment.remoteUrl}`);
    append("assistant", lines.join("\n"), null, true, 0);
    $("status").textContent = result.ok ? "Servicios conectados" : "Conexion parcial";
  } catch (error) {
    removeThinking(thinking);
    append("assistant", `## Error al conectar\n\n${error?.message || String(error)}`, null, true, 0);
    $("status").textContent = "Error al conectar";
  }
}

async function onboardProjectFull() {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de conectar.");
    return;
  }
  if (!window.editcoreProject?.onboard) {
    appendMessage("assistant", "Conectar no esta disponible en esta build.");
    return;
  }
  const conn = loadJson("editcore-connections", {}) || {};
  if (!conn.githubToken) {
    appendMessage("assistant", "Para conectar hace falta GitHub en Conexiones (bóveda safeStorage).");
    openConnections();
    return;
  }
  appendUserWithImages("🔗 Conectar (deps → GitHub → Vercel → Supabase)", []);
  rememberMessage("user", "🔗 Conectar (deps → GitHub → Vercel → Supabase)");
  $("status").textContent = "Conectando proyecto...";
  const thinking = appendThinking("Conectando: npm install + GitHub + Vercel + Supabase...");
  try {
    const project = activeProject();
    const result = await window.editcoreProject.onboard({
      projectRoot: state.projectRoot,
      projectName: projectDisplayName(project),
      localProjectId: project?.id || "",
      confirm: true,
      installDeps: true,
      bootstrapSupabase: true,
      connectServices: true,
      connectGateway: false,
      firstDeploy: false,
    });
    removeThinking(thinking);
    if (result?.cancelled) {
      append("assistant", result.message || "Conexion cancelada.", null, true, 0);
      $("status").textContent = "Conexion cancelada";
      return;
    }
    const lines = formatStepReport(result.ok ? "## Proyecto conectado" : "## Conexion incompleta", result);
    if (result.checklist) lines.push("", "### Checklist", "```json", JSON.stringify(result.checklist, null, 2), "```");
    append("assistant", lines.join("\n"), null, true, 0);
    $("status").textContent = result.ok ? "Proyecto conectado" : "Conexion parcial";
    if (result.ok) {
      loadConnections();
      if (typeof syncProjectsToMaintenanceScheduler === "function") syncProjectsToMaintenanceScheduler();
    }
  } catch (error) {
    removeThinking(thinking);
    append("assistant", `## Error al conectar\n\n${error?.message || String(error)}`, null, true, 0);
    $("status").textContent = "Error al conectar";
  }
}

async function provisionProjectFull() {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de aprovisionar.");
    return;
  }
  if (!window.editcoreProject?.provision) {
    appendMessage("assistant", "Aprovisionamiento no disponible en esta build.");
    return;
  }
  $("status").textContent = "Aprovisionando proyecto...";
  const thinking = appendThinking("Aprovisionando: GitHub + Vercel + Supabase + validacion...");
  try {
    const result = await window.editcoreProject.provision({
      projectRoot: state.projectRoot,
      firstDeploy: false,
      syncVercel: true,
      manageSupabase: true,
      validateBeforePublish: true,
    });
    removeThinking(thinking);
    if (result?.cancelled) {
      append("assistant", result.message || "Aprovisionamiento cancelado.", null, true, 0);
      $("status").textContent = "Cancelado";
      return;
    }
    const lines = formatStepReport(result.ok ? "## Proyecto aprovisionado" : "## Aprovisionamiento incompleto", result);
    if (result.checklist) lines.push("", "### Checklist", "```json", JSON.stringify(result.checklist, null, 2), "```");
    append("assistant", lines.join("\n"), null, true, 0);
    $("status").textContent = result.ok ? "Aprovisionado" : "Aprovisionamiento parcial";
  } catch (error) {
    removeThinking(thinking);
    append("assistant", `## Error al aprovisionar\n\n${error?.message || String(error)}`, null, true, 0);
    $("status").textContent = "Error al aprovisionar";
  }
}

function formatStepReport(title, result = {}) {
  const lines = [title, "", result.message || ""];
  if (result.branch) lines.push(`- Branch: \`${result.branch}\``);
  if (result.sha) lines.push(`- SHA: \`${String(result.sha).slice(0, 12)}\``);
  lines.push("", "### Pasos");
  for (const step of result.steps || []) {
    const mark = step.ok === false ? "✗" : (step.skipped ? "·" : "✓");
    lines.push(`- ${mark} **${step.step}**: ${step.message || step.remoteUrl || step.path || step.branch || step.sha || (step.ok ? "OK" : "fallo")}`);
  }
  const deploy = (result.steps || []).find((item) => item.step === "deploy_one_click" && item.url);
  if (deploy?.url) lines.push("", `URL: ${deploy.url}`);
  if (result.liveUrl) lines.push("", `Live URL: ${result.liveUrl}`);
  return lines.filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));
}

function stagePercentValue(stage = {}) {
  const st = String(stage.status || "pending");
  if (st === "done") return 100;
  if (st === "error") {
    const n = Number(stage.percent);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }
  if (st === "running") {
    const n = Number(stage.percent);
    if (Number.isFinite(n)) return Math.max(1, Math.min(99, Math.round(n)));
    return 12;
  }
  return 0;
}

function computeFullStackOverallPercent(stages = [], payloadPercent) {
  const fromPayload = Number(payloadPercent);
  if (Number.isFinite(fromPayload)) return Math.max(0, Math.min(100, Math.round(fromPayload)));
  if (!stages.length) return 0;
  const sum = stages.reduce((acc, stage) => acc + stagePercentValue(stage), 0);
  return Math.round(sum / stages.length);
}

function renderFullStackProgress(payload = {}) {
  const panel = $("fullStackProgress");
  const list = $("fullStackProgressStages");
  const status = $("fullStackProgressStatus");
  const pctEl = $("fullStackProgressPct");
  const fillEl = $("fullStackProgressFill");
  if (!panel || !list) return;
  const stages = Array.isArray(payload.stages) ? payload.stages : [];
  const overall = computeFullStackOverallPercent(stages, payload.percent);
  panel.classList.remove("hidden");
  panel.hidden = false;
  panel.classList.toggle("is-error", payload.ok === false || payload.status === "error" || stages.some((s) => s.status === "error"));
  panel.classList.toggle("is-done", payload.type === "complete" && payload.ok !== false && overall >= 100);
  list.replaceChildren();
  for (const stage of stages) {
    const li = document.createElement("li");
    const st = String(stage.status || "pending");
    const pct = stagePercentValue(stage);
    li.className = `is-${st}`;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = st === "done" ? "✓" : st === "error" ? "!" : st === "running" ? "…" : "";
    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("strong");
    title.textContent = stage.label || stage.id || "";
    const msg = document.createElement("span");
    msg.textContent = stage.message || "";
    meta.appendChild(title);
    meta.appendChild(msg);
    if (stage.url) {
      const link = document.createElement("a");
      link.href = stage.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = stage.url;
      meta.appendChild(link);
    }
    const track = document.createElement("div");
    track.className = "stage-track";
    const fill = document.createElement("div");
    fill.className = "stage-fill";
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    meta.appendChild(track);
    const pctLabel = document.createElement("span");
    pctLabel.className = "stage-pct";
    pctLabel.textContent = `${pct}%`;
    pctLabel.setAttribute("aria-label", `Progreso ${pct} por ciento`);
    li.appendChild(mark);
    li.appendChild(meta);
    li.appendChild(pctLabel);
    list.appendChild(li);
  }
  if (pctEl) pctEl.textContent = `${overall}%`;
  if (fillEl) fillEl.style.width = `${overall}%`;
  if (status) {
    if (payload.type === "complete") {
      status.textContent = payload.ok === false ? "falló" : "listo";
    } else if (payload.status === "error") {
      status.textContent = "error";
    } else {
      const running = stages.find((s) => s.status === "running");
      status.textContent = running
        ? `${running.label} ${stagePercentValue(running)}%…`
        : "en curso…";
    }
  }
}

function hideFullStackProgressSoon(ok) {
  const panel = $("fullStackProgress");
  if (!panel) return;
  if (ok) {
    setTimeout(() => {
      panel.classList.add("hidden");
      panel.hidden = true;
    }, 8000);
  }
}

async function fullStackDeployOneClick({ mode = "full" } = {}) {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de publicar.");
    return;
  }
  if (!window.editcoreProject?.fullStackDeploy) {
    appendMessage("assistant", "Publicar no está disponible en esta build.");
    return;
  }
  const conn = loadJson("editcore-connections", {}) || {};
  if (!conn.githubToken) {
    appendMessage("assistant", "Para publicar hace falta GitHub en Conexiones (bóveda safeStorage).");
    openConnections();
    return;
  }

  const isUpdate = mode === "update";
  const title = isUpdate ? "Actualizar publicación" : "Publicar";
  appendUserWithImages(isUpdate
    ? "🔄 Actualizar publicación (commit → push → redeploy)"
    : "🚀 Publicar (GitHub → Vercel → Supabase → Live)", []);
  rememberMessage("user", isUpdate
    ? "🔄 Actualizar publicación (commit → push → redeploy)"
    : "🚀 Publicar (GitHub → Vercel → Supabase → Live)");
  $("status").textContent = isUpdate ? "Actualizando publicación…" : "Publicando…";
  renderFullStackProgress({
    type: "stage",
    percent: 0,
    stages: isUpdate
      ? [
          { id: "publish", label: "Push + Deploy", status: "pending", percent: 0 },
          { id: "live", label: "Live URL", status: "pending", percent: 0 },
        ]
      : [
          { id: "github", label: "GitHub Repo", status: "pending", percent: 0 },
          { id: "vercel", label: "Vercel Link", status: "pending", percent: 0 },
          { id: "supabase", label: "Supabase DB", status: "pending", percent: 0 },
          { id: "publish", label: "Push + Deploy", status: "pending", percent: 0 },
          { id: "live", label: "Live URL", status: "pending", percent: 0 },
        ],
  });
  const head = document.querySelector("#fullStackProgress strong");
  if (head) head.textContent = title;

  const unsub = window.editcoreProject.onFullStackProgress?.((payload) => {
    renderFullStackProgress(payload || {});
    if (payload?.message) $("status").textContent = String(payload.message).slice(0, 120);
  });

  const thinking = appendThinking(isUpdate
    ? "Actualizando publicación en vivo…"
    : "Publicando paso a paso: GitHub → Vercel → Supabase → Deploy…");
  try {
    const project = activeProject();
    const result = await window.editcoreProject.fullStackDeploy({
      projectRoot: state.projectRoot,
      repoName: projectDisplayName(project) || "",
      confirm: true,
      mode: isUpdate ? "update" : "full",
    });
    removeThinking(thinking);
    if (typeof unsub === "function") unsub();
    if (result?.stages) renderFullStackProgress({ type: "complete", ok: result.ok, stages: result.stages, liveUrl: result.liveUrl, percent: result.ok ? 100 : undefined });
    if (result?.cancelled) {
      append("assistant", result.message || "Cancelado.", null, true, 0);
      $("status").textContent = "Cancelado";
      hideFullStackProgressSoon(true);
      return;
    }
    let chatText = "";
    if (result.ok) {
      const live = String(result.liveUrl || "").trim();
      chatText = [
        isUpdate ? "## Publicado correctamente" : "## Publicado correctamente",
        "",
        live ? `Live: ${live}` : (result.message || "Push y deploy completados."),
        "",
        "EditCoreAI listo. ¿Continuamos con otra tarea?",
      ].join("\n");
    } else {
      const lines = formatStepReport(
        isUpdate ? "## Actualización incompleta" : "## Publicación incompleta",
        result
      );
      if (result.stages?.length) {
        lines.push("", "### Etapas");
        for (const stage of result.stages) {
          const mark = stage.status === "done" ? "✓" : stage.status === "error" ? "✗" : "·";
          lines.push(`- ${mark} **${stage.label}**: ${stage.message || stage.status}${stage.url ? ` → ${stage.url}` : ""}`);
        }
      }
      chatText = lines.join("\n");
    }
    append("assistant", chatText, null, true, 0);
    rememberMessage("assistant", chatText);
    $("status").textContent = result.ok
      ? (result.liveUrl ? `Live: ${result.liveUrl}` : title + " OK")
      : (result.message || "Error");
    hideFullStackProgressSoon(result.ok === true);
  } catch (error) {
    removeThinking(thinking);
    if (typeof unsub === "function") unsub();
    const msg = error?.message || String(error);
    append("assistant", `## Error al ${isUpdate ? "actualizar" : "publicar"}\n\n${msg}`, null, true, 0);
    $("status").textContent = "Error";
    renderFullStackProgress({
      type: "complete",
      ok: false,
      stages: [{ id: "error", label: "Error", status: "error", message: msg }],
    });
  }
}

const EDITCORE_THEMES = ["blanco", "gris", "negro", "azul"];
const THEME_STORAGE_KEY = "editcore-ui-theme";

function applyEditCoreTheme(theme = "blanco") {
  const next = EDITCORE_THEMES.includes(theme) ? theme : "blanco";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
  const btn = $("themeCycleBtn");
  if (btn) btn.textContent = `Tema: ${next}`;
  syncPreviewChromeForTheme();
  try { window.EditCoreEditor?.applyTheme?.(); } catch { /* ignore */ }
  void syncAppWindowChrome(next);
  refreshAppStatusBar();
  return next;
}

function refreshAppStatusBar() {
  const branch = $("statusBarBranch");
  const msg = $("statusBarMessage");
  const model = $("statusBarModel");
  const cache = $("statusBarCache");
  const themeEl = $("statusBarTheme");
  const root = String(state.projectRoot || "").trim();
  const leaf = root ? root.split(/[/\\]/).filter(Boolean).pop() : "Sin proyecto";
  if (branch) {
    branch.textContent = leaf || "Sin proyecto";
    branch.title = root || "Sin proyecto — clic para Inicio";
  }
  if (msg) msg.textContent = String($("status")?.textContent || "Listo").trim() || "Listo";
  if (cache) cache.textContent = String($("savingsStatus")?.textContent || "Cache 0%").trim() || "Cache 0%";
  if (themeEl) {
    const themeName = document.documentElement.getAttribute("data-theme") || "blanco";
    themeEl.textContent = `Tema ${themeName}`;
  }
  const modelLabel = String($("modelPickerLabel")?.textContent || "").trim();
  if (model) model.textContent = modelLabel || "Auto";
}

async function initAppStatusBar() {
  const verEl = $("statusBarVersion");
  let ver = "";
  try { ver = String(await window.editcoreApp?.version?.() || "").trim(); } catch { /* ignore */ }
  if (verEl) verEl.textContent = ver ? (ver.startsWith("v") ? `EditCore ${ver}` : `EditCore v${ver}`) : "EditCore v3.0.5";
  refreshAppStatusBar();
  try {
    let refreshTimer = null;
    const debouncedRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = requestAnimationFrame(() => {
        refreshTimer = null;
        refreshAppStatusBar();
      });
    };
    const obs = new MutationObserver(debouncedRefresh);
    if ($("status")) obs.observe($("status"), { childList: true, characterData: true, subtree: true });
    if ($("savingsStatus")) obs.observe($("savingsStatus"), { childList: true, characterData: true, subtree: true });
    if ($("modelPickerLabel")) obs.observe($("modelPickerLabel"), { childList: true, characterData: true, subtree: true });
  } catch { /* ignore */ }
  $("statusBarBranch")?.addEventListener("click", () => {
    if (!state.projectRoot) {
      showWelcomeScreen();
      return;
    }
    try { $("toggleProjectsBtn")?.click(); } catch { /* ignore */ }
  });
  $("statusBarTheme")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cycleEditCoreTheme();
  });
  if ($("statusBarTheme")) {
    $("statusBarTheme").style.cursor = "pointer";
    $("statusBarTheme").title = "Clic para cambiar tema";
  }
}

async function syncAppWindowChrome(theme = "blanco") {
  // Título OS corto — la versión vive en la status bar (sin doble branding).
  document.title = "EditCore";
  try {
    await window.editcoreApp?.setUiTheme?.(theme);
  } catch { /* ignore */ }
}

function syncPreviewChromeForTheme() {
  const previewBg = getComputedStyle(document.documentElement).getPropertyValue("--ec-preview-bg").trim()
    || getComputedStyle(document.documentElement).getPropertyValue("--ec-bg").trim()
    || "#1e1e1e";
  const webview = $("previewWebview");
  if (webview) {
    webview.style.background = previewBg;
    try { webview.style.setProperty("background-color", previewBg); } catch { /* ignore */ }
  }
  const body = document.querySelector(".viewer-body");
  if (body) body.style.background = previewBg;
  const status = $("previewStatus");
  if (status) {
    status.style.background = previewBg;
    status.style.color = getComputedStyle(document.documentElement).getPropertyValue("--ec-text-muted").trim() || "";
  }
  const url = $("previewUrl");
  if (url) {
    const root = String(state.projectRoot || "").toLowerCase();
    if (root) {
      const isDesktop = /editcoreai|editcore\s*ai/.test(root);
      url.placeholder = isDesktop
        ? "EditCoreAI desktop — el panel Web no aplica"
        : "URL del navegador del proyecto";
    } else {
      url.placeholder = "Abre un proyecto para conectar su navegador";
    }
  }
}

function cycleEditCoreTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "blanco";
  const idx = Math.max(0, EDITCORE_THEMES.indexOf(current));
  const next = EDITCORE_THEMES[(idx + 1) % EDITCORE_THEMES.length];
  applyEditCoreTheme(next);
  closeAllToolbarMenus();
  $("status").textContent = `Tema ${next}`;
  return next;
}

applyEditCoreTheme((() => {
  try { return localStorage.getItem(THEME_STORAGE_KEY) || "blanco"; } catch { return "blanco"; }
})());

async function refreshMaintenancePanel() {
  const summary = $("maintenanceSummary");
  const list = $("maintenanceList");
  if (!summary || !list || !window.editcoreProject?.healthAll) return;
  summary.textContent = "Escaneando proyectos...";
  list.innerHTML = "";
  const payload = state.projects.map((project) => ({
    id: project.id,
    name: project.name,
    projectRoot: project.projectRoot,
  }));
  const result = await window.editcoreProject.healthAll({ projects: payload });
  summary.textContent = `${result.healthy || 0}/${result.count || 0} proyectos listos para publicar`;
  for (const project of result.projects || []) {
    const item = document.createElement("div");
    item.className = "maintenance-item";
    const status = project.ok ? "OK" : `Alertas: ${(project.issues || []).join(", ")}`;
    const last = project.lastPublish?.at ? `Ultima pub: ${project.lastPublish.at.slice(0, 16)}` : "Sin publicaciones registradas";
    item.innerHTML = `<strong>${project.name || project.projectRoot}</strong><br><span>${status}</span><br><small>${last}</small>`;
    list.appendChild(item);
  }
}

async function openMaintenanceDialog() {
  // Compat: Mantenimiento se abrió solo; ahora va al Inspector.
  return openInspector();
}

async function loadMaintenanceSchedulerUi() {
  if (!window.editcoreMaintenance?.getScheduler) return;
  const config = await window.editcoreMaintenance.getScheduler();
  const enabled = $("maintenanceAutoEnabled");
  const hours = $("maintenanceIntervalHours");
  const status = $("maintenanceSchedulerStatus");
  if (enabled) enabled.checked = config.enabled !== false;
  if (hours) hours.value = String(config.intervalHours || 24);
  if (status) {
    const last = config.lastRunAt ? `Ultimo: ${config.lastRunAt.slice(0, 16)}` : "Sin ejecuciones previas";
    const result = config.lastResult
      ? ` · ${config.lastResult.healthy}/${config.lastResult.count} OK`
      : "";
    status.textContent = `Scheduler ${config.enabled !== false ? "activo" : "pausado"} · ${last}${result}`;
  }
}

async function saveMaintenanceSchedulerUi() {
  if (!window.editcoreMaintenance?.setScheduler) return;
  const patch = {
    enabled: Boolean($("maintenanceAutoEnabled")?.checked),
    intervalHours: Number($("maintenanceIntervalHours")?.value || 24),
    notifyOnIssues: true,
  };
  await window.editcoreMaintenance.setScheduler(patch);
  await loadMaintenanceSchedulerUi();
  $("status").textContent = "Scheduler de mantenimiento guardado";
}

async function runMaintenanceNowFromUi() {
  if (!window.editcoreMaintenance?.runNow) return;
  $("status").textContent = "Ejecutando mantenimiento...";
  const result = await window.editcoreMaintenance.runNow();
  await loadMaintenanceSchedulerUi();
  await refreshMaintenancePanel();
  $("status").textContent = result?.ok ? "Mantenimiento OK" : `${result?.unhealthy || 0} alerta(s)`;
}

async function createSupabaseProjectFromPanel() {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de crear Supabase en la carpeta.");
    return;
  }
  if (!window.editcoreProject?.supabaseCreate) {
    appendMessage("assistant", "Creacion Supabase no disponible en esta build.");
    return;
  }
  const useCloud = Boolean(window.confirm("¿Usar Supabase Cloud API? (Cancelar = GafCore/self-hosted ya configurado)"));
  $("status").textContent = "Creando proyecto Supabase...";
  try {
    const result = await window.editcoreProject.supabaseCreate({
      projectRoot: state.projectRoot,
      projectName: pathBasename(state.projectRoot),
      useCloud,
      pushDb: true,
    });
    const lines = formatStepReport(result.ok ? "## Supabase creado/enlazado" : "## Supabase incompleto", result);
    append("assistant", lines.join("\n"), null, true, 0);
    $("status").textContent = result.ok ? "Supabase listo" : "Supabase incompleto";
    if (result.ok) loadConnections();
  } catch (error) {
    append("assistant", `## Error Supabase\n\n${error?.message || String(error)}`, null, true, 0);
    $("status").textContent = "Error Supabase";
  }
}

function pathBasename(p) {
  return String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "proyecto";
}

// --- Inspector token-cost cache (in-memory, 5-minute TTL) ---
const _inspectorResponseCache = new Map();
function _inspectorCacheKey(systemPrompt, history, prompt) {
  // Simple hash: combine last 200 chars of systemPrompt + all history roles+content (first 60 chars each) + prompt
  const histPart = history.map((m) => `${m.role}:${String(m.content).slice(0, 60)}`).join("|");
  const sysPart = String(systemPrompt).slice(-200);
  return `${sysPart}||${histPart}||${prompt}`;
}
function _inspectorCacheGet(key) {
  const entry = _inspectorResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > 5 * 60 * 1000) { _inspectorResponseCache.delete(key); return null; }
  return entry.text;
}
function _inspectorCacheSet(key, text) {
  // Keep cache small — evict oldest if over 30 entries
  if (_inspectorResponseCache.size >= 30) {
    const oldest = [..._inspectorResponseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) _inspectorResponseCache.delete(oldest[0]);
  }
  _inspectorResponseCache.set(key, { text, at: Date.now() });
}
// Tras una reparacion el disco cambio: cualquier respuesta cacheada describe
// un estado que ya no existe y confundiria al usuario.
function _inspectorCacheClear() {
  _inspectorResponseCache.clear();
}

// Etiquetas legibles para el progreso del chat de diagnostico.
const INSPECTOR_CHAT_TOOL_LABELS = {
  list_files: "Listando",
  read_file: "Leyendo",
  search_files: "Buscando",
  service_read: "Consultando",
  inspect_preview: "Inspeccionando",
  connection_status: "Verificando conexiones",
  brain_search: "Consultando cerebro",
  brain_skill: "Aplicando habilidad",
};
function inspectorChatToolLabel(step = {}) {
  const name = String(step.name || step.tool || "").trim();
  const label = INSPECTOR_CHAT_TOOL_LABELS[name] || "Analizando";
  const target = String(step.args?.path || step.args?.query || step.args?.service || "").trim();
  return target ? `${label} ${target}` : `${label}...`;
}

// Distingue "que esta mal?" de "arreglalo". Solo en el segundo caso Inspector
// aplica la correccion sin pedir confirmacion adicional.
const INSPECTOR_REPAIR_INTENT = /\b(corrig|corrig[ei]|arregl|repar|soluciona|soluci[oó]nal|f[ií]jal|aplica la correc|implementa|hazlo|dale|proced)/i;
const INSPECTOR_DIAGNOSE_ONLY = /\b(solo|unicamente|nada m[aá]s)\s+(diagnos|analiz|revis|dime|report)|no (lo )?(corrijas|repares|cambies|apliques|toques)/i;
function inspectorPromptWantsRepair(prompt) {
  const text = String(prompt || "");
  if (INSPECTOR_DIAGNOSE_ONLY.test(text)) return false;
  return INSPECTOR_REPAIR_INTENT.test(text);
}

// El chat es de solo lectura, pero con herramientas reales: el prompt debe
// exigir evidencia leida en lugar de suposiciones sobre el codigo.
function inspectorChatToolPrompt(basePrompt) {
  return [
    basePrompt,
    "",
    "TIENES HERRAMIENTAS REALES DE SOLO LECTURA: list_files, read_file, search_files, service_read, inspect_preview, connection_status.",
    "No especules sobre el contenido de un archivo: leelo con read_file antes de afirmar nada sobre el.",
    "Usa search_files para localizar el codigo relevante y lee solo lo necesario: maximo 6 lecturas por respuesta.",
    "Tu no escribes archivos: el motor de reparacion los escribe por ti con respaldo, validacion y rollback automatico.",
    "Cita archivo y linea como evidencia de cada problema que reportes.",
    "",
    "PARA CORREGIR: cuando identifiques un problema con solucion concreta, termina tu respuesta con este bloque exacto:",
    "CORRECCION_EDITCORE:",
    "DESTINO: EDITCORE   (o PROYECTO si el fallo esta en el proyecto del usuario, no en EditCore)",
    "PROMPT: <instrucciones precisas de que archivo cambiar y como, con rutas reales que leiste>",
    "Sin ese bloque la correccion no se aplica: el hallazgo se queda en texto y el usuario no obtiene el arreglo.",
  ].join("\n");
}

// Compact system prompt for follow-up messages (after first turn) — ~80 tokens vs ~900
function inspectorContextPromptCompact(snapshot) {
  const twin = snapshot?.twin || {};
  const runtime = snapshot?.runtime || {};
  const issues = (twin.issues || []).slice(0, 3);
  return [
    "Eres Inspector Core AI de EditCore. Responde en español, sin emojis, con evidencia concreta.",
    `EditCore: version ${runtime.version || "?"}, archivos ${twin.fileCount || 0}, alertas ${issues.length}.`,
    ...issues.map((i) => `  * [${i.severity}] ${i.title}`),
    `Proyecto: ${state.projectRoot || "sin proyecto"}`,
  ].join("\n");
}

// Estimate token count (rough: 1 token ≈ 4 chars)
function _estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

async function sendInspectorPrompt() {
  const input = $("inspectorPrompt");
  const button = $("inspectorSendBtn");
  const prompt = input.value.trim();
  if (!prompt) return;
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = "Enviando...";
  input.value = "";
  inspectorAppend("user", prompt);
  inspectorRemember("user", prompt);
  const thinking = inspectorAppend("assistant", "Analizando EditCore y el contexto solicitado...");
  try {
    const snapshot = state.inspectorSnapshot || await refreshInspectorForProject({ silent: true });
    // Chat Inspector: modelo directo local (sin Gateway). Escaneo ya usa kernel.
    let modelConfig;
    try {
      modelConfig = activeModelConfigForInspector();
    } catch (err) {
      thinking?.remove();
      const msg = String(err?.message || err);
      inspectorAppend("assistant", [
        "## Inspector Nativo Autónomo Activo (Modo Local)",
        "",
        "El escaneo y la autorreparación (`.next` / `routes-manifest`) funcionan **sin API** vía kernel local.",
        "",
        msg,
        "",
        "Kernel: `process-runner` · `vision-inspector` · `global-memory` · `snapshot`.",
      ].join("\n"));
      inspectorRemember("assistant", msg);
      return;
    }

    // Use full system prompt only on the first message; compact on follow-ups
    const allMessages = inspectorProjectMessages();
    const isFirstTurn = allMessages.filter((m) => m.role === "user").length <= 1;
    const systemPrompt = isFirstTurn ? inspectorContextPrompt(snapshot) : inspectorContextPromptCompact(snapshot);

    // Send only the last 8 messages (4 pairs) as history — not the full 20
    const history = allMessages.slice(0, -1).slice(-8).map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    }));

    // Dynamic max_tokens: generous budget for comprehensive engineering answers
    const needsDetail = /repar|analiz|diagnos|revisa|complet|explica|describe|lista|todo|error|fallo|crash|build|deploy/i.test(prompt);
    const dynamicMaxTokens = needsDetail ? 4096 : 2048;

    // Check local cache before calling API
    const cacheKey = _inspectorCacheKey(systemPrompt, history, prompt);
    const cached = _inspectorCacheGet(cacheKey);
    if (cached) {
      thinking?.remove();
      inspectorAppend("assistant", cached + "\n\n_(respuesta desde cache local — sin costo de API)_");
      inspectorRemember("assistant", cached);
      button.disabled = false;
      button.textContent = previousText;
      input.focus();
      return;
    }

    // Con un runtime detectado el Inspector diagnostica leyendo el disco de verdad.
    // Sin runtime no inventamos un root: caemos al chat plano.
    const chatRoot = String(snapshot?.runtime?.root || snapshot?.twin?.projectRoot || "").trim();
    let result;
    if (chatRoot) {
      const runId = `inspector-chat-${Date.now()}`;
      activeInspectorChatRun = { runId, thinking };
      try {
        result = await window.editcoreAgent.run({
          ...modelConfig,
          runId,
          agentId: "inspector-core-chat",
          analysisMode: true,
          permissionMode: "readonly",
          allowWrite: false,
          planAuthorized: false,
          maxOutputTokens: dynamicMaxTokens,
          namespace: "inspector",
          projectRoot: chatRoot,
          projectId: activeProject()?.id || "",
          systemPrompt: inspectorChatToolPrompt(systemPrompt),
          prompt,
          history,
        });
      } finally {
        activeInspectorChatRun = null;
      }
    } else {
      result = await window.editcoreChat.chat({
        ...modelConfig,
        maxOutputTokens: dynamicMaxTokens,
        namespace: "inspector",
        projectRoot: "",
        projectId: activeProject()?.id || "",
        systemPrompt,
        prompt,
        history,
      });
    }
    thinking?.remove();
    const cleanText = sanitizeInspectorText(result.text || result.summary || "");
    const correctionMatch = cleanText.match(/CORRECCION_EDITCORE\s*:\s*([\s\S]+)/i);
    let pendingCorrection = null;
    if (correctionMatch?.[1]?.trim()) {
      const block = correctionMatch[1].trim();
      const destination = block.match(/DESTINO\s*:\s*(EDITCORE|PROYECTO)/i)?.[1]?.toUpperCase() || "EDITCORE";
      const preparedPrompt = block.match(/PROMPT\s*:\s*([\s\S]+)/i)?.[1]?.trim() || block;
      pendingCorrection = {
        handoffPrompt: preparedPrompt,
        targetRoot: destination === "PROYECTO" ? state.projectRoot : snapshot?.runtime?.root || "",
        target: destination === "PROYECTO" ? "project" : "editcore-runtime",
        runtime: snapshot?.runtime,
      };
      setInspectorHandoff(pendingCorrection);
    }
    // Una respuesta cacheada describe el disco de antes de reparar: no la guardamos.
    if (!pendingCorrection) _inspectorCacheSet(cacheKey, cleanText);
    inspectorAppend("assistant", cleanText);
    inspectorRemember("assistant", cleanText);
    if (result.usage) recordUsage(result.usage);
    inspectorHealth("ready", "Inspector activo");
    // Si pediste corregir, Inspector corrige: no se queda en el diagnostico.
    if (pendingCorrection && inspectorPromptWantsRepair(prompt)) {
      inspectorAppend("assistant", "Aplicando la correccion con respaldo y validacion...");
      await prepareInspectorCorrection();
    }
  } catch (error) {
    thinking?.remove();
    const message = error?.message || String(error);
    inspectorAppend("assistant", message);
    inspectorRemember("assistant", message);
    inspectorHealth("error", message);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
    input.focus();
  }
}

async function prepareInspectorCorrection() {
  if (!latestInspectorHandoff?.prompt) return;
  if (latestInspectorHandoff.target === "editcore-runtime") {
    // Misma ruta que el boton "Reparar EditCore": checkpoint, reparacion,
    // validacion y rollback en un solo pipeline.
    await repairInspectorTarget("editcore");
    return;
  }
  const targetRoot = latestInspectorHandoff.targetRoot;
  if (!targetRoot) {
    inspectorHealth("error", "Inspector no pudo determinar la carpeta de destino para la correccion.");
    return;
  }
  // Inspector aplica la correccion el mismo: adoptar el proyecto y dejar el
  // prompt escrito obligaba al usuario a reenviarlo a mano y el hallazgo se perdia.
  const project = projectForRoot(targetRoot, /resources[\\/]app$/i.test(targetRoot) ? "EditCoreAI" : "");
  state.activeProjectId = project.id;
  state.projectRoot = targetRoot;
  project.permissionMode = state.permissionMode;
  project.updatedAt = Date.now();
  saveProjects();
  renderProjects();
  renderFeed();
  await repairInspectorTarget("project");
}

function appendStreaming() {
  const item = document.createElement("article");
  item.className = "msg assistant";
  item.id = "streamingMsg";
  const head = document.createElement("div");
  head.className = "msg-head";
  head.textContent = "EditCoreAI";
  const body = document.createElement("div");
  body.className = "msg-body";
  item.append(head, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();
  return { item, body, head };
}

// ── Send ──────────────────────────────────────────────────────────────────────

function steeringInstructionPreview(instruction = "", maxLen = 180) {
  const text = String(instruction || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

function updateSteeringUI(instruction, runId, pendingDirections = 1, interrupted = false) {
  const preview = steeringInstructionPreview(instruction, 220);
  const liveRun = runId ? activeAgentThinkingRuns.get(runId) : null;
  // Con runId concreto no pintar en otro thinking paralelo.
  const thinkingEl = liveRun?.thinking || (!runId ? document.querySelector(".thinking-msg") : null);
  if (thinkingEl) {
    addAgentStepToThinking(thinkingEl, {
      phase: "direction",
      stage: "running",
      text: preview || instruction,
    });
    setThinkingStatus(
      thinkingEl,
      interrupted ? "Reorientando segun tu mensaje..." : "Aplicando tu correccion..."
    );
    showThinkingIndicator(thinkingEl);
  }
  $("status").textContent = interrupted
    ? "Reorientando tarea activa..."
    : `Correccion en cola (${pendingDirections})`;
}

function isAppInfoQuestion(prompt = "") {
  const p = String(prompt || "").trim();
  if (!p || p.length > 240) return false;
  if (/\b(?:corrije|corrige|arregla|implementa|analiza|audita|modifica|crea\s+un)\b/i.test(p)) return false;
  return /\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es)(?:\s+esta\s+app)?|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda)\b/i.test(p);
}

function localAppInfoAnswer(project = null) {
  const root = String(project?.projectRoot || state.projectRoot || "").trim();
  const name = String(project?.name || (root ? root.split(/[/\\]/).pop() : "") || "tu proyecto").trim();
  return [
    "**EditCoreAI** es el IDE + agente: edita código, preview, Publicar, Inspector y Cerebro.",
    "",
    "### Dependencias del operador",
    "- **Conexiones (bóveda):** GitHub (git), Vercel (deploy), Supabase (datos por proyecto), SSH.",
    "- **Modelos:** ME AI y APICredits con tus API keys en el panel Modelos (Auto elige el mejor activo).",
    "",
    root
      ? `Ahora tienes abierto **${name}** (\`${root}\`). Para inspección: *analiza el proyecto*. Para cambios: dilo en concreto.`
      : "Abre un proyecto con **Abrir** para trabajar sobre tu código.",
  ].join("\n");
}

function isUserStopCommand(prompt = "") {
  const text = String(prompt || "").trim().toLowerCase().replace(/[.!?,;]+$/g, "");
  if (!text) return false;
  if (/^(?:por\s+favor\s+)?(?:alto|detente|det[eé]n(?:lo)?|detener|parar?|p[aá]ralo|stop|cancela(?:r|lo)?|aborta(?:r|lo)?|interrump(?:e|ir|alo)?|basta|pausa(?:r)?|no\s+sigas|termina(?:r)?)$/i.test(text)) {
    return true;
  }
  if (/^(?:por\s+favor\s+)?(?:cancela|cancelar|det[eé]n|detener|parar?|stop|aborta|pausa|termina(?:r)?)\s+(?:el\s+an[aá]lisis|la\s+tarea|la\s+ejecuci[oó]n|esto|todo|toda(?:\s+acci[oó]n|s)?|el\s+proceso|todas?\s+las?\s+acciones?)$/i.test(text)) {
    return true;
  }
  if (/^(?:termina|cancel[ae]|det[eé]n|para|aborta)\s+(?:toda|todo|todas)\b/i.test(text)) {
    return true;
  }
  return false;
}

function isMetaChatCommand(prompt = "") {
  const p = String(prompt || "").trim();
  if (!p || p.length > 220) return false;
  if (isUserStopCommand(p)) return false;
  if (isAppInfoQuestion(p)) return true;
  if (/^\s*(?:procede|adelante|autorizo|contin[uú]a|corrije|corrige|arregla|implementa|analiza|audita|crea|list_)\b/i.test(p)) {
    return false;
  }
  return /(?:^|[^\wáéíóúüñ])(?:no\s+te\s+estoy\s+ordenando|eso\s+no\s+te\s+lo\s+ped[ií]|no\s+te\s+lo\s+ped[ií]|tu\s+forma\s+no\s+es\s+correcta|qu[eé]\s+est[aá]s\s+haciendo|por\s+qu[eé]\s+haces\s+eso|no\s+es\s+lo\s+que\s+ped[ií]|no\s+ped[ií]\s+eso|est[aá]s\s+confundid|mal\s+entendido|no\s+entendiste)(?=$|[^\wáéíóúüñ])/i.test(p);
}

async function hardStopFromChat(reason = "terminal-stop") {
  forceKillAllAgentUi("Detenido.");
  const project = activeProject();
  const steering = [...activePromptRequests.values()].find((job) => job.runId || job.planRunId);
  const runId = steering?.runId || steering?.planRunId || project?.agentWorkflow?.runId || "";
  if (runId && window.editcoreAgent?.steer) {
    await window.editcoreAgent.steer({ instruction: "STOP", runId }).catch(() => false);
  }
  if (window.editcoreAgent?.cancel) {
    await window.editcoreAgent.cancel({ runId }).catch(() => false);
  }
  await cancelActiveResponse();
  forceKillAllAgentUi("Detenido.");
  if (project) {
    const taskId = project.agentWorkflow?.taskId || project.durableWorkflow?.taskId || "";
    if (taskId && window.editcoreTasks?.cancel) await window.editcoreTasks.cancel(taskId).catch(() => null);
    if (taskId && window.editcoreTasks?.discard) await window.editcoreTasks.discard(taskId).catch(() => null);
    project.agentWorkflow = {
      ...(project.agentWorkflow || {}),
      phase: "idle",
      runId: "",
      taskId: "",
      planId: "",
      task: "",
      plan: "",
      fixQueue: [],
      resumeSteps: [],
      checkpoints: [],
      error: "",
      resuming: false,
      updatedAt: Date.now(),
      stopReason: reason,
    };
    project.durableWorkflow = null;
    saveProjects();
  }
  if ($("status")) $("status").textContent = "Detenido.";
}

function agentTaskIsLive() {
  if (activePromptRequests.size > 0) return true;
  const project = activeProject();
  if (project?.agentWorkflow?.phase === "executing") return true;
  return [...activePromptRequests.values()].some((job) => job.isAgent && job.agentExecuting);
}

function triggerChatSend(promptOverride = "") {
  const promptValue = String(promptOverride || $("prompt")?.value || $("chatHomePrompt")?.value || "").trim();
  const running = activePromptRequests.size > 0;
  const hasDraft = Boolean(promptValue) || state.attachments.length > 0;
  if (running && !hasDraft) {
    void cancelActiveResponse();
    return;
  }
  send({ preventDefault() {}, _promptOverride: promptValue }).catch((error) => {
    if ($("prompt")) $("prompt").value = "";
    if ($("chatHomePrompt")) $("chatHomePrompt").value = "";
    updateSendButtonState();
    $("status").textContent = error?.message || String(error);
  });
}

async function send(event) {
  event?.preventDefault?.();
  const promptField = $("prompt");
  const homePromptField = $("chatHomePrompt");
  const promptOverride = typeof event === "string" ? event : (event?._promptOverride || "");
  const prompt = String(promptOverride || promptField?.value || homePromptField?.value || "").trim();
  const hasAttachments = state.attachments.length > 0;
  const hasImages = state.attachments.some((item) => isImageAttachment(item));
  if (!prompt && !hasAttachments) return;
  if (promptField) promptField.value = "";
  if (homePromptField) homePromptField.value = "";
  updateSendButtonState();
  let effectivePrompt = prompt || (hasImages ? "Analiza la imagen adjunta." : "Analiza los archivos adjuntos.");

  if (!hasAttachments && isUserStopCommand(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    $("prompt").value = "";
    updateSendButtonState();
    await hardStopFromChat("terminal-stop");
    const stopMsg = "Detenido.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", stopMsg, usage, true, 0);
    rememberMessage("assistant", stopMsg, usage);
    $("status").textContent = "Detenido";
    return;
  }

  if (!hasAttachments && isAppInfoQuestion(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = localAppInfoAnswer(activeProject());
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Chat · sin tools";
    updateSendButtonState();
    return;
  }

  if (!hasAttachments && isMetaChatCommand(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = "Entendido: no lo tomo como orden. Dime exactamente qué listar, analizar o corregir.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("status").textContent = "Chat";
    updateSendButtonState();
    return;
  }

  if (!hasAttachments && /^\s*(?:deshacer|undo)(?:\s+(?:ultima|última)?\s*corrida)?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    await undoLastAgentRunFromUi({ fromChat: true });
    return;
  }

  if (!hasAttachments && /^\s*(?:actualizar\s+publicaci[oó]n|actualizar\s+deploy|redeploy(?:\s+ahora)?)\s*$/i.test(effectivePrompt)) {
    await fullStackDeployOneClick({ mode: "update" });
    return;
  }

  if (!hasAttachments && /^\s*(?:publicar(?:\s+todo|\s+proyecto|\s+ahora)?|deploy(?:\s+ahora)?)\s*$/i.test(effectivePrompt)) {
    await fullStackDeployOneClick({ mode: "full" });
    return;
  }

  if (!hasAttachments && /^\s*git\s+status\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const st = await window.editcoreAgent.gitStatus({ projectRoot: root });
      appendMessage("assistant", [
        "## Git status",
        "",
        `Rama: \`${st.branch || "HEAD"}\``,
        "",
        "```",
        st.short || "(limpio)",
        "```",
      ].join("\n"));
    } catch (error) {
      appendMessage("assistant", `Git status fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*(?:proponer\s+commit|sugerir\s+commit|commit\s+msg)\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const suggestion = await window.editcoreAgent.gitSuggestCommit({ projectRoot: root });
      appendMessage("assistant", [
        "## Commit sugerido",
        "",
        "```",
        suggestion.message || "(vacio)",
        "```",
        "",
        "Para aplicarlo escribe: `COMMIT AHORA` (pedira confirmacion).",
      ].join("\n"));
    } catch (error) {
      appendMessage("assistant", `No pude proponer commit: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*commit\s+ahora\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const suggestion = await window.editcoreAgent.gitSuggestCommit({ projectRoot: root });
      const confirmed = window.editcoreWindow?.confirmDialog
        ? await window.editcoreWindow.confirmDialog(
          "Crear commit",
          `Se creara un commit con este mensaje:\n\n${String(suggestion.message || "").slice(0, 400)}`,
          "Commit",
          "Cancelar",
        )
        : false;
      if (confirmed === false) {
        appendMessage("assistant", "Commit cancelado.");
        return;
      }
      const result = await window.editcoreAgent.gitCommit({
        projectRoot: root,
        message: suggestion.message,
        paths: suggestion.files || [],
      });
      if (result.skipped) {
        appendMessage("assistant", result.message || "Nada que commitear.");
      } else {
        appendMessage("assistant", `Commit OK${result.head ? ` (\`${result.head}\`)` : ""}.`);
      }
    } catch (error) {
      appendMessage("assistant", `Commit fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*exportar\s+chat\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const project = activeProject();
      const root = String(state.projectRoot || "").trim();
      if (!root) {
        appendMessage("assistant", "Abre un proyecto antes de exportar el chat.");
        return;
      }
      if (!window.editcoreProject?.writeText) {
        appendMessage("assistant", "Exportar chat no disponible en esta build.");
        return;
      }
      const messages = Array.isArray(project?.messages) ? project.messages : (state.history || []);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rel = `.editcore/chat-export-${stamp}.md`;
      const lines = [
        `# EditCore chat export`,
        "",
        `Proyecto: ${root}`,
        `Fecha: ${new Date().toISOString()}`,
        "",
        "---",
        "",
      ];
      for (const msg of messages) {
        const role = String(msg.role || "assistant");
        const text = String(msg.content || msg.text || "").trim();
        if (!text) continue;
        lines.push(`## ${role}`, "", text, "", "---", "");
      }
      await window.editcoreProject.writeText({
        projectRoot: root,
        path: rel,
        content: lines.join("\n"),
      });
      appendMessage("assistant", `Chat exportado a \`${rel}\` (${messages.length} mensajes).`);
      refreshProjectFilesFromDisk({ viewDir: ".editcore" });
    } catch (error) {
      appendMessage("assistant", `Exportar chat fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*indexar(?:\s+repo)?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const out = await window.editcoreAgent.indexBuild({ projectRoot: root });
      appendMessage("assistant", `Indice listo: ${out.fileCount} archivos, ${out.tokenCount} tokens (${out.builtAt}).`);
    } catch (error) {
      appendMessage("assistant", `INDEXAR fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*buscar\s+(.+)$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const query = effectivePrompt.replace(/^\s*buscar\s+/i, "").trim();
      const out = await window.editcoreAgent.indexSearch({ projectRoot: root, query, limit: 15 });
      const lines = (out.hits || []).map((h) => `- \`${h.path}\` (score ${h.score})`);
      appendMessage("assistant", lines.length
        ? `## Busqueda\n\nQuery: \`${query}\`\n\n${lines.join("\n")}`
        : `Sin hits para \`${query}\`. Prueba \`INDEXAR\` primero.`);
    } catch (error) {
      appendMessage("assistant", `BUSCAR fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*mcp\s+status\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const st = await window.editcoreAgent.mcpHealth({ projectRoot: root });
      const servers = (st.servers || []).map((s) => `- ${s.name || s.id} (${s.transport}${s.runnable ? ", runnable" : ""})`).join("\n") || "(ninguno)";
      const tools = (st.tools || []).slice(0, 12).map((t) => `- ${t.serverId}/${t.name}`).join("\n") || "(sin tools live)";
      appendMessage("assistant", [
        "## MCP",
        "",
        st.message || "",
        "",
        `Scope: ${st.scope || "?"} · ready=${st.ready === true}`,
        "",
        "### Servers",
        servers,
        "",
        "### Tools",
        tools,
        "",
        "Para registrar 1 servidor: `MCP ADD echo node resources/app/test/fixtures/mcp-echo-server.js`",
      ].join("\n"));
    } catch (error) {
      appendMessage("assistant", `MCP STATUS fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*mcp\s+add\s+(\S+)\s+(\S+)(?:\s+(.+))?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const m = effectivePrompt.match(/^\s*mcp\s+add\s+(\S+)\s+(\S+)(?:\s+(.+))?\s*$/i);
      const name = m[1];
      const command = m[2];
      const rest = String(m[3] || "").trim();
      const args = rest ? rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^['"]|['"]$/g, "")) || [] : [];
      const entry = await window.editcoreAgent.mcpRegister({
        projectRoot: root,
        name,
        command,
        args,
        allowedTools: ["*"],
      });
      appendMessage("assistant", `MCP registrado: \`${entry.id}\` → ${entry.command} ${(entry.args || []).join(" ")}\nConfig: \`${entry.configPath}\``);
    } catch (error) {
      appendMessage("assistant", `MCP ADD fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*privacy\s+(on|off|status)\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const mode = effectivePrompt.match(/privacy\s+(on|off|status)/i)[1].toLowerCase();
      if (mode === "status") {
        const cur = await window.editcoreAgent.privacyGet();
        appendMessage("assistant", `Privacy Mode: ${cur.enabled ? "ON" : "OFF"}`);
      } else {
        const cur = await window.editcoreAgent.privacySet({ enabled: mode === "on" });
        appendMessage("assistant", `Privacy Mode ${cur.enabled ? "activado" : "desactivado"}.`);
      }
    } catch (error) {
      appendMessage("assistant", `Privacy fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*yolo\s+(on|off|status)\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const mode = effectivePrompt.match(/yolo\s+(on|off|status)/i)[1].toLowerCase();
      if (mode === "status") {
        const cur = await window.editcoreAgent.terminalPolicy({ projectRoot: root });
        appendMessage("assistant", `Yolo Mode: ${cur.yolo ? "ON" : "OFF"} · prefixes: ${(cur.prefixes || []).slice(0, 8).join(", ")}...`);
      } else {
        const cur = await window.editcoreAgent.terminalYolo({ projectRoot: root, enabled: mode === "on" });
        appendMessage("assistant", `Yolo Mode ${cur.yolo ? "ON (allowlist abierta)" : "OFF (allowlist activa)"}.`);
      }
    } catch (error) {
      appendMessage("assistant", `YOLO fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*workflows?(?:\s+init)?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const ensure = /\binit\b/i.test(effectivePrompt);
      const out = await window.editcoreAgent.workflows({ projectRoot: root, ensure });
      const wf = (out.workflows || []).map((w) => `- \`${w.id}\`: ${w.description || w.name}`).join("\n") || "(ninguno)";
      const rules = (out.rules || []).map((r) => `- \`${r.name}\` [${r.scope}]`).join("\n") || "(ninguna)";
      appendMessage("assistant", `## Workflows\n\n${wf}\n\n## Reglas scoped\n\n${rules}`);
    } catch (error) {
      appendMessage("assistant", `WORKFLOWS fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*inspeccionar(?:\s+browser)?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    await inspectPreviewFromUi();
    appendMessage("assistant", "Inspeccion del browser local abierta en el panel derecho del preview.");
    return;
  }

  if (!hasAttachments && /^\s*renombrar\s+(\S+)\s+(?:a|por|->)\s+(\S+)\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const m = effectivePrompt.match(/^\s*renombrar\s+(\S+)\s+(?:a|por|->)\s+(\S+)\s*$/i);
      const from = m[1];
      const to = m[2];
      const isSymbol = /^[A-Za-z_$][\w$]*$/.test(from) && /^[A-Za-z_$][\w$]*$/.test(to)
        && !/[\\/]/.test(from) && !/[\\/.]/.test(to);
      let out;
      if (isSymbol) {
        out = await window.editcoreProject.renameSync({
          projectRoot: root,
          kind: "symbol",
          file: "src/index.ts",
          oldName: from,
          newName: to,
        }).catch(async () => window.editcoreProject.renameSync({
          projectRoot: root,
          kind: "symbol",
          file: "src/main.ts",
          oldName: from,
          newName: to,
        }));
      } else {
        out = await window.editcoreProject.renameSync({ projectRoot: root, from, to });
      }
      appendMessage("assistant", [
        "## Rename sync",
        "",
        `\`${out.from || from}\` → \`${out.to || to}\``,
        `Referencias actualizadas: ${out.refsUpdated}`,
        ...(out.files || []).slice(0, 12).map((f) => `- \`${f.path || f}\``),
      ].join("\n"));
      refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
    } catch (error) {
      appendMessage("assistant", `RENOMBRAR fallo: ${error?.message || error}`);
    }
    return;
  }

  // Images→code: admite adjuntos (vision) o solo brief.
  if (/^\s*(?:images?\s*->\s*code|imagen\s+a\s+codigo|images?\s+to\s+code)\b(.*)$/i.test(effectivePrompt)
    || (hasAttachments && /^\s*(?:images?\s*->\s*code|imagen\s+a\s+codigo|images?\s+to\s+code)\b/i.test(effectivePrompt))) {
    const imageAttachments = (state.attachments || []).filter((a) => isImageAttachment(a));
    appendUserWithImages(effectivePrompt, imageAttachments);
    rememberMessage("user", effectivePrompt, null, imageAttachments);
    try {
      const root = String(state.projectRoot || "").trim();
      const rest = effectivePrompt.replace(/^\s*(?:images?\s*->\s*code|imagen\s+a\s+codigo|images?\s+to\s+code)\b/i, "").trim();
      const profile = resolveActiveChatProfile({ prompt: effectivePrompt, isAgent: false, usesProjectTools: false }) || {};
      const out = await window.editcoreProject.imagesToCode({
        projectRoot: root,
        title: rest.slice(0, 80) || "UI from image",
        description: rest || "Scaffold desde brief visual",
        folder: "from-image",
        images: imageAttachments.map((a) => ({ dataUrl: a.dataUrl || a.url, name: a.name, mimeType: a.mimeType })),
        model: profile.model || state.model,
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        providerKey: profile.providerKey || profile.provider,
        forceVision: imageAttachments.length > 0,
      });
      appendMessage("assistant", `## Images → code (${out.mode || "scaffold"})\n\nCarpeta: \`${out.outDir}\`\n\n${(out.files || []).map((f) => `- \`${f}\``).join("\n")}${out.note ? `\n\n_${out.note}_` : ""}`);
      refreshProjectFilesFromDisk({ viewDir: out.outDir || "" });
    } catch (error) {
      appendMessage("assistant", `Images→code fallo: ${error?.message || error}`);
    }
    $("prompt").value = "";
    state.attachments = [];
    renderAttachments();
    updateSendButtonState();
    return;
  }

  if (!hasAttachments && /^\s*(?:images?\s*->\s*code|imagen\s+a\s+codigo|images?\s+to\s+code)\b(.*)$/i.test(effectivePrompt)) {
    // handled above
  }

  if (!hasAttachments && /^\s*auto\s*docs\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const out = await window.editcoreProject.autoDocs({ projectRoot: root });
      appendMessage("assistant", `## Auto docs\n\n${(out.files || []).map((f) => `- \`${f}\``).join("\n")}`);
      refreshProjectFilesFromDisk({ viewDir: "docs" });
    } catch (error) {
      appendMessage("assistant", `AUTO DOCS fallo: ${error?.message || error}`);
    }
    return;
  }

  if (!hasAttachments && /^\s*docker\s+playbook(?:\s+(\w+))?\s*$/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    try {
      const root = String(state.projectRoot || "").trim();
      const id = (effectivePrompt.match(/^\s*docker\s+playbook(?:\s+(\w+))?\s*$/i) || [])[1] || "node";
      if (id === "list") {
        const listed = await window.editcoreProject.dockerPlaybook({ list: true });
        appendMessage("assistant", `## Docker playbooks\n\n${(listed.playbooks || []).map((p) => `- \`${p.id}\`: ${p.name}`).join("\n")}`);
      } else {
        const out = await window.editcoreProject.dockerPlaybook({ projectRoot: root, playbook: id });
        appendMessage("assistant", [
          `## Docker playbook · ${out.name}`,
          "",
          `Salida: \`${out.outDir}\``,
          "",
          "Checklist:",
          ...(out.checklist || []).map((c) => `- \`${c}\``),
        ].join("\n"));
        refreshProjectFilesFromDisk({ viewDir: ".editcore/playbooks" });
      }
    } catch (error) {
      appendMessage("assistant", `DOCKER PLAYBOOK fallo: ${error?.message || error}`);
    }
    return;
  }

  // Welcome / projectRoot vacio: rehidratar activo antes de switch / missingProject.
  if (!String(state.projectRoot || "").trim()) {
    await ensureActiveProjectBound(effectivePrompt);
  }

  let project = activeProject();
  if (!hasAttachments && ProjectAnalysis.isProjectIntentComment(effectivePrompt) && agentTaskIsLive()) {
    await cancelActiveResponse();
  }
  if (!hasAttachments && ProjectAnalysis.isSwitchProjectRequest?.(effectivePrompt)) {
    $("prompt").value = "";
    updateSendButtonState();
    await handleSwitchProjectFromPrompt(effectivePrompt);
    return;
  }
  if (!hasAttachments && ProjectAnalysis.isCloseProjectRequest?.(effectivePrompt)) {
    $("prompt").value = "";
    updateSendButtonState();
    await handleCloseProjectFromPrompt(effectivePrompt);
    return;
  }
  // Solo "abre X" puro corta el chat. Si hay analisa/revisa/reporte, se abre en silencio y SIGUE el agente.
  // Pedidos "analiza unicamente package.json" NUNCA deben cambiar el proyecto abierto.
  const scopedDiskOnly = ProjectAnalysis.isScopedDiskFileRequest?.(effectivePrompt) === true;
  const pureOpen = !scopedDiskOnly && ProjectAnalysis.isPureOpenProjectRequest?.(effectivePrompt) === true;
  const workWithNamedProject = !scopedDiskOnly && !pureOpen && (
    Boolean(ProjectAnalysis.extractReferencedProjectName?.(effectivePrompt))
    || (ProjectAnalysis.isOpenNamedProjectRequest?.(effectivePrompt)
      && /\b(analiza|audita|diagnostica|revisa|explora|corrige|crea|implementa|arregla|fix|reporte|hallazgos)\b/i.test(effectivePrompt))
  );
  if (!hasAttachments && pureOpen) {
    $("prompt").value = "";
    updateSendButtonState();
    const result = await openNamedProjectFromPrompt(effectivePrompt, { silent: false, continueWork: false });
    if (result?.handled !== false) return;
  }
  if (!hasAttachments && workWithNamedProject) {
    const currentRoot = normalizeProjectRoot(state.projectRoot || activeProject()?.projectRoot || "");
    const resolved = await resolveProjectRootFromPrompt(effectivePrompt);
    const targetRoot = normalizeProjectRoot(resolved.root || "");
    // Nunca sustituir el proyecto abierto por una "ruta" inventada desde prosa del chat.
    const targetLooksReal = Boolean(targetRoot)
      && (/^[a-z]:\\/i.test(targetRoot) || targetRoot.startsWith("\\\\"))
      && !/\b(qué contiene|si hay algo raro|correcci[oó]n concreta|porque|porqu[eé])\b/i.test(targetRoot);
    if (targetLooksReal && targetRoot !== currentRoot) {
      // Verificar que la carpeta exista antes de abandonar el proyecto activo.
      let exists = false;
      try {
        await window.editcoreProject.list(targetRoot, "");
        exists = true;
      } catch {
        exists = false;
      }
      if (exists) {
        await openNamedProjectFromPrompt(effectivePrompt, { silent: true, continueWork: true });
        project = activeProject() || project;
      }
      // Si no existe, permanecer en el proyecto actual (no crear "porque").
    }
  }
  const selectedRunMode = $("runMode").value;
  const initialModeDecision = ProjectAnalysis.resolveExecutionMode(effectivePrompt, {
    requestedAgent: selectedRunMode === "agent",
    projectOpen: Boolean(state.projectRoot || project?.projectRoot),
    resumableTask: hasResumableAgentTask(project),
    workflowPhase: project?.agentWorkflow?.phase || "",
  });
  if (initialModeDecision.missingProject) {
    // Auto-bind: storage / recientes / nombre / EDITCOREAI — sin pedir Abrir si hay candidato.
    const rebound = await ensureActiveProjectBound(effectivePrompt);
    project = activeProject() || project;
    if (rebound && String(state.projectRoot || project?.projectRoot || "").trim()) {
      // Continuar el turno con el workspace rehidratado.
    } else {
      const named = ProjectAnalysis.extractReferencedProjectName?.(effectivePrompt) || "";
      if (named) {
        const opened = await openNamedProjectFromPrompt(effectivePrompt, { silent: true, continueWork: true });
        if (!opened?.opened) {
          appendUserWithImages(effectivePrompt, []);
          rememberMessage("user", effectivePrompt);
          const response = `No encontre el proyecto "${named}". Usa Abrir o escribe la ruta.`;
          const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
          append("assistant", response, usage, true, 0);
          rememberMessage("assistant", response, usage);
          $("status").textContent = "Proyecto no encontrado";
          updateSendButtonState();
          return;
        }
        project = opened.project || activeProject() || project;
      } else {
        appendUserWithImages(effectivePrompt, []);
        rememberMessage("user", effectivePrompt);
        const response = "Abre un proyecto (boton Abrir) o indica su nombre. El chat mostrara el progreso del analisis; la ruta queda en la barra de estado.";
        const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0, estimated_input_tokens: 0, estimated_output_tokens: 0 };
        append("assistant", response, usage, true, 0);
        rememberMessage("assistant", response, usage);
        notifyVoiceAssistant(response);
        $("prompt").value = "";
        $("status").textContent = "Falta proyecto";
        updateSendButtonState();
        return;
      }
    }
  }
  project = activeProject() || project;
  const intent = classifyPromptIntent(effectivePrompt);
  const requestsLocalProjectWork = Boolean(state.projectRoot || project?.projectRoot)
    && ["analysis", "task"].includes(intent)
    && /\b(proyecto|carpeta|archivo|c[o\u00f3]digo|workspace|repositorio|repo|aplicaci[o\u00f3]n|app)\b/i.test(effectivePrompt);
  const agentTaskLive = hasResumableAgentTask(project)
    || project?.agentWorkflow?.phase === "executing"
    || [...activePromptRequests.values()].some((job) => job.isAgent && job.agentExecuting);
  if (!hasAttachments && /^[?¿!\s]{1,4}$/.test(effectivePrompt.trim()) && agentTaskLive) {
    effectivePrompt = "Continua la tarea activa. Explica en que paso vas y sigue ejecutando desde la evidencia guardada.";
  } else if (!hasAttachments && project && ProjectAnalysis.isAgentTaskFeedback(effectivePrompt)
    && project.agentWorkflow?.phase === "awaiting_authorization") {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = agentWorkflowStatusText(project.agentWorkflow);
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Tarea pendiente de autorizacion";
    updateSendButtonState();
    return;
  } else if (!hasAttachments && project && ProjectAnalysis.isTaskStatusQuestion(effectivePrompt) && agentTaskLive) {
    // Solo atajo local si hay corrida REAL en curso. READY/queue vacío → deja pasar al agente.
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = await durableAgentWorkflowStatusText(project);
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Estado de corrida activa";
    updateSendButtonState();
    return;
  }
  // Preguntas "qué pasó / qué hiciste": en Agente o Acceso completo NO usar atajo local;
  // el modelo/agente debe razonar (evita plantillas CONTINUA/PROCEDE).
  if (!hasAttachments && project
    && state.mode !== "agent"
    && state.permissionMode !== "full"
    && (hasResumableAgentTask(project) || project.agentWorkflow?.task || project.analysisMemory)
    && !isAgentAuthorization(effectivePrompt)
    && !ProjectAnalysis.isFreshAnalysisRequest(effectivePrompt)
    && ProjectAnalysis.isAgentWorkflowQuestion(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    let response;
    try {
      response = await answerAgentWorkflowQuestion(project, effectivePrompt);
    } catch (error) {
      response = `${ProjectAnalysis.workflowQuestionContext(project.agentWorkflow, project.analysisMemory)}\n\nNo pude consultar al modelo: ${error?.message || error}`;
    }
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Pregunta respondida";
    updateSendButtonState();
    return;
  }
  let analysisRepairAuthorization = false;
  const userAuthorized = isAgentAuthorization(effectivePrompt);
  const userVisiblePrompt = String(effectivePrompt || "").trim();
  const queuedImages = [...(state.attachments || []).filter((a) => isImageAttachment(a))];
  // Pintar PROCEDE/HAZLO al instante (antes de awaits / cancelaciones).
  let userBubblePainted = false;
  if (userVisiblePrompt || queuedImages.length) {
    appendUserMessageImmediate(userVisiblePrompt || "Imagen adjunta", queuedImages);
    userBubblePainted = true;
    $("prompt").value = "";
    updateSendButtonState();
  }
  if (userAuthorized && project) await ensureWorkflowFromPendingPlan(project, effectivePrompt);
  if (!hasAttachments && project?.analysisMemory && userAuthorized && !hasResumableAgentTask(project)) {
    analysisRepairAuthorization = true;
    // Instrucción limpia: preferir la tarea pendiente original; si no, solo "PROCEDE".
    const pendingGoal = String(
      project.agentWorkflow?.task
      || project.durableWorkflow?.goal
      || project.analysisMemory?.originalRequest
      || "",
    ).trim();
    effectivePrompt = analysisRepairPrompt(project.analysisMemory, effectivePrompt);
  }
  const activeAgent = [...activePromptRequests.values()].find((job) =>
    (job.isAgent || job.usesProjectTools || job.runId)
      && normalizeProjectRoot(job.projectRoot) === normalizeProjectRoot(state.projectRoot)
  );
  const steeringRunId = activeAgent?.runId || activeAgent?.planRunId || (project?.agentWorkflow?.phase === "executing" ? project.agentWorkflow.runId : "");
  if (!hasAttachments && ProjectAnalysis.isUserStopInstruction(effectivePrompt)) {
    if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
    $("prompt").value = "";
    await hardStopFromChat("terminal-stop");
    const stopMsg = "Detenido.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", stopMsg, usage, true, 0);
    rememberMessage("assistant", stopMsg, usage);
    $("status").textContent = "Detenido";
    updateSendButtonState();
    return;
  }
  if (steeringRunId && !hasAttachments && ProjectAnalysis.shouldSteerLiveAgent(effectivePrompt)) {
    if (isMetaChatCommand(effectivePrompt)) {
      if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
      const response = "Entendido. No lanzo herramientas. ¿Qué necesitas exactamente?";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
      $("prompt").value = "";
      updateSendButtonState();
      return;
    }
    const result = await window.editcoreAgent.steer({ instruction: effectivePrompt, runId: steeringRunId });
    if (result?.cancelled) {
      if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
      $("prompt").value = "";
      await hardStopFromChat("steered-stop");
      const stopMsg = "Detenido.";
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", stopMsg, usage, true, 0);
      rememberMessage("assistant", stopMsg, usage);
      $("status").textContent = "Detenido";
      updateSendButtonState();
      return;
    }
    if (result?.accepted) {
      if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
      updateSteeringUI(effectivePrompt, steeringRunId, Number(result.pendingDirections) || 1, result.interrupted === true);
      $("prompt").value = "";
      updateSendButtonState();
      return;
    }
  }
  if (!hasAttachments && $("runMode").value === "agent" && state.permissionMode !== "full" && isAgentStatusQuestion(effectivePrompt) && hasResumableAgentTask(project)) {
    if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
    const response = agentWorkflowStatusText(project.agentWorkflow);
    const usage = { local_response: true, input_tokens: 0, output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("prompt").value = "";
    $("status").textContent = project.agentWorkflow.phase === "interrupted" ? "Tarea interrumpida disponible para reanudar" : "Estado del agente actualizado";
    updateSendButtonState();
    return;
  }
  if (isChatModelAutoMode()) await refreshModelCapabilities();
  const job = buildPromptJob(effectivePrompt);
  if (!job) {
    $("prompt").value = "";
    updateSendButtonState();
    return;
  }
  job.displayPrompt = userVisiblePrompt || ProjectAnalysis.redactCredentials(job.prompt);
  job.userMessageDisplayed = userBubblePainted === true;
  if (userAuthorized && isPlanAuthorizedExecution(project, prompt, job.isAgent)) {
    job.planAuthorizedExecution = true;
  }
  if (job.isAgent && typeof ProjectAnalysis.hasConcreteAuthorizedTask === "function"
    && ProjectAnalysis.hasConcreteAuthorizedTask(effectivePrompt)) {
    // PROCEDE + tarea concreta: ejecutar ESE pedido, no reanudar plan forense viejo.
    job.planAuthorizedExecution = true;
    job.concreteAuthorizedTask = true;
  }
  if (job.isAgent && userAuthorized) {
    job.userAuthorized = true;
  }
  if (job.autoEscalatedAgent) {
    $("runMode").value = "agent";
    updateSendButtonState();
    $("status").textContent = "Solicitud de cambio enviada al Agente";
  }
  if (analysisRepairAuthorization) {
    job.continueAuthorized = true;
    job.planAuthorizedExecution = true;
    job.directReadOnly = false;
    job.readOnlyChat = false;
    job.requireEvidence = true;
    job.analysisContext = ProjectAnalysis.analysisContext(project.analysisMemory);
    job.authorizationSource = "analysisMemory";
  }
  // PROCEDE cancela corrida previa solo si hay plan autorizado de correccion.
  // CONTINUA a mitad NO debe matar el thinking (borra el analisis del chat).
  if (job.planAuthorizedExecution && hasResumableAgentTask(project)
    && project?.agentWorkflow?.phase === "awaiting_authorization") {
    const liveThinking = document.querySelector(".thinking-msg");
    if (liveThinking) {
      const snap = extractThinkingNarrativeFallback(liveThinking) || String(liveThinking._streamBuffer || "");
      if (snap) rememberMessage("assistant", snap);
    }
    await cancelProjectAgentJobs(state.projectRoot);
  }
  const fingerprint = promptJobFingerprint(job);
  const duplicate = !job.planAuthorizedExecution && !job.userAuthorized && !isAgentAuthorization(effectivePrompt) && (
    pendingPromptFingerprints.has(fingerprint)
    || [...activePromptRequests.values(), ...promptQueue].some((candidate) => promptJobFingerprint(candidate) === fingerprint)
  );
  if (duplicate) {
    if (!userBubblePainted) {
      appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
    }
    $("prompt").value = "";
    $("status").textContent = `La solicitud ya esta en ejecucion con ${job.model}; no se duplico.`;
    updateSendButtonState();
    return;
  }
  // Las preguntas de propuesta / mejoras deben ser respondidas por el LLM con razonamiento real, no con plantillas estáticas locales de 0s
  if (!hasAttachments && false && ProjectAnalysis.isProposalFollowUp?.(effectivePrompt)) {
    if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
    const hydrated = ProjectAnalysis.hydrateAnalysisMemoryFromSources?.(project?.analysisMemory, {
      history: state.history || [],
      workflow: project?.agentWorkflow || project?.durableWorkflow || null,
      projectName: projectDisplayName(project),
      projectRoot: state.projectRoot || project?.projectRoot || "",
    }) || project?.analysisMemory || null;
    if (hydrated && ProjectAnalysis.isUsefulAnalysisMemory?.(hydrated)) {
      project.analysisMemory = hydrated;
      project.lastAnalysis = hydrated;
      saveProjects({ immediate: true });
    }
    const response = ProjectAnalysis.proposalFromAnalysisMemory(hydrated || {});
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0, estimated_input_tokens: 0, estimated_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("prompt").value = "";
    $("status").textContent = ProjectAnalysis.isUsefulAnalysisMemory?.(hydrated)
      ? "Propuesta desde memoria de analisis · 0 tokens de API"
      : "Sin memoria de analisis util · pide un analisis primero";
    updateSendButtonState();
    return;
  }
  if (!hasAttachments && project?.analysisMemory && ProjectAnalysis.isAnalysisFollowUp(effectivePrompt, true)
    && !ProjectAnalysis.isFreshAnalysisRequest(effectivePrompt)
    && !/\b(?:profundo|completo|todo\s+el\s+proyecto|reanaliza|desde\s+cero)\b/i.test(effectivePrompt)
    && /\b(?:reporte|resultado|hallazgos|an[aá]lisis)\b/i.test(effectivePrompt)
    && !/\b(?:haz(?:me)?|quiero|necesito|entregame|dame)\b/i.test(effectivePrompt)) {
    if (!userBubblePainted) appendUserMessageImmediate(userVisiblePrompt || effectivePrompt, []);
    const response = project.analysisMemory.resultSummary
      || "El analisis anterior no dejo un reporte persistido. Ejecuta un nuevo analisis en modo Agente para generar evidencia verificable.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0, estimated_input_tokens: 0, estimated_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("prompt").value = "";
    $("status").textContent = "Reporte recuperado desde la memoria del proyecto · 0 tokens de API";
    updateSendButtonState();
    return;
  }

  pendingPromptFingerprints.add(fingerprint);
  try {
    const resumableTaskId = project?.agentWorkflow?.taskId || project?.durableWorkflow?.taskId || "";
    const explicitContinuation = job.isAgent
      && !job.directReadOnly
      && hasResumableAgentTask(project)
      && (job.planAuthorizedExecution || job.resumeAuthorized || isAgentAuthorization(job.prompt) || job.continueAuthorized);
    if (explicitContinuation && resumableTaskId) job.taskId = resumableTaskId;
    if (job.planAuthorizedExecution) {
      job.executionMode = "AUTHORIZED_PLAN";
      job.taskId = resumableTaskId || job.taskId || "";
      job.planId = project?.agentWorkflow?.planId || project?.durableWorkflow?.planId || "";
    }
    if (job.usesProjectTools && !job.taskId && window.editcoreTasks && !job.directReadOnly && !job.planAuthorizedExecution) {
      const durable = await window.editcoreTasks.create({
        projectId: job.projectId, projectRoot: job.projectRoot, goal: ProjectAnalysis.redactCredentials(job.prompt),
        originalRequest: { prompt: ProjectAnalysis.redactCredentials(job.prompt), images: (job.images || []).map(({ name, mimeType }) => ({ name, mimeType })), documents: (job.documents || []).map(({ name, mimeType }) => ({ name, mimeType })) },
        status: "READY", currentStage: "queue",
        nextAction: { type: "QUEUE", description: "Esperar turno para iniciar el agente.", status: "WAITING" },
      });
      job.taskId = durable.taskId;
    }
    if (job.usesProjectTools && !ProjectAnalysis.isAuthorization(effectivePrompt)) {
      await persistAgentOriginalRequest(project, effectivePrompt, { taskId: job.taskId || project?.agentWorkflow?.taskId || "" });
    }
    const visiblePrompt = ProjectAnalysis.redactCredentials(job.displayPrompt || userVisiblePrompt || job.prompt);
    if (!job.userMessageDisplayed) {
      appendUserWithImages(visiblePrompt, job.images || []);
      rememberMessage("user", visiblePrompt, null, job.images || [], job.documents || []);
      job.userMessageDisplayed = true;
    }
    if (job.autoEscalatedAgent && !job.orchestratorPlan?.listOnly && !job.listOnly) {
      const routingNotice = [
        `Destino: ${projectDisplayName(project)}`,
        "Modo: Agente",
        "La solicitud requiere cambios; analizare el proyecto con herramientas antes de ejecutar.",
      ].join("\n");
      job.routingNotice = routingNotice;
    } else if ((job.orchestratorPlan?.listOnly || job.listOnly) && job.isAgent) {
      const listingNotice = [
        `Destino: ${projectDisplayName(project)}`,
        "Modo: Listado",
        "Solo listare el contenido pedido (sin analisis forense ni correcciones).",
      ].join("\n");
      job.listingNotice = listingNotice;
    }
    job.userMessageDisplayed = true;
    promptQueue.push(job);
    $("prompt").value = "";
    state.attachments = [];
    renderAttachments();
    renderPromptQueue();
    updateSendButtonState();
    processPromptQueue().catch((error) => {
      $("status").textContent = error?.message || String(error);
    });
  } finally {
    pendingPromptFingerprints.delete(fingerprint);
  }
}

function promptJobFingerprint(job = {}) {
  const prompt = String(job.prompt || "").trim().replace(/\s+/g, " ").toLowerCase();
  const attachments = [...(job.images || []), ...(job.documents || [])]
    .map((item) => `${item.name || ""}:${item.mimeType || ""}`)
    .sort()
    .join("|");
  const authExec = job.planAuthorizedExecution ? "authorized-exec" : "";
  return [job.usesProjectTools ? "tools" : "chat", job.isAgent ? "write" : "read", job.projectId || job.projectRoot || "", job.providerKey || "", job.model || "", prompt, attachments, authExec].join("::");
}

function buildPromptJob(prompt) {
  const autoMode = isChatModelAutoMode();
  const requestedAgent = $("runMode").value === "agent";
  const project = activeProject();
  const workflowPhase = project?.agentWorkflow?.phase || "";
  const resumableTask = hasResumableAgentTask(project);

  const pathHints = typeof ProjectAnalysis.extractAbsolutePathHints === "function"
    ? ProjectAnalysis.extractAbsolutePathHints(prompt)
    : [];
  const ephemeralRoot = !state.projectRoot && pathHints.length
    ? String(pathHints[0] || "").trim()
    : "";
  if (ephemeralRoot && /(?:enlista|listar?|listado)/i.test(prompt)) {
    state.lastListedRoot = ephemeralRoot;
  }
  const effectiveProjectRoot = state.projectRoot || ephemeralRoot || "";

  const modeDecision = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent,
    projectOpen: Boolean(effectiveProjectRoot),
    resumableTask,
    workflowPhase,
  });
  const isAgent = modeDecision.isAgent;
  const planAuthorizedExecution = isPlanAuthorizedExecution(project, prompt, isAgent);
  const resumableExecutable = resumableTask && ["interrupted", "executing", "awaiting_authorization"].includes(workflowPhase);
  const userAuthPrompt = isAgentAuthorization(prompt);
  const authorizedContinuation = planAuthorizedExecution
    || (isAgent && resumableTask && userAuthPrompt)
    || (isAgent && resumableExecutable
      && (userAuthPrompt || ProjectAnalysis.isRecoveryInstruction(prompt) || ProjectAnalysis.isAgentTaskFeedback(prompt)));

  if (!AgentOrchestrator?.resolveUnifiedAgentPlan) {
    $("status").textContent = "Error interno: orquestador no cargado";
    return null;
  }

  const plan = AgentOrchestrator.resolveUnifiedAgentPlan({
    prompt,
    requestedAgent,
    projectOpen: Boolean(effectiveProjectRoot),
    permissionMode: state.permissionMode,
    allowWrite: state.permissionMode !== "readonly",
    cursorParityEnabled: loadJson("editcore-cursor-parity", true) !== false,
    resumableTask: Boolean(state.projectRoot) && resumableTask,
    workflowPhase: state.projectRoot ? workflowPhase : "",
    planAuthorizedExecution: Boolean(state.projectRoot) && planAuthorizedExecution,
    authorizedContinuation: Boolean(state.projectRoot) && authorizedContinuation,
    scaffoldIncomplete: Boolean(project?.scaffoldIncomplete),
    hasAttachments: state.attachments.length > 0,
    hasAnalysisMemory: Boolean(
      ProjectAnalysis.isUsefulAnalysisMemory?.(project?.analysisMemory || project?.lastAnalysis)
      || project?.analysisMemory
      || project?.lastAnalysis
    ),
  });

  if (plan.missingProject) {
    $("status").textContent = "Indica una ruta o abre un proyecto";
    return null;
  }

  const intent = classifyPromptIntent(prompt);
  const analysisMemory = (() => {
    const raw = project?.analysisMemory || project?.lastAnalysis || null;
    if (!ProjectAnalysis.hydrateAnalysisMemoryFromSources) return raw;
    const hydrated = ProjectAnalysis.hydrateAnalysisMemoryFromSources(raw, {
      history: state.history || [],
      workflow: project?.agentWorkflow || project?.durableWorkflow || null,
      projectName: projectDisplayName(project),
      projectRoot: state.projectRoot || project?.projectRoot || "",
    });
    if (hydrated && project && hydrated !== raw && ProjectAnalysis.isUsefulAnalysisMemory?.(hydrated)) {
      project.analysisMemory = hydrated;
      project.lastAnalysis = hydrated;
    }
    return hydrated || raw;
  })();

  const projectRequest = Boolean(state.projectRoot) && (
    ["analysis", "task"].includes(intent)
    || /\b(proyecto|carpeta|archivo|c[o\u00f3]digo|workspace|repositorio|repo|aplicaci[o\u00f3]n|app)\b/i.test(prompt)
  );
  const isConversationalGreeting = plan.conversationOnly === true
    || intent === "conversation"
    || (!projectRequest && !plan.isAgent && !["analysis", "task", "followup"].includes(intent) && Boolean(ProjectAnalysis.isCasualChat?.(prompt, { hasAnalysisMemory: Boolean(analysisMemory) })));

  const analysisContextExtra = (analysisMemory && !isConversationalGreeting && (plan.isAgent || projectRequest || ["analysis", "task", "followup"].includes(intent)))
    ? [
      ProjectAnalysis.analysisContext(analysisMemory),
      "CONTINUIDAD: Si el usuario pide propuesta/por qué/qué sigue, usa la MEMORIA anterior; no digas que no hay análisis si hay resumen o archivos leídos.",
    ].join("\n")
    : "";
  const conversationHint = isConversationalGreeting
    ? "Responde de forma concisa, cordial y natural en español. No generes reportes técnicos ni resúmenes de código o análisis a menos que el usuario lo solicite explícitamente."
    : (plan.chatConversationHint || "");
  const readOnlyChat = !plan.isAgent && projectRequest;
  const continueAuthorized = plan.isAgent
    && !plan.directReadOnly
    && Boolean(state.projectRoot)
    && state.permissionMode === "full"
    && [...activePromptRequests.values()].some((job) => job.isAgent && job.projectRoot === (state.projectRoot || ""));

  const autoContext = {
    prompt,
    isAgent: plan.isAgent,
    usesProjectTools: plan.usesProjectTools,
    directReadOnly: plan.directReadOnly,
    planAuthorizedExecution: plan.planAuthorizedExecution,
    needsAnalysisFirst: plan.needsAnalysisFirst,
    requireAgentTools: Boolean(plan.isAgent && plan.usesProjectTools),
    hasAttachments: state.attachments.length > 0,
    hasImages: state.attachments.some((item) => isImageAttachment(item)),
  };
  let selectedProfile = resolveActiveChatProfile(autoContext);
  if (!selectedProfile) {
    $("status").textContent = autoMode ? "Auto: no hay modelos verificados" : "Selecciona un modelo verificado";
    alert(autoMode
      ? "No hay modelos verificados para Auto. Abre Modelos (⚙) y verifica al menos uno."
      : "Por favor, selecciona un modelo verificado. Abre Modelos (⚙) si necesitas configurar uno.");
    return null;
  }
  rememberAutoResolvedProfile(selectedProfile);

  let modelFields = PromptJobModel?.resolvePromptJobModelFields
    ? PromptJobModel.resolvePromptJobModelFields(selectedProfile, loadJson("editcore-providers", {}), PROVIDERS)
    : null;
  if (!modelFields?.apiKey) {
    openSettings();
    $("status").textContent = "Falta API key";
    alert("Falta configurar la API key para este modelo. Por favor, ingresa tu clave en el menú de Configuración.");
    return null;
  }

  // Auto + agente: si eligió un modelo solo-chat, forzar uno con tools del mismo scope.
  if (autoMode && plan.isAgent && plan.usesProjectTools
    && typeof AutoModel.isChatOnlyModel === "function"
    && AutoModel.isChatOnlyModel(modelFields.model)) {
    const fallback = findAgentCapableProfile({
      ...modelFields,
      providerProfileId: selectedProfile.id,
    }, `${modelFields.providerKey || modelFields.baseUrl}|${modelFields.model}`);
    if (fallback?.apiKey) {
      modelFields = fallback;
      selectedProfile = loadProviderProfiles().find((item) => item.id === fallback.providerProfileId) || selectedProfile;
      rememberAutoResolvedProfile(selectedProfile);
    }
  }

  // Mantener bóveda/formulario alineados con el modelo que Auto acaba de elegir.
  if (autoMode) {
    state.mode = inferChatModeFromModel(modelFields.model);
    void activateProvider({
      baseUrl: modelFields.baseUrl,
      apiKey: modelFields.apiKey,
      model: modelFields.model,
      providerKey: modelFields.providerKey,
      profileId: modelFields.providerProfileId || selectedProfile.id,
      preserveAuto: true,
    });
  }

  const {
    model,
    apiKey,
    baseUrl,
    providerKey: selectedProviderKey,
    providerProfileId: selectedProfileId,
  } = modelFields;

  const hasActiveRunningAgent = [...activePromptRequests.values()].some((j) => j.usesProjectTools || j.isAgent);
  return {
    id: uid(),
    prompt,
    isAgent: plan.isAgent,
    isSubAgent: hasActiveRunningAgent,
    autoEscalatedAgent: plan.autoEscalatedAgent || modeDecision.autoEscalatedAgent,
    usesProjectTools: plan.usesProjectTools,
    readOnlyChat,
    requireEvidence: plan.isAgent || projectRequest || ["analysis", "task"].includes(intent),
    intent,
    directReadOnly: plan.directReadOnly,
    resumeAuthorized: plan.authorizedContinuation,
    planAuthorizedExecution: plan.planAuthorizedExecution,
    needsAnalysisFirst: plan.needsAnalysisFirst,
    promptOnlyMode: plan.promptOnlyMode,
    listOnly: plan.listOnly === true,
    orchestratorPlan: plan,
    projectIntentComment: plan.conversationOnly,
    chatConversationHint: conversationHint,
    continueAuthorized,
    autoSelectedModel: autoMode,
    mode: inferChatModeFromModel(model),
    baseUrl,
    apiKey,
    model,
    projectRoot: effectiveProjectRoot,
    ephemeralRoot: Boolean(ephemeralRoot),
    projectId: activeProject()?.id || "",
    agentId: activeProject()?.activeAgentId || state.activeAgentId || "",
    allowWrite: state.permissionMode !== "readonly",
    permissionMode: state.permissionMode,
    cursorParityEnabled: loadJson("editcore-cursor-parity", true) !== false,
    providerKey: selectedProviderKey,
    providerProfileId: selectedProfileId,
    images: state.attachments.filter((a) => isImageAttachment(a)),
    documents: state.attachments.filter((a) => !isImageAttachment(a)),
    history: cleanHistoricalProjectMessages(state.history.filter((m) => m.role !== "system")),
    analysisContext: analysisContextExtra,
    queuedAt: Date.now(),
  };
}

function agentCapabilityKey(job) {
  return `${job.providerKey || job.baseUrl}|${job.model}`;
}

function findAgentCapableProfile(job, excludeKey = "") {
  const profiles = loadProviderProfiles().filter((item) => ["active", "enabled"].includes(item.status) && item.apiKey);
  const options = visibleChatModelOptions(verifiedChatModelOptions());
  const scope = isChatModelAutoMode() ? currentAutoProviderScope() : "";
  const inScope = (entryOrProfile) => {
    if (!scope) return true;
    const bucket = typeof AutoModel.entryUpstreamBucket === "function"
      ? AutoModel.entryUpstreamBucket(entryOrProfile)
      : String(entryOrProfile?.model || "").split("/")[0]?.toLowerCase();
    if (bucket === scope) return true;
    const key = String(entryOrProfile?.providerKey || "").toLowerCase();
    return key === scope;
  };
  for (const entry of options) {
    if (!inScope(entry)) continue;
    if (typeof AutoModel.isChatOnlyModel === "function" && AutoModel.isChatOnlyModel(entry.model)) continue;
    const key = agentCapabilityKey({ providerKey: entry.providerKey, baseUrl: entry.baseUrl, model: entry.model });
    if (!key || key === excludeKey || key === agentCapabilityKey(job)) continue;
    const cap = agentModelCapabilities.get(key);
    const profile = profiles.find((item) => item.id === entry.profileId && item.model === entry.model);
    if (!profile) continue;
    if (cap?.toolOK === false) continue;
    if (cap?.toolOK || profile.agentToolOK || profile.agentToolOK !== false) {
      const modelFields = PromptJobModel?.resolvePromptJobModelFields
        ? PromptJobModel.resolvePromptJobModelFields(profile, loadJson("editcore-providers", {}), PROVIDERS)
        : null;
      if (modelFields?.apiKey) return { ...modelFields, providerProfileId: profile.id };
    }
  }
  for (const profile of profiles) {
    if (!inScope(profile)) continue;
    if (typeof AutoModel.isChatOnlyModel === "function" && AutoModel.isChatOnlyModel(profile.model)) continue;
    if (profile.agentToolOK === false || profile.model === job.model) continue;
    const key = agentCapabilityKey({ providerKey: profile.providerKey, baseUrl: profile.baseUrl, model: profile.model });
    if (!key || key === excludeKey) continue;
    const modelFields = PromptJobModel?.resolvePromptJobModelFields
      ? PromptJobModel.resolvePromptJobModelFields(profile, loadJson("editcore-providers", {}), PROVIDERS)
      : null;
    if (modelFields?.apiKey) return { ...modelFields, providerProfileId: profile.id };
  }
  return null;
}

async function ensureAgentModelCapability(job) {
  const key = agentCapabilityKey(job);
  const profiles = loadProviderProfiles();
  const profile = profiles.find((item) => item.id === job.providerProfileId);
  const verifiedRecently = profile?.agentToolOK === true
    && Date.now() - Number(profile.agentVerifiedAt || 0) < 24 * 60 * 60 * 1000;
  if (verifiedRecently && !agentModelCapabilities.has(key)) {
    agentModelCapabilities.set(key, { chatOK: true, toolOK: true, cachedVerification: true });
  }
  if (!agentModelCapabilities.has(key)) {
    $("status").textContent = "Trabajando…";
    const result = await window.editcoreAgent.verifyModel({
      providerKey: job.providerKey,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      model: job.model,
      projectRoot: job.projectRoot || state.projectRoot,
    });
    agentModelCapabilities.set(key, result);
    if (profile) {
      profile.agentChatOK = Boolean(result?.chatOK);
      profile.agentToolOK = Boolean(result?.toolOK);
      profile.agentVerifiedAt = Date.now();
      await saveProviderProfiles(profiles);
    }
  }
  const result = agentModelCapabilities.get(key);
  if (!result?.chatOK) throw new Error(`${job.model} no responde por la API configurada: ${result?.error || "sin respuesta"}`);
  if (!result?.toolOK) {
    const originalModel = job.model;
    const fallback = findAgentCapableProfile(job, key);
    if (fallback) {
      job.model = fallback.model;
      job.apiKey = fallback.apiKey;
      job.baseUrl = fallback.baseUrl;
      job.providerKey = fallback.providerKey;
      job.providerProfileId = fallback.providerProfileId;
      if (typeof window.addLog === "function") {
        window.addLog("info", `Failover silencioso: ${originalModel} (solo chat) → ${fallback.model}`);
      }
      $("status").textContent = "Trabajando…";
      return ensureAgentModelCapability(job);
    }
    throw new Error(`${job.model} funciona para chat, pero no emitio herramientas de agente: ${result?.toolError || "formato incompatible"}`);
  }
  return result;
}

function renderPromptQueue() {
  const host = $("promptQueue");
  if (!host) return;
  host.replaceChildren();
  const activeRows = [...activePromptRequests.values()];
  const rows = activeRows.map((job) => ({ ...job, running: true }));
  rows.push(...promptQueue);
  host.classList.toggle("hidden", rows.length === 0);
  let queuedIndex = 0;
  rows.forEach((job) => {
    const row = document.createElement("div");
    row.className = `queue-chip ${job.running ? "running" : ""}`;
    const mode = job.isAgent ? "Agente" : "Chat";
    const label = document.createElement("span");
    label.className = "queue-chip-label";
    if (!job.running) queuedIndex += 1;
    label.textContent = job.running
      ? `${mode} ejecutando${countActiveAgents(activeRows) > 1 ? ` (${countActiveAgents(activeRows)}/${MAX_PARALLEL_AGENTS})` : ""}: ${job.prompt.slice(0, 96)}`
      : `${queuedIndex}. ${mode} despues: ${job.prompt.slice(0, 96)}`;
    row.appendChild(label);
    if (job.running) {
      const actions = document.createElement("span");
      actions.className = "queue-chip-actions";
      const resend = document.createElement("button");
      resend.type = "button";
      resend.textContent = "Reenviar";
      resend.onclick = () => resendPromptJob(job);
      actions.appendChild(resend);
      row.appendChild(actions);
    }
    if (!job.running) {
      const actions = document.createElement("span");
      actions.className = "queue-chip-actions";
      const targetAgent = activeRows.find((item) => item.isAgent && item.agentExecuting && item.projectRoot === job.projectRoot);
      if (targetAgent && job.isAgent && !(job.images || []).length) {
        const steer = document.createElement("button");
        steer.type = "button";
        steer.textContent = "Dirigir";
        steer.title = `Dirigir al agente que ejecuta: ${targetAgent.prompt.slice(0, 80)}`;
        steer.onclick = () => directQueuedPrompt(job, targetAgent);
        actions.appendChild(steer);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.title = "Eliminar de la cola";
      remove.setAttribute("aria-label", remove.title);
      remove.textContent = "×";
      remove.onclick = () => {
        if (job.taskId && window.editcoreTasks) window.editcoreTasks.cancel(job.taskId).catch(() => undefined);
        promptQueue = promptQueue.filter((item) => item.id !== job.id);
        renderPromptQueue();
      };
      actions.appendChild(remove);
      row.appendChild(actions);
    }
    host.appendChild(row);
  });
  updateSendButtonState();
}

function resendPromptJob(job) {
  const alreadyQueued = promptQueue.some((q) => !q.cancelled && q.prompt === job.prompt && q.projectId === job.projectId);
  const alreadyRunning = [...activePromptRequests.values()].some((q) => q.prompt === job.prompt && q.projectId === job.projectId);
  if (alreadyQueued || alreadyRunning) return;
  promptQueue.push({
    ...job,
    id: uid(),
    runId: "",
    running: false,
    cancelled: false,
    queuedAt: Date.now(),
    notBefore: Date.now(),
    userMessageDisplayed: true,
    taskId: "",
  });
  renderPromptQueue();
  processPromptQueue().catch((error) => { $("status").textContent = error?.message || String(error); });
}

async function directQueuedPrompt(job, targetAgent) {
  const images = job.images || [];
  const result = await window.editcoreAgent.steer({ instruction: job.prompt, images, documents: job.documents || [], runId: targetAgent?.runId || "" });
  if (!result?.accepted) {
    $("status").textContent = result?.reason || "No se pudo dirigir el agente";
    return;
  }
  promptQueue = promptQueue.filter((item) => item.id !== job.id);
  $("status").textContent = "Instruccion dirigida al agente activo";
  renderPromptQueue();
}

function updateSendButtonState() {
  const button = $("sendBtn");
  const stop = $("stopBtn");
  if (stop) {
    stop.hidden = true;
    stop.style.display = "none";
  }
  const running = activePromptRequests.size > 0 || promptQueue.some((item) => !item.cancelled);
  const hasDraft = Boolean($("prompt").value.trim()) || state.attachments.length > 0;
  const agentNeedsProject = $("runMode").value === "agent"
    && !state.projectRoot
    && !ProjectAnalysis.hasUsableAbsolutePath?.($("prompt").value || "");
  const showStop = running && !hasDraft;

  if (!button) return;
  button.classList.toggle("stop-mode", showStop);
  button.dataset.mode = showStop ? "stop" : "send";
  if (showStop) {
    button.title = `Detener ${Math.max(activePromptRequests.size, 1)} tarea(s)`;
    button.innerHTML = "&#9632;";
    button.disabled = false;
  } else if (agentNeedsProject) {
    button.title = hasDraft ? "Indica una ruta absoluta o abre un proyecto" : "Enviar";
    button.innerHTML = "&#10148;";
    button.disabled = !hasDraft;
  } else if (running) {
    button.title = "Enviar otra instrucción al agente";
    button.innerHTML = "&#10148;";
    button.disabled = !hasDraft;
  } else {
    button.title = "Enviar";
    button.innerHTML = "&#10148;";
    button.disabled = !hasDraft;
  }
  button.setAttribute("aria-label", button.title);
}

function setRunningControls() {
  updateSendButtonState();
}

function throwIfJobCancelled(job) {
  if (job.cancelled && job.cancelRequestedBy) {
    const error = new Error("Cancelado por el usuario.");
    error.code = "USER_CANCELLED";
    throw error;
  }
}

async function cancelActiveResponse() {
  promptQueue = [];
  forceKillAllAgentUi("Detenido.");

  for (const [requestId, card] of pendingAgentApprovalCards.entries()) {
    try {
      card.settle?.(false);
      await window.editcoreAgent.respondApproval({ requestId, approved: false }).catch(() => false);
    } catch {}
  }
  pendingAgentApprovalCards.clear();

  const active = [...activePromptRequests.values()];
  const runIds = new Set();
  const now = Date.now();
  active.forEach((job) => {
    job.cancelled = true;
    job.cancelRequestedAt = now;
    job.cancelRequestedBy = "stop-button";
    job.agentExecuting = false;
    if (job.runId) runIds.add(job.runId);
    if (job.planRunId) runIds.add(job.planRunId);
  });

  const project = activeProject();
  if (project?.agentWorkflow?.runId) runIds.add(project.agentWorkflow.runId);

  await Promise.all([
    ...[...runIds].map((id) => window.editcoreAgent.cancel({ runId: id }).catch(() => false)),
    window.editcoreAgent.cancel({ runId: "" }).catch(() => false),
    window.editcoreChat.cancel().catch(() => false),
  ]);
  forceKillAllAgentUi("Detenido.");
  renderPromptQueue();
  setRunningControls();
  if ($("status")) $("status").textContent = "Detenido.";
}

function countActiveAgents(active = []) {
  return active.filter((job) => job.usesProjectTools).length;
}

function canLaunchParallelAgent(next, active = []) {
  if (!next?.usesProjectTools) return false;
  // Candado: un solo agente con tools por projectRoot (evita 2º agente ciego).
  const nextRoot = normalizeProjectRoot(next.projectRoot || "");
  const nextWrite = next.isAgent && !next.directReadOnly && !next.readOnlyChat;
  const sameProject = active.some((job) => job.usesProjectTools && job.isAgent && !job.directReadOnly && !job.readOnlyChat
    && normalizeProjectRoot(job.projectRoot || "") === nextRoot);
  if (sameProject && !next.isSubAgent && nextWrite) return false;
  return countActiveAgents(active) < MAX_PARALLEL_AGENTS;
}

function canLaunchPromptJob(next, active = []) {
  if (next.usesProjectTools) return canLaunchParallelAgent(next, active);
  return active.filter((job) => !job.usesProjectTools).length < MAX_PARALLEL_AGENTS;
}

async function processPromptQueue() {
  if (!promptProcessorRunning) promptProcessorRunning = true;
  let launched = true;
  while (launched && promptQueue.length) {
    launched = false;
    const next = promptQueue[0];
    if (Number(next.notBefore || 0) > Date.now()) {
      setTimeout(() => processPromptQueue().catch((error) => { $("status").textContent = error?.message || String(error); }), Number(next.notBefore) - Date.now());
      break;
    }
    const active = [...activePromptRequests.values()];
    if (!canLaunchPromptJob(next, active)) break;
    const job = { ...promptQueue.shift(), cancelled: false, runId: next.runId || uid() };
    activePromptRequests.set(job.id, job);
    const task = executePromptJob(job).finally(() => {
      activePromptRequests.delete(job.id);
      activePromptTasks.delete(job.id);
      if (!activePromptRequests.size && !promptQueue.length) promptProcessorRunning = false;
      renderPromptQueue();
      setRunningControls();
      processPromptQueue().catch((error) => { $("status").textContent = error?.message || String(error); });
    });
    activePromptTasks.set(job.id, task);
    launched = true;
    renderPromptQueue();
    setRunningControls();
    const parallelCount = countActiveAgents([...activePromptRequests.values()]);
    if (parallelCount > 1) {
      $("status").textContent = `${parallelCount} agentes en paralelo (max ${MAX_PARALLEL_AGENTS})`;
    }
  }
}

function mergeAgentSegmentUsage(rows = []) {
  const merged = { ...(rows.at(-1) || {}) };
  const sumKeys = [
    "confirmed_input_tokens", "confirmed_output_tokens", "prompt_tokens", "completion_tokens",
    "estimated_input_tokens", "estimated_output_tokens", "provider_cache_read_tokens",
    "provider_calls", "request_input_tokens_estimate", "net_input_tokens_estimate",
    "context_compaction_count", "local_cache_hits", "local_cache_saved_estimated_tokens",
    "tool_cache_hits", "external_calls_avoided",
  ];
  for (const key of sumKeys) merged[key] = rows.reduce((sum, item) => sum + Number(item?.[key] || 0), 0);
  merged.peak_request_input_tokens_estimate = rows.reduce((max, item) => Math.max(max, Number(item?.peak_request_input_tokens_estimate || 0)), 0);
  merged.auto_resume_count = Math.max(0, rows.length - 1);
  return merged;
}

const MAX_AUTO_RESUME_SEGMENTS = 3;

async function runAgentUntilSettled(input, { targetRun, thinking, runAgent = window.editcoreAgent.run, job = null }) {
  const usageRows = [];
  let result = null;
  let segment = 0;
  while (true) {
    if (job) throwIfJobCancelled(job);
    segment += 1;
    const sessionUsage = mergeAgentSegmentUsage(usageRows);
    result = await runAgent({
      ...input,
      taskId: result?.taskId || input.taskId || targetRun?.taskId || "",
      resume: Boolean(input.resume) || segment > 1,
      resumeSteps: segment > 1 ? (result?.steps || input.resumeSteps || []) : (input.resumeSteps || []),
      segmentId: segment,
      sessionProviderCalls: Number(sessionUsage.provider_calls || 0),
      sessionNetInputTokens: Number(sessionUsage.net_input_tokens_estimate || 0),
    });
    if (result.usage) usageRows.push(result.usage);
    if (targetRun && result.taskId) targetRun.taskId = result.taskId;
    if (job) throwIfJobCancelled(job);
    if (result.report?.completed
      || result.report?.awaitingAuthorization === true
      || result.report?.outcome === "awaiting_authorization"
      || ProjectAnalysis.isPendingAnalysisPlan?.(String(result.text || ""))
      || result.report?.autoResumeRecommended !== true) break;
    // FOCO acotado: un segmento basta (no reabrir 3 veces el modelo).
    if (input?.scopedDiskFocus === true || input?.runProfile?.scopedDiskFocus === true
      || ProjectAnalysis.isScopedDiskFileRequest?.(input?.prompt || "") === true) {
      break;
    }
    if (segment >= MAX_AUTO_RESUME_SEGMENTS) break;
    if (targetRun) {
      targetRun.phase = "executing";
      targetRun.autoResumeCount = segment;
      targetRun.updatedAt = Date.now();
    }
    saveProjects();
    setThinkingStatus(thinking, `Compactando memoria y continuando desde el checkpoint (${segment + 1})...`);
    $("status").textContent = "Agente continuando desde el checkpoint durable...";
  }
  if (!result) throw new Error("El agente no inicio la ejecucion.");
  result.usage = mergeAgentSegmentUsage(usageRows);
  const hitResumeCeiling = segment >= MAX_AUTO_RESUME_SEGMENTS
    && result.report?.completed !== true
    && result.report?.autoResumeRecommended === true;
  result.report = {
    ...(result.report || {}),
    autoResumeCount: Math.max(0, usageRows.length - 1),
    autoResumeLimitReached: hitResumeCeiling,
  };
  return result;
}

async function executePromptJob(job) {
  const prompt = job.prompt;
  const isAgent = job.isAgent;
  const usesProjectTools = job.usesProjectTools;
  if (isAgent && !job.projectRoot) {
    const hints = typeof ProjectAnalysis.extractAbsolutePathHints === "function"
      ? ProjectAnalysis.extractAbsolutePathHints(job.prompt || prompt)
      : [];
    const fromPrompt = String(hints[0] || "").trim();
    if (fromPrompt) {
      if (state.permissionMode !== "full" && job.permissionMode !== "full") {
        throw new Error("Para usar una ruta sin proyecto abierto, activa Acceso completo.");
      }
      job.projectRoot = fromPrompt;
      job.ephemeralRoot = true;
    } else {
      // Nunca abrir el dialogo de carpeta automaticamente: el usuario debe Abrir o escribir la ruta.
      throw new Error("Indica una ruta absoluta (ej. D:\\PROGRAMAS IA) con Acceso completo, o abre un proyecto.");
    }
  }
  if (job.ephemeralRoot && state.permissionMode !== "full" && job.permissionMode !== "full") {
    throw new Error("Para usar una ruta sin proyecto abierto, activa Acceso completo.");
  }
  // La carpeta catalogo (D:\PROGRAMAS IA) no se abre como "proyecto UI", pero SI puede
  // usarse como raiz efimera cuando el usuario la pide con Acceso completo.
  if (
    isAgent
    && !job.ephemeralRoot
    && normalizeProjectRoot(job.projectRoot) === normalizeProjectRoot(projectCatalogParent())
  ) {
    throw new Error("El agente necesita un proyecto concreto. Abre uno desde Proyectos o con el boton Abrir.");
  }

  const pendingAuthorization = isAgent && isAgentAuthorization(prompt);
  const projectForJob = state.projects.find((item) => item.id === job.projectId)
    || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(job.projectRoot))
    || activeProject();

  const outgoingImages = job.images || [];
  const documents = job.documents || [];
  if (!job.userMessageDisplayed) {
    const visiblePrompt = ProjectAnalysis.redactCredentials(job.displayPrompt || job.prompt);
    appendUserWithImages(visiblePrompt, job.images || []);
    rememberMessage("user", visiblePrompt, null, job.images || [], job.documents || []);
    job.userMessageDisplayed = true;
  }

  const showAgentLog = Boolean(isAgent || usesProjectTools);
  const parallelLabel = showAgentLog && (activePromptRequests.size > 0 || promptQueue.some((item) => item.usesProjectTools))
    ? String(prompt).replace(/\s+/g, " ").trim().slice(0, 42)
    : "";
  const thinkingStart = usesProjectTools
    ? (isAgent ? "Preparando herramientas..." : "Preparando analisis...")
    : "Pensando...";
  const thinking = appendThinking(thinkingStart, showAgentLog, parallelLabel);
  const stopTimer = showAgentLog ? startResponseTimer(thinking.querySelector(".msg-head")) : () => 0;
  let elapsedSeconds = 0;
  if (showAgentLog) {
    job.runId = job.runId || uid();
    thinking._runId = job.runId;
    if (thinking.dataset) thinking.dataset.runId = job.runId;
    job.thinking = thinking;
    if (!(job.cancelled || Date.now() < agentUiHardStopUntil)) {
      activeAgentThinkingRuns.set(job.runId, {
        thinking,
        projectId: job.projectId || projectForJob?.id || "",
      });
    }
    // No meter el mismo texto otra vez en el log: ya esta junto a las bolitas.
  }

  try {
    $("status").textContent = usesProjectTools ? (isAgent ? "Agente trabajando..." : "Analizando proyecto...") : "Pensando...";
    if (usesProjectTools) {
      try {
        const syncedPermission = await window.editcoreAgent.setPermission(state.permissionMode);
        applyPermissionMode(syncedPermission);
      } catch {
        applyPermissionMode(state.permissionMode);
      }
      job.permissionMode = state.permissionMode;
      job.allowWrite = state.permissionMode !== "readonly";
      const project = state.projects.find((item) => item.id === job.projectId)
        || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(job.projectRoot))
        || activeProject();
      const continueAuthorized = Boolean(job.continueAuthorized);
      let directReadOnly = Boolean(job.directReadOnly);
      const workflowPhase = project?.agentWorkflow?.phase || "";
      const resumableTask = hasResumableAgentTask(project);
      const resumableExecutable = resumableTask && ["interrupted", "executing", "awaiting_authorization", "completed"].includes(workflowPhase);
      const planAuthorizedExecution = Boolean(job.planAuthorizedExecution)
        || isPlanAuthorizedExecution(project, prompt, isAgent);
      const authPrompt = isAgentAuthorization(prompt)
        || ProjectAnalysis.isRecoveryInstruction(prompt)
        || ProjectAnalysis.isAgentTaskFeedback(prompt);
      // Alinear con el plan: CONTINUA + tarea guardada SIEMPRE reanuda (no prompt suelto).
      const authorizedContinuation = planAuthorizedExecution
        || Boolean(job.resumeAuthorized)
        || (isAgent && resumableTask && authPrompt)
        || (isAgent && resumableExecutable && authPrompt);
      const authorized = !isAgent || authorizedContinuation || continueAuthorized || planAuthorizedExecution;
      if (!isAgent || authorized || directReadOnly) {
        if (directReadOnly) {
          setAgentActivity(job.needsAnalysisFirst ? "Analizando proyecto con herramientas..." : "Analizando proyecto...");
          setAgentLiveActivity(thinking, job.needsAnalysisFirst ? "Iniciando analisis..." : "Revisando el proyecto...");
          if (showAgentLog) {
            addAgentStepToThinking(thinking, {
              phase: "startup",
              stage: "analysis",
              text: job.needsAnalysisFirst ? "Iniciando analisis del proyecto..." : "Revisando el proyecto...",
            });
          }
        } else if (authorizedContinuation || continueAuthorized) {
          setAgentActivity("Continuando con el agente...");
          setAgentLiveActivity(thinking, "Continuando con el agente...");
          if (!agentModelCapabilities.has(agentCapabilityKey(job))) {
            try {
              await ensureAgentModelCapability(job);
            } catch (error) {
              const message = String(error?.message || error);
              if (!/timeout|aborted|operation was aborted|the operation was aborted/i.test(message)) throw error;
            }
          }
        } else {
          setAgentActivity("Trabajando…");
          setAgentLiveActivity(thinking, "Trabajando…");
          try {
            await ensureAgentModelCapability(job);
          } catch (error) {
            const message = String(error?.message || error);
            if (!/timeout|aborted|operation was aborted|the operation was aborted/i.test(message)) throw error;
            setAgentActivity("Trabajando…");
          }
        }
      }
      if (isAgent && isAgentAuthorization(prompt)) await ensureWorkflowFromPendingPlan(project, prompt);
      const immediateExecution = allowsImmediateAgentExecution(job, project, prompt, isAgent, {
        continueAuthorized,
        authorizedContinuation,
        planAuthorizedExecution,
      });
      if (isAgent && !directReadOnly && !immediateExecution) {
        if (isAgentAuthorization(prompt)) {
          elapsedSeconds = stopTimer();
          removeThinking(thinking);
          const noTask = "No hay una tarea pendiente. Describe qué quieres analizar o corregir en el proyecto.";
          append("assistant", noTask, null, true, elapsedSeconds);
          rememberMessage("assistant", noTask);
          $("status").textContent = "Sin tarea pendiente";
          return;
        }
        job.directReadOnly = true;
        job.needsAnalysisFirst = true;
        directReadOnly = true;
        setAgentActivity("Analizando proyecto con herramientas...");
        setThinkingStatus(thinking, "Analizando proyecto...");
        if (showAgentLog) {
          addAgentStepToThinking(thinking, {
            phase: "startup",
            stage: "analysis",
            text: "Iniciando analisis del proyecto...",
          });
        }
      }
      const directRun = immediateExecution && !authorizedContinuation && !continueAuthorized;
      const isolatedRun = directReadOnly || !isAgent || (continueAuthorized && !authorizedContinuation) || directRun;
      const storedTask = resolveStoredAgentTask(project, prompt, project.agentWorkflow?.taskId || job.taskId);
      const concreteTask = job.concreteAuthorizedTask === true
        || (typeof ProjectAnalysis.hasConcreteAuthorizedTask === "function"
          && ProjectAnalysis.hasConcreteAuthorizedTask(prompt));
      // CONTINUA / "porque paras" nunca deben mandar solo la palabra suelta al modelo.
      const resumeWithMemory = Boolean(authorizedContinuation || (authPrompt && storedTask));
      const executionPrompt = (concreteTask || planAuthorizedExecution)
        ? (ProjectAnalysis.resolveAuthorizedExecutionPrompt
          ? ProjectAnalysis.resolveAuthorizedExecutionPrompt(prompt, { ...project.agentWorkflow, task: storedTask }, storedTask)
          : ProjectAnalysis.authorizedPlanExecutionPrompt({ ...project.agentWorkflow, task: storedTask }))
        : resumeWithMemory
          ? ProjectAnalysis.recoveryPrompt({ ...project.agentWorkflow, task: storedTask }, prompt)
          : isolatedRun ? prompt : (storedTask || prompt);
      const recoveryProjection = !isolatedRun && window.editcoreTasks
        ? await window.editcoreTasks.status(project.agentWorkflow?.taskId || job.taskId || "").catch(() => null)
        : null;
      if (recoveryProjection?.taskGoal && !ProjectAnalysis.isAuthorization(storedTask)) {
        project.agentWorkflow.task = storedTask || recoveryProjection.taskGoal;
      }
      const resumeCount = Number(recoveryProjection?.lastCheckpoint?.completedSteps?.length || 0);
      const runId = job.runId || uid();
      job.runId = runId;
      if (showAgentLog && !(job.cancelled || Date.now() < agentUiHardStopUntil)) {
        thinking._runId = runId;
        if (thinking.dataset) thinking.dataset.runId = runId;
        job.thinking = thinking;
        activeAgentThinkingRuns.set(runId, { thinking, projectId: project?.id || job.projectId || "" });
      }
      job.agentExecuting = true;
      renderPromptQueue();
      let runRecord = null;
      if (isolatedRun) {
        project.agentRuns = Array.isArray(project.agentRuns) ? project.agentRuns : [];
        runRecord = {
          taskId: job.taskId || "",
          runId,
          prompt: executionPrompt,
          phase: "executing",
          model: job.model,
          checkpoints: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        project.agentRuns.push(runRecord);
        project.agentRuns = project.agentRuns.slice(-20);
      } else {
        const wasInterrupted = project.agentWorkflow.phase === "interrupted";
        project.agentWorkflow.phase = "executing";
        project.agentWorkflow.updatedAt = Date.now();
        project.agentWorkflow.model = job.model;
        project.agentWorkflow.runId = runId;
        project.agentWorkflow.error = "";
        project.agentWorkflow.resuming = wasInterrupted;
      }
      saveProjects();
      const effectiveAllowWrite = (planAuthorizedExecution || concreteTask) && job.permissionMode !== "readonly"
        ? true
        : (!isAgent || directReadOnly ? false : job.permissionMode !== "readonly");
      const effectiveAnalysisMode = job.orchestratorPlan
        ? job.orchestratorPlan.analysisMode === true && !(planAuthorizedExecution || concreteTask)
        : ((planAuthorizedExecution || concreteTask) ? false : (!isAgent || directReadOnly));
      const effectivePermissionMode = (() => {
        const mode = job.permissionMode || state.permissionMode || "step";
        if ((planAuthorizedExecution || concreteTask) && mode !== "readonly") return mode;
        if (!isAgent || directReadOnly) return "readonly";
        return mode;
      })();
      if ((planAuthorizedExecution || concreteTask) && job.permissionMode === "readonly") {
        const blocked = "El plan esta autorizado pero el permiso es Solo lectura. Cambia a Paso a paso o Acceso completo y escribe procede de nuevo.";
        elapsedSeconds = stopTimer();
        append("assistant", blocked, null, true, elapsedSeconds);
        rememberMessage("assistant", blocked);
        $("status").textContent = "Permiso insuficiente para ejecutar correcciones";
        return;
      }
      const freshAnalysis = job.needsAnalysisFirst || ProjectAnalysis.isFreshAnalysisRequest(job.prompt || prompt);
      if (freshAnalysis && effectiveAnalysisMode && project?.agentWorkflow) {
        project.agentWorkflow.plan = "";
        project.agentWorkflow.resumeSteps = [];
        project.agentWorkflow.error = "";
      }
      setAgentActivity(job.promptOnlyMode ? "Entendiendo tu solicitud..." : (directReadOnly ? "Analizando proyecto..." : planAuthorizedExecution ? "Ejecutando plan autorizado..." : continueAuthorized ? "Ejecutando tarea..." : "Ejecutando plan autorizado..."));
      const targetRun = isolatedRun ? runRecord : project.agentWorkflow;
      let result;
      try {
        result = await runAgentUntilSettled({
        mode: job.mode, baseUrl: job.baseUrl, apiKey: job.apiKey, model: job.model, prompt: executionPrompt,
        originalGoal: resolveStoredAgentTask(project, job.prompt, project?.agentWorkflow?.taskId || job.taskId),
        images: workflowImages(outgoingImages),
        documents: workflowDocuments(documents),
        projectRoot: job.projectRoot,
        projectId: project?.id || job.projectId || "",
        agentId: project?.activeAgentId || "",
        allowWrite: effectiveAllowWrite,
        permissionMode: effectivePermissionMode,
        cursorParityEnabled: job.cursorParityEnabled !== false,
        analysisMode: effectiveAnalysisMode,
        promptOnlyMode: job.promptOnlyMode === true,
        orchestratorPlan: job.orchestratorPlan,
        requireEvidence: job.requireEvidence,
        analysisContext: job.analysisContext || "",
        singleTask: usesProjectTools,
        // planAuthorized SOLO cuando el usuario autoriza un plan existente (procede/continua).
        // Acceso completo NO implica plan autorizado: un "analiza..." nuevo debe crear analisis,
        // no entrar a recordPlanApproval (que exige planId).
        planAuthorized: Boolean(planAuthorizedExecution || concreteTask),
        fixQueue: (planAuthorizedExecution || concreteTask)
          ? (project?.agentWorkflow?.fixQueue || project?.durableWorkflow?.fixQueue || [])
          : [],
        authorizedPlanText: (planAuthorizedExecution || concreteTask)
          ? String(
            project?.agentWorkflow?.plan
            || project?.analysisMemory?.resultSummary
            || project?.durableWorkflow?.plan
            || "",
          ).trim()
          : "",
        persistedPlan: (planAuthorizedExecution || concreteTask)
          ? String(project?.agentWorkflow?.plan || project?.analysisMemory?.resultSummary || "").trim()
          : "",
        executionMode: job.executionMode || ((planAuthorizedExecution || concreteTask) ? "AUTHORIZED_PLAN" : ""),
        planId: (planAuthorizedExecution || concreteTask)
          ? (job.planId || project?.agentWorkflow?.planId || project?.durableWorkflow?.planId || "")
          : "",
        history: job.history,
        runId,
        freshAnalysisRun: freshAnalysis && effectiveAnalysisMode,
        taskId: freshAnalysis && effectiveAnalysisMode
          ? ""
          : (targetRun?.taskId || job.taskId || project?.agentWorkflow?.taskId || project?.durableWorkflow?.taskId || ""),
        resume: freshAnalysis ? false : (Boolean(recoveryProjection) || Boolean(project.agentWorkflow?.resumeSteps?.length)),
        resumeSteps: freshAnalysis ? [] : (project.agentWorkflow?.resumeSteps || []),
        preobservedFiles: [...new Set(project.analysisMemory?.filesInspected || [])],
      }, { targetRun, thinking, job });
      } finally {
        activeAgentThinkingRuns.delete(runId);
      }
      if (targetRun && result.taskId) targetRun.taskId = result.taskId;
      if (result.planId && project?.agentWorkflow) project.agentWorkflow.planId = result.planId;
      if (result.planId || result.taskId) await syncDurableWorkflow(project);
      const reportText = String(result.text || "").trim()
        || String(result.report?.stopReason || "").trim()
        || String(result.error || "").trim()
        || extractThinkingNarrativeFallback(thinking);
      const analysisReportReady = Boolean(result.report?.completed)
        && (ProjectAnalysis.isAnalysisReport(reportText) || ProjectAnalysis.isPendingAnalysisPlan(reportText))
        && !planAuthorizedExecution
        && !authorizedContinuation
        && !continueAuthorized
        && !isFullAccessMode(job)
        && job.executionMode !== "AUTHORIZED_PLAN"
        && (targetRun?.phase || project?.agentWorkflow?.phase) !== "executing";
      const normalizedReportText = ProjectAnalysis.isAnalysisReport(reportText)
        ? reportText
        : ProjectAnalysis.normalizeAnalysisReport(reportText);
      if (targetRun) {
        if (analysisReportReady) {
          targetRun.phase = "awaiting_authorization";
          targetRun.plan = ProjectAnalysis.redactCredentials(normalizedReportText);
          targetRun.error = "";
          targetRun.resumeSteps = [];
        } else {
          const incompleteTurn = result.incomplete === true
            || /(?:^|\n)\s*(?:voy\s+a|ahora\s+(?:voy\s+a|leer[eé]|abrir[eé]))\b/i.test(reportText);
          const markCompleted = Boolean(result.report?.completed) && !incompleteTurn;
          targetRun.phase = markCompleted ? "completed" : "interrupted";
          targetRun.error = markCompleted ? "" : reportText;
          targetRun.lastNarration = reportText.slice(0, 2000);
          if (!markCompleted && Array.isArray(result.steps) && result.steps.length) {
            targetRun.resumeSteps = result.steps.slice(-24);
          }
        }
        targetRun.result = reportText;
        targetRun.report = result.report || null;
        targetRun.resuming = false;
        targetRun.updatedAt = Date.now();
      }
      if (result.report?.completed && !analysisReportReady) {
        await deleteAgentTaskPrompt(result.taskId || targetRun?.taskId || job.taskId).catch(() => undefined);
      }
      if (job.ephemeralRoot || job.listOnly || result.report?.stopReason === "Listado entregado por el agente." || result.report?.stopReason === "list_only_fast_path") {
        const listed = String(job.projectRoot || "").trim()
          || (ProjectAnalysis.extractAbsolutePathHints?.(job.prompt) || [])[0]
          || "";
        if (listed) state.lastListedRoot = listed;
      }
      if (directReadOnly || effectiveAnalysisMode) {
        const memoryReportText = analysisReportReady
          ? normalizedReportText
          : (ProjectAnalysis.isAnalysisReport(reportText) || ProjectAnalysis.isPendingAnalysisPlan(reportText)
            ? reportText
            : (result.report?.completed
              ? reportText
              : (extractThinkingNarrativeFallback(thinking) || reportText)));
        // persistPartialAnalysis: guardar siempre evidencia para CONTINUA/PROCEDE.
        if (memoryReportText || (Array.isArray(result.steps) && result.steps.length)) {
          project.analysisMemory = ProjectAnalysis.buildAnalysisMemory({
            projectName: projectDisplayName(project),
            projectRoot: job.projectRoot,
            request: executionPrompt,
            resultText: memoryReportText || reportText || "Analisis parcial: evidencia de herramientas guardada. Escribe CONTINUA para el reporte final.",
            model: job.model,
            steps: result.steps,
            report: result.report,
          });
          project.lastAnalysis = project.analysisMemory;
          saveProjects({ immediate: true });
        }
        if ((job.needsAnalysisFirst || analysisReportReady) && result.report?.completed) {
          markWorkflowAwaitingAuthorization(project, {
            taskId: result.taskId || job.taskId || "",
            planId: result.planId || project.agentWorkflow?.planId || "",
            task: executionPrompt,
            plan: memoryReportText || reportText,
            images: outgoingImages,
            documents: job.documents || [],
            fixQueue: result.fixQueue || result.report?.fixQueue || [],
          });
          if (window.editcoreTasks?.persistPlan && (result.taskId || project.agentWorkflow?.taskId)) {
            await window.editcoreTasks.persistPlan({
              taskId: result.taskId || project.agentWorkflow.taskId,
              projectId: project.id || "",
              projectRoot: job.projectRoot || project.root || "",
              goal: executionPrompt,
              content: memoryReportText || reportText,
              planId: result.planId || project.agentWorkflow?.planId || "",
              fixQueue: project.agentWorkflow?.fixQueue || [],
            }).catch(() => null);
          }
          await saveAgentTaskPrompt(project.agentWorkflow.taskId, executionPrompt);
          const queueLen = Array.isArray(project.agentWorkflow?.fixQueue) ? project.agentWorkflow.fixQueue.length : 0;
          updateAgentPipelineUi({
            queue: queueLen
              ? `0/${queueLen} · listo para PROCEDE`
              : "Sin correcciones pendientes",
            queueState: queueLen ? "warn" : "ok",
          });
          $("status").textContent = queueLen
            ? "Análisis listo · escribe procede, autorizo o continua"
            : "Análisis listo · sin correcciones pendientes (no uses procede vacio)";
        } else if (!result.report?.completed && project.agentWorkflow) {
          project.agentWorkflow.phase = "interrupted";
          project.agentWorkflow.error = "";
          project.agentWorkflow.updatedAt = Date.now();
          if (memoryReportText) project.agentWorkflow.plan = memoryReportText.slice(0, 8000);
          $("status").textContent = "Analisis interrumpido · escribe CONTINUA para el reporte";
        }
      } else if (analysisReportReady && targetRun === project.agentWorkflow) {
        project.analysisMemory = ProjectAnalysis.buildAnalysisMemory({
          projectName: projectDisplayName(project),
          projectRoot: job.projectRoot,
          request: project.agentWorkflow?.task || executionPrompt,
          resultText: normalizedReportText || reportText,
          model: job.model,
          steps: result.steps,
          report: result.report,
        });
        project.lastAnalysis = project.analysisMemory;
        saveProjects({ immediate: true });
        markWorkflowAwaitingAuthorization(project, {
          taskId: result.taskId || job.taskId || "",
          planId: result.planId || project.agentWorkflow?.planId || "",
          task: project.agentWorkflow?.task || executionPrompt,
          plan: normalizedReportText,
          images: outgoingImages,
          documents: job.documents || [],
          fixQueue: result.fixQueue || result.report?.fixQueue || project.agentWorkflow?.fixQueue || [],
        });
        if (window.editcoreTasks?.persistPlan && (result.taskId || project.agentWorkflow?.taskId)) {
          await window.editcoreTasks.persistPlan({
            taskId: result.taskId || project.agentWorkflow.taskId,
            projectId: project.id || "",
            projectRoot: job.projectRoot || project.root || "",
            goal: project.agentWorkflow?.task || executionPrompt,
            content: normalizedReportText,
            planId: result.planId || project.agentWorkflow?.planId || "",
            fixQueue: project.agentWorkflow?.fixQueue || [],
          }).catch(() => null);
        }
        await saveAgentTaskPrompt(project.agentWorkflow.taskId, project.agentWorkflow.task).catch(() => undefined);
        updateAgentPipelineUi({
          queue: Array.isArray(project.agentWorkflow?.fixQueue) && project.agentWorkflow.fixQueue.length
            ? `0/${project.agentWorkflow.fixQueue.length} · listo para PROCEDE`
            : "Plan listo · PROCEDE",
          queueState: "warn",
        });
        $("status").textContent = "Análisis listo · escribe procede, autorizo o continua";
      }
      saveProjects();
      elapsedSeconds = stopTimer();
      const finalText = String(result.text || "").trim()
        || (result.report?.stopReason ? `## Resultado\n\n${result.report.stopReason}\n\nEscribe **CONTINUA** para profundizar.` : "")
        || extractThinkingNarrativeFallback(thinking)
        || "## Resultado\n\nEl agente termino sin generar un reporte visible. Escribe **CONTINUA** para reintentar.";
      rememberMessage("assistant", finalText, result.usage);
      // Persistir análisis también si el informe final quedó en el chat (cualquier modo).
      if (project && (ProjectAnalysis.isAnalysisReport?.(finalText) || ProjectAnalysis.isPendingAnalysisPlan?.(finalText)
        || (Array.isArray(result.steps) && result.steps.length > 0))) {
        const existingUseful = ProjectAnalysis.isUsefulAnalysisMemory?.(project.analysisMemory);
        if (!existingUseful || job.needsAnalysisFirst || effectiveAnalysisMode || directReadOnly) {
          project.analysisMemory = ProjectAnalysis.buildAnalysisMemory({
            projectName: projectDisplayName(project),
            projectRoot: job.projectRoot || state.projectRoot || "",
            request: executionPrompt || project.agentWorkflow?.task || "",
            resultText: finalText,
            model: job.model,
            steps: result.steps,
            report: result.report,
          });
          project.lastAnalysis = project.analysisMemory;
          saveProjects({ immediate: true });
        }
      }
      finalizeThinkingAsAssistant(thinking, finalText, result.usage, elapsedSeconds, {
        // Informe final siempre sustituye Avances; no conservar progreso como cuerpo.
        preserveNarrative: false,
      });
      if (result.usage) recordUsage(result.usage);
      notifyVoiceAssistant(finalText);
      const report = result.report || {};
      if (!report.completed) {
        $("status").textContent = report.autoResumeRecommended
          ? `Continuando - ${report.toolCount || 0} acciones verificadas - quedan ${report.remainingProviderCalls || 0} llamadas globales`
          : `Interrumpido - ${report.toolCount || 0} acciones verificadas - checkpoint guardado`;
      }
      if (report.completed && !job.needsAnalysisFirst) {
        $("status").textContent = `Completado - ${report.toolCount || 0} acciones - ${(report.changedFiles || []).length} archivos`;
      }
      if (report.canUndo) {
        refreshUndoAgentRunButton(true);
        if (report.review?.files?.length) {
          renderAgentDiffReview(report.review);
        } else {
          appendMessage("assistant", "_Puedes escribir `DESHACER` en el chat para revertir esta corrida._");
        }
      } else {
        refreshUndoAgentRunButton();
      }
      refreshProjectFilesFromDisk({ viewDir: state.fileListRelativePath || "" });
      scheduleClearAgentTouchedHighlights(180000);
    } else {
      // streaming chat
      let accumulated = "";
      let streamEl = null;
      let streamBody = null;
      let finalUsage = null;

      try { window.editcoreStream?.offChunk?.(); } catch {}
      try {
        window.editcoreStream?.onChunk?.((chunk) => {
          if (chunk && chunk.done) return;
          const replace = Boolean(chunk && typeof chunk === "object" && chunk.replace);
          const text = typeof chunk === "string" ? chunk : (chunk?.text || chunk?.delta || "");
          if (!text) return;
          if (streamEl === null) {
            removeThinking(thinking);
            const s = appendStreaming();
            streamEl = s.item;
            streamBody = s.body;
            stopTimer();
            job.stopStreamingTimer = () => 0;
          }
          accumulated = replace ? text : `${accumulated}${text}`;
          streamBody.innerHTML = renderMarkdown(accumulated);
          scrollFeedToBottom();
        });
      } catch {}

      const result = await window.editcoreChat.chat({
        mode: job.mode, baseUrl: job.baseUrl, apiKey: job.apiKey, model: job.model, prompt,
        providerKey: job.providerKey || "",
        images: outgoingImages,
        projectRoot: job.projectRoot || "",
        projectId: activeProject()?.id || "",
        agentId: activeProject()?.activeAgentId || state.activeAgentId || "",
        permissionMode: job.permissionMode || state.permissionMode || "step",
        history: job.history,
        systemPrompt: [
          job.chatConversationHint,
          job.analysisContext ? (window.EditCoreEliteCommunication?.withEliteCommunicationPolicy
            || ((s) => s))([
            "Eres EditCoreAI, un asistente de desarrollo experto. Responde siempre en español, de forma directa y basada en evidencia.",
            "Las preguntas informativas y de seguimiento no requieren autorizacion. No afirmes que perdiste contexto si la memoria verificada incluye el proyecto.",
            job.analysisContext,
          ].join("\n\n")) : "",
        ].filter(Boolean).join("\n\n"),
      });

      try { window.editcoreStream?.offChunk?.(); } catch {}
      elapsedSeconds = job.stopStreamingTimer ? job.stopStreamingTimer() : stopTimer();
      removeThinking(thinking);

      // If streaming populated the element, finalize it; else use result directly
      if (streamEl) {
        const finalText = String(result?.text || "").trim() && result.text !== "Operación completada."
          ? result.text
          : accumulated;
        if (finalText && accumulated !== finalText) {
          accumulated = finalText;
          streamBody.innerHTML = renderMarkdown(accumulated);
        }
        streamEl.id = "";
        finalUsage = result.usage;
        if (finalUsage && usageMetaText(finalUsage)) {
          const meta = document.createElement("div");
          meta.className = "msg-meta";
          meta.textContent = usageMetaText(finalUsage);
          streamEl.appendChild(meta);
        }
      } else {
        append("assistant", result.text, result.usage, true, elapsedSeconds);
      }

      rememberMessage("assistant", accumulated || result.text, result.usage);
      if (result.usage) recordUsage(result.usage);
      notifyVoiceAssistant(accumulated || result.text || result?.text);
      updateStatus();
    }
    return;
  } catch (error) {
    elapsedSeconds = stopTimer();
    const streamEl2 = $("streamingMsg");
    if (streamEl2) streamEl2.remove();
    const rawMessage = userFacingError(String(error?.message || error));
    const cancelled = (Boolean(job.cancelled) && Boolean(job.cancelRequestedBy))
      || /cancelad[oa]|aborted|abort/i.test(rawMessage);
    const message = cancelled
      ? "Cancelado por el usuario."
      : rawMessage && rawMessage !== "<none>"
        ? rawMessage
        : "EditCore no recibió un error legible del proveedor o del proyecto.";
    if (isAgent) {
      const project = state.projects.find((item) => item.id === job.projectId)
        || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(job.projectRoot))
        || activeProject();
      const parallelRun = project?.agentRuns?.find((item) => item.runId === job.runId);
      const targetRun = parallelRun || (project?.agentWorkflow?.runId === job.runId ? project.agentWorkflow : null);
      if (targetRun?.phase === "executing") {
        targetRun.phase = "interrupted";
        targetRun.error = message;
        targetRun.updatedAt = Date.now();
        saveProjects();
      }
    }
    rememberMessage("assistant", message);
    if (usesProjectTools && thinking) {
      finalizeThinkingAsAssistant(thinking, message, null, elapsedSeconds, { preserveNarrative: true });
    }
    else append("assistant", message, null, true, elapsedSeconds);
    notifyVoiceAssistant(message);
    handleProviderFailureForAuto(message, job).catch(() => undefined);
    $("status").textContent = cancelled ? "Cancelado" : "Error";
  } finally {
    if (job.runId) activeAgentThinkingRuns.delete(job.runId);
    job.agentExecuting = false;
    if (job.thinking) {
      settleAgentTurnChrome(job.thinking, { force: true });
    }
    document.querySelectorAll?.(".thinking-msg, .is-thinking-live")?.forEach?.((el) => {
      const elRunId = String(el._runId || el.dataset?.runId || "").trim();
      if (!elRunId || !activeAgentThinkingRuns.has(elRunId)) {
        settleAgentTurnChrome(el, { force: true });
      }
    });
    renderPromptQueue();
    notifyVoiceTurnComplete();
    $("prompt").focus();
  }
}

function workflowImages(outgoingImages, project = activeProject()) {
  if (Array.isArray(outgoingImages) && outgoingImages.length) return outgoingImages;
  return Array.isArray(project && project.agentWorkflow?.images) ? project.agentWorkflow.images : [];
}

function workflowDocuments(outgoingDocuments, project = activeProject()) {
  if (Array.isArray(outgoingDocuments) && outgoingDocuments.length) return outgoingDocuments;
  return Array.isArray(project && project.agentWorkflow?.documents) ? project.agentWorkflow.documents : [];
}


function appendAgentApprovalCard(request = {}) {
  const requestId = String(request.requestId || "");
  if (!requestId || pendingAgentApprovalCards.has(requestId)) return null;
  const liveRun = [...activeAgentThinkingRuns.values()].find((entry) => entry?.thinking) || null;
  if (liveRun?.thinking) {
    showThinkingIndicator(liveRun.thinking);
    setThinkingStatus(liveRun.thinking, "Esperando tu autorización...");
  }
  const item = document.createElement("article");
  item.className = "msg assistant agent-approval-card";
  item.dataset.approvalRequestId = requestId;

  const header = document.createElement("div");
  header.className = "msg-head agent-approval-head";
  header.innerHTML = '<span class="agent-approval-icon" aria-hidden="true"></span><span>Permiso requerido</span>';

  const body = document.createElement("div");
  body.className = "msg-body agent-approval-body";
  const title = document.createElement("p");
  title.className = "agent-approval-title";
  title.textContent = String(request.message || "El agente necesita tu autorización para continuar.");
  const detail = document.createElement("pre");
  detail.className = "agent-approval-detail";
  detail.textContent = String(request.detail || "").trim();
  body.append(title);
  if (detail.textContent) body.appendChild(detail);
  const diffText = String(request.diff || "").trim();
  if (diffText) {
    const diff = document.createElement("pre");
    diff.className = "agent-approval-diff";
    diff.textContent = diffText;
    body.appendChild(diff);
  }

  const actions = document.createElement("div");
  actions.className = "agent-approval-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "approval-btn approval-btn-cancel";
  cancelBtn.textContent = "Cancelar";
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "approval-btn approval-btn-approve";
  approveBtn.textContent = "Autorizar";
  actions.append(cancelBtn, approveBtn);
  body.appendChild(actions);
  item.append(header, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();

  const settle = async (approved) => {
    if (!pendingAgentApprovalCards.has(requestId)) return;
    pendingAgentApprovalCards.delete(requestId);
    cancelBtn.disabled = true;
    approveBtn.disabled = true;
    item.classList.add(approved ? "is-approved" : "is-denied");
    title.textContent = approved
      ? "Autorización concedida. El agente continúa..."
      : "Autorización cancelada. El agente no ejecutará esta acción.";
    actions.remove();
    if (liveRun?.thinking) {
      showThinkingIndicator(liveRun.thinking);
      setThinkingStatus(liveRun.thinking, approved ? "Continuando ejecución..." : "Acción cancelada");
    }
    await window.editcoreAgent.respondApproval({ requestId, approved }).catch(() => false);
    $("status").textContent = approved ? "Acción autorizada" : "Acción cancelada";
  };
  cancelBtn.addEventListener("click", () => settle(false));
  approveBtn.addEventListener("click", () => settle(true));
  pendingAgentApprovalCards.set(requestId, { item, settle });
  $("status").textContent = "Esperando autorizacion en el chat...";
  return item;
}

async function cancelProjectAgentJobs(projectRoot) {
  const root = normalizeProjectRoot(projectRoot || "");
  promptQueue = promptQueue.filter((item) => !(item.isAgent && normalizeProjectRoot(item.projectRoot) === root));
  const targets = [...activePromptRequests.values()].filter((job) =>
    job.isAgent && normalizeProjectRoot(job.projectRoot) === root
  );
  if (!targets.length) {
    renderPromptQueue();
    setRunningControls();
    return;
  }
  const now = Date.now();
  targets.forEach((job) => {
    job.cancelled = true;
    job.cancelRequestedAt = now;
    job.cancelRequestedBy = "authorization";
  });
  await Promise.all(
    targets.map((job) => window.editcoreAgent.cancel({ runId: job.planRunId || job.runId || "" }).catch(() => false))
  );
  renderPromptQueue();
  setRunningControls();
}

function appendUserWithImages(text, images) {
  state.lastUserPrompt = String(text || "").trim();
  const item = document.createElement("article");
  item.className = "msg user";
  item.dataset.role = "user";

  const header = document.createElement("div");
  header.className = "msg-head";
  header.textContent = "Tú";

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(text);

  item.append(header, body);

  for (const img of images || []) {
    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = img.name;
    imgEl.className = "msg-img";
    item.appendChild(imgEl);
  }

  $("feed").appendChild(item);
  // Siempre bajar al último mensaje del usuario (PROCEDE/HAZLO incluido).
  scrollFeedToBottom(true);
  try {
    item.scrollIntoView({ behavior: "smooth", block: "end" });
  } catch { /* ignore */ }
  return item;
}

function appendUserMessageImmediate(text, images = []) {
  const visible = ProjectAnalysis.redactCredentials(String(text || "").trim());
  const imgs = Array.isArray(images) ? images : [];
  if (!visible && !imgs.length) return null;
  const item = appendUserWithImages(visible || "Imagen adjunta", imgs);
  rememberMessage("user", visible || "Imagen adjunta", null, imgs, []);
  return item;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function migrateConfig() {
  const config = loadJson("editcore-chat-config", null);
  if (!config) return;
  const profiles = loadProviderProfiles().filter((profile) => profile.status === "active");
  const providerKey = config.providerKey || providerKeyForEndpoint(config.baseUrl);
  const legacyClaudeModel = /^claude-(?:3-|3\.|3_)/i.test(String(config.model || ""));
  const selectedProfile = profiles.find((profile) => profile.id === config.providerProfileId)
    || profiles.find((profile) => profile.providerKey === providerKey && profile.model === config.model)
    || (legacyClaudeModel
      ? profiles.find((profile) => profile.providerKey === providerKey
        && /^claude-(?:sonnet|opus|haiku)-4(?:[.-]|$)/i.test(profile.model))
      : null);
  if (!selectedProfile) return;
  const provider = loadJson("editcore-providers", {})[selectedProfile.providerKey] || {};
  const baseUrl = selectedProfile.baseUrl || provider.baseUrl || PROVIDERS[selectedProfile.providerKey]?.baseUrl || config.baseUrl || "";
  const migratedConfig = {
    ...config,
    mode: selectedProfile.model.startsWith("claude") ? "claude" : "gpt",
    baseUrl,
    apiKey: selectedProfile.apiKey,
    model: selectedProfile.model,
    providerKey: selectedProfile.providerKey,
    providerProfileId: selectedProfile.id,
  };
  if (JSON.stringify(migratedConfig) !== JSON.stringify(config)) {
    await saveSecureJson("editcore-chat-config", migratedConfig);
  }
}

async function cleanupObsoleteProviders() {
  const REMOVED_PROVIDER_KEYS = new Set(["chatgptpro4all"]);
  const REMOVED_HOST_FRAGMENTS = ["chatgptpro4all.com"];
  const storedProviders = loadJson("editcore-providers", {});
  let providersMapChanged = false;
  for (const key of REMOVED_PROVIDER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(storedProviders, key)) {
      delete storedProviders[key];
      providersMapChanged = true;
    }
  }
  if (providersMapChanged) await saveSecureJson("editcore-providers", storedProviders);

  const primaryHostnames = PRIMARY_PROVIDER_KEYS.map((key) => {
    try { return new URL(PROVIDERS[key].baseUrl).hostname; } catch { return ''; }
  }).filter(Boolean);
  const customProviders = loadCustomProviders();
  const badSubstrings = [...REMOVED_HOST_FRAGMENTS];

  // Solo eliminar custom providers con URL/nombre claramente obsoleto
  const toRemove = customProviders.filter((prov) => {
    const url = String(prov.baseUrl || '').toLowerCase();
    const name = String(prov.name || '').toLowerCase();
    if (badSubstrings.some((bad) => url.includes(bad) || name.includes(bad))) return true;
    try { return primaryHostnames.includes(new URL(url).hostname); } catch { return false; }
  });
  const removedIds = new Set(toRemove.map((p) => p.id));
  const cleaned = customProviders.filter((p) => !removedIds.has(p.id));
  if (cleaned.length !== customProviders.length) await saveCustomProviders(cleaned);

  let profiles = loadProviderProfiles();
  let changed = false;

  profiles = profiles.map((profile) => {
    const key = String(profile.providerKey || '');
    // Solo limpiar providerName de perfiles primarios para evitar grupos duplicados en el modal
    if (profile.providerName && PRIMARY_PROVIDER_KEYS.includes(key)) {
      changed = true;
      const { providerName: _, ...rest } = profile;
      return rest;
    }
    return profile;
  }).filter((profile) => {
    const key = String(profile.providerKey || '');
    const url = String(profile.baseUrl || '').toLowerCase();
    if (REMOVED_PROVIDER_KEYS.has(key) || String(profile.model || "").toLowerCase().startsWith("chatgptpro4all/")) { changed = true; return false; }
    // Solo eliminar perfiles con URLs claramente obsoletas
    if (badSubstrings.some((bad) => url.includes(bad))) { changed = true; return false; }
    // Eliminar perfiles de custom providers eliminados arriba
    if (key.startsWith('custom:') && removedIds.has(key.slice(7))) { changed = true; return false; }
    return true;
  });

  if (changed) await saveProviderProfiles(profiles);
}

const APICREDITS_VERIFIED_MODELS = [
  "claude-fable-5", "claude-haiku-4-5", "claude-opus-4-7", "claude-opus-4-8",
  "claude-sonnet-4-6", "claude-sonnet-5",
  "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra",
];

async function ensureDefaultModelSelectionMode() {
  const config = loadJson("editcore-chat-config", {});
  if (config.modelSelectionMode) {
    // Migrar Auto legacy sin scope → ME AI (primer proveedor).
    if (config.modelSelectionMode === "auto" && !Object.prototype.hasOwnProperty.call(config, "autoProviderScope")) {
      await saveSecureJson("editcore-chat-config", { ...config, remember: true, autoProviderScope: "meai" });
    }
    return;
  }
  if (!verifiedChatModelOptions().length) return;
  await saveSecureJson("editcore-chat-config", {
    ...config,
    remember: true,
    modelSelectionMode: "auto",
    autoProviderScope: "meai",
  });
}

async function boot() {
  performance.mark?.("editcore-boot-start");
  try { $("previewWebview")?.setAttribute("partition", PREVIEW_PARTITION); } catch { /* ignore */ }
  // Quitar UI legacy Review/Stop/Done + follow-up si quedó en el DOM
  try {
    for (const el of document.querySelectorAll(".agent-followup-input, .agent-footer-stop, .agent-footer-btn")) {
      el.remove();
    }
  } catch { /* ignore */ }
  try {
    document.body.classList.remove("ide-code-mode");
    document.body.classList.add("ide-web-mode");
  } catch { /* ignore */ }

  // Arranque Chat-first: fijar modo ANTES de cualquier trabajo IDE.
  try {
    if (!localStorage.getItem("editcore-app-mode")) localStorage.setItem("editcore-app-mode", "chat");
    document.body.dataset.appMode = localStorage.getItem("editcore-app-mode") === "ide" ? "ide" : "chat";
  } catch {
    document.body.dataset.appMode = "chat";
  }
  const chatFirst = document.body.dataset.appMode === "chat";

  // Preview / paneles / menús de archivos: en Chat no bloquean la 1ª pintura.
  if (!chatFirst) {
    const savedMode = localStorage.getItem(PREVIEW_MODE_STORAGE_KEY);
    const bootMode = savedMode === "code" || savedMode === "mobile" ? savedMode : "web";
    setPreviewMode(bootMode);
    bindFeedScrollGuard();
    initFileListContextMenu();
    loadPanelSizes();
  } else {
    // Defaults mínimos; el resto al entrar al IDE o en idle.
    try { document.querySelector(".viewer")?.setAttribute("data-preview-mode", "web"); } catch { /* ignore */ }
  }

  loadConfig();
  loadMetrics();
  try {
    const raw = JSON.parse(localStorage.getItem("editcore-auto-upstream-usage") || "{}");
    state.autoUpstreamUsage = {
      meai: Math.max(0, Number(raw.meai) || 0),
      apicredits: Math.max(0, Number(raw.apicredits) || 0),
    };
  } catch {
    state.autoUpstreamUsage = { meai: 0, apicredits: 0 };
  }
  try {
    const rawModels = JSON.parse(localStorage.getItem("editcore-auto-model-usage") || "{}");
    state.autoModelUsage = rawModels && typeof rawModels === "object" ? rawModels : {};
  } catch {
    state.autoModelUsage = {};
  }

  // FAST PATH + DISK HYDRATION: Cargar desde disco (userData) inmediatamente para evitar pérdida de proyectos
  const storedProjects = loadJson(PROJECTS_STORAGE_KEY, []);
  const storedActiveProjectId = String(localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || "").trim();
  let initialProjects = repairPersistedText(storedProjects).map(ensureProjectAgent);

  let diskSession = null;
  try {
    diskSession = window.editcoreSession?.load ? await window.editcoreSession.load() : null;
  } catch {
    diskSession = null;
  }
  const diskProjects = Array.isArray(diskSession?.projects) ? repairPersistedText(diskSession.projects).map(ensureProjectAgent) : [];
  const diskActive = String(diskSession?.activeProjectId || "").trim();

  if (diskProjects.length > 0) {
    if (initialProjects.length === 0) {
      initialProjects = diskProjects;
    } else {
      const mergedMap = new Map();
      for (const dp of diskProjects) {
        const key = dp.projectRoot ? normalizeProjectRoot(dp.projectRoot) : dp.id;
        mergedMap.set(key, dp);
      }
      for (const sp of initialProjects) {
        const key = sp.projectRoot ? normalizeProjectRoot(sp.projectRoot) : sp.id;
        if (!mergedMap.has(key)) {
          mergedMap.set(key, sp);
        } else {
          const dp = mergedMap.get(key);
          const dpChats = Array.isArray(dp.chats) ? dp.chats : [];
          const spChats = Array.isArray(sp.chats) ? sp.chats : [];
          const chatMap = new Map();
          for (const c of dpChats) chatMap.set(c.id, c);
          for (const c of spChats) {
            if (!chatMap.has(c.id)) {
              chatMap.set(c.id, c);
            } else {
              const curC = chatMap.get(c.id);
              const curMsgs = Array.isArray(curC.messages) ? curC.messages : [];
              const newMsgs = Array.isArray(c.messages) ? c.messages : [];
              if (newMsgs.length >= curMsgs.length) {
                chatMap.set(c.id, { ...curC, ...c, messages: newMsgs });
              }
            }
          }
          const mergedChats = Array.from(chatMap.values());
          const keepSp = (Number(sp.updatedAt) || 0) >= (Number(dp.updatedAt) || 0);
          mergedMap.set(key, keepSp ? { ...dp, ...sp, chats: mergedChats } : { ...sp, ...dp, chats: mergedChats });
        }
      }
      initialProjects = Array.from(mergedMap.values());
    }
  }

  state.projects = initialProjects;
  _isSessionHydrated = true;

  // Limpiar proyectos huérfanos vacíos creados por recargas previas si existen proyectos reales.
  if (state.projects.length > 1) {
    state.projects = state.projects.filter((p) => {
      const hasRoot = Boolean(p.projectRoot);
      const hasMsgs = (Array.isArray(p.messages) && p.messages.length > 0) || (Array.isArray(p.chats) && p.chats.some((c) => Array.isArray(c.messages) && c.messages.length > 0));
      const isActive = p.id === storedActiveProjectId || p.id === diskActive;
      return hasRoot || hasMsgs || isActive;
    });
  }

  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
  } catch { /* ignore */ }

  state.activeProjectId = "";
  state.projectRoot = "";

  localStorage.removeItem("editcore-projects-collapsed");
  document.body.classList.remove("projects-collapsed");
  if ($("projectPathLabel")) $("projectPathLabel").textContent = "Sin proyecto";
  updateCloseProjectButton();

  const autoPick = _appParams.get("autoPick") === "1";
  const explicitOpenRoot = _appParams.get("projectRoot") || _appParams.get("openRoot");
  
  let matchedProject = null;
  if (explicitOpenRoot) {
    matchedProject = state.projects.find((p) => normalizeProjectRoot(p.projectRoot) === normalizeProjectRoot(explicitOpenRoot));
  }
  const targetActiveId = storedActiveProjectId || diskActive;
  if (!matchedProject && targetActiveId) {
    matchedProject = state.projects.find((p) => p.id === targetActiveId);
  }
  if (!matchedProject && state.projects.length) {
    matchedProject = state.projects.find((p) => p.projectRoot) || state.projects[0];
  }

  if (autoPick) {
    if (!chatFirst) showWelcomeScreen();
    else hideWelcomeScreen();
  } else if (matchedProject) {
    await hydrateProjectChatsFromDisk(matchedProject);
    state.activeProjectId = matchedProject.id;
    state.projectRoot = matchedProject.projectRoot || "";
    ensureProjectChats(matchedProject);
    const curChat = activeChat(matchedProject);
    state.history = [...(curChat?.messages || matchedProject.messages || [])];
    hideWelcomeScreen();
    if ($("projectPathLabel")) $("projectPathLabel").textContent = matchedProject.projectRoot || "Sin proyecto";
    try {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, matchedProject.id);
      if (matchedProject.projectRoot) localStorage.setItem("editcore-project-root", matchedProject.projectRoot);
    } catch { /* ignore */ }
  } else {
    hideWelcomeScreen();
    if (!chatFirst) showWelcomeScreen();
  }

  // Chat-first: no bloquear 1ª pintura con historial/DOM pesado; pintar en idle inmediato.
  if (chatFirst) {
    try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
    const paintSoon = typeof requestIdleCallback === "function"
      ? (fn) => requestIdleCallback(fn, { timeout: 300 })
      : (fn) => setTimeout(fn, 30);
    paintSoon(() => {
      try { renderFeed({ force: true }); } catch { /* ignore */ }
      try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
    });
  } else {
    renderFeed();
    renderProjects();
    renderAttachments();
  }

  const bootPermission = ["readonly", "step", "full"].includes(state.permissionMode) ? state.permissionMode : "step";
  applyPermissionMode(bootPermission);
  document.body.dataset.editcoreReady = "1";
  void initAppStatusBar();
  window.__editcorePipeline = {
    update: updateAgentPipelineUi,
    getState: () => ({ ...agentPipelineState }),
  };
  updateSendButtonState();
  performance.mark?.("editcore-interactive");

  if (!window.__editcoreSessionFlushBound) {
    window.__editcoreSessionFlushBound = true;
    const flush = () => flushSessionSyncNow();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.editcoreSession?.onPleaseFlush?.(flush);
  }

  // SLOW PATH: tareas en background
  const idle = typeof requestIdleCallback === "function"
    ? (fn, ms) => requestIdleCallback(() => { void fn(); }, { timeout: ms })
    : (fn, ms) => setTimeout(() => { void fn(); }, Math.min(ms, 80));
  const deferMs = chatFirst ? 2000 : 900;
  const startBg = () => idle(() => bootBackground({
    autoPick,
    explicitOpenRoot,
    storedProjects,
    storedActiveProjectId,
    bootPermission,
    chatFirst,
  }), deferMs);
  if (chatFirst) setTimeout(startBg, 400);
  else startBg();

  // Inline Edit / Monaco: solo preparar cuando el usuario entra al IDE.
  const bootIdeChrome = () => {
    if (window.__editcoreIdeChromeBooted) return;
    window.__editcoreIdeChromeBooted = true;
    try {
      const savedMode = localStorage.getItem(PREVIEW_MODE_STORAGE_KEY);
      const bootMode = savedMode === "code" || savedMode === "mobile" ? savedMode : "web";
      setPreviewMode(bootMode);
    } catch { /* ignore */ }
    try { bindFeedScrollGuard(); } catch { /* ignore */ }
    try { initFileListContextMenu(); } catch { /* ignore */ }
    try { loadPanelSizes(); } catch { /* ignore */ }
    try {
      if (window.EditCoreEditor?.ensureEditor) {
        const origEnsure = window.EditCoreEditor.ensureEditor.bind(window.EditCoreEditor);
        window.EditCoreEditor.ensureEditor = async (...args) => {
          const ed = await origEnsure(...args);
          window.__monacoEditor = ed;
          window.EditCoreEditor._editor = ed;
          if (!window.EditCoreEditor.getMonacoEditor) {
            window.EditCoreEditor.getMonacoEditor = () => window.__monacoEditor || window.EditCoreEditor._editor || null;
          }
          try { window.EditCoreInlineEdit?.bindMonacoShortcut?.(ed, window.monaco); } catch { /* ignore */ }
          try { window.EditCoreVisualPreviewInspector?.bindMonacoInspectorShortcut?.(ed, window.monaco); } catch { /* ignore */ }
          return ed;
        };
      }
    } catch { /* ignore */ }
  };

  if (!chatFirst) {
    bootIdeChrome();
  } else {
    window.addEventListener("editcore:app-mode", (ev) => {
      if (ev?.detail?.mode !== "ide") return;
      bootIdeChrome();
      // Primera entrada al IDE: pintar feed/proyectos y arrancar preview si hay proyecto.
      if (!window.__editcoreIdeFeedPainted) {
        window.__editcoreIdeFeedPainted = true;
        idle(() => {
          try { renderFeed({ force: true }); } catch { /* ignore */ }
          try { renderProjects(); } catch { /* ignore */ }
          try { renderAttachments(); } catch { /* ignore */ }
          const activeId = state.activeProjectId;
          if (activeId) {
            selectProject(activeId, { render: true, preview: true, force: false }).catch(() => undefined);
          }
        }, 400);
      } else if (state.activeProjectId && !String($("previewUrl")?.value || "").trim()) {
        // Reentrada al IDE sin URL de preview: arrancar servidor.
        selectProject(state.activeProjectId, { render: false, preview: true }).catch(() => undefined);
      }
    });
  }
}

async function bootBackground({
  autoPick = false,
  explicitOpenRoot = "",
  storedProjects = [],
  storedActiveProjectId = "",
  bootPermission = "step",
  chatFirst = false,
} = {}) {
  try {
    await initializeSecureState();
    if (loadJson("editcore-rtk", {}).enabled !== true) {
      saveSecureJson("editcore-rtk", { enabled: true }).catch(() => undefined);
    }
    cleanupObsoleteProviders().catch(() => undefined);
    migrateLegacyProviderProfiles().catch(() => undefined);
    migrateConfig().catch(() => undefined);
    loadConfig();
    refreshCacheStats().catch(() => undefined);

    let diskSession = null;
    try {
      diskSession = window.editcoreSession?.load ? await window.editcoreSession.load() : null;
    } catch {
      diskSession = null;
    }
    const diskProjects = Array.isArray(diskSession?.projects) ? diskSession.projects : [];
    const diskActive = String(diskSession?.activeProjectId || "").trim();

    if (diskProjects.length > 0) {
      if (storedProjects.length === 0 && state.projects.length === 0) {
        state.projects = repairPersistedText(diskProjects).map(ensureProjectAgent);
        renderProjects();
        try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
      } else {
        const currentProjectRoots = new Set(state.projects.map((p) => p.projectRoot ? normalizeProjectRoot(p.projectRoot) : p.id));
        let changed = false;
        for (const dp of repairPersistedText(diskProjects).map(ensureProjectAgent)) {
          const key = dp.projectRoot ? normalizeProjectRoot(dp.projectRoot) : dp.id;
          if (currentProjectRoots.has(key)) {
            const existing = state.projects.find((p) => (p.projectRoot ? normalizeProjectRoot(p.projectRoot) : p.id) === key);
            if (existing) {
              const existingChats = Array.isArray(existing.chats) ? existing.chats : [];
              const diskChats = Array.isArray(dp.chats) ? dp.chats : [];
              const chatMap = new Map();
              for (const c of existingChats) chatMap.set(c.id, c);
              for (const dc of diskChats) {
                if (!chatMap.has(dc.id)) {
                  chatMap.set(dc.id, dc);
                  changed = true;
                } else {
                  const curC = chatMap.get(dc.id);
                  const curMsgs = Array.isArray(curC.messages) ? curC.messages : [];
                  const diskMsgs = Array.isArray(dc.messages) ? dc.messages : [];
                  if (diskMsgs.length > curMsgs.length) {
                    chatMap.set(dc.id, { ...curC, ...dc, messages: diskMsgs });
                    changed = true;
                  }
                }
              }
              existing.chats = Array.from(chatMap.values());
            }
          }
        }
        if (changed) {
          saveProjects();
          renderProjects();
          try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
        }
      }
    }
    const sourceActiveId = state.activeProjectId || diskActive || storedActiveProjectId;

    // Solo hidratar chats del proyecto activo (el resto al abrirlo).
    const activeNow = state.projects.find((project) => project.id === (state.activeProjectId || sourceActiveId) && project.projectRoot)
      || state.projects.find((project) => project.id === sourceActiveId && project.projectRoot)
      || state.projects.find((project) => project.id === sourceActiveId)
      || (state.projects.length ? state.projects[0] : null);
    if (activeNow) {
      await hydrateProjectChatsFromDisk(activeNow);
      ensureProjectChats(activeNow);
      state.activeProjectId = activeNow.id;
      state.projectRoot = activeNow.projectRoot || "";
      const curChat = activeChat(activeNow);
      state.history = [...(curChat?.messages || activeNow.messages || [])];
      try { renderFeed({ force: true }); } catch { /* ignore */ }
      try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
    }

    refreshProjectCatalog().then(() => {
      try { window.EditCoreChatHome?.refresh?.(); } catch { /* ignore */ }
    }).catch(() => undefined);

    if (autoPick) {
      pickProject().catch(() => undefined);
    } else if (explicitOpenRoot) {
      const matched = state.projects.find((p) => normalizeProjectRoot(p.projectRoot) === normalizeProjectRoot(explicitOpenRoot));
      if (matched) selectProject(matched.id, { render: true }).catch(() => undefined);
    } else if (activeNow && (!state.activeProjectId || state.activeProjectId === activeNow.id)) {
      selectProject(activeNow.id, { render: !chatFirst, preview: !chatFirst }).catch(() => undefined);
    }

    // Tareas durables: no bloquean UI.
    if (window.editcoreTasks) {
      window.editcoreTasks.list().then(async (durableTasks) => {
        const visible = (durableTasks || []).filter((task) => [
          "READY", "WAITING", "AWAITING_AUTHORIZATION", "PLAN_READY", "APPROVED",
          "PAUSED", "RECOVERABLE", "RECOVERING",
        ].includes(task.status));
        for (const durableTask of visible.slice(0, 8)) {
          const recovered = ["READY", "RECOVERABLE", "AWAITING_AUTHORIZATION", "PLAN_READY"].includes(durableTask.status)
            ? await window.editcoreTasks.describeWorkflow(durableTask.taskId).catch(() => null)
            : null;
          const project = state.projects.find((item) => item.id === durableTask.projectId)
            || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(durableTask.projectRoot));
          if (!project || project.agentWorkflow?.phase === "executing") continue;
          const awaitingAuthorization = durableTask.status === "AWAITING_AUTHORIZATION"
            || durableTask.status === "PLAN_READY"
            || recovered?.awaitingAuthorization === true
            || (durableTask.status === "READY" && (recovered?.nextAction || durableTask.nextAction)?.type === "AUTHORIZE");
          project.durableWorkflow = recovered || {
            taskId: durableTask.taskId,
            state: durableTask.status,
            goal: durableTask.goal,
            planId: durableTask.planId || "",
            planContent: recovered?.planContent || "",
            awaitingAuthorization,
          };
          project.agentWorkflow = {
            ...(project.agentWorkflow || {}), taskId: durableTask.taskId,
            planId: durableTask.planId || recovered?.planId || project.agentWorkflow?.planId || "",
            task: recovered?.goal || durableTask.goal || project.agentWorkflow?.task || "Tarea persistente",
            plan: recovered?.planContent || project.agentWorkflow?.plan || "",
            phase: awaitingAuthorization ? "awaiting_authorization" : "interrupted", runId: "", updatedAt: Date.now(),
            error: awaitingAuthorization ? "" : durableTask.recoveryReason || (durableTask.status === "READY" ? "Tarea pendiente de ejecucion." : "Tarea persistente disponible para continuar."),
            durableStatus: durableTask.status, currentStage: recovered?.currentStage || durableTask.currentStage,
            currentStepId: recovered?.currentStepId || durableTask.currentStepId, nextAction: recovered?.nextAction || durableTask.nextAction,
            lastCheckpointId: recovered?.lastCheckpoint?.checkpointId || durableTask.lastCheckpointId || "",
          };
        }
        renderProjects();
      }).catch(() => undefined);
    }

    ensureDefaultModelSelectionMode().catch(() => undefined);
    // Capacidades de modelos / conexiones: en Chat diferir hasta idle largo o IDE.
    if (chatFirst) {
      const later = typeof requestIdleCallback === "function"
        ? (fn) => requestIdleCallback(() => { void fn(); }, { timeout: 12000 })
        : (fn) => setTimeout(() => { void fn(); }, 5000);
      later(() => {
        refreshModelCapabilities(false).catch(() => undefined);
        syncChatModelFromConfig();
        renderConnectionStatus(false).catch(() => undefined);
      });
    } else {
      refreshModelCapabilities(false).catch(() => undefined);
      syncChatModelFromConfig();
      renderConnectionStatus(false).catch(() => undefined);
      if (!isWelcomeScreenVisible()) renderProjectFiles().catch(() => undefined);
    }
    window.editcoreAgent.setPermission(bootPermission).then((mode) => {
      applyPermissionMode(mode);
    }).catch(() => undefined);
    syncProjectsToMaintenanceScheduler();
    window.editcoreProject?.onMaintenanceCompleted?.((result) => {
      if (!result || result.ok) return;
      $("status").textContent = `Mantenimiento: ${result.unhealthy} alerta(s)`;
    });
    if (diskProjects.length || state.projects.length) {
      try {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
        if (WINDOW_ID === "main" && sourceActiveId) {
          localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, sourceActiveId);
        }
      } catch { /* ignore */ }
    }
    performance.mark?.("editcore-boot-background-done");
  } catch (error) {
    console.warn("[bootBackground]", error?.message || error);
  }
}

// ── Fetch models ──────────────────────────────────────────────────────────────

async function fetchModels() {
  const apiKey = $("apiKey").value.trim();
  const baseUrl = $("baseUrl").value.trim() || "https://api.apicredits.site/v1";
  const btn = $("fetchModelsBtn");
  const dot = $("apiStatusDot");

  function setDot(state, title) {
    if (!dot) return;
    dot.className = `api-dot${state ? " " + state : ""}`;
    dot.title = title || "Estado API";
  }

  if (!apiKey) {
    setDot("", "Sin API key");
    btn.textContent = "↓ Ver modelos";
    return;
  }

  btn.textContent = "Verificando…";
  btn.disabled = true;
  setDot("checking", "Verificando…");

  try {
    if (typeof window.editcoreModels?.list !== "function") {
      throw new Error("bridge");
    }
    const models = await window.editcoreModels.list({ apiKey, baseUrl, providerKey: providerKeyForEndpoint(baseUrl) });
    const sel = $("model");
    const current = sel.value;
    sel.replaceChildren();
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m; opt.textContent = m;
      sel.appendChild(opt);
    }
    sel.value = models.includes(current) ? current : (models[0] || "");
    setChatModelOptions(models, sel.value);
    setDot("active", `API activa · ${models.length} modelos`);
    btn.textContent = "↓ Ver modelos";
  } catch {
    setDot("inactive", "API no responde o clave inválida");
    btn.textContent = "↓ Ver modelos";
  } finally {
    btn.disabled = false;
  }
}

// ── Fallback providers ────────────────────────────────────────────────────────

function loadFallbackProviders() {
  return loadJson("editcore-fallback-providers", []);
}

function saveFallbackProviders(list) {
  saveSecureJson("editcore-fallback-providers", list);
}

function renderFallbackProviders() {
  const container = $("fallbackProviders");
  if (!container) return;
  const list = loadFallbackProviders();
  container.replaceChildren();
  if (!list.length) return;
  const label = document.createElement("div");
  label.style.cssText = "font-size:11px;font-weight:800;color:#6c7a89;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;margin-top:4px;";
  label.textContent = "Proveedores de respaldo";
  container.appendChild(label);
  list.forEach((prov, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr 28px;gap:6px;align-items:center;margin-bottom:7px;";
    const nameEl = document.createElement("input");
    nameEl.value = prov.name || "";
    nameEl.placeholder = "Nombre";
    nameEl.style.cssText = "height:30px;padding:0 8px;font-size:12px;border:1px solid #cbd3dc;border-radius:6px;background:#fff;color:#17202a;width:100%;";
    nameEl.oninput = () => { list[i].name = nameEl.value.trim(); saveFallbackProviders(list); };

    const urlEl = document.createElement("input");
    urlEl.value = prov.baseUrl || "";
    urlEl.placeholder = "https://api.../v1";
    urlEl.style.cssText = nameEl.style.cssText;
    urlEl.oninput = () => { list[i].baseUrl = urlEl.value.trim(); saveFallbackProviders(list); };

    const keyEl = document.createElement("input");
    keyEl.type = "password";
    keyEl.value = prov.apiKey || "";
    keyEl.placeholder = "API Key";
    keyEl.style.cssText = nameEl.style.cssText;
    keyEl.onchange = () => { list[i].apiKey = keyEl.value.trim(); saveFallbackProviders(list); };

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "×";
    delBtn.title = "Eliminar";
    delBtn.style.cssText = "height:30px;width:28px;border:1px solid #e0e5ea;border-radius:6px;background:transparent;color:#9aacba;font-size:16px;cursor:pointer;padding:0;";
    delBtn.onclick = () => { list.splice(i, 1); saveFallbackProviders(list); renderFallbackProviders(); };

    row.append(nameEl, urlEl, keyEl, delBtn);
    container.appendChild(row);
  });
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:10px;color:#9aacba;margin-top:2px;";
  hint.textContent = "Nombre · Endpoint · API Key";
  container.appendChild(hint);
}

function addFallbackProvider() {
  const list = loadFallbackProviders();
  list.push({ name: "", baseUrl: "https://api.apicredits.site/v1", apiKey: "" });
  saveFallbackProviders(list);
  renderFallbackProviders();
}

function wireComposerControls() {
  $("runMode")?.addEventListener("change", () => {
    if ($("runMode").value === "agent" && state.permissionMode !== "full") {
      applyPermissionMode("full");
      const project = activeProject();
      if (project) { project.permissionMode = "full"; saveProjects(); }
    }
    updateSendButtonState();
  });

  $("permissionsBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPermissionMenuOpen($("permissionMenu")?.classList.contains("hidden"));
  });

  $("permissionMenu")?.querySelectorAll("[data-permission]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const selected = btn.dataset.permission;
      setPermissionMenuOpen(false);
      try {
        const mode = await window.editcoreAgent.setPermission(selected);
        applyPermissionMode(mode);
      } catch (error) {
        applyPermissionMode(selected);
        $("status").textContent = error?.message || `Permiso actualizado a ${selected}`;
      }
      const project = activeProject();
      if (project) { project.permissionMode = state.permissionMode; project.updatedAt = Date.now(); saveProjects(); }
      const labels = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" };
      const hints = {
        readonly: "Solo lectura del proyecto abierto",
        step: "Escritura con confirmacion en el proyecto abierto",
        full: "Acceso completo autorizado (edicion y ejecucion directa)",
      };
      $("status").textContent = `Permisos: ${labels[state.permissionMode] || state.permissionMode} · ${hints[state.permissionMode] || ""}`;
    });
  });

  $("chatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    triggerChatSend();
  });
  $("sendBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if ($("sendBtn")?.dataset?.mode === "stop") {
      void cancelActiveResponse();
      return;
    }
    triggerChatSend();
  });

  let _editcoreSpeechRecognizer = null;
  let _isVoiceRecording = false;
  let _dictationWindowsUnsub = null;
  let _dictationMode = ""; // "webkit" | "windows" | "media"
  let _dictationMediaRecorder = null;
  let _dictationMediaStream = null;
  let _dictationMediaChunks = [];

  function getActiveDictationTargets() {
    const home = $("chatHomePrompt");
    const ide = $("prompt");
    const chatMode = document.body.dataset.appMode === "chat";
    const primary = chatMode ? (home || ide) : (ide || home);
    const secondary = chatMode ? (ide && ide !== primary ? ide : null) : (home && home !== primary ? home : null);
    return { primary, secondary, home, ide, chatMode };
  }

  function writeDictationToPrompts(text) {
    const value = String(text || "");
    const { primary, secondary } = getActiveDictationTargets();
    const apply = (el) => {
      if (!el) return;
      el.value = value;
      try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* ignore */ } }
      try {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      } catch { /* ignore */ }
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch { /* ignore */ }
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch { /* ignore */ }
    };
    apply(primary);
    apply(secondary);
    try { updateSendButtonState?.(); } catch { /* ignore */ }
  }

  function setDictationUiActive(active) {
    $("voiceBtn")?.classList.toggle("active", Boolean(active));
    $("voiceBtn")?.setAttribute("aria-pressed", active ? "true" : "false");
    $("chatHomeMicBtn")?.classList.toggle("is-listening", Boolean(active));
    $("chatHomeMicBtn")?.setAttribute("aria-pressed", active ? "true" : "false");
  }

  async function stopWindowsDictationBridge() {
    try { _dictationWindowsUnsub?.(); } catch { /* ignore */ }
    _dictationWindowsUnsub = null;
    try { await window.editcoreApp?.windowsSttStop?.(); } catch { /* ignore */ }
  }

  async function stopLiveVoiceDictation({ silent = false } = {}) {
    if (_dictationMode === "webkit" && _editcoreSpeechRecognizer) {
      try { _editcoreSpeechRecognizer.stop(); } catch { /* ignore */ }
      _editcoreSpeechRecognizer = null;
    }
    if (_dictationMode === "media" && _dictationMediaRecorder) {
      try {
        if (_dictationMediaRecorder.state !== "inactive") _dictationMediaRecorder.stop();
      } catch { /* ignore */ }
      _dictationMediaRecorder = null;
      try { _dictationMediaStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
      _dictationMediaStream = null;
    }
    if (_dictationMode === "windows" || _dictationWindowsUnsub) {
      await stopWindowsDictationBridge();
    }
    _dictationMode = "";
    _isVoiceRecording = false;
    setDictationUiActive(false);
    if (!silent) toast("Dictado finalizado");
  }

  async function startWindowsDictationFallback(initialPrompt = "") {
    if (typeof window.editcoreApp?.windowsSttStart !== "function") {
      return { ok: false, error: "Windows STT no disponible" };
    }
    let base = String(initialPrompt || "");
    if (base && !base.endsWith(" ")) base += " ";
    let committed = "";
    try { _dictationWindowsUnsub?.(); } catch { /* ignore */ }
    _dictationWindowsUnsub = window.editcoreApp.onWindowsSttText?.((text) => {
      const chunk = String(text || "").trim();
      if (!chunk) return;
      committed = committed ? `${committed} ${chunk}` : chunk;
      writeDictationToPrompts(`${base}${committed}`.trimStart());
    }) || null;
    const result = await window.editcoreApp.windowsSttStart();
    if (!result?.ok) {
      await stopWindowsDictationBridge();
      return result || { ok: false, error: "Windows STT no inició" };
    }
    _dictationMode = "windows";
    _isVoiceRecording = true;
    setDictationUiActive(true);
    try { getActiveDictationTargets().primary?.focus?.(); } catch { /* ignore */ }
    toast("Escuchando… habla ahora (Windows)");
    return { ok: true };
  }

  async function startMediaRecorderDictation(initialPrompt = "") {
    if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return { ok: false, error: "MediaRecorder no disponible" };
    }
    if (typeof window.editcoreApp?.transcribeAudio !== "function") {
      return { ok: false, error: "Bridge de transcripción ausente" };
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return { ok: false, error: err?.message || "Sin permiso de micrófono" };
    }
    _dictationMediaStream = stream;
    _dictationMediaChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    _dictationMediaRecorder = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) _dictationMediaChunks.push(ev.data);
    };
    recorder.onstop = () => {
      void (async () => {
        try {
          const blob = new Blob(_dictationMediaChunks, { type: recorder.mimeType || "audio/webm" });
          _dictationMediaChunks = [];
          if (!blob.size) {
            toast("No se capturó audio. Intenta de nuevo.");
            return;
          }
          toast("Transcribiendo…");
          const buffer = await blob.arrayBuffer();
          const result = await window.editcoreApp.transcribeAudio(buffer, blob.type || "audio/webm");
          const text = String(result?.text || result?.transcript || "").trim();
          if (!text) {
            toast(result?.error || "No se pudo transcribir el audio.");
            return;
          }
          const base = String(initialPrompt || "");
          const next = base && !base.endsWith(" ") ? `${base} ${text}` : `${base}${text}`;
          writeDictationToPrompts(next.trimStart());
          toast("Dictado listo");
        } catch (err) {
          toast(err?.message || "Error al transcribir");
        } finally {
          try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
          if (_dictationMediaStream === stream) _dictationMediaStream = null;
          _dictationMediaRecorder = null;
          if (_dictationMode === "media") {
            _dictationMode = "";
            _isVoiceRecording = false;
            setDictationUiActive(false);
          }
        }
      })();
    };
    recorder.start(250);
    _dictationMode = "media";
    _isVoiceRecording = true;
    setDictationUiActive(true);
    toast("Grabando… pulsa el mic otra vez para transcribir");
    return { ok: true };
  }

  async function _toggleLiveVoiceDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const { primary } = getActiveDictationTargets();

    if (!primary) {
      toast("No hay campo de chat para dictar.");
      return;
    }

    if (_isVoiceRecording) {
      // Media: stop dispara transcripción; Windows/Webkit: cortar escucha.
      if (_dictationMode === "media" && _dictationMediaRecorder) {
        try { _dictationMediaRecorder.stop(); } catch { /* ignore */ }
        return;
      }
      await stopLiveVoiceDictation();
      return;
    }

    const initialPrompt = String(primary.value || "");
    try { primary.focus({ preventScroll: true }); } catch { try { primary.focus(); } catch { /* ignore */ } }

    // En Electron, Web Speech suele “activar” y no devolver texto (error network).
    // Preferir Windows STT nativo; luego MediaRecorder+Whisper; Web Speech al final.
    if (typeof window.editcoreApp?.windowsSttStart === "function") {
      const win = await startWindowsDictationFallback(initialPrompt);
      if (win?.ok) return;
      console.warn("[Dictation] Windows STT falló:", win?.error);
    }

    const media = await startMediaRecorderDictation(initialPrompt);
    if (media?.ok) return;

    if (SpeechRecognition) {
      try {
        _editcoreSpeechRecognizer = new SpeechRecognition();
        _editcoreSpeechRecognizer.lang = "es-MX";
        _editcoreSpeechRecognizer.continuous = true;
        _editcoreSpeechRecognizer.interimResults = true;
        const initialWithSpace = initialPrompt && !initialPrompt.endsWith(" ")
          ? `${initialPrompt} `
          : initialPrompt;

        _editcoreSpeechRecognizer.onstart = () => {
          _dictationMode = "webkit";
          _isVoiceRecording = true;
          setDictationUiActive(true);
          toast("Escuchando… habla ahora");
        };

        _editcoreSpeechRecognizer.onresult = (event) => {
          let finalStr = "";
          let interimStr = "";
          for (let i = 0; i < event.results.length; i++) {
            const item = event.results[i];
            if (item.isFinal) finalStr += `${item[0].transcript} `;
            else interimStr += item[0].transcript;
          }
          writeDictationToPrompts((initialWithSpace + finalStr + interimStr).trimStart());
        };

        _editcoreSpeechRecognizer.onerror = (event) => {
          const err = String(event?.error || "");
          console.warn("[Dictation] webkit error:", err);
          _isVoiceRecording = false;
          setDictationUiActive(false);
          _dictationMode = "";
          if (err === "not-allowed") toast("Permiso de micrófono denegado.");
          else if (err === "no-speech") toast("No se escuchó voz.");
          else toast(err ? `Dictado: ${err}` : "Dictado falló");
        };

        _editcoreSpeechRecognizer.onend = () => {
          if (_dictationMode === "webkit") {
            _isVoiceRecording = false;
            setDictationUiActive(false);
            _dictationMode = "";
          }
        };

        _editcoreSpeechRecognizer.start();
        return;
      } catch (err) {
        console.warn("[Dictation] webkit start failed", err?.message || err);
      }
    }

    toast(media?.error || "Dictado no disponible. Prueba Win + H o revisa el micrófono.");
  }

  window.EditCoreDictation = {
    toggle: () => { void _toggleLiveVoiceDictation(); },
    isActive: () => _isVoiceRecording === true,
    write: (text) => writeDictationToPrompts(text),
  };

  $("voiceBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void _toggleLiveVoiceDictation();
  });
  // chatHomeMicBtn → chat-home.js → EditCoreDictation.toggle (sin doble toggle).
  $("stopBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void cancelActiveResponse();
  });

  $("chatModelSelect")?.addEventListener("change", async (event) => {
    const option = event.target.selectedOptions[0];
    if (option?.dataset?.configure === "1") {
      syncChatModelFromConfig();
      openProviders();
      return;
    }
    if (AutoModel.isAutoModelSelection(option)) {
      const config = loadJson("editcore-chat-config", {});
      const autoProviderScope = AutoModel.parseAutoSelectionScope(option);
      await saveSecureJson("editcore-chat-config", {
        ...config,
        remember: true,
        modelSelectionMode: "auto",
        autoProviderScope,
      });
      state.modelSelectionAuto = true;
      state.lastAutoResolvedModel = "";
      // Al activar Auto, anclar ya un modelo con tools del proveedor (evita chat solo-lectura).
      const bootProfile = resolveActiveChatProfile({
        isAgent: true,
        usesProjectTools: true,
        requireAgentTools: true,
        autoProviderScope,
        planAuthorizedExecution: true,
      });
      if (bootProfile) {
        await syncAutoResolvedProvider(bootProfile, { keepPickerOpen: true });
      } else {
        updateModelPickerLabel();
        updateStatus();
        $("status").textContent = AutoModel.isScopedAutoProvider(autoProviderScope)
          ? `Auto · ${AutoModel.AUTO_SCOPE_LABELS[autoProviderScope] || autoProviderScope}: sin modelos verificados con tools`
          : "Auto: sin modelos verificados con tools";
      }
      updateModelPickerLabel();
      updateStatus();
      return;
    }
    const model = option?.dataset.model?.trim() || "";
    if (!model) {
      openProviders();
      return;
    }
    const config = loadJson("editcore-chat-config", {});
    const providerKey = option.dataset.providerKey || config.providerKey || providerKeyForEndpoint(config.baseUrl);
    const profileId = option.dataset.profileId || "";
    const providerData = loadJson("editcore-providers", {})[providerKey] || {};
    const profile = loadProviderProfiles().find((item) => item.id === profileId && item.status === "active")
      || verifiedProfileForModel(providerKey, model);
    const baseUrl = profile?.baseUrl || providerData.baseUrl || config.baseUrl || PROVIDERS[providerKey]?.baseUrl || "";
    const apiKey = profile?.apiKey || providerData.apiKey || config.apiKey || "";
    await activateProvider({ baseUrl, apiKey, model, providerKey, profileId: profile?.id || "" });
    updateModelPickerLabel();
    updateStatus();
  });

  $("modelPickerBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $("modelPickerMenu");
    setModelPickerOpen(menu?.classList.contains("hidden"));
  });

  $("attachBtn")?.addEventListener("click", () => $("fileInput")?.click());
  $("fileInput")?.addEventListener("change", (e) => {
    addFiles(e.target.files || []).catch((err) => { $("status").textContent = err?.message || String(err); });
    e.target.value = "";
  });

  const handlePasteAttach = (e) => {
    const files = collectClipboardFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files).catch((err) => { $("status").textContent = err?.message || String(err); });
  };
  $("prompt")?.addEventListener("paste", handlePasteAttach);
  $("chatHomePrompt")?.addEventListener("paste", handlePasteAttach);

  const setupAttachDropTarget = (el) => {
    if (!el) return;
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");
      const files = [...(e.dataTransfer?.files || [])].filter(isAttachableFile);
      if (files.length) {
        addFiles(files).catch((err) => { $("status").textContent = err?.message || String(err); });
      }
    });
  };
  setupAttachDropTarget($("chatForm"));
  setupAttachDropTarget($("prompt"));
  setupAttachDropTarget($("feed"));
  setupAttachDropTarget($("chatHomeComposer"));
  setupAttachDropTarget($("chatHomePrompt"));
  setupAttachDropTarget($("chatHomeStage"));
  setupAttachDropTarget($("chatHomeFeedHost"));

  window.EditCoreAttachments = {
    openPicker: () => $("fileInput")?.click(),
    addFiles: (files) => addFiles(files),
    clear: () => { state.attachments = []; renderAttachments(); },
    list: () => (state.attachments || []).slice(),
  };

  $("prompt")?.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const field = $("prompt");
      const value = field?.value || "";
      const accept = field?.dataset?.ghostAccept || "";
      if (accept) {
        e.preventDefault();
        field.value = accept.includes("\n") || accept.length > value.length
          ? accept
          : value.replace(/(@?[\w./-]*)$/, accept);
        field.dataset.ghostAccept = "";
        const ghost = $("promptGhost");
        if (ghost) ghost.innerHTML = "";
        updateSendButtonState();
        $("status").textContent = "Tab: predicción aplicada";
        return;
      }
      if (/@?[\w./-]{2,}$/.test(value) && window.editcoreAgent?.tabPredict) {
        e.preventDefault();
        window.editcoreAgent.tabPredict({
          projectRoot: state.projectRoot || "",
          prompt: value,
          history: state.history || [],
        }).then((out) => {
          const pick = out?.accept || out?.candidates?.[0]?.text;
          if (!pick || !field) return;
          field.value = pick.includes("\n") || pick.length > value.length
            ? pick
            : value.replace(/(@?[\w./-]*)$/, pick);
          updateSendButtonState();
          $("status").textContent = `Tab: ${String(pick).slice(0, 80)} (${out?.latencyMs || 0}ms)`;
        }).catch(() => undefined);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      triggerChatSend();
    }
  });

  let ghostTimer = null;
  const refreshGhost = () => {
    const field = $("prompt");
    const ghost = $("promptGhost");
    if (!field || !ghost || !window.editcoreAgent?.tabPredict) return;
    const value = field.value || "";
    if (value.length < 2) {
      ghost.innerHTML = "";
      field.dataset.ghostAccept = "";
      return;
    }
    // No fantasmas en frases naturales ("hola por…") — solo rutas/símbolos.
    if (/\s/.test(value.trim()) && !/[@/\\.]/.test(value.slice(-24))) {
      ghost.innerHTML = "";
      field.dataset.ghostAccept = "";
      return;
    }
    window.editcoreAgent.tabPredict({
      projectRoot: state.projectRoot || "",
      prompt: value,
      history: state.history || [],
    }).then((out) => {
      if ((field.value || "") !== value) return; // obsoleto
      const suffix = String(out?.ghost || "");
      const accept = String(out?.accept || out?.candidates?.[0]?.text || "");
      field.dataset.ghostAccept = accept;
      if (!suffix) {
        ghost.innerHTML = "";
        return;
      }
      const escaped = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const escapedSuffix = suffix
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      ghost.innerHTML = `${escaped}<span class="ghost-suffix">${escapedSuffix}</span>`;
    }).catch(() => undefined);
  };

  $("prompt")?.addEventListener("input", () => {
    updateSendButtonState();
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(refreshGhost, 120);
  });
  $("prompt")?.addEventListener("scroll", () => {
    const ghost = $("promptGhost");
    const field = $("prompt");
    if (ghost && field) ghost.scrollTop = field.scrollTop;
  });

  setupMentionAutocomplete($("prompt"), $("mentionPopup"));
}

function setupMentionAutocomplete(promptEl, popupEl) {
  if (!promptEl || !popupEl) return;

  const escapeHtml = (str) => String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  let mentionState = {
    active: false,
    query: "",
    startIndex: -1,
    candidates: [],
    selectedIndex: 0,
  };

  const getMentionMatch = () => {
    const text = promptEl.value || "";
    const cursor = promptEl.selectionStart || 0;
    const beforeCursor = text.slice(0, cursor);
    const match = /(?:^|\s)@([a-zA-Z0-9_\-.:/]*)$/.exec(beforeCursor);
    if (!match) return null;
    const matchFull = match[0];
    const atOffset = matchFull.indexOf("@");
    const startIndex = match.index + atOffset;
    return {
      query: match[1] || "",
      startIndex,
      endIndex: cursor,
    };
  };

  const renderCandidates = () => {
    if (!mentionState.candidates.length) {
      popupEl.classList.add("hidden");
      popupEl.innerHTML = "";
      mentionState.active = false;
      return;
    }
    popupEl.innerHTML = "";
    mentionState.candidates.forEach((cand, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = "mention-item" + (idx === mentionState.selectedIndex ? " selected" : "");
      itemEl.setAttribute("role", "option");
      itemEl.setAttribute("aria-selected", idx === mentionState.selectedIndex ? "true" : "false");

      const icon = cand.type === "file" ? "📄" :
                   cand.type === "symbol" ? "⚡" :
                   cand.type === "problems" ? "⚠️" :
                   cand.type === "git" ? "🌿" :
                   cand.type === "docs" ? "🧠" : "📌";

      itemEl.innerHTML = `
        <span class="mention-item-icon">${icon}</span>
        <span class="mention-item-label">${escapeHtml(cand.label || cand.insertText)}</span>
        ${cand.detail ? `<span class="mention-item-detail">${escapeHtml(cand.detail)}</span>` : ""}
      `;

      itemEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyCandidate(cand);
      });

      popupEl.appendChild(itemEl);
    });
    popupEl.classList.remove("hidden");
    mentionState.active = true;

    const selectedEl = popupEl.children[mentionState.selectedIndex];
    if (selectedEl && typeof selectedEl.scrollIntoView === "function") {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  };

  const applyCandidate = (cand) => {
    if (!cand) return;
    const match = getMentionMatch();
    const text = promptEl.value || "";
    const start = match ? match.startIndex : mentionState.startIndex;
    const end = promptEl.selectionStart || text.length;
    if (start < 0) return;

    const insert = cand.insertText ? (cand.insertText.endsWith(":") ? cand.insertText : cand.insertText + " ") : "";
    const newText = text.slice(0, start) + insert + text.slice(end);
    promptEl.value = newText;
    const newCursor = start + insert.length;
    promptEl.selectionStart = newCursor;
    promptEl.selectionEnd = newCursor;

    popupEl.classList.add("hidden");
    popupEl.innerHTML = "";
    mentionState.active = false;
    promptEl.focus();
    promptEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const updateCandidates = async () => {
    const match = getMentionMatch();
    if (!match) {
      popupEl.classList.add("hidden");
      popupEl.innerHTML = "";
      mentionState.active = false;
      return;
    }
    mentionState.startIndex = match.startIndex;
    mentionState.query = match.query;
    try {
      if (window.editcoreProject?.queryMentions) {
        const list = await window.editcoreProject.queryMentions(state.projectRoot || "", match.query);
        mentionState.candidates = Array.isArray(list) ? list : [];
      } else {
        mentionState.candidates = [];
      }
    } catch {
      mentionState.candidates = [];
    }
    mentionState.selectedIndex = 0;
    renderCandidates();
  };

  promptEl.addEventListener("input", () => {
    updateCandidates().catch(() => undefined);
  });

  promptEl.addEventListener("keydown", (e) => {
    if (!mentionState.active || popupEl.classList.contains("hidden")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      mentionState.selectedIndex = (mentionState.selectedIndex + 1) % mentionState.candidates.length;
      renderCandidates();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      mentionState.selectedIndex = (mentionState.selectedIndex - 1 + mentionState.candidates.length) % mentionState.candidates.length;
      renderCandidates();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (mentionState.candidates[mentionState.selectedIndex]) {
        e.preventDefault();
        e.stopPropagation();
        applyCandidate(mentionState.candidates[mentionState.selectedIndex]);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      popupEl.classList.add("hidden");
      mentionState.active = false;
      return;
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (!popupEl.contains(e.target) && e.target !== promptEl) {
      popupEl.classList.add("hidden");
      mentionState.active = false;
    }
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

try { wireComposerControls(); } catch (err) {
  console.error("[EditCoreAI] wireComposerControls failed", err);
  try { $("status").textContent = "Error UI chat: " + (err?.message || err); } catch { /* ignore */ }
}

$("connectionsBtn")?.addEventListener("click", openConnections);
$("closeConnectionsBtn")?.addEventListener("click", closeConnections);
$("detectConnectionsBtn")?.addEventListener("click", detectConnections);
$("validateConnectionsBtn")?.addEventListener("click", () => {
  renderConnectionStatus(true).catch((error) => {
    $("status").textContent = error?.message || String(error);
  });
});
$("connectGatewayProjectBtn")?.addEventListener("click", () => {
  $("status").textContent = "Usa el panel Modelos (ME AI / APICredits) para conectar proveedores.";
});
$("saveGafcoreAdminTokenBtn")?.addEventListener("click", () => {
  $("status").textContent = "Usa el panel Modelos (ME AI / APICredits) para conectar proveedores.";
});
$("openGafcoreDashboardBtn")?.addEventListener("click", () => {
  $("status").textContent = "Usa el panel Modelos (ME AI / APICredits) para conectar proveedores.";
});
$("providersBtn")?.addEventListener("click", openProviders);
$("addCustomProviderBtn")?.addEventListener("click", () => addCustomProvider());
$("closeProvidersBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeProviders(); });
$("brainBtn")?.addEventListener("click", () => openBrain().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("closeBrainBtn")?.addEventListener("click", (e) => { e.preventDefault(); $("brainDialog")?.close(); });
$("brainSearchBtn")?.addEventListener("click", () => loadBrainCatalog().catch((error) => {
  $("brainStatus").textContent = error?.message || String(error);
}));
$("brainAuditBtn")?.addEventListener("click", runBrainAudit);
$("brainInstallRepoBtn")?.addEventListener("click", installBrainRepo);
$("brainSearch")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadBrainCatalog().catch((error) => { $("brainStatus").textContent = error?.message || String(error); });
  }
});
$("brainRepoUrl")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    installBrainRepo();
  }
});
$("inspectorBtn")?.addEventListener("click", () => openInspector().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("closeInspectorBtn").addEventListener("click", () => $("inspectorDialog").close());
$("inspectorChatTab")?.addEventListener("click", () => inspectorSetTab("chat"));
$("inspectorReportsTab")?.addEventListener("click", () => inspectorSetTab("reports"));
$("inspectorSendBtn").addEventListener("click", () => sendInspectorPrompt());
$("inspectorHandoffBtn")?.addEventListener("click", () => prepareInspectorCorrection());
document.querySelectorAll("[data-inspector-action]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.inspectorAction === "cancel") {
      cancelInspectorJob().catch((error) => {
        inspectorHealth("error", error?.message || String(error));
      });
      return;
    }
    const target = button.dataset.inspectorTarget === "project" ? "project" : "editcore";
    if (activeInspectorJob) return;
    if (button.dataset.inspectorAction === "repair") repairInspectorTarget(target);
    else runInspectorScan(target);
  });
});
document.querySelectorAll("[data-inspector-area]").forEach((button) => {
  button.addEventListener("click", () => {
    const area = button.dataset.inspectorArea;
    if (area) {
      runInspectorEvaluation(area).catch((error) => {
        inspectorHealth("error", error?.message || String(error));
      });
    }
  });
});
$("inspectorPrompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendInspectorPrompt();
  }
});

$("connectionsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("saveConnectionsBtn");
  button.disabled = true;
  try {
    await saveConnections();
    $("status").textContent = "Conexiones guardadas; revisa el estado verificado de cada servicio";
  } catch (error) {
    $("status").textContent = error?.message || "No se pudieron verificar las conexiones";
  } finally {
    button.disabled = false;
  }
});

$("providersForm").addEventListener("submit", (e) => {
  e.preventDefault();
  saveProviders().then(() => closeProviders()).catch(() => undefined);
});

document.querySelectorAll("[data-add-provider-profile]").forEach((button) => {
  button.addEventListener("click", () => addProviderProfile(button.dataset.addProviderProfile));
});

document.querySelectorAll("[data-bulk-add-profiles]").forEach((button) => {
  button.addEventListener("click", () => bulkAddProviderProfiles(button.dataset.bulkAddProfiles));
});

// Activar hardcoded providers via event delegation
$("providersDialog").addEventListener("click", (e) => {
  const key = e.target.dataset?.provActivate;
  if (!key || !PROVIDERS[key]) return;
  e.preventDefault();
  e.stopPropagation();
  verifyProvider(key)
    .then((provider) => activateProvider(provider))
    .catch((error) => {
      $("status").textContent = `API no activada: ${sanitizeProviderIpcError(error)}`;
    });
});

// Connection buttons
document.querySelector(".conn-connect-btn[data-service='github']")
  ?.addEventListener("click", connectGitHub);
document.querySelector(".conn-connect-btn[data-service='vercel']")
  ?.addEventListener("click", connectVercel);
document.querySelector(".conn-connect-btn[data-service='selfsupabase']")
  ?.addEventListener("click", connectSelfSupabase);

$("newProjectBtn").addEventListener("click", openNewProjectDialog);
$("saveProjectBtn")?.addEventListener("click", saveCurrentProjectEntry);
$("saveProjectForm").addEventListener("submit", confirmCurrentProjectSave);
$("closeSaveProjectBtn").addEventListener("click", () => $("saveProjectDialog").close());
$("cancelSaveProjectBtn").addEventListener("click", () => $("saveProjectDialog").close());
$("newProjectForm").addEventListener("submit", createProjectFromDialog);
$("pickProjectParentBtn").addEventListener("click", async () => {
  const picked = await window.editcoreProject.pickParent();
  if (picked) $("newProjectParent").value = picked;
});
$("cancelProjectCreateBtn").addEventListener("click", cancelProjectCreate);
$("closeNewProjectBtn").addEventListener("click", () => { if (!projectCreateRunning) $("newProjectDialog").close(); });
$("closeProjectsBtn").addEventListener("click", () => $("projectsDialog").close());
$("projectsOpenExistingBtn").addEventListener("click", () => pickProject().catch((err) => { $("status").textContent = err?.message || String(err); }));
$("projectsSaveCurrentBtn").addEventListener("click", saveCurrentProjectEntry);
$("verifyAgentBtn")?.addEventListener("click", runAgentVerification);

window.editcoreAgent.onApprovalRequest((request) => {
  try {
    appendAgentApprovalCard(request);
  } catch (error) {
    console.error("[Agent approval UI]", error);
    window.editcoreAgent.respondApproval({ requestId: request?.requestId, approved: false }).catch(() => false);
  }
});

if (typeof window.editcoreAgent.onThoughtStream === "function") {
  window.editcoreAgent.onThoughtStream((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    // Los deltas de narración ya llegan por agent:progress (narration_delta).
    // Ignorar thought-stream delta evita "VoyVoy…" / palabras cortadas.
    if (payload?.delta) return;
    appendCursorThought(thinking, payload?.text || "", { delta: false });
  });
}
if (typeof window.editcoreAgent.onExplorationStart === "function") {
  window.editcoreAgent.onExplorationStart((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    setAgentLiveActivity(thinking, String(payload?.detail || "Explorando…"));
    if (payload?.query || payload?.detail) {
      thinking._exploredItems ||= new Map();
      const label = String(payload.query || payload.detail || "");
      thinking._exploredItems.set(`start:${label}`, {
        tool: payload.tool || "explore",
        label,
        path: label,
      });
      upsertExplorationUi(thinking, { items: [...thinking._exploredItems.values()] });
    }
  });
}
if (typeof window.editcoreAgent.onExplorationEnd === "function") {
  window.editcoreAgent.onExplorationEnd((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    upsertExplorationUi(thinking, payload || {});
    setAgentLiveActivity(thinking, String(payload?.summary || "Exploración lista"));
  });
}
if (typeof window.editcoreAgent.onDiffProposed === "function") {
  window.editcoreAgent.onDiffProposed((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    upsertInlineDiffCard(thinking, payload || {});
    const name = String(payload?.filePath || "").split(/[/\\]/).pop();
    if (name) setAgentLiveActivity(thinking, `Diff: ${name}`);
  });
}
if (typeof window.editcoreAgent.onDiffApplied === "function") {
  window.editcoreAgent.onDiffApplied((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    markInlineDiffApplied(thinking, payload?.filePath || "");
    upsertInlineDiffCard(thinking, { ...(payload || {}), applied: true });
  });
}
if (typeof window.editcoreAgent.onTaskComplete === "function") {
  window.editcoreAgent.onTaskComplete((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    if (Array.isArray(payload?.changedFiles)) {
      thinking._changedFiles = [...new Set([...(thinking._changedFiles || []), ...payload.changedFiles])];
    }
    settleAgentTurnChrome(thinking, { failed: payload?.ok === false, force: true });
  });
}
if (typeof window.editcoreAgent.onComplete === "function") {
  window.editcoreAgent.onComplete((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    const files = Array.isArray(payload?.report?.changedFiles)
      ? payload.report.changedFiles
      : (Array.isArray(payload?.changedFiles) ? payload.changedFiles : []);
    if (files.length) {
      thinking._changedFiles = [...new Set([...(thinking._changedFiles || []), ...files])];
      for (const filePath of files) markInlineDiffApplied(thinking, filePath);
    }
    settleAgentTurnChrome(thinking, { failed: payload?.completed === false, force: true });
  });
}
if (typeof window.editcoreAgent.onError === "function") {
  window.editcoreAgent.onError((payload) => {
    const thinking = resolveThinkingForTransparency(payload);
    if (!thinking) return;
    settleAgentTurnChrome(thinking, { failed: true, force: true });
    setAgentLiveActivity(thinking, String(payload?.error || payload?.message || "Error del agente").slice(0, 160));
  });
}

window.editcoreAgent.onProgress((progress) => {
  try {
    if (Date.now() < agentUiHardStopUntil) return;
    if (progress?.phase === "pipeline" || progress?.pipeline) {
      applyPipelineProgress(progress);
      if (progress?.phase === "pipeline" && !progress?.name && !progress?.text) return;
    }
    const planStream = activePlanStreams.get(progress?.runId);
    if (planStream) {
      if (progress.phase === "plan_delta") addPlanDelta(planStream.thinking, progress.text);
      else if (progress.phase === "plan_stage") setThinkingStatus(planStream.thinking, "Pensando...");
      return;
    }
    if (activeInspectorChatRun?.runId === progress?.runId) {
      const thinkingEl = activeInspectorChatRun.thinking;
      if (thinkingEl) thinkingEl.textContent = inspectorChatToolLabel(progress);
      return;
    }
    if (activeInspectorRepairRun?.runId === progress?.runId) {
      for (const file of progress.changedFiles || []) activeInspectorRepairRun.changedFiles.add(file);
      setInspectorProgress(Math.min(72, 30 + Number(progress.index || 0) * 4), `Reparando EditCore: ${progress.name || "accion"}...`, "running");
      return;
    }

    const liveRun = activeAgentThinkingRuns.get(progress?.runId);
    // Si hay runId pero no hay thinking de ese run, NO pintar en otro agente paralelo.
    const thinkingEl = liveRun?.thinking
      || (!progress?.runId ? document.querySelector(".thinking-msg") : null);
    if (!thinkingEl) return;
    if (
      thinkingEl.classList.contains("agent-execution-done")
      && !activeAgentThinkingRuns.has(progress?.runId)
    ) {
      return;
    }

    if (progress.phase === "narration_reset") {
      // NO borrar el texto ya mostrado (provocaba pasos a medias / rearmados).
      // Solo liberar locks para el siguiente tramo.
      flushAgentStreamRender(thinkingEl);
      thinkingEl._lastNarrationDelta = "";
      thinkingEl._toolDumpLocked = false;
      return;
    }
    if (progress.phase === "final_report") {
      // Informe oficial del orquestador: reemplaza Avances y queda listo para pintar.
      const report = String(progress.text || "").trim();
      if (report) {
        flushAgentStreamRender(thinkingEl);
        thinkingEl._streamBuffer = report;
        thinkingEl._lastNarrationFp = "";
        const log = thinkingEl.querySelector?.(".agent-narrative-log");
        if (log) {
          for (const row of [...log.querySelectorAll(".agent-narration")]) row.remove();
        }
        thinkingEl._streamRow = null;
        let finalBody = thinkingEl.querySelector?.(".agent-final-response");
        if (!finalBody) {
          const body = thinkingEl.querySelector?.(".msg-body");
          if (body) {
            finalBody = document.createElement("div");
            finalBody.className = "agent-final-response";
            body.appendChild(finalBody);
          }
        }
        if (finalBody) finalBody.innerHTML = renderMarkdown(repairMojibakeText(report));
        setThinkingStatus(thinkingEl, "Informe listo...");
        setAgentLiveActivity(thinkingEl, "");
      }
      return;
    }
    if (progress.phase === "awaiting_authorization") {
      if (state.permissionMode === "full") {
        setThinkingStatus(thinkingEl, "Acceso completo: aplicando sin pedir PROCEDE...");
        setAgentLiveActivity(thinkingEl, "");
        return;
      }
      setThinkingStatus(thinkingEl, String(progress.text || "Esperando tu autorización...").trim());
      setAgentLiveActivity(thinkingEl, "");
      const primary = thinkingEl.querySelector?.(".thinking-primary");
      if (primary) primary.style.display = "none";
      return;
    }
    if (progress.phase === "narration_delta") {
      // Solo addAgentNarrationDelta — NO appendCursorThought (duplicaba cada token).
      addAgentNarrationDelta(thinkingEl, progress.text, progress.index);
      const note = String(progress.text || "");
      const avanceMatch = note.match(/^#{1,6}\s*Avance\s*[—\-–]?\s*(.+)$/im);
      if (avanceMatch) {
        const short = avanceMatch[1].replace(/`/g, "").trim().slice(0, 120);
        setAgentLiveActivity(thinkingEl, short ? `Avance: ${short}` : "Avance del analisis...");
      } else {
        const cur = String(thinkingEl?.querySelector?.(".thinking-status")?.textContent || "").trim();
        if (!cur || /^(?:Trabajando\.\.\.|Pensando\.\.\.|Razonando(?:\s+soluci[oó]n)?\.\.\.|Analizando proyecto\.\.\.|Esperando al modelo|Consultando al modelo)/i.test(cur)) {
          setAgentLiveActivity(thinkingEl, "Redactando respuesta...");
        }
      }
      inferPipelineFromText(progress.text);
      return;
    }
    if (progress.phase === "narration") {
      if (shouldAcceptNarrationProgress(thinkingEl, progress.text)) {
        addAgentNarration(thinkingEl, progress.text, progress.index);
      }
      // No appendCursorThought: addAgentNarration ya espeja al Thought; duplicaba el buffer.
      const cur = String(thinkingEl?.querySelector?.(".thinking-status")?.textContent || "").trim();
      if (!cur || /^(?:Trabajando\.\.\.|Pensando\.\.\.|Redactando respuesta\.\.\.)/i.test(cur)) {
        setAgentLiveActivity(thinkingEl, "Redactando respuesta...");
      }
      inferPipelineFromText(progress.text);
      const project = state.projects.find((item) => item.id === progress?.projectId)
        || state.projects.find((item) => item.id === liveRun?.projectId)
        || activeProject();
      const targetRun = project?.agentWorkflow?.runId === progress?.runId
        ? project.agentWorkflow
        : project?.agentRuns?.find((item) => item.runId === progress?.runId);
        if (targetRun) {
          targetRun.narration ||= [];
          targetRun.narration.push({ index: Number(progress.index) || 0, text: String(progress.text || ""), at: Date.now() });
          targetRun.lastNarration = String(progress.text || "").slice(0, 2000);
          targetRun.updatedAt = Date.now();
          // Debounce: guardar en cada chunk congela el chat y refuerza el titileo.
          if (liveRun) {
            if (liveRun._narrationSaveTimer) clearTimeout(liveRun._narrationSaveTimer);
            liveRun._narrationSaveTimer = setTimeout(() => {
              liveRun._narrationSaveTimer = null;
              saveProjects();
            }, 1200);
          } else {
            saveProjects();
          }
      }
      return;
    }

    // Tools van al log. startup/model/heartbeat SOLO en la fila de actividad (sin duplicar ni marcadores).
    const isToolStep = progress.phase === "tool" || (!progress.phase && progress.name);
    const isLogPhase = ["confirm", "repair", "human_intervention", "direction"].includes(progress?.phase);
    const narrative = agentProgressText(progress);
    if (isToolStep || isLogPhase) {
      addAgentStepToThinking(thinkingEl, progress);
      if (isToolStep) {
        if (narrative) {
          appendThoughtLine(thinkingEl, narrative, { kind: "action" });
          setAgentLiveActivity(thinkingEl, narrative);
          $("status").textContent = narrative;
        }
        notifyAgentFileMutationProgress(thinkingEl, progress);
        // Espejo Cursor: exploración + diffs inline desde tools
        const toolName = String(progress.name || "");
        const target = String(progress.input?.path || progress.input?.filePath || progress.input?.query || "").trim();
        if (/^(?:list_files|read_file|search_files|grep|codebase_map|project_discovery|brain_search)$/i.test(toolName)) {
          if (target) {
            thinkingEl._exploredItems ||= new Map();
            thinkingEl._exploredItems.set(`${toolName}:${target}`, {
              tool: toolName,
              path: target,
              label: target,
              ok: progress.ok !== false,
            });
          }
          if (progress.stage === "done" || progress.ok === true || progress.ok === false) {
            upsertExplorationUi(thinkingEl, {
              count: thinkingEl._exploredItems?.size || 0,
              items: [...(thinkingEl._exploredItems?.values?.() || [])],
            });
          }
        }
        if (/^(?:write_file|replace_in_file|apply_diff|write_to_file|replace_file_content|patch|edit_file|modify_file)$/i.test(toolName)) {
          const fragment = ProjectFilesUi?.buildMutationFragment?.(progress, state.projectRoot) || progress.fragment;
          let unifiedDiff = String(progress.diff || progress.unifiedDiff || "").trim();
          if (!unifiedDiff && fragment) {
            const lines = [];
            if (fragment.oldText) {
              for (const line of String(fragment.oldText).split("\n").slice(0, 40)) lines.push(`-${line}`);
            }
            if (fragment.newText || fragment.content) {
              for (const line of String(fragment.newText || fragment.content).split("\n").slice(0, 60)) lines.push(`+${line}`);
            }
            if (lines.length) unifiedDiff = lines.join("\n");
          }
          upsertInlineDiffCard(thinkingEl, {
            filePath: target || fragment?.path || "",
            additions: (unifiedDiff.match(/^\+/gm) || []).length,
            deletions: (unifiedDiff.match(/^-/gm) || []).length,
            unifiedDiff,
            applied: progress.stage === "done" || progress.ok === true,
          });
          if (progress.stage === "done" || progress.ok === true) {
            markInlineDiffApplied(thinkingEl, target || fragment?.path || "");
            // Abrir el archivo tocado en Monaco con gutters
            const openRel = ProjectFilesUi?.resolveTouchedRelativePath?.(state.projectRoot, target || fragment?.path || "")
              || String(target || fragment?.path || "");
            if (openRel && window.EditCoreEditor?.openFile && state.projectRoot) {
              openPathInEditor(openRel, unifiedDiff).catch((error) => {
                $("status").textContent = `Editor: ${error?.message || error}`;
              });
            }
          }
        }
        if (/^run_command$/i.test(toolName) && target) {
          if (progress.stage === "running" || progress.ok === undefined) {
            window.EditCoreTerminal?.show?.()
              .then(() => window.EditCoreTerminal.writeAgentCommand(target))
              .catch(() => undefined);
          }
        }
      }
    }
    if (progress?.phase === "startup") {
      const label = narrative || String(progress.text || "Iniciando...").trim();
      setAgentLiveActivity(thinkingEl, label);
      if (label) $("status").textContent = label;
      return;
    }
    if (progress?.phase === "background_start" || progress?.phase === "background") {
      const label = narrative || String(progress.text || "Segundo plano…").trim();
      setAgentLiveActivity(thinkingEl, label);
      if (label) $("status").textContent = label;
      return;
    }
    if (progress?.phase === "background_complete" || progress?.phase === "background_error") {
      const label = narrative || String(progress.text || "").trim();
      if (label) {
        setAgentLiveActivity(thinkingEl, label.slice(0, 220));
        $("status").textContent = label.slice(0, 160);
        addAgentNarration(thinkingEl, label);
      }
      return;
    }
    if (progress?.phase === "specialist") {
      const detail = String(progress.text || "").trim();
      if (detail) appendThoughtLine(thinkingEl, `🧠 ${detail}`, { kind: "meta" });
      $("status").textContent = detail || "Analizando…";
      return;
    }
    if (progress?.phase === "subagent") {
      const name = String(progress.name || "agent").toLowerCase();
      const detail = String(progress.text || "").trim();
      const label = detail || name;
      appendThoughtLine(thinkingEl, `🧠 ${label}`, { kind: "meta" });
      setAgentLiveActivity(thinkingEl, label);
      $("status").textContent = label;
      if (name === "auto-heal" || name === "verifier" || name === "global-memory") {
        showPreviewHealBanner({
          title: name === "global-memory" ? "Memoria global" : (name === "auto-heal" ? "Auto-heal silencioso" : "Verifier"),
          message: detail || "Corrigiendo en segundo plano…",
          tone: /falló|error|rollback/i.test(detail) ? "warn" : "ok",
        });
      }
      return;
    }
    if (progress?.phase === "model") {
      if (progress.silentFailover === true && typeof window.addLog === "function") {
        const from = String(progress.fromModel || "").trim();
        const to = String(progress.toModel || "").trim();
        if (from || to) window.addLog("info", `Failover silencioso${from ? ` desde ${from}` : ""}${to ? ` → ${to}` : ""}`);
      }
      const label = sanitizeLiveActivityLabel(narrative || progress.text || "Trabajando…");
      setAgentLiveActivity(thinkingEl, label);
      $("status").textContent = label;
      return;
    }
    if (progress?.phase === "heartbeat") {
      const currentStatus = String(thinkingEl?.querySelector?.(".thinking-status")?.textContent || "");
      const sec = Math.max(0, Math.floor(Number(progress.elapsedMs || 0) / 1000));
      const clock = formatElapsed(sec);
      const stripped = currentStatus
        .replace(/\s*\((?:\d+s|\d+:\d{2})\)$/i, "")
        .replace(/\s+[….]{1,3}\s*(?:\d+s|\d+:\d{2})$/i, "")
        .replace(/\s+(?:\d+s|\d+m\s+\d{1,2}s|\d+h\s+\d{1,2}m|\d+:\d{2})$/i, "")
        .trim();
      let label = "";
      // UX Cursor-like: no mostrar "Esperando al modelo"; solo "Trabajando…" + reloj.
      if (/^(?:Esperando\s+al\s+modelo|Consultando\s+al\s+modelo|Siguiente\s+paso|Modelo\s+|Trabajando)/i.test(stripped)
        || !stripped) {
        label = sec > 0 ? `Trabajando… ${clock}` : "Trabajando…";
      } else if (stripped && !/^(?:Trabajando\.\.\.|Pensando\.\.\.|Razonando(?:\s+soluci[oó]n)?\.\.\.|Analizando proyecto\.\.\.)$/i.test(stripped)) {
        label = sec > 0 ? `${sanitizeLiveActivityLabel(stripped)} (${clock})` : sanitizeLiveActivityLabel(stripped);
      } else {
        label = narrative || (sec ? `Trabajando… ${clock}` : "Trabajando…");
      }
      setAgentLiveActivity(thinkingEl, label);
      $("status").textContent = label;
      return;
    }
    if (narrative) {
      setAgentLiveActivity(thinkingEl, narrative);
      $("status").textContent = narrative;
    }
    if (progress.ok === false && (isToolStep || isLogPhase)) {
      $("status").textContent = `Agente encontro un error en ${progress.name || "una accion"}; ajustando la ejecucion`;
    }
    if (["confirm", "repair", "human_intervention", "direction"].includes(progress?.phase)) {
      if (narrative) {
        setAgentLiveActivity(thinkingEl, narrative);
        $("status").textContent = narrative;
      }
      return;
    }

    // Refresco del árbol de archivos NO depende de targetRun: el kernel puede
    // escribir en disco aunque el runId no esté enlazado al agentWorkflow.
    if (isToolStep && progress.ok !== false && progress.stage === "done"
      && ["write_file", "replace_in_file", "create_project", "apply_diff", "delete_file"].includes(String(progress.name || ""))) {
      const payload = ProjectFilesUi?.filesChangedPayload
        ? ProjectFilesUi.filesChangedPayload(progress, state.projectRoot)
        : { writtenPath: String(progress.input?.path || ""), fileName: "", autoPreview: false };
      handleProjectFilesChanged(payload);
    }
    const project = state.projects.find((item) => item.id === progress?.projectId)
      || state.projects.find((item) => item.id === liveRun?.projectId)
      || activeProject();
    const targetRun = project?.agentWorkflow?.runId === progress?.runId
      ? project.agentWorkflow
      : project?.agentRuns?.find((item) => item.runId === progress?.runId);
    if (!targetRun) return;
    if (!isToolStep) return;
    targetRun.checkpoints ||= [];
    const checkpoint = {
      index: progress.index,
      name: progress.name,
      ok: progress.ok !== false,
      changedFiles: progress.changedFiles || [],
      commands: progress.commands || [],
      input: progress.input || {},
      result: progress.result || {},
    };
    const existingIndex = targetRun.checkpoints.findIndex((item) => item.index === checkpoint.index && item.name === checkpoint.name);
    if (existingIndex >= 0) targetRun.checkpoints[existingIndex] = checkpoint;
    else targetRun.checkpoints.push(checkpoint);
    targetRun.updatedAt = Date.now();
    saveProjects();
    try {
      const project = state.projects.find((item) => item.id === progress?.projectId)
        || state.projects.find((item) => item.id === liveRun?.projectId)
        || activeProject();
      const targetRun = project?.agentWorkflow?.runId === progress?.runId
        ? project.agentWorkflow
        : project?.agentRuns?.find((item) => item.runId === progress?.runId);
      updateAgentPlanPanel({
        steps: targetRun?.checkpoints || [],
        planText: project?.agentWorkflow?.plan || "",
        checkpoints: targetRun?.checkpoints || [],
      });
    } catch {}
  } catch (error) {
    console.error("[Agent progress UI]", error);
    const errThinking = activeAgentThinkingRuns.get(progress?.runId)?.thinking
      || (!progress?.runId ? document.querySelector(".thinking-msg") : null);
    if (errThinking) setThinkingStatus(errThinking, "Actualizando progreso del agente...");
  }
});
window.editcoreProject.onProgress(updateProjectCreateProgress);
if (window.editcoreProject.onFilesChanged) {
  window.editcoreProject.onFilesChanged(handleProjectFilesChanged);
}
if (window.editcoreProject.onPreviewUpdated) {
  window.editcoreProject.onPreviewUpdated((payload) => {
    if (!payload?.url) return;
    if (normalizeProjectRoot(payload.projectRoot) !== normalizeProjectRoot(state.projectRoot)) return;
    $("previewUrl").value = payload.url;
    openPreview({ forceReload: true }).catch((error) => {
      showPreviewStatus(`Vista previa: ${error?.message || String(error)}`);
    });
    $("status").textContent = payload.reason === "auto-heal"
      ? "Preview recargado tras auto-heal"
      : "Navegador interno conectado al proyecto";
  });
}
if (window.editcoreProject.onPreviewLog) {
  window.editcoreProject.onPreviewLog((payload) => {
    if (!payload) return;
    if (payload.projectRoot && normalizeProjectRoot(payload.projectRoot) !== normalizeProjectRoot(state.projectRoot)) return;
    if (payload.type === "preview-issue" && payload.issue?.summary) {
      if (isIgnorablePreviewConsoleMessage(payload.issue.summary)) return;
      if (!previewExpectedUrl && !$("previewUrl")?.value?.trim()) return;
      pushPreviewRuntimeError(payload.issue.summary, payload.issue.kind === "fatal" ? "error" : "warn");
      $("status").textContent = payload.wakeVerifier
        ? `VERIFIER · ${payload.issue.summary}`.slice(0, 160)
        : `Preview: ${payload.issue.summary}`.slice(0, 160);
      if (payload.autoHeal || payload.wakeVerifier) {
        setAgentSpecialistBadge("verifier", payload.issue.summary);
        showPreviewHealBanner({
          title: "Auto-heal activado",
          message: `Verifier despertado: ${payload.issue.summary}`,
          tone: "warn",
          ttlMs: 16000,
        });
      }
    } else if (payload.type === "process-log" && payload.chunk) {
      // streaming de run_command / process-runner (no spamear status)
    } else if (payload.type === "preview-heal-start") {
      $("status").textContent = "Auto-heal · VERIFIER en curso…";
      setAgentSpecialistBadge("auto-heal", payload.issue?.summary || "");
      showPreviewHealBanner({
        title: "Auto-heal en segundo plano",
        message: payload.issue?.summary || "Corrigiendo error de preview sin esperar al chat…",
        tone: "ok",
        ttlMs: 20000,
      });
    } else if (payload.type === "preview-heal-done") {
      const healOk = payload.ok !== false;
      const msg = String(payload.text || "").trim()
        || (healOk ? "Caché de Next.js regenerada exitosamente" : "Auto-heal del preview listo");
      $("status").textContent = msg.slice(0, 160);
      showPreviewHealBanner({
        title: healOk ? "Caché de Next.js regenerada exitosamente" : "Auto-heal incompleto",
        message: msg.slice(0, 240),
        tone: healOk ? "ok" : "warn",
        ttlMs: 16000,
      });
      openPreview({ forceReload: true }).catch(() => {});
    } else if (payload.type === "preview-heal-progress" && (payload.phase === "subagent" || payload.uiMessage || payload.label)) {
      const healName = String(payload.name || "auto-heal");
      const progressText = String(payload.uiMessage || payload.text || payload.label || "").slice(0, 120);
      $("status").textContent = `Heal · ${healName}: ${progressText}`.slice(0, 160);
      setAgentSpecialistBadge(healName, progressText);
      if (healName === "global-memory" || healName === "verifier" || healName === "auto-heal") {
        showPreviewHealBanner({
          title: /regenerada exitosamente/i.test(progressText)
            ? "Caché de Next.js regenerada exitosamente"
            : (healName === "global-memory" ? "Memoria global aprendiendo" : "Verifier / Auto-heal"),
          message: progressText.slice(0, 220),
          tone: "ok",
          ttlMs: 12000,
        });
      }
    } else if (payload.type === "preview-heal-skipped") {
      showPreviewHealBanner({
        title: "Auto-heal omitido",
        message: payload.reason === "missing-api"
          ? "Falta API key para auto-corregir en segundo plano."
          : String(payload.reason || "omitido"),
        tone: "warn",
      });
    }
  });
}
if (window.editcoreProject.onUiCommand) {
  window.editcoreProject.onUiCommand((cmd) => {
    applyProjectUiCommand(cmd).catch((error) => {
      const requestId = String(cmd?.requestId || "");
      if (requestId && window.editcoreProject?.replyUiCommand) {
        window.editcoreProject.replyUiCommand({
          requestId,
          action: String(cmd?.action || ""),
          ok: false,
          error: error?.message || String(error),
        });
      }
    });
  });
}
$("newChatBtn")?.addEventListener("click", () => createNewChatThread());
$("closeActiveChatBtn")?.addEventListener("click", () => {
  const project = activeProject();
  const id = project?.activeChatId || activeChat(project)?.id;
  if (id) closeChatThread(id);
});

$("restoreSnapshotBtn")?.addEventListener("click", () => {
  restoreSnapshotFromUi().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
refreshUndoAgentRunButton();
renderChatThreadSelect();

$("toggleProjectsBtn").addEventListener("click", openProjectsDialog);

$("welcomeHomeBtn")?.addEventListener("click", () => {
  showWelcomeScreen();
});
$("welcomeOpenBtn")?.addEventListener("click", () => {
  pickProject().catch((err) => { $("status").textContent = err?.message || String(err); });
});
$("welcomeNewBtn")?.addEventListener("click", () => {
  openNewProjectDialog();
});
$("welcomeViewAllBtn")?.addEventListener("click", () => {
  openProjectsDialog();
});

$("pickProjectBtn").addEventListener("click", () =>
  pickProject().catch((err) => { $("projectPathLabel").textContent = err?.message || String(err); })
);
$("closeProjectBtn")?.addEventListener("click", () => {
  closeOpenProject().catch((err) => { $("status").textContent = err?.message || String(err); });
});

$("openPreviewBtn").addEventListener("click", refreshPreview);
$("inspectBrowserBtn")?.addEventListener("click", () => {
  inspectPreviewFromUi().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("closeBrowserInspectBtn")?.addEventListener("click", () => {
  $("browserInspectPanel")?.classList.add("hidden");
});
$("browserInspectClickBtn")?.addEventListener("click", () => {
  runPreviewInteract("click").catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("browserInspectTypeBtn")?.addEventListener("click", () => {
  runPreviewInteract("type").catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("browserInspectRefreshBtn")?.addEventListener("click", () => {
  inspectPreviewFromUi().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("browserInspectSelector")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runPreviewInteract("click").catch(() => undefined);
  }
});
$("browserInspectText")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runPreviewInteract("type").catch(() => undefined);
  }
});
$("previewBackBtn")?.addEventListener("click", () => {
  const webview = $("previewWebview");
  if (previewHistoryIndex > 0) navigatePreviewHistory(previewHistoryIndex - 1);
  else updatePreviewNavigationControls(webview);
});
$("webPreviewBtn")?.addEventListener("click", () => setPreviewMode("web"));
$("mobilePreviewBtn")?.addEventListener("click", () => setPreviewMode("mobile"));
$("codePreviewBtn")?.addEventListener("click", () => setPreviewMode("code"));
$("saveEditorBtn")?.addEventListener("click", () => {
  window.EditCoreEditor?.saveCurrent?.().catch((error) => {
    $("status").textContent = `Guardar: ${error?.message || error}`;
  });
});
$("gotoDefBtn")?.addEventListener("click", () => {
  window.EditCoreEditor?.goToDefinition?.().catch((error) => {
    $("status").textContent = `F12: ${error?.message || error}`;
  });
});
$("terminalBtn")?.addEventListener("click", () => {
  setToolbarMenuOpen("toolsMoreBtn", "toolsMoreMenu", false);
  window.EditCoreTerminal?.show?.().catch((error) => {
    $("status").textContent = error?.message || String(error);
  });
});
$("terminalRestartBtn")?.addEventListener("click", () => {
  window.EditCoreTerminal?.start?.(state.projectRoot || "").catch((error) => {
    $("status").textContent = error?.message || String(error);
  });
});
document.querySelectorAll(".viewer-logs-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.getAttribute("data-tab");
    document.querySelectorAll(".viewer-logs-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const logs = $("tab-logs");
    const term = $("tab-terminal");
    if (name === "terminal") {
      if (logs) { logs.classList.remove("active"); logs.hidden = true; }
      if (term) { term.hidden = false; term.classList.add("active"); }
      window.EditCoreTerminal?.show?.().catch(() => undefined);
    } else {
      if (term) { term.classList.remove("active"); term.hidden = true; }
      if (logs) { logs.hidden = false; logs.classList.add("active"); }
    }
  });
});
window.addEventListener("resize", () => {
  window.EditCoreEditor?.layout?.();
  window.EditCoreTerminal?.fit?.();
});
$("previewUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") openPreview(); });
$("previewWebview").addEventListener("did-start-loading", () => {
  $("previewWebview").dataset.previewReady = "0";
  clearPreviewRuntimeErrors();
  if (previewExpectedUrl) showPreviewLoading("Cargando navegador del proyecto...");
});
$("previewWebview").addEventListener("dom-ready", () => {
  schedulePreviewFit();
  void settlePreviewDocument();
});
$("previewWebview").addEventListener("did-navigate", (event) => {
  syncPreviewNavigation($("previewWebview"), event);
  schedulePreviewFit();
  void settlePreviewDocument();
});
$("previewWebview").addEventListener("did-navigate-in-page", (event) => {
  syncPreviewNavigation($("previewWebview"), event);
  void settlePreviewDocument();
});
$("previewWebview").addEventListener("did-finish-load", () => {
  schedulePreviewFit();
  void settlePreviewDocument();
});
$("previewWebview").addEventListener("did-stop-loading", () => {
  syncPreviewNavigation($("previewWebview"));
  void settlePreviewDocument();
});
$("previewWebview").addEventListener("did-fail-load", (event) => {
  if (event.errorCode === -3 || !previewExpectedUrl) return;
  const detail = [event.errorDescription, event.validatedURL].filter(Boolean).join(" · ");
  pushPreviewRuntimeError(detail || "Fallo al cargar el preview", "error");
  if (restoreLastSuccessfulPreview($("previewWebview"), event.validatedURL || previewExpectedUrl)) {
    $("status").textContent = `No se pudo abrir la ruta solicitada. ${detail || "Se restauro la pagina anterior."}`;
    void monitorPreviewHealth({ forceRecovery: true });
    return;
  }
  showPreviewStatus(`No se pudo cargar ${$("previewUrl").value || "el proyecto"}. ${detail || "Revisa el servidor del proyecto."}`);
  $("status").textContent = "El navegador no pudo cargar el proyecto";
  void monitorPreviewHealth({ forceRecovery: true });
});
$("previewWebview").addEventListener("console-message", (event) => {
  if (event.level >= 2 && previewExpectedUrl) {
    const msg = normalizePreviewConsoleMessage(event.message || "error").slice(0, 180);
    if (isIgnorablePreviewConsoleMessage(msg)) return;
    // Solo errores JS reales del proyecto (no red/CORS).
    $("status").textContent = `Navegador: ${msg}`;
    pushPreviewRuntimeError(msg, event.level >= 3 ? "error" : "warning");
  }
});

// Al navegar/recargar, vaciar basura acumulada del panel.
$("previewWebview").addEventListener("did-start-loading", () => {
  clearPreviewRuntimeErrors();
});
$("previewUrl").addEventListener("change", () => {
  if (state.projectRoot) {
    localStorage.setItem(projectUrlKey(state.projectRoot), $("previewUrl").value.trim());
  }
});

$("newWindowBtn").addEventListener("click", openNewWindow);
setupSplitter("splitChatBrowser");
setupSplitter("splitBrowserProjects");

new ResizeObserver(() => schedulePreviewFit()).observe(document.querySelector(".viewer-body"));
window.addEventListener("resize", schedulePreviewFit);

document.addEventListener("click", (e) => {
  if (!$("permissionsBtn")?.contains(e.target) && !$("permissionMenu")?.contains(e.target)) {
    setPermissionMenuOpen(false);
  }
  const pickerWrap = document.querySelector(".model-picker-wrap");
  if (pickerWrap && !pickerWrap.contains(e.target) && !$("modelPickerMenu")?.contains(e.target)) {
    setModelPickerOpen(false);
  }
});
window.addEventListener("resize", () => {
  if (!$("permissionMenu")?.classList.contains("hidden")) {
    positionFloatingMenu($("permissionMenu"), $("permissionsBtn"), { align: "left", gap: 6 });
  }
  if (!$("modelPickerMenu")?.classList.contains("hidden")) {
    positionFloatingMenu($("modelPickerMenu"), $("modelPickerBtn"), { align: "right", gap: 8 });
  }
});

function setChatModelOptions(_models = [], selected = "", selectedProviderKey = "", selectedProfileId = "") {
  const options = visibleChatModelOptions(verifiedChatModelOptions());
  const select = $("chatModelSelect");
  if (!select) return;
  select.replaceChildren();
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Configurar modelo";
    select.appendChild(option);
    select.disabled = false;
    select.title = "No hay un modelo verificado. Abre Proveedores para configurarlo.";
    select.dataset.noVerifiedModel = "1";
    return;
  }

  const config = loadJson("editcore-chat-config", {});
  const selectedAutoScope = AutoModel.isAutoModelSelection(selected)
    ? AutoModel.parseAutoSelectionScope(selected)
    : (config.modelSelectionMode === "auto" ? AutoModel.normalizeAutoProviderScope(config.autoProviderScope) : null);
  const wantAuto = selectedAutoScope !== null
    || config.modelSelectionMode === "auto"
    || selected === AutoModel.AUTO_MODEL_SELECTION
    || String(selected || "").startsWith(`${AutoModel.AUTO_MODEL_SELECTION}:`);

  // Auto (ambos proveedores) siempre primero.
  {
    const allAuto = document.createElement("option");
    allAuto.value = AutoModel.autoSelectionValue("all");
    allAuto.textContent = AutoModel.formatAutoLabel("all");
    allAuto.dataset.auto = "1";
    allAuto.dataset.autoScope = "all";
    allAuto.title = "EditCoreAI elige automáticamente entre ME AI Cloud y APICredits";
    select.appendChild(allAuto);
  }

  // Solo mostrar proveedores con perfiles verificados activos
  const providerKeys = [...new Set(options.map((entry) => entry.modelProviderGroup || entry.providerKey))];
  providerKeys.forEach((providerKey) => {
    const providerOptions = options.filter((entry) => (entry.modelProviderGroup || entry.providerKey) === providerKey);
    if (!providerOptions.length) return;
    const group = document.createElement("optgroup");
    group.label = providerOptions[0]?.providerLabel || PROVIDERS[providerKey]?.label || providerKey;
    const scopedAuto = AutoModel.isScopedAutoProvider?.(providerKey)
      ? AutoModel.normalizeAutoProviderScope(providerKey)
      : (providerKey === "meai" || providerKey === "apicredits" ? providerKey : "");
    if (scopedAuto && AutoModel.isScopedAutoProvider(scopedAuto)) {
      const autoOption = document.createElement("option");
      autoOption.value = AutoModel.autoSelectionValue(scopedAuto);
      autoOption.textContent = AutoModel.formatAutoLabel(scopedAuto);
      autoOption.dataset.auto = "1";
      autoOption.dataset.autoScope = scopedAuto;
      autoOption.title = `EditCoreAI elige automáticamente solo entre modelos ${AutoModel.AUTO_SCOPE_LABELS[scopedAuto] || scopedAuto}`;
      group.appendChild(autoOption);
    }
    providerOptions.forEach((entry) => {
      const option = document.createElement("option");
      option.value = `${entry.providerKey}:${entry.profileId || "provider"}:${entry.model}`;
      option.textContent = entry.providerKey === "custom:gafcore-gateway"
        ? String(entry.model).split("/").slice(1).join("/")
        : entry.model;
      option.dataset.model = entry.model;
      option.dataset.providerKey = entry.providerKey;
      option.dataset.profileId = entry.profileId;
      option.dataset.fullModel = entry.model;
      group.appendChild(option);
    });
    select.appendChild(group);
  });

  const configureOption = document.createElement("option");
  configureOption.value = CONFIGURE_MODELS_SELECTION;
  configureOption.textContent = "Configurar modelos…";
  configureOption.dataset.configure = "1";
  select.appendChild(configureOption);

  select.disabled = false;
  select.title = wantAuto ? "Auto: elige el mejor modelo verificado por tarea" : "Modelo activo";
  delete select.dataset.noVerifiedModel;
  if (wantAuto) {
    const scope = selectedAutoScope === null
      ? AutoModel.normalizeAutoProviderScope(config.autoProviderScope)
      : selectedAutoScope;
    const effectiveScope = scope || "all";
    const autoValue = AutoModel.autoSelectionValue(effectiveScope);
    if (![...select.options].some((option) => option.value === autoValue)) {
      const fallback = [...select.options].find((option) => option.dataset?.auto === "1");
      select.value = fallback?.value || select.options[0]?.value || "";
    } else {
      select.value = autoValue;
    }
    state.modelSelectionAuto = true;
    updateModelPickerLabel();
    return;
  }
  state.modelSelectionAuto = false;
  const selectedOption = [...select.options].find((option) =>
    option.dataset.model === selected
      && (!selectedProviderKey || option.dataset.providerKey === selectedProviderKey)
      && (!selectedProfileId || option.dataset.profileId === selectedProfileId)
  ) || [...select.options].find((option) => option.dataset.model === selected);
  select.value = selectedOption?.value || select.options[1]?.value || select.options[0].value;
  updateModelPickerLabel();
}

function syncChatModelFromConfig() {
  const config = loadJson("editcore-chat-config", {});
  const project = activeProject();
  const record = Object.values(loadJson("editcore-providers", {})).find((provider) => provider?.baseUrl === config.baseUrl);
  const key = project?.provider || config.providerKey || providerKeyForEndpoint(config.baseUrl);
  if (config.modelSelectionMode === "auto") {
    state.modelSelectionAuto = true;
    setChatModelOptions([], AutoModel.autoSelectionValue(config.autoProviderScope), "", "");
    updateStatus();
    return;
  }
  setChatModelOptions([], project?.model || config.model || record?.model || "", key, project?.providerProfileId || config.providerProfileId || "");
}

// Conectar / Publicar / Tema + Inspector health
$("connectProjectBtn")?.addEventListener("click", () => {
  onboardProjectFull().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("publishBtn")?.addEventListener("click", () => {
  fullStackDeployOneClick({ mode: "full" }).catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("themeCycleBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  cycleEditCoreTheme();
});
$("refreshMaintenanceBtn")?.addEventListener("click", () => refreshMaintenancePanel().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("saveMaintenanceSchedulerBtn")?.addEventListener("click", () => saveMaintenanceSchedulerUi().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("runMaintenanceNowBtn")?.addEventListener("click", () => runMaintenanceNowFromUi().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("createSupabaseProjectBtn")?.addEventListener("click", () => createSupabaseProjectFromPanel().catch((err) => {
  $("status").textContent = err?.message || String(err);
}));
$("updatesBtn")?.addEventListener("click", () => {
  closeAllToolbarMenus();
  reloadEditCoreApp().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
$("checkUpdatesMenuBtn")?.addEventListener("click", () => {
  closeAllToolbarMenus();
  checkAppUpdates().catch((err) => {
    $("status").textContent = err?.message || String(err);
  });
});
function setToolbarMenuOpen(btnId, menuId, open) {
  const btn = $(btnId);
  const menu = $(menuId);
  if (!btn || !menu) return;
  const next = open === true;
  btn.setAttribute("aria-expanded", next ? "true" : "false");
  menu.classList.toggle("hidden", !next);
  if (next) {
    menu.removeAttribute("hidden");
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.left = `${Math.round(rect.left)}px`;
  } else {
    menu.setAttribute("hidden", "");
  }
}

function closeAllToolbarMenus() {
  setToolbarMenuOpen("toolsMoreBtn", "toolsMoreMenu", false);
}

$("toolsMoreBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = $("toolsMoreBtn")?.getAttribute("aria-expanded") === "true";
  setToolbarMenuOpen("toolsMoreBtn", "toolsMoreMenu", !open);
});
$("toolsMoreMenu")?.addEventListener("click", () => {
  setTimeout(() => closeAllToolbarMenus(), 0);
});
document.addEventListener("click", (event) => {
  const wrap = event.target?.closest?.(".toolbar-more-wrap");
  if (wrap) return;
  closeAllToolbarMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllToolbarMenus();
});

async function reloadEditCoreApp() {
  $("status").textContent = "Reiniciando EditCore para aplicar cambios...";
  // Relanzar el proceso: carga main/renderer/Agent Core nuevos sin cerrar a mano.
  if (window.editcoreWindow?.relaunch) {
    try {
      await window.editcoreWindow.relaunch();
      return;
    } catch (error) {
      $("status").textContent = error?.message || "No pude reiniciar";
    }
  }
  // Fallback: al menos recargar la UI.
  if (window.editcoreWindow?.reload) {
    await window.editcoreWindow.reload();
    $("status").textContent = "UI recargada (nucleo puede requerir reinicio)";
    return;
  }
  appendMessage("assistant", "No pude reiniciar automaticamente. Cierra EditCore y vuelve a abrir el .exe.");
  $("status").textContent = "Recarga no disponible";
}

async function deployProjectOneClick() {
  if (!state.projectRoot) {
    appendMessage("assistant", "Abre un proyecto antes de desplegar.");
    return;
  }
  if (!window.editcoreProject?.deploy) {
    appendMessage("assistant", "Deploy one-click no disponible en esta build.");
    return;
  }
  $("status").textContent = "Desplegando...";
  const result = await window.editcoreProject.deploy({
    projectRoot: state.projectRoot,
    provider: "auto",
    production: true,
  });
  if (result?.cancelled) {
    $("status").textContent = "Deploy cancelado";
    return;
  }
  if (result?.ok) {
    const url = result.url ? `\nURL: ${result.url}` : "";
    appendMessage("assistant", `Deploy OK (${result.provider || "auto"}).${url}`);
    $("status").textContent = result.url || "Deploy completado";
    return;
  }
  appendMessage("assistant", result?.message || result?.hint || "Deploy fallido. Revisa Conexiones (Vercel) y que el CLI este instalado.");
  $("status").textContent = "Deploy fallido";
}

async function checkAppUpdates() {
  if (!window.editcoreApp?.checkUpdates) {
    appendMessage("assistant", "Comprobacion de actualizaciones no disponible en esta build.");
    $("status").textContent = "Updates no disponible";
    return;
  }
  $("status").textContent = "Buscando actualizaciones de EditCore...";
  let result;
  try {
    result = await window.editcoreApp.checkUpdates();
  } catch (error) {
    const msg = `No pude comprobar actualizaciones: ${error?.message || error}`;
    appendMessage("assistant", msg);
    $("status").textContent = "Error al buscar updates";
    return;
  }
  if (result?.idle || result?.configured === false) {
    appendMessage("assistant", [
      "## Actualizar EditCore",
      "",
      "Este boton busca **versiones nuevas de EditCoreAI** en GitHub Releases (no actualiza tu proyecto).",
      "",
      result?.message || "Todavia no hay canal de releases configurado.",
    ].join("\n"));
    $("status").textContent = "Sin canal de updates";
    return;
  }
  if (result?.available) {
    appendMessage("assistant", [
      "## Actualizacion disponible",
      "",
      result.message || `Hay una version nueva: ${result.latestVersion}`,
      result.htmlUrl || result.downloadUrl || "",
    ].filter(Boolean).join("\n"));
    $("status").textContent = `Update ${result.latestVersion}`;
    const url = result.downloadUrl || result.htmlUrl;
    if (url && window.editcoreApp.openExternal) {
      const ok = await window.editcoreWindow?.confirmDialog?.(
        "Actualizacion disponible",
        `Hay EditCore ${result.latestVersion} (tienes ${result.currentVersion || "?"}). ¿Abrir descarga?`,
        "Abrir",
        "Luego"
      );
      if (ok) await window.editcoreApp.openExternal(url);
    }
    return;
  }
  if (result?.checkFailed || result?.status === "checkFailed") {
    appendMessage("assistant", [
      "## No se pudo comprobar actualizaciones",
      "",
      result?.message || "Error de red o de GitHub al buscar releases de EditCore.",
      result?.repo ? `Canal: GitHub \`${result.repo}\`.` : "",
      "Esto no significa que EDITCOREAI este al dia.",
    ].filter(Boolean).join("\n"));
    $("status").textContent = "Error al buscar updates";
    return;
  }
  if (result?.status === "noReleases") {
    appendMessage("assistant", [
      "## Sin releases publicos",
      "",
      result?.message || "El canal de GitHub no tiene releases publicos todavia.",
      result?.repo ? `Canal: GitHub \`${result.repo}\`.` : "",
    ].filter(Boolean).join("\n"));
    $("status").textContent = "Sin releases publicos";
    return;
  }
  appendMessage("assistant", [
    "## EditCore al dia",
    "",
    result?.message || `Estas al dia (${result?.currentVersion || "version actual"}).`,
    result?.repo ? `Canal: GitHub \`${result.repo}\`.` : "",
  ].filter(Boolean).join("\n"));
  $("status").textContent = "EditCore al dia";
}
$("inspectorPublishBtn")?.addEventListener("click", () => publishChanges("editcore"));
$("inspectorSaveBtn")?.addEventListener("click", () => saveEditCoreChanges());

// Bridge Chat Home ↔ IDE (sin duplicar Agent Core).
window.createNewChatThread = createNewChatThread;
window.switchChatThread = switchChatThread;
window.closeChatThread = closeChatThread;
window.deleteChatThread = closeChatThread;
window.renameChatThread = renameChatThread;
window.selectProject = selectProject;
window.switchProject = (id) => selectProject(id);
window.removeProject = removeProject;
window.deleteProject = removeProject;
window.sendChatPrompt = (text) => triggerChatSend(text);
window.triggerChatSend = triggerChatSend;
window.getActiveChatThreadId = () => {
  const project = activeProject() || (Array.isArray(state.projects) && state.projects.length ? state.projects[0] : null);
  if (!project) return "";
  ensureProjectChats(project);
  return project.activeChatId || project.chats?.[0]?.id || "";
};
window.getChatThreads = () => {
  const list = [];
  const currentProj = activeProject() || (Array.isArray(state.projects) && state.projects.length ? state.projects[0] : null);
  for (const p of (state.projects || [])) {
    ensureProjectChats(p);
    const pName = p.title && p.title !== "Nuevo chat" && p.title !== "Proyecto" ? p.title : (p.projectRoot ? p.projectRoot.split(/[\\/]/).filter(Boolean).pop() : (p.name && p.name !== "Proyecto" ? p.name : "Proyecto"));
    for (const c of (p.chats || [])) {
      list.push({
        id: c.id,
        title: c.title || "Conversación",
        updatedAt: c.updatedAt || c.createdAt || Date.now(),
        createdAt: c.createdAt || Date.now(),
        projectId: p.id,
        projectRoot: p.projectRoot || "",
        projectName: pName,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
        isActive: c.id === currentProj?.activeChatId && p.id === currentProj?.id,
      });
    }
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};
window.getProjectsWithChats = () => {
  const currentProjId = state.activeProjectId;
  return (state.projects || []).map((p) => {
    ensureProjectChats(p);
    const pName = p.title && p.title !== "Nuevo chat" && p.title !== "Proyecto"
      ? p.title 
      : (p.projectRoot ? p.projectRoot.split(/[\\/]/).filter(Boolean).pop() : (p.name && p.name !== "Proyecto" ? p.name : "Proyecto"));
    return {
      id: p.id,
      name: pName,
      projectRoot: p.projectRoot || "",
      isActive: p.id === currentProjId,
      chats: (p.chats || []).map((c) => ({
        id: c.id,
        title: c.title || "Conversación",
        updatedAt: c.updatedAt || c.createdAt || Date.now(),
        createdAt: c.createdAt || Date.now(),
        projectId: p.id,
        projectName: pName,
        projectRoot: p.projectRoot || "",
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
        isActive: c.id === p.activeChatId && p.id === currentProjId,
      })),
    };
  });
};
window.listProjects = () => {
  return (state.projects || []).map((p) => ({
    id: p.id,
    name: p.title || p.name || (p.projectRoot ? p.projectRoot.split(/[\\/]/).filter(Boolean).pop() : "Proyecto"),
    projectRoot: p.projectRoot || "",
    isActive: p.id === state.activeProjectId,
  }));
};
window.openProjectFromDisk = () => pickProject();
window.openConnections = openConnections;
window.EditCoreModels = {
  openPicker: (anchor) => setModelPickerOpen(true, anchor || null),
  closePicker: () => setModelPickerOpen(false),
  isOpen: () => !$("modelPickerMenu")?.classList.contains("hidden"),
  openProviders: () => openProviders(),
};
window.EditCoreTheme = {
  apply: (theme) => applyEditCoreTheme(theme),
  cycle: () => cycleEditCoreTheme(),
  get: () => document.documentElement.getAttribute("data-theme") || "blanco",
  list: () => EDITCORE_THEMES.slice(),
};
window.EditCorePermissions = {
  apply: (mode) => applyPermissionMode(mode),
  get: () => state.permissionMode || "step",
  openMenu: (anchor) => setPermissionMenuOpen(true, anchor || null),
  closeMenu: () => setPermissionMenuOpen(false),
};
window.EditCoreSessionContext = {
  snapshot: async () => {
    const project = typeof activeProject === "function" ? activeProject() : null;
    const filesChanged = (Array.isArray(state.touchedRelativePaths) ? state.touchedRelativePaths : [])
      .filter(Boolean)
      .slice()
      .reverse()
      .map((path) => ({ title: path, path, meta: "modificado" }));
    const uploads = (Array.isArray(state.attachments) ? state.attachments : []).map((a) => ({
      title: a.name || "adjunto",
      meta: a.mimeType || (a.size ? `${Math.round(a.size / 1024)} KB` : ""),
    }));
    const agents = Array.isArray(project?.agents) ? project.agents : [];
    const subagents = agents
      .filter((a) => a && a.id !== project?.activeAgentId)
      .map((a) => ({
        title: a.name || "Subagente",
        meta: a.status || "idle",
      }));
    if (!subagents.length && agents.length > 1) {
      // fallback: list all but primary label
      for (const a of agents.slice(1)) {
        subagents.push({ title: a.name || "Subagente", meta: a.status || "idle" });
      }
    }
    const artifacts = [];
    const planTodos = document.querySelectorAll("#agentPlanTodos li");
    if (planTodos?.length) {
      artifacts.push({ title: "Plan del agente", meta: `${planTodos.length} paso(s)` });
    }
    const checkpoints = document.querySelectorAll("#agentPlanCheckpoints .agent-plan-checkpoint, #agentPlanCheckpoints [data-checkpoint]");
    if (checkpoints?.length) {
      artifacts.push({ title: "Checkpoints", meta: `${checkpoints.length}` });
    }
    if (project?.agentWorkflow?.plan) {
      artifacts.push({ title: "Plan persistente", meta: String(project.agentWorkflow.phase || "plan") });
    }
    if (project?.durableWorkflow?.taskId) {
      artifacts.push({
        title: `Task ${String(project.durableWorkflow.taskId).slice(0, 10)}…`,
        meta: project.durableWorkflow.state || "durable",
      });
    }
    let tasks = [];
    try {
      const list = await window.editcoreTasks?.list?.();
      tasks = (Array.isArray(list) ? list : [])
        .filter((t) => !["DONE", "CANCELLED", "FAILED"].includes(String(t.status || "").toUpperCase()))
        .slice(0, 20)
        .map((t) => ({
          title: t.goal || t.taskId || "Tarea",
          meta: t.status || "",
        }));
    } catch { /* ignore */ }
    let skills = [];
    try {
      const list = await window.editcoreSkills?.list?.(state.projectRoot || "");
      skills = (Array.isArray(list) ? list : [])
        .filter((s) => !s.disabled)
        .slice(0, 30)
        .map((s) => ({
          title: s.name || "skill",
          meta: s.category || s.description || "activa",
        }));
    } catch { /* ignore */ }
    return { subagents, filesChanged, artifacts, uploads, tasks, skills };
  },
};

window.EditCoreDiffDecisions = {
  createCard: ({ filePath = "", diff = "", oldContent = "", newContent = "" } = {}) => {
    const card = document.createElement("div");
    card.className = "diff-decision-card";

    const head = document.createElement("div");
    head.className = "diff-decision-head";

    const title = document.createElement("span");
    title.className = "diff-decision-file";
    title.textContent = `📝 ${filePath || "archivo modificado"}`;

    const actions = document.createElement("div");
    actions.className = "diff-decision-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "diff-decision-btn diff-btn-accept";
    acceptBtn.textContent = "✅ Aceptar";

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "diff-decision-btn diff-btn-reject";
    rejectBtn.textContent = "❌ Revertir";

    acceptBtn.addEventListener("click", async () => {
      acceptBtn.textContent = "✅ Aceptado";
      acceptBtn.className = "diff-decision-btn diff-btn-done";
      rejectBtn.remove();
      try {
        if (filePath && newContent && window.editcoreBridge?.writeFile) {
          await window.editcoreBridge.writeFile({ path: filePath, content: newContent });
        }
      } catch (err) {
        console.warn("[diff-decisions] accept error", err);
      }
    });

    rejectBtn.addEventListener("click", async () => {
      rejectBtn.textContent = "❌ Revertido";
      rejectBtn.className = "diff-decision-btn diff-btn-done";
      acceptBtn.remove();
      try {
        if (filePath && oldContent && window.editcoreBridge?.writeFile) {
          await window.editcoreBridge.writeFile({ path: filePath, content: oldContent });
        }
      } catch (err) {
        console.warn("[diff-decisions] reject error", err);
      }
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    head.appendChild(title);
    head.appendChild(actions);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "diff-decision-body";

    const lines = String(diff || "").split("\n");
    for (const line of lines) {
      const lineEl = document.createElement("div");
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineEl.className = "diff-line-add";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        lineEl.className = "diff-line-del";
      }
      lineEl.textContent = line;
      body.appendChild(lineEl);
    }

    card.appendChild(body);
    return card;
  },
};

window.EditCoreCodebaseIndex = {
  symbols: new Map(),
  indexProjectSymbols: (files = []) => {
    const map = new Map();
    for (const f of files) {
      const path = f.path || f;
      const content = f.content || "";
      if (typeof content !== "string" || !content) continue;
      const matches = content.matchAll(/(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|interface|type)\s+([a-zA-Z0-9_$]+))/g);
      for (const m of matches) {
        if (m[1]) {
          map.set(m[1], { symbol: m[1], path, line: 1 });
        }
      }
    }
    window.EditCoreCodebaseIndex.symbols = map;
    return map;
  },
  findSymbol: (name) => {
    return window.EditCoreCodebaseIndex.symbols.get(name) || null;
  },
};

window.EditCoreAppMode = {
  setChat: () => window.EditCoreChatHome?.setMode?.("chat"),
  setIde: () => window.EditCoreChatHome?.setMode?.("ide"),
};

// Bind Autocomplete to IDE prompt if available
document.addEventListener("DOMContentLoaded", () => {
  const idePrompt = $("prompt");
  const ideWrap = idePrompt?.closest(".composer-input-wrap") || idePrompt?.parentElement;
  if (idePrompt && ideWrap && typeof window.EditCoreMentionAutocomplete?.setupAutocomplete === "function") {
    window.EditCoreMentionAutocomplete.setupAutocomplete(idePrompt, ideWrap);
  }
});

boot().catch((error) => {
  $("status").textContent = error?.message || "No se pudo iniciar la aplicacion";
});
