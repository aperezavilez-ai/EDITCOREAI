"use strict";

// ME AI usa una sola API key para todos sus modelos.
const MEAI_KEY = "meai";
const MEAI_BASE_URL = "https://api.meai.cloud/v1";
const MEAI_DEFAULT_MODEL = "claude-sonnet-4.6";
const HIDDEN_PROVIDER_KEYS = [];
const ACTIVE_STATUSES = new Set(["active", "enabled"]);

const isSonnet46 = (model) => /^claude-sonnet-4[.-]6$/i.test(String(model || "").trim());
const keyOf = (value) => String(value || "").trim();

function resolveMeaiEnvKey() {
  if (process.env.EDITCOREAI_MEAI_API_KEY && keyOf(process.env.EDITCOREAI_MEAI_API_KEY)) {
    return keyOf(process.env.EDITCOREAI_MEAI_API_KEY);
  }
  if (process.env.MEAI_API_KEY && keyOf(process.env.MEAI_API_KEY)) {
    return keyOf(process.env.MEAI_API_KEY);
  }
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const candidates = [
      path.join(process.cwd(), ".env.local"),
      path.join(process.cwd(), ".env"),
      path.join(__dirname, "..", ".env.local"),
      path.join(__dirname, "..", ".env"),
    ];
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        const text = fs.readFileSync(f, "utf8");
        const match = text.match(/^\s*(?:export\s+)?(?:EDITCOREAI_MEAI_API_KEY|MEAI_API_KEY)\s*=\s*([^\r\n]+)/m);
        if (match) {
          let val = keyOf(match[1]);
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1).trim();
          if (val && val.startsWith("sk-")) return val;
        }
      }
    }
  } catch {}
  return "";
}

function pickMeaiKey(provider = {}, profiles = []) {
  if (provider.singleKey === true && keyOf(provider.apiKey)) return keyOf(provider.apiKey);
  const meai = profiles.filter((p) => p && p.providerKey === MEAI_KEY && keyOf(p.apiKey));
  const sonnet = meai.find((p) => isSonnet46(p.model) && ACTIVE_STATUSES.has(p.status))
    || meai.find((p) => isSonnet46(p.model));
  if (sonnet) return keyOf(sonnet.apiKey);
  if (keyOf(provider.apiKey)) return keyOf(provider.apiKey);
  const active = meai.find((p) => ACTIVE_STATUSES.has(p.status));
  if (active || meai[0]) return keyOf((active || meai[0]).apiKey);
  const envKey = resolveMeaiEnvKey();
  if (envKey) return envKey;
  return "";
}

function dedupeMeaiProfiles(profiles) {
  const byModel = new Map();
  const out = [];
  for (const p of profiles) {
    if (!p || p.providerKey !== MEAI_KEY) { out.push(p); continue; }
    const model = String(p.model || "").trim().toLowerCase();
    const prev = byModel.get(model);
    if (prev === undefined) { byModel.set(model, out.length); out.push(p); continue; }
    if (!ACTIVE_STATUSES.has(out[prev].status) && ACTIVE_STATUSES.has(p.status)) out[prev] = p;
  }
  return out;
}

function unifyMeaiSecureState(input) {
  const state = input && typeof input === "object" ? { ...input } : {};
  const providers = state["editcore-providers"] && typeof state["editcore-providers"] === "object"
    ? { ...state["editcore-providers"] }
    : {};
  // La unificación es solo de la clave ME AI: este módulo no crea ni
  // promueve ningún otro gateway (ME AI es el único proveedor directo).
  const rawProfiles = Array.isArray(state["editcore-provider-profiles"]) ? state["editcore-provider-profiles"] : [];
  const before = JSON.stringify([providers[MEAI_KEY] || null, rawProfiles, state["editcore-chat-config"] || null]);

  const apiKey = pickMeaiKey(providers[MEAI_KEY] || {}, rawProfiles);
  let profiles = rawProfiles
    .filter((p) => p)
    .map((p) => {
    if (!p || typeof p !== "object") return p;
    if (p.providerKey === MEAI_KEY && apiKey && p.apiKey !== apiKey) return { ...p, apiKey };
    if (HIDDEN_PROVIDER_KEYS.includes(p.providerKey)) {
      return p.status === "hidden" ? p : { ...p, hiddenStatus: p.status || "", status: "hidden" };
    }
    if (p.status === "hidden" && Object.prototype.hasOwnProperty.call(p, "hiddenStatus")) {
      const { hiddenStatus, ...rest } = p;
      return { ...rest, status: hiddenStatus || "" };
    }
    return p;
  });
  profiles = dedupeMeaiProfiles(profiles);

  if (apiKey) {
    providers[MEAI_KEY] = {
      ...(providers[MEAI_KEY] || {}),
      baseUrl: keyOf(providers[MEAI_KEY]?.baseUrl) || MEAI_BASE_URL,
      apiKey,
      singleKey: true,
    };
  }

  const chat = state["editcore-chat-config"];
  if (chat && typeof chat === "object") {
    const next = { ...chat };
    if (HIDDEN_PROVIDER_KEYS.includes(next.providerKey)) {
      Object.assign(next, {
        providerKey: MEAI_KEY,
        providerProfileId: `${MEAI_KEY}:${MEAI_DEFAULT_MODEL}`,
        baseUrl: providers[MEAI_KEY]?.baseUrl || MEAI_BASE_URL,
        model: MEAI_DEFAULT_MODEL,
        modelSelectionMode: "auto",
        autoProviderScope: MEAI_KEY,
      });
    }
    if (next.providerKey === MEAI_KEY && apiKey) next.apiKey = apiKey;
    state["editcore-chat-config"] = next;
  }

  state["editcore-providers"] = providers;
  state["editcore-provider-profiles"] = profiles;
  const changed = before !== JSON.stringify([providers[MEAI_KEY] || null, profiles, state["editcore-chat-config"] || null]);
  return { state, changed, apiKey };
}

module.exports = {
  MEAI_KEY,
  MEAI_BASE_URL,
  HIDDEN_PROVIDER_KEYS,
  pickMeaiKey,
  resolveMeaiEnvKey,
  unifyMeaiSecureState,
};
