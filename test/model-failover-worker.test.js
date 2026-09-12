"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
const { ActionRegistry } = require("../runtime/action-registry");
const { ToolDispatcher } = require("../runtime/tool-dispatcher");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const { WorkerSupervisor } = require("../runtime/worker-supervisor");
const {
  ModelFailoverCoordinator,
  recordIntraTurnFallback,
  modelProfileKey,
} = require("../runtime/model-failover");

function profile(id, extra = {}) {
  return {
    providerKey: `provider-${id}`,
    baseUrl: `https://api.${id}.test/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    toolOK: true,
    chatOK: true,
    ...extra,
  };
}

function providerError(model, message = "503", status = 503) {
  const error = new Error(`${model}: ${message}`);
  error.status = status;
  return error;
}

function tempSession(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-worker-failover-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  const supervisor = new WorkerSupervisor({ manager, heartbeatTimeoutMs: 1000 });
  return { root, store, manager, workflow, supervisor };
}

function buildRunContext(runState, coordinator, adapterInput, taskContext) {
  return {
    failover: coordinator,
    adapterInput,
    taskContext,
    handledWorkerDeaths: new Set(),
    get executionEpoch() { return runState.executionEpoch || 0; },
    set executionEpoch(value) { runState.executionEpoch = value; },
    get pendingWorkerDeathError() { return runState.pendingWorkerDeathError || null; },
    set pendingWorkerDeathError(value) { runState.pendingWorkerDeathError = value; },
    getRequestController: () => runState.requestController,
  };
}

function createProviderApi({ failModels = new Set(), hangModels = new Set(), succeedModels = new Set(), calls = [], intraTurnMap = new Map() }) {
  const turnByModel = new Map();
  return {
    async call(options) {
      const model = String(options.model || "");
      calls.push({ model });
      if (hangModels.has(model)) {
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(options.signal?.reason || providerError(model, "Worker DEAD", 503));
          if (options.signal?.aborted) return reject(options.signal.reason || providerError(model, "Worker DEAD", 503));
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      if (failModels.has(model)) {
        const fallback = intraTurnMap.get(model);
        if (fallback) {
          return {
            text: JSON.stringify({ type: "final", text: `OK ${fallback}` }),
            usage: { total_tokens: 10 },
            fallback: {
              from: { providerKey: "p", model, baseUrl: "https://a.test/v1", apiKey: "k1" },
              to: { providerKey: "p", model: fallback, baseUrl: "https://b.test/v1", apiKey: "k2" },
            },
          };
        }
        throw providerError(model);
      }
      if (succeedModels.size && !succeedModels.has(model)) {
        throw providerError(model, "not configured");
      }
      const wantsTool = Array.isArray(options.tools) && options.tools.length > 0;
      const turn = turnByModel.get(model) || 0;
      turnByModel.set(model, turn + 1);
      if (wantsTool && turn === 0) {
        return {
          text: "",
          toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) } }],
          usage: { total_tokens: 5 },
        };
      }
      if (wantsTool && turn === 1) {
        return {
          text: "",
          toolCalls: [{
            id: "c2",
            type: "function",
            function: {
              name: "write_file",
              arguments: JSON.stringify({ path: "package.json", content: JSON.stringify({ name: "fixture", version: "1.0.1" }) }),
            },
          }],
          usage: { total_tokens: 5 },
        };
      }
      if (wantsTool && turn === 2) {
        return {
          text: "",
          toolCalls: [{ id: "c3", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "npm test" }) } }],
          usage: { total_tokens: 5 },
        };
      }
      return {
        text: JSON.stringify({ type: "final", text: `Completado por ${model}` }),
        usage: { total_tokens: 8 },
      };
    },
  };
}

function runWorkerHarness({
  root,
  manager,
  workflow,
  supervisor,
  candidates,
  current,
  taskContext,
  providerApi: rawProviderApi,
  senderId = "test-sender",
  runId = "run-worker",
  onReady,
}) {
  const calls = [];
  const runState = { executionEpoch: 0, requestController: null, pendingWorkerDeathError: null, adapterInput: null };
  let adapterInput = null;
  const providerApi = {
    async call(options) {
      const requestController = new AbortController();
      runState.requestController = requestController;
      const signal = options.signal
        ? AbortSignal.any([options.signal, requestController.signal])
        : requestController.signal;
      try {
        const result = await rawProviderApi.call({ ...options, signal });
        if (result?.fallback?.to && adapterInput?.failover) {
          recordIntraTurnFallback(adapterInput.failover, adapterInput, result.fallback);
        }
        return result;
      } finally {
        if (runState.requestController === requestController) runState.requestController = null;
      }
    },
  };
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 12, tokenBudget: 100000, logger: { log() {}, warn() {} } });
  adapter.actionRegistry = new ActionRegistry({ maxEntries: 200, cacheTTL: 3_600_000 });
  const dispatcher = new ToolDispatcher({ defaultTimeoutMs: 5000, authorize: async () => true });
  dispatcher.register({
    name: "read_file",
    description: "Lee archivo",
    execute: async (input) => ({
      path: String(input.path || "package.json"),
      content: fs.readFileSync(path.join(root, String(input.path || "package.json")), "utf8"),
      isDirectory: false,
    }),
  });
  dispatcher.register({
    name: "write_file",
    write: true,
    description: "Escribe archivo",
    execute: async (input) => {
      const rel = String(input.path || "package.json");
      fs.writeFileSync(path.join(root, rel), String(input.content || ""), "utf8");
      return { path: rel, bytes: Buffer.byteLength(String(input.content || "")), ok: true };
    },
  });
  dispatcher.register({
    name: "run_command",
    description: "Verifica",
    execute: async () => ({ output: "ok", code: 0 }),
  });
  adapter.toolExecutor = {
    execute: async (toolName, toolInput) => {
      const result = await dispatcher.dispatch(toolName, toolInput);
      if (!result.ok) throw new Error(result.error || `La herramienta ${toolName} fallo.`);
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
    prompt: "procede",
    projectRoot: root,
    taskId: taskContext.taskId,
    model: current.model,
    apiKey: current.apiKey,
    baseUrl: current.baseUrl,
    providerKey: current.providerKey,
    allowWrite: true,
    analysisMode: false,
    planAuthorized: true,
    requireEvidence: false,
    enforceController: false,
    failover: coordinator,
    pullWorkerDeathError: () => {
      if (!runState.pendingWorkerDeathError) return null;
      const err = runState.pendingWorkerDeathError;
      runState.pendingWorkerDeathError = null;
      return err;
    },
    captureExecutionEpoch: () => runState.executionEpoch || 0,
    assertExecutionActive: (capturedEpoch) => {
      if (capturedEpoch !== undefined && capturedEpoch !== (runState.executionEpoch || 0)) {
        const error = new Error("Ejecucion invalidada por failover de worker.");
        error.code = "EXECUTION_INVALIDATED";
        throw error;
      }
    },
    resetWorkerHealth: () => supervisor.resetWorkerHealth(senderId, runId),
  };

  runState.adapterInput = adapterInput;
  supervisor.registerRunContext(senderId, runId, buildRunContext(runState, coordinator, adapterInput, taskContext));

  let workerRef = null;
  const supervised = supervisor.start({
    senderId,
    taskId: taskContext.taskId,
    runId,
    durableRunId: runId,
    heartbeatMs: 200,
    execute: async () => {
      if (typeof onReady === "function") {
        onReady({ supervisor, senderId, runId, runState, coordinator, worker: workerRef });
      }
      return adapter.executeTask(adapterInput);
    },
  });
  workerRef = supervised.worker;

  return { promise: supervised.promise, adapter, adapterInput, coordinator, runState, worker: supervised.worker, supervisor, senderId, runId, calls };
}

test("TEST 9: worker DEAD dispara failover y completa con modelo B", { timeout: 15000 }, async (t) => {
  const { root, manager, workflow, supervisor } = tempSession(t);
  const prepared = workflow.prepareAgentRun({ projectId: "p", projectRoot: root, goal: "Fix", analysisMode: true });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan");
  workflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-9",
  });
  const task = manager.getTask(prepared.taskId);
  const calls = [];
  const harness = runWorkerHarness({
    root,
    manager,
    workflow,
    supervisor,
    current: profile("a"),
    candidates: [profile("b")],
    taskContext: { taskId: prepared.taskId, planId: plan.planId, approvalId: task.approvalId, runId: "run-9" },
    providerApi: createProviderApi({ hangModels: new Set(["model-a"]), succeedModels: new Set(["model-b"]), calls }),
    runId: "run-9",
  });

  await new Promise((resolve) => setTimeout(resolve, 120));
  if (harness.worker.timer) clearInterval(harness.worker.timer);
  harness.worker.lastHeartbeatAt = Date.now() - 5000;
  assert.equal(supervisor.injectWorkerDeath("test-sender", "run-9", { ageMs: 5000 }), true);

  const result = await harness.promise;
  assert.equal(result.completed, true);
  assert.equal(prepared.taskId, task.taskId);
  assert.equal(plan.planId, task.planId);
  assert.ok(calls.some((call) => call.model === "model-b"));
  assert.equal(harness.coordinator.failoverCount, 1);
});

test("TEST 10: eventos DEAD duplicados producen un solo failover", { timeout: 15000 }, async (t) => {
  const { root, manager, workflow, supervisor } = tempSession(t);
  const prepared = workflow.prepareAgentRun({ projectId: "p", projectRoot: root, goal: "Fix", analysisMode: true });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan");
  workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, prompt: "procede", runId: "run-10" });
  const task = manager.getTask(prepared.taskId);
  const calls = [];
  const harness = runWorkerHarness({
    root, manager, workflow, supervisor,
    current: profile("a"),
    candidates: [profile("b")],
    taskContext: { taskId: prepared.taskId, planId: plan.planId, approvalId: task.approvalId, runId: "run-10" },
    providerApi: createProviderApi({ hangModels: new Set(["model-a"]), succeedModels: new Set(["model-b"]), calls }),
    runId: "run-10",
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (harness.worker.timer) clearInterval(harness.worker.timer);
  harness.worker.lastHeartbeatAt = Date.now() - 5000;
  assert.equal(supervisor.injectWorkerDeath("test-sender", "run-10", { ageMs: 5000 }), true);
  assert.equal(supervisor.injectWorkerDeath("test-sender", "run-10", { ageMs: 5000 }), false);
  supervisor.supervise();
  const result = await harness.promise;
  assert.equal(result.completed, true);
  assert.equal(harness.coordinator.failoverCount, 1);
});

test("TEST 11: worker invalidado no puede continuar operaciones tras failover", async () => {
  let epoch = 0;
  const input = {
    assertExecutionActive: (capturedEpoch) => {
      if (capturedEpoch !== undefined && capturedEpoch !== epoch) {
        const error = new Error("Ejecucion invalidada por failover de worker.");
        error.code = "EXECUTION_INVALIDATED";
        throw error;
      }
    },
    captureExecutionEpoch: () => epoch,
    bumpEpoch: () => { epoch += 1; },
  };
  const captured = input.captureExecutionEpoch();
  input.bumpEpoch();
  assert.throws(() => input.assertExecutionActive(captured), /invalidada/);
});

test("TEST 12: fallback intra-turno persiste modelo activo en siguiente turno", async (t) => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "t12", runId: "r12" },
    onCheckpoint: async () => ({ checkpointId: "cp12" }),
  });
  const input = { model: "model-a", apiKey: "k1", baseUrl: "https://a.test/v1", providerKey: "p" };
  recordIntraTurnFallback(coordinator, input, {
    from: profile("a"),
    to: profile("b"),
  });
  assert.equal(input.model, "model-b");
  assert.ok(coordinator.failedModels.has(modelProfileKey(profile("a"))));
  assert.equal(coordinator.current.model, "model-b");

  const calls = [];
  const providerApi = createProviderApi({
    failModels: new Set(["model-a"]),
    intraTurnMap: new Map([["model-a", "model-b"]]),
    succeedModels: new Set(["model-b"]),
    calls,
  });
  await providerApi.call({ model: "model-a", messages: [], tools: [] });
  recordIntraTurnFallback(coordinator, input, {
    from: profile("a"),
    to: profile("b"),
  });
  await providerApi.call({ model: input.model, messages: [], tools: [] });
  assert.deepEqual(calls.map((call) => call.model), ["model-a", "model-b"]);
});

test("TEST 13: A fallback intra-turno a B, B falla y pasa a C", async (t) => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b"), profile("c")],
    maxRetriesPerModel: 0,
    taskContext: { taskId: "t13", runId: "r13" },
    onCheckpoint: async () => ({ checkpointId: "cp13" }),
  });
  const input = { model: "model-a", apiKey: "k1", baseUrl: "https://a.test/v1", providerKey: "p" };
  recordIntraTurnFallback(coordinator, input, { from: profile("a"), to: profile("b") });
  assert.equal(input.model, "model-b");

  const failover = await coordinator.handleFailure(providerError("model-b"), { completedSteps: ["s1"] });
  assert.equal(failover.action, "failover");
  assert.equal(failover.profile.model, "model-c");
  assert.ok(coordinator.failedModels.has(modelProfileKey(profile("a"))));
  assert.ok(coordinator.failedModels.has(modelProfileKey(profile("b"))));
});

test("TEST 14: todos los modelos muertos por worker dejan WAITING_FOR_PROVIDER", async () => {
  const coordinator = new ModelFailoverCoordinator({
    current: profile("a"),
    candidates: [profile("b"), profile("c")],
    maxRetriesPerModel: 0,
    maxChainLength: 3,
    taskContext: { taskId: "t14", runId: "r14" },
    onCheckpoint: async () => ({ checkpointId: "cp14" }),
  });
  const first = await coordinator.handleFailure(coordinator.createWorkerDeathError(5000), { completedSteps: [] });
  assert.equal(first.action, "failover");
  assert.equal(first.profile.model, "model-b");
  const second = await coordinator.handleFailure(coordinator.createWorkerDeathError(5000), { completedSteps: [] });
  assert.equal(second.action, "failover");
  assert.equal(second.profile.model, "model-c");
  const waiting = await coordinator.handleFailure(coordinator.createWorkerDeathError(5000), { completedSteps: [] });
  assert.equal(waiting.action, "waiting_for_provider");
  assert.equal(coordinator.waitingForProvider, true);
});

test("TEST 15: recovery tras worker death conserva plan y no reinicia ANALYZING", async (t) => {
  const { root, manager, workflow, supervisor } = tempSession(t);
  const prepared = workflow.prepareAgentRun({ projectId: "p", projectRoot: root, goal: "Fix", analysisMode: true });
  const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan");
  workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, prompt: "procede", runId: "run-15" });
  const task = manager.getTask(prepared.taskId);

  manager.checkpoint(prepared.taskId, {
    currentStage: "implementation",
    completedSteps: [{ name: "step-1", ok: true }],
    nextAction: { type: "CONTINUE", description: "Continuar tras worker death", status: "PENDING" },
    metadata: { failover: true, failedModel: "model-a", selectedModel: "model-b" },
  });
  manager.transition(prepared.taskId, "WAITING", { currentStage: "waiting_for_provider", resumeRequired: true }, "WAITING_FOR_PROVIDER");

  const rebootManager = new TaskManager({ store: manager.store });
  const rebootWorkflow = new WorkflowOrchestrator({ manager: rebootManager });
  const described = rebootWorkflow.describeWorkflow(prepared.taskId);
  assert.equal(described.state, "WAITING");
  assert.notEqual(described.state, "ANALYZING");
  assert.equal(described.planId, plan.planId);

  rebootWorkflow.prepareAgentRun({
    taskId: prepared.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "procede",
    runId: "run-15-resume",
  });
  rebootWorkflow.completeImplementationRun(prepared.taskId, "run-15-resume", { ok: true });
  assert.equal(rebootManager.getTask(prepared.taskId).status, "COMPLETED");
  assert.equal(rebootManager.getTask(prepared.taskId).planId, plan.planId);
});
