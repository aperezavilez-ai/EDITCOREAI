"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-chat-tools-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const projectRoot = path.join(tmp, "proyecto");
const outsideDir = path.join(tmp, "otra-carpeta");
fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), "{}");
fs.mkdirSync(path.join(outsideDir, "PROYECTO-HERMANO"), { recursive: true });
fs.writeFileSync(path.join(outsideDir, "notas.txt"), "hola");

const provider = require("../editcore-chat-kernel/provider");
const calls = [];
let scripted = [];
provider.callChat = async (opts) => {
  calls.push(opts);
  const next = scripted.shift();
  return next || { text: "Listo.", toolCalls: [], usage: {} };
};

const tools = require("../editcore-chat-kernel/tools");
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const { scrubInternalProviderNames } = require("../runtime/chat-error-sanitize");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("list_files con ruta absoluta fuera del proyecto lista esa carpeta, no el proyecto", async () => {
  const out = await tools.execute("list_files", { path: outsideDir, forceReal: true }, projectRoot, false, {});
  assert.equal(out.ok, true);
  assert.equal(out.path, path.resolve(outsideDir));
  assert.deepEqual(out.dirs, ["PROYECTO-HERMANO"]);
  assert.deepEqual(out.files, ["notas.txt"]);
});

test("list_files con ruta absoluta inexistente devuelve error claro", async () => {
  const out = await tools.execute("list_files", { path: path.join(tmp, "no-existe") }, projectRoot, false, {});
  assert.equal(out.ok, false);
  assert.match(out.error, /No existe la carpeta/);
});

test("extractListTarget respeta rutas absolutas con espacios fuera del proyecto", () => {
  const { extractListTarget } = require("../editcore-chat-kernel/classify");
  const spaced = path.join(tmp, "CARPETA CON ESPACIOS");
  fs.mkdirSync(spaced, { recursive: true });
  assert.equal(extractListTarget(`lista los archivos de ${spaced}`, projectRoot), spaced);
  assert.equal(extractListTarget(`lista los archivos de ${spaced}.`, projectRoot), spaced);
});

test("list_skills incluye las skills integradas de EditCoreAI", async () => {
  const engine = require("../runtime/skills-engine");
  const expected = engine.listAllSkills({ projectRoot, userDataPath: process.env.EDITCORE_USER_DATA_PATH }).length;
  const out = await tools.execute("list_skills", {}, projectRoot, false, {});
  assert.equal(out.ok, true);
  assert.equal(out.count, expected);
});

test("modo charla: ofrece herramientas de solo lectura, ejecuta list_files y responde", async () => {
  calls.length = 0;
  scripted = [
    { text: "", toolCalls: [toolCall("list_files", { path: outsideDir }), toolCall("write_file", { path: "x.txt", content: "no" })], usage: {} },
    { text: "En esa carpeta hay PROYECTO-HERMANO y notas.txt.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "qué skills tienes",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k-test",
    model: "modelo-test",
    skillsPrompt: "## Habilidades especializadas activas (Skills)\nSKILL-DE-PRUEBA",
  });

  assert.equal(out.kind, "CHAT");
  assert.match(out.text, /PROYECTO-HERMANO/);
  const offered = calls[0].tools.map((t) => t.function?.name || t.name);
  assert.ok(offered.includes("web_search"));
  assert.ok(offered.includes("list_files"));
  assert.ok(offered.includes("list_skills"));
  assert.ok(!offered.includes("write_file"));
  assert.ok(!offered.includes("run_command"));

  const names = out.steps.map((s) => s.name);
  assert.deepEqual(names, ["list_files"]);
  assert.deepEqual(out.steps[0].result.dirs, ["PROYECTO-HERMANO"]);
  assert.equal(fs.existsSync(path.join(projectRoot, "x.txt")), false);

  const system = calls[0].messages[0].content;
  const user = calls[0].messages.filter((m) => m.role === "user").pop().content;
  assert.match(system, /SKILL-DE-PRUEBA/);
  assert.doesNotMatch(String(user), /SKILL-DE-PRUEBA/);
  assert.match(String(user), /qué skills tienes/);
});

test("modo charla: el último paso va sin herramientas para forzar la respuesta", async () => {
  calls.length = 0;
  scripted = Array.from({ length: 5 }, (_, i) => ({ text: "", toolCalls: [toolCall("web_search", { query: `python ${i}` })], usage: {} }));
  scripted.push({ text: "Python 3.14 es la última estable.", toolCalls: [], usage: {} });
  const original = tools.execute;
  tools.execute = async (name, args, ...rest) => (name === "web_search" ? { ok: true, results: [] } : original(name, args, ...rest));
  try {
    const orch = new ChatOrchestrator();
    const out = await orch.handle({ message: "cual es la ultima version de python", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m" });
    assert.match(out.text, /Python 3\.14/);
    assert.equal(calls[calls.length - 1].tools.length, 0);
  } finally {
    tools.execute = original;
  }
});

test("el filtro de errores no rompe supabase.gafcore.com y sigue ocultando el gateway", () => {
  const out = scrubInternalProviderNames("Backend https://supabase.gafcore.com caído; revisa GafCore Gateway");
  assert.match(out, /supabase\.gafcore\.com/);
  assert.doesNotMatch(out, /Gateway/i);
});

test("la vista del chat ya no reemplaza GafCore suelto", () => {
  for (const rel of ["renderer.js", "resources/ui-overlay/renderer.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.ok(!src.includes('.replace(/\\bGafCore\\b/gi, "el proveedor")'), rel);
    assert.ok(src.includes('.replace(/\\bGafCore\\s+Gateway\\b/gi, "el proveedor de modelos")'), rel);
  }
});
