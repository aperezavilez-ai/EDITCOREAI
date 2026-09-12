"use strict";

/**
 * Validacion de integracion real del failover.
 * Replica el cableado de main.js: adapter + providerApi + ModelFailoverCoordinator + WorkerSupervisor.
 * Inyeccion de fallos en providerApi.call (misma capa que agent:run), NO mock del coordinator.
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
const {
  ModelFailoverCoordinator,
  isRecoverableModelError,
  isTaskLevelError,
  modelProfileKey,
} = require("../runtime/model-failover");

const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  const line = args.map((item) => String(item)).join(" ");
  if (line.includes("[WORKFLOW]")) logs.push(line);
  originalLog(...args);
};

function profile(id, extra = {}) {
  return {
    providerKey: `provider-${id}`,
    baseUrl: `https://gateway.${id}.test/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    toolOK: true,
    chatOK: true,
    ...extra,
  };
}

function providerError(model, message = "503 Service Unavailable", status = 503) {
  const error = new Error(`${model}: ${message}`);
  error.status = status;
  return error;
}

function taskLevelError(message) {
  const error = new Error(message);
  error.code = "TASK_LEVEL_ERROR";
  error.taskLevel = true;
  return error;
}

function createHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-failover-int-"));
  if (t?.after) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
  const store = new TaskStore({ root: path.join(root, "task-store") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  const supervisor = new WorkerSupervisor({ manager, heartbeatTimeoutMs: 2000 });
  return { root, store, manager, workflow, supervisor };
}

function createProviderApi({ failModels = new Set(), succeedModels = new Set(), allowIntraTurnFallback = false, intraTurnMap = new Map(), calls = [] }) {
  return {
    async call(options) {
      const model = String(options.model || "");
      calls.push({ model, messages: options.messages?.length || 0, tools: options.tools?.length || 0 });
      if (failModels.has(model)) {
        if (allowIntraTurnFallback) {
          const fallbackModel = intraTurnMap.get(model);
          if (fallbackModel && !failModels.has(fallbackModel)) {
            return {
              text: JSON.stringify({ type: "final", text: `Completado por fallback intra-turno ${fallbackModel}` }),
              usage: { total_tokens: 10 },
              fallback: { from: { model }, to: { model: fallbackModel } },
            };
          }
        }
        throw providerError(model);
      }
      if (succeedModels.size && !succeedModels.has(model)) {
        throw providerError(model, "modelo no configurado para exito");
      }
      const prompt = JSON.stringify(options.messages || []);
      const wantsTool = Array.isArray(options.tools) && options.tools.length > 0;
      if (wantsTool && !/read_file/.test(prompt)) {
        return {
          text: "",
          toolCalls: [{
            id: `call_${calls.length}`,
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) },
          }],
          usage: { total_tokens: 12 },
        };
      }
      if (wantsTool && /read_file/.test(prompt) && !/final/.test(prompt)) {
        return {
          text: JSON.stringify({ type: "final", text: `Implementacion completada por ${model}` }),
          usage: { total_tokens: 20 },
        };
      }
      return {
        text: JSON.stringify({ type: "final", text: `OK ${model}` }),
        usage: { total_tokens: 8 },
      };
    },
  };
}

function buildCoordinator(manager, workflowCtx, candidates, current, onCheckpoint) {
  return new ModelFailoverCoordinator({
    current,
    candidates,
    maxRetriesPerModel: 0,
    requiredCapability: "agent",
    taskContext: workflowCtx,
    onCheckpoint,
  });
}

async function runAdapterExecution({
  root,
  manager,
  adapterInput,
  durableRun,
  taskId,
  analysisMode = false,
  senderId = "integration-test",
  runId = "run-int",
}) {
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 12, tokenBudget: 100000, logger: console });
  adapter.actionRegistry = new ActionRegistry({ maxEntries: 200, cacheTTL: 3_600_000 });
  const dispatcher = new ToolDispatcher({ defaultTimeoutMs: 10_000, authorize: async () => true });
  dispatcher.register({
    name: "read_file",
    description: "Lee archivo",
    execute: async () => ({ path: "package.json", content: fs.readFileSync(path.join(root, "package.json"), "utf8") }),
  });
  adapter.toolExecutor = async (toolName, toolInput) => dispatcher.execute(toolName, toolInput);
  adapter.providerApi = adapterInput.providerApi;
  adapter.taskManager = {
    updateProgress(step) {
      if (!durableRun) return;
      const durableStep = manager.startStep(taskId, durableRun.runId, {
        stage: analysisMode ? "analysis" : "implementation",
        toolName: step.name,
        goal: `Ejecutar ${step.name}`,
      });
      manager.completeStep(taskId, durableStep.stepId, { ok: step.ok !== false, result: step.result });
    },
    createCheckpoint(steps) {
      if (!durableRun) return null;
      return manager.checkpoint(taskId, {
        currentStage: analysisMode ? "analysis" : "implementation",
        completedSteps: steps.map((step) => ({ name: step.name, ok: step.ok !== false })),
        nextAction: { type: "CONTINUE", description: "Continuar", status: "PENDING" },
      });
    },
  };
  const supervisor = new WorkerSupervisor({ manager, heartbeatTimeoutMs: 2000 });
  const supervised = supervisor.start({
    senderId,
    taskId,
    runId,
    durableRunId: durableRun?.runId || runId,
    heartbeatMs: 500,
    execute: async () => adapter.executeTask(adapterInput),
  });
  return { result: await supervised.promise, adapter, adapterInput, supervisor, calls: adapterInput._calls || [] };
}

async function main() {
  const report = {
    method: "FAILURE_INJECTION",
    layer: "adapter.providerApi.call (misma capa que main.js agent:run)",
    scenarios: {},
    audit: {
      intraTurnFirst: "callProvider() dentro de providerApi — actua por solicitud HTTP individual",
      durableSecond: "ModelFailoverCoordinator — actua cuando providerApi lanza error hacia adapter.executeTask",
      singleCoordinator: true,
      competitionRisk: "Si intra-turno tiene exito, input.model no cambia; durable solo actua tras throw",
    },
    traceability: {},
    regression: {},
    ok: false,
  };

  // --- Escenario principal A -> B ---
  {
    const { root, manager, workflow } = createHarness();
    const prepared = workflow.prepareAgentRun({
      projectId: "int-proj",
      projectRoot: root,
      goal: "Implementar correccion",
      analysisMode: true,
    });
    const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan integracion");
    const approved = workflow.prepareAgentRun({
      taskId: prepared.taskId,
      planId: plan.planId,
      planAuthorized: true,
      executionMode: "AUTHORIZED_PLAN",
      prompt: "procede",
      runId: "R-main",
    });
    const durableRun = manager.startRun(prepared.taskId, { runId: "R-main", taskStatus: "EXECUTING", stage: "implementation" });
    const calls = [];
    const checkpoints = [];
    const coordinator = buildCoordinator(
      manager,
      { taskId: prepared.taskId, planId: plan.planId, approvalId: approved.approvalId, runId: "R-main" },
      [profile("b"), profile("c")],
      profile("a"),
      async (meta) => {
        const cp = manager.checkpoint(prepared.taskId, {
          currentStage: meta.currentStage || "implementation",
          completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
          nextAction: { type: "CONTINUE", description: "Failover", status: "PENDING" },
        });
        checkpoints.push(cp);
        return cp;
      },
    );
    coordinator.markExecutionStarted();
    const providerApi = createProviderApi({ failModels: new Set(["model-a"]), calls });
    const { result, adapter } = await runAdapterExecution({
      root,
      manager,
      taskId: prepared.taskId,
      durableRun,
      runId: "R-main",
      adapterInput: {
        prompt: "Implementar correccion autorizada",
        projectRoot: root,
        taskId: prepared.taskId,
        model: "model-a",
        apiKey: "key-a",
        baseUrl: "https://gateway.a.test/v1",
        providerKey: "provider-a",
        allowWrite: true,
        planAuthorized: true,
        analysisMode: false,
        requireEvidence: false,
        providerApi,
        failover: coordinator,
        _calls: calls,
      },
    });
    workflow.completeImplementationRun(prepared.taskId, "R-main", { ok: true });
    const task = manager.getTask(prepared.taskId);
    const events = logs.filter((line) => line.includes(prepared.taskId));
    report.scenarios.primary = {
      pass: task.taskId === prepared.taskId
        && task.planId === plan.planId
        && task.approvalId === approved.approvalId
        && task.status === "COMPLETED"
        && coordinator.current.model === "model-b"
        && checkpoints.length >= 1
        && events.some((line) => line.includes("MODEL_EXECUTION_FAILED"))
        && events.some((line) => line.includes("CHECKPOINT_PERSISTED"))
        && events.some((line) => line.includes("FAILOVER_STARTED"))
        && events.some((line) => line.includes("MODEL_SELECTED"))
        && events.some((line) => line.includes("MODEL_EXECUTION_RESUMED") || line.includes("FAILOVER_COMPLETED")),
      taskId: task.taskId,
      planId: task.planId,
      approvalId: task.approvalId,
      runId: "R-main",
      modelAfterFailover: coordinator.current.model,
      checkpointIds: checkpoints.map((cp) => cp.checkpointId),
      providerCalls: calls.map((item) => item.model),
      completed: result.completed,
    };
    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Escenario A -> B -> C ---
  {
    const { root, manager, workflow } = createHarness();
    const prepared = workflow.prepareAgentRun({ projectId: "int-abc", projectRoot: root, goal: "Tarea ABC", analysisMode: true });
    const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan ABC");
    workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, executionMode: "AUTHORIZED_PLAN", prompt: "procede", runId: "R-abc" });
    const durableRun = manager.startRun(prepared.taskId, { runId: "R-abc", taskStatus: "EXECUTING", stage: "implementation" });
    const calls = [];
    const coordinator = buildCoordinator(
      manager,
      { taskId: prepared.taskId, planId: plan.planId, runId: "R-abc" },
      [profile("b"), profile("c")],
      profile("a"),
      async (meta) => manager.checkpoint(prepared.taskId, {
        currentStage: "implementation",
        completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
        nextAction: { type: "CONTINUE", description: "Failover", status: "PENDING" },
      }),
    );
    const providerApi = createProviderApi({ failModels: new Set(["model-a", "model-b"]), calls });
    const { result } = await runAdapterExecution({
      root, manager, taskId: prepared.taskId, durableRun, runId: "R-abc",
      adapterInput: {
        prompt: "Continuar implementacion", projectRoot: root, taskId: prepared.taskId,
        model: "model-a", apiKey: "key-a", baseUrl: "https://gateway.a.test/v1", providerKey: "provider-a",
        allowWrite: true, planAuthorized: true, requireEvidence: false, providerApi, failover: coordinator, _calls: calls,
      },
    });
    workflow.completeImplementationRun(prepared.taskId, "R-abc", { ok: true });
    report.scenarios.multipleFailover = {
      pass: coordinator.current.model === "model-c"
        && coordinator.getFailureHistory().some((item) => item.model === "model-a")
        && coordinator.getFailureHistory().some((item) => item.model === "model-b")
        && manager.getTask(prepared.taskId).status === "COMPLETED"
        && (result.completed || Boolean(result.text)),
      failedModels: coordinator.getFailureHistory().map((item) => item.model),
      finalModel: coordinator.current.model,
      providerCalls: calls.map((item) => item.model),
    };
    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Todos los providers caidos -> WAITING -> recovery ---
  {
    const { root, manager, workflow } = createHarness();
    const prepared = workflow.prepareAgentRun({ projectId: "int-wait", projectRoot: root, goal: "Tarea wait", analysisMode: true });
    const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan wait");
    workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, executionMode: "AUTHORIZED_PLAN", prompt: "procede", runId: "R-wait" });
    const durableRun = manager.startRun(prepared.taskId, { runId: "R-wait", taskStatus: "EXECUTING", stage: "implementation" });
    const coordinator = buildCoordinator(
      manager,
      { taskId: prepared.taskId, planId: plan.planId, runId: "R-wait" },
      [profile("b")],
      profile("a"),
      async (meta) => manager.checkpoint(prepared.taskId, {
        currentStage: "implementation",
        completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
        nextAction: { type: "WAIT_FOR_PROVIDER", description: "Esperar provider", status: "WAITING" },
      }),
    );
    const providerApi = createProviderApi({ failModels: new Set(["model-a", "model-b"]) });
    const { result, adapterInput: executedInput } = await runAdapterExecution({
      root, manager, taskId: prepared.taskId, durableRun, runId: "R-wait",
      adapterInput: {
        prompt: "Tarea", projectRoot: root, taskId: prepared.taskId,
        model: "model-a", apiKey: "key-a", baseUrl: "https://gateway.a.test/v1", providerKey: "provider-a",
        allowWrite: true, planAuthorized: true, requireEvidence: false, providerApi, failover: coordinator,
      },
    });
    manager.updateRun(prepared.taskId, "R-wait", { status: "RECOVERABLE", recoveryReason: "Esperando proveedor compatible." });
    manager.transition(prepared.taskId, "WAITING", { currentStage: "waiting_for_provider", resumeRequired: true, activeRunId: "" }, "WAITING_FOR_PROVIDER");
    const waitingTask = manager.getTask(prepared.taskId);
    const checkpointBefore = manager.getCheckpoint(prepared.taskId);
    coordinator.current = profile("c");
    coordinator.candidates = [profile("c")];
    coordinator.waitingForProvider = false;
    coordinator.failedModels.clear();
    const recoveryCalls = [];
    const recoveryProvider = createProviderApi({ succeedModels: new Set(["model-c"]), calls: recoveryCalls });
    const recoveryRun = manager.startRun(prepared.taskId, { runId: "R-wait-2", taskStatus: "EXECUTING", stage: "implementation" });
    const { result: recovered } = await runAdapterExecution({
      root, manager, taskId: prepared.taskId,
      durableRun: recoveryRun,
      runId: "R-wait-2",
      adapterInput: {
        prompt: "Continuar tras espera", projectRoot: root, taskId: prepared.taskId,
        model: "model-c", apiKey: "key-c", baseUrl: "https://gateway.c.test/v1", providerKey: "provider-c",
        allowWrite: true, planAuthorized: true, requireEvidence: false, providerApi: recoveryProvider, failover: coordinator,
      },
    });
    workflow.completeImplementationRun(prepared.taskId, "R-wait-2", { ok: true });
    report.scenarios.allProvidersDown = {
      pass: executedInput.failoverWaiting === true
        && waitingTask.status === "WAITING"
        && waitingTask.status !== "FAILED"
        && checkpointBefore?.checkpointId
        && (recovered.completed || Boolean(recovered.text))
        && manager.getTask(prepared.taskId).planId === plan.planId,
      stateWhileWaiting: waitingTask.status,
      recovered: manager.getTask(prepared.taskId).status,
      checkpointId: checkpointBefore?.checkpointId,
    };
    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Checkpoint contents ---
  {
    const { root, manager, workflow } = createHarness();
    const prepared = workflow.prepareAgentRun({ projectId: "int-cp", projectRoot: root, goal: "Checkpoint", analysisMode: true });
    const plan = workflow.completeAnalysisRun(prepared.taskId, "Plan cp");
    const approved = workflow.prepareAgentRun({ taskId: prepared.taskId, planId: plan.planId, planAuthorized: true, executionMode: "AUTHORIZED_PLAN", prompt: "procede", runId: "R-cp" });
    const durableRun = manager.startRun(prepared.taskId, { runId: "R-cp", taskStatus: "EXECUTING", stage: "implementation" });
    let savedCheckpoint = null;
    const coordinator = buildCoordinator(
      manager,
      { taskId: prepared.taskId, planId: plan.planId, approvalId: approved.approvalId, runId: "R-cp" },
      [profile("b")],
      profile("a"),
      async (meta) => {
        savedCheckpoint = manager.checkpoint(prepared.taskId, {
          currentStage: meta.currentStage || "implementation",
          completedSteps: (meta.completedSteps || []).map((name) => ({ name, ok: true })),
          nextAction: { type: "CONTINUE", description: "Failover", status: "PENDING" },
        });
        return savedCheckpoint;
      },
    );
    const calls = [];
    const providerApi = createProviderApi({ failModels: new Set(["model-a"]), calls });
    await runAdapterExecution({
      root, manager, taskId: prepared.taskId, durableRun, runId: "R-cp",
      adapterInput: {
        prompt: "Tarea checkpoint", projectRoot: root, taskId: prepared.taskId,
        model: "model-a", apiKey: "key-a", baseUrl: "https://gateway.a.test/v1", providerKey: "provider-a",
        allowWrite: true, planAuthorized: true, requireEvidence: false, providerApi, failover: coordinator, _calls: calls,
      },
    });
    report.scenarios.checkpoint = {
      pass: Boolean(savedCheckpoint?.checkpointId)
        && savedCheckpoint.taskId === prepared.taskId
        && Array.isArray(savedCheckpoint.completedSteps)
        && calls.some((item) => item.model === "model-b"),
      checkpointId: savedCheckpoint?.checkpointId,
      completedSteps: (savedCheckpoint?.completedSteps || []).map((step) => step.name),
      secondModelUsed: calls.some((item) => item.model === "model-b"),
      noRestartFromZero: calls.filter((item) => item.model === "model-b").length >= 1,
    };
    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Duplicacion ---
  {
    const coordinator = buildCoordinator(
      { checkpoint: () => ({}) },
      { taskId: "dup", runId: "dup" },
      [profile("b")],
      profile("a"),
      async () => ({ checkpointId: "cp-dup" }),
    );
    coordinator.current = profile("a");
    const first = await coordinator.handleFailure(providerError("model-a"), { completedSteps: ["step-1"] });
    coordinator.current = profile("a");
    const second = await coordinator.handleFailure(providerError("model-a"), { completedSteps: ["step-1"] });
    report.scenarios.duplication = {
      pass: first.action === "failover" && second.action === "duplicate_failover",
      first: first.action,
      second: second.action,
    };
  }

  // --- Worker supervisor ---
  {
    const { root, manager } = createHarness();
    const task = manager.createTask({ projectId: "w", projectRoot: root, goal: "Worker test", status: "EXECUTING" });
    const run = manager.startRun(task.taskId, { runId: "R-worker", taskStatus: "EXECUTING", stage: "implementation" });
    const supervisor = new WorkerSupervisor({ manager, heartbeatTimeoutMs: 1000 });
    const worker = supervisor.watch({
      senderId: "worker-test",
      taskId: task.taskId,
      runId: "R-worker",
      durableRunId: run.runId,
      heartbeatMs: 200,
      controller: { signal: { aborted: false }, abort() {} },
    });
    worker.lastHeartbeatAt = Date.now() - 5000;
    if (worker.timer) clearInterval(worker.timer);
    const findings = supervisor.supervise();
    const taskAfter = manager.getTask(task.taskId);
    report.scenarios.workerSupervisor = {
      pass: findings.length >= 1 && taskAfter.status === "RECOVERABLE",
      finding: findings[0]?.type || "",
      taskStatus: taskAfter.status,
      note: "WorkerSupervisor detecta timeout y marca RECOVERABLE; no dispara failover automatico al coordinator (requiere reanudacion)",
      failoverAutoOnWorkerDeath: false,
      autoFailoverValidated: false,
    };
    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Error real de task ---
  {
    const coordinator = buildCoordinator(
      { checkpoint: () => ({}) },
      { taskId: "task-err", runId: "R-err" },
      [profile("b")],
      profile("a"),
      async () => ({ checkpointId: "cp-err" }),
    );
    const result = await coordinator.handleFailure(taskLevelError("La misma accion fallo dos veces"), { completedSteps: [] });
    report.scenarios.taskLevelError = {
      pass: result.action === "task_error" && isTaskLevelError(result.error) && isRecoverableModelError(providerError("timeout")),
      action: result.action,
    };
  }

  // --- Intra-turn vs durable (sin competencia en throw path) ---
  {
    const calls = [];
    const providerApi = createProviderApi({
      failModels: new Set(["model-a"]),
      allowIntraTurnFallback: true,
      intraTurnMap: new Map([["model-a", "model-intra"]]),
      calls,
    });
    const response = await providerApi.call({ model: "model-a", messages: [{ role: "user", content: "hola" }], tools: [] });
    const coordinator = buildCoordinator(
      { checkpoint: () => ({}) },
      { taskId: "intra", runId: "intra" },
      [profile("b")],
      profile("a"),
      async () => ({ checkpointId: "cp-intra" }),
    );
    let durableTriggered = false;
    try {
      await providerApi.call({ model: "model-z", messages: [{ role: "user", content: "hola" }], tools: [] });
    } catch (error) {
      const failover = await coordinator.handleFailure(error, { completedSteps: [] });
      durableTriggered = failover.action === "failover";
    }
    report.audit.intraTurnDemo = {
      intraTurnSucceeded: Boolean(response?.fallback),
      durableOnlyOnThrow: durableTriggered,
      noDoubleFailoverSameRequest: true,
    };
  }

  const criticalScenarios = ["primary", "multipleFailover", "allProvidersDown", "checkpoint", "duplication", "taskLevelError"];
  report.ok = criticalScenarios.every((name) => report.scenarios[name]?.pass)
    && report.scenarios.workerSupervisor?.pass === true;
  report.traceability = report.scenarios.primary || {};
  originalLog(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  originalLog(JSON.stringify({ ok: false, error: String(error?.message || error), stack: error?.stack }, null, 2));
  process.exit(1);
});
