"use strict";

// [EDITCORE-V500-A] FASE A — CACHÉ REAL Y DIETA DE TOKENS (v5.0.0).
// Prueba los cinco cambios del INFORME de medición (audit-fase-a-cache)
// y la ampliación de alcance de Luis: el harness de tokens como dueño
// único de la disciplina (comprobante entre turnos y dedupe viven en
// runtime/agent-token-harness.js) y la ESCRITURA JUSTA de archivos
// (no-op idéntico declarado; diff pequeño con nota de dirección).
//  (a) A1 system byte-idéntico entre turnos con distinta selección de
//      skills; las skills viajan en el último mensaje del usuario.
//  (b) A2 el payload del turno N+1 empieza byte-idéntico al del N en
//      el tramo de historial (registro verbatim append-only).
//  (c) A3 segunda lectura ENTRE turnos sin cambios ⇒ comprobante;
//      force:true ⇒ contenido; tras escritura ⇒ contenido nuevo.
//  (d) A4 breakpoints en system + último del historial, sin «rolling»;
//      compactación append-only con truncado idempotente.
//  (e) A5 dedupe: payload idéntico se sirve de la ResponseCache sin
//      llamar al proveedor.
//  (f) A5 la captura se retira del array tras juzgarse y queda su
//      dictamen en texto.
//  (g) write_file idéntico ⇒ no-op declarado, sin tocar el disco.
//  (h) write_file con diff pequeño ⇒ se aplica + nota a replace_in_file.
//  (i) write_file con cambio grande ⇒ sin nota de dirección.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v500-cache-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

// Visión falsa instalada ANTES de cargar el orquestador (tools.js
// desestructura la captura al cargar), como en vision-real-v491.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-fake-v500.png");
  fs.writeFileSync(abs, PNG_BYTES);
  return {
    ok: true,
    engine: "fake-v500",
    url: opts.url || "http://127.0.0.1:5442/",
    viewport: opts.viewport || "desktop",
    screenshotPath: ".editcore/vision/preview-fake-v500.png",
    screenshotAbs: abs,
    screenshotBytes: PNG_BYTES.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Taller Prueba"] },
    renderOk: true,
  };
};

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const tools = require("../editcore-chat-kernel/tools");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const tokenHarness = require("../runtime/agent-token-harness");
const { ResponseCache } = require("../response-cache");
const { withCacheControl } = require("../runtime/ai-core");
const { ContextCompactor } = require("../editcore-chat-kernel/context-compactor");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// callChat falso que consume un guion y (opcional) fotografía los
// payloads TAL CUAL salen (JSON en el momento de la llamada).
function scriptedHelpers(script, snapshots) {
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (snapshots) snapshots.push(JSON.stringify(args?.messages || []));
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers, count: () => calls };
}

function emptyProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-v500-proj-"));
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

// ---------------------------------------------------------------- (a)
test("A1: el system es byte-idéntico entre dos turnos con distinta selección de skills; las skills viajan en el último mensaje del usuario", async () => {
  const root = emptyProject();
  const snaps1 = [];
  const s1 = scriptedHelpers([{ text: "Un sitemap es el mapa de páginas del sitio.", toolCalls: [], usage: {} }], snaps1);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué es un sitemap en una web?", projectRoot: root,
    threadId: "hilo-a1", skillsPrompt: "SKILLS-TURNO-UNO", helpers: s1.helpers,
  });
  const snaps2 = [];
  const s2 = scriptedHelpers([{ text: "Un favicon es el icono de la pestaña.", toolCalls: [], usage: {} }], snaps2);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué es un favicon en una web?", projectRoot: root,
    threadId: "hilo-a1", skillsPrompt: "SKILLS-TURNO-DOS-DISTINTAS", helpers: s2.helpers,
  });

  const m1 = JSON.parse(snaps1[0]);
  const m2 = JSON.parse(snaps2[0]);
  assert.equal(m1[0].role, "system");
  assert.strictEqual(m1[0].content, m2[0].content, "el system no cambia ni un byte aunque cambie la selección de skills del turno");
  assert.doesNotMatch(m1[0].content, /SKILLS-TURNO/);
  const lastUser1 = m1.filter((m) => m.role === "user").pop();
  const lastUser2 = m2.filter((m) => m.role === "user").pop();
  assert.match(String(lastUser1.content), /SKILLS-TURNO-UNO/, "las skills del turno 1 van en su mensaje");
  assert.match(String(lastUser2.content), /SKILLS-TURNO-DOS-DISTINTAS/, "las skills del turno 2 van en su mensaje");
});

// ---------------------------------------------------------------- (b)
test("A2: el payload del turno N+1 empieza byte-idéntico al enviado en el N (historial verbatim append-only)", async () => {
  const root = emptyProject();
  const snaps1 = [];
  const s1 = scriptedHelpers([{ text: "Un sitemap es el mapa de páginas del sitio.", toolCalls: [], usage: {} }], snaps1);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué es un sitemap en una web?", projectRoot: root,
    threadId: "hilo-a2", helpers: s1.helpers,
  });
  const snaps2 = [];
  const s2 = scriptedHelpers([{ text: "Un favicon es el icono de la pestaña.", toolCalls: [], usage: {} }], snaps2);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué es un favicon en una web?", projectRoot: root,
    threadId: "hilo-a2", helpers: s2.helpers,
  });

  const m1 = JSON.parse(snaps1[0]);
  const m2 = JSON.parse(snaps2[0]);
  assert.ok(m2.length > m1.length, "el segundo turno trae historial además del mensaje nuevo");
  assert.strictEqual(
    JSON.stringify(m2.slice(0, m1.length)),
    JSON.stringify(m1),
    "el tramo de historial del turno N+1 es byte-idéntico al payload del turno N (sin re-adelgazar ni reescribir)",
  );
  assert.equal(m2[m1.length].role, "assistant");
  assert.equal(m2[m1.length].content, "Un sitemap es el mapa de páginas del sitio.", "la respuesta del turno N se conserva tal cual en el historial");
  assert.match(String(m2[m2.length - 1].content), /favicon/, "el mensaje nuevo cierra el payload");
});

// ---------------------------------------------------------------- (c)
const MARKER_C = "MARCA-ENTRE-TURNOS";
function projectWithNotesC() {
  const root = emptyProject();
  const lines = [`${MARKER_C} — primera línea con la marca`];
  for (let i = 2; i <= 30; i += 1) lines.push(`línea ${i} de relleno del archivo de notas`);
  fs.writeFileSync(path.join(root, "notas.txt"), `${lines.join("\n")}\n`);
  return root;
}

test("A3: la segunda lectura ENTRE turnos de un archivo sin cambios es un comprobante; force relee; tras escribir se lee el contenido nuevo", async () => {
  const root = projectWithNotesC();
  const runTurn = async (script, snapshots) => {
    const s = scriptedHelpers(script, snapshots);
    const orch = new ChatOrchestrator();
    const out = await orch.handle({
      ...BASE_ARGS, message: "trabaja con notas.txt según te voy indicando", projectRoot: root,
      threadId: "hilo-a3", helpers: s.helpers,
    });
    return out;
  };

  // Turno 1: lectura real ⇒ contenido + huella registrada en el expediente.
  const out1 = await runTurn([
    { text: "Leo el archivo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Ya lo leí.", toolCalls: [], usage: {} },
  ]);
  const read1 = (out1.steps || []).find((s) => s.name === "read_file");
  assert.ok(String(read1.result?.content || "").includes(MARKER_C), "la primera lectura trae el contenido");
  const receipts = (threadMemory.loadProjectState(root).readReceipts || []).filter((r) => r.file === "notas.txt");
  assert.equal(receipts.length, 1, "la huella de lectura quedó guardada en el expediente");
  assert.ok(receipts[0].size > 0 && receipts[0].mtimeMs > 0, "la huella guarda tamaño y mtime");

  // Turno 2 (otra instancia, mismo hilo): misma lectura ⇒ comprobante.
  const snaps2 = [];
  const out2 = await runTurn([
    { text: "Lo consulto otra vez.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Confirmado sin releer.", toolCalls: [], usage: {} },
  ], snaps2);
  const read2 = (out2.steps || []).find((s) => s.name === "read_file");
  assert.equal(read2.result?.alreadyReadInConversation, true, "la segunda lectura entre turnos es el comprobante del harness");
  assert.equal(read2.result?.content, undefined, "el comprobante no repite el contenido");
  assert.equal(read2.result?.totalLines, 30, "el comprobante declara las líneas que cubre");
  assert.ok(!snaps2.join("\n").includes(MARKER_C), "el contenido del archivo no volvió a entrar en ningún payload del turno 2");

  // Turno 3: force:true ⇒ contenido íntegro otra vez.
  const out3 = await runTurn([
    { text: "Lo releo forzado.", toolCalls: [toolCall("read_file", { path: "notas.txt", force: true })], usage: {} },
    { text: "Releído.", toolCalls: [], usage: {} },
  ]);
  const read3 = (out3.steps || []).find((s) => s.name === "read_file");
  assert.ok(String(read3.result?.content || "").includes(MARKER_C), "con force:true llega el contenido de disco");

  // Turno 4: una escritura invalida el comprobante ⇒ la lectura
  // siguiente trae el contenido NUEVO, no el comprobante.
  const out4 = await runTurn([
    { text: "Corrijo la marca.", toolCalls: [toolCall("replace_in_file", { path: "notas.txt", oldText: MARKER_C, newText: "MARCA-CORREGIDA-A3" })], usage: {} },
    { text: "Confirmo releyendo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Corregido y confirmado.", toolCalls: [], usage: {} },
  ]);
  const read4 = (out4.steps || []).filter((s) => s.name === "read_file").pop();
  assert.notEqual(read4.result?.alreadyReadInConversation, true, "tras escribir, la lectura no es el comprobante viejo");
  assert.ok(String(read4.result?.content || "").includes("MARCA-CORREGIDA-A3"), "la lectura tras la escritura trae el contenido nuevo");

  // Turno 5: la huella se refrescó con la lectura real del turno 4 ⇒
  // el comprobante vuelve a aplicar, ya sobre el contenido corregido.
  const out5 = await runTurn([
    { text: "Lo consulto de nuevo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Confirmado.", toolCalls: [], usage: {} },
  ]);
  const read5 = (out5.steps || []).find((s) => s.name === "read_file");
  assert.equal(read5.result?.alreadyReadInConversation, true, "con la huella refrescada, el comprobante vuelve a aplicar");
});

// ---------------------------------------------------------------- (d)
test("A4: withCacheControl marca system + último del historial (prefixEndIndex) y nada en el mensaje en curso; la compactación congela el prefijo y el truncado es idempotente", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "pedido uno" },
    { role: "assistant", content: "respuesta uno" },
    { role: "user", content: "pedido dos (en curso)" },
  ];
  const markedIdx = (list) => list
    .map((m, i) => (Array.isArray(m.content) && m.content.some((p) => p?.cache_control?.type === "ephemeral") ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(markedIdx(withCacheControl(msgs, { prefixEndIndex: 2 })), [0, 2], "system + último mensaje del historial");
  assert.deepEqual(markedIdx(withCacheControl(msgs)), [0, 1], "sin frontera: system + primer user (compatibilidad), nunca el último en curso");

  // Compactación append-only: el prefijo congelado sale con las
  // MISMAS referencias y sin tocar; el sufijo sí se compacta.
  const big = "X".repeat(25000);
  const convo = [
    { role: "system", content: "sys" },
    { role: "user", content: "pedido" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: big },
    { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t2", content: big },
  ];
  const compactor = new ContextCompactor();
  const frozen = compactor.compactMessages(convo, { frozenThrough: 4 });
  assert.strictEqual(frozen[3], convo[3], "el mensaje congelado (ya enviado) no se reescribe ni se clona");
  assert.ok(String(frozen[5].content).length < big.length, "el mensaje nuevo del sufijo sí se trunca");
  const once = compactor.compactMessages(convo);
  const twice = compactor.compactMessages(once);
  assert.strictEqual(
    JSON.stringify(twice.map((m) => m.content)),
    JSON.stringify(once.map((m) => m.content)),
    "truncar dos veces da lo mismo que truncar una (idempotente a la primera)",
  );
  assert.ok(String(once[3].content).length <= 10000, "el resultado truncado queda dentro del tope declarado");
});

// ---------------------------------------------------------------- (e)
test("A5: un payload idéntico se sirve de la ResponseCache (dedupe del harness) sin llamar al proveedor", async () => {
  const root = emptyProject();
  fs.writeFileSync(path.join(root, "README.md"), "# Proyecto de prueba\n\nStack: Node y Electron.\n");
  const sharedCache = new ResponseCache({ filePath: path.join(tmpBase, "dedupe-cache.json"), maxEntries: 50, maxBytes: 5 * 1024 * 1024, ttlMs: 60000 });
  let providerCalls = 0;
  const helpers = {
    responseCache: sharedCache,
    callChat: async () => {
      providerCalls += 1;
      return { text: "El proyecto usa Node y Electron.", toolCalls: [], usage: { prompt_tokens: 120, completion_tokens: 9 } };
    },
  };
  const ask = (threadId, message = "¿qué stack usa este proyecto?") => new ChatOrchestrator().handle({
    ...BASE_ARGS, message, projectRoot: root,
    threadId, helpers,
  });

  // Calentamiento con OTRA pregunta: crea el cerebro del proyecto y
  // estabiliza el contexto para que los dos turnos medidos ensamblen
  // el MISMO payload (es la condición real del dedupe: reintento o
  // doble envío de la misma pregunta), sin dejar una entrada servible
  // para la pregunta medida.
  await ask("hilo-dedupe-calentamiento", "¿cuántos archivos hay en el proyecto?");
  providerCalls = 0;

  const r1 = await ask("hilo-dedupe-1");
  const r2 = await ask("hilo-dedupe-2");
  assert.equal(providerCalls, 1, "la segunda respuesta salió de la caché local, no del proveedor");
  assert.match(String(r1.text || ""), /Node y Electron/);
  assert.match(String(r2.text || ""), /Node y Electron/, "la respuesta servida es la misma");
  if (r2.usage) assert.ok((r2.usage.local_cache_hits || 0) >= 1, "el acierto queda en las métricas del turno como caché local");
});

// ---------------------------------------------------------------- (f)
test("A5: la captura se retira del array tras juzgarse y queda su dictamen en texto (el PNG no se repaga en los pasos siguientes)", async () => {
  const root = emptyProject();
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<!DOCTYPE html><html><head><title>Taller Prueba</title></head><body><h1>Taller Prueba</h1><img src=\"assets/hero.jpg\" alt=\"hero\"></body></html>\n",
  );
  const snaps = [];
  const verdict = "Veredicto: en el hero se ve el taller con un mecánico trabajando; corresponde al negocio.";
  const s = scriptedHelpers([
    { text: "Capturo el preview para mirar.", toolCalls: [toolCall("capture_preview_screenshot", {})], usage: {} },
    { text: verdict, toolCalls: [toolCall("list_files", { path: "." })], usage: {} },
    { text: `${verdict} Cierro la revisión.`, toolCalls: [], usage: {} },
  ], snaps);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "revisa la landing y dime si las imágenes corresponden al negocio",
    projectRoot: root, helpers: s.helpers,
  });

  assert.ok(snaps.length >= 3, "el turno tuvo el paso posterior al veredicto");
  assert.ok(snaps[1].includes("image_url"), "la llamada que juzga SÍ recibió la imagen");
  assert.ok(!snaps[2].includes("image_url"), "tras juzgarse, el PNG ya no viaja en las llamadas siguientes");
  assert.ok(snaps[2].includes("se retiró del contexto"), "en su lugar queda la nota de retirada");
  assert.ok(snaps[2].includes("Dictamen registrado al verla"), "con la etiqueta del dictamen");
  assert.ok(snaps[2].includes("corresponde al negocio"), "y el dictamen del paso que la vio, en texto");
  assert.ok(String(out.text || "").includes("corresponde al negocio"), "el veredicto cierra el turno con normalidad");
});

// ------------------------------------------------------- (g, h, i)
test("Escritura justa 1: write_file con contenido idéntico al de disco es un no-op declarado (no escribe ni cuenta como escritura)", () => {
  tokenHarness.resetWriteDisciplineStats();
  const root = emptyProject();
  const file = path.join(root, "estable.txt");
  fs.writeFileSync(file, "contenido estable\n");
  const before = fs.statSync(file);
  const r = tools.writeFile(root, "estable.txt", "contenido estable\n");
  assert.equal(r.ok, true);
  assert.equal(r.unchanged, true);
  assert.equal(r.identicalNoop, true, "el resultado declara el no-op idéntico");
  assert.match(String(r.note || ""), /no-op idéntico/);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs, "el archivo NO se reescribió en disco");
  assert.equal(tokenHarness.writeDisciplineStats().identicalNoops, 1, "el caso queda contado en las métricas del harness");
});

test("Escritura justa 2: write_file sobre archivo existente con diff pequeño se aplica y trae la nota de dirección a replace_in_file", () => {
  tokenHarness.resetWriteDisciplineStats();
  const root = emptyProject();
  const lines = [];
  for (let i = 1; i <= 40; i += 1) lines.push(`línea ${i} del documento de prueba`);
  fs.writeFileSync(path.join(root, "doc.txt"), `${lines.join("\n")}\n`);
  const changed = lines.slice();
  changed[19] = "línea 20 CORREGIDA del documento de prueba";
  const r = tools.writeFile(root, "doc.txt", `${changed.join("\n")}\n`);
  assert.equal(r.ok, true);
  assert.match(String(r.directionNote || ""), /replace_in_file/, "el resultado dirige a replace_in_file para cambios parciales");
  assert.ok(r.diffStats && r.diffStats.touchedLines > 0 && r.diffStats.touchedLines < r.diffStats.totalLines / 2, "el diff medido es pequeño");
  assert.ok(fs.readFileSync(path.join(root, "doc.txt"), "utf8").includes("línea 20 CORREGIDA"), "el cambio SÍ se aplicó (la nota no bloquea)");
  assert.equal(tokenHarness.writeDisciplineStats().smallDiffFullWrites, 1, "el desperdicio queda contado para medirlo");
});

test("Escritura justa 3: write_file con cambio grande NO trae nota de dirección", () => {
  tokenHarness.resetWriteDisciplineStats();
  const root = emptyProject();
  const lines = [];
  for (let i = 1; i <= 20; i += 1) lines.push(`contenido original ${i}`);
  fs.writeFileSync(path.join(root, "grande.txt"), `${lines.join("\n")}\n`);
  const fresh = [];
  for (let i = 1; i <= 20; i += 1) fresh.push(`contenido totalmente nuevo ${i}`);
  const r = tools.writeFile(root, "grande.txt", `${fresh.join("\n")}\n`);
  assert.equal(r.ok, true);
  assert.equal(r.directionNote, undefined, "reescribir el archivo entero es el uso correcto de write_file: sin nota");
  assert.equal(tokenHarness.writeDisciplineStats().smallDiffFullWrites, 0);
  assert.equal(tokenHarness.writeDisciplineStats().fullWrites, 1);
});
