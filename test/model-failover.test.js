"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const {
  ModelFailoverCoordinator,
  isRecoverableModelError,
  isTaskLevelError,
  hasRequiredCapability,
  modelProfileKey,
} = require("../runtime/model-failover");

function profile(id, { toolOK = true, chatOK = true } = {}) {
  return {
    providerKey: `provider-${id}`,
    baseUrl: `https://api.${id}.test/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    toolOK,
    chatOK,
  };
}

function providerError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function taskError(message) {
  const error = new Error(message);
  error.code = "TASK_LEVEL_ERROR";
  error.taskLevel = true;
  return error;
}

async function executeWithFailover({
  coordinator,
  executeStep,
  maxIterations = 20,
}) {
  const completed = [];
  let currentStep = 1;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    try {
      const result = await executeStep(coordinator.current, {
        completedSteps: completed.slice(),
        currentStep,
      });
      if (result?.done) {
        return { completed, coordinator, waiting: false, finalModel: coordinator.current.model };
      }
      if (result?.step) {
        completed.push(result.step);
        currentStep += 1;
      }
    } catch (error) {
      const failover = await coordinator.handleFailure(error, {
        completedSteps: completed.map((step) => step.name),
        currentStage: "implementation",
        partialResult: "",
      });
      if (failover.action === "failover" || failover.action === "duplicate_failover") {
        coordinator.applyProfileToInput({}, failover.profile);
        coordinator.markExecutionResumed(failover.profile);
        continue;
      }
      if (failover.action === "waiting_for_provider") {
        return { completed, coordinator, waiting: true, checkpoint: failover.checkpoint };
      }
      if (failover.action === "task_error") throw failover.error || error;
      throw error;
    }
  }
  throw new Error("Max iterations exceeded in failover harness");
}

function tempSession(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-failover-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  return { store, manager };
}

test("TEST 1: failover basico conserva la misma task y completa con modelo B", async () => {
  const modelA = profile("a");
  const modelB = profile("b");
  const coordinator = new ModelFailoverCoordinator({
    current: modelA,
    candidates: [modelB],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-1", planId: "plan-1", runId: "run-1" },
    onCheckpoint: async () => ({ checkpointId: "cp-1" }),
  });
  const result = await executeWithFailover({
    coordinator,
    executeStep: async (current) => {
      if (current.model === "model-a") throw providerError("timeout del proveedor");
      return { done: true };
    },
  });
  assert.equal(result.waiting, false);
  assert.equal(result.finalModel, "model-b");
  assert.equal(coordinator.failoverCount, 1);
});

test("TEST 2: no repite pasos completados tras failover", async () => {
  const modelA = profile("a");
  const modelB = profile("b");
  const executed = [];
  const coordinator = new ModelFailoverCoordinator({
    current: modelA,
    candidates: [modelB],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-2", planId: "plan-2", runId: "run-2" },
    onCheckpoint: async (meta) => ({ checkpointId: "cp-2", completedSteps: meta.completedSteps }),
  });
  const result = await executeWithFailover({
    coordinator,
    executeStep: async (current, ctx) => {
      if (current.model === "model-a") {
        if (ctx.completedSteps.length < 3) {
          const step = { name: `step-${ctx.completedSteps.length + 1}`, ok: true };
          executed.push(step.name);
          return { step };
        }
        throw providerError("rate limit");
      }
      const step = { name: "step-4", ok: true };
      executed.push(step.name);
      return { step, done: true };
    },
  });
  assert.deepEqual(executed, ["step-1", "step-2", "step-3", "step-4"]);
  assert.equal(result.finalModel, "model-b");
});

test("TEST 3: failover multiple A->B->C completa", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b"), profile("c")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-3", runId: "run-3" },
    onCheckpoint: async () => ({ checkpointId: "cp-3" }),
  });
  const result = await executeWithFailover({
    coordinator,
    executeStep: async (current) => {
      if (current.model !== "model-c") throw providerError(`${current.model} unavailable`);
      return { done: true };
    },
  });
  assert.equal(result.finalModel, "model-c");
  assert.equal(coordinator.failoverCount, 2);
});

test("TEST 4: salta modelo incompatible y usa el siguiente compatible", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b", { toolOK: false, chatOK: true }), profile("c", { toolOK: true })],
    requiredCapability: "agent",
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-4", runId: "run-4" },
    onCheckpoint: async () => ({ checkpointId: "cp-4" }),
  });
  const result = await executeWithFailover({
    coordinator,
    executeStep: async (current) => {
      if (current.model === "model-a") throw providerError("503");
      return { done: true };
    },
  });
  assert.equal(result.finalModel, "model-c");
  assert.equal(hasRequiredCapability(profile("b", { toolOK: false, chatOK: true }), "agent"), false);
});

test("TEST 5: todos los modelos caidos deja WAITING_FOR_PROVIDER", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b")],
    maxRetriesPerModel: 0,
    maxChainLength: 2,
    taskContext: { taskId: "task-5", runId: "run-5" },
    onCheckpoint: async () => ({ checkpointId: "cp-5" }),
  });
  const result = await executeWithFailover({
    coordinator,
    executeStep: async () => {
      throw providerError("provider unavailable");
    },
  });
  assert.equal(result.waiting, true);
  assert.equal(coordinator.waitingForProvider, true);
  assert.ok(result.checkpoint);
});

test("TEST 6: recovery tras reinicio continua desde checkpoint sin ANALYZING", async (t) => {
  const { manager } = tempSession(t);
  const workflow = new WorkflowOrchestrator({ manager });
  const prepared = workflow.prepareAgentRun({
    projectId: "proj-r",
    projectRoot: "D:/recovery",
    goal: "Implementar cambios",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan failover");
  workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-r",
  });
  const checkpoint = manager.checkpoint(prepared.taskId, {
    currentStage: "implementation",
    completedSteps: [{ name: "step-1", ok: true }, { name: "step-2", ok: true }],
    nextAction: { type: "CONTINUE", description: "Continuar tras failover", status: "PENDING" },
    metadata: { failover: true, failedModel: "model-a", selectedModel: "model-b" },
  });
  manager.transition(prepared.taskId, "WAITING", {
    currentStage: "waiting_for_provider",
    resumeRequired: true,
  }, "WAITING_FOR_PROVIDER");

  const rebootManager = new TaskManager({ store: manager.store });
  const rebootWorkflow = new WorkflowOrchestrator({ manager: rebootManager });
  const described = rebootWorkflow.describeWorkflow(prepared.taskId);
  assert.equal(described.state, "WAITING");
  assert.notEqual(described.state, "ANALYZING");
  assert.equal(described.planId, plan.planId);

  const latestCheckpoint = manager.getCheckpoint(prepared.taskId);
  assert.deepEqual(latestCheckpoint.completedSteps.map((step) => step.name), ["step-1", "step-2"]);

  const coordinator = new ModelFailoverCoordinator({
    current: profile("b"),
    candidates: [profile("c")],
    maxRetriesPerModel: 0,
    taskContext: {
      taskId: prepared.taskId,
      planId: plan.planId,
      approvalId: rebootManager.getTask(prepared.taskId).approvalId,
      runId: "run-r",
    },
    onCheckpoint: async (meta) => manager.checkpoint(prepared.taskId, {
      currentStage: "implementation",
      completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
      nextAction: { type: "CONTINUE", description: "Continuar tras failover", status: "PENDING" },
    }),
  });
  const resumed = await coordinator.handleFailure(providerError("timeout"), {
    completedSteps: ["step-1", "step-2"],
    currentStage: "implementation",
  });
  assert.equal(resumed.action, "failover");
  assert.deepEqual(resumed.checkpoint?.completedSteps?.map((step) => step.name) || ["step-1", "step-2"], ["step-1", "step-2"]);
  rebootWorkflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-r2",
  });
  rebootWorkflow.completeImplementationRun(prepared.taskId, "run-r2", { ok: true });
  assert.equal(rebootManager.getTask(prepared.taskId).status, "COMPLETED");
});

test("TEST 7: eventos duplicados de failover no duplican operaciones", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-7", runId: "run-7" },
    onCheckpoint: async () => ({ checkpointId: "cp-7" }),
  });
  const first = await coordinator.handleFailure(providerError("timeout"), { completedSteps: ["s1"] });
  coordinator.current = profile("a");
  const duplicate = await coordinator.handleFailure(providerError("timeout again"), { completedSteps: ["s1"] });
  assert.equal(first.action, "failover");
  assert.equal(duplicate.action, "duplicate_failover");
  assert.equal(modelProfileKey(duplicate.profile), modelProfileKey(first.profile));
});

test("TEST 9: failover rota por todos los modelos compatibles en orden estable", async () => {
  const modelA = profile("a");
  const modelB = profile("b");
  const modelC = profile("c");
  const coordinator = new ModelFailoverCoordinator({
    current: modelA,
    candidates: [modelB, modelC],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-9", runId: "run-9" },
    onCheckpoint: async () => ({ checkpointId: "cp-9" }),
  });
  const first = await coordinator.handleFailure(providerError("timeout"), { completedSteps: [] });
  assert.equal(first.action, "failover");
  assert.equal(first.profile.model, "model-b");
  coordinator.current = first.profile;
  const second = await coordinator.handleFailure(providerError("timeout again"), { completedSteps: [] });
  assert.equal(second.action, "failover");
  assert.equal(second.profile.model, "model-c");
});

test("TEST 8: error real de task no se oculta con failover", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "task-8", runId: "run-8" },
    onCheckpoint: async () => ({ checkpointId: "cp-8" }),
  });
  const result = await coordinator.handleFailure(taskError("La misma accion fallo dos veces"), { completedSteps: [] });
  assert.equal(result.action, "task_error");
  assert.equal(isTaskLevelError(result.error), true);
  assert.equal(isRecoverableModelError(providerError("timeout")), true);
});
