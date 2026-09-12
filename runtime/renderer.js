const $ = (id) => document.getElementById(id);
const WINDOW_ID = new URLSearchParams(location.search).get("windowId") || "main";
const ProjectAnalysis = window.EditCoreProjectAnalysis;
const AutoModel = window.EditCoreAutoModel;
const CONFIGURE_MODELS_SELECTION = "__configure_models__";
const PROJECTS_STORAGE_KEY = WINDOW_ID === "main" ? "editcore-projects" : "editcore-projects-" + WINDOW_ID;
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

// ME AI: set recomendado para EDITCOREAI (agente + fallbacks).
const MEAI_PROVIDER_MODELS = [
  "claude-sonnet-4.6",
  "claude-haiku-4-5",
  "claude-opus-4.8",
  "qwen3.6-plus",
  "glm-5",
  "deepseek-v4-pro",
  "kimi-k2.6",
];
// APICredits: live GET /v1/models 2026-08-31 (a6-claude + a6-openai).
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
  permissionMode: "step",
  attachments: [],
  activeAgentId: "",
  inspectorSnapshot: null,
  inspectorProjectSnapshot: null,
  cacheStats: { responses: {}, tools: {}, harness: {} },
  modelSelectionAuto: false,
  lastAutoResolvedModel: "",
};
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
let promptProcessorRunning = false;
const MAX_PARALLEL_AGENTS = 4;
const MIN_AGENT_CONTINUATION_TOKENS = 1000;
const inspectorClientErrors = [];

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

function repairPersistedText(value) {
  if (typeof value === "string") return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairPersistedText);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [repairMojibakeText(key), repairPersistedText(item)]));
}

function uid() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const key = String(profile?.providerKey || "").toLowerCase();
    const url = String(profile?.baseUrl || "").toLowerCase();
    return key === "custom:gafcore-gateway" || key.includes("gafcore-gateway") || url.includes("gafcore-gateway");
  };
  const isGatewayProvider = (provider) => {
    const id = String(provider?.id || "").toLowerCase();
    const url = String(provider?.baseUrl || "").toLowerCase();
    return id === "gafcore-gateway" || id.includes("gafcore-gateway") || url.includes("gafcore-gateway");
  };
  const directProfiles = storedProfiles.filter((profile) => PRIMARY_PROVIDER_KEYS.includes(String(profile?.providerKey || "").toLowerCase())
    && profile?.apiKey && profile?.baseUrl && profile?.model
    && !isGatewayProfile(profile));
  const nextProfiles = storedProfiles.filter((profile) => !isGatewayProfile(profile)
    && (PRIMARY_PROVIDER_KEYS.includes(String(profile?.providerKey || "").toLowerCase())
      || (String(profile?.providerKey || "").startsWith("custom:") && !isGatewayProfile(profile))));
  const nextCustomProviders = (secureState["editcore-custom-providers"] || []).filter((provider) => !isGatewayProvider(provider));
  let removedLegacyDirectProviders = false;
  const chat = secureState["editcore-chat-config"] && typeof secureState["editcore-chat-config"] === "object"
    ? { ...secureState["editcore-chat-config"] }
    : {};
  const chatOnGateway = String(chat.providerKey || "").includes("gafcore-gateway")
    || String(chat.baseUrl || "").toLowerCase().includes("gafcore-gateway");
  const preferredDirect = directProfiles.find((p) => p.providerKey === "apicredits" && /fable-5/i.test(String(p.model || "")))
    || directProfiles.find((p) => p.providerKey === "meai" && /sonnet-4\.6/i.test(String(p.model || "")))
    || directProfiles.find((p) => p.providerKey === "apicredits")
    || directProfiles.find((p) => p.providerKey === "meai")
    || directProfiles[0]
    || null;
  const profilesChanged = JSON.stringify(storedProfiles) !== JSON.stringify(nextProfiles);
  const customChanged = JSON.stringify(secureState["editcore-custom-providers"] || []) !== JSON.stringify(nextCustomProviders);
  if (profilesChanged || customChanged || chatOnGateway) {
    removedLegacyDirectProviders = true;
    secureState["editcore-provider-profiles"] = nextProfiles;
    secureState["editcore-custom-providers"] = nextCustomProviders;
    if (preferredDirect) {
      secureState["editcore-chat-config"] = {
        ...chat,
        remember: true,
        mode: /claude/i.test(preferredDirect.model) ? "claude" : "gpt",
        providerKey: preferredDirect.providerKey,
        provider: preferredDirect.providerKey,
        providerProfileId: preferredDirect.id,
        model: preferredDirect.model,
        baseUrl: preferredDirect.baseUrl,
        apiKey: preferredDirect.apiKey,
        modelSelectionMode: chat.modelSelectionMode || "manual",
      };
    } else if (chatOnGateway) {
      secureState["editcore-chat-config"] = {
        ...chat,
        providerKey: "apicredits",
        provider: "apicredits",
        providerProfileId: "",
        model: "claude-fable-5",
        baseUrl: "https://api.apicredits.site/v1",
        apiKey: "",
      };
    }
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
  if (migrated || repairedSecure || compactedSecure || removedLegacyInspectorProvider || removedLegacyDirectProviders) {
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
    const keepCurrent = project.id === state.activeProjectId || (existing.id !== state.activeProjectId && project.updatedAt > existing.updatedAt);
    if (keepCurrent) result[existingIndex] = project;
  }
  state.projects = result;
}

function saveProjects() {
  dedupeProjectsByRoot();
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
  localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, state.activeProjectId);
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

async function addFiles(files) {
  for (const file of [...files].slice(0, 8)) {
    const dataUrl = await readFileAsDataUrl(file);
    state.attachments.push({ name: file.name, mimeType: file.type, size: file.size, dataUrl });
  }
  renderAttachments();
}

function renderAttachments() {
  const list = $("attachmentList");
  list.replaceChildren();
  list.style.display = "";
  $("chatForm")?.classList.toggle("has-attachments", state.attachments.length > 0);
  for (const item of state.attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = item.name;
    if (/^image\//i.test(item.mimeType)) {
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

// ── Connections ──────────────────────────────────────────────────────────────

function loadConnections() {
  const saved = loadJson("editcore-connections", {});
  document.querySelectorAll("[data-conn]").forEach((input) => {
    input.value = saved[input.dataset.conn] || "";
  });
  renderConnectionStatus();
}

async function renderGatewayProjectStatus() {
  return undefined;
}

async function connectGatewayProject() {
  throw new Error("GafCore Gateway fue eliminado. Usa meai o apicredits en Modelos.");
}

async function saveConnections() {
  const data = {};
  document.querySelectorAll("[data-conn]").forEach((input) => {
    data[input.dataset.conn] = input.value.trim();
  });
  await saveSecureJson("editcore-connections", data);
  await saveSecureJson("editcore-rtk", { enabled: true });
  await renderConnectionStatus(true);
}

async function renderConnectionStatus(validate = true) {
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
    badge.textContent = configured ? "verificando..." : "sin configurar";
    badge.classList.remove("connected", "error");
    badge.removeAttribute("title");
  });
  if (!validate || !window.editcoreConnections?.validate) return;
  const results = await window.editcoreConnections.validate().catch(() => []);
  for (const result of Array.isArray(results) ? results : [results]) {
    const badge = document.querySelector(`.conn-status[data-service="${result.service}"]`);
    if (!badge) continue;
    badge.textContent = result.ok ? (result.account || "verificada") : result.configured ? "error" : "sin configurar";
    badge.classList.toggle("connected", Boolean(result.ok));
    badge.classList.toggle("error", Boolean(result.configured && !result.ok));
    if (result.error) {
      badge.title = result.error;
      if (!result.ok && result.configured && result.service === "vercel") {
        const detail = document.querySelector(`.conn-error-detail[data-service="vercel"]`);
        if (detail) { detail.textContent = result.error; detail.style.display = "block"; }
      }
    } else if (result.account) {
      badge.title = "Conectado: " + result.account;
      const detail = document.querySelector(`.conn-error-detail[data-service="${result.service}"]`);
      if (detail) detail.style.display = "none";
    }
  }
}

async function detectConnections() {
  const button = $("detectConnectionsBtn");
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "Detectando...";
  try {
    const report = await window.editcoreConnections.importLocal({ projectRoot: state.projectRoot || "" });
    secureState = await window.editcoreSecureConfig.load().catch(() => secureState);
    loadConnections();
    const ok = (report?.validation || []).filter((item) => item.ok).map((item) => item.account || item.service);
    $("status").textContent = ok.length ? `Conexiones detectadas: ${ok.join(", ")}` : "No se detectaron conexiones locales válidas";
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
  openExternal("https://github.com/settings/tokens/new?scopes=repo,workflow&description=EDITCOREAI");
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

function openConnections() {
  const dialog = $("connectionsDialog");
  if (!dialog.open) dialog.showModal();
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

function readProviderForm(key) {
  const def = PROVIDERS[key] || {};
  return {
    baseUrl: document.querySelector(`[data-prov-url="${key}"]`)?.value.trim() || def.baseUrl || "",
    apiKey: document.querySelector(`[data-prov-key="${key}"]`)?.value.trim() || "",
    model: document.querySelector(`[data-prov-model="${key}"]`)?.value.trim() || def.model || "",
  };
}

async function saveProviderForm(key, extra = {}) {
  const data = loadJson("editcore-providers", {});
  data[key] = { ...(data[key] || {}), ...readProviderForm(key), ...extra };
  await saveSecureJson("editcore-providers", data);
  return data[key];
}

async function verifyProvider(key) {
  renderProviderStatus(key, { status: "checking" });
  const provider = await saveProviderForm(key, { status: "checking", error: "" });
  try {
    const result = await window.editcoreProviders.test({ ...provider, providerKey: key });
    const verified = await saveProviderForm(key, { model: result.model, models: result.models, status: "active", modelCount: result.modelCount, checkedAt: Date.now(), error: "" });
    setChatModelOptions(result.models, result.model);
    renderProviderStatus(key, { status: "active", modelCount: result.modelCount });
    return { ...verified, providerKey: key };
  } catch (error) {
    const message = error?.message || String(error);
    await saveProviderForm(key, { status: "inactive", checkedAt: Date.now(), error: message });
    renderProviderStatus(key, { status: "inactive", error: message });
    throw error;
  }
}

async function saveProviders() {
  const data = loadJson("editcore-providers", {});
  PRIMARY_PROVIDER_KEYS.forEach((key) => {
    const urlEl = document.querySelector(`[data-prov-url="${key}"]`);
    const previous = data[key] || {};
    data[key] = { ...previous, baseUrl: urlEl?.value.trim() || PROVIDERS[key].baseUrl };
  });
  await saveSecureJson("editcore-providers", data);
  const customProviders = loadCustomProviders();
  for (const provider of customProviders) {
    const provKey = `custom:${provider.id}`;
    const nameEl = document.querySelector(`[data-prov-name="${provKey}"]`);
    const urlEl = document.querySelector(`[data-prov-url="${provKey}"]`);
    if (nameEl) provider.name = nameEl.value.trim() || provider.name || "Endpoint personalizado";
    if (urlEl && provider.id !== "gafcore-gateway") provider.baseUrl = urlEl.value.trim() || provider.baseUrl || "";
    if (!provider?.apiKey || !provider?.baseUrl || !Array.isArray(provider.enabledModels) || !provider.enabledModels.length) continue;
    provider.status = "active";
    provider.error = "";
    await syncCustomProviderProfiles(provider);
  }
  await saveCustomProviders(customProviders);
  syncChatModelFromConfig();
}

function openProviders() {
  renderDialogAfterOpen($("providersDialog"), () => {
    renderCustomProviders();
    loadProviders();
    syncChatModelFromConfig();
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
            await saveSecureJson("editcore-chat-config", {
              ...loadJson("editcore-chat-config", {}),
              remember: true,
              modelSelectionMode: "auto",
            });
            setChatModelOptions([], AutoModel.AUTO_MODEL_SELECTION, "", "");
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
    const label = AutoModel.formatChatModelLabel(model, job.providerKey || "");
    $("status").textContent = `${label || model} omitido; Auto usará otro modelo.`;
    if ($("modelPickerMenu") && !$("modelPickerMenu").classList.contains("hidden")) renderModelPickerMenu();
  }
}

async function handleProviderFailureForAuto(message, job = {}) {
  if (!isGatewayProviderFailure(message, job.model) && !AutoModel.isProviderFailureMessage?.(message)) return;
  await quarantineModelForAuto(job, message);
}

function resolveActiveChatProfile(context = {}) {
  if (isChatModelAutoMode()) {
    const options = visibleChatModelOptions(verifiedChatModelOptions());
    return AutoModel.resolveAutoModelProfile(options, loadProviderProfiles(), {
      ...context,
      capabilities: cachedModelCapabilities,
      lastAutoResolvedModel: state.lastAutoResolvedModel || "",
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

function rememberAutoResolvedProfile(profile) {
  if (!profile || !isChatModelAutoMode()) return;
  state.modelSelectionAuto = true;
  state.lastAutoResolvedModel = String(profile.model || "");
  updateModelPickerLabel();
  updateStatus();
}

function updateModelPickerLabel() {
  const label = $("modelPickerLabel");
  if (!label) return;
  if (isChatModelAutoMode()) {
    label.textContent = "Auto";
    return;
  }
  const option = $("chatModelSelect")?.selectedOptions?.[0];
  if (!option || AutoModel.isAutoModelSelection(option) || option.dataset?.configure === "1") {
    label.textContent = "Auto";
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

function setPermissionMenuOpen(open) {
  const menu = $("permissionMenu");
  const button = $("permissionsBtn");
  if (!menu || !button) return;
  menu.classList.toggle("hidden", !open);
  button.setAttribute("aria-expanded", String(Boolean(open)));
  if (open) {
    syncPermissionMenuSelection(state.permissionMode);
    positionFloatingMenu(menu, button, { align: "left", gap: 6 });
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
  state.allowWrite = next !== "readonly";
  const labels = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" };
  if ($("permissionsBtn")) {
    $("permissionsBtn").textContent = labels[next] || "Permisos";
    $("permissionsBtn").classList.toggle("danger", next === "full");
    $("permissionsBtn").dataset.permissionMode = next;
  }
  syncPermissionMenuSelection(next);
  return next;
}

function setModelPickerOpen(open) {
  const menu = $("modelPickerMenu");
  const button = $("modelPickerBtn");
  if (!menu || !button) return;
  if (open) {
    renderModelPickerMenu();
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
    positionFloatingMenu(menu, button, { align: "right", gap: 8 });
  } else {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
  }
}

function renderModelPickerMenu() {
  const menu = $("modelPickerMenu");
  if (!menu) return;
  menu.replaceChildren();
  const config = loadJson("editcore-chat-config", {});
  const autoActive = isChatModelAutoMode();
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

  const autoRow = document.createElement("div");
  autoRow.className = "model-picker-auto-row";
  const autoCopy = document.createElement("div");
  autoCopy.className = "model-picker-auto-copy";
  autoCopy.innerHTML = "<strong>Auto</strong><span>Equilibrio entre calidad y velocidad. Ideal para la mayoría de tareas.</span>";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "model-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", autoActive ? "true" : "false");
  toggle.setAttribute("aria-label", "Activar selección automática de modelo");
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setAutoModelEnabled(!isChatModelAutoMode()).then(() => {
      if (!menu.classList.contains("hidden")) renderModelPickerMenu();
    });
  });
  autoRow.append(autoCopy, toggle);
  menu.appendChild(autoRow);

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

async function setAutoModelEnabled(enabled) {
  if (enabled) {
    await selectModelFromPicker({ auto: true, keepOpen: true });
    return;
  }
  const config = loadJson("editcore-chat-config", {});
  const options = visibleChatModelOptions(verifiedChatModelOptions());
  if (!options.length) {
    await saveSecureJson("editcore-chat-config", {
      ...config,
      remember: true,
      modelSelectionMode: "manual",
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

async function selectModelFromPicker({ auto = false, entry, keepOpen = false } = {}) {
  if (!keepOpen) setModelPickerOpen(false);
  const select = $("chatModelSelect");
  if (!select) return;
  if (auto) {
    if (select.value !== AutoModel.AUTO_MODEL_SELECTION) {
      select.value = AutoModel.AUTO_MODEL_SELECTION;
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
      ? ({ meai: "ME AI Cloud", apicredits: "APICredits" }[String(profile.model).split("/", 1)[0]] || "GafCore Gateway")
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
  const resolvedMode = (model || "").startsWith("claude") ? "claude" : "gpt";
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
    setChatModelOptions([], AutoModel.AUTO_MODEL_SELECTION, "", "");
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
  nameSpan.textContent = prov.name || (prov.id === "gafcore-gateway" ? "GafCore Gateway" : "Endpoint personalizado");
  const stateSpan = document.createElement("span");
  stateSpan.className = `provider-state${prov.status === "active" ? " active" : ""}`;
  stateSpan.dataset.providerState = provKey;
  stateSpan.textContent = prov.status === "active" ? "Funcional" : "Sin verificar";
  summary.append(dot, " ", nameSpan, " ", stateSpan);
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
    item.open = ["meai", "apicredits"].includes(key);

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
    summary.append(dot, " ", nameSpan, " ", stateSpan);
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

  const gafcore = list.find((provider) => provider.id === "gafcore-gateway");
  const userCustom = list.filter((provider) => provider.id !== "gafcore-gateway");
  if (gafcore || userCustom.length) {
    const customTitle = document.createElement("div");
    customTitle.className = "providers-section-title";
    customTitle.textContent = "Tus endpoints";
    container.appendChild(customTitle);
  }
  if (gafcore) renderCustomProviderBlock(gafcore, container, { readOnlyEndpoint: true });

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
  const list = loadCustomProviders();
  const existing = list.find((provider) => provider.id === "gafcore-gateway"
    || String(provider.baseUrl || "").toLowerCase().includes("gafcore-gateway.vercel.app"));
  if (existing) {
    existing.name = existing.name || "GafCore Gateway";
    existing.baseUrl = existing.baseUrl || "https://gafcore-gateway.vercel.app/api/openai/v1";
  } else {
    list.push({
      id: "gafcore-gateway",
      name: "GafCore Gateway",
      baseUrl: "https://gafcore-gateway.vercel.app/api/openai/v1",
      apiKey: "",
      models: [],
      enabledModels: [],
      status: "",
    });
  }
  await saveCustomProviders(list);
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
  const confirmedInput = Number(usage?.confirmed_input_tokens || usage?.prompt_tokens || 0);
  const confirmedOutput = Number(usage?.confirmed_output_tokens || usage?.completion_tokens || 0);
  const estimatedInput = Number(usage?.estimated_input_tokens || 0);
  const estimatedOutput = Number(usage?.estimated_output_tokens || 0);
  const localConfirmed = Number(usage?.local_cache_saved_confirmed_tokens || 0);
  const localEstimated = Number(usage?.local_cache_saved_estimated_tokens || 0);
  if (usage?.local_response) return "respuesta local · 0 tokens de API";
  if (usage?.local_cache_hit) {
    const saved = localConfirmed || localEstimated;
    return `cache local · ${saved} tokens evitados${localConfirmed ? " confirmados" : " estimados"}`;
  }
  if (confirmedInput || confirmedOutput) {
    const providerCache = Number(usage?.provider_cache_read_tokens || 0);
    const netInput = Math.max(0, confirmedInput - providerCache);
    const calls = Number(usage?.provider_calls || 0);
    const peak = Number(usage?.peak_request_input_tokens_estimate || 0);
    const compacted = Number(usage?.context_compaction_count || 0);
    return `↑${confirmedInput} ↓${confirmedOutput} tokens · cache proveedor ${providerCache} · entrada neta aprox. ${netInput}${calls ? ` · ${calls} llamada(s)` : ""}${peak ? ` · pico contexto est. ${peak}` : ""}${compacted ? ` · contexto compactado ${compacted} vez/veces` : ""}`;
  }
  return `est. ↑${estimatedInput} ↓${estimatedOutput} tokens · medicion local`;
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
  return project;
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
  if (Boolean(workflow.task?.trim()) && ["awaiting_authorization", "interrupted", "executing"].includes(workflow.phase)) {
    return true;
  }
  if (workflow.taskId && ["interrupted", "executing", "awaiting_authorization"].includes(workflow.phase)) {
    return true;
  }
  if (workflow.taskId && durable.taskId === workflow.taskId && [
    "AWAITING_AUTHORIZATION", "RECOVERABLE", "RECOVERING", "PAUSED", "WAITING", "COMPLETED", "FAILED",
  ].includes(String(durable.state || ""))) {
    if (durable.state === "COMPLETED" || durable.state === "FAILED") {
      const pendingPlan = String(workflow.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
      if (pendingPlan || workflow.phase === "interrupted" || durable.resumeRequired) return true;
    } else {
      return true;
    }
  }
  if (workflow.taskId && durable.taskId === workflow.taskId && durable.state === "AWAITING_AUTHORIZATION") {
    return true;
  }
  const pendingPlan = String(workflow.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
  return ProjectAnalysis.isAnalysisReport(pendingPlan) || ProjectAnalysis.isPendingAnalysisPlan(pendingPlan);
}

function isPlanAuthorizedExecution(project, prompt, isAgent) {
  if (!isAgent || !isAgentAuthorization(prompt)) return false;
  const text = String(prompt || "").trim();
  const finishNow = typeof ProjectAnalysis.wantsAuthorizedFinish === "function"
    ? ProjectAnalysis.wantsAuthorizedFinish(text)
    : /^\s*(?:contin[uú]a|procede)\b[\s\S]{0,60}\b(?:termina|completa|acaba|finaliza)\b/i.test(text)
      || /^\s*(?:termina|completa)\s+ya\b/i.test(text);
  const durable = project?.durableWorkflow || {};
  if (durable.awaitingAuthorization && durable.taskId) return true;
  if (finishNow && hasResumableAgentTask(project)) return true;
  if (/\b(?:crear?|construir|implementar?|scaffold|armar|montar)\b/i.test(text)) return true;
  if (!hasResumableAgentTask(project)) return false;
  const phase = project?.agentWorkflow?.phase || "";
  if (phase === "awaiting_authorization") return true;
  if (phase === "interrupted" && (finishNow || ProjectAnalysis.isAnalysisReport(project?.agentWorkflow?.plan || ""))) return true;
  if (phase === "executing" && finishNow) return true;
  if (durable.state === "AWAITING_AUTHORIZATION" && durable.taskId) return true;
  const pendingPlan = String(project?.agentWorkflow?.plan || project?.analysisMemory?.resultSummary || durable.planContent || "").trim();
  return ProjectAnalysis.isAnalysisReport(pendingPlan) || ProjectAnalysis.isPendingAnalysisPlan(pendingPlan);
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
  return `La tarea esta lista y espera tu autorizacion: ${task}\n\nEscribe **procede**, **autorizo** o **continua** para aplicar las correcciones.`;
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
  const context = ProjectAnalysis.workflowQuestionContext(workflow, project?.analysisMemory);
  if (!context.trim()) return agentWorkflowStatusText(workflow);
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
  if (!apiKey) return `${context}\n\nPara aplicar correcciones escribe **procede**, **autorizo** o **continua**.`;
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
      "Eres EDITCOREAI, asistente de desarrollo. Responde en español, claro y directo.",
      "Usa SOLO el contexto verificado abajo. No inventes archivos ni cambios.",
      "Responde la pregunta del usuario sin pedir autorizacion otra vez ni generar un plan nuevo.",
      "No pegues codigo fuente ni bloques ```; explica en prosa.",
      "Si falta informacion en el contexto, dilo explicitamente.",
      `\n${context}`,
    ].join("\n\n"),
  });
  const answer = String(result?.text || "").trim();
  return answer || agentWorkflowStatusText(workflow);
}

function analysisRepairPrompt(memory = {}, authorization = "procede") {
  const projectName = memory.projectName || projectDisplayName(activeProject()) || "el proyecto";
  const summary = String(memory.resultSummary || "").slice(0, 3500);
  const files = Array.isArray(memory.filesInspected) && memory.filesInspected.length
    ? memory.filesInspected.slice(0, 40).join(", ")
    : "usa project_discovery, search_files y lecturas concretas para ubicar los archivos relevantes";
  return [
    `${authorization}. Corrige ahora los errores y riesgos detectados en el analisis anterior de ${projectName}.`,
    "No repitas el diagnostico completo si ya existe evidencia; usa esa evidencia para decidir cambios concretos.",
    "Ejecuta herramientas reales de escritura cuando encuentres una correccion aplicable, verifica con comandos permitidos y entrega el resultado final con archivos cambiados y pruebas.",
    `Archivos ya inspeccionados: ${files}.`,
    summary ? `Resumen del analisis anterior:\n${summary}` : "",
  ].filter(Boolean).join("\n\n");
}

function ensureProject() {
  if (activeProject()) return activeProject();
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
  const parentKey = normalizeProjectRoot(parent);
  const separator = parentKey.includes("\\") ? "\\" : "/";
  state.projects = state.projects.filter((project) => {
    const rootKey = normalizeProjectRoot(project.projectRoot);
    if (!rootKey || rootKey === parentKey) return false;
    const relative = rootKey.startsWith(`${parentKey}${separator}`) ? rootKey.slice(parentKey.length + 1) : "";
    const directChild = Boolean(relative) && !/[\\/]/.test(relative);
    return directChild || project.id === state.activeProjectId;
  });
  const rows = await window.editcoreProject.catalog(parent);
  for (const row of rows || []) {
    const root = String(row?.root || "").trim();
    if (!root) continue;
    const existing = state.projects.find((project) => normalizeProjectRoot(project.projectRoot) === normalizeProjectRoot(root));
    if (existing) {
      existing.title = String(row.name || existing.title || "").trim();
      continue;
    }
    state.projects.push(ensureProjectAgent({
      id: uid(), title: String(row.name || "Proyecto").trim(), mode: state.mode,
      model: PROVIDERS[state.mode]?.model || "", messages: [], projectRoot: root,
      provider: state.mode, permissionMode: "step", agents: [], agentState: "idle",
      catalogEntry: true, updatedAt: 0,
    }));
  }
  saveProjects();
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
    remove.disabled = project.id === state.activeProjectId;
    remove.title = remove.disabled ? "Cambia de proyecto antes de quitar el activo" : "Quitar de Mis proyectos sin borrar carpeta";
    remove.onclick = () => {
      state.projects = state.projects.filter((item) => item.id !== project.id);
      saveProjects();
      renderProjects();
    };
    row.append(button, remove);
    host.appendChild(row);
  }
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
  state.history = [...(project.messages || [])];
  updateAgentCount();
  updateStatus();
  $("permissionsBtn").textContent = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" }[state.permissionMode] || "Permisos";
  $("permissionsBtn").classList.toggle("danger", state.permissionMode === "full");
  $("permissionsBtn").dataset.permissionMode = state.permissionMode;
  syncPermissionMenuSelection(state.permissionMode);
  $("projectPathLabel").textContent = state.projectRoot || "Sin proyecto";
  renderProjectFiles().catch(() => undefined);
  if (!state.history.length) {
    if (project.chatCleared) return;
    append("assistant", "Bienvenido a EDITCOREAI. ¿Qué haremos hoy?", null, false);
    return;
  }
  for (const message of state.history) append(message.role, message.content, message.usage, false, null, message.images || [], message.documents || []);
  scrollFeedToBottom();
}

function scrollFeedToBottom() {
  const feed = $("feed");
  feed.scrollTop = feed.scrollHeight;
}

function notifyVoiceAssistant(text) {
  window.EditCoreVoiceMode?.notifyAssistant?.(String(text || "").trim());
}

function notifyVoiceTurnComplete() {
  window.EditCoreVoiceMode?.notifyTurnComplete?.();
}

function fileIcon(kind) {
  return kind === "directory" ? "📁" : "📄";
}

async function renderProjectFiles(relativePath = "") {
  $("fileList").replaceChildren();
  if (!state.projectRoot) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "Abre un proyecto para ver archivos.";
    $("fileList").appendChild(empty);
    return;
  }
  if (relativePath) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "file-item";
    up.textContent = "← Volver";
    up.onclick = () => renderProjectFiles(relativePath.split(/[\\/]/).slice(0, -1).join("\\"));
    $("fileList").appendChild(up);
  }
  try {
    const rows = await window.editcoreProject.list(state.projectRoot, relativePath);
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-item ${row.kind}`;
      button.textContent = `${fileIcon(row.kind)} ${row.name}`;
      button.onclick = () => {
        if (row.kind === "directory") {
          renderProjectFiles(row.path);
        } else if (/\.html?$/i.test(row.name)) {
          $("previewWebview").src = `file:///${row.absolutePath.replace(/\\/g, "/")}`;
        }
      };
      $("fileList").appendChild(button);
    }
  } catch (error) {
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
  if (state.projectRoot && !isRemotePreviewUrl(raw) && window.editcoreProject?.previewHealth) {
    const health = await window.editcoreProject.previewHealth(state.projectRoot).catch(() => ({ available: false }));
    if (!health?.available) {
      const preview = await window.editcoreProject.startPreview(state.projectRoot);
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
  if (forceReload && normalizedPreviewUrl(currentPreviewUrl(webview)) === previewExpectedUrl && typeof webview.reloadIgnoringCache === "function") {
    try {
      webview.reloadIgnoringCache();
    } catch (e) {
      if (navigationId === previewNavigationId) webview.setAttribute("src", url);
    }
  } else {
    if (navigationId === previewNavigationId) webview.setAttribute("src", url);
  }
}

function showPreviewLoading(message = "Cargando navegador del proyecto...") {
  $("previewStatus").textContent = message;
  $("previewStatus").classList.remove("hidden");
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
      const text = String(body?.innerText || "").trim().slice(0, 4000);
      const onlyPre = Boolean(body && body.children.length === 1 && body.firstElementChild?.tagName === "PRE");
      const normalizedText = text.toLowerCase();
      const apiDocument = normalizedText.includes('"swagger"')
        || normalizedText.includes('"openapi"')
        || normalizedText.includes("postgrest")
        || normalizedText.includes("application/vnd.pgrst");
      const renderedElements = body ? body.querySelectorAll("body *").length : 0;
      const visibleText = text.length > 0;
      const visibleElement = Boolean(body && [...body.querySelectorAll("body *")].some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      }));
      return { contentType, onlyPre, apiDocument, renderedElements, hasVisibleContent: visibleText || visibleElement };
    })()`);
    if (!/(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(String(snapshot?.contentType || ""))) return false;
    if (snapshot?.onlyPre && snapshot?.apiDocument) return "api";
    return snapshot?.hasVisibleContent ? "ready" : "blank";
  } catch {
    return false;
  }
}

async function settlePreviewDocument() {
  const webview = $("previewWebview");
  if (!previewEventMatches(webview)) return;
  const navigationId = previewNavigationId;
  const validationId = ++previewDocumentValidationId;
  const documentState = await renderedPreviewIsDocument(webview);
  if (validationId !== previewDocumentValidationId || navigationId !== previewNavigationId || !previewEventMatches(webview)) return;
  if (documentState === "api") {
    webview.dataset.previewReady = "0";
    webview.dataset.previewRejected = "api-document";
    previewExpectedUrl = "";
    showPreviewStatus("La direccion respondio con datos de API, no con la pagina del proyecto. Recuperando el navegador...", { clearDocument: true });
    void monitorPreviewHealth({ forceRecovery: true });
    return;
  }
  if (documentState === "blank") {
    webview.dataset.previewReady = "0";
    showPreviewStatus("El servidor respondio, pero la aplicacion no mostro contenido. Revisa el error de inicio del proyecto.");
    $("status").textContent = "El proyecto abrio una pagina vacia";
    return;
  }
  if (documentState !== "ready") return;
  webview.dataset.previewReady = "1";
  previewLastSuccessfulUrl = normalizedPreviewUrl(currentPreviewUrl(webview) || previewExpectedUrl);
  $("previewStatus").classList.add("hidden");
}

async function fitPreviewToPanel() {
  const panel = document.querySelector(".viewer-body");
  const webview = $("previewWebview");
  if (!panel || !webview) return;
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
  const next = mode === "mobile" ? "mobile" : "web";
  const viewer = document.querySelector(".viewer");
  if (viewer) viewer.dataset.previewMode = next;
  $("webPreviewBtn")?.classList.toggle("active", next === "web");
  $("mobilePreviewBtn")?.classList.toggle("active", next === "mobile");
  localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, next);
  schedulePreviewFit();
}

async function openNewWindow() {
  if (newWindowOpening) return;
  newWindowOpening = true;
  const button = $("newWindowBtn");
  button.disabled = true;
  try {
    await window.editcoreWindow.open();
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
    if (rootAtStart) {
      const preview = await window.editcoreProject.startPreview(rootAtStart);
      if (selectionId !== projectSelectionId || normalizeProjectRoot(state.projectRoot) !== normalizeProjectRoot(rootAtStart)) return;
      if (!preview.available) { showPreviewStatus(preview.message); return; }
      $("previewUrl").value = preview.url;
    }
    await openPreview({ forceReload: true });
    $("status").textContent = "Navegador actualizado";
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
        const divider = Math.max(browserLeft + 280, Math.min(w - splitterWidth - 180, x));
        const browser = divider - browserLeft;
        document.body.style.setProperty("--browser-width", `${browser}px`);
        localStorage.setItem("--browser-width", `${browser}px`);
      }
    }
  });
}

function loadPanelSizes() {
  if (!localStorage.getItem("editcore-layout-reset-208-browser")) {
    localStorage.removeItem("--chat-width");
    localStorage.removeItem("--browser-width");
    localStorage.setItem("editcore-layout-reset-208-browser", "true");
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
  const wasActiveProject = state.activeProjectId === id;
  const selectionId = ++projectSelectionId;
  state.activeProjectId = id;
  state.projectRoot = selected.projectRoot;
  resetPreview("Iniciando servidor del proyecto...");
  if (options.render !== false) {
    saveProjects();
    renderProjects();
    const preserveLiveChat = !options.force
      && wasActiveProject
      && (activePromptRequests.size > 0 || activeAgentThinkingRuns.size > 0 || document.querySelector(".thinking-msg"));
    if (!preserveLiveChat) renderFeed({ force: options.force });
    syncChatModelFromConfig();
  }
  const project = activeProject();
  if (project?.gafcoreProjectId || String(project?.provider || "").includes("gafcore-gateway")) {
    delete project.gafcoreProjectId;
    delete project.gafcoreProjectName;
    delete project.gafcoreConnectedAt;
    delete project.gafcoreModelCount;
    if (String(project.provider || "").includes("gafcore-gateway")) {
      project.provider = "";
      project.providerProfileId = "";
    }
    saveProjects();
  }
  if (project?.projectRoot) {
    if (selectionId !== projectSelectionId || activeProject()?.id !== project.id) return;
    state.projectRoot = project.projectRoot;
    $("projectPathLabel").textContent = project.projectRoot;
    try {
      const preview = await window.editcoreProject.startPreview(project.projectRoot);
      if (selectionId !== projectSelectionId || activeProject()?.id !== project.id || normalizeProjectRoot(state.projectRoot) !== normalizeProjectRoot(project.projectRoot)) return;
      if (!preview.available) showPreviewStatus(preview.message);
      else {
        $("previewUrl").value = preview.url;
        await openPreview();
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
  }
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
  renderDialogAfterOpen($("projectsDialog"), renderProjects);
  refreshProjectCatalog()
    .then(() => { if ($("projectsDialog").open) renderProjects(); })
    .catch((error) => { $("status").textContent = `No se pudo leer la carpeta de proyectos: ${error?.message || String(error)}`; });
}

function refreshVisibleProjectCatalog() {
  refreshProjectCatalog()
    .then(() => { if ($("projectsDialog")?.open) renderProjects(); })
    .catch((error) => { $("status").textContent = `No se pudo actualizar Proyectos: ${error?.message || String(error)}`; });
}

window.addEventListener("focus", refreshVisibleProjectCatalog);
setInterval(() => {
  if ($("projectsDialog")?.open) refreshVisibleProjectCatalog();
}, 10_000);

async function saveCurrentProjectEntry() {
  const root = String(state.projectRoot || "").trim();
  if (!root) {
    openNewProjectDialog({ mode: "save" });
    return;
  }
  $("saveProjectLocation").value = root;
  $("saveProjectDialog").showModal();
}

async function confirmCurrentProjectSave(event) {
  event.preventDefault();
  const root = $("saveProjectLocation").value.trim();
  const button = $("confirmSaveProjectBtn");
  if (button) button.disabled = true;
  try {
    showPreviewLoading("Cargando navegador del proyecto...");
    const project = projectForRoot(root);
    const saved = await window.editcoreProject.save({ root, name: projectDisplayName(project) });
    if (!saved?.ok || !saved?.manifest?.root) throw new Error("EDITCOREAI no pudo confirmar la persistencia del proyecto.");
    state.projectRoot = root;
    state.activeProjectId = project.id;
    project.updatedAt = Date.now();
    saveProjects();
    renderProjects();
    $("saveProjectDialog").close();
    $("status").textContent = `Proyecto guardado en ${saved.path}`;
  } catch (error) {
    $("status").textContent = `No se pudo guardar: ${error?.message || String(error)}`;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderProjectTemplateSummary() {
  const template = projectTemplates.find((item) => item.id === $("newProjectTemplate").value);
  if (!template) return;
  $("newProjectTemplateName").textContent = template.name;
  $("newProjectTemplateDescription").textContent = template.description || "";
  $("newProjectTemplateRequirements").textContent = template.requirements?.length
    ? `Requisitos: ${template.requirements.join(" · ")}`
    : template.install ? "EDITCOREAI instalara dependencias y verificara el proyecto." : "No requiere dependencias externas.";
}

async function loadProjectTemplates() {
  projectTemplates = await window.editcoreProject.templates();
  const select = $("newProjectTemplate");
  const previous = select.value || "lovable-web";
  select.replaceChildren();
  for (const groupName of [...new Set(projectTemplates.map((item) => item.group))]) {
    const group = document.createElement("optgroup");
    group.label = groupName;
    for (const template of projectTemplates.filter((item) => item.group === groupName)) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      group.append(option);
    }
    select.append(group);
  }
  select.value = projectTemplates.some((item) => item.id === previous) ? previous : projectTemplates[0]?.id || "blank";
  renderProjectTemplateSummary();
}

function setProjectCreateUi(running) {
  projectCreateRunning = running;
  $("newProjectName").disabled = running;
  $("newProjectTemplate").disabled = running;
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

async function openNewProjectDialog(options = {}) {
  $("newProjectDialog").dataset.mode = options.mode === "save" ? "save" : "create";
  $("newProjectDialogTitle").textContent = options.mode === "save" ? "Guardar proyecto nuevo" : "Crear proyecto";
  $("newProjectName").value = "";
  $("newProjectParent").value = loadJson("editcore-project-parent", "D:\\PROGRAMAS IA");
  $("projectCreateProgress").classList.add("hidden");
  $("projectCreateProgress").dataset.state = "idle";
  $("projectCreateProgressFill").style.width = "0%";
  $("projectCreateProgressPercent").textContent = "0%";
  $("projectCreateLog").textContent = "";
  if (!projectTemplates.length) await loadProjectTemplates();
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
  updateProjectCreateProgress({ runId: activeProjectCreateRunId, percent: 0, stage: "select", state: "running", message: "Selecciona la carpeta de destino" });
  try {
    const created = await window.editcoreProject.create({ name, parentPath, template: $("newProjectTemplate").value, install: true, runId: activeProjectCreateRunId });
    if (!created) return;
    if ($("newProjectDialog").dataset.mode === "save") {
      const saved = await window.editcoreProject.save({ root: created.root, name: created.name });
      if (!saved?.ok || !saved?.manifest?.root) throw new Error("El proyecto se creo, pero EDITCOREAI no confirmo su persistencia.");
    }
    const project = projectForRoot(created.root, created.name);
    state.activeProjectId = project.id;
    saveProjects();
    $("newProjectDialog").close();
    await selectProject(project.id);
    $("status").textContent = `Proyecto ${created.name} creado y verificado en ${Math.round((created.report?.durationMs || 0) / 1000)} s`;
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
  project.messages = [];
  project.chatCleared = true;
  project.updatedAt = Date.now();
  state.history = [];
  state.attachments = [];
  saveProjects();
  renderProjects();
  $("feed").replaceChildren();
  renderAttachments();
  renderPromptQueue();
  scrollFeedToBottom();
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
    const resolved = state.lastAutoResolvedModel
      ? ` → ${AutoModel.formatChatModelLabel(state.lastAutoResolvedModel, "custom:gafcore-gateway")}`
      : "";
    $("status").textContent = `${providerLabel} via EDITCOREAI · Auto${resolved}`;
    updateSavings();
    return;
  }
  const model = selectedOption?.dataset.model?.trim()
    || $("model")?.value?.trim()
    || PROVIDERS[state.mode]?.model
    || "";
  $("status").textContent = `${providerLabel} via EDITCOREAI · ${model}`;
  updateSavings();
}

// ── Chat rendering ────────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (typeof window.renderMarkdownSecure === 'function') {
    return window.renderMarkdownSecure(text);
  }
  return String(text || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

function append(role, text, usage, scroll = true, elapsedSeconds = null, images = [], documents = []) {
  const item = document.createElement("article");
  item.className = `msg ${role}`;

  const header = document.createElement("div");
  header.className = "msg-head";
  header.textContent = role === "user" ? "Tú" : `EDITCOREAI${elapsedSeconds === null ? "" : ` ${formatElapsed(elapsedSeconds)}`}`;

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(repairMojibakeText(String(text || "")));

  item.append(header, body);

  if (usage) {
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
  if (scroll) scrollFeedToBottom();
  if (role === "assistant" && window.EditCoreVoiceMode?.isActive?.()) {
    window.EditCoreVoiceMode.onAssistantMessage(text);
  }
  return item;
}

function rememberMessage(role, content, usage, images = [], documents = []) {
  const project = ensureProject();
  project.mode = state.mode;
  project.model = $("model").value.trim() || PROVIDERS[state.mode]?.model || "";
  project.chatCleared = false;
  project.messages.push({ role, content: repairMojibakeText(content), usage: usage || null, images, documents });
  if (role === "user" && (!project.title || project.title === "Nuevo chat")) {
    project.title = content.replace(/\s+/g, " ").trim().slice(0, 44) || "Nuevo chat";
  }
  project.updatedAt = Date.now();
  state.history = [...project.messages];
  state.projects.sort((a, b) => b.updatedAt - a.updatedAt);
  state.activeProjectId = project.id;
  saveProjects();
  renderProjects();
}

// ── Thinking indicator ────────────────────────────────────────────────────────

function appendThinking(statusText = "Pensando...", isAgent = false, runLabel = "") {
  const item = document.createElement("article");
  item.className = "msg assistant thinking-msg";
  const head = document.createElement("div");
  head.className = "msg-head";
  head.textContent = runLabel ? `EDITCOREAI · ${runLabel}` : "EDITCOREAI";
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
  if (isAgent) {
    const container = document.createElement("div");
    container.className = "agent-execution-container";
    const log = document.createElement("div");
    log.className = "agent-narrative-log";
    item._narrativeLog = log;
    item._narrativeSeen = new Set();
    item._narrativeRows = new Map();
    container.appendChild(log);
    body.appendChild(container);
  }
  body.appendChild(primary);
  item.append(head, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();
  return item;
}

function setThinkingStatus(item, text) {
  const status = item?.querySelector?.(".thinking-status") || document.querySelector(".thinking-msg .thinking-status");
  if (status) status.textContent = String(text || "Pensando...");
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

function setPipelinePill(key, value, state = "") {
  const valueEl = $(key === "coverage" ? "pipelineCoverage" : key === "diagnostic" ? "pipelineDiagnostic" : "pipelineQueue");
  const pill = document.querySelector(`.pipeline-pill[data-key="${key}"]`);
  if (valueEl) valueEl.textContent = String(value || "—");
  if (pill) pill.dataset.state = state || "";
}

function updateAgentPipelineUi( partial = {}) {
  const strip = $("agentPipelineStrip");
  if (!strip) return;
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
  if (partial.visible === true) agentPipelineState.visible = true;
  if (partial.visible === false) agentPipelineState.visible = false;

  setPipelinePill("coverage", agentPipelineState.coverage, agentPipelineState.coverageState);
  setPipelinePill("diagnostic", agentPipelineState.diagnostic, agentPipelineState.diagnosticState);
  setPipelinePill("queue", agentPipelineState.queue, agentPipelineState.queueState);
  strip.classList.toggle("hidden", !agentPipelineState.visible);
}

function inferPipelineFromText(text = "") {
  const raw = String(text || "");
  if (!raw) return;
  if (/Walker cobertura|Cobertura:|COVERAGE_MAP/i.test(raw)) {
    const pct = /(\d+)\s*%/.exec(raw);
    updateAgentPipelineUi({
      visible: true,
      coverage: raw.replace(/^Walker cobertura:\s*/i, "").slice(0, 80),
      coveragePercent: pct ? Number(pct[1]) : undefined,
      coverageState: /alcanzada|100\s*%/i.test(raw) ? "ok" : "run",
    });
  }
  if (/Diagnostico acotado|DIAGNOSTICO ACOTADO|typecheck|tsc --noEmit/i.test(raw)) {
    const fail = /fallo|error TS|FAIL/i.test(raw);
    const ok = /→ ok|sin errores|exitoso/i.test(raw);
    updateAgentPipelineUi({
      visible: true,
      diagnostic: raw.replace(/^Diagnostico acotado:\s*/i, "").slice(0, 72),
      diagnosticState: fail ? "fail" : ok ? "ok" : "run",
    });
  }
  if (/Cola fixes:|FIX_QUEUE|FOCO OBLIGATORIO|FOCO ACTUAL/i.test(raw)) {
    const focus = /foco:\s*([^\s;]+)|FOCO[^:]*:\s*([^\s\n]+)/i.exec(raw);
    updateAgentPipelineUi({
      visible: true,
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
    visible: true,
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
  thinkingItem?.querySelector?.(".thinking-primary")?.classList.remove("hidden");
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
    row.innerHTML = renderMarkdown(repairMojibakeText(thinkingItem._streamBuffer || ""));
    scrollFeedToBottom();
  }, 40);
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

function appendAgentStreamDelta(thinkingItem, text) {
  const value = humanizeAgentNarration(String(text || ""));
  if (!thinkingItem || !value) return;
  ensureAgentStreamRow(thinkingItem);
  thinkingItem._streamBuffer = `${thinkingItem._streamBuffer || ""}${value}`;
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

  return cleaned;
}

function addAgentNarrationDelta(thinkingItem, text) {
  appendAgentStreamDelta(thinkingItem, text);
}

function addAgentNarration(thinkingItem, text) {
  const value = humanizeAgentNarration(String(text || "")).trim();
  if (!thinkingItem || !value) return;
  ensureAgentStreamRow(thinkingItem);
  thinkingItem._streamBuffer = value;
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
  if (phase === "startup" || phase === "model") return `phase:${phase}`;
  return progressDedupeKey(progress);
}

function addAgentStepToThinking(thinkingItem, progress) {
  if (!thinkingItem) return;
  const text = agentProgressText(progress);
  if (!text) return;
  const cleanText = text.replace(/^[✓○→✗]\s*/, "");
  setThinkingStatus(thinkingItem, cleanText);
  showThinkingIndicator(thinkingItem);
  scrollFeedToBottom();
}

function agentProgressText(progress) {
  if (!progress) return "";
  const phase = String(progress.phase || "");
  if (phase === "narration" || phase === "narration_delta") return "";
  if (phase === "confirm") return String(progress.text || "Esperando tu autorizacion en el chat para una accion del agente...");
  if (phase === "human_intervention") return "Se necesita intervencion humana para continuar con seguridad.";
  if (phase === "repair") return "Encontre un problema. Preparando una correccion...";
  if (phase === "direction") return "Incorpore una nueva instruccion del usuario a la tarea activa.";
  if (phase === "startup") {
    return String(progress.text || (progress.stage === "analysis" ? "Iniciando analisis del proyecto..." : "Iniciando ejecucion..."));
  }
  if (phase === "heartbeat") {
    const totalSec = Math.max(0, Math.floor(Number(progress.elapsedMs || 0) / 1000));
    if (totalSec <= 0) return "Analizando...";
    let timeStr = "";
    if (totalSec < 60) {
      timeStr = `${totalSec}s`;
    } else if (totalSec < 3600) {
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      timeStr = `${mins}m ${secs < 10 ? "0" : ""}${secs}s`;
    } else {
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      timeStr = `${hours}h ${mins < 10 ? "0" : ""}${mins}m`;
    }
    return `Analizando... (${timeStr})`;
  }
  if (phase === "model") return String(progress.text || "Consultando al modelo...");
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
    if (name === "run_command" && /no esta disponible|list_files|Argumentos de listado/i.test(error)) {
      return "○ Exploracion por shell bloqueada → usar list_files";
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
    if (done) return target ? `✓ Explorado ${target}` : "✓ Archivos explorados";
  }
  if (name === "read_file") {
    const file = target ? target.split(/[/\\]/).pop() : "archivo";
    if (running) return `→ Leyendo ${file}...`;
    if (done) return progress.cached ? `✓ ${file} (cache)` : `✓ Leido ${file}`;
  }
  if (name === "search_files") {
    if (running) return target ? `→ Buscando "${target}"...` : "→ Buscando en el proyecto...";
    if (done) return target ? `✓ Busqueda "${target}" lista` : "✓ Busqueda completada";
  }
  if (name === "write_file" || name === "replace_in_file") {
    const file = target ? target.split(/[/\\]/).pop() : "archivo";
    if (running) return `→ Escribiendo ${file}...`;
    if (done) return `✓ Escrito ${file}`;
  }
  if (name === "run_command") {
    if (progress?.result?.usedTool === "list_files") {
      const listed = String(progress.result.path || ".");
      return done ? `✓ Listado via list_files (${listed})` : `→ Listando via list_files (${listed})...`;
    }
    if (running) return target ? `→ Ejecutando: ${target.slice(0, 100)}` : "→ Ejecutando comando...";
    if (done) return target ? `✓ Comando listo: ${target.slice(0, 80)}` : "✓ Comando ejecutado";
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
}

function extractThinkingNarrativeFallback(thinking) {
  const narrations = thinking?.querySelectorAll?.(".agent-narrative-log .agent-narration") || [];
  const parts = [...narrations].map((row) => String(row.textContent || "").trim()).filter(Boolean);
  if (parts.length) return parts.join("\n\n");
  const steps = thinking?.querySelectorAll?.(".agent-narrative-log .agent-narrative-entry:not(.agent-narration)") || [];
  const stepText = [...steps]
    .map((row) => String(row.textContent || "").trim())
    .filter((line) => line && !/^(?:iniciando|preparando|revisando|analizando|consultando|conectando)\b/i.test(line));
  if (stepText.length) {
    return `Analisis interrumpido. Pasos ejecutados:\n${stepText.map((line) => `- ${line}`).join("\n")}`;
  }
  return "";
}

function finalizeThinkingAsAssistant(thinking, text, usage, elapsedSeconds) {
  stopThinkingAnimations(thinking);
  flushAgentStreamRender(thinking);
  const streamed = String(thinking?._streamBuffer || "").trim();
  const value = streamed || repairMojibakeText(String(text || "")).trim() || extractThinkingNarrativeFallback(thinking);
  if (!thinking) return append("assistant", value, usage, true, elapsedSeconds);
  thinking.classList.remove("thinking-msg");
  thinking.classList.add("assistant");
  const head = thinking.querySelector(".msg-head");
  if (head) head.textContent = `EDITCOREAI ${formatElapsed(elapsedSeconds)}`;
  thinking.querySelector(".thinking-primary")?.remove();
  const body = thinking.querySelector(".msg-body");
  if (body) body.classList.remove("msg-thinking");
  if (thinking._streamRow && value) {
    thinking._streamRow.innerHTML = renderMarkdown(repairMojibakeText(value));
    thinking._streamRow.classList.remove("is-typing");
  } else {
    let finalBody = body?.querySelector(".agent-final-response");
    if (!finalBody && body) {
      finalBody = document.createElement("div");
      finalBody.className = "agent-final-response";
      body.appendChild(finalBody);
    }
    if (finalBody) finalBody.innerHTML = renderMarkdown(value);
  }
  if (usage && !thinking.querySelector(".msg-meta")) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = usageMetaText(usage);
    thinking.appendChild(meta);
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
  const startedAt = Date.now();
  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    head.textContent = `EDITCOREAI ${formatElapsed(seconds)}`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  responseTimer = timer;
  return () => {
    clearInterval(timer);
    if (responseTimer === timer) responseTimer = null;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    head.textContent = `EDITCOREAI ${formatElapsed(seconds)}`;
    return seconds;
  };
}

function renderBrainSnapshot(snapshot) {
  const host = $("brainSnapshot");
  host.replaceChildren();
  const values = [
    `Skills: ${snapshot?.skillCount || 0}`,
    `Instalados: ${snapshot?.installed?.items?.length || snapshot?.installed?.length || 0}`,
    `Memorias: ${snapshot?.memoryCount || 0}`,
    `RAG: ${snapshot?.index?.totalFiles || 0} archivos`,
  ];
  for (const value of values) { const chip = document.createElement("span"); chip.className = "brain-chip"; chip.textContent = value; host.appendChild(chip); }
  const health = $("brainHealth");
  if (health) {
    const count = Number(snapshot?.skillCount || 0);
    const ready = snapshot?.ready === true && count > 0;
    health.dataset.state = ready ? "ready" : "error";
    health.querySelector("strong").textContent = ready
      ? `Cerebro operativo · ${count} skills disponibles para chat y agentes`
      : "Cerebro incompleto · revisa la copia local de herramientas";
  }
}

async function loadBrainCatalog() {
  const query = $("brainSearch").value.trim();
  $("brainStatus").textContent = "Consultando Bodega…";
  const [items, snapshot, audit] = await Promise.all([
    window.editcoreBrain.catalog(query, 50),
    window.editcoreBrain.snapshot(state.projectRoot || ""),
    window.editcoreBrain.audit(state.projectRoot || "", false),
  ]);
  const installedList = snapshot?.installed?.items || snapshot?.installed || [];
  const installedIds = new Set(installedList.map((item) => item.id));
  renderBrainSnapshot(snapshot);
  renderBrainAudit(audit);
  activeProject().brainSnapshot = snapshot;
  saveProjects();
  const host = $("brainCatalogList"); host.replaceChildren();
  for (const item of items) {
    const card = document.createElement("article"); card.className = "brain-card";
    const head = document.createElement("div"); head.className = "brain-card-head";
    const title = document.createElement("span"); title.className = "brain-card-title"; title.textContent = item.name || item.id;
    const button = document.createElement("button"); button.type = "button"; button.className = "brain-install-btn";
    const installed = installedIds.has(item.id); button.textContent = installed ? "Instalado" : "Instalar"; button.disabled = installed;
    button.addEventListener("click", async () => {
      if (!confirm(`Instalar ${item.name || item.id} en el Cerebro global de EDITCOREAI? Estará disponible para todos los agentes y proveedores.`)) return;
      button.disabled = true; button.textContent = "Instalando…";
      try { await window.editcoreBrain.install(state.projectRoot || "", item.id); await loadBrainCatalog(); }
      catch (error) { button.disabled = false; button.textContent = "Reintentar"; $("brainStatus").textContent = error?.message || String(error); }
    });
    const meta = document.createElement("div"); meta.className = "brain-card-meta"; meta.textContent = `${item.type || "skill"} · ${item.status || "disponible"} · riesgo ${item.risk || "no indicado"}`;
    const desc = document.createElement("div"); desc.className = "brain-card-meta"; desc.textContent = item.description || "Sin descripción";
    head.append(title, button); card.append(head, meta, desc); host.appendChild(card);
  }
  $("brainStatus").textContent = `${items.length} elementos · Cerebro común activo para chat y agentes`;
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
    $("status").textContent = `${job.model} operativo para agente · ${result.entriesRead || 0} entradas leidas en la prueba`;
  } catch (error) {
    sessionStorage.removeItem(key);
    $("status").textContent = error?.message || String(error);
  }
}

async function openBrain() {
  $("brainDialog").showModal();
  await loadBrainCatalog().catch((error) => { $("brainStatus").textContent = error?.message || String(error); $("brainHealth").dataset.state = "error"; $("brainHealth").querySelector("strong").textContent = "Cerebro con error"; });
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
      "Inspector nativo de EDITCOREAI activo.",
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
let activeInspectorChatRun = null;

function setInspectorHandoff(evaluation = null) {
  let button = $("inspectorRepairResultBtn") || $("inspectorHandoffBtn");
  const prompt = String(evaluation?.handoffPrompt || "").trim();
  const targetRoot = String(evaluation?.targetRoot || evaluation?.runtime?.root || "").trim();
  const runtimeRoot = String(evaluation?.runtime?.root || state.inspectorSnapshot?.runtime?.root || "").trim();
  latestInspectorHandoff = prompt ? {
    prompt,
    targetRoot,
    target: runtimeRoot && normalizeProjectRoot(targetRoot) === normalizeProjectRoot(runtimeRoot) ? "editcore-runtime" : "project",
  } : null;
  if (!button && latestInspectorHandoff) {
    button = document.createElement("button");
    button.id = "inspectorRepairResultBtn";
    button.type = "button";
    button.className = "inspector-context-repair";
    $("inspectorActions")?.appendChild(button);
  }
  if (button) {
    button.classList.toggle("hidden", !latestInspectorHandoff);
    button.textContent = latestInspectorHandoff?.target === "editcore-runtime"
      ? "Reparar EDITCOREAI"
      : "Reparar proyecto";
    button.onclick = () => repairInspectorTarget(latestInspectorHandoff?.target === "editcore-runtime" ? "editcore" : "project");
  }
}

function inspectorProgressStatus(area, stateName = "running") {
  const messages = {
    overview: {
      running: "Analizando archivos, procesos y estado de EDITCOREAI...",
      complete: "Estado interno de EDITCOREAI analizado.",
    },
    security: {
      running: "Auditando seguridad y posibles secretos...",
      complete: "Auditoria de seguridad completada.",
    },
    tests: {
      running: "Ejecutando check y pruebas reales de EDITCOREAI...",
      complete: "Validacion interna de EDITCOREAI completada.",
    },
    deploy: {
      running: "Revisando runtime, Electron y empaquetado...",
      complete: "Validacion del runtime completada.",
    },
    database: {
      running: "Revisando conexiones y almacenamiento de EDITCOREAI...",
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
  if (!options.silent) inspectorHealth("checking", "Inspector verificando el runtime de EDITCOREAI...");
  const snapshot = await window.editcoreInspector.scan("editcore", "", { force: options.force === true });
  state.inspectorSnapshot = snapshot;
  $("inspectorSubtitle").textContent = `Supervision interna activa · ${snapshot.runtime?.root || snapshot.projectRoot || "EDITCOREAI"}`;
  const alertCount = Number(snapshot.openAlerts || 0) + Number(snapshot.runtime?.issues?.length || 0);
  const fixedCount = Number(snapshot.fixedAlerts || 0);
  const alertsBtn = $("inspectorAlertsBtn");
  if (alertsBtn) {
    alertsBtn.textContent = `Alertas ${alertCount}`;
    alertsBtn.title = `Alertas abiertas: ${alertCount}. Corregidas por Inspector: ${fixedCount}.`;
  }
  inspectorHealth(alertCount ? "checking" : "ready", alertCount ? `EDITCOREAI requiere atencion · ${alertCount} alerta(s)` : "EDITCOREAI operativo · sin alertas abiertas");
  renderInspectorReports(snapshot);
  return snapshot;
}

function activeModelConfigForInspector(requireTools = false) {
  const selectEl = $("inspectorModelSelect");
  const selectedValue = selectEl?.value || "";
  const active = loadProviderProfiles()
    .filter((profile) => profile?.providerKey === "custom:gafcore-gateway")
    .filter((profile) => ["active", "enabled"].includes(profile?.status) && profile?.apiKey && profile?.baseUrl && profile?.model)
    .filter((profile) => String(profile.baseUrl).toLowerCase().includes("gafcore-gateway.vercel.app"))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const selected = active.find((profile) => profile.id === selectedValue) || active[0];
  if (!selected) {
    throw new Error("Conecta el proyecto a GafCore Gateway y selecciona un modelo activo.");
  }
  return { mode: "inspector", baseUrl: selected.baseUrl, apiKey: selected.apiKey, model: selected.model, provider: selected.providerKey, providerKey: selected.providerKey, providerProfileId: selected.id };
}

function populateInspectorModelSelect() {
  const provSel = $("inspectorProviderSelect");
  const modelSel = $("inspectorModelSelect");
  if (!provSel || !modelSel) return;

  const prevProvider = provSel.value;
  const prevModel = modelSel.value;

  provSel.innerHTML = "";

  const addProvOpt = (value, label) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    provSel.appendChild(opt);
  };

  const profiles = loadProviderProfiles();
  const activeProfiles = profiles.filter(
    (p) => p?.providerKey === "custom:gafcore-gateway"
      && ["active", "enabled"].includes(p?.status)
      && p?.apiKey && p?.baseUrl && p?.model
      && String(p.baseUrl).toLowerCase().includes("gafcore-gateway.vercel.app")
  );

  const providerMap = new Map();
  for (const p of activeProfiles) {
    let hostname = "";
    try { hostname = new URL(p.baseUrl).hostname.replace("www.", ""); } catch {}
    const upstream = String(p.model).split("/", 1)[0].toLowerCase();
    const key = upstream || hostname || p.id;
    const upstreamLabel = ({ meai: "ME AI Cloud", apicredits: "APICredits" }[upstream] || upstream || "Proveedor");
    const label = `GafCore Gateway > ${upstreamLabel}`;
    if (!providerMap.has(key)) providerMap.set(key, { label, key, profiles: [] });
    providerMap.get(key).profiles.push(p);
  }

  for (const { label, key } of providerMap.values()) {
    addProvOpt(key, label);
  }

  if (prevProvider && [...provSel.options].some((o) => o.value === prevProvider)) {
    provSel.value = prevProvider;
  }

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
        const toolMark = hasTools ? "herramientas verificadas" : "disponible por GafCore";
        const modelLabel = String(p.model).split("/").slice(1).join("/") || p.model;
        addModelOpt(p.id, `${modelLabel} - ${toolMark}`);
      }
    }

    if (prevModel && [...modelSel.options].some((o) => o.value === prevModel)) {
      modelSel.value = prevModel;
    }
  }

  fillModels(provSel.value);

  provSel.onchange = () => fillModels(provSel.value);

  const row = $("inspectorModelSelectRow");
  if (row) row.style.display = provSel.options.length > 0 ? "" : "none";
  const status = $("inspectorApiStatus");
  if (status) {
    status.className = `inspector-api-status ${activeProfiles.length ? "ok" : "error"}`;
    status.textContent = activeProfiles.length
      ? `Inspector conectado al catalogo unificado de GafCore Gateway: ${activeProfiles.length} modelo(s). El escaneo local no consume API.`
      : "Inspector local disponible. Para chat o reparacion asistida, conecta este proyecto a GafCore Gateway.";
  }
}

function inspectorContextPrompt(snapshot) {
  const twin = snapshot?.twin || {};
  const runtime = snapshot?.runtime || {};
  const reports = snapshot?.reports || [];
  const issues = twin.issues || [];
  const projectDiagnosis = state.inspectorProjectSnapshot || {};
  const conn = loadJson("editcore-connections", {});
  const connLines = [
    `- GitHub: ${conn.githubToken ? "configurado" : "sin configurar"}`,
    `- Vercel: ${conn.vercelToken ? "configurado" : "sin configurar"}`,
    `- Supabase: ${conn.selfSupabaseUrl ? `configurado (${conn.selfSupabaseUrl})` : "sin configurar"}`,
    `- Servidor SSH: ${conn.serverHost ? conn.serverHost : "sin configurar"}`,
  ];
  return [
    "Eres Inspector Core AI, supervisor nativo de EDITCOREAI. Responde SIEMPRE en español.",
    "Eres un solo inspector visible para el usuario, pero internamente razonas como Planner, Debug, QA, Security, DevOps y Report Agent.",
    "Tu objetivo principal es diagnosticar EDITCOREAI: runtime, interfaz, APIs, modelos, agentes, colas, logs, herramientas y empaquetado.",
    "El chat diagnostica solicitudes especificas y no escribe por si solo. Las modificaciones solo se ejecutan mediante Reparar EDITCOREAI o Reparar proyecto.",
    "Si detectas un problema corregible, explica causa, evidencia y solucion, y termina exactamente con: CORRECCION_EDITCORE:, luego DESTINO: EDITCORE o DESTINO: PROYECTO, luego PROMPT: y la instruccion ejecutable para el motor de reparacion.",
    "Formato obligatorio para cualquier modelo: profesional, sin emojis, sin iconos decorativos, sin checks visuales genericos y sin tablas de estado no verificadas.",
    "No uses palabras como listo, terminado o completo si no tienes evidencia concreta de archivos, scripts, pruebas o reportes.",
    "Cada afirmacion importante debe indicar base: archivo revisado, script detectado, reporte, memoria o 'no verificado'.",
    "Si la evidencia no existe, dilo como 'No verificado todavia' y propone el analisis ejecutable correspondiente.",
    "No prometas haber modificado archivos desde el chat. Inspector diagnostica y los botones Reparar ejecutan con checkpoint, herramientas, pruebas y reversion.",
    "Prioriza funcionamiento correcto, seguridad, pruebas y no romper arquitectura existente.",
    "Estructura preferida: Estado, Evidencia revisada, Hallazgos, Riesgo, Acciones recomendadas, Siguiente paso.",
    "",
    "EDITCOREAI inspeccionado:",
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
    "Servicios conectados:",
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
    overview: "estado de EDITCOREAI",
    security: "Seguridad de EDITCOREAI",
    tests: "Validacion de EDITCOREAI",
    deploy: "Runtime y empaquetado",
    database: "Conexiones de EDITCOREAI",
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
    `Destino inspeccionado: ${runtime.root || evaluation?.targetRoot || "runtime de EDITCOREAI"}`,
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
    "### Estado nativo de EDITCOREAI",
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
  let root = String(state.inspectorSnapshot?.runtime?.root || "").trim();
  if (/\.asar$/i.test(root)) {
    const extracted = root.replace(/\.asar$/i, "-extracted");
    const withoutAsar = root.replace(/\.asar$/i, "");
    root = extracted || withoutAsar;
  }
  return root;
}

function inspectorActionLabel(action, target) {
  return `${action === "repair" ? "Reparacion" : "Escaneo"} ${target === "project" ? "del proyecto" : "de EDITCOREAI"}`;
}

async function runInspectorScan(target) {
  inspectorSetTab("chat");
  const buttons = [...document.querySelectorAll("[data-inspector-action]")];
  buttons.forEach((button) => { button.disabled = true; });
  const root = inspectorTargetRoot(target);
  const label = inspectorActionLabel("scan", target);
  inspectorHealth("checking", `${label} en curso`);
  startInspectorProgress(target === "project" ? "overview" : "report");
  const thinking = inspectorAppend("assistant", `${label}: leyendo archivos, ejecutando comprobaciones y observando el comportamiento real...`);
  const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `inspector-scan-${Date.now()}`;
  const offProgress = window.editcoreInspector?.onProgress?.((progress) => {
    if (progress?.runId === runId) setInspectorProgress(progress.percent, progress.label, progress.state || "running");
  });
  try {
    const evaluation = await window.editcoreInspector.diagnose(target, root, runId);
    thinking?.remove();
    if (target === "project") state.inspectorProjectSnapshot = evaluation;
    else state.inspectorSnapshot = await window.editcoreInspector.snapshot("editcore", "").catch(() => state.inspectorSnapshot);
    setInspectorHandoff({ ...evaluation, targetRoot: root, target: target === "project" ? "project" : "editcore-runtime" });
    const text = inspectorEvaluationMarkdown(target === "project" ? "project" : "report", evaluation);
    inspectorAppend("assistant", text);
    inspectorRemember("assistant", text);
    inspectorHealth(evaluation.status === "critical" ? "error" : evaluation.status === "attention" ? "checking" : "ready", `${label}: ${inspectorStatusLabel(evaluation.status)}`);
    finishInspectorProgress(target === "project" ? "overview" : "report");
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

async function repairInspectorTarget(target) {
  const buttons = [...document.querySelectorAll("[data-inspector-action]")].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  const root = inspectorTargetRoot(target);
  let checkpoint = null;
  let changedFiles = [];
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
    const safe = await window.editcoreInspector.repairSafe(target, root, `inspector-safe-repair-${Date.now()}`);
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
      const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `inspector-repair-${Date.now()}`;
      activeInspectorRepairRun = { runId, changedFiles: new Set() };
      result = await window.editcoreAgent.run({ ...modelConfig, prompt: safe.handoffPrompt, projectRoot: root, projectId: target === "project" ? (activeProject()?.id || "project") : "editcore-runtime", agentId: "inspector-core-repair", allowWrite: true, permissionMode: "full", planAuthorized: true, runId, resumeSteps: [] });
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
    inspectorHealth(unresolved ? "checking" : "ready", unresolved ? `Reparacion verificada · ${unresolved} alerta(s) pendiente(s)` : `${inspectorActionLabel("repair", target)} verificada`);
    finishInspectorProgress(target === "project" ? "overview" : "report");
  } catch (error) {
    changedFiles = [...new Set([...changedFiles, ...(activeInspectorRepairRun?.changedFiles || [])])];
    const message = error?.message || String(error);
    if (checkpoint?.id && changedFiles.length) await window.editcoreInspector.restore(target, root, checkpoint.id, changedFiles).catch(() => undefined);
    inspectorAppend("assistant", `## Reparacion detenida\n\n${message}\n\nInspector no declara una correccion sin validacion completa.`);
    inspectorRemember("assistant", `Reparacion detenida: ${message}`);
    inspectorHealth("error", message);
    failInspectorProgress(message);
  } finally {
    activeInspectorRepairRun = null;
    _inspectorCacheClear();
    if (checkpoint?.id) await window.editcoreInspector.discardCheckpoint(target, root, checkpoint.id).catch(() => undefined);
    buttons.forEach((button) => { button.disabled = false; });
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
  $("inspectorDialog").showModal();
  inspectorSetTab("chat");
  populateInspectorModelSelect();
  renderInspectorChat();
  reportInspectorTelemetry();
  try {
    await refreshInspectorForProject({ force: false });
  } catch (error) {
    inspectorHealth("error", error?.message || String(error));
  }
}

async function publishChanges(target = "project") {
  const isEditCore = target === "editcore";
  const modelConfig = (() => {
    try { return activeModelConfigForInspector(true); } catch {
      try { return activeModelConfigForChat(); } catch { return null; }
    }
  })();
  if (!modelConfig) {
    const msg = "Configura y verifica un proveedor de IA antes de publicar.";
    if (isEditCore) { inspectorAppend("assistant", msg); inspectorHealth("error", msg); }
    else appendMessage("assistant", msg);
    return;
  }

  const projectRoot = isEditCore
    ? (state.inspectorSnapshot?.runtime?.root || "")
    : (state.projectRoot || "");
  if (!projectRoot) {
    const msg = isEditCore
      ? "No se pudo determinar la ruta de EDITCOREAI. Ejecuta un escaneo primero."
      : "Abre un proyecto antes de publicar.";
    if (isEditCore) { inspectorAppend("assistant", msg); inspectorHealth("error", msg); }
    else appendMessage("assistant", msg);
    return;
  }

  const editcorePublishPrompt = [
    "## Publicar cambios de EDITCOREAI",
    "",
    "Ejecuta los siguientes pasos en orden. Usa run_command para cada uno.",
    "",
    "1. Verifica el estado actual del repositorio:",
    "   run_command: git status",
    "",
    "2. Revisa los cambios pendientes para generar un mensaje de commit descriptivo:",
    "   run_command: git diff --stat",
    "",
    "3. Reconstruye el archivo app.asar con los cambios actuales. Ejecuta desde la carpeta de instalacion de EDITCOREAI:",
    "   run_command: npx asar pack resources/app resources/app.asar",
    "",
    "4. Agrega los archivos modificados al commit (NO incluyas .asar.backup-*, node_modules, ni archivos de aceptacion):",
    "   run_command: git add resources/app/index.html resources/app/main.js resources/app/renderer.js resources/app/styles.css resources/app.asar",
    "",
    "5. Genera un mensaje de commit automatico basado en git diff --stat y crea el commit:",
    "   run_command: git commit -m \"[mensaje descriptivo basado en los cambios reales]\"",
    "   Si no hay nada que commitear, continua al paso siguiente.",
    "",
    "6. Sube los cambios al repositorio remoto:",
    "   run_command: git push origin main",
    "",
    "7. Si existe vercel.json en el proyecto, despliega a produccion:",
    "   run_command: vercel --prod --yes",
    "",
    "Reporta el resultado de cada paso. Si algun paso falla, explica el error y detente.",
  ].join("\n");

  const projectPublishPrompt = [
    "## Publicar cambios del proyecto",
    "",
    "Ejecuta los siguientes pasos en orden usando run_command.",
    "",
    "1. Verifica el estado actual:",
    "   run_command: git status",
    "",
    "2. Revisa los cambios para generar un mensaje de commit descriptivo:",
    "   run_command: git diff --stat",
    "",
    "3. Agrega todos los archivos modificados (excluye node_modules, .env, archivos de secrets):",
    "   run_command: git add -A",
    "",
    "4. Crea un commit con un mensaje descriptivo basado en los cambios reales de git diff --stat:",
    "   run_command: git commit -m \"[mensaje descriptivo]\"",
    "   Si no hay cambios que commitear, informa y continua.",
    "",
    "5. Sube al repositorio remoto:",
    "   run_command: git push origin main",
    "",
    "6. Si hay vercel.json, despliega a produccion:",
    "   run_command: vercel --prod --yes",
    "",
    "7. Si existe la carpeta supabase/migrations/ con migraciones nuevas sin aplicar, aplicarlas:",
    "   run_command: supabase db push",
    "",
    "Reporta el resultado de cada paso. Detente si algun paso falla y explica el error.",
  ].join("\n");

  const prompt = isEditCore ? editcorePublishPrompt : projectPublishPrompt;
  const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `publish-${Date.now()}`;

  if (isEditCore) {
    inspectorSetTab("chat");
    inspectorHealth("checking", "Publicando cambios de EDITCOREAI...");
    const thinking = inspectorAppend("assistant", "⏳ Publicando… resultado al finalizar.");
    try {
      const result = await window.editcoreAgent.run({
        ...modelConfig,
        prompt,
        projectRoot,
        projectId: "editcore-runtime",
        agentId: "inspector-publish",
        allowWrite: true,
        permissionMode: state.permissionMode,
        planAuthorized: true,
        runId,
        resumeSteps: [],
      });
      thinking?.remove();
      const text = result?.report?.text || result?.text || "Publicacion completada.";
      inspectorAppend("assistant", text);
      inspectorRemember("assistant", text);
      inspectorHealth("ready", "Cambios publicados");
    } catch (error) {
      thinking?.remove();
      const msg = error?.message || String(error);
      inspectorAppend("assistant", `## Error al publicar\n\n${msg}`);
      inspectorHealth("error", msg);
    }
  } else {
    const project = activeProject();
    if (!project) { append("assistant", "Abre un proyecto antes de publicar.", null, true, 0); return; }
    appendUserWithImages("📦 Publicar cambios del proyecto", []);
    rememberMessage("user", "📦 Publicar cambios del proyecto");
    const thinking = appendThinking("Preparando publicacion del proyecto...");
    try {
      const caps = agentModelCapabilities.get(`${modelConfig.baseUrl}|${modelConfig.model}`);
      const agentInput = {
        ...modelConfig,
        prompt,
        projectRoot,
        projectId: project.id,
        agentId: project.activeAgentId || state.activeAgentId || "",
        allowWrite: true,
        permissionMode: state.permissionMode,
        planAuthorized: true,
        runId,
        resumeSteps: [],
      };
      const result = await window.editcoreAgent.run(agentInput);
      removeThinking(thinking);
      const text = result?.report?.text || result?.text || "Publicacion completada.";
      append("assistant", text, result?.usage, true, 0);
      rememberMessage("assistant", text, result?.usage);
      if (result?.usage) recordUsage(result.usage);
      $("status").textContent = "Cambios publicados";
    } catch (error) {
      removeThinking(thinking);
      const msg = error?.message || String(error);
      append("assistant", `## Error al publicar\n\n${msg}`, null, true, 0);
      rememberMessage("assistant", `Error al publicar: ${msg}`);
      $("status").textContent = "Error al publicar";
    }
  }
}

const _inspectorResponseCache = new Map();
function _inspectorCacheKey(systemPrompt, history, prompt) {
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
  if (_inspectorResponseCache.size >= 30) {
    const oldest = [..._inspectorResponseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) _inspectorResponseCache.delete(oldest[0]);
  }
  _inspectorResponseCache.set(key, { text, at: Date.now() });
}
function _inspectorCacheClear() {
  _inspectorResponseCache.clear();
}

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

const INSPECTOR_REPAIR_INTENT = /\b(corrig|corrig[ei]|arregl|repar|soluciona|soluci[oó]nal|f[ií]jal|aplica la correc|implementa|hazlo|dale|proced)/i;
const INSPECTOR_DIAGNOSE_ONLY = /\b(solo|unicamente|nada m[aá]s)\s+(diagnos|analiz|revis|dime|report)|no (lo )?(corrijas|repares|cambies|apliques|toques)/i;
function inspectorPromptWantsRepair(prompt) {
  const text = String(prompt || "");
  if (INSPECTOR_DIAGNOSE_ONLY.test(text)) return false;
  return INSPECTOR_REPAIR_INTENT.test(text);
}

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
    "DESTINO: EDITCORE   (o PROYECTO si el fallo esta en el proyecto del usuario, no en EDITCOREAI)",
    "PROMPT: <instrucciones precisas de que archivo cambiar y como, con rutas reales que leiste>",
    "Sin ese bloque la correccion no se aplica: el hallazgo se queda en texto y el usuario no obtiene el arreglo.",
  ].join("\n");
}

function inspectorContextPromptCompact(snapshot) {
  const twin = snapshot?.twin || {};
  const runtime = snapshot?.runtime || {};
  const issues = (twin.issues || []).slice(0, 3);
  return [
    "Eres Inspector Core AI de EDITCOREAI. Responde en español, sin emojis, con evidencia concreta.",
    `EDITCOREAI: version ${runtime.version || "?"}, archivos ${twin.fileCount || 0}, alertas ${issues.length}.`,
    ...issues.map((i) => `  * [${i.severity}] ${i.title}`),
    `Proyecto: ${state.projectRoot || "sin proyecto"}`,
  ].join("\n");
}

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
  const thinking = inspectorAppend("assistant", "Analizando EDITCOREAI y el contexto solicitado...");
  try {
    const snapshot = state.inspectorSnapshot || await refreshInspectorForProject({ silent: true });
    const modelConfig = activeModelConfigForInspector();

    const allMessages = inspectorProjectMessages();
    const isFirstTurn = allMessages.filter((m) => m.role === "user").length <= 1;
    const systemPrompt = isFirstTurn ? inspectorContextPrompt(snapshot) : inspectorContextPromptCompact(snapshot);

    const history = allMessages.slice(0, -1).slice(-8).map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    }));

    const needsDetail = /repar|analiz|diagnos|revisa|complet|explica|describe|lista|todo|error|fallo|crash|build|deploy/i.test(prompt);
    const dynamicMaxTokens = needsDetail ? 4096 : 2048;

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
    if (!pendingCorrection) _inspectorCacheSet(cacheKey, cleanText);
    inspectorAppend("assistant", cleanText);
    inspectorRemember("assistant", cleanText);
    if (result.usage) recordUsage(result.usage);
    inspectorHealth("ready", "Inspector activo");
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
    await repairInspectorTarget("editcore");
    return;
  }
  const targetRoot = latestInspectorHandoff.targetRoot;
  if (!targetRoot) {
    inspectorHealth("error", "Inspector no pudo determinar la carpeta de destino para la correccion.");
    return;
  }
  const project = projectForRoot(targetRoot, /resources[\\/]app$/i.test(targetRoot) ? "EDITCOREAI" : "");
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
  head.textContent = "EDITCOREAI";
  const body = document.createElement("div");
  body.className = "msg-body";
  item.append(head, body);
  $("feed").appendChild(item);
  scrollFeedToBottom();
  return { item, body, head };
}

// ── Send ──────────────────────────────────────────────────────────────────────

function triggerChatSend() {
  const running = activePromptRequests.size > 0;
  const hasDraft = Boolean($("prompt").value.trim()) || state.attachments.length > 0;
  if (running && !hasDraft) {
    void cancelActiveResponse();
    return;
  }
  send({ preventDefault() {} }).catch((error) => {
    $("prompt").value = "";
    updateSendButtonState();
    $("status").textContent = error?.message || String(error);
  });
}

async function send(event) {
  event?.preventDefault?.();
  const prompt = $("prompt").value.trim();
  const hasAttachments = state.attachments.length > 0;
  const hasImages = state.attachments.some((item) => /^image\/(png|jpeg|webp)$/i.test(item.mimeType));
  if (!prompt && !hasAttachments) return;
  let effectivePrompt = prompt || (hasImages ? "Analiza la imagen adjunta." : "Analiza los archivos adjuntos.");

  const project = activeProject();
  const selectedRunMode = $("runMode").value;
  const initialModeDecision = ProjectAnalysis.resolveExecutionMode(effectivePrompt, {
    requestedAgent: selectedRunMode === "agent",
    projectOpen: Boolean(state.projectRoot),
    resumableTask: hasResumableAgentTask(project),
    workflowPhase: project?.agentWorkflow?.phase || "",
  });
  if (initialModeDecision.missingProject) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = initialModeDecision.explicitChangeRequest
      ? "Esta solicitud requiere modificar archivos. Abre o crea el proyecto de destino; entonces la cambiare automaticamente a modo Agente, preparare el plan y esperare una sola autorizacion. No se realizo ninguna llamada al proveedor."
      : "Abre o crea un proyecto antes de usar el agente. El agente necesita una carpeta concreta para leer archivos, ejecutar herramientas y verificar resultados. No se realizo ninguna llamada al proveedor.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0, estimated_input_tokens: 0, estimated_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    $("prompt").value = "";
    $("status").textContent = "Agente en espera de un proyecto";
    updateSendButtonState();
    return;
  }
  const intent = classifyPromptIntent(effectivePrompt);
  const requestsLocalProjectWork = Boolean(state.projectRoot)
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
  } else if (!hasAttachments && project && ProjectAnalysis.isTaskStatusQuestion(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = await durableAgentWorkflowStatusText(project);
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Estado recuperado de memoria durable · 0 tokens de API";
    updateSendButtonState();
    return;
  }
  if (!hasAttachments && project && hasResumableAgentTask(project)
    && !isAgentAuthorization(effectivePrompt)
    && ProjectAnalysis.isAgentWorkflowQuestion(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    let response;
    try {
      response = await answerAgentWorkflowQuestion(project, effectivePrompt);
    } catch (error) {
      response = `${ProjectAnalysis.workflowQuestionContext(project.agentWorkflow, project.analysisMemory)}\n\nNo pude consultar al modelo: ${error?.message || error}\n\nPara aplicar correcciones escribe **procede**, **autorizo** o **continua**.`;
    }
    const usage = { local_response: false, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    notifyVoiceAssistant(response);
    notifyVoiceTurnComplete();
    $("prompt").value = "";
    $("status").textContent = "Pregunta respondida · escribe procede/autorizo/continua para ejecutar";
    updateSendButtonState();
    return;
  }
  if (!hasAttachments && ProjectAnalysis.isPercentageQuestion(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = project?.analysisMemory
      ? ProjectAnalysis.percentageResponse(project.analysisMemory)
      : "## Porcentaje de terminacion: no determinable todavia\n\nNo existe un analisis verificable guardado para el proyecto activo. Ejecuta primero un analisis de solo lectura; EDITCOREAI debe revisar requisitos, archivos y comprobaciones reales antes de calcular cualquier porcentaje.";
    const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0, estimated_input_tokens: 0, estimated_output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("prompt").value = "";
    $("status").textContent = "Porcentaje respondido desde evidencia local · 0 tokens de API";
    updateSendButtonState();
    return;
  }
  let analysisRepairAuthorization = false;
  const userAuthorized = isAgentAuthorization(effectivePrompt);
  if (userAuthorized && project) await ensureWorkflowFromPendingPlan(project, effectivePrompt);
  if (!hasAttachments && project?.analysisMemory && userAuthorized && !hasResumableAgentTask(project)) {
    analysisRepairAuthorization = true;
    effectivePrompt = analysisRepairPrompt(project.analysisMemory, effectivePrompt);
  }
  const activeAgent = [...activePromptRequests.values()].find((job) =>
    job.isAgent && job.agentExecuting && job.runId
      && normalizeProjectRoot(job.projectRoot) === normalizeProjectRoot(state.projectRoot)
  );
  const steeringRunId = activeAgent?.runId || (project?.agentWorkflow?.phase === "executing" ? project.agentWorkflow.runId : "");
  if (steeringRunId && !hasAttachments) {
    const result = await window.editcoreAgent.steer({ instruction: effectivePrompt, runId: steeringRunId });
    if (result?.accepted) {
      appendUserWithImages(effectivePrompt, []);
      rememberMessage("user", effectivePrompt);
      const response = `Instruccion recibida e incorporada a la tarea activa. La aplicare en el siguiente punto seguro sin perder el avance actual.`;
      const usage = { local_response: true, confirmed_input_tokens: 0, confirmed_output_tokens: 0 };
      append("assistant", response, usage, true, 0);
      rememberMessage("assistant", response, usage);
      $("prompt").value = "";
      $("status").textContent = `Instruccion dirigida · ${result.pendingDirections || 1} pendiente(s) · 0 tokens de API`;
      updateSendButtonState();
      return;
    }
  }
  if (!hasAttachments && $("runMode").value === "agent" && state.permissionMode !== "full" && isAgentStatusQuestion(effectivePrompt) && hasResumableAgentTask(project)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    const response = agentWorkflowStatusText(project.agentWorkflow);
    const usage = { local_response: true, input_tokens: 0, output_tokens: 0 };
    append("assistant", response, usage, true, 0);
    rememberMessage("assistant", response, usage);
    $("prompt").value = "";
    $("status").textContent = project.agentWorkflow.phase === "interrupted" ? "Tarea interrumpida disponible para reanudar" : "Estado del agente actualizado";
    updateSendButtonState();
    return;
  }
  if (isChatModelAutoMode()) await refreshModelCapabilities().catch(() => undefined);
  const job = buildPromptJob(effectivePrompt);
  if (!job) {
    $("prompt").value = "";
    updateSendButtonState();
    return;
  }
  if (userAuthorized && isPlanAuthorizedExecution(project, prompt, job.isAgent)) {
    job.planAuthorizedExecution = true;
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
  if ((job.planAuthorizedExecution || isAgentAuthorization(effectivePrompt))
    && hasResumableAgentTask(project)
    && ["awaiting_authorization", "interrupted"].includes(project?.agentWorkflow?.phase || "")) {
    await cancelProjectAgentJobs(state.projectRoot);
  }
  const fingerprint = promptJobFingerprint(job);
  const duplicate = !job.planAuthorizedExecution && !job.userAuthorized && !isAgentAuthorization(effectivePrompt) && (
    pendingPromptFingerprints.has(fingerprint)
    || [...activePromptRequests.values(), ...promptQueue].some((candidate) => promptJobFingerprint(candidate) === fingerprint)
  );
  if (duplicate) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
    $("prompt").value = "";
    $("status").textContent = `La solicitud ya esta en ejecucion con ${job.model}; no se duplico.`;
    updateSendButtonState();
    return;
  }
  if (!hasAttachments && project?.analysisMemory && ProjectAnalysis.isAnalysisFollowUp(effectivePrompt, true)
    && /\b(?:reporte|resultado|hallazgos|an[aá]lisis)\b/i.test(effectivePrompt)) {
    appendUserWithImages(effectivePrompt, []);
    rememberMessage("user", effectivePrompt);
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
    const visiblePrompt = ProjectAnalysis.redactCredentials(job.prompt);
    appendUserWithImages(visiblePrompt, job.images || []);
    rememberMessage("user", visiblePrompt, null, job.images || [], job.documents || []);
    if (job.autoEscalatedAgent) {
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
  const modeDecision = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent,
    projectOpen: Boolean(state.projectRoot),
    resumableTask: hasResumableAgentTask(activeProject()),
    workflowPhase: activeProject()?.agentWorkflow?.phase || "",
  });
  if (modeDecision.missingProject) {
    $("status").textContent = "Abre o crea un proyecto para usar el agente";
    return null;
  }
  const intent = classifyPromptIntent(prompt);
  const analysisMemory = activeProject()?.analysisMemory || null;
  const projectOpen = modeDecision.projectOpen;
  const resumable = hasResumableAgentTask(activeProject());
  const workflowPhase = activeProject()?.agentWorkflow?.phase || "";
  const resumableExecutable = resumable && ["interrupted", "executing", "awaiting_authorization"].includes(workflowPhase);
  const userAuthPrompt = isAgentAuthorization(prompt);
  const projectRequest = projectOpen && (
    ["analysis", "task"].includes(intent)
    || /\b(proyecto|carpeta|archivo|c[o\u00f3]digo|workspace|repositorio|repo|aplicaci[o\u00f3]n|app)\b/i.test(prompt)
  );
  const isAgent = modeDecision.isAgent;
  const readOnlyChat = !isAgent && projectRequest;
  const explicitChangeRequest = modeDecision.explicitChangeRequest;
  const casualConversation = intent === "conversation"
    && !/\b(analiza|revisa|verifica|investiga|diagnostica|audita|proyecto|archivo|c[oó]digo|workspace|repositorio|tarea|medias|terminas|dejas|agente|avance|completar|porque|por\s*qu[eé])\b/i.test(prompt)
    && !(isAgent && resumable)
    && !(isAgent && analysisMemory);
  const analysisIntent = ["analysis", "followup"].includes(intent);
  let usesProjectTools = isAgent || readOnlyChat;
  if (isAgent && casualConversation) usesProjectTools = false;
  const planAuthorizedExecution = isPlanAuthorizedExecution(activeProject(), prompt, isAgent);
  const authorizedContinuation = planAuthorizedExecution
    || (isAgent && resumable && userAuthPrompt)
    || (modeDecision.isAgent && resumableExecutable
    && (userAuthPrompt || ProjectAnalysis.isRecoveryInstruction(prompt) || ProjectAnalysis.isAgentTaskFeedback(prompt)));
  const wantsFreshAnalysis = ProjectAnalysis.isFreshAnalysisRequest(prompt);
  const needsAnalysisFirst = isAgent && usesProjectTools && !planAuthorizedExecution && !authorizedContinuation
    && (!resumable || wantsFreshAnalysis) && !userAuthPrompt;
  let directReadOnly = readOnlyChat || needsAnalysisFirst;
  if (state.permissionMode === "readonly" && usesProjectTools && !planAuthorizedExecution && !authorizedContinuation) {
    directReadOnly = true;
  }
  const continueAuthorized = isAgent
    && !directReadOnly
    && projectOpen
    && state.permissionMode === "full"
    && [...activePromptRequests.values()].some((job) => job.isAgent && job.projectRoot === (state.projectRoot || ""));

  const autoContext = {
    prompt,
    isAgent,
    usesProjectTools,
    directReadOnly,
    planAuthorizedExecution,
    needsAnalysisFirst,
    hasAttachments: state.attachments.length > 0,
    hasImages: state.attachments.some((item) => /^image\/(png|jpeg|webp)$/i.test(item.mimeType)),
  };
  const selectedProfile = resolveActiveChatProfile(autoContext);
  if (!selectedProfile) {
    $("status").textContent = autoMode ? "Auto: no hay modelos verificados" : "Selecciona un modelo verificado";
    alert(autoMode
      ? "No hay modelos verificados para Auto. Abre Modelos (⚙) y verifica al menos uno."
      : "Por favor, selecciona un modelo verificado. Abre Modelos (⚙) si necesitas configurar uno.");
    return null;
  }
  rememberAutoResolvedProfile(selectedProfile);

  const selectedProviderKey = selectedProfile.providerKey;
  const selectedProfileId = selectedProfile.id;
  const providerData = loadJson("editcore-providers", {})[selectedProviderKey] || {};
  const model = selectedProfile.model;
  const apiKey = selectedProfile.apiKey;
  const baseUrl = selectedProfile.baseUrl || providerData.baseUrl || PROVIDERS[selectedProviderKey]?.baseUrl || "";

  if (!apiKey) {
    openSettings();
    $("status").textContent = "Falta API key";
    alert("Falta configurar la API key para este modelo. Por favor, ingresa tu clave en el menú de Configuración.");
    return null;
  }

  const hasActiveRunningAgent = [...activePromptRequests.values()].some((j) => j.usesProjectTools || j.isAgent);
  return {
    id: uid(),
    prompt,
    isAgent,
    isSubAgent: hasActiveRunningAgent,
    autoEscalatedAgent: modeDecision.autoEscalatedAgent,
    usesProjectTools,
    readOnlyChat,
    requireEvidence: isAgent || projectRequest || ["analysis", "task"].includes(intent),
    intent,
    directReadOnly,
    resumeAuthorized: authorizedContinuation,
    planAuthorizedExecution,
    needsAnalysisFirst,
    continueAuthorized,
    autoSelectedModel: autoMode,
    mode: state.mode,
    baseUrl,
    apiKey,
    model,
    projectRoot: state.projectRoot || "",
    projectId: activeProject()?.id || "",
    agentId: activeProject()?.activeAgentId || state.activeAgentId || "",
    allowWrite: state.permissionMode !== "readonly",
    permissionMode: state.permissionMode,
    providerKey: selectedProviderKey,
    providerProfileId: selectedProfileId,
    images: state.attachments.filter((a) => /^image\/(png|jpeg|webp)$/i.test(a.mimeType)),
    documents: state.attachments.filter((a) => !/^image\/(png|jpeg|webp)$/i.test(a.mimeType)),
    history: cleanHistoricalProjectMessages(state.history.filter((m) => m.role !== "system")),
    analysisContext: analysisMemory ? ProjectAnalysis.analysisContext(analysisMemory) : "",
    queuedAt: Date.now(),
  };
}

function agentCapabilityKey(job) {
  return `${job.providerKey || job.baseUrl}|${job.model}`;
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
    $("status").textContent = `Verificando agente con ${job.model}...`;
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
  if (!result?.toolOK) throw new Error(`${job.model} funciona para chat, pero no emitio herramientas de agente: ${result?.toolError || "formato incompatible"}`);
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
  if (!button) return;
  const running = activePromptRequests.size > 0 || promptQueue.some((item) => !item.cancelled);
  const hasDraft = Boolean($("prompt").value.trim()) || state.attachments.length > 0;
  const agentNeedsProject = $("runMode").value === "agent" && !state.projectRoot;
  const showStop = running && !hasDraft;

  button.classList.toggle("stop-mode", showStop);
  button.dataset.mode = showStop ? "stop" : "send";
  if (showStop) {
    button.title = `Detener ${Math.max(activePromptRequests.size, 1)} tarea(s)`;
    button.innerHTML = "&#9632;";
    button.disabled = false;
  } else if (agentNeedsProject) {
    button.title = hasDraft ? "Abre o crea un proyecto para usar el agente" : "Enviar";
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
  const active = [...activePromptRequests.values()];
  if (!active.length) return;
  const now = Date.now();
  active.forEach((job) => {
    job.cancelled = true;
    job.cancelRequestedAt = now;
    job.cancelRequestedBy = "stop-button";
    const live = activeAgentThinkingRuns.get(job.planRunId || job.runId);
    if (live?.thinking) setThinkingStatus(live.thinking, "Cancelando...");
  });
  $("status").textContent = `Cancelando ${active.length} tarea(s)...`;
  const cancelCalls = [
    ...active.map((job) => window.editcoreAgent.cancel({ runId: job.planRunId || job.runId || "" }).catch(() => false)),
    window.editcoreAgent.cancel({ runId: "" }).catch(() => false),
    window.editcoreChat.cancel().catch(() => false),
  ];
  await Promise.all(cancelCalls);
}

function countActiveAgents(active = []) {
  return active.filter((job) => job.usesProjectTools).length;
}

function canLaunchParallelAgent(next, active = []) {
  if (!next?.usesProjectTools) return false;
  if (countActiveAgents(active) >= MAX_PARALLEL_AGENTS) return false;
  const root = normalizeProjectRoot(next.projectRoot || "");
  const nextWrite = next.isAgent && !next.directReadOnly && !next.readOnlyChat;
  if (!nextWrite) return true;
  return !active.some((job) => job.usesProjectTools && job.isAgent && !job.directReadOnly && !job.readOnlyChat
    && normalizeProjectRoot(job.projectRoot || "") === root);
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

async function runAgentUntilSettled(input, { targetRun, thinking, runAgent = window.editcoreAgent.run }) {
  const usageRows = [];
  let result = null;
  let segment = 0;
  while (true) {
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
    if (result.report?.completed || result.report?.autoResumeRecommended !== true) break;
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
  result.report = {
    ...(result.report || {}),
    autoResumeCount: Math.max(0, usageRows.length - 1),
    autoResumeLimitReached: false,
  };
  return result;
}

async function executePromptJob(job) {
  const prompt = job.prompt;
  const isAgent = job.isAgent;
  const usesProjectTools = job.usesProjectTools;
  if (isAgent && !job.projectRoot) {
    $("status").textContent = "Abre un proyecto para usar agente";
    await pickProject().catch(() => undefined);
    if (!state.projectRoot) throw new Error("No hay proyecto abierto para el agente.");
    job.projectRoot = state.projectRoot;
    job.projectId = activeProject()?.id || "";
  }
  if (isAgent && normalizeProjectRoot(job.projectRoot) === normalizeProjectRoot(projectCatalogParent())) {
    throw new Error("El agente necesita un proyecto concreto. Abre uno desde Proyectos o con el boton Abrir.");
  }

  const pendingAuthorization = isAgent && isAgentAuthorization(prompt);
  const projectForJob = state.projects.find((item) => item.id === job.projectId)
    || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(job.projectRoot))
    || activeProject();

  const outgoingImages = job.images || [];
  const documents = job.documents || [];
  if (!job.userMessageDisplayed) {
    const visiblePrompt = ProjectAnalysis.redactCredentials(job.prompt);
    appendUserWithImages(visiblePrompt, job.images || []);
    rememberMessage("user", visiblePrompt, null, job.images || [], job.documents || []);
    job.userMessageDisplayed = true;
  }

  const showAgentLog = usesProjectTools && isAgent;
  const parallelLabel = showAgentLog && (activePromptRequests.size > 0 || promptQueue.some((item) => item.usesProjectTools))
    ? String(prompt).replace(/\s+/g, " ").trim().slice(0, 42)
    : "";
  const thinking = appendThinking("", showAgentLog, parallelLabel);
  const stopTimer = startResponseTimer(thinking.querySelector(".msg-head"));
  let elapsedSeconds = 0;
  if (showAgentLog) {
    job.runId = job.runId || uid();
    activeAgentThinkingRuns.set(job.runId, {
      thinking,
      projectId: job.projectId || projectForJob?.id || "",
    });
  }

  try {
    $("status").textContent = usesProjectTools ? (isAgent ? "Agente trabajando..." : "Analizando proyecto...") : "Pensando...";
    if (usesProjectTools) {
      const project = state.projects.find((item) => item.id === job.projectId)
        || state.projects.find((item) => normalizeProjectRoot(item.projectRoot) === normalizeProjectRoot(job.projectRoot))
        || activeProject();
      const continueAuthorized = Boolean(job.continueAuthorized);
      const directReadOnly = Boolean(job.directReadOnly);
      const workflowPhase = project?.agentWorkflow?.phase || "";
      const resumableExecutable = hasResumableAgentTask(project) && ["interrupted", "executing", "awaiting_authorization"].includes(workflowPhase);
      const planAuthorizedExecution = Boolean(job.planAuthorizedExecution)
        || isPlanAuthorizedExecution(project, prompt, isAgent);
      const authorizedContinuation = planAuthorizedExecution || (isAgent && resumableExecutable
        && (Boolean(job.resumeAuthorized) || isAgentAuthorization(prompt) || ProjectAnalysis.isRecoveryInstruction(prompt) || ProjectAnalysis.isAgentTaskFeedback(prompt)));
      const authorized = !isAgent || authorizedContinuation || continueAuthorized || planAuthorizedExecution;
      if (!isAgent || authorized || directReadOnly) {
        if (directReadOnly) {
          setAgentActivity(job.needsAnalysisFirst ? "Analizando proyecto con herramientas..." : "Analizando proyecto...");
          setThinkingStatus(thinking, "Analizando proyecto...");
          if (showAgentLog) {
            addAgentStepToThinking(thinking, {
              phase: "startup",
              stage: "analysis",
              text: job.needsAnalysisFirst ? "Iniciando analisis del proyecto..." : "Revisando el proyecto...",
            });
          }
        } else if (authorizedContinuation || continueAuthorized) {
          setAgentActivity("Ejecutando tarea...");
          setThinkingStatus(thinking, "Pensando...");
          if (!agentModelCapabilities.has(agentCapabilityKey(job))) {
            try {
              await ensureAgentModelCapability(job);
            } catch (error) {
              const message = String(error?.message || error);
              if (!/timeout|aborted|operation was aborted|the operation was aborted/i.test(message)) throw error;
            }
          }
        } else {
          setAgentActivity(`Verificando ${job.model}...`);
          setThinkingStatus(thinking, "Pensando...");
          try {
            await ensureAgentModelCapability(job);
          } catch (error) {
            const message = String(error?.message || error);
            if (!/timeout|aborted|operation was aborted|the operation was aborted/i.test(message)) throw error;
            setAgentActivity("Continuando con el agente...");
          }
        }
      }
      if (isAgent && isAgentAuthorization(prompt)) await ensureWorkflowFromPendingPlan(project, prompt);
      if (isAgent && !directReadOnly && !continueAuthorized && !authorizedContinuation && !hasResumableAgentTask(project)) {
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
      const isolatedRun = directReadOnly || !isAgent || (continueAuthorized && !authorizedContinuation);
      const storedTask = agentTaskPrompt(project.agentWorkflow?.taskId || job.taskId, project.agentWorkflow?.task || prompt);
      // FIX CRITICO: cuando el usuario escribio una autorizacion pura ("procede",
      // "adelante", "autorizo", etc.) pasar SIEMPRE el prompt crudo al backend.
      // Sin esto, si planAuthorizedExecution/isPlanAuthorizedExecution fallaba,
      // el renderer reemplazaba "procede" por storedTask y main.js no podia
      // detectar la autorizacion con looksLikeAgentApproval(task).
      const rawAuthorization = isAgentAuthorization(prompt);
      const executionPrompt = planAuthorizedExecution
        ? (ProjectAnalysis.resolveAuthorizedExecutionPrompt
          ? ProjectAnalysis.resolveAuthorizedExecutionPrompt(prompt, { ...project.agentWorkflow, task: storedTask }, storedTask)
          : ProjectAnalysis.authorizedPlanExecutionPrompt({ ...project.agentWorkflow, task: storedTask }))
        : authorizedContinuation
          ? ProjectAnalysis.recoveryPrompt({ ...project.agentWorkflow, task: storedTask }, prompt)
          : isolatedRun
            ? prompt
            : (rawAuthorization ? prompt : storedTask);
      const recoveryProjection = !isolatedRun && window.editcoreTasks
        ? await window.editcoreTasks.status(project.agentWorkflow?.taskId || job.taskId || "").catch(() => null)
        : null;
      const resumeCount = Number(recoveryProjection?.lastCheckpoint?.completedSteps?.length || 0);
      const runId = job.runId || uid();
      job.runId = runId;
      if (showAgentLog) {
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
      const effectiveAllowWrite = planAuthorizedExecution && job.permissionMode !== "readonly"
        ? true
        : (!isAgent || directReadOnly ? false : job.permissionMode !== "readonly");
      const effectiveAnalysisMode = planAuthorizedExecution ? false : (!isAgent || directReadOnly);
      const effectivePermissionMode = planAuthorizedExecution && job.permissionMode !== "readonly"
        ? job.permissionMode
        : (!isAgent || directReadOnly ? "readonly" : job.permissionMode);
      if (planAuthorizedExecution && job.permissionMode === "readonly") {
        const blocked = "El plan esta autorizado pero el permiso es Solo lectura. Cambia a Paso a paso o Acceso completo y escribe procede de nuevo.";
        elapsedSeconds = stopTimer();
        append("assistant", blocked, null, true, elapsedSeconds);
        rememberMessage("assistant", blocked);
        $("status").textContent = "Permiso insuficiente para ejecutar correcciones";
        return;
      }
      setAgentActivity(directReadOnly ? "Analizando proyecto..." : planAuthorizedExecution ? "Ejecutando plan autorizado..." : continueAuthorized ? "Ejecutando tarea..." : "Ejecutando plan autorizado...");
      const targetRun = isolatedRun ? runRecord : project.agentWorkflow;
      let result;
      try {
        result = await runAgentUntilSettled({
        mode: job.mode, baseUrl: job.baseUrl, apiKey: job.apiKey, model: job.model, prompt: executionPrompt,
        originalGoal: project?.agentWorkflow?.task || project?.analysisMemory?.request || job.prompt,
        images: workflowImages(outgoingImages),
        documents: workflowDocuments(documents),
        projectRoot: job.projectRoot,
        projectId: project?.id || job.projectId || "",
        agentId: project?.activeAgentId || "",
        allowWrite: effectiveAllowWrite,
        permissionMode: effectivePermissionMode,
        analysisMode: effectiveAnalysisMode,
        requireEvidence: job.requireEvidence,
        analysisContext: job.analysisContext || "",
        singleTask: usesProjectTools,
        // FIX CRITICO: enviar planAuthorized=true tambien cuando el usuario
        // escribio una autorizacion pura ("procede", "adelante", "autorizo"),
        // aunque planAuthorizedExecution haya quedado en falso por una
        // deteccion de reporte previo fallida. main.js propaga este flag a
        // validateAgentCompletion y al adapter para exponer write_file.
        planAuthorized: Boolean(planAuthorizedExecution) || isAgentAuthorization(prompt),
        fixQueue: planAuthorizedExecution
          ? (project?.agentWorkflow?.fixQueue || project?.durableWorkflow?.fixQueue || [])
          : [],
        executionMode: job.executionMode || (planAuthorizedExecution ? "AUTHORIZED_PLAN" : ""),
        planId: planAuthorizedExecution
          ? (job.planId || project?.agentWorkflow?.planId || project?.durableWorkflow?.planId || "")
          : "",
        history: job.history,
        runId,
        taskId: (directReadOnly && (job.needsAnalysisFirst || ProjectAnalysis.isFreshAnalysisRequest(job.prompt || prompt)))
          ? ""
          : (targetRun?.taskId || job.taskId || project?.agentWorkflow?.taskId || project?.durableWorkflow?.taskId || ""),
        resume: Boolean(recoveryProjection) || Boolean(project.agentWorkflow?.resumeSteps?.length),
        resumeSteps: project.agentWorkflow?.resumeSteps || [],
        preobservedFiles: [...new Set(project.analysisMemory?.filesInspected || [])],
      }, { targetRun, thinking });
      } finally {
        activeAgentThinkingRuns.delete(runId);
      }
      if (targetRun && result.taskId) targetRun.taskId = result.taskId;
      if (result.planId && project?.agentWorkflow) project.agentWorkflow.planId = result.planId;
      if (result.planId || result.taskId) await syncDurableWorkflow(project);
      const reportText = String(result.text || "").trim() || extractThinkingNarrativeFallback(thinking);
      const analysisReportReady = Boolean(result.report?.completed)
        && (ProjectAnalysis.isAnalysisReport(reportText) || ProjectAnalysis.isPendingAnalysisPlan(reportText))
        && !planAuthorizedExecution
        && !authorizedContinuation
        && !continueAuthorized
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
          targetRun.phase = result.report?.completed ? "completed" : "interrupted";
          targetRun.error = result.report?.completed ? "" : reportText;
          if (!result.report?.completed && Array.isArray(result.steps) && result.steps.length) {
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
      if (directReadOnly && result.report?.completed) {
        const memoryReportText = analysisReportReady ? normalizedReportText : reportText;
        project.analysisMemory = ProjectAnalysis.buildAnalysisMemory({
          projectName: projectDisplayName(project),
          projectRoot: job.projectRoot,
          request: executionPrompt,
          resultText: memoryReportText,
          model: job.model,
          steps: result.steps,
          report: result.report,
        });
        if (job.needsAnalysisFirst || analysisReportReady) {
          markWorkflowAwaitingAuthorization(project, {
            taskId: result.taskId || job.taskId || "",
            planId: result.planId || project.agentWorkflow?.planId || "",
            task: executionPrompt,
            plan: memoryReportText,
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
              content: memoryReportText,
              planId: result.planId || project.agentWorkflow?.planId || "",
              fixQueue: project.agentWorkflow?.fixQueue || [],
            }).catch(() => null);
          }
          await saveAgentTaskPrompt(project.agentWorkflow.taskId, executionPrompt);
          updateAgentPipelineUi({
            visible: true,
            queue: Array.isArray(project.agentWorkflow?.fixQueue) && project.agentWorkflow.fixQueue.length
              ? `0/${project.agentWorkflow.fixQueue.length} · listo para PROCEDE`
              : "Plan listo · PROCEDE",
            queueState: "warn",
            diagnosticState: agentPipelineState.diagnosticState || "",
          });
          $("status").textContent = "Análisis listo · escribe procede, autorizo o continua";
        }
      } else if (analysisReportReady && targetRun === project.agentWorkflow) {
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
        $("status").textContent = "Análisis listo · escribe procede, autorizo o continua";
      }
      saveProjects();
      elapsedSeconds = stopTimer();
      const finalText = String(result.text || "").trim() || extractThinkingNarrativeFallback(thinking);
      rememberMessage("assistant", finalText, result.usage);
      finalizeThinkingAsAssistant(thinking, finalText, result.usage, elapsedSeconds);
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
    } else {
      let accumulated = "";
      let streamEl = null;
      let streamBody = null;
      let finalUsage = null;

      window.editcoreStream.offChunk();
      window.editcoreStream.onChunk((chunk) => {
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
          const stopStreamingTimer = startResponseTimer(s.head);
          job.stopStreamingTimer = stopStreamingTimer;
        }
        accumulated = replace ? text : `${accumulated}${text}`;
        streamBody.innerHTML = renderMarkdown(accumulated);
        scrollFeedToBottom();
      });

      const result = await window.editcoreChat.chat({
        mode: job.mode, baseUrl: job.baseUrl, apiKey: job.apiKey, model: job.model, prompt,
        providerKey: job.providerKey || "",
        images: outgoingImages,
        projectRoot: job.projectRoot || "",
        projectId: activeProject()?.id || "",
        agentId: activeProject()?.activeAgentId || state.activeAgentId || "",
        permissionMode: job.permissionMode || state.permissionMode || "step",
        history: job.history,
        systemPrompt: job.analysisContext ? [
          "Eres EDITCOREAI, un asistente de desarrollo experto. Responde siempre en español, de forma directa y basada en evidencia.",
          "Las preguntas informativas y de seguimiento no requieren autorizacion. No afirmes que perdiste contexto si la memoria verificada incluye el proyecto.",
          job.analysisContext,
        ].join("\n\n") : "",
      });

      window.editcoreStream.offChunk();
      elapsedSeconds = job.stopStreamingTimer ? job.stopStreamingTimer() : stopTimer();
      removeThinking(thinking);

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
        if (finalUsage) {
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
    const rawMessage = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*/i, "");
    const cancelled = (Boolean(job.cancelled) && Boolean(job.cancelRequestedBy))
      || /cancelad[oa]|aborted|abort/i.test(rawMessage);
    const message = cancelled
      ? "Cancelado por el usuario."
      : rawMessage && rawMessage !== "<none>"
        ? rawMessage
        : "EDITCOREAI no recibió un error legible del proveedor o del proyecto.";
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
    if (usesProjectTools && thinking) finalizeThinkingAsAssistant(thinking, message, null, elapsedSeconds);
    else append("assistant", message, null, true, elapsedSeconds);
    notifyVoiceAssistant(message);
    handleProviderFailureForAuto(message, job).catch(() => undefined);
    $("status").textContent = cancelled ? "Cancelado" : "Error";
  } finally {
    if (job.runId) activeAgentThinkingRuns.delete(job.runId);
    job.agentExecuting = false;
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
  const item = document.createElement("article");
  item.className = "msg assistant agent-approval-card";
  item.dataset.approvalRequestId = requestId;

  const header = document.createElement("div");
  header.className = "msg-head";
  header.textContent = "EDITCOREAI · Permiso requerido";

  const body = document.createElement("div");
  body.className = "msg-body";
  const title = document.createElement("p");
  title.textContent = String(request.message || "El agente necesita tu autorizacion para continuar.");
  const detail = document.createElement("pre");
  detail.className = "agent-approval-detail";
  detail.textContent = String(request.detail || "").trim();
  body.append(title);
  if (detail.textContent) body.appendChild(detail);

  const actions = document.createElement("div");
  actions.className = "agent-approval-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost-btn";
  cancelBtn.textContent = "Cancelar";
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "primary-btn";
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
      ? "Autorizacion concedida. El agente continua..."
      : "Autorizacion cancelada. El agente no ejecutara esta accion.";
    actions.remove();
    await window.editcoreAgent.respondApproval({ requestId, approved }).catch(() => false);
    $("status").textContent = approved ? "Accion autorizada" : "Accion cancelada";
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
  const item = document.createElement("article");
  item.className = "msg user";

  const header = document.createElement("div");
  header.className = "msg-head";
  header.textContent = "Tú";

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = renderMarkdown(text);

  item.append(header, body);

  for (const img of images) {
    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = img.name;
    imgEl.className = "msg-img";
    item.appendChild(imgEl);
  }

  $("feed").appendChild(item);
  scrollFeedToBottom();
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
    if (badSubstrings.some((bad) => url.includes(bad))) { changed = true; return false; }
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
  if (config.modelSelectionMode) return;
  if (!verifiedChatModelOptions().length) return;
  await saveSecureJson("editcore-chat-config", { ...config, remember: true, modelSelectionMode: "auto" });
}

async function boot() {
  $("previewWebview").setAttribute("partition", PREVIEW_PARTITION);
  setPreviewMode(localStorage.getItem(PREVIEW_MODE_STORAGE_KEY) || "web");
  await initializeSecureState();
  if (loadJson("editcore-rtk", {}).enabled !== true) await saveSecureJson("editcore-rtk", { enabled: true });
  await cleanupObsoleteProviders();
  await migrateLegacyProviderProfiles();
  await migrateConfig();
  loadConfig();
  loadMetrics();
  if (window.EditCoreVoiceMode?.init) {
    window.EditCoreVoiceMode.init();
    window.EditCoreVoiceMode.setPromptDispatcher((text) => {
      $("prompt").value = text;
      triggerChatSend();
    });
  }
  refreshCacheStats().catch(() => undefined);
  loadPanelSizes();
  const storedProjects = loadJson(PROJECTS_STORAGE_KEY, []);
  const storedActiveProjectId = String(localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || "").trim();
  state.projects = repairPersistedText(storedProjects).map(ensureProjectAgent);
  state.activeProjectId = "";
  state.projectRoot = "";
  await refreshProjectCatalog().catch(() => undefined);
  const restoredProject = storedActiveProjectId
    ? state.projects.find((project) => project.id === storedActiveProjectId && project.projectRoot)
    : null;
  const durableTasks = window.editcoreTasks ? await window.editcoreTasks.list().catch(() => []) : [];
  const visibleDurableTasks = (durableTasks || []).filter((task) => [
    "READY", "WAITING", "AWAITING_AUTHORIZATION", "PLAN_READY", "APPROVED",
    "PAUSED", "RECOVERABLE", "RECOVERING",
  ].includes(task.status));
  for (const durableTask of visibleDurableTasks) {
    const recovered = ["READY", "RECOVERABLE", "AWAITING_AUTHORIZATION", "PLAN_READY"].includes(durableTask.status) && window.editcoreTasks
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
  if (JSON.stringify(state.projects) !== JSON.stringify(storedProjects)) saveProjects();
  await ensureDefaultModelSelectionMode();
  await refreshModelCapabilities(true);
  syncChatModelFromConfig();

  localStorage.removeItem("editcore-projects-collapsed");
  document.body.classList.remove("projects-collapsed");

  $("projectPathLabel").textContent = state.projectRoot || "Sin proyecto";

  const autoPick = new URLSearchParams(location.search).get("autoPick") === "1";
  if (autoPick) await pickProject();
  else if (restoredProject) await selectProject(restoredProject.id);
  renderProjects();
  renderFeed();
  renderProjectFiles();
  renderAttachments();
  renderConnectionStatus();
  const bootPermission = ["readonly", "step", "full"].includes(state.permissionMode) ? state.permissionMode : "step";
  window.editcoreAgent.setPermission(bootPermission).then((mode) => {
    applyPermissionMode(mode);
  }).catch(() => {
    applyPermissionMode(bootPermission);
  });
  document.body.dataset.editcoreReady = "1";
  window.__editcorePipeline = {
    update: updateAgentPipelineUi,
    getState: () => ({ ...agentPipelineState }),
  };
  performance.mark?.("editcore-interactive");
  updateSendButtonState();
  window.EditCoreVoiceMode?.init?.({
    button: $("voiceBtn"),
    onStatus: (message) => { $("status").textContent = message; },
    onSend: (text) => {
      $("prompt").value = text;
      triggerChatSend();
    },
    onSteer: (text) => {
      const activeAgent = [...activePromptRequests.values()].find((job) => job.isAgent && job.agentExecuting && job.runId);
      if (!activeAgent?.runId) return false;
      window.editcoreAgent.steer({ instruction: text, runId: activeAgent.runId }).catch(() => undefined);
      $("status").textContent = "Instruccion de voz enviada al agente activo";
      return true;
    },
    isBusy: () => activePromptRequests.size > 0 || promptQueue.some((item) => !item.cancelled),
  });
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
  $("runMode")?.addEventListener("change", updateSendButtonState);

  $("permissionsBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPermissionMenuOpen($("permissionMenu")?.classList.contains("hidden"));
  });

  $("permissionMenu")?.querySelectorAll("[data-permission]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const selected = btn.dataset.permission;
      try {
        const mode = await window.editcoreAgent.setPermission(selected);
        applyPermissionMode(mode);
      } catch (error) {
        $("status").textContent = error?.message || "No se pudo cambiar el permiso";
        return;
      }
      const project = activeProject();
      if (project) { project.permissionMode = state.permissionMode; project.updatedAt = Date.now(); saveProjects(); }
      const labels = { readonly: "Solo lectura", step: "Permisos", full: "Acceso completo" };
      $("status").textContent = `Permisos: ${labels[state.permissionMode] || state.permissionMode}`;
      setPermissionMenuOpen(false);
    });
  });

  $("chatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    triggerChatSend();
  });
  $("sendBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    triggerChatSend();
  });
  $("voiceBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.EditCoreVoiceMode?.toggle?.();
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
      await saveSecureJson("editcore-chat-config", {
        ...config,
        remember: true,
        modelSelectionMode: "auto",
      });
      state.modelSelectionAuto = true;
      state.lastAutoResolvedModel = "";
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

  $("prompt")?.addEventListener("paste", (e) => {
    const files = [];
    for (const item of [...(e.clipboardData?.items || [])]) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (!files.length) {
      for (const f of [...(e.clipboardData?.files || [])]) {
        files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files).catch((err) => { $("status").textContent = err?.message || String(err); });
    }
  });

  $("prompt")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      triggerChatSend();
    }
  });
  $("prompt")?.addEventListener("input", updateSendButtonState);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

wireComposerControls();

$("connectionsBtn").addEventListener("click", openConnections);
$("closeConnectionsBtn").addEventListener("click", closeConnections);
$("detectConnectionsBtn").addEventListener("click", detectConnections);
$("connectGatewayProjectBtn")?.addEventListener("click", () => {
  connectGatewayProject().catch((error) => { $("status").textContent = error?.message || String(error); });
});
$("providersBtn").addEventListener("click", openProviders);
$("addCustomProviderBtn")?.addEventListener("click", () => addCustomProvider());
$("closeProvidersBtn").addEventListener("click", (e) => { e.stopPropagation(); closeProviders(); });
$("brainBtn").addEventListener("click", openBrain);
$("closeBrainBtn").addEventListener("click", (e) => { e.preventDefault(); $("brainDialog").close(); });
$("brainSearchBtn").addEventListener("click", () => loadBrainCatalog().catch((error) => {
  $("brainStatus").textContent = error?.message || String(error);
}));
$("brainAuditBtn").addEventListener("click", runBrainAudit);
$("brainInstallRepoBtn").addEventListener("click", installBrainRepo);
$("brainSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadBrainCatalog().catch((error) => { $("brainStatus").textContent = error?.message || String(error); });
  }
});
$("brainRepoUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    installBrainRepo();
  }
});
$("inspectorBtn").addEventListener("click", openInspector);
$("closeInspectorBtn").addEventListener("click", () => $("inspectorDialog").close());
$("inspectorChatTab")?.addEventListener("click", () => inspectorSetTab("chat"));
$("inspectorReportsTab")?.addEventListener("click", () => inspectorSetTab("reports"));
$("inspectorSendBtn").addEventListener("click", () => sendInspectorPrompt());
$("inspectorHandoffBtn")?.addEventListener("click", () => prepareInspectorCorrection());
document.querySelectorAll("[data-inspector-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.inspectorTarget === "project" ? "project" : "editcore";
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

$("providersDialog").addEventListener("click", (e) => {
  const key = e.target.dataset?.provActivate;
  if (!key || !PROVIDERS[key]) return;
  e.preventDefault();
  e.stopPropagation();
  verifyProvider(key)
    .then((provider) => activateProvider(provider))
    .catch((error) => { $("status").textContent = `API no activada: ${error?.message || String(error)}`; });
});

document.querySelector(".conn-connect-btn[data-service='github']")
  ?.addEventListener("click", connectGitHub);
document.querySelector(".conn-connect-btn[data-service='vercel']")
  ?.addEventListener("click", connectVercel);
document.querySelector(".conn-connect-btn[data-service='selfsupabase']")
  ?.addEventListener("click", connectSelfSupabase);

$("newProjectBtn").addEventListener("click", openNewProjectDialog);
$("saveProjectBtn").addEventListener("click", saveCurrentProjectEntry);
$("saveProjectForm").addEventListener("submit", confirmCurrentProjectSave);
$("closeSaveProjectBtn").addEventListener("click", () => $("saveProjectDialog").close());
$("cancelSaveProjectBtn").addEventListener("click", () => $("saveProjectDialog").close());
$("newProjectForm").addEventListener("submit", createProjectFromDialog);
$("newProjectTemplate").addEventListener("change", renderProjectTemplateSummary);
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

window.editcoreAgent.onProgress((progress) => {
  try {
    if (progress?.phase === "pipeline" || progress?.pipeline) {
      applyPipelineProgress(progress);
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
      setInspectorProgress(Math.min(72, 30 + Number(progress.index || 0) * 4), `Reparando EDITCOREAI: ${progress.name || "accion"}...`, "running");
      return;
    }

    const liveRun = activeAgentThinkingRuns.get(progress?.runId);
    const thinkingEl = liveRun?.thinking || document.querySelector(".thinking-msg");
    if (!thinkingEl) return;

    if (progress.phase === "narration_delta") {
      addAgentNarrationDelta(thinkingEl, progress.text, progress.index);
      return;
    }
    if (progress.phase === "narration") {
      addAgentNarration(thinkingEl, progress.text, progress.index);
      const project = state.projects.find((item) => item.id === progress?.projectId)
        || state.projects.find((item) => item.id === liveRun?.projectId)
        || activeProject();
      const targetRun = project?.agentWorkflow?.runId === progress?.runId
        ? project.agentWorkflow
        : project?.agentRuns?.find((item) => item.runId === progress?.runId);
      if (targetRun) {
        targetRun.narration ||= [];
        targetRun.narration.push({ index: Number(progress.index) || 0, text: String(progress.text || ""), at: Date.now() });
        targetRun.updatedAt = Date.now();
        saveProjects();
      }
      return;
    }

    const isToolStep = progress.phase === "tool" || (!progress.phase && progress.name);
    const isVisiblePhase = ["startup", "model", "confirm", "repair", "human_intervention", "direction"].includes(progress?.phase);
    if (isToolStep || isVisiblePhase) addAgentStepToThinking(thinkingEl, progress);
    const narrative = agentProgressText(progress);
    if (narrative) {
      setThinkingStatus(thinkingEl, narrative);
      inferPipelineFromText(narrative);
    }
    if (progress.ok === false && (isToolStep || isVisiblePhase)) {
      $("status").textContent = `Agente encontro un error en ${progress.name || "una accion"}; ajustando la ejecucion`;
    }
    if (["heartbeat", "model", "startup", "confirm", "repair", "human_intervention"].includes(progress?.phase)) {
      if (narrative) $("status").textContent = narrative;
      return;
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
  } catch (error) {
    console.error("[Agent progress UI]", error);
    const thinkingEl = activeAgentThinkingRuns.get(progress?.runId)?.thinking || document.querySelector(".thinking-msg");
    if (thinkingEl) setThinkingStatus(thinkingEl, "Actualizando progreso del agente...");
  }
});
window.editcoreProject.onProgress(updateProjectCreateProgress);
$("clearChatBtn").addEventListener("click", clearActiveProject);

$("toggleProjectsBtn").addEventListener("click", openProjectsDialog);

$("pickProjectBtn").addEventListener("click", () =>
  pickProject().catch((err) => { $("projectPathLabel").textContent = err?.message || String(err); })
);

$("openPreviewBtn").addEventListener("click", refreshPreview);
$("previewBackBtn").addEventListener("click", () => {
  const webview = $("previewWebview");
  if (previewHistoryIndex > 0) navigatePreviewHistory(previewHistoryIndex - 1);
  else updatePreviewNavigationControls(webview);
});
$("webPreviewBtn").addEventListener("click", () => setPreviewMode("web"));
$("mobilePreviewBtn").addEventListener("click", () => setPreviewMode("mobile"));
$("previewUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") openPreview(); });
$("previewWebview").addEventListener("did-start-loading", () => {
  $("previewWebview").dataset.previewReady = "0";
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
  if (event.level >= 2 && previewExpectedUrl) $("status").textContent = `Navegador: ${String(event.message || "error").slice(0, 180)}`;
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
  const wantAuto = config.modelSelectionMode === "auto" || selected === AutoModel.AUTO_MODEL_SELECTION;

  const autoOption = document.createElement("option");
  autoOption.value = AutoModel.AUTO_MODEL_SELECTION;
  autoOption.textContent = "Auto";
  autoOption.dataset.auto = "1";
  autoOption.title = "EDITCOREAI elige el mejor modelo verificado para cada mensaje";
  select.appendChild(autoOption);

  const providerKeys = [...new Set(options.map((entry) => entry.modelProviderGroup || entry.providerKey))];
  providerKeys.forEach((providerKey) => {
    const providerOptions = options.filter((entry) => (entry.modelProviderGroup || entry.providerKey) === providerKey);
    if (!providerOptions.length) return;
    const group = document.createElement("optgroup");
    group.label = providerOptions[0]?.providerLabel || PROVIDERS[providerKey]?.label || providerKey;
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
    select.value = AutoModel.AUTO_MODEL_SELECTION;
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
    setChatModelOptions([], AutoModel.AUTO_MODEL_SELECTION, "", "");
    updateStatus();
    return;
  }
  setChatModelOptions([], project?.model || config.model || record?.model || "", key, project?.providerProfileId || config.providerProfileId || "");
}

$("publishBtn")?.addEventListener("click", () => publishChanges("project"));
$("inspectorPublishBtn")?.addEventListener("click", () => publishChanges("editcore"));

boot().catch((error) => {
  $("status").textContent = error?.message || "No se pudo iniciar la aplicacion";
});