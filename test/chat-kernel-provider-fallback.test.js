"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-provider-log-"));
process.env.EDITCORE_USER_DATA_PATH = logDir;

const { callChat, orderProfiles, rejectedKeys } = require("../editcore-chat-kernel/provider");
const { runtimeContextLine, buildMessageList } = require("../editcore-chat-kernel/thread-core");
const { redactSecrets, providerErrorLogPath } = require("../runtime/provider-error-log");

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => text,
  };
}

test("el contexto del sistema incluye fecha, hora y sistema operativo", () => {
  const line = runtimeContextLine(new Date("2026-09-30T21:18:00Z"));
  assert.match(line, /2026-09-30T21:18:00\.000Z/);
  assert.match(line, /Sistema operativo:/);
  assert.match(line, /no pidas al usuario ejecutar comandos/);
});

test("buildMessageList agrega el contexto y omite turnos fallidos del historial", () => {
  const messages = buildMessageList({
    system: "SYS",
    userText: "que hora es?",
    projectRoot: "",
    threadId: "t-test",
    historyInput: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "Algo falló durante la ejecución: No pude autenticar el modelo." },
      { role: "assistant", content: "Hola, ¿en qué te ayudo?" },
    ],
    query: "que hora es?",
    now: new Date("2026-09-30T21:18:00Z"),
  });
  assert.match(messages[0].content, /^SYS\n\nContexto del sistema:/);
  assert.ok(!messages.some((m) => /Algo falló durante la ejecución/.test(m.content)));
  assert.equal(messages[messages.length - 1].content, "que hora es?");
});

test("callChat usa el perfil de respaldo cuando la clave principal da 401", async () => {
  rejectedKeys.clear();
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const auth = init.headers.Authorization;
    calls.push(auth);
    if (auth === "Bearer sk-dead-key-000000") {
      return jsonResponse(401, { error: { message: "无效的令牌" } });
    }
    return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
  };
  try {
    const out = await callChat({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-dead-key-000000",
      model: "claude-sonnet-4.6",
      messages: [{ role: "user", content: "hola" }],
      stream: false,
      fallbackProfiles: [{ baseUrl: "https://api.example.test/v1", apiKey: "sk-live-key-111111", model: "claude-fable-5" }],
    });
    assert.equal(out.text, "ok");
    assert.equal(calls.length, 2, "un 401 no se reintenta sobre la misma clave");
    assert.ok(rejectedKeys.has("sk-dead-key-000000"));
  } finally {
    global.fetch = originalFetch;
    rejectedKeys.clear();
  }
  const logged = fs.readFileSync(providerErrorLogPath(), "utf8");
  assert.match(logged, /"status":401/);
  assert.ok(!logged.includes("sk-dead-key"), "el log no guarda claves");
});

test("si todos los perfiles fallan, el mensaje dice qué proveedor revisar sin hostnames", async () => {
  rejectedKeys.clear();
  const originalFetch = global.fetch;
  global.fetch = async (url) => (String(url).includes("meai")
    ? jsonResponse(401, { error: { message: "无效的令牌" } })
    : jsonResponse(503, { error: { message: "Service temporarily unavailable" } }));
  try {
    await assert.rejects(
      callChat({
        apiBaseUrl: "https://api.meai.cloud/v1",
        apiKey: "sk-meai-dead-000000",
        model: "glm-5",
        messages: [{ role: "user", content: "hola" }],
        stream: false,
        fallbackProfiles: [{ baseUrl: "https://api.apicredits.site/v1", apiKey: "sk-apic-111111", model: "gpt-5.6-luna" }],
      }),
      (err) => {
        assert.equal(err.code, "ALL_PROVIDERS_FAILED");
        assert.match(err.message, /ME AI: clave rechazada/);
        assert.match(err.message, /APICredits: no disponible ahora/);
        assert.ok(!/api\.|\.cloud|\.site/.test(err.message));
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    rejectedKeys.clear();
  }
});

test("orderProfiles manda al final las claves rechazadas y quita duplicados", () => {
  rejectedKeys.clear();
  rejectedKeys.set("k-dead", Date.now() + 60_000);
  const dead = { apiBaseUrl: "u", model: "a", apiKey: "k-dead" };
  const live = { apiBaseUrl: "u", model: "b", apiKey: "k-live" };
  const ordered = orderProfiles([dead, live, { ...live }]);
  assert.deepEqual(ordered.map((p) => p.apiKey), ["k-live", "k-dead"]);
  rejectedKeys.clear();
});

test("buildMessageList envía la imagen adjunta al modelo", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const messages = buildMessageList({
    system: "SYS",
    userText: "analiza la captura",
    projectRoot: "",
    threadId: "t-img",
    historyInput: [],
    images: [{ dataUrl, name: "captura.png" }],
  });
  const content = messages[messages.length - 1].content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content.map((p) => p.type), ["text", "image_url"]);
  assert.equal(content[1].image_url.url, dataUrl);
});

test("con imágenes, los modelos con visión van primero en la cola", () => {
  rejectedKeys.clear();
  const ordered = orderProfiles([
    { apiBaseUrl: "u", model: "deepseek-v4-pro", apiKey: "a" },
    { apiBaseUrl: "u", model: "glm-5", apiKey: "b" },
    { apiBaseUrl: "u", model: "claude-fable-5", apiKey: "c" },
  ], Date.now(), { vision: true });
  assert.equal(ordered[0].model, "claude-fable-5");
});

test("redactSecrets oculta claves y tokens", () => {
  const out = redactSecrets("Bearer abcdefghijkl sk-1234567890abcdef eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x");
  assert.ok(!/sk-1234|abcdefghijkl|eyJhbGci/.test(out));
});
