"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");

const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  const line = args.map((item) => String(item)).join(" ");
  if (line.includes("[WORKFLOW]")) logs.push(line);
  originalLog(...args);
};

function createSession(root) {
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  return { store, manager, workflow };
}

function countEventsForTask(taskId, name, afterIndex = 0) {
  return logs.slice(afterIndex).filter((line) => line.includes(`taskId=${taskId}`) && line.includes(`event=${name}`)).length;
}

function fail(message, details = {}) {
  const report = { ok: false, error: message, ...details };
  originalLog(JSON.stringify(report, null, 2));
  process.exit(1);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-"));
const { manager, workflow } = createSession(root);
const transitions = [];
const logStart = logs.length;

const goal = "Analiza este proyecto completamente, identifica los problemas y prepara las correcciones necesarias.";
const step1 = workflow.prepareAgentRun({
  projectId: "proj-e2e",
  projectRoot: "D:/demo-e2e",
  goal,
  analysisMode: true,
  runId: "R1",
});
const T1 = step1.taskId;
if (!T1) fail("PASO 1: no se creo taskId");
if (step1.analysisMode !== true) fail("PASO 1: analysisMode debe ser true", { analysisMode: step1.analysisMode });
if (manager.getTask(T1).status !== "ANALYZING") {
  fail("PASO 1: estado debe ser ANALYZING", { status: manager.getTask(T1).status });
}
transitions.push("CREATED", "ANALYZING");
if (countEventsForTask(T1, "ANALYSIS_STARTED", logStart) < 1) fail("PASO 1: falta ANALYSIS_STARTED");

const plan = workflow.completeAnalysisRun(T1, "## Analisis\nProblemas.\n## Recomendaciones\nCorregir.");
const P1 = plan.planId;
if (!P1) fail("PASO 2: no se creo planId");
if (manager.getTask(T1).status !== "AWAITING_AUTHORIZATION") {
  fail("PASO 2: estado debe ser AWAITING_AUTHORIZATION", { status: manager.getTask(T1).status });
}
if (countEventsForTask(T1, "PLAN_PERSISTED", logStart) < 1) fail("PASO 2: falta PLAN_PERSISTED");
transitions.push("PLAN_READY", "AWAITING_AUTHORIZATION");

const beforeProceed = logs.length;
const step3 = workflow.prepareAgentRun({
  taskId: T1,
  planId: P1,
  planAuthorized: true,
  executionMode: "AUTHORIZED_PLAN",
  prompt: "Procede con todas las correcciones.",
  runId: "R2",
});
const A1 = step3.approvalId;
if (step3.taskId !== T1) fail("PASO 3: taskId cambio", { expected: T1, actual: step3.taskId });
if (step3.planId !== P1) fail("PASO 3: planId cambio", { expected: P1, actual: step3.planId });
if (!A1) fail("PASO 3: no approvalId");
if (step3.analysisMode !== false) fail("PASO 3: analysisMode debe ser false");
if (step3.executionMode !== "AUTHORIZED_PLAN") fail("PASO 3: executionMode incorrecto");
if (manager.listTasks().length !== 1) fail("PASO 3: se creo task adicional", { count: manager.listTasks().length });
if (countEventsForTask(T1, "ANALYSIS_STARTED", beforeProceed) > 0) fail("PASO 3: segundo ANALYSIS_STARTED");
if (countEventsForTask(T1, "PLAN_PERSISTED", beforeProceed) > 0) fail("PASO 3: segundo PLAN_PERSISTED");
if (countEventsForTask(T1, "APPROVAL_RECORDED", beforeProceed) < 1) fail("PASO 3: falta APPROVAL_RECORDED");
if (countEventsForTask(T1, "EXECUTION_STARTED", beforeProceed) < 1) fail("PASO 3: falta EXECUTION_STARTED");
if (manager.getTask(T1).status !== "EXECUTING") {
  fail("PASO 3: estado debe ser EXECUTING", { status: manager.getTask(T1).status });
}
transitions.push("APPROVED", "EXECUTING");

const dupProceed = workflow.prepareAgentRun({
  taskId: T1,
  planId: P1,
  planAuthorized: true,
  executionMode: "AUTHORIZED_PLAN",
  prompt: "Procede",
  runId: "R2-dup",
});
const dupApproval = workflow.recordPlanApproval(T1, P1);
const idempotentOk = (dupProceed.duplicateExecution === true || dupApproval.duplicate === true)
  && manager.listTasks().length === 1;

workflow.completeImplementationRun(T1, "R2", { ok: true });
if (manager.getTask(T1).status !== "COMPLETED") {
  fail("PASO 4: estado final debe ser COMPLETED", { status: manager.getTask(T1).status });
}
transitions.push("VALIDATING", "COMPLETED");

const recoverySessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-recovery-"));
const { workflow: freshWorkflow } = createSession(recoverySessionRoot);
const recoveryPrepared = freshWorkflow.prepareAgentRun({
  projectId: "proj-recovery",
  projectRoot: "D:/recovery",
  goal: "Analizar proyecto recovery",
  analysisMode: true,
});
const recoveryPlan = freshWorkflow.completeAnalysisRun(recoveryPrepared.taskId, "Plan recovery");
const recoveryStoreRoot = path.join(recoverySessionRoot, "task-store");
const rebootStore = new TaskStore({ root: recoveryStoreRoot });
const rebootManager = new TaskManager({ store: rebootStore });
const rebootWorkflow = new WorkflowOrchestrator({ manager: rebootManager });
const rebootDescribed = rebootWorkflow.describeWorkflow(recoveryPrepared.taskId);
const rebootFound = rebootWorkflow.findAwaitingTask({ projectId: "proj-recovery" });
const rebootProceed = rebootWorkflow.prepareAgentRun({
  taskId: recoveryPrepared.taskId,
  planId: recoveryPlan.planId,
  planAuthorized: true,
  executionMode: "AUTHORIZED_PLAN",
  prompt: "Procede",
  runId: "R-recovery",
});
const rebootStatus = rebootManager.getTask(recoveryPrepared.taskId).status;
const recoveryOk = rebootDescribed?.state === "AWAITING_AUTHORIZATION"
  && rebootFound?.taskId === recoveryPrepared.taskId
  && rebootProceed.taskId === recoveryPrepared.taskId
  && rebootProceed.planId === recoveryPlan.planId
  && rebootStatus === "EXECUTING"
  && rebootProceed.analysisMode === false;

const negative = {
  noT2: manager.listTasks().every((task) => task.taskId === T1),
  noSecondAnalysis: countEventsForTask(T1, "ANALYSIS_STARTED", beforeProceed) === 0,
  noSecondPlan: countEventsForTask(T1, "PLAN_PERSISTED", beforeProceed) === 0,
  noAnalysisModeAfterApprove: step3.analysisMode === false,
  noAwaitingAfterProceed: manager.getTask(T1).status !== "AWAITING_AUTHORIZATION",
  noNewTaskOnProceed: manager.listTasks().length === 1,
  noNewPlanOnProceed: manager.getTask(T1).planId === P1,
};

const report = {
  ok: Object.values(negative).every(Boolean) && idempotentOk && recoveryOk,
  traceability: {
    taskId: T1,
    planId: P1,
    approvalId: A1,
    runAnalysis: "R1",
    runExecution: "R2",
  },
  transitions: [...new Set(transitions)],
  workflowLogs: logs.slice(logStart),
  negative,
  idempotency: {
    duplicateExecution: dupProceed.duplicateExecution === true,
    duplicateApproval: dupApproval.duplicate === true,
    taskCount: manager.listTasks().length,
    pass: idempotentOk,
  },
  recovery: {
    taskId: recoveryPrepared.taskId,
    planId: recoveryPlan.planId,
    stateBeforeProceed: rebootDescribed?.state,
    stateAfterProceed: rebootStatus,
    pass: recoveryOk,
  },
};

originalLog(JSON.stringify(report, null, 2));
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(recoverySessionRoot, { recursive: true, force: true });
process.exit(report.ok ? 0 : 1);
