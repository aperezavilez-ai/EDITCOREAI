"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DebuggerClient } = require("../runtime/debugger-client");

test("debugger-client: crea y lista sesiones de depuración", () => {
  const client = new DebuggerClient();
  const session = client.createSession("sess-1", { name: "Test Session", program: "app.js" });
  assert.equal(session.id, "sess-1");
  assert.equal(session.name, "Test Session");
  assert.equal(session.status, "initializing");

  const sessions = client.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "sess-1");
  assert.equal(sessions[0].name, "Test Session");

  const fetched = client.getSession("sess-1");
  assert.equal(fetched.id, "sess-1");
});

test("debugger-client: inicia y detiene sesión en mockMode", async () => {
  const client = new DebuggerClient();
  let startedEventFired = false;
  let stoppedEventFired = false;

  client.on("session:started", ({ sessionId }) => {
    if (sessionId === "sess-mock") startedEventFired = true;
  });
  client.on("session:stopped", ({ sessionId }) => {
    if (sessionId === "sess-mock") stoppedEventFired = true;
  });

  const session = await client.startSession("sess-mock", { mockMode: true, program: "index.js" });
  assert.equal(session.status, "running");
  assert.ok(startedEventFired);

  const stopResult = await client.stopSession("sess-mock");
  assert.equal(stopResult.ok, true);
  assert.ok(stoppedEventFired);
});

test("debugger-client: gestión de breakpoints (set, add, remove, get)", async () => {
  const client = new DebuggerClient();
  client.createSession("sess-bp", { mockMode: true });

  let eventCount = 0;
  client.on("breakpoint:changed", ({ sourcePath, breakpoints }) => {
    assert.equal(sourcePath, "src/math.js");
    eventCount++;
  });

  const bps = await client.setBreakpoints("sess-bp", "src/math.js", [
    { line: 10, column: 0 },
    { line: 25, column: 4, condition: "x > 5" },
  ]);

  assert.equal(bps.length, 2);
  assert.equal(bps[0].verified, true);
  assert.equal(bps[1].condition, "x > 5");
  assert.equal(eventCount, 1);

  // Agregar breakpoint individual
  const added = await client.addBreakpoint("sess-bp", "src/math.js", 40, 2);
  assert.equal(added.line, 40);
  assert.equal(eventCount, 2);

  const list = client.getBreakpoints("sess-bp", "src/math.js");
  assert.equal(list.length, 3);

  // Eliminar breakpoint
  await client.removeBreakpoint("sess-bp", "src/math.js", 10);
  assert.equal(eventCount, 3);

  const remaining = client.getBreakpoints("sess-bp", "src/math.js");
  assert.equal(remaining.length, 2);
  assert.ok(!remaining.some((bp) => bp.line === 10));
});

test("debugger-client: control de flujo (pause, continue, stepOver, stepInto, stepOut)", async () => {
  const client = new DebuggerClient();
  await client.startSession("sess-flow", { mockMode: true });

  const pauseRes = await client.pause("sess-flow");
  assert.equal(pauseRes.ok, true);
  assert.equal(pauseRes.status, "paused");

  const stepOverRes = await client.stepOver("sess-flow");
  assert.equal(stepOverRes.ok, true);
  assert.equal(stepOverRes.reason, "step");

  const stepIntoRes = await client.stepInto("sess-flow");
  assert.equal(stepIntoRes.ok, true);
  assert.equal(stepIntoRes.status, "paused");

  const stepOutRes = await client.stepOut("sess-flow");
  assert.equal(stepOutRes.ok, true);
  assert.equal(stepOutRes.status, "paused");

  const contRes = await client.continue("sess-flow");
  assert.equal(contRes.ok, true);
  assert.equal(contRes.status, "running");
});

test("debugger-client: inspección de estado (callStack, variables, evaluate)", async () => {
  const client = new DebuggerClient();
  await client.startSession("sess-inspect", { mockMode: true, program: "main.js" });

  const frames = await client.getCallStack("sess-inspect");
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 0);
  assert.equal(frames[0].name, "main");

  const vars = await client.getVariables("sess-inspect");
  assert.ok(Array.isArray(vars));
  assert.ok(vars.some((v) => v.name === "counter" && v.value === "42"));

  const evalResult = await client.evaluate("sess-inspect", "1 + 1");
  assert.ok(evalResult.result.includes("1 + 1"));
});

test("debugger-client: restart y manejo de errores con sesiones inexistentes", async () => {
  const client = new DebuggerClient();
  await client.startSession("sess-restart", { mockMode: true, program: "server.js" });

  const restartSession = await client.restart("sess-restart");
  assert.equal(restartSession.status, "running");

  await assert.rejects(
    async () => {
      await client.pause("sess-inexistente");
    },
    { message: /no encontrada/ }
  );
});
