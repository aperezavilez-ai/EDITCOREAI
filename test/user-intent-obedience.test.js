"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ProjectAnalysis = require("../project-analysis");
const {
  resolveUnifiedAgentPlan,
  isResumeIncompleteAnalysisRequest,
  MODES,
} = require("../runtime/intent-orchestrator");
const { isDocNoisePath } = require("../runtime/evidence-grounding");

test("preguntas del usuario no se clasifican como analisis fresco", () => {
  for (const prompt of [
    "EXPLICAME QUE HICISTE?",
    "PORQUE NO PUEDES COMPLETAR MIS SOLICITUD DIME QUE HACE FALTA",
    "QUE HACE FALTA",
  ]) {
    assert.equal(ProjectAnalysis.isFreshAnalysisRequest(prompt), false, prompt);
    assert.equal(ProjectAnalysis.isConversationalFollowUp(prompt), true, prompt);
    assert.equal(ProjectAnalysis.isAgentWorkflowQuestion(prompt), true, prompt);
  }
});

test("directiva haz lo que te pido reanuda analisis interrumpido", () => {
  assert.equal(ProjectAnalysis.isUserDirectiveOrComplaint("NO TE ESTOY PIDIENDO ESO... HAZ LO QUE TE PIDO"), true);
  assert.equal(isResumeIncompleteAnalysisRequest("HAZ LO QUE TE PIDO", {
    resumableTask: true,
    workflowPhase: "interrupted",
    planAuthorizedExecution: false,
  }), true);
  const plan = resolveUnifiedAgentPlan({
    prompt: "HAZ LO QUE TE PIDO",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    resumableTask: true,
    workflowPhase: "interrupted",
  });
  assert.equal(plan.mode, MODES.DISCOVER);
  assert.equal(plan.analysisMode, true);
});

test("pregunta explicame → CHAT no DISCOVER", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "EXPLICAME QUE HICISTE?",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    resumableTask: true,
    workflowPhase: "interrupted",
  });
  assert.equal(plan.mode, MODES.CHAT);
});

test(".editcore chats/memory son ruido forense", () => {
  assert.equal(isDocNoisePath(".editcore/chats.json"), true);
  assert.equal(isDocNoisePath(".editcore/agent-memory/context.json"), true);
  assert.equal(isDocNoisePath(".editcore/memory.json"), true);
  assert.equal(isDocNoisePath("src/lib/client.ts"), false);
});
