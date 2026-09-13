"use strict";

/**
 * Activa GafCore Gateway en la bóveda de EditCoreAI (safeStorage):
 * - ADMIN_TOKEN desde GAFCORE GATEWAY/.env.local o GAFCORE_ADMIN_TOKEN
 * - Vincula proyecto "EditCore AI" + perfiles activos
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";

const USER_DATA = process.env.EDITCORE_USER_DATA_PATH
  || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
process.env.EDITCORE_USER_DATA_PATH = USER_DATA;

const { app, safeStorage } = require("electron");
app.setPath("userData", USER_DATA);

const GAFCORE_ORIGIN = "https://gafcore-gateway.vercel.app";
const GAFCORE_API_BASE = `${GAFCORE_ORIGIN}/api/openai/v1`;
const PROJECT_ROOT = path.resolve(__dirname, "..");

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function readEnvValues(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveAdminToken() {
  const fromEnv = String(process.env.GAFCORE_ADMIN_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    path.join("D:", "PROGRAMAS IA", "GAFCORE GATEWAY", ".env.local"),
    path.join(path.dirname(PROJECT_ROOT), "GAFCORE GATEWAY", ".env.local"),
    path.join(PROJECT_ROOT, ".env.local"),
  ];
  for (const envPath of candidates) {
    const values = readEnvValues(envPath);
    const token = String(values.ADMIN_TOKEN || values.GAFCORE_ADMIN_TOKEN || "").trim();
    if (token) return token;
  }
  throw new Error("No se encontro ADMIN_TOKEN de GafCore Gateway.");
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
    throw new Error(payload?.error?.message || `GafCore HTTP ${response.status} en ${pathname}`);
  }
  return payload?.data ?? payload;
}

function encryptWrite(filePath, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage no disponible.");
  const payload = safeStorage.encryptString(JSON.stringify(value && typeof value === "object" ? value : {}));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, payload, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function decryptRead(filePath) {
  if (!fs.existsSync(filePath)) return {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage no disponible.");
  const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function expandModels(models = []) {
  const list = [...new Set((models || []).map((m) => String(m || "").trim()).filter(Boolean))];
  return list;
}

app.whenReady().then(async () => {
  const report = { ok: false, userData: USER_DATA };
  try {
    const adminToken = resolveAdminToken();
    report.adminTokenLen = adminToken.length;

    const projects = await gatewayJson("/api/admin/projects", { token: adminToken });
    const rows = Array.isArray(projects) ? projects : [];
    const remote = rows.find((p) => String(p?.name || "").trim().toLowerCase() === "editcore ai")
      || rows.find((p) => /editcore/i.test(String(p?.name || "")));
    if (!remote?.project_key) throw new Error('No existe el proyecto "EditCore AI" en GafCore Gateway.');

    const modelPayload = await gatewayJson("/api/openai/v1/models", { projectKey: remote.project_key });
    const rawModels = Array.isArray(modelPayload)
      ? modelPayload
      : Array.isArray(modelPayload?.data)
        ? modelPayload.data
        : [];
    const models = expandModels(rawModels.map((item) => item?.id || item?.name || item));
    if (!models.length) throw new Error("GafCore Gateway no devolvio modelos para EditCore AI.");

    const gatewayBin = path.join(USER_DATA, "editcore-gafcore-projects.bin");
    const secureBin = path.join(USER_DATA, "editcore-secure-config.bin");
    if (!fs.existsSync(secureBin)) throw new Error(`No existe ${secureBin}`);

    const projectRoot = PROJECT_ROOT.replace(/[\\/]+$/, "").toLowerCase();
    const localProjectId = `root:${digest(projectRoot)}`;
    const link = {
      localProjectId,
      projectRoot,
      projectId: remote.id,
      projectName: remote.name,
      projectKey: remote.project_key,
      balanceUsd: Number(remote.balance?.current_balance_usd ?? 0),
      models,
      modelCount: models.length,
      connectedAt: Date.now(),
    };

    const privateState = decryptRead(gatewayBin);
    privateState.adminToken = adminToken;
    privateState.links = privateState.links && typeof privateState.links === "object" ? privateState.links : {};
    privateState.links[`id:${localProjectId}`] = link;
    privateState.links[`root:${digest(projectRoot)}`] = link;
    encryptWrite(gatewayBin, privateState);

    const secure = decryptRead(secureBin);
    const currentProviders = Array.isArray(secure["editcore-custom-providers"]) ? secure["editcore-custom-providers"] : [];
    secure["editcore-custom-providers"] = [
      ...currentProviders.filter((p) => p?.id !== "gafcore-gateway"),
      {
        id: "gafcore-gateway",
        name: "GafCore Gateway",
        baseUrl: GAFCORE_API_BASE,
        apiKey: link.projectKey,
        models,
        enabledModels: models,
        modelCount: models.length,
        status: "active",
        checkedAt: Date.now(),
      },
    ];
    const currentProfiles = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
    secure["editcore-provider-profiles"] = [
      ...currentProfiles.filter((p) => p?.providerKey !== "custom:gafcore-gateway"),
      ...models.map((model) => ({
        id: `gafcore-gateway:${model}`,
        providerKey: "custom:gafcore-gateway",
        providerName: "GafCore Gateway",
        baseUrl: GAFCORE_API_BASE,
        apiKey: link.projectKey,
        model,
        modelCount: models.length,
        status: "active",
        catalogConfirmed: true,
        chatVerified: true,
        checkedAt: Date.now(),
        error: "",
      })),
    ];
    const selectedModel = models.includes(secure["editcore-chat-config"]?.model)
      ? secure["editcore-chat-config"].model
      : models[0];
    secure["editcore-chat-config"] = {
      ...(secure["editcore-chat-config"] || {}),
      remember: true,
      mode: /claude/i.test(selectedModel) ? "claude" : "gpt",
      baseUrl: GAFCORE_API_BASE,
      apiKey: link.projectKey,
      model: selectedModel,
      providerKey: "custom:gafcore-gateway",
      providerProfileId: `gafcore-gateway:${selectedModel}`,
    };
    const connections = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
      ? secure["editcore-connections"]
      : {};
    connections.gafcore = {
      ...(connections.gafcore || {}),
      configured: true,
      status: "active",
      origin: GAFCORE_ORIGIN,
      projectName: link.projectName,
      projectId: link.projectId,
      updatedAt: Date.now(),
    };
    secure["editcore-connections"] = connections;
    encryptWrite(secureBin, secure);

    // Verificacion de models endpoint con project key
    const probe = await fetch(`${GAFCORE_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${link.projectKey}`, "x-project-key": link.projectKey },
      signal: AbortSignal.timeout(60_000),
    });
    const probeBody = await probe.json().catch(() => ({}));
    if (!probe.ok) throw new Error(`Project key invalida al probar /models (${probe.status}).`);

    Object.assign(report, {
      ok: true,
      projectName: link.projectName,
      projectId: link.projectId,
      modelCount: models.length,
      selectedModel,
      providerKey: "custom:gafcore-gateway",
      vaultAdminToken: true,
      linked: true,
      probeModels: Array.isArray(probeBody?.data) ? probeBody.data.length : 0,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    app.exit(0);
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 1000);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    app.exit(1);
  }
});
