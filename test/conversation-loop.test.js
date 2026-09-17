"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ConversationLog } = require("../runtime/conversation-log");
const { ActionRegistry } = require("../runtime/action-registry");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
const { normalizeForAnthropic, normalizeForGemini } = require("../runtime/ai-core");

function toolCall(name, input = {}, id = "") {
  return { id: id || `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(input) } };
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

test("cada tool_call recibe exactamente un tool_result, incluidos los rechazados", () => {
  const log = new ConversationLog({ prefixMessages: [{ role: "system", content: "s" }, { role: "user", content: "tarea" }] });
  const calls = log.appendAssistant({ text: "Voy a leer dos archivos.", toolCalls: [toolCall("read_file", { path: "a.js" }), toolCall("read_file", { path: "b.js" }, "call-b")] });
  assert.equal(calls.length, 2);
  assert.equal(log.pendingToolCallIds().length, 2);
  log.appendToolResult(calls[0].id, "read_file", { content: "ok" });
  log.appendToolResult(calls[1].id, "read_file", { error: "rechazado por politica" });
  assert.deepEqual(log.pendingToolCallIds(), []);
  const messages = log.toProviderMessages();
  const toolMessages = messages.filter((item) => item.role === "tool");
  assert.equal(toolMessages.length, 2);
  assert.match(toolMessages[1].content, /rechazado por politica/);
});

test("la firma de contexto cambia tras un rechazo (regresion anti-bucle)", () => {
  const log = new ConversationLog({ prefixMessages: [{ role: "system", content: "s" }, { role: "user", content: "tarea" }] });
  log.appendAssistant({ text: '{"type":"final","text":"listo"}', toolCalls: [] });
  const before = log.contextSignature();
  log.appendUser("VALIDACION DE EDITCORE: no hay evidencia, usa herramientas.");
  const after = log.contextSignature();
  assert.notEqual(before, after);
});

test("compact preserva el prefijo y los ultimos turnos sin romper pares tool_call/result", () => {
  const log = new ConversationLog({
    prefixMessages: [{ role: "system", content: "sistema estable" }, { role: "user", content: "tarea inicial" }],
    maxChars: 4_000,
    keepLastTurns: 4,
  });
  for (let i = 0; i < 30; i++) {
    const calls = log.appendAssistant({ text: `paso ${i}`, toolCalls: [toolCall("read_file", { path: `file-${i}.js` })] });
    log.appendToolResult(calls[0].id, "read_file", { content: "x".repeat(1_500) });
  }
  const messages = log.toProviderMessages();
  assert.equal(messages[0].content, "sistema estable");
  assert.equal(messages[1].content, "tarea inicial");
  assert.match(messages[2].content, /RESUMEN DE EVIDENCIA PREVIA/);
  // Ningun tool message sin su assistant precedente en la ventana conservada.
  const kept = messages.slice(3);
  for (const [index, item] of kept.entries()) {
    if (item.role !== "tool") continue;
    const previous = kept.slice(0, index).reverse().find((candidate) => candidate.role === "assistant");
    assert.ok(previous && (previous.tool_calls || []).some((call) => call.id === item.tool_call_id));
  }
  assert.ok(JSON.stringify(messages).length < 20_000);
});

test("el agente audita y compacta contexto preventivamente antes de cada llamada", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-proactive-compact-");
  fs.writeFileSync(path.join(projectRoot, "status.txt"), "ok\n", "utf8");
  const adapter = session([
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 5 } },
    { text: "Listo", toolCalls: [], usage: { total_tokens: 5 } },
  ]);
  const originalBuild = adapter.buildPrefixMessages.bind(adapter);
  adapter.buildPrefixMessages = (input) => [
    ...originalBuild(input),
    { role: "system", content: "x".repeat(79_000) },
  ];
  const result = await adapter.executeTask({ prompt: "Revisa status.txt", projectRoot, allowWrite: false, requireEvidence: true, enforceController: true });
  assert.equal(result.completed, true);
  assert.ok(result.usage.context_compaction_count >= 0);
  assert.equal(adapter.conversation.maxChars, 80_000);
  assert.equal(adapter.conversation.keepLastTurns, 8);

  const log = new ConversationLog({ prefixMessages: [{ role: "system", content: "estable" }], maxChars: 80_000, keepLastTurns: 8 });
  for (let index = 0; index < 20; index += 1) log.appendUser(`evidencia-${index}:` + "x".repeat(6_000));
  const messages = log.toProviderMessages();
  assert.ok(log.compactedTurns > 0);
  assert.match(messages[1].content, /RESUMEN DE EVIDENCIA PREVIA/);
  assert.ok(JSON.stringify(messages).length < 80_000);
});

test("ids sinteticos duplicados (Gemini) se distinguen por turno", () => {
  const log = new ConversationLog({ prefixMessages: [] });
  const first = log.appendAssistant({ toolCalls: [toolCall("read_file", { path: "a" }, "gemini-0")] });
  log.appendToolResult(first[0].id, "read_file", { ok: true });
  const second = log.appendAssistant({ toolCalls: [toolCall("read_file", { path: "b" }, "gemini-0")] });
  assert.notEqual(first[0].id, second[0].id);
});

test("el adaptador narra la prosa del modelo antes de ejecutar herramientas", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-narration-");
  const progress = [];
  const adapter = session([
    { text: "Voy a revisar el archivo principal para entender la estructura.", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Revision terminada" }), usage: { total_tokens: 5 } },
  ]);
  await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false, onProgress: (event) => progress.push(event) });
  const narration = progress.filter((event) => event.phase === "narration");
  assert.equal(narration.length, 1);
  assert.match(narration[0].text, /revisar el archivo principal/);
  // El texto protocolar JSON nunca se narra.
  assert.ok(!progress.some((event) => event.phase === "narration" && /"type"/.test(event.text)));
});

test("varios tool_calls en un turno se ejecutan todos y quedan emparejados", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-multitool-");
  const executed = [];
  const adapter = session([
    { text: "Leo ambos archivos.", toolCalls: [toolCall("read_file", { path: "a.js" }), toolCall("read_file", { path: "b.js" }, "call-b")], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Listo" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({ prompt: "Revisa a y b", projectRoot, requireEvidence: true, allowWrite: false });
  assert.equal(result.completed, true);
  assert.deepEqual(executed.map((item) => item.input.path), ["a.js", "b.js"]);
  assert.deepEqual(adapter.conversation.pendingToolCallIds(), []);
});

test("fallback JSON textual: sin tool_calls nativos el protocolo sigue funcionando", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-jsonfallback-");
  const executed = [];
  const adapter = session([
    { text: JSON.stringify({ type: "tool", name: "read_file", input: { path: "package.json" } }), toolCalls: [], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Analisis listo" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false });
  assert.equal(result.completed, true);
  assert.deepEqual(executed.map((item) => item.name), ["read_file"]);
  // Sin call id, el resultado viaja como mensaje de usuario.
  const messages = adapter.conversation.toProviderMessages();
  assert.ok(messages.some((item) => item.role === "user" && /Resultado de read_file/.test(String(item.content))));
});

test("un final rechazado agrega feedback a la conversacion y el contexto cambia", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-feedback-");
  const signatures = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 6, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: JSON.stringify({ type: "final", text: "Todo listo" }), usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Ahora si" }), usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = { call: async () => { signatures.push(adapter.conversation.contextSignature()); return responses.shift(); } };
  adapter.toolExecutor = { execute: async (name, input) => ({ name, input }) };
  const result = await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false });
  assert.equal(result.completed, true);
  assert.equal(new Set(signatures).size, signatures.length, "cada llamada al proveedor debe recibir un contexto distinto");
  const messages = adapter.conversation.toProviderMessages();
  assert.ok(messages.some((item) => item.role === "user" && /VALIDACION DE EDITCORE/.test(String(item.content))));
});

test("los normalizadores de ai-core conservan la conversacion con tool_calls", () => {
  const conversation = [
    { role: "system", content: "sistema" },
    { role: "user", content: "tarea" },
    { role: "assistant", content: "Voy a leer.", tool_calls: [toolCall("read_file", { path: "a.js" })] },
    { role: "tool", tool_call_id: "call-read_file", name: "read_file", content: JSON.stringify({ ok: true }) },
    { role: "assistant", content: "Listo." },
  ];
  const anthropic = normalizeForAnthropic(conversation);
  assert.equal(anthropic.filter((item) => item.role === "assistant").length, 2);
  assert.ok(anthropic.some((item) => Array.isArray(item.content) && item.content.some((part) => part.type === "tool_use" && part.name === "read_file")));
  assert.ok(anthropic.some((item) => Array.isArray(item.content) && item.content.some((part) => part.type === "tool_result" && part.tool_use_id === "call-read_file")));
  const gemini = normalizeForGemini(conversation);
  assert.ok(gemini.some((item) => item.parts?.some((part) => part.functionCall?.name === "read_file")));
  assert.ok(gemini.some((item) => item.parts?.some((part) => part.functionResponse)));
  assert.equal(gemini.length, conversation.length - 1);
});

test("en modo tarea un fallo no repetido permite auto-correccion y la corrida termina", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-selfrepair-");
  const executed = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 8, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: "Ejecuto la verificacion.", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: "Fallo; corrijo el archivo.", toolCalls: [toolCall("write_file", { path: "a.js", content: "fixed" })], usage: { total_tokens: 5 } },
    { text: "Verifico de nuevo.", toolCalls: [toolCall("run_command", { command: "npm run check" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      executed.push({ name, input });
      if (name === "run_command" && input.command === "npm test") throw new Error("1 test fallido");
      return { name, input };
    },
  };
  const result = await adapter.executeTask({ prompt: "corrige a.js y verifica", projectRoot, requireEvidence: true, allowWrite: true, enforceController: true });
  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.deepEqual(executed.map((item) => item.name), ["run_command", "write_file", "run_command"]);
});

test("una tarea escrita y verificada termina aunque el proveedor falle antes del mensaje final", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-evidence-finish-");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 8, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: "", toolCalls: [toolCall("read_file", { path: "status.txt" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "status.txt", content: "fixed" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run check" })], usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = {
    call: async () => {
      if (!responses.length) {
        const error = new Error("Proveedor temporalmente no disponible");
        error.status = 503;
        throw error;
      }
      return responses.shift();
    },
  };
  adapter.toolExecutor = { execute: async (name, input) => ({ name, input }) };

  const result = await adapter.executeTask({
    prompt: "haz que status.txt quede corregido y verifica",
    projectRoot,
    requireEvidence: true,
    allowWrite: true,
    enforceController: true,
  });
  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.equal(result.report.completed, true);
  assert.match(result.text, /Verificacion completada con evidencia real/);
});

test("una verificacion anterior a la escritura no permite declarar la tarea completa", () => {
  const result = require("../agent-runtime").validateAgentCompletion("corrige status.txt y verifica", [
    { name: "read_file", input: { path: "status.txt" }, result: { content: "old" }, ok: true },
    { name: "run_command", input: { command: "npm run check" }, result: "ok", ok: true },
    { name: "write_file", input: { path: "status.txt", content: "fixed" }, result: { path: "status.txt" }, ok: true },
  ], true, { projectRoot: "C:/project" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /falta una verificacion real/);
});

test("fallos recuperables distintos no cancelan una tarea que despues progresa", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-recoverable-errors-");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 10, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run build 2>&1" }, "recover-1")], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "a.js", oldText: "ausente", newText: "x" }, "recover-2")], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "node -e test" }, "recover-3")], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "a.js", content: "fixed" }, "recover-4")], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run check" }, "recover-5")], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      if (input.command === "npm run build 2>&1") throw new Error("Comando no permitido");
      if (input.oldText === "ausente") throw new Error("oldText no existe; vuelve a leer");
      if (input.command === "node -e test") throw new Error("Argumento no permitido para node");
      return { name, input };
    },
  };
  const result = await adapter.executeTask({ prompt: "corrige a.js y verifica", projectRoot, requireEvidence: true, allowWrite: true, enforceController: true });
  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.equal(result.steps.filter((step) => step.ok === false).length, 3);
});

test("la misma accion fallando dos veces detiene la corrida en modo tarea", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-repeatfail-");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 8, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  const responses = [
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" }, "call-2")], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" }, "call-3")], usage: { total_tokens: 5 } },
  ];
  adapter.providerApi = { call: async () => responses.shift() };
  adapter.toolExecutor = { execute: async () => { throw new Error("fallo persistente"); } };
  const result = await adapter.executeTask({ prompt: "corrige y verifica", projectRoot, requireEvidence: true, allowWrite: true });
  assert.equal(result.completed, false);
  assert.match(result.report.stopReason, /misma accion fallo dos veces/);
  assert.equal(result.usage.provider_calls <= 3, true);
});

test("analisis bootstrap lee el proyecto real y descarta reporte Vite inventado", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-bootstrap-analysis-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "calili-like",
    scripts: { dev: "next dev", build: "next build" },
    dependencies: { next: "14.0.0", react: "18.0.0" },
  }, null, 2));
  fs.writeFileSync(path.join(projectRoot, "next.config.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(projectRoot, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# demo\n");
  fs.mkdirSync(path.join(projectRoot, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "app", "page.tsx"), "export default function Page(){ return null }\n");

  const executed = [];
  const progress = [];
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = {
    call: async () => ({
      text: [
        "REPORTE DE ANALISIS",
        "Vite + React",
        "vite.config.js",
        "src/App.jsx",
        "Cuando autorices procedo con las correcciones.",
      ].join("\n"),
      toolCalls: [],
      usage: { total_tokens: 12 },
    }),
  };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      executed.push({ name, input: { ...input } });
      if (name === "list_files") {
        const rel = String(input.path || "").replace(/^[/\\]+/, "");
        const dir = rel ? path.join(projectRoot, rel) : projectRoot;
        return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          path: rel ? path.posix.join(rel.replace(/\\/g, "/"), entry.name) : entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }));
      }
      if (name === "read_file") {
        const content = fs.readFileSync(path.join(projectRoot, String(input.path)), "utf8");
        return { path: input.path, content, isDirectory: false };
      }
      throw new Error(`herramienta inesperada: ${name}`);
    },
  };

  const result = await adapter.executeTask({
    prompt: "analiza este proyecto y reporta errores",
    projectRoot,
    analysisMode: true,
    allowWrite: false,
    requireEvidence: true,
    enforceController: true,
    onProgress: (event) => progress.push(event),
  });

  assert.ok(executed.some((item) => item.name === "list_files"));
  assert.ok(executed.some((item) => item.name === "read_file" && item.input.path === "package.json"));
  assert.ok(executed.filter((item) => item.name === "read_file").length >= 3);
  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.equal(result.report.completed, true);
  assert.match(result.text, /An[aá]lisis|package\.json|next\.config/i);
  assert.doesNotMatch(result.text, /Vite\s*\+\s*React|vite\.config\.js|src\/App\.jsx/);
  assert.ok(!progress.some((event) => event.phase === "narration_delta" && /Vite\s*\+\s*React/i.test(event.text || "")));
});

test("PROCEDE no acepta 'no tengo acceso al sistema de archivos' como cierre", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-false-no-access-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }, null, 2));
  fs.writeFileSync(path.join(projectRoot, "index.js"), "console.log(1);\n");

  let calls = 0;
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = {
    call: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: "NO TENGO ACCESO A TU SISTEMA DE ARCHIVOS. NO PUEDO CONTINUAR.",
          toolCalls: [],
          usage: { total_tokens: 8 },
        };
      }
      return {
        text: "",
        toolCalls: [toolCall("replace_in_file", { path: "index.js", old_string: "console.log(1);", new_string: "console.log(2);" })],
        usage: { total_tokens: 8 },
      };
    },
  };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      if (name === "replace_in_file") {
        const target = path.join(projectRoot, input.path);
        const current = fs.readFileSync(target, "utf8");
        fs.writeFileSync(target, current.replace(input.old_string, input.new_string));
        return { path: input.path, ok: true };
      }
      if (name === "list_files") return [{ name: "index.js", path: "index.js", kind: "file" }];
      if (name === "read_file") return { path: input.path, content: fs.readFileSync(path.join(projectRoot, input.path), "utf8") };
      throw new Error(name);
    },
  };

  const result = await adapter.executeTask({
    prompt: "PROCEDE",
    projectRoot,
    analysisMode: false,
    allowWrite: true,
    planAuthorized: true,
    requireEvidence: true,
    enforceController: true,
  });
  assert.doesNotMatch(result.text || "", /NO TENGO ACCESO A TU SISTEMA DE ARCHIVOS/i);
  assert.ok(calls >= 2, "debe reintentar tras el falso bloqueo de acceso");
  assert.ok(
    result.steps?.some((step) => step.name === "replace_in_file" && step.ok !== false)
      || /SI tiene acceso|PROCEDE/i.test(result.text || ""),
    result.stopReason || result.text,
  );
});

test("analisis no abandona si el modelo dice que no tiene list_files", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-missing-tools-claim-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "next dev" } }, null, 2));
  fs.writeFileSync(path.join(projectRoot, "next.config.js"), "module.exports={};\n");
  fs.mkdirSync(path.join(projectRoot, "src"));
  fs.writeFileSync(path.join(projectRoot, "src", "main.ts"), "export const ok = 1;\n");

  const adapter = new EditCoreClaudeAdapter({ maxIterations: 3, tokenBudget: 50_000, logger: { log() {}, warn() {}, error() {} } });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = {
    call: async () => ({
      text: "Problema: No tengo acceso a las herramientas list_files, read_file o search_files en este entorno. Pega package.json.",
      toolCalls: [],
      usage: { total_tokens: 8 },
    }),
  };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      if (name === "list_files") {
        const rel = String(input.path || "");
        const dir = rel ? path.join(projectRoot, rel) : projectRoot;
        return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          path: rel ? `${rel}/${entry.name}` : entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }));
      }
      if (name === "read_file") {
        return { path: input.path, content: fs.readFileSync(path.join(projectRoot, input.path), "utf8"), isDirectory: false };
      }
      throw new Error(name);
    },
  };

  const result = await adapter.executeTask({
    prompt: "analiza",
    projectRoot,
    analysisMode: true,
    allowWrite: false,
    requireEvidence: true,
    enforceController: true,
  });
  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.match(result.text, /An[aá]lisis|package\.json/i);
  assert.doesNotMatch(result.text, /Pega package\.json|No tengo acceso a las herramientas list_files/i);
});

test("main.js declara la resolucion de ejecutables de Windows y la confirmacion externa", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /function resolveWindowsExecutable/);
  assert.match(source, /function externalMutationKind/);
  assert.match(source, /confirmExternalAgentAction/);
  assert.match(source, /rawToolCalls: true/);
  assert.match(source, /function isProviderToolUnsupported/);
  assert.match(source, /function spawnCommandOutput/);
  assert.match(source, /shell: true/);
  assert.match(source, /isProjectDevServerCommand/);
});

test("main.js registra capacidades por modelo y hace fallback de modelo en el gateway", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /function recordModelCapability/);
  assert.match(source, /function capabilityFallbackCandidates/);
  assert.match(source, /function isModelUnavailableError/);
  assert.match(source, /isRecoverableModelError\(lastError\)/);
  assert.match(source, /isModelUnavailableError\(lastError\)/);
  assert.match(source, /recordModelCapability\(\{ baseUrl: endpoint, model: activeModel, providerKey: activeProviderKey, ok: true/);
});

test("el adaptador no narra el cambio automatico de modelo tras un fallback", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-model-fallback-");
  const progress = [];
  const adapter = session([
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 }, fallback: { from: { model: "meai/gpt-5.5" }, to: { model: "apicredits/claude-sonnet-5" } } },
    { text: JSON.stringify({ type: "final", text: "Listo" }), usage: { total_tokens: 5 } },
  ]);
  await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false, onProgress: (event) => progress.push(event) });
  const narration = progress.filter((event) => event.phase === "narration");
  assert.ok(!narration.some((event) => /continúo automáticamente|falló|no respondió/i.test(String(event.text || ""))));
});

test("una accion repetida no crea pasos nuevos y el modelo recibe correccion (anti-repeticion)", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-repeat-");
  const executed = [];
  const progress = [];
  const adapter = session([
    { text: "Leo package.json.", toolCalls: [toolCall("read_file", { path: "package.json" }, "c1")], usage: { total_tokens: 5 } },
    { text: "Lo leo otra vez.", toolCalls: [toolCall("read_file", { path: "package.json" }, "c2")], usage: { total_tokens: 5 } },
    { text: "Y otra vez.", toolCalls: [toolCall("read_file", { path: "package.json" }, "c3")], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Listo" }), usage: { total_tokens: 5 } },
  ], executed);
  const result = await adapter.executeTask({ prompt: "Revisa el proyecto", projectRoot, requireEvidence: true, allowWrite: false, onProgress: (event) => progress.push(event) });
  // Solo se ejecuto una vez de verdad y las repeticiones usan CACHE HIT.
  assert.equal(executed.length, 1);
  assert.equal(result.steps.filter((s) => !s.cached).length, 1);
  assert.equal(progress.filter((event) => event.phase === "tool" && event.stage === "done" && !event.cached).length, 1);
  // Cada tool_call repetido igual recibio su resultado (correccion) y la conversacion avanza.
  assert.deepEqual(adapter.conversation.pendingToolCallIds(), []);
  const messages = adapter.conversation.toProviderMessages();
  assert.ok(/CACHE HIT|deja de repetir|Ya ejecutaste/i.test(JSON.stringify(messages)));
});

test("la memoria de la corrida anterior entra al prefijo de la conversacion", () => {
  const adapter = new EditCoreClaudeAdapter({ logger: { log() {}, warn() {}, error() {} } });
  const messages = adapter.buildPrefixMessages({
    prompt: "continua",
    projectRoot: "C:/proyecto",
    previousRunSummary: "Solicitud anterior: instalar dependencias\nAcciones ya ejecutadas:\n- OK read_file → package.json",
  });
  const memory = messages.find((item) => item.role === "system" && /MEMORIA DE LA CORRIDA ANTERIOR/.test(String(item.content)));
  assert.ok(memory, "el prefijo debe incluir la memoria de la corrida anterior");
  assert.match(String(memory.content), /package\.json/);
});
