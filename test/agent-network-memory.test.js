"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AgentNetwork } = require("../editcore-chat-kernel/agent-network");
const threadCore = require("../editcore-chat-kernel/thread-core");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const { withCacheControl } = require("../runtime/ai-core");
const { SELF_KNOWLEDGE_PROMPT, CONNECT_GUIDE_PROMPT, wantsConnectGuide } = require("../editcore-chat-kernel/self-knowledge");
const tools = require("../editcore-chat-kernel/tools");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ec-${name}-`));

test("red de agentes: rutea pedidos en español al rol correcto", async () => {
  const net = new AgentNetwork({ persistPath: path.join(tmp("an"), "net.json") });
  const cases = {
    "lista las carpetas del proyecto": "explorer",
    "analiza por qué falla el login": "analyst",
    "explícame cómo funciona el pago": "analyst",
    "crea una página de contacto con un botón": "implementer",
    "arregla el bug del carrito": "implementer",
    "corre los tests y verifica que compila": "verifier",
  };
  for (const [task, agent] of Object.entries(cases)) {
    assert.equal((await net.route(task)).agent, agent, task);
  }
});

test("red de agentes: aprende, guarda en disco y lo recuerda al reiniciar", async () => {
  const file = path.join(tmp("an"), "net.json");
  const net = new AgentNetwork({ persistPath: file });
  net.recordOutcome("implementer", true);
  net.recordOutcome("verifier", true);
  net.recordOutcome("verifier", false);
  assert.ok(fs.existsSync(file), "se guarda en disco");

  const reloaded = new AgentNetwork({ persistPath: file });
  assert.equal(reloaded.getConfidence("verifier"), 0.9, "confianza recordada (1.0 +0.05 tope 1.0, luego −0.1)");
  assert.equal(reloaded.snapshot().edges["implementer->verifier"].count, 1, "traspaso implementador → verificador aprendido");

  const role = reloaded.rolePrompt("implementer");
  assert.match(role, /ROL ACTIVO .*Implementador/);
  assert.match(role, /Verificador/, "propone el siguiente paso aprendido");
});

test("red de agentes: un fracaso baja la confianza y cambia el ruteo", async () => {
  const net = new AgentNetwork({ persistPath: path.join(tmp("an"), "net.json") });
  const task = "revisa el archivo";
  const before = (await net.route(task)).agent;
  for (let i = 0; i < 9; i += 1) net.recordOutcome(before, false);
  assert.notEqual((await net.route(task)).agent, before);
});

test("memoria persistente: el hilo sobrevive aunque el IDE no mande el historial", () => {
  const root = tmp("thread");
  threadCore.rememberExchange(root, "chat-1", "mi app se llama Tacos Pepe", "Anotado: Tacos Pepe.");
  const file = path.join(root, ".editcore", "chat-memory", "thread-chat-1.json");
  assert.ok(fs.existsSync(file));
  const history = threadMemory.shortHistoryMessages([], root, "chat-1", "¿cómo se llama mi app?");
  assert.ok(history.some((m) => /Tacos Pepe/.test(m.content)));
});

test("caché: el system es idéntico entre turnos aunque cambie el contexto, que va en el mensaje del turno", () => {
  const build = (iso, text, turnContext) => threadCore.buildMessageList({
    system: "SYS", systemPrefix: SELF_KNOWLEDGE_PROMPT, turnContext, userText: text, projectRoot: "", threadId: "t-cache",
    historyInput: [], query: text, now: new Date(iso),
  });
  const a = build("2026-10-06T15:01:00Z", "hola", "CEREBRO: nota A");
  const b = build("2026-10-06T15:47:00Z", "otra cosa", "CEREBRO: nota B, mapa distinto");
  assert.deepEqual(a[0], b[0], "el system no cambia en el mismo día ni con otro contexto");
  assert.match(a[0].content, /^=== QUIÉN ERES: EDITCOREAI ===/);
  assert.doesNotMatch(a[0].content, /CEREBRO: nota/);
  assert.match(a[a.length - 1].content, /CONTEXTO DE EDITCOREAI PARA ESTE TURNO[\s\S]*CEREBRO: nota A[\s\S]*hola$/);

  const marked = withCacheControl([...a, { role: "assistant", content: "ok" }, { role: "user", content: "sigue" }]);
  assert.deepEqual(marked[0].content[0].cache_control, { type: "ephemeral" });
  assert.equal(marked[marked.length - 1].content[0].cache_control.type, "ephemeral", "el último mensaje del usuario también se marca");
  assert.ok(JSON.stringify(marked).match(/cache_control/g).length <= 4, "el proveedor admite como máximo 4 marcas");
});

test("guía de conexión: se activa con GitHub/Vercel/Supabase/publicar y el kernel tiene sus herramientas", () => {
  for (const t of ["conecta con github", "quiero publicar mi página", "súbelo a vercel", "usa supabase"]) assert.ok(wantsConnectGuide(t), t);
  assert.ok(!wantsConnectGuide("cambia el color del botón"));
  assert.match(CONNECT_GUIDE_PROMPT, /check_connections[\s\S]*connect_project[\s\S]*publish_project/);

  const names = (opts) => tools.getToolDefinitions(opts).map((t) => t.function.name);
  assert.ok(names({ allowWrite: false }).includes("check_connections"), "diagnóstico disponible en solo lectura");
  assert.ok(!names({ allowWrite: false }).includes("connect_project"), "conectar requiere modo con cambios");
  assert.ok(names({ allowWrite: true }).includes("connect_project"));
});

test("conectar pide confirmación antes de tocar GitHub o Vercel", async () => {
  const out = await tools.execute("connect_project", {}, tmp("conn"), true, {});
  assert.equal(out.needsConfirmation, true);
  assert.match(out.preview, /GitHub/);
});

function sseResponse(chunks, { failAfter = false } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else if (failAfter) controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test("sin respuesta: si el proveedor corta sin enviar nada, el kernel reintenta solo", async () => {
  const { callChat } = require("../editcore-chat-kernel/provider");
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => (++calls === 1 ? sseResponse(["data: [DONE]\n\n"]) : sseResponse([delta("hola"), "data: [DONE]\n\n"]));
  try {
    const out = await callChat({ apiBaseUrl: "https://api.test.local/v1", apiKey: "k-empty", model: "m", messages: [{ role: "user", content: "hi" }] });
    assert.equal(out.text, "hola");
    assert.equal(calls, 2);
  } finally { global.fetch = original; }
});

test("sin duplicados: si ya se mostró texto y se corta, no se repite la respuesta", async () => {
  const { callChat } = require("../editcore-chat-kernel/provider");
  const original = global.fetch;
  let calls = 0;
  const shown = [];
  global.fetch = async () => { calls += 1; return sseResponse([delta("parcial")], { failAfter: true }); };
  try {
    await assert.rejects(callChat({ apiBaseUrl: "https://api.test.local/v1", apiKey: "k-cut", model: "m", messages: [{ role: "user", content: "hi" }], onTextDelta: (d) => shown.push(d) }));
    assert.equal(calls, 1);
    assert.deepEqual(shown, ["parcial"]);
  } finally { global.fetch = original; }
});

test("web: el agente tiene caché, plazo por inactividad, guía y herramientas de publicar", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "web-portal", "js", "web-agent.js"), "utf8");
  assert.match(src, /messages: withCacheControl\(messages\)/);
  assert.match(src, /IDLE_TIMEOUT_MS/);
  assert.match(src, /name: "check_connections"/);
  assert.match(src, /name: "publish_project"/);
  assert.match(src, /QUIÉN ERES: EDITCOREAI WEB/);
});
