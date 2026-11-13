"use strict";

// Batería v5.1.4 — el primer turno ya no paga la exploración
// (medición MEDICION-PRIMER-TURNO; fallo en vivo de la v5.1.3: la
// pregunta tecleada «¿qué queda pendiente?.» — CON PUNTO tras el
// signo — no clasificó como información pura y, con acceso completo,
// cayó a EXECUTE: el carril de orientación quedó inalcanzable y el
// modelo-trabajador exploró con el set completo — 47.057 tokens —
// citando el Mapa solo al final, porque el bloque viajaba como
// contexto esencial; agravante: aun dentro del carril, el modelo
// conservaba herramientas de lectura y ninguna directiva decía que
// el bloque bastaba):
//  (i)   la cadena LITERAL del incidente, «¿qué queda pendiente?.»
//        (con punto), en modo agente/acceso completo y en hilo
//        NUEVO, toma el carril de orientación: marcador
//        orientation_first, SIN ask_explorer, UNA sola llamada, y
//        el frente sembrado viaja en el payload de esa llamada.
//  (ii)  modelo guionizado que en su primera respuesta PIDE
//        list_files y read_file dentro del carril: invariante —
//        0 herramientas de lectura/exploración OFRECIDAS en la
//        llamada del carril (solo puede viajar search_brain, que
//        consulta la memoria, no el disco) y 0 EJECUTADAS; el turno
//        cierra con la respuesta de texto en 1 llamada.
//  (iii) regresiones de clasificación y de carril: sin punto sigue
//        orientation_first; «corrige el error del login.» sigue
//        EXECUTE; «¿puedes corregir el error del login?» sigue
//        EXECUTE; si conviven forma de orientación y orden, manda
//        la orden (EXECUTE); una pregunta de código sin sustancia
//        en el Mapa sigue cayendo al explorador (ask_explorer).
// La (iv) de la especificación — las baterías v513, v511, v512,
// Fase A (cache-dieta-v500) y v510 íntegras — se verifica
// corriéndolas junto a esta suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v514-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const { classify } = require("../editcore-chat-kernel/classify");

// callChat falso que captura mensajes Y herramientas tal cual salen.
function capturingHelpers(script, captures) {
  const helpers = {
    callChat: async (args) => {
      if (captures) {
        captures.push({
          messages: JSON.parse(JSON.stringify(args?.messages || [])),
          tools: JSON.parse(JSON.stringify(args?.tools || [])),
        });
      }
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v514-proj-"));
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

const FULL_OPTS = { permissionMode: "full", allowWrite: true, fullAccess: true };
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const FRENTE = "Asesor IA sin backend completo: falta conectar app.py con templates/ai_agent.html";

// Fixture tipo ALFA LUBES con el frente YA sembrado en el Mapa de
// proyecto (la fase de escritura la cubre la batería v5.1.3; aquí
// la memoria llega con sustancia, como en el turno en vivo).
function alfaFixture() {
  const root = emptyProject({
    "ROADMAP.md": "# ALFA LUBES (fixture)\n\nSistema de gestión del taller y lubricentro.\n",
    "app.py": "from flask import Flask\napp = Flask(__name__)\n",
    "templates/ai_agent.html": "<html><body>Asesor IA</body></html>\n",
    "package.json": JSON.stringify({ name: "alfa-fixture" }),
  });
  orientationMap.openMapFront(root, FRENTE, "prueba v5.1.4");
  return root;
}

const EXPLORE_TOOL_NAMES = [
  "list_files", "read_file", "search_files", "grep", "git_status",
  "git_log", "git_diff", "read_pdf", "codebase_map",
  "project_discovery", "capture_preview_screenshot",
];

// ---------------------------------------------------------------- (i)
test("(i) la cadena literal «¿qué queda pendiente?.» (con punto) en hilo nuevo toma el carril: 1 llamada, sin explorador, con el frente en el payload", async () => {
  const root = alfaFixture();
  assert.equal(classify("¿qué queda pendiente?.", FULL_OPTS).kind, "ASK", "la cadena del incidente clasifica ASK, no EXECUTE");
  const reply = `De acuerdo al mapa de orientación del proyecto, el frente abierto es: ${FRENTE}. ¿Procedo a conectarlo?`;
  const captures = [];
  const { helpers } = capturingHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?.",
    projectRoot: root, threadId: "hilo-v514-i-nuevo", helpers,
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("orientation_first"), `el marcador del carril quedó en los steps (${names.join(", ")})`);
  assert.ok(!names.includes("ask_explorer"), "el explorador NO fue despachado");
  assert.equal(captures.length, 1, `el turno se resolvió en UNA sola llamada al modelo (hubo ${captures.length})`);
  const payload = JSON.stringify(captures[0].messages);
  assert.ok(payload.includes("Frentes abiertos:"), "el bloque compartido trae la sección de frentes");
  assert.ok(payload.includes("Asesor IA sin backend completo"), "el frente sembrado viajó en el payload de la única llamada");
  assert.match(String(res.text || ""), /Asesor IA sin backend completo/);
});

// --------------------------------------------------------------- (ii)
test("(ii) el modelo pide list_files/read_file dentro del carril: 0 ofrecidas de lectura y 0 ejecutadas", async () => {
  const root = alfaFixture();
  const replyText = `Según la memoria del proyecto, el frente abierto es: ${FRENTE}. Es lo único registrado como pendiente.`;
  const tempted = {
    text: replyText,
    toolCalls: [
      { id: "v514-t1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: "." }) } },
      { id: "v514-t2", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "ROADMAP.md" }) } },
    ],
    usage: USAGE,
  };
  const captures = [];
  const { helpers } = capturingHelpers([
    tempted,
    { text: replyText, toolCalls: [], usage: USAGE },
    { text: replyText, toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v514-ii", helpers,
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("orientation_first"), "el turno fue por el carril de orientación");
  assert.equal(captures.length, 1, `el turno cerró en UNA llamada: las llamadas no ofrecidas no abrieron otro paso (hubo ${captures.length})`);
  const offered = captures[0].tools.map((t) => t.function?.name || t.name).filter(Boolean);
  for (const name of EXPLORE_TOOL_NAMES) {
    assert.ok(!offered.includes(name), `la llamada del carril NO ofrece ${name}`);
  }
  assert.ok(offered.every((n) => n === "search_brain"), `en el carril solo puede viajar search_brain (memoria), viajaron: ${offered.join(", ") || "ninguna"}`);
  assert.ok(!names.includes("list_files") && !names.includes("read_file"), "0 herramientas de lectura EJECUTADAS (sin pasos list_files/read_file)");
  assert.match(String(res.text || ""), /Asesor IA sin backend completo/, "el turno cerró con la respuesta de texto del bloque");
});

// -------------------------------------------------------------- (iii)
test("(iii) regresiones de clasificación: la orden manda sobre la forma interrogativa y de orientación", () => {
  assert.equal(classify("¿qué queda pendiente?", FULL_OPTS).kind, "ASK", "sin punto: sigue ASK (información pura)");
  assert.equal(classify("¿qué queda pendiente?.", FULL_OPTS).kind, "ASK", "con punto tras el signo: ASK (el incidente)");
  assert.equal(classify("corrige el error del login.", FULL_OPTS).kind, "EXECUTE", "orden con punto final: EXECUTE");
  assert.equal(classify("¿puedes corregir el error del login?", FULL_OPTS).kind, "EXECUTE", "orden con «?» retórico: EXECUTE (no se degrada a pregunta)");
  assert.equal(classify("¿qué queda pendiente? y corrige el error del login", FULL_OPTS).kind, "EXECUTE", "convivencia orientación + orden: manda la orden");
  assert.equal(classify("¿qué decidimos sobre el despliegue?", FULL_OPTS).kind, "ASK", "otra forma de orientación de la lista cerrada: ASK");
  assert.equal(classify("¿dónde se calcula el total de la compra?", FULL_OPTS).kind, "ASK", "pregunta de código: ASK (su carril, el explorador, se decide en la rama)");
});

test("(iii-bis) una pregunta de código sin sustancia en el Mapa sigue cayendo al explorador", async () => {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo" }),
    "src/total.js": "export function calcularTotal(items) { return items.reduce((a, b) => a + b.precio, 0); }\n",
  });
  const reply = "El total se calcula en src/total.js, en la función calcularTotal.";
  const captures = [];
  const { helpers } = capturingHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿dónde se calcula el total de la compra?",
    projectRoot: root, threadId: "hilo-v514-iii", helpers,
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("ask_explorer"), `la pregunta de código conservó el carril del explorador (${names.join(", ")})`);
  assert.ok(!names.includes("orientation_first"), "la orientación NO se adelantó en una pregunta de código");
  assert.ok(captures.length >= 1, "el turno llegó al modelo");
  const payload = JSON.stringify(captures[0].messages);
  assert.ok(payload.includes("## Mapa de ."), "el payload trae el resumen del explorador, como antes");
  // Y ese turno ASK fuera del carril conserva el set de preguntas
  // COMPLETO de la v5.1.2 (la poda de la v5.1.4 es solo del carril).
  const offered = captures[0].tools.map((t) => t.function?.name || t.name).filter(Boolean);
  assert.ok(offered.includes("read_file") && offered.includes("list_files"), "fuera del carril, el turno de pregunta sigue ofreciendo las de lectura");
  assert.ok(offered.includes("capture_preview_screenshot"), "fuera del carril, capture_preview_screenshot sigue ofrecida (revisión visual v4.9.3)");
});
