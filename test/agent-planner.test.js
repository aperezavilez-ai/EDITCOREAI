const test = require("node:test");
const assert = require("node:assert");
const { AgentPlanner, agentPlanner, WRITE_TOOLS } = require("../runtime/agent-planner");

test("AgentPlanner: crea planes estructurados y quedan en WAITING_FOR_APPROVAL", () => {
  const planner = new AgentPlanner();
  const plan = planner.createPlan({
    goal: "Refactorizar autenticación JWT",
    targetFiles: [
      { filePath: "src/auth.js", changeType: "MODIFY", summary: "Añadir verificación de expiración" },
      { filePath: "src/config.js", changeType: "NEW", summary: "Crear variables de entorno JWT" },
    ],
    steps: ["Analizar tokens", "Modificar auth.js", "Generar config.js"],
    diffPreview: "+ const jwt = require('jsonwebtoken');",
  });

  assert.ok(plan.planId.startsWith("plan_"));
  assert.strictEqual(plan.status, "WAITING_FOR_APPROVAL");
  assert.strictEqual(plan.targetFiles.length, 2);
  assert.strictEqual(plan.steps.length, 3);
  assert.ok(plan.diffPreview.includes("jsonwebtoken"));
});

test("AgentPlanner: bloquea herramientas de escritura si el plan no está aprobado", () => {
  const planner = new AgentPlanner();
  const plan = planner.createPlan({ goal: "Modificar archivo de configuración" });

  // Herramientas de lectura permitidas
  const readCheck = planner.isToolAllowed(plan.planId, "read_file");
  assert.strictEqual(readCheck.allowed, true);

  // Herramientas de escritura bloqueadas
  const writeCheck = planner.isToolAllowed(plan.planId, "write_file");
  assert.strictEqual(writeCheck.allowed, false);
  assert.ok(writeCheck.reason.includes("requiere aprobación humana"));

  const replaceCheck = planner.isToolAllowed(plan.planId, "replace_file_content");
  assert.strictEqual(replaceCheck.allowed, false);
});

test("AgentPlanner: aprueba el plan y autoriza herramientas de escritura", () => {
  const planner = new AgentPlanner();
  const plan = planner.createPlan({ goal: "Aplicar parche de seguridad" });

  const approveRes = planner.approvePlan(plan.planId, { user: "admin" });
  assert.strictEqual(approveRes.success, true);
  assert.strictEqual(approveRes.status, "APPROVED");

  const writeCheck = planner.isToolAllowed(plan.planId, "write_file");
  assert.strictEqual(writeCheck.allowed, true);

  const executed = planner.markPlanExecuted(plan.planId);
  assert.strictEqual(executed, true);
});

test("AgentPlanner: rechaza el plan e impide modificaciones", () => {
  const planner = new AgentPlanner();
  const plan = planner.createPlan({ goal: "Eliminar base de datos" });

  const rejectRes = planner.rejectPlan(plan.planId, "Acción peligrosa no autorizada");
  assert.strictEqual(rejectRes.success, true);
  assert.strictEqual(rejectRes.status, "REJECTED");

  const writeCheck = planner.isToolAllowed(plan.planId, "delete_file");
  assert.strictEqual(writeCheck.allowed, false);

  const cannotApprove = planner.approvePlan(plan.planId);
  assert.strictEqual(cannotApprove.success, false);
});

test("AgentPlanner: lista planes pendientes correctamente", () => {
  const planner = new AgentPlanner();
  const p1 = planner.createPlan({ goal: "Tarea 1" });
  const p2 = planner.createPlan({ goal: "Tarea 2" });

  let pending = planner.listPendingPlans();
  assert.strictEqual(pending.length, 2);

  planner.approvePlan(p1.planId);
  pending = planner.listPendingPlans();
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].planId, p2.planId);
});
