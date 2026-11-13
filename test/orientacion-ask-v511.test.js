"use strict";

// Batería v5.1.1 — carril de orientación primero en la rama ASK y
// silencio de las etiquetas del explorador (defecto en vivo de Luis,
// 2026-11-13):
//  (i)   «¿qué queda pendiente?» con frentes en el Mapa NO invoca al
//        explorador y SÍ llega al modelo con el bloque del Mapa.
//  (ii)  una pregunta ASK de código (no orientación) conserva el
//        camino del explorador.
//  (iii) ningún evento de progreso del explorador contiene ya los
//        textos «Mapeando» ni «Mapa listo» (la exploración sigue
//        ocurriendo y devolviendo su resumen).
//  (iv)  el seguimiento «¿de esos pendientes, cuál es el más
//        urgente?» — referido a la lista de la respuesta anterior —
//        también toma el carril de orientación sin invocar al
//        explorador (segundo criterio: la memoria compartida ya
//        guarda la sustancia).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v511-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const { runExplorer } = require("../editcore-chat-kernel/subagents/explorer");

function scriptedHelpers(script, snapshots) {
  const helpers = {
    callChat: async (args) => {
      if (snapshots) snapshots.push(JSON.stringify(args?.messages || []));
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v511-proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const BASE_ARGS = {
  apiKey: "sk-test",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};

const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

function seedFronts(root) {
  orientationMap.openMapFront(root, "Publicar la landing del taller", "prueba v5.1.1");
  orientationMap.openMapFront(root, "Corregir el cobro con tarjeta (urgente: vence el viernes)", "prueba v5.1.1");
}

function noExplorerLabels(events) {
  return events.every((e) => !/Mapeando|Mapa listo/.test(String(e?.text || "")));
}

// ---------------------------------------------------------------- (i)
test("(i) «¿qué queda pendiente?» se responde desde el Mapa: sin explorador y con el bloque del Mapa ante el modelo", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  const reply = "Quedan dos pendientes: publicar la landing del taller y corregir el cobro con tarjeta, que es el urgente porque vence el viernes.";
  const snapshots = [];
  const events = [];
  const { helpers } = scriptedHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ], snapshots);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v511-i", helpers,
    onProgress: (e) => events.push(e),
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("orientation_first"), `el marcador del carril de orientación quedó en los steps (${names.join(", ")})`);
  assert.ok(!names.includes("ask_explorer"), "el explorador NO fue el carril de este turno");
  assert.ok(snapshots.length >= 1, "el turno llegó al modelo");
  assert.ok(snapshots[0].includes("MAPA DE ORIENTACIÓN"), "el bloque del Mapa viajó ante el modelo");
  assert.ok(snapshots[0].includes("Publicar la landing del taller"), "la sustancia (frentes abiertos) viajó ante el modelo");
  assert.ok(!snapshots[0].includes("## Mapa de ."), "el payload NO trae el resumen del explorador: no se mapeó el proyecto");
  assert.ok(noExplorerLabels(events), "ningún progreso del turno anuncia «Mapeando» ni «Mapa listo»");
  assert.match(String(res.text || ""), /landing del taller/);
});

// --------------------------------------------------------------- (ii)
test("(ii) una pregunta ASK de código conserva el camino del explorador", async () => {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo" }),
    "src/total.js": "export function calcularTotal(items) { return items.reduce((a, b) => a + b.precio, 0); }\n",
  });
  const reply = "El total se calcula en src/total.js, en la función calcularTotal.";
  const snapshots = [];
  const { helpers } = scriptedHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ], snapshots);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿dónde se calcula el total de la compra?",
    projectRoot: root, threadId: "hilo-v511-ii", helpers,
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("ask_explorer"), `el marcador del carril del explorador quedó en los steps (${names.join(", ")})`);
  assert.ok(!names.includes("orientation_first"), "la orientación NO se adelantó en una pregunta de código");
  assert.ok(snapshots.length >= 1 && snapshots[0].includes("## Mapa de ."), "el payload trae el resumen del explorador, como antes");
});

// -------------------------------------------------------------- (iii)
test("(iii) el explorador ya no anuncia «Mapeando» ni «Mapa listo», y su resumen sigue existiendo", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const events = [];
  const out = await runExplorer({ projectRoot: root, target: ".", onProgress: (e) => events.push(e) });
  assert.ok(noExplorerLabels(events), `ningún evento de progreso trae las etiquetas vetadas (${JSON.stringify(events)})`);
  assert.ok(out && typeof out.summary === "string" && out.summary.includes("## Mapa de"), "la exploración sigue ocurriendo: el resumen del mapa se devuelve igual");
  assert.ok(Array.isArray(out.steps) && out.steps.length >= 1, "los pasos internos de la exploración se conservan");
});

// --------------------------------------------------------------- (iv)
test("(iv) el seguimiento «¿de esos pendientes, cuál es el más urgente?» también va por orientación, sin explorador", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  const reply1 = "Quedan dos pendientes: publicar la landing del taller y corregir el cobro con tarjeta, que vence el viernes.";
  const s1 = scriptedHelpers([
    { text: reply1, toolCalls: [], usage: USAGE },
    { text: reply1, toolCalls: [], usage: USAGE },
    { text: reply1, toolCalls: [], usage: USAGE },
  ]);
  const first = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v511-iv", helpers: s1.helpers,
  });
  assert.ok((first.steps || []).some((s) => s.name === "orientation_first"), "el primer turno ya fue por orientación");

  const reply2 = "De esos pendientes, el más urgente es corregir el cobro con tarjeta, porque vence el viernes.";
  const snapshots2 = [];
  const events2 = [];
  const s2 = scriptedHelpers([
    { text: reply2, toolCalls: [], usage: USAGE },
    { text: reply2, toolCalls: [], usage: USAGE },
    { text: reply2, toolCalls: [], usage: USAGE },
  ], snapshots2);
  const second = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿de esos pendientes, cuál es el más urgente?",
    projectRoot: root, threadId: "hilo-v511-iv", helpers: s2.helpers,
    onProgress: (e) => events2.push(e),
  });
  const names2 = (second.steps || []).map((s) => s.name);
  assert.ok(names2.includes("orientation_first"), `el seguimiento tomó el carril de orientación (${names2.join(", ")})`);
  assert.ok(!names2.includes("ask_explorer"), "el seguimiento NO despachó al explorador");
  assert.ok(snapshots2.length >= 1, "el seguimiento llegó al modelo");
  assert.ok(!snapshots2[0].includes("## Mapa de ."), "el payload del seguimiento NO trae el resumen del explorador");
  assert.ok(snapshots2[0].includes("Corregir el cobro con tarjeta"), "la sustancia de los pendientes estaba ante el modelo (memoria compartida/historial)");
  assert.ok(noExplorerLabels(events2), "el seguimiento tampoco anuncia «Mapeando» ni «Mapa listo»");
  assert.match(String(second.text || ""), /cobro con tarjeta/);
});
