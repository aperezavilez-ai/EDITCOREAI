"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const ProjectAnalysis = require("../project-analysis");
const {
  resolveUnifiedAgentPlan,
  isResumeIncompleteAnalysisRequest,
  MODES,
} = require("../runtime/intent-orchestrator");

test("wantsAuthorizedFinish reconoce CONTINUA Y TERMINA YA", () => {
  assert.equal(ProjectAnalysis.wantsAuthorizedFinish("CONTINUA Y TERMINA YA"), true);
  assert.equal(ProjectAnalysis.wantsAuthorizedFinish("continua y termina"), true);
  assert.equal(ProjectAnalysis.wantsAuthorizedFinish("TERMINA YA"), true);
  assert.equal(ProjectAnalysis.wantsAuthorizedFinish("continua"), false);
  assert.equal(ProjectAnalysis.wantsAuthorizedFinish("analiza el proyecto"), false);
});

test("CONTINUA Y TERMINA YA no reabre analisis readonly", () => {
  assert.equal(isResumeIncompleteAnalysisRequest("CONTINUA Y TERMINA YA", {
    resumableTask: true,
    workflowPhase: "interrupted",
    planAuthorizedExecution: false,
  }), false);
});

test("CONTINUA Y TERMINA YA con planAuthorized entra en EXECUTE", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "CONTINUA Y TERMINA YA",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    resumableTask: true,
    workflowPhase: "interrupted",
    planAuthorizedExecution: true,
    authorizedContinuation: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.analysisMode, false);
  assert.ok((plan.allowedTools || []).includes("write_file") || (plan.allowedTools || []).includes("replace_in_file"));
});
