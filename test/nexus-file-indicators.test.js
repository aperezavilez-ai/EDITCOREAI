const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTextToolCalls, stripTextToolMarkup } = require("../runtime/tools/parse-text-tools");
const { normalizarToolCalls } = require("../runtime/tools/nuevo/adaptador");
const ProjectFilesUi = require("../runtime/project-files-ui");

test("Nexus File Indicators: Flat JSON tool call triggers file mutation payload with correct path and highlights", () => {
  const nexusOutput = 'Generando el archivo:\n```json\n{\n  "tool": "write_file",\n  "path": "src/components/Button.jsx",\n  "content": "export default function Button() { return <button>OK</button>; }"\n}\n```\nListo.';
  const calls = parseTextToolCalls(nexusOutput, { projectRoot: "D:/proyectos/mi-app" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "write_file");

  const normalizados = normalizarToolCalls(calls);
  assert.equal(normalizados[0].nombre, "write_file");
  assert.equal(normalizados[0].args.path, "src/components/Button.jsx");

  // Simular evento onToolProgress tal como lo emite el bucle del kernel
  const progress = {
    phase: "tool",
    name: normalizados[0].nombre,
    input: normalizados[0].args,
    stage: "running",
    path: normalizados[0].args.path,
  };

  const payload = ProjectFilesUi.filesChangedPayload(progress, "D:/proyectos/mi-app");
  assert.equal(payload.writtenPath, "src/components/Button.jsx");
  assert.equal(payload.fileName, "Button.jsx");
  assert.equal(payload.viewDir, "src/components");

  // El árbol de archivos resalta tanto la carpeta raíz (src) como la carpeta padre (components) y el archivo (Button.jsx)
  assert.deepEqual(payload.highlightNames, ["src", "components", "Button.jsx"]);
});

test("Nexus File Indicators: XML tag with path attribute triggers file indicators", () => {
  const nexusOutput = '<read_file path="package.json"></read_file>';
  const calls = parseTextToolCalls(nexusOutput, { projectRoot: "D:/proyectos/mi-app" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "read_file");

  const normalizados = normalizarToolCalls(calls);
  assert.equal(normalizados[0].args.path, "package.json");

  const progress = {
    phase: "tool",
    name: normalizados[0].nombre,
    input: normalizados[0].args,
    stage: "running",
    path: normalizados[0].args.path,
  };

  const payload = ProjectFilesUi.filesChangedPayload(progress, "D:/proyectos/mi-app");
  assert.equal(payload.writtenPath, "package.json");
  assert.equal(payload.fileName, "package.json");
  assert.deepEqual(payload.highlightNames, ["package.json"]);
});

test("Nexus File Indicators: Directed code block creation triggers write_file with proper target", () => {
  const nexusOutput = 'He implementado el archivo server.js:\n```javascript\nconst http = require("http");\nhttp.createServer().listen(3000);\n```';
  const calls = parseTextToolCalls(nexusOutput, { projectRoot: "D:/proyectos/mi-app" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "write_file");

  const normalizados = normalizarToolCalls(calls);
  assert.equal(normalizados[0].args.path, "server.js");
  assert.match(normalizados[0].args.content, /createServer/);

  const payload = ProjectFilesUi.filesChangedPayload({
    phase: "tool",
    name: normalizados[0].nombre,
    input: normalizados[0].args,
    stage: "running",
  }, "D:/proyectos/mi-app");

  assert.equal(payload.writtenPath, "server.js");
  assert.equal(payload.fileName, "server.js");
  assert.deepEqual(payload.highlightNames, ["server.js"]);
});
