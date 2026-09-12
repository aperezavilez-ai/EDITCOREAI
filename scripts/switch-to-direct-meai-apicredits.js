"use strict";

/**
 * Switch EDITCOREAI to DIRECT meai + apicredits only (no GafCore gateway as active).
 */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const USER_DATA = path.join(process.env.APPDATA || "", "EDITCOREAI");
const SECURE = path.join(USER_DATA, "editcore-secure-config.bin");
const SETTINGS = path.join(USER_DATA, "editcore-settings.json");
const TOOLS = "D:\\PROGRAMAS IA\\GAFCORE GATEWAY\\tools";

// Must match the installed app vault or safeStorage cannot decrypt.
try { app.setName("EDITCOREAI"); } catch { /* ignore */ }
try { app.setPath("userData", USER_DATA); } catch { /* ignore */ }

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

function isUsableKey(key) {
  const k = String(key || "").trim();
  return k.startsWith("sk-") || k.startsWith("sk-ant-");
}

function upsert(profiles, providers, row) {
  if (!isUsableKey(row.apiKey)) return false;
  providers[row.providerKey] = {
    ...(providers[row.providerKey] || {}),
    baseUrl: row.baseUrl,
    apiKey: String(row.apiKey).trim(),
    label: row.providerName,
  };
  const id = `${row.providerKey}:${row.model}`;
  const next = {
    id,
    providerKey: row.providerKey,
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    apiKey: String(row.apiKey).trim(),
    model: row.model,
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
    const before = { ...(secure["editcore-chat-config"] || {}) };

    const providersIn = secure["editcore-providers"] && typeof secure["editcore-providers"] === "object"
      ? { ...secure["editcore-providers"] }
      : {};
    const profilesIn = Array.isArray(secure["editcore-provider-profiles"])
      ? [...secure["editcore-provider-profiles"]]
      : [];

    const meaiKeys = readKeys(path.join(TOOLS, ".meai-keys.local"));
    const apicreditsKeys = readKeys(path.join(TOOLS, ".apicredits-keys.local"));

    const meaiKey = String(
      providersIn.meai?.apiKey
      || meaiKeys.default
      || meaiKeys.meai
      || meaiKeys["claude-sonnet-4.6"]
      || ""
    ).trim();
    const apicreditsKey = String(
      providersIn.apicredits?.apiKey
      || apicreditsKeys.claude
      || apicreditsKeys.claude_default
      || apicreditsKeys.apicredits
      || ""
    ).trim();

    // Keep ONLY meai + apicredits in providers map.
    const providers = {};
    if (providersIn.meai) providers.meai = { ...providersIn.meai };
    if (providersIn.apicredits) providers.apicredits = { ...providersIn.apicredits };

    // Keep ONLY meai + apicredits profiles.
    let profiles = profilesIn.filter((p) => {
      const k = String(p?.providerKey || "").toLowerCase();
      return k === "meai" || k === "apicredits";
    });

    let added = 0;
    if (apicreditsKey) {
      for (const model of ["claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"]) {
        if (upsert(profiles, providers, {
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
        if (upsert(profiles, providers, {
          providerKey: "meai",
          providerName: "ME AI Cloud",
          baseUrl: "https://api.meai.cloud/v1",
          model,
          apiKey: meaiKey,
        })) added += 1;
      }
    }

    profiles = profiles.filter((p) => {
      const k = String(p?.providerKey || "").toLowerCase();
      return (k === "meai" || k === "apicredits") && isUsableKey(p.apiKey) && p.model;
    });

    if (!profiles.length) {
      console.log(JSON.stringify({
        ok: false,
        error: "No hay keys usables para meai/apicredits (ni en secure ni en tools/*.local).",
        hadMeai: Boolean(meaiKey),
        hadApicredits: Boolean(apicreditsKey),
        meaiKeyPrefix: meaiKey.slice(0, 6),
        apicreditsKeyPrefix: apicreditsKey.slice(0, 6),
        existingProviderKeys: Object.keys(providersIn),
      }, null, 2));
      app.exit(2);
      return;
    }

    const preferred =
      profiles.find((p) => p.providerKey === "apicredits" && /fable-5/i.test(p.model))
      || profiles.find((p) => p.providerKey === "meai" && /sonnet-4\.6/i.test(p.model))
      || profiles.find((p) => p.providerKey === "apicredits")
      || profiles[0];

    // Delete gateway completely from custom providers.
    const custom = Array.isArray(secure["editcore-custom-providers"])
      ? secure["editcore-custom-providers"].filter((p) => {
        const id = String(p?.id || "").toLowerCase();
        const url = String(p?.baseUrl || "").toLowerCase();
        return id !== "gafcore-gateway" && !id.includes("gafcore-gateway") && !url.includes("gafcore-gateway");
      })
      : [];

    // Also strip any leftover gateway profiles (defensive).
    profiles = profiles.filter((p) => {
      const k = String(p?.providerKey || "").toLowerCase();
      const url = String(p?.baseUrl || "").toLowerCase();
      return k !== "custom:gafcore-gateway" && !k.includes("gafcore-gateway") && !url.includes("gafcore-gateway");
    });

    secure["editcore-providers"] = providers;
    secure["editcore-provider-profiles"] = profiles;
    secure["editcore-custom-providers"] = custom;
    secure["editcore-chat-config"] = {
      ...(secure["editcore-chat-config"] || {}),
      remember: true,
      mode: /claude/i.test(preferred.model) ? "claude" : "gpt",
      providerKey: preferred.providerKey,
      provider: preferred.providerKey,
      model: preferred.model,
      providerProfileId: preferred.id,
      modelSelectionMode: "manual",
      baseUrl: preferred.baseUrl,
      apiKey: preferred.apiKey,
    };
    // AIAPIFLOW eliminado: no conservar espejo legacy.
    delete secure["aiapiflow-config"];

    writeSecure(secure);

    if (fs.existsSync(SETTINGS)) {
      try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
        settings.activeProviderGroupId = preferred.providerKey;
        settings.selectedModelKey = `${preferred.providerKey}::${preferred.model}`;
        settings.preferDirectUpstream = true;
        settings.directProvidersOnly = ["meai", "apicredits"];
        fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify({
      ok: true,
      active: {
        providerKey: preferred.providerKey,
        model: preferred.model,
        profileId: preferred.id,
        baseUrl: preferred.baseUrl,
        hasKey: Boolean(preferred.apiKey),
      },
      before: {
        providerKey: before.providerKey,
        model: before.model,
        providerProfileId: before.providerProfileId,
        baseUrl: before.baseUrl,
      },
      keptProfiles: profiles.map((p) => `${p.providerKey}:${p.model}`),
      keptProviders: Object.keys(providers),
      gatewayRemoved: !custom.some((p) => String(p.id || "").includes("gafcore")),
      added,
    }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    app.exit(1);
  }
});
