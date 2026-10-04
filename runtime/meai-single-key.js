"use strict";

// ME AI usa una sola API key para todos sus modelos. Un proveedor en
// HIDDEN_PROVIDER_KEYS se oculta guardando su status en hiddenStatus; al sacarlo
// de la lista, sus perfiles vuelven con el status que tenían. APICredits sigue
// visible para el administrador; a los usuarios los filtra el rol en renderer.js.
const MEAI_KEY = "meai";
const MEAI_BASE_URL = "https://api.meai.cloud/v1";
const MEAI_DEFAULT_MODEL = "claude-sonnet-4.6";
const HIDDEN_PROVIDER_KEYS = [];
const ACTIVE_STATUSES = new Set(["active", "enabled"]);

const isSonnet46 = (model) => /^claude-sonnet-4[.-]6$/i.test(String(model || "").trim());
const keyOf = (value) => String(value || "").trim();

function pickMeaiKey(provider = {}, profiles = []) {
  if (provider.singleKey === true && keyOf(provider.apiKey)) return keyOf(provider.apiKey);
  const meai = profiles.filter((p) => p && p.providerKey === MEAI_KEY && keyOf(p.apiKey));
  const sonnet = meai.find((p) => isSonnet46(p.model) && ACTIVE_STATUSES.has(p.status))
    || meai.find((p) => isSonnet46(p.model));
  if (sonnet) return keyOf(sonnet.apiKey);
  if (keyOf(provider.apiKey)) return keyOf(provider.apiKey);
  const active = meai.find((p) => ACTIVE_STATUSES.has(p.status));
  return keyOf((active || meai[0])?.apiKey);
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
  const rawProfiles = Array.isArray(state["editcore-provider-profiles"]) ? state["editcore-provider-profiles"] : [];
  const before = JSON.stringify([providers[MEAI_KEY] || null, rawProfiles, state["editcore-chat-config"] || null]);

  const apiKey = pickMeaiKey(providers[MEAI_KEY] || {}, rawProfiles);
  let profiles = rawProfiles.map((p) => {
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
  unifyMeaiSecureState,
};
