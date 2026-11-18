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

test("el kernel suma el uso de cada turno del modelo (antes devolvía siempre ceros)", async () => {
  // [FASE2-RUTA-UNICA] La versión anterior leía el código del
  // orquestador viejo (addUsage). El contrato — el turno reporta el
  // consumo REAL que el proveedor declara — se afirma ahora de
  // comportamiento sobre la entrada única del kernel nuevo.
  const { handleChat } = require("../editcore-chat-kernel/index");
  const provider = require("../editcore-chat-kernel/provider");
  const original = provider.callChat;
  provider.callChat = async () => ({ text: "Respuesta con consumo.", toolCalls: [], usage: { input_tokens: 100, output_tokens: 50 } });
  try {
    const out = await handleChat({ message: "hola, ¿qué tal?", projectRoot: process.cwd(), apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m", helpers: {} });
    assert.equal(out.usage.total_tokens, 150, "el uso del turno es la suma real del proveedor, no ceros");
  } finally {
    provider.callChat = original;
  }
});

test("la pantalla conserva su línea de caché del recibo (la superficie que lee los campos de uso)", () => {
  // [FASE2-RUTA-UNICA] La mitad del kernel de esta prueba (los
  // campos provider_cache_* del orquestador viejo) cesa con la ruta
  // única: el kernel nuevo reporta el uso como total del turno
  // (usage.total_tokens, probado arriba). La mitad de superficie —
  // la línea del recibo que presenta la caché cuando el proveedor
  // la reporta — sigue en el renderer y se sigue afirmando.
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /cache proveedor leído \$\{providerCache\} · escrito \$\{providerCacheWrite\}/);
});

test("withCacheControl (Fase A): system + último del historial con prefixEndIndex; sin breakpoint rolling", () => {
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
  // [EDITCORE-V500-A4] Antes la tercera marca caía sobre el ÚLTIMO
  // mensaje del bucle (la herramienta en curso): un breakpoint
  // «rolling» que nunca podía leerse (INFORME Fase A §1.4). Ahora:
  // sin frontera declarada se conserva system + primer user y el
  // mensaje en curso queda SIN marca.
  const legacy = withCacheControl(msgs);
  assert.deepEqual(legacy.map(marked), [true, true, false, false, false, false]);
  // Con frontera de prefijo: system + el último mensaje DEL
  // HISTORIAL (índice 3); el sufijo en curso (4-5) queda sin marca.
  const out = withCacheControl(msgs, { prefixEndIndex: 3 });
  assert.deepEqual(out.map(marked), [true, false, false, true, false, false]);
  assert.equal(out[2].content, null);
  assert.equal(out[3].tool_call_id, "t1");
  assert.equal(out.filter(marked).length <= 4, true);

  const short = withCacheControl([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
  assert.deepEqual(short.map(marked), [true, true]);
});

test("el chat no reutiliza respuestas guardadas en lugar de llamar al modelo", () => {
  // [FASE2-RUTA-UNICA] La guarda se traslada al kernel nuevo: en
  // ninguna de sus piezas existe lectura de una caché de respuestas.
  const dir = path.join(__dirname, "..", "editcore-chat-kernel", "nuevo");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /promptCache\.cacheRead\(/, `${f} no lee respuestas guardadas`);
  }
});
