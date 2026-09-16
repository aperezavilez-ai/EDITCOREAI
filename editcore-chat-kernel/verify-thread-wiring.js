"use strict";

/**
 * Verificación estática del cableado:
 * usuario → orquestador → memoria/estado → agente/subagente/tool → respuesta → siguiente turno.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const threadMemory = require("./thread-memory");
const threadCore = require("./thread-core");
const { pickModel } = require("./model-router");
const { ChatOrchestrator } = require("./orchestrator");
const { handleChat } = require("./index");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-thread-"));

function run() {
  const threadId = "chat-demo-1";
  threadCore.seedThreadFromInput(tmp, threadId, {
    history: [
      { role: "user", content: "Vamos a rediseñar el login" },
      { role: "assistant", content: "Empiezo por auth/login.tsx y el estilo oscuro." },
    ],
  }, "Continúa con el mismo login");

  threadMemory.noteDecision(tmp, "Usar estilo oscuro y tokens existentes");
  threadMemory.noteWorkingOn(tmp, "Rediseño del login", threadId);

  const hist = threadMemory.shortHistoryMessages([], tmp, threadId, "Continúa");
  assert.ok(hist.length >= 2, "historial corto debe incluir turnos previos");
  assert.ok(hist.some((m) => /login/i.test(m.content)), "el hilo debe recordar login");

  const block = threadMemory.projectPromptBlock(tmp, threadId, "sigue");
  assert.ok(/mismo hilo/i.test(block), "bloque de estado de hilo");
  assert.ok(/login/i.test(block), "workingOn en prompt");

  const messages = threadCore.buildMessageList({
    system: "sys",
    userText: "Proyecto: x\nContinúa con el botón",
    projectRoot: tmp,
    threadId,
    historyInput: [],
    query: "Continúa con el botón",
  });
  assert.equal(messages[0].role, "system");
  assert.ok(messages.some((m) => m.role === "user" && /login/i.test(m.content)), "historial inyectado antes del turno actual");
  assert.equal(messages[messages.length - 1].role, "user");
  assert.ok(/botón/.test(messages[messages.length - 1].content));

  threadCore.rememberExchange(tmp, threadId, "Continúa con el botón", "Cambié el botón primario.");
  const again = threadMemory.loadThread(tmp, threadId);
  assert.ok(again.turns.some((t) => /botón primario/.test(t.content)));

  const routed = pickModel({ requested: "claude-sonnet-4.6", kind: "EXECUTE", hasTools: true });
  assert.equal(routed.model, "claude-sonnet-4.6");
  assert.equal(routed.parallel, 1);

  const orch = new ChatOrchestrator();
  assert.equal(typeof orch.handle, "function");
  assert.equal(typeof handleChat, "function");

  const src = fs.readFileSync(path.join(__dirname, "orchestrator.js"), "utf8");
  assert.ok(src.includes("threadCore.buildMessageList"), "orquestador ensambla mensajes con hilo");
  assert.ok(src.includes("rememberOut"), "orquestador persiste el turno");
  assert.ok(src.includes("pickModel"), "router de un modelo");

  const bridge = fs.readFileSync(path.join(__dirname, "../runtime/chat-kernel-bridge.js"), "utf8");
  assert.ok(bridge.includes("history: chatHistory"), "puente pasa historial");

  const main = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.ok(main.includes("threadId: input.chatId"), "main.js cablea chatId/historial al kernel");

  const agentBus = require("./agent-bus");
  agentBus.record(tmp, threadId, { goal: "Rediseñar login", phase: "explorer", agent: "explorer", summary: "login.tsx existe", finding: "CTA en login.tsx", tool: "list_files", file: "auth/login.tsx", action: "list" });
  agentBus.wrapSubagentResult(tmp, threadId, "analyst", { ok: true, report: "El primario es azul." });
  const busTxt = agentBus.promptBlock(tmp, threadId);
  assert.ok(/BUS COMPARTIDO/i.test(busTxt), "bus visible");
  assert.ok(/login/i.test(busTxt), "bus recuerda login");
  const orchSrc = fs.readFileSync(path.join(__dirname, "orchestrator.js"), "utf8");
  assert.ok(orchSrc.includes("agentBus.wrapSubagentResult"), "orquestador persiste subagentes en el bus");
  assert.ok(orchSrc.includes("Seguimiento del mismo hilo"), "follow-up recupera tools");
  const rm = fs.readFileSync(path.join(__dirname, "../ROADMAP.md"), "utf8");
  assert.ok(/agent-bus/.test(rm) && /Proceso actual/.test(rm), "ROADMAP describe stack y proceso");

  console.log("OK thread wiring");
  console.log("tmp", tmp);
  console.log("turns", again.turns.length);
  console.log("messages", messages.map((m) => m.role).join(" -> "));
  console.log("bus", busTxt.split("\n")[0]);
}

run();
