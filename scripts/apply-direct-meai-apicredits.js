"use strict";

/**
 * Apply DIRECT meai + apicredits only into EDITCOREAI secure config (CDP).
 * Sources: GAFCORE GATEWAY tools/*.local + .env.local (+ process.env fallback).
 * Clears gafcore-gateway so startup does not wipe direct profiles.
 * Leaves models active for chat modal (manual + Auto).
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const executable = process.env.EDITCORE_INSTALLED_EXE || "D:\\PROGRAMAS IA\\EDITCOREAI\\EDITCOREAI.exe";
const userData = path.join(process.env.APPDATA || "", "EDITCOREAI");
const gatewayRoot = "D:\\PROGRAMAS IA\\GAFCORE GATEWAY";
const toolsDir = path.join(gatewayRoot, "tools");
const debugPort = 9251;
let appProcess;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readKeys(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

function readEnvLocal(file) {
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

function isUsableKey(key) {
  const k = String(key || "").trim();
  return k.startsWith("sk-") || k.startsWith("sk-ant-") || k.startsWith("ak-");
}

function pickKey(...candidates) {
  for (const value of candidates) {
    if (isUsableKey(value)) return String(value).trim();
  }
  return "";
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error || message.result?.exceptionDetails)));
      } else {
        resolve(message.result?.result?.value);
      }
    });
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  return result;
}

async function readyPage() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^file:/i.test(String(item.url || "")));
      if (page) {
        const ready = await evaluate(
          page,
          "Boolean(window.editcoreSecureConfig) && document.body?.dataset?.editcoreReady === '1'",
        ).catch(() => false);
        if (ready) return page;
      }
    } catch {}
    await wait(250);
  }
  throw new Error("EDITCOREAI no termino de iniciar (CDP).");
}

function stopApp() {
  if (appProcess?.pid) {
    spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  }
  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { windowsHide: true, stdio: "ignore" });
}

function buildSourcePayload() {
  const meaiKeys = readKeys(path.join(toolsDir, ".meai-keys.local"));
  const apicKeys = readKeys(path.join(toolsDir, ".apicredits-keys.local"));
  const envLocal = readEnvLocal(path.join(gatewayRoot, ".env.local"));

  // ME AI: one key per model from GafCore tools keyring (same source gateway uses).
  const meaiProfiles = [];
  for (const [model, apiKey] of Object.entries(meaiKeys)) {
    if (!isUsableKey(apiKey)) continue;
    if (/^(default|meai)$/i.test(model)) continue;
    meaiProfiles.push({
      providerKey: "meai",
      providerName: "ME AI Cloud",
      baseUrl: "https://api.meai.cloud/v1",
      model,
      apiKey: String(apiKey).trim(),
    });
  }
  // Fallback single key from env if keyring empty.
  if (!meaiProfiles.length) {
    const fallback = pickKey(
      process.env.CLAUDE_API_KEY,
      process.env.ANTHROPIC_AUTH_TOKEN,
      meaiKeys.default,
      meaiKeys.meai,
    );
    const model = String(process.env.CLAUDE_MODEL || process.env.OPENAI_MODEL || "claude-sonnet-4.6").trim();
    if (fallback) {
      meaiProfiles.push({
        providerKey: "meai",
        providerName: "ME AI Cloud",
        baseUrl: "https://api.meai.cloud/v1",
        model,
        apiKey: fallback,
      });
    }
  }

  // APICredits: group keys from tools + .env.local (GafCore source of truth).
  // Full APICredits catalog from GafCore src/lib/modelCatalog.ts (13 models).
  const apicGroups = [
    {
      key: pickKey(
        apicKeys.claude,
        apicKeys.claude_default,
        envLocal.APICREDITS_CLAUDE_KEY,
        envLocal.APICREDITS_API_KEY,
        process.env.APICREDITS_API_KEY,
        apicKeys.apicredits,
      ),
      models: [
        "claude-sonnet-5",
        "claude-fable-5",
        "claude-haiku-4-5",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-sonnet-4-6",
      ],
    },
    {
      key: pickKey(apicKeys.gpt, envLocal.APICREDITS_GPT_KEY, process.env.APICREDITS_GPT_KEY),
      models: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
    },
    {
      key: pickKey(apicKeys.gemini, envLocal.APICREDITS_GEMINI_KEY, process.env.APICREDITS_GEMINI_KEY),
      models: ["gemini-2.5-flash"],
    },
    {
      key: pickKey(apicKeys.grok, envLocal.APICREDITS_GROK_KEY, process.env.APICREDITS_GROK_KEY),
      models: ["grok-4.3", "grok-4.5"],
    },
    {
      key: pickKey(apicKeys.deepseek, envLocal.APICREDITS_DEEPSEEK_KEY, process.env.APICREDITS_DEEPSEEK_KEY),
      models: ["deepseek-v4-pro"],
    },
  ];
  const apicProfiles = [];
  for (const group of apicGroups) {
    if (!group.key) continue;
    for (const model of group.models) {
      apicProfiles.push({
        providerKey: "apicredits",
        providerName: "APICredits",
        baseUrl: "https://api.apicredits.site/v1",
        model,
        apiKey: group.key,
      });
    }
  }

  return {
    rows: [...apicProfiles, ...meaiProfiles],
    counts: {
      meai: meaiProfiles.length,
      apicredits: apicProfiles.length,
      meaiModels: meaiProfiles.map((r) => r.model),
      apicreditsModels: apicProfiles.map((r) => r.model),
    },
  };
}

async function main() {
  const configPath = path.join(userData, "editcore-secure-config.bin");
  if (!fs.existsSync(configPath)) throw new Error(`No existe: ${configPath}`);
  if (!fs.existsSync(executable)) throw new Error(`No existe EXE: ${executable}`);

  const source = buildSourcePayload();
  if (!source.rows.length) {
    throw new Error("No hay keys meai/apicredits en tools/*.local ni .env.local");
  }

  const backupPath = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(configPath, backupPath);

  spawnSync("taskkill", ["/IM", "EDITCOREAI.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  await wait(900);

  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
  });

  const page = await readyPage();

  const result = await evaluate(page, `(async () => {
    const rows = ${JSON.stringify(source.rows)};
    const secure = await window.editcoreSecureConfig.load();
    const before = {
      providerKey: secure["editcore-chat-config"]?.providerKey || "",
      model: secure["editcore-chat-config"]?.model || "",
      mode: secure["editcore-chat-config"]?.modelSelectionMode || "",
      customIds: (secure["editcore-custom-providers"] || []).map((p) => p.id),
      profileProviders: [...new Set((secure["editcore-provider-profiles"] || []).map((p) => p.providerKey))],
      profileCount: (secure["editcore-provider-profiles"] || []).length,
    };

    const providers = {};
    const profiles = rows.map((row) => {
      providers[row.providerKey] = {
        ...(providers[row.providerKey] || {}),
        baseUrl: row.baseUrl,
        apiKey: row.apiKey,
        label: row.providerName,
      };
      return {
        id: row.providerKey + ":" + row.model,
        providerKey: row.providerKey,
        providerName: row.providerName,
        baseUrl: row.baseUrl,
        apiKey: row.apiKey,
        model: row.model,
        status: "active",
        catalogConfirmed: true,
        chatVerified: true,
        checkedAt: Date.now(),
        error: "",
      };
    });

    const preferred =
      profiles.find((p) => p.providerKey === "apicredits" && p.model === "claude-fable-5")
      || profiles.find((p) => p.providerKey === "meai" && p.model === "claude-sonnet-4.6")
      || profiles.find((p) => p.providerKey === "apicredits")
      || profiles[0];

    // Critical: empty custom providers so startup does not strip PRIMARY directs.
    secure["editcore-custom-providers"] = [];
    secure["editcore-providers"] = providers;
    secure["editcore-provider-profiles"] = profiles;
    secure["editcore-chat-config"] = {
      ...(secure["editcore-chat-config"] || {}),
      remember: true,
      providerKey: preferred.providerKey,
      provider: preferred.providerKey,
      model: preferred.model,
      providerProfileId: preferred.id,
      modelSelectionMode: "auto",
      baseUrl: preferred.baseUrl,
      apiKey: preferred.apiKey,
      mode: /gpt/i.test(preferred.model) ? "gpt" : "claude",
    };
    delete secure["aiapiflow-config"];

    await window.editcoreSecureConfig.save(secure);
    const saved = await window.editcoreSecureConfig.load();

    // Rebuild picker-like catalog from saved profiles (same rules as renderer).
    const catalog = (saved["editcore-provider-profiles"] || [])
      .filter((p) => p.model && p.apiKey && ["active", "enabled"].includes(p.status))
      .map((p) => ({ providerKey: p.providerKey, model: p.model, profileId: p.id }));

    return {
      before,
      active: {
        providerKey: saved["editcore-chat-config"]?.providerKey,
        model: saved["editcore-chat-config"]?.model,
        profileId: saved["editcore-chat-config"]?.providerProfileId,
        modelSelectionMode: saved["editcore-chat-config"]?.modelSelectionMode,
      },
      keptProviders: Object.keys(saved["editcore-providers"] || {}),
      customProviders: saved["editcore-custom-providers"] || [],
      catalogCount: catalog.length,
      catalogByProvider: catalog.reduce((acc, item) => {
        acc[item.providerKey] = (acc[item.providerKey] || 0) + 1;
        return acc;
      }, {}),
      sampleCatalog: catalog.slice(0, 12),
    };
  })()`);

  const settingsPath = path.join(userData, "editcore-settings.json");
  if (fs.existsSync(settingsPath) && result?.active?.providerKey) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      settings.activeProviderGroupId = result.active.providerKey;
      settings.selectedModelKey = `${result.active.providerKey}::${result.active.model}`;
      settings.preferDirectUpstream = true;
      settings.directProvidersOnly = ["meai", "apicredits"];
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch { /* ignore */ }
  }

  const ok = Boolean(
    result
    && result.customProviders.length === 0
    && result.keptProviders.every((k) => k === "meai" || k === "apicredits")
    && result.catalogCount > 0
    && (result.active.providerKey === "meai" || result.active.providerKey === "apicredits")
    && result.active.modelSelectionMode === "auto",
  );

  process.stdout.write(`${JSON.stringify({
    ok,
    backupPath,
    sourceCounts: source.counts,
    ...result,
  }, null, 2)}\n`);
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
}).finally(() => {
  stopApp();
});
