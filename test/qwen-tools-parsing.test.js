const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTextToolCalls, stripTextToolMarkup, isToolProtocolText } = require("../runtime/tools/parse-text-tools");
const { normalizarToolCalls } = require("../runtime/tools/nuevo/adaptador");

test("Qwen 2.5 Coder Tool Calling: parseTextToolCalls extrae llamadas dentro de <tools>", () => {
  const qwenOutput = '<tools>\n{\n  "name": "read_file",\n  "arguments": {\n    "path": "package.json"\n  }\n}\n</tools>';
  const calls = parseTextToolCalls(qwenOutput);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "read_file");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: "package.json" });

  const normalizados = normalizarToolCalls(calls);
  assert.equal(normalizados.length, 1);
  assert.equal(normalizados[0].nombre, "read_file");
  assert.deepEqual(normalizados[0].args, { path: "package.json" });
});

test("Qwen 2.5 Coder Tool Calling: stripTextToolMarkup limpia <tools> por completo", () => {
  const qwenOutput = 'Voy a revisar el archivo.\n<tools>\n{\n  "name": "read_file",\n  "arguments": {\n    "path": "package.json"\n  }\n}\n</tools>';
  const stripped = stripTextToolMarkup(qwenOutput);
  assert.equal(stripped, "Voy a revisar el archivo.");
});

test("Qwen 2.5 Coder Tool Calling: isToolProtocolText detecta <tools>", () => {
  const qwenOutput = '<tools>\n{\n  "name": "read_file",\n  "arguments": {\n    "path": "package.json"\n  }\n}\n</tools>';
  assert.equal(isToolProtocolText(qwenOutput), true);
});
