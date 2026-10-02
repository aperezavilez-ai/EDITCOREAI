"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeUsage } = require("../editcore-chat-kernel/provider");

test("normalizeUsage reconoce tokens de caché de OpenAI, Anthropic y formatos planos", () => {
  const openai = normalizeUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } });
  assert.equal(openai.input_tokens, 100);
  assert.equal(openai.output_tokens, 20);
  assert.equal(openai.cache_read_input_tokens, 64);

  const anthropic = normalizeUsage({ input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 12 });
  assert.equal(anthropic.cache_read_input_tokens, 30);
  assert.equal(anthropic.cache_creation_input_tokens, 12);
  assert.equal(anthropic.cache_write_input_tokens, 12);

  const flat = normalizeUsage({ input_tokens: 5, output_tokens: 1, cached_tokens: 4, cache_creation: { input_tokens: 7 } });
  assert.equal(flat.cache_read_input_tokens, 4);
  assert.equal(flat.cache_creation_input_tokens, 7);
  assert.equal(flat.cache_write_input_tokens, 7);

  assert.deepEqual(normalizeUsage({}), {
    input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_write_input_tokens: 0,
  });
});

test("el orquestador suma el uso de cada turno del modelo (antes devolvía siempre ceros)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(src, /const addUsage = \(raw = \{\}\) =>/);
  assert.match(src, /clearInterval\(hb\); this\.turnAbort = null;\s*\}\s*addUsage\(turn\?\.usage \|\| \{\}\);/);
  assert.match(src, /totalUsage\.total_tokens \+= Number\(raw\.total_tokens \|\| 0\) \|\| input \+ output;/);
});

test("el orquestador expone los campos de caché que lee la pantalla", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(src, /totalUsage\.provider_cache_read_tokens \+= cacheRead;/);
  assert.match(src, /totalUsage\.cached_input_tokens \+= cacheRead;/);
  assert.match(src, /totalUsage\.provider_calls \+= 1;/);
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /cache proveedor leído \$\{providerCache\} · escrito \$\{providerCacheWrite\}/);
});

test("withCacheControl marca system, primer user y el último mensaje del bucle de tools", () => {
  const { withCacheControl } = require("../runtime/ai-core");
  const marked = (m) => Array.isArray(m.content) && m.content[0]?.cache_control?.type === "ephemeral";
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "pedido" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: "contenido del archivo" },
    { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t2", content: "otro archivo" },
  ];
  const out = withCacheControl(msgs);
  assert.deepEqual(out.map(marked), [true, true, false, false, false, true]);
  assert.equal(out[2].content, null);
  assert.equal(out[5].tool_call_id, "t2");
  assert.equal(out.filter(marked).length <= 4, true);

  const short = withCacheControl([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
  assert.deepEqual(short.map(marked), [true, true]);
});

test("el chat no reutiliza respuestas guardadas en lugar de llamar al modelo", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.doesNotMatch(src, /promptCache\.cacheRead\(/);
});
