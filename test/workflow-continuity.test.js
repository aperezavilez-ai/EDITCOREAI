"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function session(t) {
  const store = new TaskStore({ root: path.join(tempRoot(t), "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  return { store, manager, workflow };
}

test("TEST 1-3: analisis crea una Task, un Plan y queda AWAITING_AUTHORIZATION", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar y corregir el proyecto X",
    analysisMode: true,
  });
  assert.ok(prepared.taskId);
  assert.equal(prepared.analysisMode, true);
  const plan = workflow.completeAnalysisRun(prepared.taskId, "## Analisis\nProblemas encontrados.\n## Recomendaciones\nCorregir A.");
  assert.ok(plan.planId);
  const task = manager.getTask(prepared.taskId);
  assert.equal(task.status, "AWAITING_AUTHORIZATION");
  assert.equal(task.planId, plan.planId);
  assert.equal(manager.listTasks().length, 1);
});

test("TEST 4-9: procede conserva Task, planId y no crea analisis", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar y corregir el proyecto X",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan de correcciones");
  const approved = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run_impl_1",
  });
  assert.equal(approved.taskId, prepared.taskId);
  assert.equal(approved.planId, plan.planId);
  assert.equal(approved.analysisMode, false);
  assert.equal(approved.planAuthorized, true);
  assert.equal(approved.executionMode, "AUTHORIZED_PLAN");
  assert.ok(approved.approvalId);
  assert.equal(manager.listTasks().length, 1);
  const task = manager.getTask(prepared.taskId);
  assert.equal(task.status, "EXECUTING");
  assert.notEqual(task.goal, "procede");
});

test("TEST 10: doble procede no duplica aprobacion activa", (t) => {
  const { workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan");
  const first = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-1",
  });
  workflow.beginAuthorizedExecution(prepared.taskId, "run-1");
  const second = workflow.recordPlanApproval(prepared.taskId, plan.planId);
  assert.equal(second.duplicate, true);
  assert.equal(first.approvalId, second.approval.approvalId);
});

test("TEST 11-12: recovery describeWorkflow expone plan pendiente", (t) => {
  const { workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan recuperable");
  const described = workflow.describeWorkflow(prepared.taskId);
  assert.equal(described.state, "AWAITING_AUTHORIZATION");
  assert.equal(described.planId, plan.planId);
  assert.equal(described.planContent, "Plan recuperable");
  assert.equal(described.canApprove, true);
  const found = workflow.findAwaitingTask({ projectId: "proj-1" });
  assert.equal(found.taskId, prepared.taskId);
});

test("TEST 13-15: implementacion completa termina en COMPLETED", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan");
  workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-impl",
  });
  workflow.completeImplementationRun(prepared.taskId, "run-impl", { ok: true });
  const task = manager.getTask(prepared.taskId);
  assert.equal(task.status, "COMPLETED");
});

test("TEST 16: workflow completo sin regresar a ANALYZING", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar este proyecto",
    analysisMode: true,
  });
  assert.equal(manager.getTask(prepared.taskId).status, "ANALYZING");
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Reporte");
  assert.equal(manager.getTask(prepared.taskId).status, "AWAITING_AUTHORIZATION");
  workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-2",
  });
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");
  workflow.completeImplementationRun(prepared.taskId, "run-2", { ok: true });
  assert.equal(manager.getTask(prepared.taskId).status, "COMPLETED");
  assert.notEqual(manager.getTask(prepared.taskId).status, "ANALYZING");
});

test("no crea Task con goal procede", (t) => {
  const { workflow } = session(t);
  assert.throws(
    () => workflow.prepareAgentRun({ prompt: "procede", planAuthorized: true }),
    /taskId/,
  );
});

test("analisis fresco no exige planId aunque exista taskId viejo sin plan", (t) => {
  const { manager, workflow } = session(t);
  const stale = manager.createTask({
    projectId: "p-stale",
    projectRoot: "D:/stale",
    goal: "analisis previo incompleto",
    originalRequest: "analisis previo incompleto",
    status: "CREATED",
  });
  assert.equal(stale.planId || "", "");
  const prepared = workflow.prepareAgentRun({
    taskId: "",
    projectId: "p-calili",
    projectRoot: "D:/calili",
    goal: "analiza calili y dime que errores encuentras para corregir.",
    analysisMode: true,
    planAuthorized: false,
    prompt: "analiza calili y dime que errores encuentras para corregir.",
  });
  assert.equal(prepared.planAuthorized, false);
  assert.equal(prepared.analysisMode, true);
  assert.ok(prepared.taskId);
  assert.notEqual(prepared.taskId, stale.taskId);
  assert.equal(prepared.planId || "", "");
  assert.equal(manager.getTask(prepared.taskId).status, "ANALYZING");
});

test("analisis fresco desde RECOVERABLE crea tarea nueva sin Transicion invalida", (t) => {
  const { manager, workflow } = session(t);
  const first = workflow.prepareAgentRun({
    projectId: "proj-rec",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto",
    analysisMode: true,
  });
  manager.markTaskFailed(first.taskId, new Error("timeout"), { recoverable: true });
  assert.equal(manager.getTask(first.taskId).status, "RECOVERABLE");
  const second = workflow.prepareAgentRun({
    taskId: first.taskId,
    projectId: "proj-rec",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto otra vez",
    prompt: "Analizar proyecto otra vez",
    analysisMode: true,
  });
  assert.notEqual(second.taskId, first.taskId);
  assert.equal(manager.getTask(second.taskId).status, "ANALYZING");
});

test("procede desde RECOVERABLE no lanza Transicion invalida", (t) => {
  const { manager, workflow, store } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-rec-exec",
    projectRoot: "D:/demo",
    goal: "Analizar TicketIA",
    analysisMode: true,
  });
  const plan = store.savePlan(prepared.taskId, {
    content: "## Plan\nFase 1: estructura base del proyecto.",
    summary: "Fase 1",
    status: "PENDING_APPROVAL",
  });
  manager.updateTask(prepared.taskId, { planId: plan.planId, planReference: plan.planId });
  manager.markTaskFailed(prepared.taskId, new Error("timeout en analisis"), { recoverable: true });
  assert.equal(manager.getTask(prepared.taskId).status, "RECOVERABLE");
  const execution = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "PROCEDE FASE 1",
    runId: "run-rec-1",
  });
  assert.equal(execution.taskId, prepared.taskId);
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");
});

test("no inicia analisis si la Task espera autorizacion", (t) => {
  const { workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto",
    analysisMode: true,
  });
  workflow.completeAnalysisRun(prepared.taskId, "Plan");
  assert.throws(
    () => workflow.beginAnalysisRun(prepared.taskId),
    /autorizacion/,
  );
});

test("PROCEDE desde ANALYZING con plan recuperado pasa a EXECUTING (sin estado stale)", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar y corregir el proyecto TAXIDRIV con evidencia en disco y actualizar ROADMAP",
    analysisMode: true,
  });
  assert.equal(manager.getTask(prepared.taskId).status, "ANALYZING");
  // Usuario escribe PROCEDE mientras el analisis aun no cerro plan formal.
  const approved = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run_procede_early",
  });
  assert.equal(approved.taskId, prepared.taskId);
  assert.equal(approved.planAuthorized, true);
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");
  assert.ok(approved.approvalId);
});

test("PROCEDE cancela run activo de analisis y ejecuta", (t) => {
  const { manager, workflow } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-1",
    projectRoot: "D:/demo",
    goal: "Analizar proyecto completo con evidencia",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "## Analisis\nHallazgos.\n## Recomendaciones\nCorregir A.");
  // Simula analisis aun marcado como run activo al autorizar.
  const run = manager.startRun(prepared.taskId, { taskStatus: "AWAITING_AUTHORIZATION", stage: "awaiting_authorization" });
  manager.updateTask(prepared.taskId, { activeRunId: run.runId, status: "AWAITING_AUTHORIZATION", planId: plan.planId });
  const approved = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    prompt: "procede",
    runId: "run_impl_after_cancel",
  });
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");
  assert.equal(approved.duplicateExecution, false);
});

test("tarea READY inicia implementacion sin Transicion invalida al pedir EXECUTING", (t) => {
  const { manager } = session(t);
  const task = manager.createTask({
    projectId: "proj-green",
    projectRoot: "D:/TICKETIA",
    goal: "Crear proyecto completo",
    status: "READY",
  });
  assert.equal(task.status, "READY");
  const run = manager.startRun(task.taskId, { taskStatus: "EXECUTING", stage: "implementation" });
  assert.ok(run?.runId);
  assert.equal(manager.getTask(task.taskId).status, "IMPLEMENTING");
});

test("markTaskCompleted desde RECOVERABLE no lanza Transicion invalida", (t) => {
  const { manager } = session(t);
  const task = manager.createTask({
    projectId: "proj-done",
    projectRoot: "D:/demo",
    goal: "Listar carpeta",
    status: "READY",
  });
  const run = manager.startRun(task.taskId, { taskStatus: "IMPLEMENTING", stage: "implementation" });
  manager.markTaskFailed(task.taskId, new Error("fallo parcial"), { recoverable: true, runId: run.runId });
  assert.equal(manager.getTask(task.taskId).status, "RECOVERABLE");
  const completed = manager.markTaskCompleted(task.taskId, { verificationStatus: "passed" });
  assert.equal(completed.status, "COMPLETED");
});

test("startRun interrumpe RUN stale en vez de lanzar RUN activo", (t) => {
  const { manager } = session(t);
  const task = manager.createTask({
    projectId: "proj-stale",
    projectRoot: "D:/demo",
    goal: "Listar carpeta",
    status: "READY",
  });
  const first = manager.startRun(task.taskId, { taskStatus: "IMPLEMENTING", stage: "implementation", runId: "run-old" });
  assert.equal(first.status, "RUNNING");
  const second = manager.startRun(task.taskId, { taskStatus: "IMPLEMENTING", stage: "implementation", runId: "run-new" });
  assert.equal(second.runId, "run-new");
  assert.equal(manager.store.getRun(task.taskId, "run-old").status, "INTERRUPTED");
  assert.equal(manager.getTask(task.taskId).activeRunId, "run-new");
});

test("procede/continua desde COMPLETED reabre y llega a EXECUTING (no TASK_TERMINAL)", (t) => {
  const { manager, workflow, store } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-completed-reopen",
    projectRoot: "D:/demo",
    goal: "Analizar y corregir EDITCOREAI",
    analysisMode: true,
  });
  const plan = store.savePlan(prepared.taskId, {
    content: "## Plan\nCorregir task-manager COMPLETED prematuro.",
    summary: "Fix COMPLETED",
    status: "PENDING_APPROVAL",
  });
  manager.updateTask(prepared.taskId, { planId: plan.planId, planReference: plan.planId });
  workflow.completeAnalysisRun(prepared.taskId, "## Analisis\nHallazgo.\n## Recomendaciones\nCorregir.");
  // Simula cierre prematuro: fuerza COMPLETED (como el bug de markTaskCompleted sin mutacion).
  store.updateTask(prepared.taskId, {
    status: "COMPLETED",
    verificationStatus: "passed",
    currentStage: "completed",
    activeRunId: "",
    resumeRequired: false,
  });
  assert.equal(manager.getTask(prepared.taskId).status, "COMPLETED");

  const execution = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-reopen-completed",
  });
  assert.equal(execution.taskId, prepared.taskId);
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");

  const run = manager.startRun(prepared.taskId, {
    runId: "run-after-completed",
    taskStatus: "EXECUTING",
    stage: "implementation",
  });
  assert.equal(run.status, "RUNNING");
  assert.equal(manager.getTask(prepared.taskId).status, "EXECUTING");
});

test("continua analisis desde COMPLETED prematura reabre misma Task", (t) => {
  const { manager, workflow, store } = session(t);
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-continua-completed",
    projectRoot: "D:/demo",
    goal: "Auditoria profunda EDITCOREAI",
    analysisMode: true,
  });
  // Forzar COMPLETED invalido (bypass de maquina de estados, como datos stale).
  store.updateTask(prepared.taskId, {
    status: "COMPLETED",
    verificationStatus: "passed",
    currentStage: "completed",
    activeRunId: "",
  });
  assert.equal(manager.getTask(prepared.taskId).status, "COMPLETED");

  const continued = workflow.prepareAgentRun({
    taskId: prepared.taskId,
    projectId: "proj-continua-completed",
    projectRoot: "D:/demo",
    goal: "Auditoria profunda EDITCOREAI",
    prompt: "continua",
    analysisMode: true,
  });
  assert.equal(continued.taskId, prepared.taskId);
  assert.equal(manager.getTask(prepared.taskId).status, "ANALYZING");
});

test("eventos runtime aceptan alias sin guiones y no tumban por tipo desconocido", (t) => {
  const { manager } = session(t);
  const task = manager.createTask({
    projectId: "proj-events",
    projectRoot: "D:/demo",
    goal: "Eventos",
    status: "READY",
  });
  assert.doesNotThrow(() => manager.recordRuntimeEvent(task.taskId, "RECOVERYRESULTMISSING", { metadata: { source: "legacy" } }));
  assert.doesNotThrow(() => manager.recordRuntimeEvent(task.taskId, "SEGMENTYIELD"));
  assert.doesNotThrow(() => manager.recordRuntimeEvent(task.taskId, "EVENTO_QUE_NO_EXISTE_XYZ"));
  const events = manager.getEvents(task.taskId, { limit: 20 });
  assert.ok(events.some((event) => event.type === "RECOVERY_RESULT_MISSING"));
  assert.ok(events.some((event) => event.type === "SEGMENT_YIELD"));
  assert.ok(events.some((event) => event.type === "GOVERNOR_DECISION" && event.metadata?.invalidRuntimeEvent === "EVENTO_QUE_NO_EXISTE_XYZ"));
});
