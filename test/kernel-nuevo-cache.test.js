"use strict";
// ============================================================
// CACHÉ DE PROMPT — el contrato de withCacheControl dice que
// quien conoce la frontera historial/turno (el kernel) pasa
// prefixEndIndex; el adaptador NUNCA lo pasaba y el proveedor
// caía al marcado legacy (system + primer user): el prefijo
// cacheable quedaba fijado al inicio de la conversación y el
// grueso del historial — lo que crece llamada a llamada — se
// reenviaba sin caché en cada paso del turno. La frontera es
// el mensaje del usuario del turno: todo lo anterior es
// idéntico entre las llamadas del mismo turno.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

const DEFS = [{ type: "function", function: { name: "write_file", description: "Escribe un archivo.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }];

test("adaptador: cada llamada del turno lleva la frontera de caché del prefijo estable", async () => {
  const vistas = [];
  let llamada = 0;
  const deps = {
    callChat: async (opts) => {
      vistas.push({ n: (opts.messages || []).length, frontera: opts.cachePrefixEndIndex });
      llamada += 1;
      if (llamada === 1) {
        return {
          content: "",
          toolCalls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "package.json", content: "{}" }) } }],
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      }
      return { content: "Listo: package.json creado en la raíz.", toolCalls: [], usage: { input_tokens: 20, output_tokens: 10 } };
    },
    getToolDefinitions: () => DEFS,
    execute: async () => ({ ok: true, resumen: "escrito package.json", archivoAplicado: "package.json", saved_path: "package.json" }),
    construirMemoria: async () => "",
  };
  const out = await manejarChatNuevo(
    {
      projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m",
      message: "crea el package.json del proyecto",
      history: [
        { role: "user", content: "quiero un saas de reportes" },
        { role: "assistant", content: "Propuesta lista. ¿La apruebas?" },
      ],
    },
    deps,
  );
  assert.equal(out.kind, "ORDEN");
  assert.equal(vistas.length, 2);
  // La frontera es el último mensaje de la PRIMERA llamada (el
  // mensaje del usuario del turno) y se repite idéntica en la
  // segunda, aunque la conversación ya creció.
  assert.ok(Number.isInteger(vistas[0].frontera) && vistas[0].frontera > 0);
  assert.equal(vistas[0].frontera, vistas[0].n - 1);
  assert.equal(vistas[1].frontera, vistas[0].frontera);
  assert.ok(vistas[1].n > vistas[0].n);
});
