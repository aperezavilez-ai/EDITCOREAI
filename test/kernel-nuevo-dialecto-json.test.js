"use strict";
// ============================================================
// BATERÍA — DIALECTO JSON DE HERRAMIENTAS + CONTINUACIÓN
// Caso real (juicio en vivo, proyecto «sistemas contino»):
// el modelo tras la pasarela emite sus llamadas como líneas
// JSON peladas {"tool":"bash","args":{...}}. Sin rescate, no
// se ejecutaban y el JSON quedaba pintado como «respuesta»:
// el agente no construía nada. Y tras el fallo, las respuestas
// cortas del usuario («1», «ok») caían a CONVERSACION — sin
// herramientas — y el trabajo ofrecido jamás se reanudaba.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseTextToolCalls, stripTextToolMarkup } = require("../editcore-chat-kernel/parse-text-tools");
const { decidirTurno, contextoDesdeHistorial } = require("../editcore-chat-kernel/nuevo/despacho");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

const LINEAS_LUIS = '{"tool":"bash","args":{"command":"ls -la"}}\n{"tool":"bash","args":{"command":"cat package. json 2>/dev/null || echo \'No package.json\'"}}';

test("dialecto JSON: las líneas de Luis se rescatan como run_command", () => {
  const calls = parseTextToolCalls(LINEAS_LUIS, { projectRoot: "/proyecto" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, "run_command");
  assert.equal(JSON.parse(calls[0].function.arguments).command, "ls -la");
  assert.equal(calls[1].function.name, "run_command");
  assert.match(JSON.parse(calls[1].function.arguments).command, /cat package/);
});

test("dialecto JSON: el limpiador lo retira del texto visible", () => {
  const limpio = stripTextToolMarkup(`Voy a inspeccionar tu carpeta.\n${LINEAS_LUIS}`);
  assert.doesNotMatch(limpio, /"tool"/);
  assert.match(limpio, /Voy a inspeccionar/);
});

test("dialecto JSON: nombre sin herramienta real se descarta en silencio", () => {
  const calls = parseTextToolCalls('{"tool":"teletransportar","args":{"destino":"marte"}}', { projectRoot: "/p" });
  assert.equal(calls.length, 0);
  const limpio = stripTextToolMarkup('{"tool":"teletransportar","args":{"destino":"marte"}}');
  assert.equal(limpio, "");
});

test("turno ORDEN completo: el dialecto JSON se EJECUTA y no se pinta", async () => {
  const ejecutadas = [];
  let llamada = 0;
  const callChat = async () => {
    llamada += 1;
    if (llamada === 1) return { content: LINEAS_LUIS, toolCalls: [], usage: { input_tokens: 100, output_tokens: 50 } };
    return { content: "Ya inspeccioné la raíz: está casi vacía, puedo crear el proyecto ahí.", toolCalls: [], usage: { input_tokens: 100, output_tokens: 40 } };
  };
  const DEFINICIONES = [
    { type: "function", function: { name: "run_command", description: "shell", parameters: { type: "object", properties: {} } } },
  ];
  const out = await manejarChatNuevo(
    { message: "procede con todo", projectRoot: "/proyecto", threadId: "tj1", runId: "rj1", apiBaseUrl: "x", apiKey: "k", model: "m" },
    {
      callChat,
      getToolDefinitions: () => DEFINICIONES,
      execute: async (name, args) => { ejecutadas.push([name, args]); return { ok: true, stdout: "README.md" }; },
      construirMemoria: async () => "",
    },
  );
  assert.equal(ejecutadas.length, 2);
  assert.equal(ejecutadas[0][0], "run_command");
  assert.doesNotMatch(JSON.stringify(out), /"tool":\s*"bash"/);
});

const HISTORIAL_OFERTA = [
  { role: "user", content: "necesito un saas de reportes, espero tu propuesta" },
  { role: "assistant", content: "Propuesta: Portal SaaS multi-tenant. ¿Te parece bien esta propuesta? Si me das tu aprobación (\"procede\", \"sí\"), empiezo." },
];
const HISTORIAL_OFERTA_OPCIONES = [
  { role: "user", content: "procede con todo" },
  { role: "assistant", content: "El motor falló. Tienes dos opciones: 1) Reintentar la ejecución. 2) Crear el proyecto en una carpeta nueva. ¿Cuál prefieres? Si es la opción 1, dime \"reintenta\"." },
];

test("continuación: «1», «ok», «sí», «reintenta» tras una oferta ejecutan (ORDEN)", () => {
  for (const [hist, msg] of [
    [HISTORIAL_OFERTA, "sí"],
    [HISTORIAL_OFERTA, "ok"],
    [HISTORIAL_OFERTA_OPCIONES, "1"],
    [HISTORIAL_OFERTA_OPCIONES, "reintenta"],
  ]) {
    const d = decidirTurno(msg, contextoDesdeHistorial(hist));
    assert.equal(d.carril, "ORDEN", `${msg} debería continuar en ORDEN`);
    assert.equal(d.puedeEscribir, true);
  }
});

test("continuación: sin oferta previa, «ok» sigue siendo conversación", () => {
  const hist = [
    { role: "user", content: "¿qué es un folio?" },
    { role: "assistant", content: "Un folio es un número único de seguimiento." },
  ];
  assert.equal(decidirTurno("ok", contextoDesdeHistorial(hist)).carril, "CONVERSACION");
  assert.equal(decidirTurno("1", contextoDesdeHistorial([])).carril, "CONVERSACION");
});

test("superficie: el manejador de progreso ignora eventos que no sean objeto", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const i = renderer.indexOf("window.editcoreAgent.onProgress((progress) => {");
  assert.ok(i > 0);
  assert.match(renderer.slice(i, i + 700), /if \(!progress \|\| typeof progress !== "object"\) return;/);
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /const envioProgreso = redacted && typeof redacted === "object" \? redacted : \{\};/);
});

const { crearLlamarModelo } = require("../editcore-chat-kernel/nuevo/adaptador");
const { traducirComandoWindows } = require("../editcore-chat-kernel/process-runner");

test("stream en vivo: el dialecto JSON NO se pinta ni partido entre deltas", async () => {
  const pintado = [];
  const piezas = [
    "Voy a verificar el directorio. ",
    '{"tool":"bash","args":{"command":"ls',
    ' -la"}}',
    "\nSigo con la estructura.",
  ];
  const callChat = async (opts) => {
    for (const pieza of piezas) opts.onTextDelta(pieza, {});
    return { content: piezas.join(""), toolCalls: [], usage: {} };
  };
  const llamar = crearLlamarModelo({
    callChat,
    perfil: { apiBaseUrl: "x", apiKey: "k", model: "m" },
    definiciones: [],
    projectRoot: "/proyecto",
    onTextDelta: (s) => pintado.push(s),
  });
  const salida = await llamar({ mensajes: [{ role: "user", content: "procede" }], herramientas: [] });
  await new Promise((r) => setTimeout(r, 250));
  const pintadoTxt = pintado.join("");
  assert.match(pintadoTxt, /Voy a verificar/);
  assert.doesNotMatch(pintadoTxt, /"tool"/);
  assert.equal(salida.toolCalls.length, 1);
  assert.equal(salida.toolCalls[0].nombre, "run_command");
  assert.equal(salida.toolCalls[0].args.command, "ls -la");
});

test("superficie renderer: stripAgentToolXml también retira el dialecto JSON", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const i1 = src.indexOf("function quitarObjetosJsonHerramienta");
  const i2 = src.indexOf("function stripAgentToolXml");
  assert.ok(i1 > 0 && i2 > i1);
  const cuerpoStrip = src.slice(i2, src.indexOf("\n}", i2) + 2);
  const fn = new Function(`${src.slice(i1, i2)}\n${cuerpoStrip}\nreturn stripAgentToolXml;`)();
  const entrada = `Empiezo verificando el directorio.\n${LINEAS_LUIS}\nVerifico el estado antes de crear.`;
  const salida = fn(entrada);
  assert.doesNotMatch(salida, /"tool"/);
  assert.match(salida, /Empiezo verificando/);
  assert.match(salida, /Verifico el estado/);
  // JSON cortado a mitad (stream interrumpido): se corta desde ahí.
  const cortado = fn('Voy a crear la base. {"tool":"bash","args":{"command":"npm crea');
  assert.doesNotMatch(cortado, /"tool"/);
  assert.match(cortado, /Voy a crear la base/);
});

test("windows: los comandos Unix del modelo se traducen a cmd.exe", () => {
  assert.equal(traducirComandoWindows("ls -la"), "dir");
  assert.equal(traducirComandoWindows("ls src"), "dir src");
  assert.match(
    traducirComandoWindows("cat package.json 2>/dev/null || echo 'No package.json'"),
    /^type package\.json 2>nul \|\| echo 'No package\.json'$/,
  );
  assert.equal(traducirComandoWindows("node --version && npm --version"), "node --version && npm --version");
  assert.equal(traducirComandoWindows("npm run build"), "npm run build");
});
