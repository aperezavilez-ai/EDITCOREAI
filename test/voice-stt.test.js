"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const voiceStt = require("../runtime/voice-stt");

test("voice-stt: Claude en hosts ajenos no es Whisper; meai si es candidato", () => {
  assert.equal(voiceStt.isWhisperCandidate({
    providerKey: "anthropic",
    apiKey: "sk-test",
    baseUrl: "https://api.anthropic.com",
  }), false);
  assert.equal(voiceStt.isWhisperCandidate({
    providerKey: "claude-1",
    apiKey: "sk-test",
    baseUrl: "https://api.meai.cloud",
  }), true, "meai new-api puede exponer Whisper con la misma key");
  assert.equal(voiceStt.isBlockedHost("https://aiprimetech.io"), true);
});

test("voice-stt: OpenAI-compat si es candidato y normaliza /v1", () => {
  assert.equal(voiceStt.isWhisperCandidate({
    providerKey: "kimi",
    apiKey: "sk-test",
    baseUrl: "https://api.meai.cloud",
  }), true);
  assert.equal(
    voiceStt.transcriptionUrl("https://api.meai.cloud"),
    "https://api.meai.cloud/v1/audio/transcriptions",
  );
});

test("voice-stt: collectWhisperCandidates prioriza meai y excluye aiprimetech", () => {
  const secure = {
    "editcore-provider-profiles": [
      { providerKey: "claude-1", apiKey: "sk-claude", baseUrl: "https://api.meai.cloud", model: "claude" },
      { providerKey: "codex", apiKey: "sk-codex", baseUrl: "https://aiprimetech.io", model: "gpt" },
      { providerKey: "apicredits", apiKey: "sk-api", baseUrl: "https://api.apicredits.site/v1", model: "gpt" },
    ],
  };
  const list = voiceStt.collectWhisperCandidates(secure);
  assert.ok(list.some((c) => c.url.includes("meai.cloud")));
  assert.ok(list.some((c) => c.url.includes("apicredits.site")));
  assert.equal(list.some((c) => c.url.includes("aiprimetech")), false);
});

test("voice-stt: gafcore se remapea a meai y no se llama directo", () => {
  const secure = {
    "editcore-provider-profiles": [
      {
        providerKey: "custom:gafcore-gateway",
        apiKey: "sk-gateway",
        baseUrl: "https://gafcore-gateway.vercel.app/api/openai/v1",
        model: "meai/claude-sonnet-4.6",
      },
    ],
  };
  const list = voiceStt.collectWhisperCandidates(secure);
  assert.equal(list.some((c) => c.url.includes("gafcore-gateway")), false);
  assert.ok(list.some((c) => c.url.includes("meai.cloud") && c.apiKey === "sk-gateway"));
});

test("voice-stt: asBuffer acepta base64 IPC", () => {
  const buf = voiceStt.asBuffer({ base64: Buffer.from("hola").toString("base64"), mimeType: "audio/webm" });
  assert.equal(buf.toString("utf8"), "hola");
});

test("voice-stt: describeSttAvailability con meai reporta Whisper preferido", () => {
  const info = voiceStt.describeSttAvailability({
    "editcore-provider-profiles": [
      { providerKey: "claude-1", apiKey: "sk", baseUrl: "https://api.meai.cloud" },
    ],
  });
  assert.ok(info.whisperCandidates.length >= 1);
  assert.match(info.note, /meai|Whisper/i);
});

test("voice-stt: describeSttAvailability sin hosts utiles", () => {
  const info = voiceStt.describeSttAvailability({
    "editcore-provider-profiles": [
      { providerKey: "anthropic", apiKey: "sk", baseUrl: "https://api.anthropic.com" },
    ],
  });
  assert.equal(info.whisperCandidates.length, 0);
  assert.match(info.note, /Claude|Whisper|meai/i);
});

test("voice-stt: transcribeAudio sin backends devuelve error claro", async () => {
  const result = await voiceStt.transcribeAudio(
    { base64: Buffer.from("fake-audio").toString("base64") },
    { secure: {}, userDataPath: "", fetchFn: async () => { throw new Error("offline"); } },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Claude|Whisper|Gemini|sidecar/i);
});
