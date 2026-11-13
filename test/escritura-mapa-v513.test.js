"use strict";

// Batería v5.1.3 — la escritura del Mapa: que la lista de pendientes
// tenga por fin una ruta al frente abierto (fallo en vivo de la
// v5.1.2: «Asesor IA pendiente» no tenía NINGUNA ruta para terminar
// como frente del Mapa; un chat nuevo exploró 2 archivos y concluyó
// «no queda pendiente funcional»):
//  (i-a) el destilador asienta los pendientes explícitos de un
//        informe de explorador como frentes del expediente con
//        procedencia, y el mantenimiento los proyecta al Mapa.
//  (i-b) un turno ANALYZE cuyo analyst lee un ROADMAP con sección de
//        pendientes cierra dejando esos frentes en el expediente y
//        en el Mapa (el despacho directo entró al circuito W1).
//  (ii)  CICLO COMPLETO: tras (i-b), un hilo NUEVO pregunta «¿qué
//        queda pendiente?» y toma el carril de orientación SIN
//        explorador, con los frentes registrados en el bloque.
//  (iii) el workingOn (la pregunta del usuario) ya NO aparece como
//        frente del Mapa; sigue en el expediente como foco vigente.
//  (iv)  con la memoria vacía, el bloque declara «Frentes abiertos:
//        ninguno registrado» y el carril inyecta la directiva de
//        vacío; el turno cierra sin registrar la pregunta como frente.
//  (vi)  las herramientas del Mapa (W3): clasificación de escritura,
//        fuera del set de preguntas, bloqueo sin autorización y
//        escritura a través del expediente que sobrevive al
//        mantenimiento.
// La (v) de la especificación — las baterías v511, v512, Fase A y
// v510 íntegras — se verifica corriéndolas junto a esta suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v513-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const { recordSubagentDistillates } = require("../editcore-chat-kernel/subagent-distill");
const { buildSharedMemoryBlock } = require("../editcore-chat-kernel/concierge");
const tools = require("../editcore-chat-kernel/tools");
const { WRITE_TOOLS, READ_ONLY_TOOLS, QUESTION_READ_TOOLS } = require("../editcore-chat-kernel/classify");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v513-proj-"));
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

const ROADMAP_CON_PENDIENTES = [
  "# ALFA LUBES (fixture)",
  "",
  "Sistema de gestión del taller y lubricentro. La app local corre en Flask.",
  "",
  "## Pendientes",
  "- Asesor IA sin backend completo: falta conectar app.py con templates/ai_agent.html",
  "- La carpeta static/images/ está vacía: faltan las imágenes del sitio",
  "- Confirmar el error 500 de /products en producción (Vercel)",
  "",
  "## Notas",
  "Las releases se publican los lunes.",
  "",
].join("\n");

function alfaFixture() {
  return emptyProject({
    "ROADMAP.md": ROADMAP_CON_PENDIENTES,
    "app.py": "from flask import Flask\napp = Flask(__name__)\n",
    "templates/ai_agent.html": "<html><body>Asesor IA</body></html>\n",
    "package.json": JSON.stringify({ name: "alfa-fixture" }),
  });
}

// -------------------------------------------------------------- (i-a)
test("(i-a) el destilador asienta los pendientes explícitos de un informe de explorador como frentes con procedencia", () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const report = [
    "Informe de exploración de la zona raíz del proyecto.",
    "",
    "## Pendientes detectados",
    "- Asesor IA sin backend completo: falta conectar app.py con templates/ai_agent.html",
    "- La carpeta static/images/ está vacía: faltan las imágenes del sitio",
    "- Confirmar el error 500 de /products en producción (Vercel)",
    "",
    "Sin pendientes en la configuración base del proyecto.",
  ].join("\n");
  recordSubagentDistillates(root, [{ role: "explorer", target: ".", question: "¿qué queda pendiente?", text: report, ok: true }]);
  const fronts = (threadMemory.loadProjectState(root).fronts || []).filter((f) => f.status !== "closed");
  assert.ok(fronts.length >= 3, `los tres pendientes enumerados quedaron como frentes (hay ${fronts.length})`);
  assert.ok(fronts.every((f) => /subagente explorer/.test(f.source || "")), "cada frente lleva la procedencia del subagente");
  assert.ok(fronts.some((f) => f.text.includes("Asesor IA")), "el frente del Asesor IA quedó asentado");
  assert.ok(!fronts.some((f) => /configuración base/.test(f.text)), "la línea negada («Sin pendientes…») NO se asentó como frente");
  const map = orientationMap.maintainProjectMap(root, { steps: [], finalText: "", userText: "" });
  assert.ok(map.openFronts.some((f) => f.text.includes("Asesor IA")), "el mantenimiento proyecta el frente al Mapa");
  assert.ok(map.openFronts.some((f) => f.text.includes("500 de /products")), "el frente del 500 también llegó al Mapa");
});

// -------------------------------------------------------------- (i-b)
test("(i-b) un turno ANALYZE con ROADMAP de pendientes cierra dejando frentes en el expediente y en el Mapa", async () => {
  const root = alfaFixture();
  const reply = "Análisis cerrado: el ROADMAP declara tres pendientes, con el Asesor IA como el mayor. Siguiente paso concreto: conectar app.py con templates/ai_agent.html.";
  const s = scriptedHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ]);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "analiza el estado del proyecto",
    projectRoot: root, threadId: "hilo-v513-ib", helpers: s.helpers,
  });
  const fronts = (threadMemory.loadProjectState(root).fronts || []).filter((f) => f.status !== "closed");
  assert.ok(fronts.some((f) => f.text.includes("Asesor IA")), `el analyst destiló el frente del Asesor IA al expediente (frentes: ${fronts.map((f) => f.text).join(" | ") || "ninguno"})`);
  assert.ok(fronts.some((f) => /subagente analyst/.test(f.source || "")), "la procedencia es el analyst despachado en directo");
  const map = orientationMap.getProjectMap(root);
  assert.ok(map.openFronts.some((f) => f.text.includes("Asesor IA")), "al cerrar el turno, el frente ya está en los frentes abiertos del Mapa");
});

// --------------------------------------------------------------- (ii)
test("(ii) CICLO COMPLETO: un hilo nuevo pregunta «¿qué queda pendiente?» y responde del Mapa, sin explorador", async () => {
  const root = alfaFixture();
  const replyA = "Análisis cerrado: tres pendientes declarados en el ROADMAP. Siguiente paso concreto: conectar app.py con templates/ai_agent.html.";
  const sa = scriptedHelpers([
    { text: replyA, toolCalls: [], usage: USAGE },
    { text: replyA, toolCalls: [], usage: USAGE },
    { text: replyA, toolCalls: [], usage: USAGE },
    { text: replyA, toolCalls: [], usage: USAGE },
  ]);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "analiza el estado del proyecto",
    projectRoot: root, threadId: "hilo-v513-ii-viejo", helpers: sa.helpers,
  });

  // Hilo NUEVO (otro threadId, mismo proyecto): la pregunta se
  // responde desde la memoria registrada, no re-explorando.
  const snapshots = [];
  const replyB = "Queda pendiente, según la memoria del proyecto: el Asesor IA sin backend completo, las imágenes de static/images/ y confirmar el 500 de /products. El más urgente es el del Asesor IA.";
  const sb = scriptedHelpers([
    { text: replyB, toolCalls: [], usage: USAGE },
    { text: replyB, toolCalls: [], usage: USAGE },
    { text: replyB, toolCalls: [], usage: USAGE },
  ], snapshots);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v513-ii-nuevo", helpers: sb.helpers,
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(names.includes("orientation_first"), `el hilo nuevo tomó el carril de orientación (${names.join(", ")})`);
  assert.ok(!names.includes("ask_explorer"), "el hilo nuevo NO despachó al explorador");
  assert.ok(snapshots.length >= 1, "la pregunta llegó al modelo");
  assert.ok(snapshots[0].includes("Frentes abiertos:"), "el bloque compartido trae la sección de frentes");
  assert.ok(snapshots[0].includes("Asesor IA sin backend completo"), "el bloque compartido contiene los frentes REGISTRADOS en el turno anterior");
  assert.ok(!snapshots[0].includes("ninguno registrado"), "con frentes registrados no se declara el vacío");
});

// -------------------------------------------------------------- (iii)
test("(iii) el workingOn (la pregunta del usuario) ya no aparece como frente del Mapa", () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  threadMemory.noteFront(root, "Confirmar el error 500 de /products en producción", "subagente analyst · prueba v5.1.3");
  // Lo que siembran la apertura y el cierre de un turno con la
  // pregunta de orientación: el foco vigente del expediente.
  threadMemory.noteWorkingOn(root, "¿qué queda pendiente?", "hilo-v513-iii");
  const map = orientationMap.maintainProjectMap(root, { steps: [], finalText: "", userText: "¿qué queda pendiente?" });
  assert.ok(map.openFronts.some((f) => f.text.includes("500 de /products")), "el frente real del expediente sí está en el Mapa");
  assert.ok(!map.openFronts.some((f) => /qué queda pendiente/i.test(f.text)), "la pregunta del usuario NO es un frente del Mapa");
  assert.equal(threadMemory.loadProjectState(root).workingOn, "¿qué queda pendiente?", "el workingOn sigue en el expediente como foco vigente (no se borró: dejó de presentarse como frente)");
});

// --------------------------------------------------------------- (iv)
test("(iv) memoria vacía: el bloque declara el vacío y el carril inyecta la directiva de vacío", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const block = await buildSharedMemoryBlock(root, "hilo-v513-iv", "¿qué queda pendiente?", {});
  assert.ok(block.includes("Frentes abiertos: ninguno registrado"), "el bloque compartido DECLARA la sección vacía en vez de omitirla");

  const snapshots = [];
  const reply = "De este proyecto aún no tengo registrado ningún frente abierto ni decisiones en la memoria: no consta ningún pendiente. Siguiente paso concreto: dime qué frente registramos primero o encárgame el análisis del proyecto.";
  const s = scriptedHelpers([
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
    { text: reply, toolCalls: [], usage: USAGE },
  ], snapshots);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v513-iv", helpers: s.helpers,
  });
  const names = (res.steps || []).map((x) => x.name);
  assert.ok(names.includes("orientation_first"), "la pregunta de orientación tomó su carril también con la memoria vacía");
  assert.ok(snapshots.length >= 1, "el turno llegó al modelo");
  assert.ok(snapshots[0].includes("MEMORIA DE ORIENTACIÓN VACÍA"), "la directiva de vacío viajó ante el modelo");
  assert.ok(snapshots[0].includes("aún no tengo registrado"), "la directiva ordena declararlo en la voz del agente");
  assert.ok(snapshots[0].includes("PROHIBIDO concluir «no queda pendiente»"), "la directiva prohíbe concluir «no queda pendiente» desde lecturas de archivos");
  const map = orientationMap.getProjectMap(root);
  assert.ok(!map.openFronts.some((f) => /qué queda pendiente/i.test(f.text)), "tras el turno, la pregunta sigue sin ser un frente del Mapa");
});

// --------------------------------------------------------------- (vi)
test("(vi) herramientas del Mapa: clasificación de escritura, bloqueo sin autorización y persistencia vía expediente", async () => {
  for (const name of ["open_map_front", "close_map_front", "note_map_decision"]) {
    assert.ok(WRITE_TOOLS.includes(name), `${name} está clasificada como ESCRITURA en classify.js`);
    assert.ok(!READ_ONLY_TOOLS.includes(name), `${name} NO está en READ_ONLY_TOOLS`);
    assert.ok(!QUESTION_READ_TOOLS.has(name), `${name} NO entra al set de solo lectura de los turnos de pregunta (v5.1.2 intacta)`);
  }
  const defsRead = tools.getToolDefinitions({ allowWrite: false });
  assert.ok(!defsRead.some((t) => t.function?.name === "open_map_front"), "sin escritura no se ofrece open_map_front");
  const defsWrite = tools.getToolDefinitions({ allowWrite: true });
  assert.ok(defsWrite.some((t) => t.function?.name === "open_map_front"), "con escritura sí se ofrece open_map_front");

  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const blocked = await tools.execute("open_map_front", { text: "Frente que no debe entrar" }, root, false, {});
  assert.equal(blocked.ok, false, "sin autorización, la herramienta no escribe");
  assert.ok(!(threadMemory.loadProjectState(root).fronts || []).length, "el bloqueo no dejó asiento alguno");

  const opened = await tools.execute("open_map_front", { text: "Revisar las variables de entorno en Vercel" }, root, true, {});
  assert.equal(opened.ok, true, "con autorización el frente se registra");
  const st1 = threadMemory.loadProjectState(root);
  assert.ok((st1.fronts || []).some((f) => f.text.includes("variables de entorno") && f.status !== "closed"), "el frente quedó en el EXPEDIENTE (la fuente), no solo en el Mapa");
  const map1 = orientationMap.maintainProjectMap(root, { steps: [], finalText: "", userText: "" });
  assert.ok(map1.openFronts.some((f) => f.text.includes("variables de entorno")), "el frente sobrevive al mantenimiento: está en los frentes abiertos del Mapa");

  const noted = await tools.execute("note_map_decision", { text: "Las releases se publican los lunes" }, root, true, {});
  assert.equal(noted.ok, true);
  assert.ok((threadMemory.loadProjectState(root).decisions || []).some((d) => String(d?.text || "").includes("los lunes")), "la decisión quedó en el expediente");

  const closedRes = await tools.execute("close_map_front", { text: "Revisar las variables de entorno en Vercel" }, root, true, {});
  assert.equal(closedRes.ok, true);
  assert.equal(closedRes.closed, true, "el cierre encontró el frente abierto");
  const map2 = orientationMap.maintainProjectMap(root, { steps: [], finalText: "", userText: "" });
  assert.ok(!map2.openFronts.some((f) => f.text.includes("variables de entorno")), "tras cerrar y mantener, el frente ya no se lista como abierto");
});
