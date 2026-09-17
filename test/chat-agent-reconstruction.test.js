"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ActionRegistry } = require("../runtime/action-registry");
const { AiCore } = require("../runtime/ai-core");
const { EditCoreClaudeAdapter, sanitizeUserFacingReport } = require("../runtime/editcore-claude-adapter");
const { TaskManager } = require("../runtime/task-manager");
const { TaskStore } = require("../runtime/task-store");
const { createStepModel } = require("../runtime/task-models");
const { parseAnalysisCommand } = require("../command-policy");
const { ToolDispatcher } = require("../runtime/tool-dispatcher");
const { agentTaskRequirements, validateAgentCompletion } = require("../agent-runtime");
const ProjectAnalysis = require("../project-analysis");
const { extractPlainToolCalls, narrationWithoutToolCalls, parseAgentPayload } = require("../agent-parser");
const { buildExternalFoundationContext } = require("../runtime/external-agent-foundation");

function toolCall(name, input = {}) {
  return { id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(input) } };
}

function session(responses, executed = []) {
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 8, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = { execute: async (name, input) => { executed.push({ name, input }); return { name, input }; } };
  return adapter;
}

function temporaryProject(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("dispatcher normaliza alias de herramientas emitidos por proveedores", async () => {
  const dispatcher = new ToolDispatcher({ authorize: async () => true });
  const calls = [];
  dispatcher.register({ name: "run_command", execute: async (input) => { calls.push(["run_command", input]); return "ok"; } });
  dispatcher.register({ name: "list_files", execute: async (input) => { calls.push(["list_files", input]); return []; } });
  dispatcher.register({ name: "search_files", execute: async (input) => { calls.push(["search_files", input]); return []; } });
  dispatcher.register({ name: "replace_in_file", write: true, execute: async (input) => { calls.push(["replace_in_file", input]); return "edited"; } });
  const command = await dispatcher.dispatch("execute_command", { cmd: "npm test" });
  const terminal = await dispatcher.dispatch("run terminal command", { command: "npm run check", working_directory: "web-app" });
  const list = await dispatcher.dispatch("list_dir", { directory: "src" });
  const search = await dispatcher.dispatch("file search", { pattern: "package.json", directory: "api" });
  const edit = await dispatcher.dispatch("edit_file", { filePath: "src/app.js", search: "old", replacement: "new" });
  assert.equal(command.ok, true);
  assert.equal(command.name, "run_command");
  assert.equal(terminal.ok, true);
  assert.equal(terminal.name, "run_command");
  assert.equal(list.ok, true);
  assert.equal(list.name, "list_files");
  assert.equal(search.ok, true);
  assert.equal(search.name, "search_files");
  assert.equal(edit.ok, true);
  assert.equal(edit.name, "replace_in_file");
  assert.deepEqual(calls, [
    ["run_command", { cmd: "npm test", command: "npm test", cwd: "" }],
    ["run_command", { command: "npm run check", working_directory: "web-app", cwd: "web-app" }],
    ["list_files", { directory: "src", path: "src" }],
    ["search_files", { pattern: "package.json", directory: "api", query: "package.json", path: "api" }],
    ["replace_in_file", { filePath: "src/app.js", search: "old", replacement: "new", path: "src/app.js", oldText: "old", newText: "new" }],
  ]);
});

test("parser acepta nombres de herramienta con espacios", () => {
  assert.deepEqual(
    parseAgentPayload('{"type":"tool","name":"run command","input":{"cmd":"npm run check","working_directory":"web-app"}}'),
    { type: "tool", name: "run_command", input: { cmd: "npm run check", working_directory: "web-app", command: "npm run check", cwd: "web-app" } }
  );
  assert.equal(parseAgentPayload('{"type":"tool","name":"run terminal command","input":{"command":"node --version"}}').name, "run_command");
  assert.deepEqual(
    parseAgentPayload('{"type":"tool","name":"file search","input":{"pattern":"package.json","directory":"api"}}'),
    { type: "tool", name: "search_files", input: { pattern: "package.json", directory: "api", query: "package.json", path: "api" } }
  );
});

test("parser convierte llamadas textuales del proveedor sin mostrarlas al usuario", () => {
  const text = [
    "Voy a revisar el archivo y aplicar el cambio.",
    'read_file(path="src/app.ts")',
    'replace_in_file(path="src/app.ts", oldText="const a = 1;", newText="const a = 2;")',
    'run_command(command="npm test")',
  ].join("\n");
  const actions = extractPlainToolCalls(text);
  assert.deepEqual(actions.map((item) => item.name), ["read_file", "replace_in_file", "run_command"]);
  assert.equal(actions[1].input.oldText, "const a = 1;");
  assert.equal(narrationWithoutToolCalls(text), "Voy a revisar el archivo y aplicar el cambio.");
});

test("el adaptador ejecuta herramientas textuales y conserva solo la narracion humana", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-plain-tools-");
  fs.writeFileSync(path.join(projectRoot, "status.txt"), "ok\n", "utf8");
  const executed = [];
  const adapter = session([
    { text: 'Voy a comprobar el estado.\nread_file(path="status.txt")', toolCalls: [], usage: { total_tokens: 5 } },
    { text: "El archivo fue comprobado.", toolCalls: [], usage: { total_tokens: 5 } },
  ], executed);
  const progress = [];
  const result = await adapter.executeTask({
    prompt: "Revisa status.txt", projectRoot, allowWrite: false, requireEvidence: true, enforceController: true,
    onProgress: (item) => progress.push(item),
  });
  assert.equal(result.completed, true);
  assert.deepEqual(executed.map((item) => item.name), ["read_file"]);
  assert.ok(progress.some((item) => item.phase === "narration" && /comprobar el estado/i.test(item.text)));
  assert.doesNotMatch(result.text, /read_file\s*\(/);
});

test("el adaptador incorpora steering antes de la siguiente decision", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-steering-");
  fs.writeFileSync(path.join(projectRoot, "status.txt"), "ok\n", "utf8");
  const seen = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 100, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async (input) => {
    seen.push(input.messages);
    return seen.length === 1
      ? { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 5 } }
      : { text: "Instruccion aplicada.", toolCalls: [], usage: { total_tokens: 5 } };
  } };
  adapter.toolExecutor = { execute: async () => ({ content: "ok" }) };
  const result = await adapter.executeTask({
    prompt: "Revisa status.txt", projectRoot, allowWrite: false, requireEvidence: true, enforceController: true,
    steering: [{ instruction: "Incluye el estado actual en el resultado." }],
  });
  assert.equal(result.completed, true);
  assert.match(JSON.stringify(seen[0]), /NUEVA INSTRUCCION DEL USUARIO/);
  assert.match(JSON.stringify(seen[0]), /Incluye el estado actual/);
});

test("reconoce consultas naturales de estado sin usar proveedor", () => {
  for (const phrase of ["que sigue?", "qué prosigue", "qué falta", "estado de la tarea", "???"]) {
    assert.equal(ProjectAnalysis.isTaskStatusQuestion(phrase), true, phrase);
  }
  assert.equal(ProjectAnalysis.isTaskStatusQuestion("?"), false);
  assert.equal(ProjectAnalysis.isTaskStatusQuestion("¿"), false);
});

test("la fundacion externa adaptada entra en el contexto operativo del agente", () => {
  const context = buildExternalFoundationContext({ allowWrite: true });
  assert.match(context, /OmniRoute/);
  assert.match(context, /claude-mem/);
  assert.match(context, /Headroom/);
  assert.match(context, /escritura.*verificalos/i);
  assert.match(context, /evidencia/);
});

test("una tarea READY puede quedar recuperable despues de un fallo del proveedor", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-task-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new TaskStore({ root });
  const manager = new TaskManager({ store });
  const task = manager.createTask({ goal: "probar recuperacion", projectRoot: root, status: "READY" });
  const recovered = manager.markTaskFailed(task.taskId, new Error("El proveedor no respondio"), { recoverable: true, stage: "execution" });
  assert.equal(recovered.status, "RECOVERABLE");
  assert.equal(recovered.resumeRequired, true);
  assert.equal(recovered.failureCount, 1);
});

test("las herramientas usan contrato nativo tipado", () => {
  const adapter = session([]);
  for (const tool of adapter.getAvailableTools({ allowWrite: true })) {
    assert.equal(tool.type, "function");
    assert.ok(tool.function.name);
    assert.equal(tool.function.parameters.type, "object");
  }
});

test("analisis expone comandos restringidos sin exponer escrituras", () => {
  const tools = session([]).getAvailableTools({ analysisMode: true, allowWrite: false });
  const names = tools.map((item) => item.function.name);
  assert.ok(names.includes("run_command"));
  assert.ok(!names.includes("write_file"));
  assert.ok(!names.includes("replace_in_file"));
  assert.ok(tools.find((item) => item.function.name === "run_command").function.parameters.properties.cwd);
});

test("analisis permite auditoria sin aceptar composicion de shell", () => {
  assert.deepEqual(parseAnalysisCommand("npm audit"), { executable: "npm", args: ["audit"] });
  assert.deepEqual(parseAnalysisCommand("npm audit --json"), { executable: "npm", args: ["audit", "--json"] });
  assert.deepEqual(parseAnalysisCommand("node --version"), { executable: "node", args: ["--version"] });
  assert.deepEqual(parseAnalysisCommand("rg --files"), { executable: "rg", args: ["--files"] });
  assert.throws(() => parseAnalysisCommand("npm run check"), /MODO ANALISIS/);
  assert.throws(() => parseAnalysisCommand("npm run lint"), /MODO ANALISIS/);
  assert.throws(() => parseAnalysisCommand("npx tsc --noEmit"), /MODO ANALISIS/);
  assert.throws(() => parseAnalysisCommand("npx eslint ."), /MODO ANALISIS/);
  assert.throws(() => parseAnalysisCommand("cd web-app && npm install"), /Comando no permitido/);
  assert.throws(() => parseAnalysisCommand("npm install"), /Comando no permitido/);
  assert.throws(() => parseAnalysisCommand("node -e \"console.log(1)\""), /Comando no permitido/);
});

test("el cache separa acciones iguales de proyectos distintos", () => {
  const registry = new ActionRegistry();
  const first = { name: "read_file", input: { path: "package.json" }, projectRoot: "D:/A" };
  const second = { name: "read_file", input: { path: "package.json" }, projectRoot: "D:/B" };
  registry.record(first, { content: "A" });
  assert.equal(registry.wasExecuted(second), false);
});

test("un final prematuro obliga a usar herramientas antes de completar", async (t) => {
  const executed = [];
  const projectRoot = temporaryProject(t, "editcore-premature-final-");
  const adapter = session([
    { text: JSON.stringify({ type: "final", text: "Todo correcto" }), usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Archivo leido" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false });
  assert.equal(result.completed, true);
  assert.deepEqual(executed.map((item) => item.name), ["read_file"]);
});

test("una escritura necesita verificacion posterior", async (t) => {
  const executed = [];
  const projectRoot = temporaryProject(t, "editcore-write-verification-");
  const adapter = session([
    { text: "", toolCalls: [toolCall("write_file", { path: "a.txt", content: "ok" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Escrito" }), usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "a.txt" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Escrito y verificado" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({ prompt: "Crea a.txt", projectRoot, requireEvidence: true, allowWrite: true });
  assert.equal(result.completed, true);
  assert.deepEqual(executed.map((item) => item.name), ["write_file", "read_file"]);
});

test("la verificacion reconoce mutaciones con rutas absolutas del proyecto", () => {
  const projectRoot = path.join(os.tmpdir(), "editcore-absolute-path-project");
  const result = validateAgentCompletion(
    "Crea acceptance-agent.txt y verifica el resultado",
    [
      { name: "write_file", input: { path: path.join(projectRoot, "acceptance-agent.txt") }, ok: true },
      { name: "read_file", input: { path: path.join(projectRoot, "acceptance-agent.txt") }, ok: true },
      { name: "run_command", input: { command: "npm run check" }, ok: true },
    ],
    true,
    { projectRoot },
  );
  assert.equal(result.ok, true);
});

test("un fallo produce cierre incompleto y nunca falso exito", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-honest-failure-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }));
  const adapter = session([
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: "Encontre un problema en las pruebas.", usage: { total_tokens: 5 } },
  ]);
  adapter.toolExecutor = { execute: async (name, input) => {
    if (name === "read_file") return { path: input.path, content: "ok" };
    throw new Error("Las pruebas fallaron");
  } };
  const result = await adapter.executeTask({ prompt: "Corrige src/index.js y verifica con npm test", projectRoot, requireEvidence: true, allowWrite: true });
  assert.equal(result.completed, false);
  assert.equal(result.report.outcome, "incomplete");
  assert.equal(result.report.failedSteps, 1);
  assert.match(result.text, /No se pudo completar ni verificar/);
  assert.doesNotMatch(result.text, /Ejecuci[oó]n completada/i);
});

test("dos herramientas fallidas detienen el consumo sin agotar iteraciones", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-failure-limit-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }));
  const responses = [
    { text: "", toolCalls: [toolCall("read_file", { path: "missing-a" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "missing-b" })], usage: { total_tokens: 5 } },
  ];
  const adapter = session(responses);
  adapter.toolExecutor = { execute: async (name, input) => {
    if (name === "list_files") return [{ name: "package.json" }];
    if (name === "read_file" && input.path === "package.json") return { path: "package.json", content: "{}" };
    throw new Error("fallo fatal");
  } };
  const result = await adapter.executeTask({ prompt: "FOCO: package.json", projectRoot, requireEvidence: true, analysisMode: true });
  assert.equal(result.report.failedSteps, 2);
  assert.match(result.report.stopReason, /acciones fallidas que impiden un analisis fiable/);
});

test("analisis no aborta por ENOENT recuperables si ya tiene evidencia", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-recoverable-analysis-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }));
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src/index.js"), "export default 1;");
  fs.writeFileSync(path.join(projectRoot, "src/app.js"), "export default 2;");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 14, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: "", toolCalls: [toolCall("read_file", { path: "vite.config.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "api/v1/chat.js" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "## Análisis del proyecto\n\nReporte basado en evidencia real.\n\n## Errores y riesgos encontrados\n\n- Faltan archivos referenciados.\n\n## Recomendaciones concretas\n\n- Crear los archivos ausentes.\n\n## Evidencia real de herramientas\n\n- package.json, src/index.js, src/app.js\n\nCuando autorices procedo con las correcciones." }), usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      if (name === "list_files") return [{ name: "package.json" }, { name: "src", isDirectory: true }];
      if (name === "read_file" && ["vite.config.js", "api/v1/chat.js"].includes(input.path)) {
        throw new Error(`ENOENT: no such file or directory, stat '${input.path}'`);
      }
      if (name === "read_file") return { path: input.path, content: `// ${input.path}\nexport default 1;\n`, isDirectory: false };
      return { ok: true, name, input };
    },
  };
  const result = await adapter.executeTask({
    prompt: "FOCO: package.json, src/index.js, src/app.js",
    projectRoot,
    requireEvidence: true,
    analysisMode: true,
    allowWrite: false,
    enforceController: true,
    maxIterations: 14,
  });
  assert.equal(result.completed, true);
  assert.ok(result.report.failedSteps >= 2);
  assert.match(result.text, /Reporte basado en evidencia real|An[aá]lisis del proyecto|Qu[eé] s[ií] funcion[oó]/);
  assert.match(result.text, /## Errores y riesgos encontrados|## Qu[eé] fall[oó]/);
});

test("read_file resuelve variantes cercanas antes de fallar por ENOENT", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /function resolveReadableProjectFile/);
  assert.match(source, /function buildReadFileNotFoundHint/);
  assert.match(source, /fileVariantCandidates\(requested\)/);
  assert.match(source, /path\.basename\(file\)\.replace/);
  assert.match(source, /resolvedFrom/);
  assert.match(source, /Archivos reales en/);
});

test("el controlador exige escribir y verificar una tarea de correccion", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-controller-");
  const executed = [];
  const adapter = session([
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "status.txt", content: "corrected\n" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido" }), usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({
    prompt: "Corrige status.txt y verifica con npm test",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
    enforceController: true,
  });
  assert.equal(result.completed, true);
  assert.match(result.text, /Corregido y verificado/);
  assert.match(result.text, /Evidencia de correccion|Evidencia real/);
  assert.deepEqual(executed.map((item) => item.name), ["read_file", "write_file", "run_command"]);
});

test("emite al chat el resultado de cada herramienta ejecutada", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-progress-events-");
  const executed = [];
  const progress = [];
  const adapter = session([
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "status.txt", content: "corrected\n" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({
    prompt: "corrige status.txt y verifica",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
    enforceController: true,
    onProgress: (event) => progress.push(event),
  });
  assert.equal(result.completed, true);
  assert.deepEqual(progress.filter((event) => event.phase === "tool" && event.stage === "done").map((event) => event.name), ["read_file", "write_file", "run_command"]);
  assert.deepEqual(progress.filter((event) => event.phase === "tool" && event.stage === "running").map((event) => event.name), ["read_file", "write_file", "run_command"]);
  const writeEvent = progress.find((event) => event.phase === "tool" && event.stage === "done" && event.name === "write_file");
  assert.equal(writeEvent.ok, true);
  assert.equal(writeEvent.input.path, "status.txt");
  assert.deepEqual(writeEvent.result, { name: "write_file", input: { path: "status.txt", content: "corrected\n" } });
});

test("una correccion no se agota leyendo antes de escribir", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-force-implementation-");
  const executed = [];
  const responses = [
    { text: "", toolCalls: [toolCall("list_files", { path: "" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("search_files", { query: "chat" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "src/chat.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "src/extra.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "src/chat.js", content: "ok\n" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ];
  const adapter = session(responses, executed);
  const result = await adapter.executeTask({
    prompt: "corrige el error del chat y verifica",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
    enforceController: true,
  });
  assert.equal(result.completed, true);
  assert.match(result.text, /Corregido y verificado/);
  assert.match(result.text, /Evidencia de correccion|Evidencia real/);
  assert.deepEqual(executed.map((item) => item.name), ["list_files", "read_file", "search_files", "read_file", "read_file", "write_file", "run_command"]);
});

test("maxTokens de la tarea reemplaza presupuestos internos demasiado bajos", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-effective-budget-");
  const executed = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 2, tokenBudget: 10, logger: { log() {}, warn() {}, error() {} } });
  const responses = [
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 100 } },
    { text: JSON.stringify({ type: "final", text: "Leido" }), usage: { total_tokens: 100 } },
  ];
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = { execute: async (name, input) => { executed.push({ name, input }); return { name, input }; } };
  const result = await adapter.executeTask({
    prompt: "Revisa status.txt",
    projectRoot,
    requireEvidence: true,
    allowWrite: false,
    enforceController: true,
    maxTokens: 50_000,
    maxIterations: 4,
  });
  assert.equal(result.completed, true);
  assert.equal(result.usage.budget.total, 80_000);

  assert.deepEqual(executed.map((item) => item.name), ["read_file"]);
});

test("sanitizeUserFacingReport elimina bloques de codigo e imports del chat", () => {
  const raw = [
    "## Errores y riesgos encontrados",
    "",
    "- **src/app/layout.tsx**",
    "```tsx",
    "import React from 'react'",
    "export default function Layout() {}",
    "```",
    "import { foo } from 'bar'",
    "src/app/page.tsx: import ChatInterface from '@/components/ChatInterface'; export default function Home() {",
    "",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  const cleaned = sanitizeUserFacingReport(raw);
  assert.match(cleaned, /Errores y riesgos encontrados/);
  assert.doesNotMatch(cleaned, /import React/);
  assert.doesNotMatch(cleaned, /import ChatInterface/);
  assert.doesNotMatch(cleaned, /```/);
  assert.match(cleaned, /src\/app\/page\.tsx/);
  assert.match(cleaned, /Cuando autorices procedo/);
});

test("analisis readonly exige reporte markdown, no resumen meta de evidencia", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-analysis-report-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo", scripts: { check: "node -v" } }, null, 2));
  let calls = 0;
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 6, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async (options) => {
    calls += 1;
    if (Array.isArray(options.tools) && options.tools.length === 0) {
      return {
        text: "## Análisis del proyecto\n\nProyecto detectado.\n\n## Errores y riesgos encontrados\n\n- package.json sin script de lint.\n\n## Recomendaciones concretas\n\n- Agregar eslint en package.json.\n\nCuando autorices procedo con las correcciones.",
        usage: { total_tokens: 40 },
      };
    }
    if (calls === 1) return { text: "", toolCalls: [toolCall("list_files", { path: "" })], usage: { total_tokens: 5 } };
    if (calls === 2) return { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } };
    if (calls === 3) return { text: "", toolCalls: [toolCall("search_files", { query: "lint" })], usage: { total_tokens: 5 } };
    if (calls === 4) return { text: "", toolCalls: [toolCall("read_file", { path: "README.md" })], usage: { total_tokens: 5 } };
    if (calls === 5) {
      return {
        text: "## Análisis del proyecto\n\nProyecto detectado.\n\n## Errores y riesgos encontrados\n\n- package.json sin script de lint.\n\n## Recomendaciones concretas\n\n- Agregar eslint en package.json.\n\nCuando autorices procedo con las correcciones.",
        toolCalls: [],
        usage: { total_tokens: 40 },
      };
    }
    return { text: "", toolCalls: [], usage: { total_tokens: 5 } };
  } };
  adapter.toolExecutor = { execute: async (name, input) => {
    if (name === "list_files") return [{ name: "package.json" }, { name: "README.md" }];
    if (name === "search_files") return [{ path: "package.json", line: 1, text: "lint" }];
    const target = path.join(projectRoot, input.path || "package.json");
    return { name, input, content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "" };
  } };
  const result = await adapter.executeTask({
    prompt: "FOCO: package.json",
    projectRoot,
    requireEvidence: true,
    allowWrite: false,
    analysisMode: true,
    enforceController: true,
  });
  assert.equal(result.completed, true);
  assert.doesNotMatch(result.text, /Verificacion completada con evidencia real/);
  assert.match(result.text, /## Errores y riesgos encontrados|## Qu[eé] fall[oó]/);
  assert.match(result.text, /Cuando autorices procedo con las correcciones/);
});

test("verificacion con evidencia suficiente no falla si el proveedor no emite final", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-evidence-final-");
  const executed = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  const responses = [
    { text: "", toolCalls: [toolCall("list_files", { path: "" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("search_files", { query: "build:web-app" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "web-app/vite.config.js" })], usage: { total_tokens: 5 } },
  ];
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = { execute: async (name, input) => { executed.push({ name, input }); return { name, input }; } };
  const result = await adapter.executeTask({
    prompt: "verifica el funcionamiento del chat y los modelos",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
    enforceController: true,
  });
  assert.equal(result.completed, true);
  assert.match(result.text, /Verificacion completada con evidencia real/);
  assert.equal(result.report.outcome, "completed");
  assert.deepEqual(executed.map((item) => item.name), ["list_files", "read_file", "search_files", "read_file"]);
});

test("OpenAI, Anthropic y Gemini reciben esquemas compatibles", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => requests.length === 1
        ? { choices: [{ message: { content: "ok" } }] }
        : requests.length === 2
          ? { content: [{ type: "text", text: "ok" }], usage: {} }
          : { candidates: [{ content: { parts: [{ text: "ok" }] } }], usageMetadata: {} },
    };
  };
  try {
    const tools = session([]).getAvailableTools({ allowWrite: false });
    const core = new AiCore();
    core.register({ id: "openai", kind: "openai-compatible", baseUrl: "https://example.invalid/v1" });
    core.register({ id: "anthropic", kind: "anthropic", baseUrl: "https://example.invalid/v1" });
    core.register({ id: "gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" });
    await core.complete({ provider: "openai", model: "m", apiKey: "x", messages: [{ role: "user", content: "x" }], tools });
    await core.complete({ provider: "anthropic", model: "m", apiKey: "x", messages: [{ role: "user", content: "x" }], tools });
    await core.complete({ provider: "gemini", model: "gemini-test", apiKey: "x", messages: [{ role: "user", content: "x" }], tools });
    assert.equal(requests[0].body.tools[0].function.name, "list_files");
    assert.equal(requests[1].body.tools[0].name, "list_files");
    assert.equal(requests[1].body.tools[0].input_schema.type, "object");
    assert.equal(requests[2].body.tools[0].functionDeclarations[0].name, "list_files");
    assert.match(requests[2].url, /generateContent\?key=x$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenAI compatible transmite narracion y reconstruye tool_calls SSE", async () => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const events = [
      { choices: [{ delta: { content: "Voy a leer el archivo. " } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "read_file", arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src/app.ts"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 4 } },
    ];
    const body = `${events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const chunks = [];
    const core = new AiCore();
    core.register({ id: "stream", kind: "openai-compatible", baseUrl: "https://example.invalid/v1" });
    const result = await core.complete({
      provider: "stream", model: "m", apiKey: "x",
      messages: [{ role: "user", content: "revisa" }],
      tools: session([]).getAvailableTools({ allowWrite: false }),
      onTextDelta: (value) => chunks.push(value),
    });
    assert.equal(requestBody.stream, true);
    assert.equal(chunks.join(""), "Voy a leer el archivo. ");
    assert.equal(result.toolCalls[0].function.name, "read_file");
    assert.equal(JSON.parse(result.toolCalls[0].function.arguments).path, "src/app.ts");
  } finally {
    global.fetch = originalFetch;
  }
});

test("SSE separa tool calls con id distinto aunque reutilicen el indice", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const events = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-list", function: { name: "list_files", arguments: '{"path":""}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-brain", function: { name: "brain_search", arguments: '{"query":"stack"}' } }] } }] },
    ];
    return new Response(`${events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const core = new AiCore();
    core.register({ id: "stream-multi", kind: "openai-compatible", baseUrl: "https://example.invalid/v1" });
    const result = await core.complete({ provider: "stream-multi", model: "m", apiKey: "x", messages: [{ role: "user", content: "revisa" }], onTextDelta() {} });
    assert.deepEqual(result.toolCalls.map((call) => call.function.name), ["list_files", "brain_search"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("un mensaje nuevo no se traga en steer: lanza otro agente", () => {
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PROCEDE"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PROCEDE NO TE DETENGAS"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("alto"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PORQUE TARDAS MAS DE LO NORMAL?"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("dime una respuesta"), false);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("corrige el login ahora"), false);
});

test("las solicitudes explicitas de correccion no se degradan a seguimiento de solo lectura", () => {
  assert.equal(ProjectAnalysis.classifyPromptIntent("esa app no puede modificar archivos, corrige permisos", true), "task");
  assert.equal(ProjectAnalysis.classifyPromptIntent("repara el agente para que pueda escribir", true), "task");
  assert.equal(ProjectAnalysis.isChangeRequest("soluciona los errores de permisos del proyecto"), true);
  for (const request of ["haz una pagina nueva", "arregla el chat", "resuelve la integracion", "conecta la API", "termina el proyecto"]) {
    assert.equal(ProjectAnalysis.isChangeRequest(request), true, request);
    assert.equal(agentTaskRequirements(request, true).write, true, request);
  }
});

test("Chat conserva analisis de solo lectura y escala cambios al Agente", () => {
  assert.deepEqual(ProjectAnalysis.resolveExecutionMode("analiza este proyecto", { requestedAgent: false, projectOpen: true }), {
    requestedAgent: false,
    projectOpen: true,
    explicitChangeRequest: false,
    autoEscalatedAgent: true,
    taskContinuation: false,
    isAgent: true,
    pathGiven: false,
    openNamedProject: false,
    referencedProjectName: "",
    closeProject: false,
    switchProject: false,
    missingProject: false,
  });
  assert.deepEqual(ProjectAnalysis.resolveExecutionMode("corrige este proyecto", { requestedAgent: false, projectOpen: true }), {
    requestedAgent: false,
    projectOpen: true,
    explicitChangeRequest: true,
    autoEscalatedAgent: true,
    taskContinuation: false,
    isAgent: true,
    pathGiven: false,
    openNamedProject: false,
    referencedProjectName: "",
    closeProject: false,
    switchProject: false,
    missingProject: false,
  });
  assert.equal(ProjectAnalysis.resolveExecutionMode("corrige este proyecto", { requestedAgent: false, projectOpen: false }).missingProject, true);
  const continuation = ProjectAnalysis.resolveExecutionMode("procede", { requestedAgent: false, projectOpen: true, resumableTask: true });
  assert.equal(continuation.isAgent, true);
  assert.equal(continuation.taskContinuation, true);

  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(source, /const isAgent = modeDecision\.isAgent;/);
  assert.match(source, /const planAuthorizedExecution = isPlanAuthorizedExecution/);
  assert.match(source, /AgentOrchestrator\.resolveUnifiedAgentPlan/);
  assert.match(source, /orchestratorPlan: plan/);
  assert.match(source, /const authorizedContinuation = planAuthorizedExecution/);
  assert.match(source, /needsAnalysisFirst: plan\.needsAnalysisFirst/);
  assert.match(source, /isAgentWorkflowQuestion/);
  assert.match(source, /answerAgentWorkflowQuestion/);
  assert.doesNotMatch(source, /await window\.editcoreAgent\.plan\(\{[\s\S]*runId: planRunId/);
  assert.match(source, /awaiting_authorization/);
  assert.doesNotMatch(source, /const explicitChangeRequest = modeDecision\.explicitChangeRequest;/);
  assert.match(source, /autoEscalatedAgent: plan\.autoEscalatedAgent \|\| modeDecision\.autoEscalatedAgent/);
  assert.match(source, /if \(job\.autoEscalatedAgent\)[\s\S]*\$\("runMode"\)\.value = "agent"/);
  assert.match(source, /Destino: \$\{projectDisplayName\(project\)\}[\s\S]*Modo: Agente[\s\S]*analizare el proyecto con herramientas/);
  assert.match(source, /if \(initialModeDecision\.missingProject\)[\s\S]*Indica una ruta absoluta/);
  assert.match(source, /Indica una ruta absoluta \(ej\. D:\\\\PROGRAMAS IA\) con Acceso completo, o abre un proyecto\./);
  assert.match(source, /function openNamedProjectFromPrompt/);
  assert.match(source, /function applyProjectUiCommand/);
  assert.match(source, /Esperando a que la aplicacion pinte contenido/);
  assert.match(source, /documentState === "blank"/);
  assert.match(source, /checkFailed \|\| result\?\.status === "checkFailed"/);
  assert.match(source, /No se pudo comprobar actualizaciones/);
  assert.match(source, /Esto no significa que EDITCOREAI este al dia/);
  assert.match(source, /isOpenNamedProjectRequest/);
  assert.match(source, /isCloseProjectRequest/);
  assert.match(source, /handleCloseProjectFromPrompt/);
  assert.match(source, /onUiCommand/);
  assert.match(mainSource, /name: "open_project"/);
  assert.match(mainSource, /name: "close_project"/);
  assert.match(mainSource, /name: "switch_project"/);
  assert.match(mainSource, /workspace:close-current/);
  assert.match(mainSource, /workspace:open-folder/);
  assert.match(mainSource, /workspace:switch-project/);
  assert.match(mainSource, /requestProjectUiAction/);
  assert.match(preloadSource, /onUiCommand/);
  assert.match(preloadSource, /replyUiCommand/);
  assert.match(preloadSource, /closeWorkspace/);
  assert.match(preloadSource, /openWorkspace/);
  assert.match(preloadSource, /switchProject/);
  assert.match(source, /function switchOpenProject\(/);
  assert.match(source, /action === "switch"/);
  assert.match(source, /ProjectAnalysis\.isTaskStatusQuestion\(effectivePrompt\)[\s\S]*durableAgentWorkflowStatusText\(project\)/);
  assert.match(source, /window\.editcoreAgent\.steer\(\{ instruction: effectivePrompt, runId: steeringRunId \}\)/);
  assert.match(source, /if \(result\?\.accepted\)[\s\S]*updateSteeringUI/);
  assert.doesNotMatch(source, /if \(result\?\.accepted\)[\s\S]*append\("assistant", response, \{ local_response: true/);
  assert.doesNotMatch(source, /Instruccion recibida e incorporada a la tarea activa/);
  assert.match(source, /promptOnlyMode: plan\.promptOnlyMode/);
  assert.doesNotMatch(source, /const analysisIntent = \["analysis", "followup"\]\.includes\(intent\)/);
  assert.doesNotMatch(source, /casualConversation/);
  assert.doesNotMatch(source, /\["analysis", "conversation", "followup"\]\.includes\(intent\)/);
  assert.doesNotMatch(source, /if \(isAgent && !authorized && !directReadOnly\)/);
  assert.match(source, /function allowsImmediateAgentExecution\(/);
  assert.match(source, /if \(isAgent && !directReadOnly && !immediateExecution\)/);
  assert.match(source, /planAuthorized: Boolean\(planAuthorizedExecution/);
  assert.doesNotMatch(source, /planAuthorized: planAuthorizedExecution \|\| job\.permissionMode === "full"/);
  assert.match(source, /freshAnalysis && effectiveAnalysisMode/);
  assert.match(source, /function applyPermissionMode\(mode\)/);
  assert.match(source, /state\.allowWrite = next !== "readonly"/);
  assert.match(source, /allowWrite: state\.permissionMode !== "readonly"/);
  assert.match(source, /effectiveAllowWrite[\s\S]*job\.permissionMode !== "readonly"/);
  assert.doesNotMatch(source, /state\.allowWrite = state\.permissionMode === "full"/);
  assert.doesNotMatch(source, /state\.allowWrite = mode === "full"/);

  assert.doesNotMatch(source, /Solicitud de analisis recibida/);
  assert.doesNotMatch(source, /cada accion aparecera aqui/);
  assert.match(source, /function canLaunchParallelAgent/);
  assert.match(source, /MAX_PARALLEL_AGENTS = 4/);
  assert.match(source, /shouldSteerLiveAgent\(effectivePrompt\)/);
  assert.match(source, /promptField\.value = ""/);
  assert.doesNotMatch(source, /nextWrite && !active\.some/);
  assert.doesNotMatch(source, /activeAgents === 0 \|\| next\.continueAuthorized/);
  assert.doesNotMatch(source, /job\.notBefore = Date\.now\(\) \+ 1500/);
  assert.match(source, /if \(!options\.force && agentLive\) return;/);
  assert.match(source, /addAgentNarrationDelta\(thinkingEl, progress\.text/);
  assert.match(source, /function appendAgentStreamDelta/);
  assert.match(source, /if \(phase === "startup"\)/);
  assert.match(source, /Iniciando analisis del proyecto/);
  assert.match(source, /const name = String\(progress\.name/);
  const progressFn = source.slice(source.indexOf("function agentProgressText"), source.indexOf("\nfunction ", source.indexOf("function agentProgressText") + 1));
  assert.ok(progressFn.indexOf("const name = ") < progressFn.indexOf("name.replace"), "name debe definirse antes de usarse en agentProgressText");
  assert.match(source, /evidencia de verificacion; no es fallo de la herramienta/);
  assert.match(source, /UX Cursor: el progreso se escribe en el chat\/thinking/);
  assert.match(source, /panel\.setAttribute\("hidden", "true"\)/);
  assert.match(source, /const authorized = !isAgent \|\| authorizedContinuation \|\| continueAuthorized \|\| planAuthorizedExecution;/);
  assert.match(source, /ProjectAnalysis\.recoveryPrompt\(\{ \.\.\.project\.agentWorkflow, task: storedTask \}, prompt\)/);
  assert.match(source, /await saveAgentTaskPrompt\(project\.agentWorkflow\.taskId, executionPrompt\)/);
  assert.match(source, /ProjectAnalysis\.authorizedPlanExecutionPrompt/);
  assert.match(source, /needsAnalysisFirst/);
  assert.match(source, /requireEvidence: plan\.isAgent \|\| projectRequest/);
  assert.doesNotMatch(source, /fullAutoMode && !hasResumableAgentTask/);
  assert.match(source, /const readOnlyChat = !plan\.isAgent && projectRequest;/);
  assert.match(source, /\["analysis", "task"\]\.includes\(intent\)/);
  assert.doesNotMatch(source, /Chat no accede al disco ni ejecuta herramientas/);
  assert.doesNotMatch(source, /agent-steps-log/);
  assert.match(source, /agent-narrative-log/);
  assert.match(source, /const bootPermission = \["readonly", "step", "full"\]\.includes\(state\.permissionMode\) \? state\.permissionMode : "step";/);
  assert.doesNotMatch(source, /setPermission\("step"\)\.then/);
  const executionStart = source.indexOf("async function executePromptJob");
  const executionFlow = source.slice(executionStart, source.indexOf("window.editcoreAgent.onProgress", executionStart));
  assert.ok(executionFlow.indexOf("const thinking = appendThinking") < executionFlow.indexOf("await ensureAgentModelCapability(job)"));
  assert.match(source, /job\.planRunId \|\| job\.runId/);
  assert.match(source, /window\.editcoreAgent\.cancel\(\{ runId: "" \}\)/);
});

test("procede despues de analisis activa reparacion autorizada", () => {
  assert.equal(ProjectAnalysis.isAuthorization("procede con los cambios"), true);
  const sampleReport = [
    "## Análisis del proyecto",
    "Revisé el proyecto en modo solo lectura.",
    "## Errores y riesgos encontrados",
    "Variables de entorno incompletas.",
    "## Recomendaciones concretas",
    "Completa .env con credenciales reales.",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  assert.equal(ProjectAnalysis.isAnalysisReport(sampleReport), true);
  const caliliStyleReport = [
    "REPORTE DE ANÁLISIS - PROYECTO CALILI",
    "ERRORES CRÍTICOS IDENTIFICADOS",
    "El micrófono no inicia captura correctamente.",
    "CORRECCIONES REQUERIDAS",
    "Refactorizar componente de entrada de voz.",
    "¿Deseas que proceda a aplicar las correcciones identificadas?",
  ].join("\n");
  assert.equal(ProjectAnalysis.isPendingAnalysisPlan(caliliStyleReport), true);
  assert.equal(ProjectAnalysis.isAnalysisReport(caliliStyleReport), true);
  assert.match(ProjectAnalysis.normalizeAnalysisReport(caliliStyleReport), /## Qu[eé] s[ií] funcion[oó]|## An[aá]lisis del proyecto/);
  assert.equal(ProjectAnalysis.isFreshAnalysisRequest("arranca"), true);
  assert.equal(ProjectAnalysis.isFreshAnalysisRequest("procede"), false);
  const execReq = agentTaskRequirements("## Análisis\nCuando autorices procedo", true, { planAuthorized: true });
  assert.equal(execReq.write, true);
  assert.equal(execReq.analysisOnly, false);
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(source, /function ensureWorkflowFromPendingPlan/);
  assert.match(source, /function findPendingAnalysisPlan/);
  assert.match(source, /ProjectAnalysis\.isPendingAnalysisPlan/);
  assert.match(source, /phase === "interrupted" && ProjectAnalysis\.isAnalysisReport/);
  assert.match(source, /job\.needsAnalysisFirst \|\| ProjectAnalysis\.isFreshAnalysisRequest/);
  assert.match(source, /analysisReportReady/);
  assert.match(source, /executionMode/);
  assert.doesNotMatch(source, /if \(job\.planAuthorizedExecution\) job\.taskId = ""/);
  assert.match(source, /autoResumeRecommended/);
  assert.match(source, /effectiveAnalysisMode/);
  assert.match(source, /function analysisRepairPrompt/);
  assert.match(source, /analysisRepairAuthorization = true;/);
  assert.match(source, /effectivePrompt = analysisRepairPrompt\(project\.analysisMemory, effectivePrompt\);/);
  assert.match(source, /job\.continueAuthorized = true;/);
  assert.match(source, /job\.directReadOnly = false;/);
  assert.doesNotMatch(source, /El analisis de \$\{project\.analysisMemory\.projectName/);
});

test("errores temporales del proveedor tienen fallback de perfiles activos", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /function isTransientProviderError/);
  assert.match(source, /function fallbackProviderProfiles/);
  assert.match(source, /function fallbackProviderProfiles\([\s\S]*?const secure = readSecureState\(\);/);
  assert.match(source, /allowProviderFallback = true/);
  assert.match(source, /provider_fallback_used/);
  assert.match(source, /fallback_from_model/);
  assert.equal(require("../agent-runtime").isRetryableProviderStatus(524), true);
});

test("HTTP 524 reintenta y completa el analisis sin perder evidencia", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-524-retry-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }));
  const files = Array.from({ length: 3 }, (_, index) => `status-${index + 1}.txt`);
  for (const file of files) fs.writeFileSync(path.join(projectRoot, file), "ok\n", "utf8");
  let calls = 0;
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 16, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = { call: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("HTTP 524"), { status: 524 });
    if (calls <= files.length + 1) return { text: "", toolCalls: [toolCall("read_file", { path: files[calls - 2] })], usage: { total_tokens: 5 } };
    return { text: "Reporte recuperado despues del 524.", toolCalls: [], usage: { total_tokens: 5 } };
  } };
  adapter.toolExecutor = { execute: async (name, input) => {
    if (name === "list_files") return ["package.json", ...files].map((f) => ({ name: f, isDirectory: false }));
    return { path: input?.path, content: "ok" };
  } };
  const result = await adapter.executeTask({ prompt: "FOCO: status-1.txt, status-2.txt, status-3.txt", projectRoot, allowWrite: false, analysisMode: true, requireEvidence: true, enforceController: true, maxIterations: 16 });
  assert.equal(result.completed, true);
  assert.ok(calls >= 1);
});

test("EDITCOREAI no conserva el proveedor obsoleto como proveedor ni bridge de chat", () => {
  const obsoleteProviderPattern = new RegExp("aia" + "piflow", "i");
  for (const file of ["main.js", "preload.js", "renderer.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, obsoleteProviderPattern, file);
  }
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /openai:\s+\{\s*label:\s*"OpenAI"/);
  assert.match(renderer, /anthropic:\s*\{\s*label:\s*"Anthropic"/);
  assert.match(renderer, /gemini:\s+\{\s*label:\s*"Gemini"/);
});

test("el paso durable conserva la herramienta ejecutada", () => {
  assert.equal(createStepModel({ toolName: "read_file" }).toolName, "read_file");
});

test("el agente expone y registra la capacidad de crear proyectos", () => {
  const adapter = session([]);
  assert.ok(adapter.getAvailableTools({ allowWrite: true }).some((item) => item.function.name === "create_project"));
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /name: "create_project"/);
  assert.match(source, /toolName: step\.name/);
});

test("agent run conserva taskId y no usa adaptador global", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /let taskId = String\(input\.taskId \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(source, /getClaudeAdapter\(\)/);
  assert.match(source, /COMPLETION_VALIDATED/);
});

test("el reporte del agente proyecta archivos cambiados y verificaciones reales", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(source, /classifyAgentStep\(step\) === "mutation"/);
  assert.match(source, /verificationStepPassed\(step\)/);
  assert.match(source, /changedFiles,/);
  assert.match(source, /verificationCommands,/);
});

test("el planificador propone y espera autorizacion sin ejecutar", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /Esta fase solo propone: nunca afirmes que ejecutaste/);
  assert.match(source, /No muestres nombres internos de herramientas/);
  assert.match(source, /Cuando autorices procedo con los cambios\./);
  assert.match(source, /const AGENT_PLAN_TIMEOUT_MS = 180_000;/);
  assert.match(source, /timeoutMs: AGENT_PLAN_TIMEOUT_MS/);
  assert.match(source, /const planReference = tasks\(\)\.reference\(planText/);
  assert.match(source, /PLAN_CREATED/);
  assert.match(source, /durableTaskContext = \[/);
  assert.match(source, /Plan autorizado:\\n\$\{recovered\.plan\.content\}/);
  assert.doesNotMatch(source, /agent:plan[\s\S]*timeoutMs: 30_000/);
});

test("la verificacion de modelo no bloquea la fase de plan", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const executionStart = source.indexOf("async function executePromptJob");
  const executionFlow = source.slice(executionStart, source.indexOf("const plan = await window.editcoreAgent.plan", executionStart));
  assert.match(executionFlow, /if \(!isAgent \|\| authorized \|\| directReadOnly\) \{[\s\S]*await ensureAgentModelCapability\(job\);/);
  assert.match(executionFlow, /Continuando con el agente/);
  assert.doesNotMatch(executionFlow, /addAgentNarration\(thinking, `Modelo \$\{job\.model\} confirmado/);
});

test("el ciclo durable registra run, pasos, checkpoint, tokens y final validado", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-task-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new TaskManager({ store: new TaskStore({ root }) });
  const task = manager.createTask({
    projectId: "temporary-project",
    projectRoot: root,
    goal: "Leer y verificar el proyecto temporal",
    status: "READY",
  });
  const run = manager.startRun(task.taskId, { taskStatus: "IMPLEMENTING", stage: "implementation" });
  const step = manager.startStep(task.taskId, run.runId, {
    stage: "implementation",
    goal: "Leer package.json",
    actionId: "action-read-package",
  });
  manager.completeStep(task.taskId, step.stepId, { ok: true, result: { path: "package.json" } });
  const checkpoint = manager.checkpoint(task.taskId, {
    completedSteps: [{ name: "read_file", ok: true }],
    verificationStatus: "passed",
  });
  manager.updateTokenUsage(task.taskId, run.runId, { total_tokens: 42, provider_calls: 2 });
  manager.updateRun(task.taskId, run.runId, { status: "COMPLETED" });
  manager.recordRuntimeEvent(task.taskId, "COMPLETION_VALIDATED", { runId: run.runId });
  const completed = manager.markTaskCompleted(task.taskId, { verificationStatus: "passed" });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.tokenUsageSummary.totalTokens, 42);
  assert.equal(completed.tokenUsageSummary.calls, 2);
  assert.equal(manager.getCheckpoint(task.taskId).checkpointId, checkpoint.checkpointId);
  assert.ok(manager.getEvents(task.taskId).some((event) => event.type === "COMPLETION_VALIDATED"));
  assert.equal(manager.validateConsistency(task.taskId).ok, true);
});

test("aceptacion local: el agente modifica y verifica solo un proyecto temporal", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-agent-acceptance-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectRoot, "status.txt"), "before\n", "utf8");

  const adapter = session([
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 10 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "status.txt", content: "after\n" })], usage: { total_tokens: 11 } },
    { text: JSON.stringify({ type: "final", text: "Terminado" }), usage: { total_tokens: 12 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 13 } },
    { text: JSON.stringify({ type: "final", text: "Modificado y verificado" }), usage: { total_tokens: 14 } },
  ]);
  adapter.toolExecutor = {
    async execute(name, input) {
      const target = path.resolve(projectRoot, String(input.path || ""));
      const relative = path.relative(projectRoot, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Ruta fuera del proyecto temporal");
      if (name === "read_file") return { path: input.path, content: fs.readFileSync(target, "utf8") };
      if (name === "write_file") {
        fs.writeFileSync(target, String(input.content || ""), "utf8");
        return { path: input.path, bytes: Buffer.byteLength(String(input.content || "")) };
      }
      throw new Error(`Herramienta inesperada: ${name}`);
    },
  };

  const result = await adapter.executeTask({
    prompt: "Cambia status.txt y verifica el resultado",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
  });

  assert.equal(result.completed, true);
  assert.match(result.text, /Modificado y verificado/);
  assert.match(result.text, /Evidencia de correccion|status\.txt/);
  assert.equal(result.usage.provider_calls, 5);
  assert.equal(result.usage.total_tokens, 60);
  assert.deepEqual(result.steps.map((step) => step.name), ["read_file", "write_file", "read_file"]);
  assert.equal(fs.readFileSync(path.join(projectRoot, "status.txt"), "utf8"), "after\n");
});
