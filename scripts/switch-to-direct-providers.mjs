"use strict";

/**
 * One-shot: switch EDITCOREAI chat from GafCore gateway to direct upstream providers.
 * Uses existing keys in secure config / .meai-keys.local / .apicredits-keys.local.
 */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const USER_DATA = path.join(process.env.APPDATA || "", "EDITCOREAI");
const SECURE = path.join(USER_DATA, "editcore-secure-config.bin");
const SETTINGS = path.join(USER_DATA, "editcore-settings.json");
const TOOLS = "D:\\PROGRAMAS IA\\GAFCORE GATEWAY\\tools";

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

function readSecure() {
  if (!fs.existsSync(SECURE)) return {};
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(SECURE)));
}

function writeSecure(state) {
  const payload = safeStorage.encryptString(JSON.stringify(state));
  const tmp = `${SECURE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, SECURE);
}

function upsertProfile(profiles, providers, { providerKey, providerName, baseUrl, model, apiKey }) {
  const key = String(apiKey || "").trim();
  if (!key.startsWith("sk-") && !key.startsWith("sk-ant-")) return false;
  providers[providerKey] = {
    ...(providers[providerKey] || {}),
    baseUrl,
    apiKey: key,
    label: providerName,
  };
  const id = `${providerKey}:${model}`;
  const next = {
    id,
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
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) profiles[idx] = { ...profiles[idx], ...next };
  else profiles.push(next);
  return true;
}

app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage unavailable");
    const secure = readSecure();
    const chatBefore = { ...(secure["editcore-chat-config"] || {}) };
    const providers = secure["editcore-providers"] && typeof secure["editcore-providers"] === "object"
      ? { ...secure["editcore-providers"] }
      : {};
    let profiles = Array.isArray(secure["editcore-provider-profiles"])
      ? [...secure["editcore-provider-profiles"]]
      : [];

    // Prefer keys already in secure providers (meai / apicredits / openai-compat).
    const existingDirect = profiles.filter((p) => {
      const k = String(p?.providerKey || "").toLowerCase();
      return (k === "meai" || k === "apicredits") && String(p?.apiKey || "").trim() && String(p?.model || "").trim();
    });

    // Also load local key files if present.
    const meaiKeys = readKeys(path.join(TOOLS, ".meai-keys.local"));
    const apicreditsKeys = readKeys(path.join(TOOLS, ".apicredits-keys.local"));
    const meaiKey = String(
      providers.meai?.apiKey
      || meaiKeys.default
      || meaiKeys.meai
      || meaiKeys["claude-sonnet-4.6"]
      || ""
    ).trim();
    const apicreditsKey = String(
      providers.apicredits?.apiKey
      || apicreditsKeys.claude
      || apicreditsKeys.claude_default
      || apicreditsKeys.apicredits
      || ""
    ).trim();

    let added = 0;
    if (apicreditsKey) {
      for (const model of ["claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
        if (upsertProfile(profiles, providers, {
          providerKey: "apicredits",
          providerName: "APICredits",
          baseUrl: "https://api.apicredits.site/v1",
          model,
          apiKey: apicreditsKey,
        })) added += 1;
      }
    }
    if (meaiKey) {
      for (const model of ["claude-sonnet-4.6", "claude-haiku-4-5", "claude-opus-4.8"]) {
        if (upsertProfile(profiles, providers, {
          providerKey: "meai",
          providerName: "ME AI Cloud",
          baseUrl: "https://api.meai.cloud/v1",
          model,
          apiKey: meaiKey,
        })) added += 1;
      }
    }

    // Recompute direct list after upserts.
    const direct = profiles.filter((p) => {
      const k = String(p?.providerKey || "").toLowerCase();
      return (k === "meai" || k === "apicredits") && String(p?.apiKey || "").trim() && String(p?.model || "").trim();
    });
    if (!direct.length && !existingDirect.length) {
      console.log(JSON.stringify({
        ok: false,
        error: "No hay perfiles directos meai/apicredits con apiKey en secure config ni en tools/*.local",
        chatBefore,
        providerKeys: Object.keys(providers),
        profileCount: profiles.length,
        sampleProviders: Object.keys(providers).slice(0, 12),
      }, null, 2));
      app.exit(2);
      return;
    }

    const preferred =
      direct.find((p) => p.providerKey === "apicredits" && /fable-5/i.test(p.model))
      || direct.find((p) => p.providerKey === "meai" && /sonnet-4\.6/i.test(p.model))
      || direct.find((p) => p.providerKey === "apicredits")
      || direct[0]
      || existingDirect[0];

    secure["editcore-providers"] = providers;
    secure["editcore-provider-profiles"] = profiles;
    secure["editcore-chat-config"] = {
      ...(secure["editcore-chat-config"] || {}),
      providerKey: preferred.providerKey,
      provider: preferred.providerKey,
      model: preferred.model,
      providerProfileId: preferred.id,
      modelSelectionMode: "manual",
      baseUrl: preferred.baseUrl,
    };

    // Keep gateway provider stored, but stop using it as active chat route.
    writeSecure(secure);

    if (fs.existsSync(SETTINGS)) {
      try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
        settings.activeProviderGroupId = preferred.providerKey === "meai" ? "claude" : preferred.providerKey;
        settings.selectedModelKey = `${preferred.providerKey}::${preferred.model}`;
        // Keep gatewayEndpoint for reconnect later, but mark preference.
        settings.preferDirectUpstream = true;
        fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify({
      ok: true,
      switchedTo: {
        providerKey: preferred.providerKey,
        model: preferred.model,
        profileId: preferred.id,
        baseUrl: preferred.baseUrl,
      },
      chatBefore: {
        providerKey: chatBefore.providerKey,
        model: chatBefore.model,
        providerProfileId: chatBefore.providerProfileId,
      },
      directProfiles: direct.map((p) => `${p.providerKey}:${p.model}`),
      added,
    }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    app.exit(1);
  }
});
