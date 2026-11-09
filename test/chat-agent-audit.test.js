"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ProjectAnalysis = require("../project-analysis");
const {
  isolateUserIntentPrompt,
  resolveInstructionConstraints,
} = require("../runtime/instruction-obedience");

test("AUDIT Critico: runState se declara antes de registrar la corrida y su checkpoint en agent:run", () => {
  // [COSECHA MODO AGENTE] La rama legada usaba un checkpoint Git tras
  // PROCEDE (runState.mutationCheckpoint). La ruta viva es el kernel: la
  // corrida se registra en activeAgentRuns y su checkpoint es
  // saveLastAgentRun (snapshots). El riesgo TDZ es el mismo: runState debe
  // declararse antes de ambos usos.
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const agentRun = src.slice(src.indexOf('ipcMain.handle("agent:run"'));
  const runStateDecl = agentRun.indexOf("const runState = {");
  const registerUse = agentRun.indexOf("activeAgentRuns.set(runKey, runState)");
  const checkpointUse = agentRun.indexOf("saveLastAgentRun");
  assert.ok(runStateDecl > 0, "debe declarar runState");
  assert.ok(registerUse > runStateDecl, "la corrida se registra tras declarar runState");
  assert.ok(checkpointUse > runStateDecl, "el checkpoint usa la corrida ya declarada");
});

test("AUDIT Alto: findOriginalUserRequest prefiere tarea activa sobre historial largo", () => {
  const project = {
    agentWorkflow: { task: "lee solamente la carpeta api y dime que contiene." },
    messages: [
      {
        role: "user",
        content: "Analiza solo package.json de la raiz. ".repeat(40),
      },
      { role: "user", content: "lee solamente la carpeta api y dime que contiene." },
    ],
  };
  const original = ProjectAnalysis.findOriginalUserRequest(project);
  assert.match(original, /carpeta api/i);
  assert.doesNotMatch(original, /package\.json/);
});

test("AUDIT Alto: CONTINUA con SOLICITUD ORIGINAL no reactiva FOCO package.json", () => {
  const composite = [
    "SOLICITUD ORIGINAL:",
    "Analiza solo package.json de la raiz. No explores android.",
    "",
    "INSTRUCCION ACTUAL:",
    "lee solamente la carpeta api y dime que contiene.",
    "",
    "La autorizacion original sigue vigente.",
  ].join("\n");
  const isolated = isolateUserIntentPrompt(composite);
  assert.match(isolated, /carpeta api/i);
  assert.doesNotMatch(isolated, /package\.json/);
  const c = resolveInstructionConstraints(composite);
  assert.notEqual(c.mode, "scoped");
  assert.deepEqual(c.allowlist, []);
});

test("AUDIT Alto: progress con runId desconocido no usa primer thinking-msg", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(
    src,
    /liveRun\?\.thinking\s*\|\|\s*\(!progress\?\.runId\s*\?\s*document\.querySelector\("\.thinking-msg"\)\s*:\s*null\)/,
  );
  assert.match(
    src,
    /errThinking[\s\S]{0,120}!progress\?\.runId\s*\?\s*document\.querySelector\("\.thinking-msg"\)/,
  );
  assert.match(
    src,
    /liveRun\?\.thinking\s*\|\|\s*\(!runId\s*\?\s*document\.querySelector\("\.thinking-msg"\)\s*:\s*null\)/,
  );
});
