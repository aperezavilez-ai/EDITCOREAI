"use strict";

// Batería v5.1.7 — M3: dieta de los turnos de TAREA (EXECUTE) sin
// tocar lo blindado (medición MEDICION-M3: la zona de pasos se
// recompra ×16,4; la frontera de caché quedaba congelada en la
// apertura; el verbatim crecía sin cota entre turnos):
//  (a) C2 stubs progresivos: un resultado con ≥6 pasos más nuevos
//      queda stubbeado UNA sola vez, con el emparejamiento
//      tool_call_id intacto y la vía de relectura declarada; uno
//      dentro de la ventana de 6 pasos queda íntegro; un turno que
//      NO es EXECUTE (ANALYZE, mismo bucle) no stubbea nada; los
//      steps — la fuente de los hechos del kernel — conservan el
//      resultado íntegro aunque el mensaje ya sea stub.
//  (b) C3 presupuesto de verbatim SOLO en aperturas EXECUTE: con 16
//      intercambios sembrados, la apertura de tarea queda bajo el
//      presupuesto con marca de remisión al expediente/Mapa; la
//      apertura ASK sobre el mismo hilo viaja con el historial
//      COMPLETO y sin marca (el carril queda byte-idéntico: la
//      puerta es por clase y ASK nunca pasa el presupuesto).
//  (c) C1 breakpoint creciente: la frontera pasada al proveedor en
//      cada llamada es el índice del último mensaje de ESA llamada
//      (messages.length - 1), avanza con el turno y ningún mensaje
//      del kernel sale marcado (la marca vive en la capa del
//      proveedor, no en el contenido).
//  (d) C4 skills solo-ids en EXECUTE — APLICADA en la v5.1.7 con
//      la re-delimitación de dieta-ask-v512 (iii)→(iii-bis)
//      aprobada por Lu (2026-11-13): la premisa v5.1.2 era una
//      cautela de diseño, no un comportamiento aprobado en vivo, y
//      la medición M3 preció los extractos en 180.852 caracteres
//      por turno escenario (~5,7 %). Este caso la fija contra la
//      aplicación real: en EXECUTE el catálogo viaja con ids y SIN
//      «Extracto:», read_skill sigue en el set y el set completo
//      de herramientas se conserva.
//  (e) Comparativo con el método de la medición (mismo guion de 28
//      pasos, mismo hilo «old» de 6 intercambios, mismos tamaños
//      sembrados): el turno baja de 3.158.770 caracteres a
//      ≤2.250.000 (−29 %). La cota de diseño ≤2.100.000 presuponía
//      el ahorro de C4 estimado por la medición (180.852 car =
//      delta crudo del catálogo × 28 llamadas); la medición directa
//      con C4 aplicada y retirada (flip sobre este mismo escenario)
//      lo corrige: en esta apertura PESADA el presupuesto agregado
//      del contexto del turno ya recortaba el bloque de skills con
//      extractos (tier NORMAL) hasta casi el tamaño del de ids, y
//      el ahorro real de C4 aquí es ~1.600 caracteres en el turno.
//      El ahorro completo de C4 (~6.500 car por llamada) sí se da
//      en aperturas ligeras, donde el bloque viaja entero — probado
//      por flip sobre el fixture de (d): 17.309 → 10.688 car en la
//      primera llamada. La cota honesta de ESTE escenario queda en
//      2.250.000 y el informe de construcción registra la corrección
//      de la estimación.
//  (f) C5: el tope de run_command es 6.000 y el corte conserva la
//      política cabeza+cola con elipsis declarada, con el error y
//      la cola del payload presentes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v517-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

// Capa usuario del Mapa sembrada a tamaño realista (la misma de la
// medición M3, para que el escenario (e) sea comparable).
fs.mkdirSync(path.join(process.env.HOME, ".editcore"), { recursive: true });
fs.writeFileSync(path.join(process.env.HOME, ".editcore", "orientation-map-user.json"), JSON.stringify({
  version: 1,
  who: { name: "Luis", notes: "Trabaja en español y juzga en vivo en su máquina Windows." },
  rules: [1, 2, 3, 4, 5, 6].map((i) => ({ text: `Regla permanente ${i}: no cerrar trabajo sin verificación real y evidencia citada en el propio turno de trabajo.`, at: "2026-11-10" })),
  preferences: [{ text: "Paquetes consolidados: una sola publicación por frente, sin parches sueltos." }],
  projects: [{ name: "ALFA LUBES", state: "en curso" }, { name: "VIXERAI", state: "en curso" }, { name: "TALLE PRUEBA", state: "banco de pruebas" }],
}, null, 2));

// Visión falsa ANTES de cargar el orquestador (patrón de la
// medición): la captura del escenario (e) no necesita un navegador.
const TREE = path.resolve(__dirname, "..");
const PNG = Buffer.alloc(120_000, 7);
Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64").copy(PNG, 0);
const vision = require(path.join(TREE, "editcore-chat-kernel/vision-inspector"));
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-m3.png");
  fs.writeFileSync(abs, PNG);
  return {
    ok: true, engine: "fake-v517", url: opts.url || "http://127.0.0.1:5442/", viewport: "desktop",
    screenshotPath: ".editcore/vision/preview-m3.png", screenshotAbs: abs, screenshotBytes: PNG.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Panel"] }, renderOk: true,
  };
};

const { ChatOrchestrator, stubAgedToolResults, TOOL_STUB_SENTINEL } = require("../editcore-chat-kernel/orchestrator");
const threadCore = require("../editcore-chat-kernel/thread-core");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const tools = require("../editcore-chat-kernel/tools");

const BASE_ARGS = {
  apiKey: "sk-test",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// callChat falso que captura mensajes, herramientas Y la frontera
// de caché tal cual salen del kernel en cada llamada.
function capturingHelpers(script, captures) {
  const queue = [...script];
  return {
    callChat: async (args) => {
      captures.push({
        messages: JSON.parse(JSON.stringify(args?.messages || [])),
        tools: JSON.parse(JSON.stringify(args?.tools || [])),
        cachePrefixEndIndex: args?.cachePrefixEndIndex,
      });
      return queue.shift() || { text: "Listo.", toolCalls: [], usage: USAGE };
    },
    brainSearch: async () => ([
      { text: "Recuerdo del Cerebro A: el módulo de interfaz usa el sistema de diseño vigente y su verificación es build más captura del preview activo del IDE.".repeat(3) },
      { text: "Recuerdo del Cerebro B: los frentes abiertos del proyecto están registrados en el expediente con procedencia de informes de subagentes.".repeat(3) },
    ]),
  };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v517-proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const msgChars = (m) => JSON.stringify(m).length;

// ------------------------------------------------------------- (a1)
test("(a1) stub unitario: ≥6 pasos más nuevos ⇒ stub una sola vez, emparejamiento intacto; ventana y resultados cortos intactos", () => {
  const mk = (k, size) => ([
    { role: "assistant", content: null, tool_calls: [{ id: `call_${k}`, type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: `call_${k}`, name: "read_file", content: JSON.stringify({ ok: true, path: `src/f${k}.js`, content: `MARCA-${k} ` + "x".repeat(size) }) },
  ]);
  const messages = [{ role: "system", content: "sys" }, { role: "user", content: "tarea" }];
  const originals = new Map();
  for (let k = 1; k <= 9; k += 1) {
    const pair = mk(k, 2400);
    originals.set(`call_${k}`, pair[1].content);
    messages.push(...pair);
  }
  const stubbed = stubAgedToolResults(messages);
  assert.equal(stubbed, 3, "se stubbean exactamente los 3 resultados con ≥6 pasos más nuevos (pasos 1-3 de 9)");
  const toolMsgs = messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 9, "ningún mensaje tool desaparece: solo cambia su contenido");
  // Emparejamiento: cada tool sigue respondiendo a su llamada.
  const callIds = new Set(messages.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((c) => c.id) : [])));
  for (const m of toolMsgs) assert.ok(callIds.has(m.tool_call_id), `el resultado ${m.tool_call_id} conserva su llamada`);
  for (let k = 1; k <= 9; k += 1) {
    const m = toolMsgs[k - 1];
    if (k <= 3) {
      assert.ok(m.content.startsWith(TOOL_STUB_SENTINEL), `el resultado del paso ${k} es stub`);
      assert.ok(m.content.includes("read_file"), "el stub nombra la herramienta");
      assert.ok(m.content.includes(String(originals.get(`call_${k}`).length)), "el stub declara el tamaño original");
      assert.ok(m.content.includes("force:true"), "el stub declara la vía de relectura (force)");
      assert.ok(m.content.includes(`src/f${k}.js`), "el stub conserva el titular útil (la ruta del archivo)");
      assert.ok(m.content.length < originals.get(`call_${k}`).length, "el stub es más breve que el original");
    } else {
      assert.strictEqual(m.content, originals.get(`call_${k}`), `el resultado del paso ${k} (dentro de la ventana) queda íntegro`);
    }
  }
  // Una sola vez: la segunda pasada no vuelve a tocar nada.
  const snapshot = JSON.stringify(messages);
  assert.equal(stubAgedToolResults(messages), 0, "la segunda pasada no re-stubbea");
  assert.strictEqual(JSON.stringify(messages), snapshot, "los stubs son estables byte a byte");
  // Un resultado corto NUNCA se stubbea (el stub sería más largo).
  const short = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
  for (let k = 1; k <= 7; k += 1) {
    short.push({ role: "assistant", content: null, tool_calls: [{ id: `s${k}`, type: "function", function: { name: "read_file", arguments: "{}" } }] });
    short.push({ role: "tool", tool_call_id: `s${k}`, name: "read_file", content: k === 1 ? "corto" : "y".repeat(900) });
  }
  assert.equal(stubAgedToolResults(short), 0, "el único candidato (paso 1) es más corto que su stub: queda intacto");
  assert.strictEqual(short[3].content, "corto", "el contenido corto no se sustituye");
});

// ------------------------------------------------------------- (a2)
test("(a2) en un turno EXECUTE real los resultados viejos viajan como stub y los steps conservan el resultado íntegro", async () => {
  const files = { "package.json": JSON.stringify({ name: "demo" }) };
  for (let k = 1; k <= 9; k += 1) {
    files[`src/f${k}.js`] = `// módulo ${k}\n` + `export const dato${k} = "MARCA-F${k} " + "${"relleno del módulo para la pasada de revisión ".repeat(40)}";\n`;
  }
  const root = emptyProject(files);
  const script = [];
  for (let k = 1; k <= 4; k += 1) script.push({ text: "", toolCalls: [toolCall("read_file", { path: `src/f${k}.js` })], usage: USAGE });
  script.push({ text: "", toolCalls: [toolCall("write_file", { path: "src/resumen.txt", content: "resumen de la pasada\n" })], usage: USAGE });
  for (let k = 5; k <= 9; k += 1) script.push({ text: "", toolCalls: [toolCall("read_file", { path: `src/f${k}.js` })], usage: USAGE });
  script.push({ text: "Pasada terminada: leí los nueve archivos, dejé el resumen en src/resumen.txt y doy la tarea por terminada; como siguiente paso propongo revisar el rendimiento.", toolCalls: [], usage: USAGE });
  const captures = [];
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Lee los nueve archivos del módulo (src/f1.js a src/f9.js), crea el archivo src/resumen.txt con el resumen de la pasada y verifica que quedó bien.",
    projectRoot: root, threadId: "hilo-v517-a2", helpers: capturingHelpers(script, captures),
  });
  assert.ok(captures.length >= 8, `el turno hizo sus llamadas (capturas: ${captures.length})`);
  const last = captures[captures.length - 1];
  const toolMsgs = last.messages.filter((m) => m.role === "tool");
  const stubbed = toolMsgs.filter((m) => typeof m.content === "string" && m.content.startsWith(TOOL_STUB_SENTINEL));
  assert.ok(stubbed.length >= 2, `en la última llamada los resultados viejos ya viajan como stub (stubs: ${stubbed.length})`);
  const callIds = new Set(last.messages.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((c) => c.id) : [])));
  for (const m of toolMsgs) assert.ok(callIds.has(m.tool_call_id), "el emparejamiento llamada/resultado se conserva en el payload real");
  assert.ok(!JSON.stringify(captures[0].messages).includes(TOOL_STUB_SENTINEL), "en la primera llamada no hay nada viejo que stubbear");
  // Los hechos del kernel leen los steps, no los mensajes: el step
  // de la primera lectura conserva el resultado ÍNTEGRO.
  const readSteps = (res.steps || []).filter((s) => s.name === "read_file");
  assert.ok(readSteps.length >= 5, "el turno registró sus lecturas en steps");
  assert.ok(!JSON.stringify(readSteps[0].result || {}).includes(TOOL_STUB_SENTINEL), "el step conserva el resultado real, no el stub");
  assert.ok(JSON.stringify(readSteps[0].result || {}).includes("MARCA-F1"), "el step conserva el contenido leído íntegro");
});

// ------------------------------------------------------------- (a3)
test("(a3) un turno ANALYZE por el mismo bucle NO stubbea nada (la dieta es solo EXECUTE)", async () => {
  const files = { "package.json": JSON.stringify({ name: "demo" }) };
  for (let k = 1; k <= 8; k += 1) {
    files[`src/f${k}.js`] = `// módulo ${k}\n` + `export const dato${k} = "MARCA-F${k} " + "${"relleno del módulo para el análisis ".repeat(40)}";\n`;
  }
  const root = emptyProject(files);
  const script = [];
  for (let k = 1; k <= 8; k += 1) script.push({ text: "", toolCalls: [toolCall("read_file", { path: `src/f${k}.js` })], usage: USAGE });
  script.push({ text: "Análisis terminado: revisé los ocho archivos; el estado del proyecto queda descrito y el pendiente principal es verificar el módulo 1.", toolCalls: [], usage: USAGE });
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "analiza el estado actual del proyecto y dime qué queda pendiente",
    projectRoot: root, threadId: "hilo-v517-a3", helpers: capturingHelpers(script, captures),
  });
  assert.ok(captures.length >= 6, `el análisis hizo sus llamadas (capturas: ${captures.length})`);
  for (const cap of captures) {
    assert.ok(!JSON.stringify(cap.messages).includes(TOOL_STUB_SENTINEL), "ningún payload de ANALYZE lleva stubs");
  }
  const last = captures[captures.length - 1];
  assert.ok(JSON.stringify(last.messages).includes("MARCA-F1"), "el resultado más viejo viaja ÍNTEGRO al cierre del análisis");
});

// ------------------------------------------------------------- (b1)
test("(b1) applyVerbatimBudget: ventana contigua por la cola bajo ambos topes, con conteo de omitidos", () => {
  const mkHist = (n, userChars, asstChars) => {
    const hist = [];
    for (let i = 1; i <= n; i += 1) {
      hist.push({ role: "user", content: `pregunta ${i} ` + "u".repeat(userChars) });
      hist.push({ role: "assistant", content: `respuesta ${i} ` + "a".repeat(asstChars) });
    }
    return hist;
  };
  // 16 intercambios de ~1.400: manda el tope de 4 intercambios.
  const big = threadCore.applyVerbatimBudget(mkHist(16, 100, 1300), threadCore.EXECUTE_VERBATIM_BUDGET);
  assert.equal(big.droppedExchanges, 12, "se omiten 12 de 16 intercambios");
  assert.equal(big.messages.filter((m) => m.role === "user").length, 4, "quedan los últimos 4 intercambios");
  assert.ok(big.messages[0].content.startsWith("pregunta 13"), "la ventana abre en el intercambio 13");
  assert.ok(big.messages.reduce((a, m) => a + m.content.length, 0) <= 10_000, "el contenido retenido cabe en el presupuesto");
  // 6 intercambios pesados: manda el tope de caracteres.
  const heavy = threadCore.applyVerbatimBudget(mkHist(6, 100, 2900), threadCore.EXECUTE_VERBATIM_BUDGET);
  assert.ok(heavy.messages.reduce((a, m) => a + m.content.length, 0) <= 10_000, "con intercambios de 3.000 el tope de caracteres manda");
  assert.ok(heavy.droppedExchanges >= 3, "se omiten al menos 3 intercambios pesados");
  assert.ok(heavy.messages[heavy.messages.length - 2].content.startsWith("pregunta 6"), "el último intercambio entra SIEMPRE entero");
  // Bajo presupuesto: identidad total (ni marca ni recorte aguas arriba).
  const small = mkHist(3, 100, 1300);
  const untouched = threadCore.applyVerbatimBudget(small, threadCore.EXECUTE_VERBATIM_BUDGET);
  assert.equal(untouched.droppedExchanges, 0, "bajo presupuesto no se omite nada");
  assert.strictEqual(untouched.messages, small, "bajo presupuesto la selección es la misma referencia");
});

function seedLongThread(root, threadId, exchanges) {
  for (let i = 1; i <= exchanges; i += 1) {
    threadMemory.appendVerbatimTurn(root, threadId, [
      { role: "user", content: `Turno previo ${i}: revisa el módulo ${i} de la interfaz y dime qué encontraste, sin tocar nada todavía.` },
      { role: "assistant", content: (`En el turno ${i} revisé el módulo correspondiente y confirmé su estructura principal, sus secciones y el estado de la verificación anterior. `).repeat(4).slice(0, 1200) },
    ]);
  }
}

// ------------------------------------------------------------- (b2)
test("(b2) apertura EXECUTE con 16 intercambios: historial bajo presupuesto y con marca de remisión", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedLongThread(root, "hilo-v517-b2", 16);
  const seededCount = threadMemory.verbatimMessages(root, "hilo-v517-b2").length;
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Haz una pasada de corrección sobre los módulos de la interfaz, aplica los cambios necesarios y verifica con el build.",
    projectRoot: root, threadId: "hilo-v517-b2", helpers: capturingHelpers([{ text: "Listo.", toolCalls: [], usage: USAGE }], captures),
  });
  assert.ok(captures.length >= 1, "la apertura llegó al modelo");
  const msgs = captures[0].messages;
  const history = msgs.slice(1, msgs.length - 1);
  const historyChars = history.reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : msgChars(m)), 0);
  assert.ok(historyChars <= 10_300, `el historial de apertura cabe en el presupuesto + la marca (fueron ${historyChars})`);
  const historyText = history.map((m) => String(m.content || "")).join("\n");
  assert.ok(historyText.includes("Historial acotado por presupuesto de apertura"), "la marca declarada viaja en el primer mensaje retenido");
  assert.ok(historyText.includes("expediente") && historyText.includes("Mapa de orientación"), "la marca remite al expediente y al Mapa");
  assert.ok(historyText.includes("Turno previo 16:"), "el intercambio más reciente SÍ viaja");
  assert.ok(!historyText.includes("Turno previo 1:"), "el intercambio más antiguo quedó fuera");
  // El registro en disco NO se toca: solo cambia la selección. (El
  // +2 es el intercambio del propio turno, que se archiva al cerrar
  // como siempre; las 32 entradas sembradas siguen todas.)
  const afterDisk = threadMemory.verbatimMessages(root, "hilo-v517-b2");
  assert.equal(afterDisk.length, seededCount + 2, "el registro verbatim sigue íntegro en disco (solo se anexa el turno)");
  assert.ok(String(afterDisk[0].content).includes("Turno previo 1:"), "la entrada más antigua del registro sigue en disco");
});

// ------------------------------------------------------------- (b3)
test("(b3) apertura ASK sobre el mismo hilo largo: historial COMPLETO y sin marca (el carril no se toca)", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  orientationMap.openMapFront(root, "Publicar la landing del taller", "prueba v5.1.7");
  orientationMap.openMapFront(root, "Corregir el cobro con tarjeta", "prueba v5.1.7");
  seedLongThread(root, "hilo-v517-b3", 16);
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v517-b3",
    helpers: capturingHelpers([{ text: "Quedan dos pendientes.", toolCalls: [], usage: USAGE }], captures),
  });
  assert.ok(captures.length >= 1, "la pregunta llegó al modelo");
  const payload = JSON.stringify(captures[0].messages);
  assert.ok(!payload.includes("Historial acotado por presupuesto"), "en ASK NO viaja la marca del presupuesto");
  assert.ok(payload.includes("Turno previo 1:"), "en ASK viaja el historial completo, desde el primer intercambio");
  assert.ok(payload.includes("Turno previo 16:"), "en ASK también viaja el más reciente");
});

// --------------------------------------------------------------- (c)
test("(c) la frontera de caché pasada al proveedor es el último mensaje de CADA llamada y avanza con el turno", async () => {
  const files = { "package.json": JSON.stringify({ name: "demo" }) };
  for (let k = 1; k <= 5; k += 1) files[`src/f${k}.js`] = `export const dato${k} = ${k};\n`;
  const root = emptyProject(files);
  const script = [];
  for (let k = 1; k <= 5; k += 1) script.push({ text: "", toolCalls: [toolCall("read_file", { path: `src/f${k}.js` })], usage: USAGE });
  script.push({ text: "", toolCalls: [toolCall("write_file", { path: "src/resumen.txt", content: "f1 a f5 revisados\n" })], usage: USAGE });
  script.push({ text: "Tarea terminada: leí los cinco archivos, dejé el resumen en src/resumen.txt y doy la tarea por terminada; siguiente paso sugerido: verificar el build.", toolCalls: [], usage: USAGE });
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Lee los archivos src/f1.js a src/f5.js del proyecto, crea el archivo src/resumen.txt con lo que contiene cada uno y verifica que quedó bien.",
    projectRoot: root, threadId: "hilo-v517-c", helpers: capturingHelpers(script, captures),
  });
  const withIndex = captures.filter((cap) => Number.isInteger(cap.cachePrefixEndIndex));
  assert.ok(withIndex.length >= 5, `las llamadas del bucle llevan frontera (fueron ${withIndex.length})`);
  for (const cap of withIndex) {
    assert.equal(cap.cachePrefixEndIndex, cap.messages.length - 1, "la frontera es el índice del último mensaje enviado en esa llamada");
    assert.ok(!JSON.stringify(cap.messages).includes("cache_control"), "ningún mensaje del kernel sale marcado: la marca vive en la capa del proveedor");
  }
  assert.ok(withIndex[withIndex.length - 1].cachePrefixEndIndex > withIndex[0].cachePrefixEndIndex, "la frontera AVANZA con el turno (no queda congelada en la apertura)");
});

// --------------------------------------------------------------- (d)
test("(d) C4: en un turno EXECUTE el catálogo de skills viaja solo con ids (sin extractos); read_skill disponible y set completo conservado", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea el archivo saludo.txt con el texto hola",
    projectRoot: root, threadId: "hilo-v517-d",
    helpers: capturingHelpers([{ text: "Creé el archivo saludo.txt con el saludo.", toolCalls: [], usage: USAGE }], captures),
  });
  assert.ok(captures.length >= 1, "el turno de ejecución llegó al modelo");
  const payload = JSON.stringify(captures[0].messages);
  assert.ok(payload.includes("SKILLS VÁLIDAS EN DISCO"), "en EXECUTE el catálogo viaja (con los ids de todas las skills)");
  assert.ok(!payload.includes("Extracto:"), "en EXECUTE el catálogo NO trae extractos de skills (C4)");
  const execTools = captures[0].tools.map((t) => t.function?.name || t.name);
  assert.ok(execTools.includes("read_skill"), "read_skill sigue disponible como vía de escape bajo demanda");
  assert.ok(execTools.includes("write_file"), "el turno de ejecución conserva el set completo (write_file visible)");
});

// --------------------------------------------------------------- (f)
test("(f) C5: run_command topa en 6.000 con cabeza+cola, elipsis declarada y el error/cola preservados", () => {
  assert.equal(tools.TOOL_PAYLOAD_CAPS.run_command, 6000, "el tope declarado de run_command es 6.000");
  assert.equal(tools.TOOL_PAYLOAD_CAPS.build_project, 12000, "los demás topes no se tocan (build_project sigue en 12.000)");
  const payload = {
    ok: false, code: 1, error: "ERROR-CRITICO-V517 al final del comando",
    stderr: "inicio de stderr\n" + "e".repeat(3000),
    output: "o".repeat(6000) + "\nCOLA-FINAL-V517",
  };
  const text = tools.truncatePayload(payload, undefined, "run_command");
  assert.ok(text.length <= 6000, `el payload truncado cabe en el tope (fueron ${text.length})`);
  assert.ok(text.includes("caracteres omitidos"), "el corte declara su elipsis con el conteo");
  assert.ok(text.includes("ERROR-CRITICO-V517"), "el campo de error (crítico, primero en la forma) sobrevive al corte");
  assert.ok(text.includes("COLA-FINAL-V517"), "la cola del payload sobrevive al corte cabeza+cola");
});

// --------------------------------------------------------------- (e)
// Réplica fiel del escenario «old» de MEDICION-M3 (mismo fixture,
// mismas semillas, mismo guion de 28 pasos, mismo método de conteo:
// Σ sobre las primeras 28 llamadas de Σ JSON.stringify(mensaje) +
// JSON.stringify(herramientas)). La línea base medida sobre la
// v5.1.6 fue 3.158.770 caracteres.
test("(e) comparativo M3: el turno de 28 pasos con hilo de 6 intercambios baja de 3.158.770 a ≤2.250.000 caracteres", async () => {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-e-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "m3-demo", scripts: { build: "node -e \"console.log('build ok: 45 modules')\"" } }, null, 2));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><html><body><div id='app'>Panel</div></body></html>\n");
  for (let i = 1; i <= 12; i += 1) {
    const nn = String(i).padStart(2, "0");
    const body = [`// módulo de interfaz ${nn} — fixture M3`];
    for (let j = 0; j < 95; j += 1) body.push(`export const dato_${nn}_${j} = "valor de relleno realista ${nn}-${j} para el módulo de interfaz";`);
    fs.writeFileSync(path.join(root, "src", `module-${nn}.js`), body.join("\n") + "\n");
  }
  const threadId = "hilo-v517-e";
  const decisions = [1, 2, 3, 4, 5].map((i) => ({ t: Date.now(), text: `Decisión ${i}: la interfaz usa el sistema de diseño vigente y se verifica con build y captura antes de cerrar cualquier frente del proyecto.` }));
  const notes = [1, 2, 3, 4, 5].map((i) => ({ t: Date.now(), text: `Nota ${i}: queda registrado el estado del módulo ${i} y su verificación previa en el expediente para no re-explorarlo.` }));
  const facts = [];
  for (let i = 1; i <= 12; i += 1) facts.push({ kind: "section", file: `src/module-${String(i).padStart(2, "0")}.js`, name: `Seccion${String(i).padStart(2, "0")}`, relation: "contiene", t: Date.now() });
  const fronts = [1, 2, 3].map((i) => ({ t: Date.now(), text: `Frente ${i}: pulir el módulo ${i} de la interfaz y verificarlo con build`, source: "informe de subagente", status: "open" }));
  threadMemory.saveProjectState(root, {
    objective: "Aplicación web de gestión con interfaz por módulos; el objetivo vigente es corregir y verificar cada módulo sin re-explorar lo ya comprobado.",
    workingOn: "corrección previa de la interfaz",
    decisions, notes, facts, fronts,
    files: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ rel: `src/module-${String(i).padStart(2, "0")}.js`, action: "modified", at: Date.now() })),
    verified: [{ t: Date.now(), text: "build en verde verificado en el turno anterior con salida real del comando" }],
    discarded: [{ t: Date.now(), text: "hipótesis del CSS global descartada por evidencia del build anterior" }],
  });
  orientationMap.saveProjectMap(root, {
    version: 1, purpose: "Aplicación web de gestión con interfaz por módulos; corrección verificada por frente.",
    state: "[2026-11-13] Aplicado: corrección del módulo previo · Verificación: build en verde y captura revisada",
    decisions: decisions.map((d) => ({ text: d.text, at: "2026-11-12", source: "expediente del proyecto" })),
    openFronts: fronts.map((f) => ({ text: f.text, at: "2026-11-12", source: f.source })),
    closedFronts: [], keyFiles: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ file: `src/module-${String(i).padStart(2, "0")}.js`, role: `contiene Seccion${String(i).padStart(2, "0")}` })),
  });
  for (let i = 1; i <= 6; i += 1) {
    threadMemory.appendVerbatimTurn(root, threadId, [
      { role: "user", content: `Turno previo ${i}: revisa el módulo ${i} de la interfaz y dime qué encontraste, sin tocar nada todavía.` },
      { role: "assistant", content: ("En el turno previo revisé el módulo correspondiente y confirmé su estructura principal, sus secciones y el estado de la verificación anterior. ").repeat(9).slice(0, 2400) },
    ]);
  }
  const FINAL = "Terminé la pasada: apliqué los cambios en los archivos de salida, el build quedó en verde y la captura del preview renderiza sin errores de consola. Doy la tarea por terminada porque la verificación real pasó; como siguiente paso propongo revisar el rendimiento de carga de la interfaz.";
  const R = (n) => ({ text: "", toolCalls: [toolCall("read_file", { path: `src/module-${String(n).padStart(2, "0")}.js` })], usage: USAGE });
  const W = (n, body) => ({ text: "", toolCalls: [toolCall("write_file", { path: `src/out-${n}.js`, content: body })], usage: USAGE });
  const CMD = (label, n) => ({ text: "", toolCalls: [toolCall("run_command", { command: `node -e 'console.log("${label}".repeat(${n}))'` })], usage: USAGE });
  const S = (q) => ({ text: "", toolCalls: [toolCall("search_files", { query: q, mode: "literal" })], usage: USAGE });
  const out = (n) => `export const salida${n} = "cambio aplicado ${n}";\n`;
  const script = [
    R(1), R(2), S("dato_03"), R(3), CMD("B", 10800), R(4), W(1, out(1)), R(5),
    CMD("M", 5200), W(2, out(2)), R(6), S("Seccion07"), R(7), CMD("C", 10800), W(3, out(3)),
    R(8), { text: "", toolCalls: [toolCall("git_status", {})], usage: USAGE }, R(9), W(4, out(4)),
    CMD("N", 5200), R(10),
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "src/out-1.js", oldText: 'salida1 = "cambio aplicado 1"', newText: 'salida1 = "cambio aplicado 1 revisado"' })], usage: USAGE },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run build" })], usage: USAGE },
    { text: "", toolCalls: [toolCall("capture_preview_screenshot", {})], usage: USAGE },
    R(11), W(5, out(5)),
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run build --silent" })], usage: USAGE },
    { text: FINAL, toolCalls: [], usage: USAGE },
  ];
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "Haz una pasada completa de corrección sobre los módulos de la interfaz del proyecto, aplica los cambios necesarios y verifica con el build y una captura del preview.",
    projectRoot: root, threadId, helpers: capturingHelpers(script, captures),
  });
  assert.ok(captures.length >= 28, `el turno produjo sus 28 llamadas (fueron ${captures.length})`);
  const total = captures.slice(0, 28).reduce((acc, cap) => acc + cap.messages.reduce((a, m) => a + msgChars(m), 0) + JSON.stringify(cap.tools).length, 0);
  const lastPayload = JSON.stringify(captures[Math.min(27, captures.length - 1)].messages);
  assert.ok(lastPayload.includes(TOOL_STUB_SENTINEL), "la dieta de pasos estuvo activa en la corrida comparativa (hay stubs en el payload tardío)");
  assert.ok(total <= 2_250_000, `el turno bajó de 3.158.770 a ${total} caracteres (cota honesta del escenario: 2.250.000; la cota de diseño 2.100.000 presuponía la estimación de C4 que la medición directa corrigió — ver el encabezado de este archivo)`);
});
