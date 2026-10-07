"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-follow-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmp, "agent-network.json");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
fs.mkdirSync(projectRoot, { recursive: true });

const provider = require("../editcore-chat-kernel/provider");
const calls = [];
let scripted = [];
provider.callChat = async (opts) => {
  calls.push(JSON.parse(JSON.stringify({ messages: opts.messages, tools: (opts.tools || []).map((t) => t.function?.name) })));
  return scripted.shift() || { text: "Listo.", toolCalls: [], usage: {} };
};

const { classify } = require("../editcore-chat-kernel/classify");
const tools = require("../editcore-chat-kernel/tools");
const { ChatOrchestrator, groundUngroundedClaims } = require("../editcore-chat-kernel/orchestrator");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
const lastUser = (call) => [...call.messages].reverse().find((m) => m.role === "user")?.content || "";

test("pedidos de corrección como los escribe el usuario van a ejecución, las preguntas quedan en chat", () => {
  for (const t of [
    "corrije esos 56 errores",
    "porque te detienes termina de corregir",
    "debes corregir todos los errores encontrados que me diste en tu reporte",
    "continua arreglalos todos",
    "si avanza",
    "ok continua por favor",
    "resuélvelos",
  ]) assert.equal(classify(t).kind, "EXECUTE", t);
  for (const t of ["quedo resuelto?", "ya quedaron resultos los errores?", "porque se te acaba el turno?", "ya quedo corregido?"]) {
    assert.equal(classify(t).kind, "CHAT", t);
  }
  assert.equal(classify("haz un analisis forense del proyecto y dame un reporte").kind, "ANALYZE");
});

test("«continua» tras una pregunta retoma el último pedido de corrección (no repite el análisis forense)", async () => {
  calls.length = 0;
  scripted = [{ text: "Sigo con los errores pendientes: ninguno quedaba en este proyecto de prueba.", toolCalls: [], usage: {} }];
  const history = [
    { role: "user", content: "haz un analisis forense del proyecto y dame un reporte" },
    { role: "assistant", content: "Reporte: 55 errores de TypeScript." },
    { role: "user", content: "debes corregir todos los errores encontrados que me diste en tu reporte" },
    { role: "assistant", content: "Corregí algunos." },
    { role: "user", content: "porque se te acaba el turno?" },
    { role: "assistant", content: "Por el límite de pasos." },
  ];
  const out = await new ChatOrchestrator().handle({ message: "continua", history, projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m" });
  assert.equal(out.kind, "EXECUTE");
  assert.match(lastUser(calls[0]), /debes corregir todos los errores encontrados/);
  assert.ok(calls[0].tools.includes("replace_in_file"), "debe tener tools de escritura");
});

test("si pidió corregir y el modelo cierra sin tocar archivos, se le exige aplicar los cambios", async () => {
  calls.length = 0;
  fs.writeFileSync(path.join(projectRoot, "a.js"), "const x = 1\nmodule.exports = x;\n");
  scripted = [
    { text: "Bloque 1 a 12 corregidos.", toolCalls: [], usage: {} },
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "a.js", oldText: "const x = 1\n", newText: "const x = 1;\n" })], usage: {} },
    { text: "Listo: corregí el punto y coma en a.js", toolCalls: [], usage: {} },
  ];
  const out = await new ChatOrchestrator().handle({ message: "corrije esos 56 errores", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m" });
  assert.equal(calls.length, 3);
  assert.match(lastUser(calls[1]), /Todavía no modificaste ningún archivo/);
  assert.equal(fs.readFileSync(path.join(projectRoot, "a.js"), "utf8"), "const x = 1;\nmodule.exports = x;\n");
  assert.match(out.text, /corregí el punto y coma en a\.js/, "la respuesta real del modelo se muestra, no un texto genérico");
});

test("en modo solo lectura no se ofrecen ni se ejecutan escrituras aunque pida corregir", async () => {
  calls.length = 0;
  fs.writeFileSync(path.join(projectRoot, "r.js"), "uno\n");
  scripted = [
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "r.js", oldText: "uno\n", newText: "dos\n" })], usage: {} },
    { text: "No puedo escribir en modo solo lectura.", toolCalls: [], usage: {} },
  ];
  await new ChatOrchestrator().handle({ message: "corrige r.js", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m", permissionMode: "readonly" });
  assert.ok(!calls[0].tools.includes("replace_in_file"));
  assert.equal(fs.readFileSync(path.join(projectRoot, "r.js"), "utf8"), "uno\n");
});

test("una respuesta que termina en palabra sin punto no se reemplaza por «Decime qué hacer con esta evidencia»", () => {
  const steps = [{ name: "read_file", input: { path: "src/app.ts" }, ok: true, result: { ok: true } }];
  const out = groundUngroundedClaims("Revisé src/app.ts y compila sin errores", steps, "revisa app", { kind: "EXECUTE", allowWrite: true });
  assert.match(out, /compila sin errores/);
  assert.doesNotMatch(out, /Decime qué hacer|No completé la instrucción/);
  const cut = groundUngroundedClaims("Ahora reviso el archivo y", steps, "revisa app", { kind: "EXECUTE", allowWrite: true });
  assert.match(cut, /Archivos revisados/);
});

test("en chat, afirmar cambios sin haber escrito nada muestra un aviso", () => {
  const out = groundUngroundedClaims("Apliqué los bloques 1 a 12 y corregí todo.", [], "continua", { kind: "CHAT", allowWrite: false });
  assert.match(out, /no se modificó ningún archivo/);
});

test("reemplazos y escrituras que no cambian nada no cuentan como cambios (+0 −0)", () => {
  fs.writeFileSync(path.join(projectRoot, "b.js"), "let y = 2;\n");
  const same = tools.replaceInFile(projectRoot, "b.js", "let y = 2;", "let y = 2;");
  assert.equal(same.ok, false);
  assert.equal(same.unchanged, true);
  const identical = tools.writeFile(projectRoot, "b.js", "let y = 2;\n");
  assert.equal(identical.unchanged, true);
});

test("write_file acepta exports multilínea, configs y archivos vacíos; rechaza código truncado", () => {
  const ok1 = tools.writeFile(projectRoot, "m.js", "function a() {}\nmodule.exports = {\n  a,\n};\n");
  const ok2 = tools.writeFile(projectRoot, "vite.config.js", "export default {\n  plugins: [],\n};\n");
  const ok3 = tools.writeFile(projectRoot, ".gitkeep", "");
  for (const r of [ok1, ok2, ok3]) assert.equal(r.ok, true, r.error);
  const cut = tools.writeFile(projectRoot, "t.js", "function a() {}\nmodule.exports = {");
  assert.equal(cut.ok, false);
});

test("el contexto por tarea (pipeline, archivo abierto, reviews) va en el mensaje del turno, no en el system", async () => {
  calls.length = 0;
  scripted = [{ text: "Listo, revisé la landing.", toolCalls: [], usage: {} }];
  await new ChatOrchestrator().handle({ message: "corrige el diseño de la landing page con hero y dashboard", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m", skillsPrompt: "SKILLS FIJAS" });
  const system = calls[0].messages[0].content;
  assert.match(system, /SKILLS FIJAS/);
  assert.doesNotMatch(system, /landing page con hero/);
});

test("al agotar los pasos avisa que la tarea no está terminada y que escriba «continúa»", async () => {
  calls.length = 0;
  fs.writeFileSync(path.join(projectRoot, "c.js"), "a\n");
  scripted = [
    { text: "", toolCalls: [toolCall("read_file", { path: "c.js" })], usage: {} },
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "c.js", oldText: "a\n", newText: "b\n" })], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "corrige c.js", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 2, helpers: {},
  });
  assert.equal(out.incomplete, true);
  assert.match(out.text, /no está terminada/);
  assert.match(out.text, /continúa/);
  assert.match(out.text, /c\.js/);
});

test("prompt mixto «analiza X y corrijelos» clasifica como EXECUTE con tools de escritura", async () => {
  const prompt = "analiza ia restaurant quirurgicamentee en busca de errores y corrijelos";
  assert.equal(classify(prompt).kind, "EXECUTE");
  assert.equal(classify(prompt).allowWrite, true);

  calls.length = 0;
  scripted = [{ text: "Corregidos los errores encontrados en el proyecto.", toolCalls: [], usage: {} }];
  const out = await new ChatOrchestrator().handle({
    message: prompt,
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
  });
  assert.equal(out.kind, "EXECUTE");
  assert.ok(calls.length > 0);
  assert.ok(calls[0].tools.includes("replace_in_file"));
  assert.ok(calls[0].tools.includes("write_file"));
});

test("«procede» tras un análisis ejecuta las modificaciones y no re-analiza en bucle", async () => {
  const history = [
    { role: "user", content: "analiza el proyecto en busca de errores" },
    { role: "assistant", content: "## Hallazgos\n- src/App.tsx: error de sintaxis" },
  ];
  calls.length = 0;
  scripted = [{ text: "Aplicando los arreglos autorizados.", toolCalls: [], usage: {} }];
  const out = await new ChatOrchestrator().handle({
    message: "procede",
    history,
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
  });
  assert.equal(out.kind, "EXECUTE");
  assert.ok(calls.length > 0);
  assert.ok(calls[0].tools.includes("replace_in_file"));
  assert.ok(calls[0].tools.includes("write_file"));
});

test("consulta o steer mientras el agente está pensando no rompe la sesión y se inyecta en el diálogo", async () => {
  calls.length = 0;
  const orch = new ChatOrchestrator();
  scripted = [
    { text: "Entendido, acelerando la respuesta a tu consulta.", toolCalls: [], usage: {} },
  ];
  orch.steering = [{ instruction: "llevas 10 min sin avanzar", at: Date.now() }];
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "analiza y arregla",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    allowWrite: true,
    maxSteps: 4,
    helpers: {},
  });
  assert.ok(out);
  assert.equal(out.kind, "EXECUTE");
  assert.ok(calls.length > 0);
  const lastCallMessages = calls[0].messages;
  const hasInjectedSteer = lastCallMessages.some((m) => String(m.content).includes("llevas 10 min sin avanzar"));
  assert.equal(hasInjectedSteer, true);
});

