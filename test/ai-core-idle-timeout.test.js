"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AiCore, createIdleTimeout } = require("../runtime/ai-core");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function slowSse(lines, gapMs, { stallAfter = Infinity } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < lines.length; i++) {
        if (i === stallAfter) return;
        await sleep(gapMs);
        controller.enqueue(enc.encode(`${lines[i]}\n\n`));
      }
      controller.close();
    },
  });
}

async function withFetch(fake, fn) {
  const original = global.fetch;
  global.fetch = fake;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

function opusLines(thinkingChunks) {
  return [
    ...Array.from({ length: thinkingChunks }, () => 'data: {"choices":[{"delta":{"reasoning":"pienso "}}]}'),
    'data: {"choices":[{"delta":{"content":"Respuesta final"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
  ];
}

test("ai-core: un modelo que razona más que el plazo no se corta mientras siga mandando datos", async () => {
  const core = new AiCore();
  core.register({ id: "p1", kind: "openai-compatible", baseUrl: "https://proveedor.test/v1" });
  const idle = createIdleTimeout(600, 10_000);
  const started = Date.now();
  const result = await withFetch(async () => new Response(slowSse(opusLines(14), 100), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  }), () => core.complete({ provider: "p1", model: "claude-opus-4.6", messages: [{ role: "user", content: "hola" }], signal: idle.signal, onActivity: idle.touch }));
  idle.clear();
  assert.ok(Date.now() - started > 1_200, "la respuesta duró el doble del plazo de inactividad");
  assert.equal(result.text, "Respuesta final");
});

test("ai-core: si el proveedor se queda callado, corta por inactividad con PROVIDER_TIMEOUT", async () => {
  const core = new AiCore();
  core.register({ id: "p2", kind: "openai-compatible", baseUrl: "https://proveedor.test/v1" });
  const idle = createIdleTimeout(400, 10_000);
  await withFetch(async (_url, opts) => {
    const body = slowSse(opusLines(20), 50, { stallAfter: 3 });
    opts.signal?.addEventListener("abort", () => body.cancel().catch(() => {}), { once: true });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }, async () => {
    await assert.rejects(
      core.complete({ provider: "p2", model: "claude-opus-4.6", messages: [{ role: "user", content: "hola" }], signal: idle.signal, onActivity: idle.touch }),
      (err) => err.code === "PROVIDER_GATEWAY_TIMEOUT" || err.code === "PROVIDER_TIMEOUT" || /timeout/i.test(String(err.message)),
    );
  });
  idle.clear();
});

test("ai-core: el tope total corta aunque siga llegando algo", async () => {
  const idle = createIdleTimeout(400, 600);
  const timer = setInterval(idle.touch, 50);
  await sleep(900);
  clearInterval(timer);
  assert.equal(idle.signal.aborted, true);
  assert.equal(idle.signal.reason.code, "PROVIDER_TIMEOUT");
  idle.clear();
  const none = createIdleTimeout(0, 0);
  assert.equal(none.signal, undefined);
});

test("main: la consulta al proveedor usa plazo por inactividad, no un tope fijo", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const fn = src.slice(src.indexOf("async function callProvider("), src.indexOf("function secureConfigPath()"));
  assert.match(fn, /createIdleTimeout\(/);
  assert.match(fn, /onActivity: idleTimeout\.touch/);
  assert.doesNotMatch(fn, /AbortSignal\.timeout\(/);
});
