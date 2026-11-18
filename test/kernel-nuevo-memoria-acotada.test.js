"use strict";
// [Juicio en vivo v5.2.7] La memoria del turno NUNCA puede retener
// el turno ni disparar una reindexación del proyecto:
//  1) La búsqueda del Cerebro se pide con ámbito "memory" — con
//     "all"/"code", Brain.searchForAgent reindexa el proyecto en
//     línea (indexProject) y el primer turno tras un reemplazo del
//     árbol pagó una reindexación completa: la ventana dejó de
//     responder antes de que el proveedor recibiera nada.
//  2) Si el Cerebro no responde, el turno sigue sin él (tope de
//     espera): la memoria es opcional por diseño.
//  3) Cuando el Cerebro SÍ responde, sus datos llegan al modelo:
//     acotar no es desconectar.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { handleChatKernel, buildKernelHelpers } = require("../runtime/chat-kernel-bridge");

function proyectoTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kernel-memoria-"));
}

function baseInput(projectRoot, helpers) {
  return {
    projectRoot,
    apiBaseUrl: "https://example.invalid/v1",
    apiKey: "sk-test",
    model: "test-model",
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    threadId: "memoria-thread",
    chatId: "memoria-chat",
    helpers,
    history: [],
  };
}

test("la memoria del turno pide ámbito 'memory' y un Cerebro colgado no retiene el turno", { timeout: 20000 }, async () => {
  const root = proyectoTemporal();
  const llamadas = [];
  const brainSearch = (r, q, options) => {
    llamadas.push({ root: r, query: q, options });
    return new Promise(() => {}); // nunca resuelve: el peor caso
  };
  const callChat = async () => ({ text: "Respuesta desde la conversación.", toolCalls: [], usage: {} });
  const helpers = buildKernelHelpers({ callChat, brainSearch });
  const inicio = Date.now();
  const out = await handleChatKernel({
    ...baseInput(root, helpers),
    runId: "memoria-run-1",
    message: "¿qué queda pendiente?",
  });
  const duracion = Date.now() - inicio;
  assert.equal(llamadas.length, 1, "el Cerebro se consulta una vez");
  assert.equal(llamadas[0].options.scope, "memory", "ámbito sin indexación");
  assert.match(String(out.text || ""), /Respuesta desde la conversación/);
  assert.ok(duracion < 15000, `el turno cerró sin esperar al Cerebro (${duracion} ms)`);
});

test("cuando el Cerebro responde, sus datos llegan al modelo", { timeout: 20000 }, async () => {
  const root = proyectoTemporal();
  const brainSearch = async () => ({
    memory: [{ text: "DATO_CEREBRO_MEMORIA: el despliegue va por GitHub Releases." }],
    knowledge: [],
    catalog: [],
  });
  let vistoPorElModelo = "";
  const callChat = async (args) => {
    vistoPorElModelo = JSON.stringify(args || {});
    return { text: "Respuesta con memoria.", toolCalls: [], usage: {} };
  };
  const helpers = buildKernelHelpers({ callChat, brainSearch });
  const out = await handleChatKernel({
    ...baseInput(root, helpers),
    runId: "memoria-run-2",
    message: "¿cómo se despliega esto?",
  });
  assert.match(String(out.text || ""), /Respuesta con memoria/);
  assert.ok(vistoPorElModelo.includes("DATO_CEREBRO_MEMORIA"), "el dato del Cerebro llegó al contexto del modelo");
});
