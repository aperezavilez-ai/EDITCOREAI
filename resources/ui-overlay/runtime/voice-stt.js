"use strict";

/**
 * Speech-to-text backends for EditCore voice mode.
 * Claude/Anthropic chat models do NOT transcribe audio — only Whisper-compatible
 * OpenAI endpoints, Gemini multimodal, or a local sidecar can.
 */

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input?.base64) {
    try { return Buffer.from(String(input.base64), "base64"); } catch { return Buffer.alloc(0); }
  }
  if (input?.audioBuffer) return Buffer.from(input.audioBuffer);
  if (input?.buffer) return Buffer.from(input.buffer);
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (Array.isArray(input?.bytes)) return Buffer.from(input.bytes);
  if (Array.isArray(input)) return Buffer.from(input);
  try { return Buffer.from(input || []); } catch { return Buffer.alloc(0); }
}

function providerKind(providerKey = "", baseUrl = "") {
  const key = String(providerKey || "").toLowerCase();
  const host = String(baseUrl || "").toLowerCase();
  if (key.includes("anthropic") || key.includes("claude") || host.includes("anthropic")) return "anthropic";
  if (key.includes("gemini") || key.includes("google")) return "gemini";
  return "openai";
}

function hostOf(baseUrl = "") {
  try { return new URL(String(baseUrl)).hostname.toLowerCase(); } catch { return ""; }
}

function isPreferredUserHost(baseUrl = "") {
  const host = hostOf(baseUrl);
  return host.includes("meai.cloud") || host.includes("apicredits.site");
}

function isBlockedHost(baseUrl = "") {
  const host = hostOf(baseUrl);
  // AiPrimeTech: el usuario no lo usa. GafCore Gateway: no soporta /audio/transcriptions.
  return (
    host.includes("aiprimetech")
    || host.includes("openai.com")
    || host.includes("gafcore-gateway")
  );
}

function normalizeOpenAiBase(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (!u.pathname || u.pathname === "/") return `${raw}/v1`;
    // gafcore chat path no sirve para Whisper; no lo normalizamos como candidato
    return raw;
  } catch {
    return raw;
  }
}

function transcriptionUrl(baseUrl) {
  const base = normalizeOpenAiBase(baseUrl);
  if (!base) return "";
  if (base.endsWith("/audio/transcriptions")) return base;
  return `${base}/audio/transcriptions`;
}

/**
 * meai (new-api) suele exponer /v1/audio/transcriptions con la misma key
 * aunque el chat vaya por GafCore. GafCore rechaza Whisper explícitamente.
 */
function isWhisperCandidate(profile) {
  if (!profile?.apiKey || !profile?.baseUrl) return false;
  if (isBlockedHost(profile.baseUrl)) return false;
  const host = hostOf(profile.baseUrl);
  if (host.includes("meai.cloud") || host.includes("apicredits.site")) return true;
  const kind = providerKind(profile.providerKey, profile.baseUrl);
  if (kind === "anthropic" || kind === "gemini") return false;
  const key = String(profile.providerKey || "").toLowerCase();
  if (/(claude|anthropic|gafcore)/.test(key)) return false;
  return true;
}

function collectApiKeys(secure = {}) {
  const keys = [];
  const seen = new Set();
  const add = (key, hint = "") => {
    const value = String(key || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    keys.push({ apiKey: value, hint: String(hint || "") });
  };

  const profiles = Array.isArray(secure?.["editcore-provider-profiles"])
    ? secure["editcore-provider-profiles"]
    : [];
  const providers = secure?.["editcore-providers"] && typeof secure["editcore-providers"] === "object"
    ? secure["editcore-providers"]
    : {};

  for (const profile of profiles) {
    add(profile?.apiKey, `${profile?.providerKey || ""} ${profile?.model || ""}`);
  }
  for (const [providerKey, provider] of Object.entries(providers)) {
    add(provider?.apiKey, providerKey);
  }
  add(providers?.meai?.apiKey, "meai");
  add(providers?.apicredits?.apiKey, "apicredits");
  add(secure?.keys?.meai, "keys.meai");
  add(secure?.keys?.apicredits, "keys.apicredits");
  add(secure?.keys?.openai, "keys.openai");
  return keys;
}

function collectWhisperCandidates(secure = {}, userDataPath = "") {
  const profiles = Array.isArray(secure?.["editcore-provider-profiles"])
    ? secure["editcore-provider-profiles"]
    : [];
  const providers = secure?.["editcore-providers"] && typeof secure["editcore-providers"] === "object"
    ? secure["editcore-providers"]
    : {};
  const out = [];
  const seen = new Set();

  const push = (entry) => {
    const apiKey = String(entry?.apiKey || "").trim();
    let baseUrl = String(entry?.baseUrl || "").trim();
    if (!apiKey || !baseUrl) return;
    if (hostOf(baseUrl).includes("meai.cloud") && !/\/v1(\/|$)/.test(baseUrl)) {
      baseUrl = "https://api.meai.cloud/v1";
    }
    if (hostOf(baseUrl).includes("apicredits.site") && !/\/v1(\/|$)/.test(baseUrl)) {
      baseUrl = "https://api.apicredits.site/v1";
    }
    if (!isWhisperCandidate({ ...entry, apiKey, baseUrl })) return;
    const id = `${normalizeOpenAiBase(baseUrl)}|${apiKey.slice(0, 8)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      label: String(entry.label || entry.providerKey || entry.name || "openai-compat"),
      providerKey: String(entry.providerKey || entry.name || "openai"),
      apiKey,
      baseUrl,
      url: transcriptionUrl(baseUrl),
      preferred: isPreferredUserHost(baseUrl),
    });
  };

  // Solo hosts meai/apicredits reales. NUNCA remapear keys de GafCore
  // (invalid token). GafCore y apicredits Whisper no sirven para este usuario.
  for (const [providerKey, provider] of Object.entries(providers)) {
    if (/(gafcore)/i.test(providerKey) || hostOf(provider?.baseUrl).includes("gafcore-gateway")) continue;
    if (hostOf(provider?.baseUrl).includes("meai.cloud") || providerKey === "meai") {
      push({
        providerKey: "meai",
        label: "meai-provider",
        apiKey: provider?.apiKey,
        baseUrl: "https://api.meai.cloud/v1",
      });
    }
  }

  for (const profile of profiles) {
    const key = String(profile?.providerKey || "");
    const base = String(profile?.baseUrl || "");
    if (key.includes("gafcore") || hostOf(base).includes("gafcore-gateway")) continue;
    if (hostOf(base).includes("meai.cloud") || /meai/i.test(key)) {
      push({
        providerKey: "meai",
        label: "meai-profile",
        apiKey: profile.apiKey,
        baseUrl: "https://api.meai.cloud/v1",
      });
    }
  }

  const meaiKey = providers?.meai?.apiKey || secure?.keys?.meai || "";
  if (meaiKey) push({ providerKey: "meai", label: "meai", apiKey: meaiKey, baseUrl: "https://api.meai.cloud/v1" });

  void userDataPath;
  out.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return out;
}

function collectGeminiKeys(secure = {}) {
  const profiles = Array.isArray(secure?.["editcore-provider-profiles"])
    ? secure["editcore-provider-profiles"]
    : [];
  const keys = [];
  const seen = new Set();
  const push = (key) => {
    const value = String(key || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    keys.push(value);
  };
  for (const profile of profiles) {
    if (String(profile?.providerKey || "").toLowerCase().includes("gemini") && profile.apiKey) {
      push(profile.apiKey);
    }
  }
  push(secure?.keys?.gemini);
  push(secure?.keys?.google);
  push(process.env.GEMINI_API_KEY);
  return keys;
}

async function tryWhisper(candidate, rawBuffer, mimeType = "audio/webm") {
  const formData = new FormData();
  const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const ext = String(mimeType || "").includes("ogg") ? "ogg" : "webm";
  formData.append("file", blob, `speech.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "es");
  const res = await fetch(candidate.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${candidate.apiKey}`,
      "x-api-key": candidate.apiKey,
    },
    body: formData,
    signal: AbortSignal.timeout(18000),
  });
  const textBody = await res.text().catch(() => "");
  let data = {};
  try { data = textBody ? JSON.parse(textBody) : {}; } catch { data = { raw: textBody.slice(0, 200) }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || textBody.slice(0, 120) || `HTTP ${res.status}`;
    return { ok: false, error: `${candidate.label}: ${msg}` };
  }
  const text = String(data?.text || "").trim();
  if (!text) return { ok: false, error: `${candidate.label}: respuesta vacía` };
  return { ok: true, text, backend: candidate.label };
}

async function tryGemini(apiKey, base64Audio, mimeType = "audio/webm") {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mimeType || "audio/webm", data: base64Audio } },
        {
          text: "Transcribe el siguiente audio exactamente como fue dicho. Devuelve solo la transcripción, sin explicaciones ni comillas.",
        },
      ],
    }],
  };
  const res = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `gemini: HTTP ${res.status} ${errText.slice(0, 100)}` };
  }
  const data = await res.json();
  const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!text) return { ok: false, error: "gemini: respuesta vacía" };
  return { ok: true, text, backend: "gemini" };
}

async function tryLocalSidecar(rawBuffer, userDataPath, fetchFn = fetch) {
  if (!userDataPath) return { ok: false, error: "local: sin userData" };
  const fs = require("node:fs");
  const path = require("node:path");
  const tempPath = path.join(userDataPath, `speech-${Date.now()}.webm`);
  try {
    fs.writeFileSync(tempPath, rawBuffer);
    const response = await fetchFn("http://127.0.0.1:8000/voice/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_path: tempPath }),
      signal: AbortSignal.timeout(4000),
    });
    try { fs.unlinkSync(tempPath); } catch (_) {}
    if (!response.ok) return { ok: false, error: `local: HTTP ${response.status}` };
    const result = await response.json();
    const text = String(result?.text || "").trim();
    if (!text) return { ok: false, error: "local: vacío" };
    return { ok: true, text, backend: "local-sidecar" };
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return { ok: false, error: `local: ${err?.message || "no disponible"}` };
  }
}

function describeSttAvailability(secure = {}) {
  const whisper = collectWhisperCandidates(secure);
  const gemini = collectGeminiKeys(secure);
  const preferred = whisper.filter((c) => c.preferred).map((c) => c.label);
  return {
    whisperCandidates: whisper.map((c) => c.label),
    preferredHosts: preferred,
    gemini: gemini.length > 0,
    note: preferred.length
      ? `STT vía ${preferred.join(", ")} (Whisper).`
      : whisper.length || gemini.length
        ? "Hay backends STT configurados."
        : "Sin Whisper en meai/apicredits usable. Claude del chat no transcribe voz.",
  };
}

async function transcribeAudio(input, {
  secure = {},
  userDataPath = "",
  fetchFn = fetch,
} = {}) {
  const mimeType = String(input?.mimeType || "audio/webm");
  const rawBuffer = asBuffer(input);
  if (!rawBuffer.length) {
    return { ok: false, error: "Buffer de audio vacío." };
  }

  const attempts = [];
  const whisper = collectWhisperCandidates(secure);
  for (const candidate of whisper) {
    try {
      const result = await tryWhisper(candidate, rawBuffer, mimeType);
      attempts.push(result.ok ? `ok:${result.backend}` : result.error);
      if (result.ok) return { ...result, attempts };
    } catch (err) {
      attempts.push(`${candidate.label}: ${err?.message || err}`);
    }
  }

  const geminiKeys = collectGeminiKeys(secure);
  const base64Audio = rawBuffer.toString("base64");
  for (const key of geminiKeys) {
    try {
      const result = await tryGemini(key, base64Audio, mimeType);
      attempts.push(result.ok ? "ok:gemini" : result.error);
      if (result.ok) return { ...result, attempts };
    } catch (err) {
      attempts.push(`gemini: ${err?.message || err}`);
    }
  }

  const local = await tryLocalSidecar(rawBuffer, userDataPath, fetchFn);
  attempts.push(local.ok ? "ok:local" : local.error);
  if (local.ok) return { ...local, attempts };

  const availability = describeSttAvailability(secure);
  const hint = availability.whisperCandidates.length || availability.gemini
    ? `STT falló (GafCore no soporta Whisper). Probado: ${attempts.filter((a) => !a.startsWith("local:")).slice(0, 3).join(" · ") || attempts.slice(0, 3).join(" · ")}`
    : "Sin Whisper usable. GafCore no transcribe voz; hace falta Whisper en meai o reconocimiento de voz de Windows.";

  return {
    ok: false,
    error: hint,
    attempts,
    availability,
  };
}

module.exports = {
  asBuffer,
  collectWhisperCandidates,
  collectGeminiKeys,
  describeSttAvailability,
  normalizeOpenAiBase,
  transcriptionUrl,
  isWhisperCandidate,
  isPreferredUserHost,
  isBlockedHost,
  providerKind,
  transcribeAudio,
};
