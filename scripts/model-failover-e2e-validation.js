"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const { ModelFailoverCoordinator } = require("../runtime/model-failover");

const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  const line = args.map((item) => String(item)).join(" ");
  if (line.includes("[WORKFLOW]")) logs.push(line);
  originalLog(...args);
};

function profile(id) {
  return {
    providerKey: `provider-${id}`,
    baseUrl: `https://api.${id}.test/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    toolOK: true,
  };
}

function providerError(model, message = "provider unavailable") {
  const error = new Error(`${model}: ${message}`);
  error.status = 503;
  return error;
}

async function executeChain(coordinator, stepExecutor) {
  const completed = [];
  for (let i = 0; i < 30; i += 1) {
    try {
      const result = await stepExecutor(coordinator.current, completed);
      if (result?.done) return { completed, coordinator, model: coordinator.current.model };
      if (result?.step) completed.push(result.step);
    } catch (error) {
      const failover = await coordinator.handleFailure(error, {
        completedSteps: completed.map((step) => step.name),
        currentStage: "implementation",
      });
      if (failover.action === "failover" || failover.action === "duplicate_failover") {
        coordinator.applyProfileToInput({}, failover.profile);
        continue;
      }
      throw error;
    }
  }
  throw new Error("chain did not complete");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-failover-e2e-"));
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });

  const prepared = workflow.prepareAgentRun({
    projectId: "proj-e2e-failover",
    projectRoot: "D:/demo",
    goal: "Implementar correcciones",
    analysisMode: true,
  });
  const T1 = prepared.taskId;
  const plan = workflow.completeAnalysisRun(T1, "Plan de correcciones");
  const P1 = plan.planId;
  const approved = workflow.prepareAgentRun({
    taskId: T1,
    planId: P1,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "R1",
  });
  const A1 = approved.approvalId;
  const checkpoints = [];

  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b"), profile("c")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: T1, planId: P1, approvalId: A1, runId: "R1" },
    onCheckpoint: async (meta) => {
      const checkpoint = manager.checkpoint(T1, {
        currentStage: meta.currentStage || "implementation",
        completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
        nextAction: { type: "CONTINUE", description: "Continuar tras failover", status: "PENDING" },
        metadata: {
          failedModel: meta.failedModel?.model,
          error: meta.error,
          planId: P1,
          approvalId: A1,
          runId: "R1",
        },
      });
      checkpoints.push(checkpoint.checkpointId);
      return checkpoint;
    },
  });

  const chain = await executeChain(coordinator, async (current, completed) => {
    if (completed.length === 0 && current.model === "model-a") {
      return { step: { name: "step-1", ok: true } };
    }
    if (current.model === "model-a") throw providerError("model-a", "timeout API");
    if (completed.length === 1 && current.model === "model-b") {
      return { step: { name: "step-2", ok: true } };
    }
    if (current.model === "model-b") throw providerError("model-b", "rate limit");
    if (current.model === "model-c") return { done: true };
    throw new Error(`unexpected model ${current.model}`);
  });

  workflow.completeImplementationRun(T1, "R1", { ok: true });

  const report = {
    ok: manager.getTask(T1).status === "COMPLETED"
      && manager.listTasks().length === 1
      && manager.getTask(T1).planId === P1
      && manager.getTask(T1).approvalId === A1
      && checkpoints.length === 2
      && chain.model === "model-c",
    traceability: {
      taskId: T1,
      planId: P1,
      approvalId: A1,
      runId: "R1",
      modelA: "model-a",
      modelAFailure: "timeout API",
      checkpointC1: checkpoints[0] || "",
      modelB: "model-b",
      modelBFailure: "rate limit",
      checkpointC2: checkpoints[1] || "",
      modelC: chain.model,
      finalState: manager.getTask(T1).status,
    },
    completedSteps: chain.completed.map((step) => step.name),
    noDuplicateWork: chain.completed.map((step) => step.name).join(",") === "step-1,step-2",
    noNewTask: manager.listTasks().length === 1,
    noNewPlan: manager.getTask(T1).planId === P1,
    noNewApproval: manager.getTask(T1).approvalId === A1,
    workflowLogs: logs.filter((line) => /FAILOVER|CHECKPOINT|MODEL_/.test(line)),
  };

  originalLog(JSON.stringify(report, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  originalLog(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});
