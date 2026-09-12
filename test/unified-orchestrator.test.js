"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");

test("spec pegada entra en chat sin disco", () => {
  const prompt = "Analiza lo siguiente:\n\nApp de tickets con registro, venta QR y panel admin en React y Node.";
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.promptOnlyMode, false);
  assert.equal(plan.analysisMode, false);
  assert.equal(plan.usesProjectTools, false);
  assert.deepEqual(plan.allowedTools, []);
});

test("analiza el proyecto explicito entra en discover", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "Analiza el proyecto completo y dame un reporte",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: false,
  });
  assert.equal(plan.mode, MODES.DISCOVER);
  assert.equal(plan.analysisMode, true);
  assert.ok(plan.allowedTools.includes("list_files"));
});

test("procede con plan autorizado entra en execute", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    planAuthorizedExecution: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.analysisMode, false);
  assert.ok(plan.allowedTools.includes("write_file"));
});

test("discover y execute exponen web, github, cerebro e inspect_preview", () => {
  const discover = resolveUnifiedAgentPlan({
    prompt: "Analiza el proyecto completo y dame un reporte",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: false,
  });
  assert.equal(discover.mode, MODES.DISCOVER);
  for (const tool of ["fetch_url", "github_search_repos", "brain_search", "inspect_preview", "codebase_map"]) {
    assert.ok(discover.allowedTools.includes(tool), `discover debe incluir ${tool}`);
  }
  assert.ok(!discover.allowedTools.includes("brain_install_repo"));
  assert.ok(!discover.allowedTools.includes("write_file"));

  const execute = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    planAuthorizedExecution: true,
  });
  assert.equal(execute.mode, MODES.EXECUTE);
  for (const tool of ["fetch_url", "github_read_file", "brain_install_repo", "inspect_preview", "write_file"]) {
    assert.ok(execute.allowedTools.includes(tool), `execute debe incluir ${tool}`);
  }
  assert.match(execute.runProfile.orchestrationBlock, /inspect_preview|frontend-design|github_/i);
});
