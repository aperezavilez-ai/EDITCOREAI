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

test("EditCore Nexus Tool Calling: parseTextToolCalls extrae objetos JSON planos con path y content", () => {
  const nexusFlatJson = 'He generado la solución:\n```json\n{\n  "tool": "write_file",\n  "path": "src/utils/math.js",\n  "content": "export function sum(a, b) { return a + b; }"\n}\n```\nListo.';
  const calls = parseTextToolCalls(nexusFlatJson);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "write_file");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "src/utils/math.js");
  assert.equal(args.content, "export function sum(a, b) { return a + b; }");

  const normalizados = normalizarToolCalls(calls);
  assert.equal(normalizados[0].nombre, "write_file");
  assert.equal(normalizados[0].args.path, "src/utils/math.js");
});

test("EditCore Nexus Tool Calling: parseTextToolCalls extrae etiquetas XML con atributos tipo path", () => {
  const nexusXml = '<write_file path="src/index.js">console.log("EditCore Nexus v5");</write_file>';
  const calls = parseTextToolCalls(nexusXml);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "write_file");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "src/index.js");
  assert.equal(args.content, 'console.log("EditCore Nexus v5");');
});

test("EditCore Nexus Tool Calling: rescate de bloque de código dirigido con ruta mencionada", () => {
  const nexusDirected = 'Voy a crear el archivo src/App.jsx con el componente:\n```jsx\nexport default function App() {\n  return <h1>Hola Mundo</h1>;\n}\n```\nVerifica el resultado.';
  const calls = parseTextToolCalls(nexusDirected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "write_file");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "src/App.jsx");
  assert.match(args.content, /<h1>Hola Mundo<\/h1>/);
});

