"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: protocolo de texto <tool_code>.
// En el juicio en vivo, el modelo emitió la llamada a
// list_files como TEXTO con un formato que el parser no
// conocía:
//   <tool_code><name>list_files</name><arguments>{...}</arguments></tool_code>
// Resultado: la llamada jamás se ejecutó y el marcado crudo
// quedó pintado en el chat como si fuera la respuesta.
// Esta batería fija el formato EXACTO de ese turno: se
// parsea, se ejecuta y el marcado nunca llega a la vista.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTextToolCalls,
  stripTextToolMarkup,
  TOOL_MARKUP_START_RE,
} = require("../editcore-chat-kernel/parse-text-tools");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

// El bloque EXACTO que el modelo emitió en el turno en vivo
// (la ruta viaja escapada como JSON, como salió del stream).
const BLOQUE_EXACTO = "Voy a revisar el contenido de la carpeta scratch en el proyecto.\n"
  + "<tool_code>\n"
  + "<name>list_files</name>\n"
  + "<arguments>\n"
  + "{\"path\": \"D:\\\\PROGRAMAS IA\\\\PODCASTUDIO\\\\scratch\"}\n"
  + "</arguments>\n"
  + "</tool_code>";
const RAIZ = "D:\\PROGRAMAS IA\\PODCASTUDIO";

test("el bloque <tool_code> exacto se parsea: 1 llamada list_files con su path", () => {
  const calls = parseTextToolCalls(BLOQUE_EXACTO, { projectRoot: RAIZ });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "list_files");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "scratch");
});

test("sin projectRoot, el path parseado es la ruta completa normalizada", () => {
  const calls = parseTextToolCalls(BLOQUE_EXACTO);
  assert.equal(calls.length, 1);
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "D:/PROGRAMAS IA/PODCASTUDIO/scratch");
});

test("bloque sin cierre (stream cortado): se tolera y la llamada se rescata", () => {
  const cortado = BLOQUE_EXACTO.replace("\n</tool_code>", "");
  const calls = parseTextToolCalls(cortado, { projectRoot: RAIZ });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "list_files");
  assert.equal(JSON.parse(calls[0].function.arguments).path, "scratch");
});

test("el marcado <tool_code> se reconoce como protocolo y se retira del texto visible", () => {
  assert.ok(TOOL_MARKUP_START_RE.test("<tool_code>"));
  const visible = stripTextToolMarkup(BLOQUE_EXACTO);
  assert.equal(visible, "Voy a revisar el contenido de la carpeta scratch en el proyecto.");
  assert.ok(!/tool_code|<name>|<arguments>/.test(visible));
});

test("bloque sin cierre tampoco deja marcado visible", () => {
  const cortado = BLOQUE_EXACTO.replace("\n</tool_code>", "");
  const visible = stripTextToolMarkup(cortado);
  assert.equal(visible, "Voy a revisar el contenido de la carpeta scratch en el proyecto.");
});

const DEFINICIONES = [
  { type: "function", function: { name: "list_files", description: "lista", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "read_file", description: "lee", parameters: { type: "object", properties: {} } } },
];

test("turno CONSULTA: el modelo emite <tool_code> y la herramienta SÍ se ejecuta", async () => {
  let llamada = 0;
  const callChat = async () => {
    llamada += 1;
    if (llamada === 1) {
      return { content: BLOQUE_EXACTO, toolCalls: [], usage: { input_tokens: 800, output_tokens: 60 } };
    }
    return { content: "La carpeta scratch contiene a.txt.", toolCalls: [], usage: { input_tokens: 900, output_tokens: 40 } };
  };
  const ejecutadas = [];
  const execute = async (name, args) => {
    ejecutadas.push([name, args]);
    return { ok: true, path: "scratch", dirs: [], files: ["a.txt"] };
  };
  const out = await manejarChatNuevo(
    { message: "lista la carpeta scratch", projectRoot: RAIZ, threadId: "tp1", runId: "rp1", apiBaseUrl: "x", apiKey: "k", model: "m" },
    { callChat, execute, getToolDefinitions: () => DEFINICIONES, construirMemoria: async () => "" },
  );
  assert.equal(out.kind, "CONSULTA");
  assert.deepEqual(ejecutadas, [["list_files", { path: "scratch" }]]);
  assert.equal(out.text, "La carpeta scratch contiene a.txt.");
  assert.ok(!/tool_code/.test(out.text));
});

test("marcado DSML se parsea como tool call y se retira del texto visible", () => {
  const dsmlText = "Revisando el repositorio...\n"
    + "< | DSML | calls>\n"
    + "< | DSML | invoke name=\"run_command\">\n"
    + "< | DSML | parameter name=\"command\">git status< / | DSML | parameter>\n"
    + "< / | DSML | invoke>\n"
    + "< / | DSML | calls>";

  assert.ok(TOOL_MARKUP_START_RE.test(dsmlText));
  const calls = parseTextToolCalls(dsmlText, { projectRoot: RAIZ });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "run_command");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.command, "git status");

  const visible = stripTextToolMarkup(dsmlText);
  assert.equal(visible, "Revisando el repositorio...");
  assert.ok(!/DSML|calls|invoke|parameter/.test(visible));
});

test("marcado DSML con pipes Unicode (｜), atributos tipados y cierres alternativos", () => {
  const userSnippet = "Voy a ejecutar directamente.\n\n"
    + "Primero veo la estructura del proyecto.\n"
    + "</｜DSML｜ invoke name=\"list_files\">\n"
    + "<｜DSML｜ parameter name=\"path\" string=\"true\">.</｜DSML｜ parameter>\n"
    + "<｜DSML｜ parameter name=\"recursive\" boolean=\"true\">true</｜DSML｜ parameter>\n"
    + "<｜DSML｜ parameter name=\"ignore\" array=\"true\">[\"node_modules\", \".next\", \".git\", \"dist\", \"build\"]</｜DSML｜ parameter>\n"
    + "<｜DSML｜ /｜DSML｜ invoke>\n"
    + "<｜DSML｜ calls>";

  assert.ok(TOOL_MARKUP_START_RE.test(userSnippet));
  const calls = parseTextToolCalls(userSnippet, { projectRoot: RAIZ });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "list_files");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, ".");
  assert.equal(args.recursive, true);
  assert.deepEqual(args.ignore, ["node_modules", ".next", ".git", "dist", "build"]);

  const visible = stripTextToolMarkup(userSnippet);
  assert.equal(visible, "Voy a ejecutar directamente.\n\nPrimero veo la estructura del proyecto.");
  assert.ok(!/DSML|calls|invoke|parameter|[|｜\uFF5C]/.test(visible));
});


