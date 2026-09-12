"use strict";

/**
 * E2E: Worker death → failover automático → continuación misma Task.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
const { ActionRegistry } = require("../runtime/action-registry");
const { ToolDispatcher } = require("../runtime/tool-dispatcher");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const { WorkerSupervisor } = require("../runtime/worker-supervisor");
const { ModelFailoverCoordinator, recordIntraTurnFallback } = require("../runtime/model-failover");

function profile(id) {
  return {
    providerKey: `provider-${id}`,
    baseUrl: `https://api.${id}.test/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    toolOK: true,
    chatOK: true,
  };
}

function providerError(model) {
  const error = new Error(`${model}: worker dead`);
  error.code = "WORKER_DEAD";
  error.status = 503;
  return error;
}

function createHarness(root, manager, workflow, supervisor, { hangModels, succeedModels, taskContext, current, candidates, runId, onReady }) {
  const runState = { executionEpoch: 0, requestController: null, pendingWorkerDeathError: null };
  let adapterInput = null;
  const rawProvider = {
    async call(options) {
      const model = String(options.model || "");
      if (hangModels.has(model)) {
        await new Promise((resolve, reject) => {
          if (options.signal?.aborted) return reject(options.signal.reason || providerError(model));
          options.signal?.addEventListener("abort", () => reject(options.signal.reason || providerError(model)), { once: true });
        });
      }
      if (!succeedModels.has(model)) throw providerError(model);
      const wantsTool = Array.isArray(options.tools) && options.tools.length > 0;
      if (!rawProvider._turns) rawProvider._turns = new Map();
      const turn = rawProvider._turns.get(model) || 0;
      rawProvider._turns.set(model, turn + 1);
      if (wantsTool && turn === 0) {
        return { text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) } }], usage: {} };
      }
      if (wantsTool && turn === 1) {
        return {
          text: "",
          toolCalls: [{
            id: "c2",
            type: "function",
            function: { name: "write_file", arguments: JSON.stringify({ path: "package.json", content: JSON.stringify({ name: "fixture", version: "1.0.1" }) }) },
          }],
          usage: {},
        };
      }
      if (wantsTool && turn === 2) {
        return { text: "", toolCalls: [{ id: "c3", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "npm test" }) } }], usage: {} };
      }
      return { text: JSON.stringify({ type: "final", text: `Completado por ${model}` }), usage: {} };
    },
  };
  const providerApi = {
    async call(options) {
      const requestController = new AbortController();
      runState.requestController = requestController;
      const signal = options.signal ? AbortSignal.any([options.signal, requestController.signal]) : requestController.signal;
      try {
        return await rawProvider.call({ ...options, signal });
      } finally {
        if (runState.requestController === requestController) runState.requestController = null;
      }
    },
  };
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 12, tokenBudget: 100000, logger: console });
  adapter.actionRegistry = new ActionRegistry({ maxEntries: 200, cacheTTL: 3_600_000 });
  const dispatcher = new ToolDispatcher({ defaultTimeoutMs: 5000, authorize: async () => true });
  dispatcher.register({
    name: "read_file",
    description: "read",
    execute: async (input) => ({
      path: String(input?.path || "package.json"),
      content: fs.readFileSync(path.join(root, String(input?.path || "package.json")), "utf8"),
      isDirectory: false,
    }),
  });
  dispatcher.register({
    name: "write_file",
    write: true,
    description: "write",
    execute: async (input) => {
      const rel = String(input.path || "package.json");
      fs.writeFileSync(path.join(root, rel), String(input.content || ""), "utf8");
      return { path: rel, ok: true };
    },
  });
  dispatcher.register({
    name: "run_command",
    description: "verify",
    execute: async () => ({ output: "ok", code: 0 }),
  });
  adapter.toolExecutor = {
    execute: async (name, input) => {
      const result = await dispatcher.dispatch(name, input);
      if (!result.ok) throw new Error(result.error || `La herramienta ${name} fallo.`);
      return result.result;
    },
  };
  adapter.providerApi = providerApi;

  const coordinator = new ModelFailoverCoordinator({
    current,
    candidates,
    maxRetriesPerModel: 0,
    taskContext,
    onCheckpoint: async (meta) => manager.checkpoint(taskContext.taskId, {
      currentStage: "implementation",
      completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
      nextAction: { type: "CONTINUE", description: "Continuar", status: "PENDING" },
      metadata: { failover: true, failedModel: meta.failedModel?.model || "" },
    }),
  });

  adapterInput = {
    prompt: "procede", projectRoot: root, taskId: taskContext.taskId,
    model: current.model, apiKey: current.apiKey, baseUrl: current.baseUrl, providerKey: current.providerKey,
    allowWrite: true, planAuthorized: true, requireEvidence: false, enforceController: false,
    failover: coordinator,
    pullWorkerDeathError: () => {
      if (!runState.pendingWorkerDeathError) return null;
      const err = runState.pendingWorkerDeathError;
      runState.pendingWorkerDeathError = null;
      return err;
    },
    captureExecutionEpoch: () => runState.executionEpoch || 0,
    assertExecutionActive: (epoch) => {
      if (epoch !== undefined && epoch !== (runState.executionEpoch || 0)) {
        const error = new Error("Ejecucion invalidada");
        error.code = "EXECUTION_INVALIDATED";
        throw error;
      }
    },
    resetWorkerHealth: () => supervisor.resetWorkerHealth("e2e", runId),
  };

  supervisor.registerRunContext("e2e", runId, {
    failover: coordinator,
    adapterInput,
    taskContext,
    handledWorkerDeaths: new Set(),
    get executionEpoch() { return runState.executionEpoch || 0; },
    set executionEpoch(v) { runState.executionEpoch = v; },
    get pendingWorkerDeathError() { return runState.pendingWorkerDeathError; },
    set pendingWorkerDeathError(v) { runState.pendingWorkerDeathError = v; },
    getRequestController: () => runState.requestController,
  });

  let workerRef = null;
  const supervised = supervisor.start({
    senderId: "e2e",
    taskId: taskContext.taskId,
    runId,
    durableRunId: runId,
    heartbeatMs: 200,
    execute: async () => {
      if (onReady) onReady({ worker: workerRef, supervisor, coordinator, runState });
      return adapter.executeTask(adapterInput);
    },
  });
  workerRef = supervised.worker;
  return { promise: supervised.promise, coordinator, adapterInput, worker: workerRef, supervisor, runId };
}

async function runScenario(name, { deaths = 1, models = ["a", "b", "c"] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-failover-e2e-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  const supervisor = new WorkerSupervisor({ manager, heartbeatTimeoutMs: 1000 });

  const prepared = workflow.prepareAgentRun({ projectId: "e2e", projectRoot: root, goal: "Fix", analysisMode: true });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan autorizado");
  workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, prompt: "procede", runId: `run-${name}` });
  const task = manager.getTask(prepared.taskId);

  const hangModels = new Set(models.slice(0, deaths));
  const succeedModel = models[deaths] || models[models.length - 1];
  const succeedModels = new Set([succeedModel]);

  let deathCount = 0;
  const runName = `run-${name}`;
  const harness = createHarness(root, manager, workflow, supervisor, {
    hangModels: new Set(models.filter((m) => m !== succeedModel).map((m) => `model-${m}`)),
    succeedModels: new Set([`model-${succeedModel}`]),
    current: profile(models[0]),
    candidates: models.slice(1).map((id) => profile(id)),
    taskContext: {
      taskId: prepared.taskId,
      planId: plan.planId,
      approvalId: task.approvalId,
      runId: runName,
    },
    runId: runName,
  });

  const scheduleDeaths = () => {
    const tick = () => {
      if (deathCount >= deaths) return;
      const worker = harness.worker;
      if (!worker) return setTimeout(tick, 50);
      if (worker.timer) clearInterval(worker.timer);
      worker.lastHeartbeatAt = Date.now() - 5000;
      worker.deadHandled = false;
      worker.stallReported = false;
      worker.invalidated = false;
      supervisor.injectWorkerDeath("e2e", runName, { ageMs: 5000 });
      deathCount += 1;
      setTimeout(tick, 200);
    };
    setTimeout(tick, 150);
  };
  scheduleDeaths();

  const result = await harness.promise;
  fs.rmSync(root, { recursive: true, force: true });
  return {
    name,
    taskId: prepared.taskId,
    planId: plan.planId,
    approvalId: task.approvalId,
    runId: `run-${name}`,
    models,
    workerDeaths: deathCount,
    failovers: harness.coordinator.failoverCount,
    failedModels: harness.coordinator.getFailureHistory().map((entry) => entry.model),
    finalModel: harness.coordinator.current?.model,
    completed: result.completed,
    waiting: harness.adapterInput.failoverWaiting === true,
    checkpoints: manager.listCheckpoints?.(prepared.taskId)?.length || 0,
  };
}

async function main() {
  const report = { ok: false, scenarios: [] };
  try {
    report.scenarios.push(await runScenario("A-dead-B-complete", { deaths: 1, models: ["a", "b"] }));
    report.scenarios.push(await runScenario("A-dead-B-dead-C-complete", { deaths: 2, models: ["a", "b", "c"] }));
    report.ok = report.scenarios.every((scenario) => scenario.completed === true && scenario.failovers === scenario.workerDeaths);
  } catch (error) {
    report.error = String(error?.message || error);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
