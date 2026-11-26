// ============================================================
// CORRECCIÓN 12 — muerte de la compuerta «procede» (2026-11-26)
//
// Regla de producto de Luis (2026-11-11): EditCoreAI queda con
// TODOS LOS PERMISOS, siempre; la maquinaria del «procede»
// queda sin superficie. El diagnóstico (código, 2026-11-26)
// encontró la compuerta viva en cinco sitios:
//  - workflow-orchestrator.persistPlan aparcaba cada análisis
//    en AWAITING_AUTHORIZATION con nextAction AUTHORIZE;
//  - recordPlanApproval re-aparcaba antes de aprobar;
//  - el reporte del kernel en main marcaba todo turno ANALYZE
//    como awaitingAuthorization;
//  - el renderer espejaba el aparcado (markWorkflowAwaiting-
//    Authorization) y lo resucitaba al sincronizar;
//  - la palabra «procede» intercambiaba el mensaje del usuario
//    por un prompt de reparación (analysisRepairAuthorization)
//    y la barra de estado instruía «escribe procede, autorizo
//    o continua».
// Esta batería exige la raíz: el análisis deja la tarea en
// PLAN_READY con nextAction CONTINUE, nada aparca, la palabra
// deja de ser llave y los textos mueren. El estado
// AWAITING_AUTHORIZATION queda en el modelo de tareas solo
// como compatibilidad de datos viejos: ya nadie lo produce.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function prepararAnalisis() {
  const projectRoot = tmpDir("ec-c12-");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "broken.ts"), "export const x = 1;\n");
  const store = new TaskStore({ root: tmpDir("ec-c12-tasks-") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  const prepared = workflow.prepareAgentRun({
    projectId: "c12",
    projectRoot,
    goal: "analisis del proyecto",
    analysisMode: true,
    runId: "R-c12",
  });
  return { projectRoot, manager, workflow, prepared };
}

const REPORTE = [
  "## Qué sí funcionó",
  "- Lectura",
  "## Qué falló / hallazgos",
  "- src/broken.ts",
  "## Cómo lo corregiré",
  "1. Corregir `src/broken.ts`",
].join("\n");

test("O-1: completar un análisis deja la tarea en PLAN_READY, sin esperar autorización", () => {
  const { manager, workflow, prepared } = prepararAnalisis();
  workflow.completeAnalysisRun(prepared.taskId, REPORTE, { steps: [] });
  const task = manager.getTask(prepared.taskId);
  assert.equal(task.status, "PLAN_READY");
  assert.notEqual(task.nextAction?.type, "AUTHORIZE");
  assert.equal(task.nextAction?.type, "CONTINUE");
});

test("O-2: persistir un plan sobre una tarea no la aparca", () => {
  const { manager, workflow, prepared } = prepararAnalisis();
  workflow.persistPlan(prepared.taskId, { content: REPORTE, summary: "resumen" });
  assert.notEqual(manager.getTask(prepared.taskId).status, "AWAITING_AUTHORIZATION");
});

test("O-3: aprobar desde PLAN_READY llega a APPROVED sin pasar por el aparcado", () => {
  const { manager, workflow, prepared } = prepararAnalisis();
  const persisted = workflow.completeAnalysisRun(prepared.taskId, REPORTE, { steps: [] });
  workflow.recordPlanApproval(prepared.taskId, persisted.planId, { source: "chat" });
  assert.equal(manager.getTask(prepared.taskId).status, "APPROVED");
});

test("O-4: el orquestador ya no produce el estado de aparcado", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "runtime", "workflow-orchestrator.js"), "utf8");
  assert.ok(!fuente.includes('transition(taskId, "AWAITING_AUTHORIZATION"'), "ninguna transición nueva a AWAITING_AUTHORIZATION");
  assert.ok(!fuente.includes('"PENDING_APPROVAL"'), "los planes ya no nacen pendientes de aprobación");
});

test("R-1: el renderer no aparca, no intercambia el mensaje y no instruye la palabra", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.ok(!renderer.includes("escribe procede, autorizo o continua"), "la barra de estado ya no instruye «procede»");
  assert.ok(!renderer.includes("listo para PROCEDE"), "el pipeline ya no anuncia PROCEDE");
  assert.ok(!renderer.includes("analysisRepairAuthorization = true"), "la palabra ya no intercambia el mensaje del usuario");
  const iMark = renderer.indexOf("function markWorkflowAwaitingAuthorization");
  const cuerpo = renderer.slice(iMark, renderer.indexOf("\n}", iMark));
  assert.ok(cuerpo.includes('"analysis_ready"'), "el análisis se registra como contexto listo, no aparcado");
  assert.ok(!cuerpo.includes('"awaiting_authorization"'), "markWorkflow ya no pone la fase de aparcado");
});

test("M-1: el reporte del kernel ya no marca los análisis como esperando autorización", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.ok(!main.includes('awaitingAuthorization: out?.kind === "ANALYZE"'), "un turno ANALYZE ya no se reporta como aparcado");
});
