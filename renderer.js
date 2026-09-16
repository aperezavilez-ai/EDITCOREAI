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

const MEAI_PROVIDER_MODELS = [
  "claude-sonnet-4.6",
  "claude-haiku-4-5",
  "claude-opus-4.8",
  "qwen3.6-plus",
  "glm-5",
  "deepseek-v4-pro",
  "kimi-k2.6",
];

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
let agentUiHardStopUntil = 0;
let promptProcessorRunning = false;
const MAX_PARALLEL_AGENTS = 4;
const MIN_AGENT_CONTINUATION_TOKENS = 1000;
const inspectorClientErrors = [];
const previewRuntimeErrors = [];

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
    || /gpu_ipc_service|gpu_channel_manager|shared context for virtualization/.test(text)
    || /contextresult::kfatalfailure/.test(text)
    || /failed to create shared context/.test(text)
    || /gl_surface|viz_main_impl|command_buffer/.test(text)
    || /passthrough is not supported|angle/.test(text)
    || /autofill\.cc|autofill_agent/.test(text)
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
  const cut = out.search(/<(?:tool_call|tool_use|tool_invocation|function_calls?|function\s*=|parameter\s*=)\b/i);
  if (cut >= 0) out = out.slice(0, cut);
  out = out.replace(/\n{3,}/g, "\n\n");
  return trim ? out.trimEnd() : out;
}

function looksLikeAgentToolDump(value = "") {
  return /<(?:tool_call|tool_use|function\s*=|parameter\s*=)\b/i.test(String(value || ""));
}

function joinAgentStreamText(prev = "", next = "") {
  const a = String(prev || "");
  const b = String(next || "");
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith(b)) return a;
  if (b.startsWith(a) && b.length >= a.length) return b;

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
  if (/gafcore/i.test(text)
    || /admin\s+de\s+/i.test(text)
    || /Tu modelo seleccionado se conserv/i.test(text)
    || /PROVIDER_TEMPORARILY_UNAVAILABLE/i.test(text)) {
    if (/saldo|balance|402/i.test(text)) {
      return "El proveedor no tiene saldo disponible ahora. Revisa ME AI o APICredits e intenta de novo.";
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

// [Integración exacta de la función solicitada]
function prepareChatProseForRender(text) {
  let value = repairMojibakeText(String(text || ""));

  // Caso especial: mensaje de error de proveedor (no tocar estructura).
  if (/PROVIDER_TEMPORARILY_UNAVAILABLE|Tu modelo seleccionado se conserv/i.test(value)) {
    return "El proveedor no respondió a tiempo. Reintenta en unos segundos; tu modelo se conserva.";
  }

  // 1. Quitar caracteres CJK (chino/japonés/coreano) que aparecen por language drift.
  value = value.replace(/[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/g, " ");

  // 2. Sanitizar SOLO URLs/keys de gateway. NO reescribir GAFCCORE/GafCore (nombre propio).
  value = value
    .replace(/https?:\/\/[^\s)]*gafcore-gateway[^\s)]*/gi, "")
    .replace(/\bx-project-key\b/gi, "API key")
    .replace(/\bproject\s*keys?\b/gi, "API keys")
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, "$1[REDACTED]");

  // 3. Llamar a Elite PRIMERO (puede colapsar \n — después los restauramos).
  const Elite = window.EditCoreEliteCommunication;
  try {
    if (typeof Elite?.normalizeSpanishProse === "function") {
      value = Elite.normalizeSpanishProse(value);
    }
    if (typeof Elite?.ensureChatParagraphs === "function") {
      value = Elite.ensureChatParagraphs(value);
    }
  } catch { /* keep value */ }

  // 4. AHORA normalizar estructura de párrafos (nunca antes de Elite).
  value = value
    // Colapsar SOLO espacios y tabs consecutivos, NUNCA \n.
    .replace(/[ \t]{2,}/g, " ")
    // Párrafo antes de bullet tras ". :" ("texto: - item" → "texto:\n\n- item").
    .replace(/([.:;!?])\s+([-*•]\s)/g, "$1\n\n$2")
    // Párrafo antes de lista numerada ("texto: 1. item" → "texto:\n\n1. item").
    .replace(/([.:;!?])\s+(\d+\.\s)/g, "$1\n\n$2")
    // Newline entre bullets pegados ("- a - b" → "- a\n- b").
    .replace(/([-*•]\s[^\n]+?)\s+([-*•]\s)/g, "$1\n$2")
    // Newline entre bullets pegados con espacios múltiples.
    .replace(/([^\n])\s{2,}([-*•]\s)/g, "$1\n\n$2")
    // Bullet pegado a texto sin separador ("texto- item" → "texto\n\n- item").
    .replace(/([a-záéíóúñ.,;!?:])([-*•]\s+[A-ZÁÉÍÓÚÑ])/g, "$1\n\n$2")
    // Párrafo antes de headings pegados ("texto## Sección").
    .replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2")
    // Máximo 2 saltos de línea seguidos.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return value;
}