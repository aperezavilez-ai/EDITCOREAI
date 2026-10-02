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

test("el chat no reutiliza respuestas guardadas en lugar de llamar al modelo", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.doesNotMatch(src, /promptCache\.cacheRead\(/);
});
