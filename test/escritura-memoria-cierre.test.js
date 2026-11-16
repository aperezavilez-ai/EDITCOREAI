"use strict";

// Batería — ÍTEM 5 DEL PLAN: CONTABILIDAD ÚNICA DE «APLICADO».
// EL FALSO POSITIVO «NADA QUEDÓ APLICADO» EN TURNOS DE MEMORIA.
// Caso real (ALFA LUBES, 2026-11-15, sobre la v5.2.0): el turno de
// corrección de memoria EJECUTÓ la tarea literal — asentó 4 decisiones
// con note_map_decision (ok:true) y verificó con comando que
// _check_env.py no existía — y aun así el kernel imprimió la nota de
// cierre B1 («no registró ninguna escritura… Nada quedó aplicado»),
// los hechos dijeron «El kernel no registró ninguna escritura aplicada
// en este turno» y el recibo repartió «aplicados 0». Causa (auditoría
// B24+B28): successfulWritePaths solo cuenta RUTAS de archivo
// (write_file, replace_in_file, scaffold_project) y el filtro estaba
// triplicado a mano (resumen de hechos, predicado de settleIteration y
// subagent-distill); las herramientas del Mapa son escritura desde la
// v5.1.3-W3 (classify.js, WRITE_TOOLS) pero no producen rutas y eran
// invisibles para esa contabilidad. El falso positivo induce al
// usuario a repetir el turno (quemar tokens otra vez por un trabajo
// ya aplicado).
// La corrección: UNA sola fuente de «aplicado» — el predicado de
// escritura compartido (isSuccessfulWriteStep), la contabilidad
// hermana successfulMemoryWrites (mutaciones de memoria EFECTIVAS
// desde la forma de retorno: note_map_decision ok recorded:"decision",
// open_map_front ok recorded:"front", close_map_front SOLO con
// closed === true — sin match no cambió nada y NO salva al turno de
// la nota — e ingest_to_brain ok con ingested > 0) y
// successfulExternalActions (publish_project / deploy_one_click /
// connect_project con ok) — consumida por la nota B1 (condición de
// triple vacío: archivos, memoria y acciones externas), los hechos,
// la declaración de término, la constancia, el destilado al Mapa y el
// predicado de settleIteration (que además cuenta run_command con ok
// cuando el turno es de tarea, EXECUTE). La garantía de honestidad no
// se debilita: sin archivos, sin memoria efectiva y sin acción
// externa, la nota sale como siempre. La línea «Aplicado:» de la
// rendición B4 sigue listando rutas (superficie fuera de alcance).
// El ÍTEM 4 ya había traído la publicación a los hechos y al
// destilado con su propia lectura; esta batería cubre lo que faltaba:
// la memoria en TODAS las superficies y el recibo (settleIteration)
// para memoria, publicación y comandos de tarea.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-cierre-memoria-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const {
  ChatOrchestrator,
  buildKernelFactSummary,
  substantiveFallbackText,
  successfulMemoryWrites,
  successfulExternalActions,
  nextStepsClosingText,
} = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const { distillTurnForBrain } = require("../editcore-chat-kernel/subagent-distill");

const BASE_ARGS = {
  apiKey: "sk-fake-cierre-memoria",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script) {
  let calls = 0;
  return {
    callChat: async () => {
      calls += 1;
      const step = script[Math.min(calls - 1, script.length - 1)];
      return typeof step === "function" ? step(calls) : step;
    },
  };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// El pedido del caso real, con su intención de mutación: asentar
// decisiones en el Mapa y dejar la memoria corregida.
const CORRECTION_TEXT = "Corrección de memoria del proyecto: asienta en el Mapa estas decisiones y déjalas asentadas: (1) la publicación a producción ya se hizo el 2026-11-14 con commit cc75c0a y el alias www.alfalubes.com está en vivo; (2) las variables de Vercel ya se cargaron en Production y el redespliegue quedó probado; (3) el .env está completo con prefijo MEAI_ y app.py lo resuelve en las líneas 46-48; (4) no existe ninguna regla de publicar los lunes, elimínala si el Mapa la trae. Al terminar dime qué quedó asentado.";

const DECISIONS = [
  "Publicación completada el 2026-11-14: commit cc75c0a en main, alias www.alfalubes.com en vivo, HTTP 200.",
  "Variables de Vercel cargadas en Production y redespliegue probado.",
  ".env completo con prefijo MEAI_; app.py lo resuelve en las líneas 46-48.",
  "Sin regla de publicar los lunes: nunca estuvo establecida.",
];

function step(name, result, input = {}) {
  return { name, input, result, ok: result?.ok !== false };
}

// ------------------------------------------------------------ unidades
test("(U1) successfulMemoryWrites: cuenta solo mutaciones de memoria EFECTIVAS", () => {
  assert.equal(typeof successfulMemoryWrites, "function", "la contabilidad de memoria existe como única fuente exportada");
  const eff = successfulMemoryWrites([
    step("note_map_decision", { ok: true, recorded: "decision", text: "d1" }),
    step("open_map_front", { ok: true, recorded: "front", text: "f1" }),
    step("close_map_front", { ok: true, recorded: "front_closed", closed: true, text: "f0" }),
    step("ingest_to_brain", { ok: true, ingested: 2, documents: ["a.md", "b.md"] }),
  ]);
  assert.equal(eff.length, 4, "las cuatro mutaciones efectivas cuentan");
  assert.deepEqual(eff.map((w) => w.kind), ["decision", "front", "front_closed", "brain_ingest"]);

  const notEff = successfulMemoryWrites([
    step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "sin match" }),
    step("note_map_decision", { ok: false, error: "sin autorización" }),
    step("open_map_front", { ok: false, error: "sin autorización" }),
    step("ingest_to_brain", { ok: false, ingested: 0, error: "sin documentos" }),
    step("write_file", { ok: true, path: "x.txt" }, { path: "x.txt" }),
    step("read_file", { ok: true, content: "..." }, { path: "x.txt" }),
  ]);
  assert.equal(notEff.length, 0, "closed:false, errores y archivos NO son mutaciones de memoria");
});

test("(U2) los hechos del kernel reconocen la memoria aplicada y no la declaran inexistente", () => {
  const facts = buildKernelFactSummary([
    step("note_map_decision", { ok: true, recorded: "decision", text: DECISIONS[0] }),
    step("note_map_decision", { ok: true, recorded: "decision", text: DECISIONS[3] }),
  ]);
  assert.ok(facts.includes("memoria del proyecto"), "los hechos traen la sección de memoria");
  assert.ok(facts.includes("Decisión asentada en el Mapa"), "las decisiones quedan asentadas como hecho");
  assert.ok(!facts.includes("no registró ninguna escritura aplicada"), "sin la línea falsa de cero escrituras");

  // Sin mutación efectiva (solo close sin match) + un comando de
  // evidencia que fuerza la impresión del resumen: la línea de cero
  // escrituras sigue saliendo, veraz.
  const factsNone = buildKernelFactSummary([
    step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "Publicación" }),
    step("build_project", { ok: true, code: 0 }),
  ]);
  assert.ok(factsNone.includes("El kernel no registró ninguna escritura aplicada en este turno."), "sin memoria efectiva, la línea de honestidad se conserva");
  assert.ok(!factsNone.includes("Decisión asentada en el Mapa"), "un close sin match no se disfraza de hecho aplicado");
});

test("(U3) la declaración de término y la constancia reconocen la memoria sin inflar archivos", () => {
  const root = emptyProject({ "package.json": PKG });
  const memSteps = [step("note_map_decision", { ok: true, recorded: "decision", text: DECISIONS[0] })];
  const decl = nextStepsClosingText(root, [], memSteps);
  assert.match(decl, /memoria del proyecto/, "la declaración nombra la memoria aplicada");
  assert.match(decl, /ningún archivo fue modificado/, "y declara el conteo de archivos en cero, sin inflarlo");
  assert.doesNotMatch(decl, /aplicados 1 archivo/, "jamás cuenta la memoria como archivo");

  const declNone = nextStepsClosingText(root, [], [step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "x" })]);
  assert.doesNotMatch(declNone, /mutación/, "sin mutación efectiva no hay declaración de memoria");

  const fallback = substantiveFallbackText(memSteps, []);
  assert.ok(!fallback.includes("Nada quedó aplicado"), "la constancia no declara vacío un turno que asentó memoria");
  assert.ok(fallback.includes("memoria del proyecto"), "la constancia declara lo asentado en memoria");

  const fallbackEmpty = substantiveFallbackText([], []);
  assert.ok(fallbackEmpty.includes("Nada quedó aplicado en este turno."), "sin nada aplicado, la constancia lo sigue diciendo");
});

test("(U4) successfulExternalActions: publicación/despliegue/conexión con ok cuentan; lo demás no", () => {
  assert.equal(typeof successfulExternalActions, "function", "la contabilidad de acciones externas existe como única fuente exportada");
  const eff = successfulExternalActions([
    step("publish_project", { ok: true, sha: "934b683", url: "https://example.invalid" }),
    step("deploy_one_click", { ok: true, url: "https://example.invalid" }),
    step("connect_project", { ok: true, url: "https://example.invalid" }),
  ]);
  assert.equal(eff.length, 3, "las tres acciones externas con ok cuentan");
  const notEff = successfulExternalActions([
    step("publish_project", { ok: false, error: "sin conexión" }),
    step("deploy_one_click", { ok: false, needsConfirmation: true }),
    step("write_file", { ok: true, path: "x.txt" }, { path: "x.txt" }),
    step("note_map_decision", { ok: true, recorded: "decision", text: "d" }),
    step("run_command", { ok: true, code: 0 }, { command: "node -e \"process.exit(0)\"" }),
  ]);
  assert.equal(notEff.length, 0, "fallos, archivos, memoria y comandos NO son acciones externas (el comando cuenta por otra vía: el predicado en turno de tarea)");
});

test("(U5) el destilado al Mapa de un turno de solo-memoria NO dice «Aplicado: nada»", () => {
  const out = distillTurnForBrain({
    userText: CORRECTION_TEXT,
    steps: [step("note_map_decision", { ok: true, recorded: "decision", text: DECISIONS[0] })],
    finalText: "Asenté la decisión en el Mapa.",
  });
  assert.ok(!out.includes("Aplicado: nada"), "el destilado no declara vacío un turno que asentó memoria");
  assert.ok(out.includes("memoria del proyecto"), "el destilado nombra lo aplicado en memoria");
  const outNone = distillTurnForBrain({
    userText: CORRECTION_TEXT,
    steps: [step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "x" })],
    finalText: "Cerré frentes.",
  });
  assert.ok(outNone.includes("Aplicado: nada"), "sin mutación efectiva, el destilado conserva su línea de vacío");
});

// ------------------------------------------------------------ (a)
test("(a) réplica del caso real: solo note_map_decision ok → sin nota B1 y los hechos reconocen las decisiones", async () => {
  const root = emptyProject({ "package.json": PKG });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: root, threadId: "hilo-cierre-memoria-a",
    helpers: scriptedHelpers([
      { text: "", toolCalls: DECISIONS.map((d) => toolCall("note_map_decision", { text: d })), usage: USAGE },
      { text: "Asenté en el Mapa las cuatro decisiones solicitadas, con su evidencia: publicación del 2026-11-14 con commit cc75c0a y alias en vivo, variables de Vercel cargadas con redespliegue probado, .env completo con prefijo MEAI_ resuelto en app.py líneas 46-48 y la inexistencia de la regla de publicar los lunes. Doy por terminada la corrección de memoria. Siguiente paso: pregúntame qué queda pendiente y te respondo desde el Mapa ya corregido.", toolCalls: [], usage: USAGE },
    ]),
  });
  const decisions = (res.steps || []).filter((s) => s.name === "note_map_decision");
  assert.equal(decisions.length, 4, "el turno asentó las 4 decisiones");
  assert.ok(decisions.every((s) => s.result?.ok === true && s.result?.recorded === "decision"), "las 4 quedaron registradas de verdad");
  const text = String(res.text || "");
  assert.ok(!text.includes("no registró ninguna escritura"), "NI la nota B1 NI la línea de hechos declaran cero escrituras");
  assert.ok(!text.includes("Nada quedó aplicado"), "el falso positivo del caso real no se repite");
  assert.ok(text.includes("Hechos del turno"), "el resumen de hechos acompaña al cierre");
  assert.ok(text.includes("Decisión asentada en el Mapa"), "los hechos reconocen las decisiones aplicadas");
  const map = orientationMap.getProjectMap(root);
  assert.ok((map.decisions || []).some((d) => /cc75c0a/.test(d.text)), "la decisión de la publicación consta en el Mapa real");
});

// ------------------------------------------------------------ (b)
test("(b) solo close_map_front con closed:false → la nota B1 SÍ sale (nada cambió)", async () => {
  const root = emptyProject({ "package.json": PKG });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: root, threadId: "hilo-cierre-memoria-b",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("close_map_front", { text: "Publicación a producción del sitio" }), toolCall("close_map_front", { text: "Variables de Vercel por cargar" })], usage: USAGE },
      { text: "Cerré los frentes indicados en el Mapa y la memoria del proyecto quedó corregida con la evidencia asentada. Doy por terminada la corrección de memoria. Siguiente paso: dime qué frente sigue.", toolCalls: [], usage: USAGE },
    ]),
  });
  const closes = (res.steps || []).filter((s) => s.name === "close_map_front");
  assert.ok(closes.length >= 1, "el turno intentó cerrar frentes");
  assert.ok(closes.every((s) => s.result?.closed === false), "ningún cierre casó: nada cambió de verdad");
  const text = String(res.text || "");
  assert.ok(text.includes("Nada quedó aplicado"), "sin mutación efectiva, la nota de honestidad SÍ se dispara");
  assert.ok(text.includes("no registró ninguna escritura"), "la nota B1 conserva su texto");
});

// ------------------------------------------------------------ (c)
test("(c) turno sin ninguna escritura que declara la tarea hecha → la nota sale como hoy", async () => {
  const root = emptyProject({ "package.json": PKG });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: root, threadId: "hilo-cierre-memoria-c",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: USAGE },
      { text: "Listo: la memoria del proyecto ya quedó corregida con todo lo pedido y las decisiones quedaron asentadas en el Mapa. Doy por terminada la corrección de memoria. Siguiente paso: dime qué frente sigue.", toolCalls: [], usage: USAGE },
    ]),
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(!names.includes("note_map_decision") && !names.includes("close_map_front"), "el turno no tocó el Mapa");
  const text = String(res.text || "");
  assert.ok(text.includes("Nada quedó aplicado"), "declarar sin hacer sigue recibiendo la nota");
});

// ------------------------------------------------------------ (d)
test("(d) turno con escritura de archivo normal → conducta sin cambios", async () => {
  const root = emptyProject({ "package.json": PKG });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Crea el archivo notas.txt en la raíz del proyecto con el texto «hola» y déjalo guardado.",
    projectRoot: root, threadId: "hilo-cierre-memoria-d",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "notas.txt", content: "hola\n" })], usage: USAGE },
      { text: "Creé el archivo notas.txt en la raíz del proyecto con el contenido pedido y quedó guardado en disco. Doy por terminada la tarea. Siguiente paso: dime qué sigue.", toolCalls: [], usage: USAGE },
    ]),
  });
  assert.equal(fs.readFileSync(path.join(root, "notas.txt"), "utf8"), "hola\n", "el archivo quedó escrito de verdad");
  const text = String(res.text || "");
  assert.ok(!text.includes("Nada quedó aplicado"), "con escritura real no hay nota");
  assert.ok(text.includes("en disco"), "los hechos siguen declarando la escritura en disco");
  assert.ok(!text.includes("mutación(es) en la memoria"), "sin mutaciones de memoria, la declaración no las inventa");
});

// ------------------------------------------------------------ (e)
test("(e) el recibo reparte los tokens del turno de solo-memoria como APLICADOS (y closed:false sigue en vueltas)", async () => {
  // Turno del caso real: la iteración que asentó las 4 decisiones
  // debe asentarse como APLICADA en el libro — el recibo ya no puede
  // decir «aplicados 0» de un turno que aplicó memoria.
  const rootA = emptyProject({ "package.json": PKG });
  const resA = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: rootA, threadId: "hilo-cierre-memoria-e1",
    helpers: scriptedHelpers([
      { text: "", toolCalls: DECISIONS.map((d) => toolCall("note_map_decision", { text: d })), usage: USAGE },
      { text: "Asenté en el Mapa las cuatro decisiones solicitadas, con su evidencia: publicación del 2026-11-14 con commit cc75c0a y alias en vivo, variables de Vercel cargadas con redespliegue probado, .env completo con prefijo MEAI_ resuelto en app.py líneas 46-48 y la inexistencia de la regla de publicar los lunes. Doy por terminada la corrección de memoria. Siguiente paso: pregúntame qué queda pendiente y te respondo desde el Mapa ya corregido.", toolCalls: [], usage: USAGE },
    ]),
  });
  assert.ok(resA.usage.applied_step_tokens >= USAGE.total_tokens, "la iteración de las decisiones contó como aplicada en el recibo (no «aplicados 0»)");
  assert.equal(resA.usage.applied_step_tokens + resA.usage.idle_step_tokens, resA.usage.total_tokens, "el reparto aplicados/en vueltas cubre el total del turno");

  // Contracaso: solo close_map_front con closed:false — nada cambió,
  // así que el recibo lo reparte TODO en vueltas, como antes.
  const rootB = emptyProject({ "package.json": PKG });
  const resB = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: rootB, threadId: "hilo-cierre-memoria-e2",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("close_map_front", { text: "Publicación a producción del sitio" }), toolCall("close_map_front", { text: "Variables de Vercel por cargar" })], usage: USAGE },
      { text: "Cerré los frentes indicados en el Mapa y la memoria del proyecto quedó corregida con la evidencia asentada. Doy por terminada la corrección de memoria. Siguiente paso: dime qué frente sigue.", toolCalls: [], usage: USAGE },
    ]),
  });
  assert.equal(resB.usage.applied_step_tokens, 0, "un close sin match NO cuenta como aplicado en el recibo");
  assert.equal(resB.usage.idle_step_tokens, resB.usage.total_tokens, "sin mutación efectiva, todo el turno queda en vueltas");
});

// ------------------------------------------------------------ (f)
test("(f) turno largo de solo-memoria: el libro de B4 no acumula pasos sin aplicar ni exige rendición espuria", async () => {
  const root = emptyProject({ "package.json": PKG });
  const DECISION_ITERS = 14; // por encima del umbral de atoro de B4 (12 pasos)
  const snapshots = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      snapshots.push(JSON.stringify(args?.messages || []));
      if (calls <= DECISION_ITERS) {
        return { text: "", toolCalls: [toolCall("note_map_decision", { text: `Decisión asentada número ${calls} del expediente del proyecto, con su evidencia registrada.` })], usage: USAGE };
      }
      return { text: "Asenté en el Mapa las catorce decisiones del expediente, una por una y con su evidencia. Doy por terminada la corrección de memoria del proyecto. Siguiente paso: pregúntame qué queda pendiente y te respondo desde el Mapa ya corregido.", toolCalls: [], usage: USAGE };
    },
  };
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: CORRECTION_TEXT,
    projectRoot: root, threadId: "hilo-cierre-memoria-f",
    helpers,
  });
  const decisions = (res.steps || []).filter((s) => s.name === "note_map_decision" && s.result?.ok === true);
  assert.equal(decisions.length, DECISION_ITERS, "las 14 decisiones se asentaron de verdad");
  assert.ok(!snapshots.some((snap) => snap.includes("RENDICIÓN DE AVANCE")), "el empujón de rendición de B4 NUNCA llegó al modelo: no hubo atoro real");
  assert.ok(!String(res.text || "").includes("Rendición de avance"), "el cierre no es la rendición determinista de B4");
  assert.ok(!res.progressStalled, "el turno no quedó marcado como atorado");
  assert.ok(res.usage.applied_step_tokens >= DECISION_ITERS * USAGE.total_tokens, "cada iteración de decisión contó aplicada en el libro (el contador de pasos sin aplicar no creció con ellas)");
});

// ------------------------------------------------------------ (g)
test("(g) turno de SOLO publicación: el recibo lo reparte como aplicado y no hay nota falsa", async () => {
  const root = emptyProject({ "package.json": PKG });
  const helpers = scriptedHelpers([
    { text: "", toolCalls: [toolCall("publish_project", {})], usage: USAGE },
    { text: "Ya quedó publicado: el commit 934b683aabbccddee0011223344556677889900 está en main y el despliegue quedó Ready en producción. Doy por terminada la publicación. Siguiente paso: verifica el sitio en vivo.", toolCalls: [], usage: USAGE },
  ]);
  helpers._externalImpls = {
    publishProject: async () => ({
      ok: true,
      sha: "934b683aabbccddee0011223344556677889900",
      branch: "main",
      url: "https://www.alfalubes.com",
      deploymentId: "dpl_FixtureItem5",
      steps: [],
      message: "Publicación completada (fixture del ÍTEM 5).",
    }),
  };
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Publica este proyecto",
    projectRoot: root, threadId: "hilo-cierre-memoria-g",
    helpers,
  });
  const pub = (res.steps || []).find((s) => s.name === "publish_project");
  assert.ok(pub && pub.result?.ok === true, "el turno publicó de verdad (impl inyectada)");
  assert.ok(res.usage.applied_step_tokens >= USAGE.total_tokens, "la iteración de publicación contó como aplicada en el recibo");
  assert.ok(!String(res.text || "").includes("Nada quedó aplicado"), "un turno que publicó no recibe la nota de vacío");
});

// ------------------------------------------------------------ (h)
test("(h) turno de tarea con solo run_command ok: el recibo lo reparte como aplicado", async () => {
  const root = emptyProject({ "package.json": PKG });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Ejecuta con run_command la verificación del entorno: corre el comando node -e \"process.exit(0)\" y dime el resultado.",
    projectRoot: root, threadId: "hilo-cierre-memoria-h",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("run_command", { command: "node -e \"process.exit(0)\"" })], usage: USAGE },
      { text: "El comando de verificación terminó con código 0, sin errores: el entorno responde. Doy por terminada la verificación. Siguiente paso: dime qué sigue.", toolCalls: [], usage: USAGE },
    ]),
  });
  const cmd = (res.steps || []).find((s) => s.name === "run_command");
  assert.ok(cmd && cmd.result?.ok === true, "el comando corrió y salió ok");
  assert.ok(res.usage.applied_step_tokens >= USAGE.total_tokens, "en un turno de tarea (EXECUTE), un run_command con ok cuenta como aplicado en el recibo");
});
