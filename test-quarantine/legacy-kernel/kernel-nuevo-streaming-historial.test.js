"use strict";
// [Rendimiento — juicio en vivo v5.2.7] Dos correcciones de peso y
// de superficie:
//  1) STREAMING: el turno pintaba su respuesta solo al completar
//     la generación (43-75 s de silencio en vivo). El proveedor ya
//     emitía deltas (onTextDelta) y el renderer ya pintaba la fase
//     narration_delta; faltaba el cable del kernel: adaptador →
//     entrada → puente. El razonamiento NUNCA viaja como delta.
//  2) HISTORIAL ACOTADO POR CARACTERES: el tope de 20 mensajes sin
//     tope de tamaño dejaba pasar respuestas gigantes en cada
//     turno. seleccionarHistorial conserva los mensajes recientes
//     hasta 32.000 caracteres y recorta con marca el mensaje único
//     que por sí solo supera el tope.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { handleChatKernel, buildKernelHelpers } = require("../runtime/chat-kernel-bridge");
const { seleccionarHistorial } = require("../editcore-chat-kernel/nuevo/adaptador");

function proyectoTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kernel-stream-"));
}

function baseInput(projectRoot, helpers, extra = {}) {
  return {
    projectRoot,
    apiBaseUrl: "https://example.invalid/v1",
    apiKey: "sk-test",
    model: "test-model",
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    threadId: "stream-thread",
    chatId: "stream-chat",
    helpers,
    history: [],
    ...extra,
  };
}

test("los deltas de contenido llegan como narration_delta y el razonamiento no viaja", { timeout: 20000 }, async () => {
  const root = proyectoTemporal();
  const callChat = async (args) => {
    assert.equal(typeof args.onTextDelta, "function", "el adaptador entrega onTextDelta al proveedor");
    args.onTextDelta("Hola ", {});
    args.onTextDelta("mundo", {});
    args.onTextDelta("RAZONAMIENTO_INTERNO_SECRETO", { reasoning: true });
    return { text: "Hola mundo", toolCalls: [], usage: {} };
  };
  const helpers = buildKernelHelpers({ callChat });
  const eventos = [];
  const out = await handleChatKernel({
    ...baseInput(root, helpers),
    runId: "stream-run-1",
    message: "¿qué es un bucle en programación?",
    onProgress: (p) => eventos.push(p),
  });
  const deltas = eventos.filter((e) => e.phase === "narration_delta");
  assert.ok(deltas.length >= 1, "llegó al menos un evento narration_delta");
  const pintado = deltas.map((e) => e.text).join("");
  assert.ok(pintado.includes("Hola"), "el contenido se pintó en vivo");
  assert.ok(pintado.includes("mundo"), "el contenido completo se pintó en vivo");
  assert.ok(!pintado.includes("RAZONAMIENTO_INTERNO_SECRETO"), "el razonamiento nunca se pinta");
  assert.match(String(out.text || ""), /Hola mundo/);
});

test("seleccionarHistorial acota por caracteres y conserva lo reciente", () => {
  const mensajes = [];
  for (let i = 0; i < 19; i++) mensajes.push({ role: i % 2 ? "assistant" : "user", content: `mensaje ${i} ` + "a".repeat(2000) });
  mensajes.push({ role: "user", content: "LA PREGUNTA RECIENTE" });
  const elegido = seleccionarHistorial(mensajes);
  const total = elegido.reduce((s, m) => s + m.content.length, 0);
  assert.ok(total <= 32_000, `total acotado (${total})`);
  assert.equal(elegido.at(-1).content, "LA PREGUNTA RECIENTE", "el mensaje más reciente sobrevive intacto");
  assert.ok(elegido.length < mensajes.length, "los mensajes viejos que no caben se descartan");
  // Orden cronológico preservado entre los que quedan.
  const indices = elegido.slice(0, -1).map((m) => Number(m.content.match(/mensaje (\d+)/)?.[1]));
  assert.ok(indices.every((v, i) => i === 0 || v > indices[i - 1]), "orden preservado");
});

test("un mensaje único gigante entra recortado por la cola, con marca", () => {
  const gigante = "inicio" + "x".repeat(100_000) + "FINAL_VISIBLE";
  const elegido = seleccionarHistorial([{ role: "assistant", content: gigante }]);
  assert.equal(elegido.length, 1);
  assert.ok(elegido[0].content.startsWith("[…recortado"), "lleva la marca de recorte");
  assert.ok(elegido[0].content.endsWith("FINAL_VISIBLE"), "conserva la cola del mensaje");
  assert.ok(elegido[0].content.length <= 32_000 + 60, "el recorte respeta el tope");
});

test("el proveedor nunca recibe el historial gigante sin acotar", { timeout: 20000 }, async () => {
  const root = proyectoTemporal();
  let vistoPorElModelo = "";
  const callChat = async (args) => {
    vistoPorElModelo = JSON.stringify(args.messages || []);
    return { text: "Respuesta breve.", toolCalls: [], usage: {} };
  };
  const helpers = buildKernelHelpers({ callChat });
  const historial = [
    { role: "user", content: "primera pregunta" },
    { role: "assistant", content: "TABLA_GIGANTE " + "x".repeat(100_000) },
    { role: "user", content: "¿y ahora qué sigue?" },
  ];
  const out = await handleChatKernel({
    ...baseInput(root, helpers),
    runId: "stream-run-2",
    message: "¿y ahora qué sigue?",
    history: historial,
  });
  assert.match(String(out.text || ""), /Respuesta breve/);
  assert.ok(!vistoPorElModelo.includes("x".repeat(50_000)), "el bloque gigante no viajó entero al proveedor");
  assert.ok(vistoPorElModelo.includes("¿y ahora qué sigue?"), "el intercambio reciente sí viajó");
});
