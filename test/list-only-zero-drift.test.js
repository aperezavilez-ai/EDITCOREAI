"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const orch = require("../runtime/intent-orchestrator");

const PROMPT = "LISTA solamente la carpeta api y dime que contiene.";

test("FAIL-FIRST: lista carpeta NO debe ser analysisMode/forense", () => {
  assert.equal(orch.isListOnlyRequest(PROMPT), true);
  const plan = orch.resolveUnifiedAgentPlan({
    prompt: PROMPT,
    projectOpen: true,
    requestedAgent: true,
    permissionMode: "step",
    allowWrite: true,
  });
  assert.equal(plan.listOnly, true, `listOnly esperado; got ${JSON.stringify({ mode: plan.mode, reason: plan.reason, analysisMode: plan.analysisMode })}`);
  assert.equal(plan.analysisMode, false, "analysisMode debe ser false en listado");
  assert.equal(plan.mode, "execute");
  assert.match(plan.reason, /listado/i);
  assert.deepEqual(plan.allowedTools, ["list_files"]);
  assert.doesNotMatch(plan.reason, /analisis\/reporte/i);
});

test("lista + dime que contiene sigue siendo listOnly", () => {
  assert.equal(orch.isListOnlyRequest("lista la carpeta api y dime que contiene"), true);
  assert.equal(orch.isListOnlyRequest("enlista api"), true);
});

test("lee carpeta (sin listar) NO es listOnly — puede ser FOCO carpeta", () => {
  assert.equal(orch.isListOnlyRequest("lee solamente la carpeta api y dime que contiene"), false);
});

