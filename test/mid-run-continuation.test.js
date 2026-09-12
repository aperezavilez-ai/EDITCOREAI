"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  resolveUnifiedAgentPlan,
  MODES,
} = require("../runtime/intent-orchestrator");
const ProjectAnalysis = require("../project-analysis");

test("CONTINUA a mitad de analisis interrumpido sigue en DISCOVER (no Verificacion meta)", () => {
  for (const prompt of ["CONTINUA", "PORQUE TE DETIENES CONTINUA", "continua el analisis"]) {
    const plan = resolveUnifiedAgentPlan({
      prompt,
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
      permissionMode: "full",
      cursorParityEnabled: true,
      resumableTask: true,
      workflowPhase: "interrupted",
      hasAnalysisMemory: false,
      // Renderer real marca esto; antes forzaba EXECUTE y disparaba lint.
      authorizedContinuation: true,
    });
    assert.equal(plan.mode, MODES.DISCOVER, `${prompt} => ${plan.mode} ${plan.reason}`);
    assert.equal(plan.analysisMode, true, prompt);
  }
});

test("PROCEDE con plan de analisis valido SI entra a EXECUTE", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "PROCEDE",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    planAuthorizedExecution: true,
    resumableTask: true,
    workflowPhase: "awaiting_authorization",
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.analysisMode, false);
});

test("finalizeThinkingAsAssistant no debe borrar narracion en fuente", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(source, /preserveNarrative/);
  assert.match(source, /persistPartialAnalysis|Analisis parcial|interrupted/);
});

test("adapter no cierra analisis con Verificacion completada", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(source, /neverEvidenceFinalForAnalysis/);
  assert.match(source, /Emite write_file AHORA/);
  assert.match(source, /modelIterations|providerCalls >=/);
});

test("isAnalysisReport rechaza Verificacion meta", () => {
  assert.equal(
    ProjectAnalysis.isAnalysisReport("Verificacion completada con evidencia real del proyecto. Acciones ejecutadas: 40"),
    false,
  );
});
