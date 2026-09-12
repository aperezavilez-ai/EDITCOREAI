"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isListOnlyRequest,
  isListAndExplainRequest,
  resolveUnifiedAgentPlan,
} = require("../runtime/intent-orchestrator");

test("Lista + Explica NO es list-only", () => {
  const prompt = "Lista los archivos de resources/app/runtime Y Explica qué hace action-registry.js";
  assert.equal(isListOnlyRequest(prompt), false);
  assert.equal(isListAndExplainRequest(prompt), true);
});

test("Solo listar SÍ es list-only", () => {
  assert.equal(isListOnlyRequest("Lista los archivos de resources/app/runtime"), true);
  assert.equal(isListAndExplainRequest("Lista los archivos de resources/app/runtime"), false);
});

test("Lista+Explica permite read_file en el plan", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "Lista los archivos de resources/app/runtime Y Explica qué hace action-registry.js",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
  });
  assert.equal(plan.listOnly, false);
  assert.ok(plan.allowedTools.includes("list_files"));
  assert.ok(plan.allowedTools.includes("read_file"));
});
