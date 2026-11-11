"use strict";

// Multiagente real (pedido de Luis, estilo Cursor, 2026-11-10):
//  1. delegate_parallel: subagentes de solo lectura que trabajan A LA
//     VEZ (explorer/analyst) con informe combinado y fallos aislados.
//  2. Sin pisarse de verdad: la identidad de los locks por archivo es
//     la de LA CORRIDA (threadId por helpers), no el global del
//     proceso, y replace_in_file por fin también toma lock.
//  3. Segunda petición: escritores en paralelo entre chats distintos
//     del mismo proyecto; el mismo chat sigue en serie.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const { validateDelegateTasks, runDelegatedTasks, MAX_DELEGATE_TASKS } = require(path.join(root, "editcore-chat-kernel", "parallel-delegate.js"));
const tools = require(path.join(root, "editcore-chat-kernel", "tools.js"));
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const orchestrator = fs.readFileSync(path.join(root, "editcore-chat-kernel", "orchestrator.js"), "utf8");
const implementer = fs.readFileSync(path.join(root, "editcore-chat-kernel", "subagents", "implementer.js"), "utf8");
const toolsSource = fs.readFileSync(path.join(root, "editcore-chat-kernel", "tools.js"), "utf8");

test("delegate_parallel valida roles, exige target/question y topa en 4", () => {
  const { tasks, notes } = validateDelegateTasks([
    { role: "explorer", target: "src/" },
    { role: "analyst", question: "¿dónde se calcula el total?" },
    { role: "analyst" },
    { role: "builder", target: "src/" },
    { role: "explorer", target: "docs/" },
    { role: "explorer", target: "test/" },
    { role: "explorer", target: "extra/" },
  ]);
  assert.equal(tasks.length, MAX_DELEGATE_TASKS);
  assert.ok(notes.length >= 2);
});

test("delegate_parallel corre los subagentes A LA VEZ y combina el informe", async () => {
  const started = [];
  const release = {};
  const mkRunner = (name, summary) => () => {
    started.push(name);
    return new Promise((resolve) => { release[name] = () => resolve({ summary }); });
  };
  const pending = runDelegatedTasks({
    projectRoot: "/proyecto",
    tasks: [
      { role: "explorer", target: "src/" },
      { role: "analyst", question: "¿riesgos?" },
    ],
    runners: { explorer: mkRunner("explorer", "Mapa de src/"), analyst: mkRunner("analyst", "Riesgos: ninguno") },
  });
  // Ambos arrancaron antes de que cualquiera terminara: concurrencia real.
  assert.deepEqual([...started].sort(), ["analyst", "explorer"]);
  release.explorer();
  release.analyst();
  const out = await pending;
  assert.equal(out.ok, true);
  assert.equal(out.completed, 2);
  assert.match(out.text, /Mapa de src\//);
  assert.match(out.text, /Riesgos: ninguno/);
});

test("delegate_parallel aisla el fallo de un subagente", async () => {
  const out = await runDelegatedTasks({
    projectRoot: "/proyecto",
    tasks: [
      { role: "explorer", target: "src/" },
      { role: "analyst", question: "¿ok?" },
    ],
    runners: {
      explorer: async () => ({ summary: "Mapa parcial" }),
      analyst: async () => { throw new Error("proveedor caído"); },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.completed, 1);
  assert.match(out.text, /Mapa parcial/);
  assert.match(out.text, /proveedor caído/);
});

test("la herramienta delegate_parallel existe en la caja del agente", () => {
  const defs = tools.getToolDefinitions();
  const names = defs.map((d) => d.function?.name || d.name);
  assert.ok(names.includes("delegate_parallel"));
  assert.match(toolsSource, /case "delegate_parallel": \{/);
});

test("los locks distinguen corridas: con el lock RETENIDO por otra corrida no se pisa; liberado, sí", () => {
  // ACTUALIZADO A PROPÓSITO [EDITCORE-INTEGRAL-B9]: la versión
  // anterior asumía la conducta rota — write_file RETENÍA el lock
  // hasta el cierre del turno, así que la escritura de chat-1
  // bloqueaba a chat-2 «para siempre». Ahora cada escritura libera
  // su lock al terminar: el invariante que se vigila es el mismo
  // (un chat no pisa a otro MIENTRAS el otro retiene el lock) y se
  // ejerce reteniendo el lock con la coordinación directamente.
  const { getCoordination } = require(path.join(root, "runtime", "agent-coordination.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-locks-"));
  const w = tools.writeFile(tmp, "nota.txt", "contenido original", { threadId: "chat-1", agentRole: "supervisor" });
  assert.equal(w.ok, true);
  // [B9] La escritura de chat-1 YA liberó su lock: chat-2 puede
  // escribir a continuación sin esperar al cierre del turno.
  const after = tools.replaceInFile(tmp, "nota.txt", "contenido original", "de chat-2", { threadId: "chat-2", agentRole: "supervisor" });
  assert.equal(after.ok, true, "tras liberar por escritura, otro chat adquiere de inmediato");
  // Con el lock RETENIDO por chat-1 (operación en curso), chat-2
  // sigue bloqueado: el invariante entre chats no cambió.
  const coord = getCoordination(tmp);
  const held = coord.acquireLock("chat-1", "supervisor", "nota.txt", "write_file");
  assert.equal(held.ok, true);
  const blocked = tools.replaceInFile(tmp, "nota.txt", "de chat-2", "pisado", { threadId: "chat-2", agentRole: "supervisor" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.locked, true);
  assert.equal(fs.readFileSync(path.join(tmp, "nota.txt"), "utf8"), "de chat-2");
  coord.releaseLock("chat-1", "supervisor", "nota.txt");
  const own = tools.replaceInFile(tmp, "nota.txt", "de chat-2", "actualizado", { threadId: "chat-1", agentRole: "supervisor" });
  assert.equal(own.ok, true);
  assert.equal(fs.readFileSync(path.join(tmp, "nota.txt"), "utf8"), "actualizado");
});

test("la identidad de la corrida viaja: orquestador e implementer la propagan", () => {
  assert.match(orchestrator, /threadId: threadId \|\| \(helpers && helpers\.threadId\) \|\| "default",\s*\n\s*agentRole: "supervisor",/);
  // [EDITCORE-INTEGRAL-B9] UNA sola identidad por corrida: el
  // implementer ya no usa una segunda identidad de lock
  // («implementer») distinta de la del supervisor de su corrida.
  assert.match(implementer, /const coordCtx = \{ threadId: threadId \|\| "default", agentRole: "supervisor" \};/);
  assert.match(toolsSource, /function acquireWriteLock\(root, rel, op, coordCtx\)/);
});

test("segunda petición: el trabajo lleva su chat y el candado es por chat, no por proyecto", () => {
  assert.match(renderer, /chatId: project\?\.activeChatId \|\| activeProject\(\)\?\.activeChatId \|\| "",/);
  const fnStart = renderer.indexOf("function canLaunchParallelAgent");
  const fn = renderer.slice(fnStart, fnStart + 2200);
  assert.match(fn, /String\(job\.chatId\) === String\(next\.chatId\)/);
  assert.doesNotMatch(fn, /!next\.isSubAgent/);
});
