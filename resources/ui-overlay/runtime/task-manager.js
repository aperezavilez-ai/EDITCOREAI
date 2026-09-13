"use strict";

const crypto = require("node:crypto");
const {
  ACTIVE_TASK_STATES, RUN_STATES, TASK_STATES, TERMINAL_TASK_STATES,
  canTransition, nextAction, now, tokenSummary,
} = require("./task-models");

function errorReason(error) {
  return String(error?.message || error || "Error desconocido").slice(0, 1000);
}

function recoveryStatus(error) {
  const value = errorReason(error);
  if (/timeout|timed out|agoto|presupuesto/i.test(value)) return "TIMEOUT";
  return "FAILED";
}

class TaskManager {
  constructor({ store, contextStore = null } = {}) {
    if (!store) throw new Error("TaskManager requiere TaskStore.");
    this.store = store;
    this.contextStore = contextStore;
  }

  reference(value, metadata = {}) {
    if (value === undefined || value === null || value === "" || !this.contextStore) return "";
    return this.contextStore.store(value, metadata).id;
  }

  createTask(input = {}) {
    const requestRef = input.originalRequestReference || this.reference(input.originalRequest || input.goal, { kind: "task-request", projectId: input.projectId });
    const task = this.store.createTask({ ...input, originalRequestReference: requestRef });
    this.store.appendTaskEvent(task.taskId, { type: "TASK_CREATED", previousState: "", newState: task.status });
    return this.store.getTask(task.taskId);
  }

  getTask(taskId) { return this.store.getTask(taskId); }
  listTasks(filter = {}) { return this.store.listTasks(filter); }
  getEvents(taskId, options = {}) { return this.store.getEvents(taskId, options); }
  getCheckpoint(taskId) { return this.store.getLatestCheckpoint(taskId); }
  getNextAction(taskId) { return this.store.getNextAction(taskId); }
  listRecoverableTasks() { return this.store.listTasks({ statuses: ["RECOVERABLE", "RECOVERING"] }); }

  transition(taskId, status, patch = {}, eventType = "TASK_UPDATED") {
    if (!TASK_STATES.includes(status)) throw new Error(`Estado de tarea invalido: ${status}`);
    const current = this.store.getTask(taskId);
    if (!current) throw new Error(`Tarea no encontrada: ${taskId}`);
    if (!canTransition(current.status, status)) throw new Error(`Transicion invalida: ${current.status} -> ${status}`);
    const updated = this.store.updateTask(taskId, { ...patch, status });
    this.store.appendTaskEvent(taskId, { type: eventType, previousState: current.status, newState: status, stage: updated.currentStage, runId: updated.activeRunId });
    return this.store.getTask(taskId);
  }

  updateTask(taskId, patch = {}) {
    const current = this.store.getTask(taskId);
    if (!current) throw new Error(`Tarea no encontrada: ${taskId}`);
    if (patch.status && patch.status !== current.status) return this.transition(taskId, patch.status, patch);
    const updated = this.store.updateTask(taskId, patch);
    this.store.appendTaskEvent(taskId, { type: "TASK_UPDATED", previousState: current.status, newState: updated.status });
    return this.store.getTask(taskId);
  }

  pauseTask(taskId) {
    const task = this.store.getTask(taskId);
    if (task?.activeRunId) this.updateRun(taskId, task.activeRunId, { status: "PAUSED" });
    return this.transition(taskId, "PAUSED", { resumeRequired: true, recoveryReason: "Pausada por el usuario." }, "TASK_PAUSED");
  }

  resumeTask(taskId) {
    const task = this.store.getTask(taskId);
    if (task?.activeRunId) {
      const run = this.store.getRun(taskId, task.activeRunId);
      if (run?.status === "PAUSED") this.updateRun(taskId, run.runId, { status: "INTERRUPTED", recoveryReason: "RUN pausado cerrado para continuar en un RUN nuevo." });
    }
    if (TERMINAL_TASK_STATES.includes(task?.status)) {
      return this.reopenTerminalTask(taskId, {
        reason: "Reanudada por el usuario tras estado terminal.",
      });
    }
    const destination = task?.status === "RECOVERABLE" ? "RECOVERING" : "READY";
    return this.transition(taskId, destination, { resumeRequired: true, recoveryReason: "" }, "TASK_RESUMED");
  }

  /**
   * Reabre COMPLETED/FAILED/CANCELLED para que procede/continua puedan iniciar un RUN.
   * Sin esto el chat muestra "La tarea terminal COMPLETED no puede iniciar un RUN".
   */
  reopenTerminalTask(taskId, { reason = "Reabierta por instruccion del usuario (procede/continua).", destination = "RECOVERING" } = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    if (!TERMINAL_TASK_STATES.includes(task.status)) return task;
    if (task.activeRunId) {
      const active = this.store.getRun(taskId, task.activeRunId);
      if (active && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(active.status)) {
        this.updateRun(taskId, active.runId, {
          status: "INTERRUPTED",
          recoveryReason: "Cerrado al reabrir tarea terminal.",
        });
      }
    }
    const target = destination === "RECOVERABLE" || canTransition(task.status, destination)
      ? (canTransition(task.status, destination) ? destination : "RECOVERING")
      : "RECOVERING";
    return this.transition(taskId, target, {
      activeRunId: "",
      resumeRequired: true,
      recoveryReason: String(reason || "").slice(0, 1000),
      nextAction: nextAction({
        type: "RESUME",
        description: "Continuar trabajo pendiente tras reapertura de tarea terminal.",
        status: "PENDING",
      }),
    }, "TASK_RESUMED");
  }

  cancelTask(taskId) {
    const task = this.store.getTask(taskId);
    if (task?.activeRunId) this.updateRun(taskId, task.activeRunId, { status: "INTERRUPTED", recoveryReason: "Cancelada por el usuario." });
    return this.transition(taskId, "CANCELLED", { activeRunId: "", resumeRequired: false, recoveryReason: "Cancelada por el usuario." }, "TASK_CANCELLED");
  }

  markTaskCompleted(taskId, patch = {}) {
    let task = this.store.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    if (task.status === "COMPLETED") return task;
    // Cierra RUNs colgados para que la consistencia no bloquee el cierre.
    if (task.activeRunId) {
      const active = this.store.getRun(taskId, task.activeRunId);
      if (active && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(active.status)) {
        this.updateRun(taskId, active.runId, { status: "COMPLETED" });
      }
    }
    for (const stale of this.store.listRuns(taskId).filter((run) => ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status))) {
      this.updateRun(taskId, stale.runId, { status: "COMPLETED" });
    }
    task = this.store.getTask(taskId);
    // Completar en directo desde RECOVERABLE/RECOVERING (sin hop intermedio que rompa la maquina de estados).
    if (!canTransition(task.status, "COMPLETED")) {
      throw Object.assign(new Error(`Transicion invalida: ${task.status} -> COMPLETED`), { code: "TASK_TRANSITION_INVALID", task });
    }
    const consistency = this.validateConsistency(taskId);
    if (!consistency.ok) throw Object.assign(new Error(`La tarea no puede completarse: ${consistency.issues.join("; ")}`), { code: "TASK_INCONSISTENT", consistency });
    return this.transition(taskId, "COMPLETED", { ...patch, activeRunId: "", resumeRequired: false, recoveryReason: "" }, "TASK_COMPLETED");
  }

  markTaskFailed(taskId, error, { recoverable = false, runId = "", stage = "" } = {}) {
    const task = this.store.getTask(taskId);
    if (!task || TERMINAL_TASK_STATES.includes(task.status)) return task;
    const errorRef = this.reference({ message: errorReason(error), code: error?.code || "" }, { kind: "task-error", taskId, runId });
    const status = recoverable ? "RECOVERABLE" : "FAILED";
    const runStatus = recoverable ? (recoveryStatus(error) === "TIMEOUT" ? "TIMEOUT" : "RECOVERABLE") : "FAILED";
    if (runId || task?.activeRunId) this.updateRun(taskId, runId || task.activeRunId, { status: runStatus, errorReference: errorRef, recoveryReason: errorReason(error) });
    return this.transition(taskId, status, {
      failureCount: Number(task?.failureCount || 0) + 1, activeRunId: "", resumeRequired: recoverable,
      recoveryReason: errorReason(error), currentStage: stage || task?.currentStage, nextAction: nextAction({ type: "RESUME", description: "Reanudar desde el ultimo checkpoint sin repetir acciones completadas.", status: "PENDING" }),
    }, recoverable ? "TASK_RECOVERABLE" : "TASK_FAILED");
  }

  retryTask(taskId) {
    const task = this.store.getTask(taskId);
    if (!task || !["RECOVERABLE", "PAUSED"].includes(task.status)) throw new Error("La tarea no admite reintento en su estado actual.");
    const updated = this.transition(taskId, task.status === "RECOVERABLE" ? "RECOVERING" : "READY", {
      retryCount: Number(task.retryCount || 0) + 1, resumeRequired: true,
      nextAction: { ...task.nextAction, status: "PENDING" },
    }, "RETRY_REQUESTED");
    return updated;
  }

  startRun(taskId, input = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    let requestedStatus = input.taskStatus || "DISCOVERY";
    if (requestedStatus === "EXECUTING" && !canTransition(task.status, "EXECUTING")) {
      if (canTransition(task.status, "IMPLEMENTING")) requestedStatus = "IMPLEMENTING";
      else if (canTransition(task.status, "DISCOVERY")) requestedStatus = "DISCOVERY";
    }
    if (["AWAITING_AUTHORIZATION", "PLAN_READY"].includes(task.status) && ["EXECUTING", "IMPLEMENTING", "DISCOVERY", "APPROVED"].includes(requestedStatus)) {
      this.transition(taskId, "APPROVED", { currentStage: "approved" }, "APPROVAL_RECORDED");
      task = this.store.getTask(taskId);
    }
    if (TERMINAL_TASK_STATES.includes(task.status)) {
      // Por defecto reabrir: procede/continua del usuario nunca debe morir aqui.
      // Solo rechazar si el caller pide explicitamente reopenIfTerminal=false.
      if (input.reopenIfTerminal === false) {
        this.store.appendTaskEvent(taskId, {
          type: "RUN_START_REJECTED", previousState: task.status, newState: task.status,
          metadata: { reason: "terminal_task", requestedStatus },
        });
        throw Object.assign(new Error(`La tarea terminal ${task.status} no puede iniciar un RUN.`), { code: "TASK_TERMINAL", task });
      }
      this.reopenTerminalTask(taskId, {
        reason: `RUN solicitado sobre tarea ${task.status}; reabriendo automaticamente.`,
      });
      task = this.store.getTask(taskId);
    }
    if (task.status === "RECOVERABLE" && requestedStatus === "EXECUTING") {
      this.transition(taskId, "RECOVERING", { currentStage: "recovery" }, "EXECUTION_RECOVERY");
      task = this.store.getTask(taskId);
      if (task?.status === "RECOVERING") {
        this.transition(taskId, "EXECUTING", { currentStage: "implementation" }, "EXECUTION_STARTED");
        task = this.store.getTask(taskId);
      }
    }
    if (!canTransition(task.status, requestedStatus)) {
      this.store.appendTaskEvent(taskId, {
        type: "RUN_START_REJECTED", previousState: task.status, newState: task.status,
        metadata: { reason: "invalid_transition", requestedStatus },
      });
      throw Object.assign(new Error(`Transicion invalida: ${task.status} -> ${requestedStatus}`), { code: "TASK_TRANSITION_INVALID", task });
    }
    if (task.activeRunId) {
      const active = this.store.getRun(taskId, task.activeRunId);
      if (active && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(active.status)) {
        // Cierra el RUN previo en vez de tumbar el pedido del usuario.
        this.updateRun(taskId, active.runId, {
          status: "INTERRUPTED",
          recoveryReason: "Reemplazado por un RUN nuevo solicitado por el usuario.",
        });
      }
    }
    const activeRuns = this.store.listRuns(taskId).filter((run) => ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status));
    for (const stale of activeRuns) {
      this.updateRun(taskId, stale.runId, {
        status: "INTERRUPTED",
        recoveryReason: "RUN stale cerrado al iniciar uno nuevo.",
      });
    }
    this.store.acquireLock("runs", taskId, { taskId });
    try {
      const runs = this.store.listRuns(taskId);
      const run = this.store.saveRun(taskId, {
        ...input, runId: input.runId || `run_${crypto.randomUUID()}`, sequence: runs.length + 1,
        status: "RUNNING", startedAt: now(), nextAction: input.nextAction || task.nextAction,
      });
      this.transition(taskId, requestedStatus, {
        activeRunId: run.runId, currentStage: input.stage || "discovery", resumeRequired: false,
      }, "STAGE_STARTED");
      return run;
    } catch (error) {
      this.store.releaseLock("runs", taskId);
      throw error;
    }
  }

  updateRun(taskId, runId, patch = {}) {
    const current = this.store.getRun(taskId, runId);
    if (!current) throw new Error(`RUN no encontrado: ${runId}`);
    if (patch.status && !RUN_STATES.includes(patch.status)) throw new Error(`Estado de RUN invalido: ${patch.status}`);
    const run = this.store.saveRun(taskId, { ...current, ...patch, runId, updatedAt: now(), completedAt: patch.status === "COMPLETED" ? now() : current.completedAt });
    if (["INTERRUPTED", "TIMEOUT", "FAILED", "RECOVERABLE", "COMPLETED"].includes(run.status)) {
      const task = this.store.getTask(taskId);
      if (task?.activeRunId === runId) this.store.updateTask(taskId, { activeRunId: "" });
      this.store.releaseLock("runs", taskId);
    }
    return run;
  }

  startStep(taskId, runId, input = {}) {
    const run = this.store.getRun(taskId, runId);
    if (!run || run.status !== "RUNNING") throw new Error(`RUN no disponible para STEP: ${runId}`);
    const steps = this.store.listSteps(taskId);
    const step = this.store.saveStep(taskId, { ...input, runId, sequence: input.sequence || steps.length + 1, status: "RUNNING", startedAt: now() });
    this.store.saveRun(taskId, { ...run, currentStepId: step.stepId, nextAction: step.nextAction });
    this.store.updateTask(taskId, { currentStepId: step.stepId, currentStage: step.stage, nextAction: step.nextAction });
    this.store.appendTaskEvent(taskId, { type: "STEP_STARTED", runId, stepId: step.stepId, stage: step.stage, actionId: step.actionId });
    return step;
  }

  startAttempt(taskId, runId, stepId, input = {}) {
    const step = this.store.getStep(taskId, stepId);
    if (!step) throw new Error(`STEP no encontrado: ${stepId}`);
    const actionId = String(input.actionId || step.actionId || `action_${crypto.randomUUID()}`);
    const existingAction = this.store.recordAction(taskId, { actionId, stepId, runId, status: "STARTED", sequence: Number(step.attemptCount || 0) + 1 });
    if (existingAction.duplicate) return { duplicate: true, action: existingAction.action, attempt: null };
    const attempt = this.store.saveAttempt(taskId, { ...input, actionId, runId, stepId, sequence: Number(step.attemptCount || 0) + 1, status: "STARTED" });
    this.store.saveStep(taskId, { ...step, actionId, attemptCount: Number(step.attemptCount || 0) + 1 });
    return { duplicate: false, action: existingAction.action, attempt };
  }

  completeStep(taskId, stepId, input = {}) {
    const step = this.store.getStep(taskId, stepId);
    if (!step) throw new Error(`STEP no encontrado: ${stepId}`);
    const resultRef = input.resultReference || this.reference(input.result, { kind: "tool-result", taskId, runId: step.runId, stepId });
    const updated = this.store.saveStep(taskId, { ...step, status: input.ok === false ? "FAILED" : "COMPLETED", completedAt: now(), resultReference: resultRef, errorReference: input.errorReference || "" });
    const attempts = this.store.listAttempts(taskId).filter((attempt) => attempt.stepId === stepId && attempt.status === "STARTED");
    for (const attempt of attempts) {
      this.store.saveAttempt(taskId, { ...attempt, status: input.ok === false ? "FAILED" : "COMPLETED", completedAt: now(), resultReference: resultRef, errorReference: input.errorReference || "" });
    }
    if (step.actionId) this.store.recordAction(taskId, { actionId: step.actionId, stepId, runId: step.runId, status: input.ok === false ? "FAILED" : "COMPLETED", resultReference: resultRef });
    this.store.appendTaskEvent(taskId, { type: input.ok === false ? "TOOL_FAILED" : "TOOL_COMPLETED", runId: step.runId, stepId, stage: step.stage, payloadReference: resultRef, actionId: step.actionId, attemptId: attempts.at(-1)?.attemptId || "" });
    return updated;
  }

  validateConsistency(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, issues: ["TASK inexistente"] };
    const runs = this.store.listRuns(taskId);
    const steps = this.store.listSteps(taskId);
    const attempts = this.store.listAttempts(taskId);
    const issues = [];
    const activeRuns = runs.filter((run) => ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status));
    if (activeRuns.length > 1) issues.push("mas de un RUN activo");
    if (task.activeRunId && !activeRuns.some((run) => run.runId === task.activeRunId)) issues.push("activeRunId no corresponde a RUN activo");
    if (!task.activeRunId && activeRuns.length) issues.push("RUN activo sin activeRunId en TASK");
    if (task.currentStepId && !steps.some((step) => step.stepId === task.currentStepId)) issues.push("currentStepId inexistente");
    for (const step of steps) {
      if (!runs.some((run) => run.runId === step.runId)) issues.push(`STEP ${step.stepId} sin RUN`);
    }
    for (const attempt of attempts) {
      const step = steps.find((item) => item.stepId === attempt.stepId);
      if (!step || step.runId !== attempt.runId) issues.push(`ATTEMPT ${attempt.attemptId} sin STEP/RUN consistente`);
      if (["COMPLETED", "FAILED"].includes(step?.status) && attempt.status === "STARTED") issues.push(`ATTEMPT ${attempt.attemptId} abierto despues de STEP terminal`);
    }
    if (task.status === "COMPLETED" && runs.some((run) => run.status !== "COMPLETED" && run.runId === task.activeRunId)) issues.push("TASK completada con RUN activo");
    return { ok: issues.length === 0, issues, task, runs, steps, attempts };
  }

  recordModelEvent(taskId, type, input = {}) {
    if (!["MODEL_REQUEST_STARTED", "MODEL_REQUEST_COMPLETED", "MODEL_REQUEST_FAILED"].includes(type)) throw new Error("Evento de modelo invalido.");
    return this.store.appendTaskEvent(taskId, { ...input, type });
  }

  recordRuntimeEvent(taskId, type, input = {}) {
    const allowed = [
      "WORKER_STARTED", "WORKER_HEARTBEAT", "WORKER_STOP_REQUESTED", "WORKER_COMPLETED",
      "WORKER_FAILED", "WORKER_STOPPED", "WORKER_TIMEOUT", "WORKER_STALLED", "WORKER_FAILURE",
      "RECOVERY_VALIDATED", "RECOVERY_SKIPPED_DUPLICATE", "RECOVERY_STARTED",
      "RECOVERY_REUSED_RESULT", "RECOVERY_RESULT_MISSING",
      "GOVERNOR_DECISION", "CONTEXT_EXPANDED", "CONTEXT_REDUCED", "STRATEGY_CHANGED",
      "RETRY_ADAPTIVE", "BUDGET_WARNING", "HUMAN_INTERVENTION", "SEGMENT_YIELD", "VERIFICATION_DECISION", "RUN_START_REJECTED",
      "STATE_RECONCILED", "PLAN_CREATED", "PLAN_UPDATED", "PLAN_PERSISTED", "DISCOVERY_COMPLETED",
      "ANALYSIS_STARTED", "ANALYSIS_AWAITING_AUTHORIZATION", "APPROVAL_RECORDED", "EXECUTION_STARTED",
      "MODEL_EXECUTION_STARTED", "MODEL_EXECUTION_FAILED", "CHECKPOINT_PERSISTED", "FAILOVER_STARTED",
      "MODEL_SELECTED", "MODEL_SKIPPED_INCOMPATIBLE", "MODEL_RETRY", "PROVIDER_UNAVAILABLE",
      "WAITING_FOR_PROVIDER", "MODEL_EXECUTION_RESUMED", "FAILOVER_COMPLETED",
      "CODEBASE_MAPPED", "SYMBOLS_SELECTED", "ACTION_REJECTED", "TOOL_RESULT_NORMALIZED",
      "VERIFICATION_SELECTED", "VERIFICATION_PASSED", "VERIFICATION_FAILED",
      "HOST_EXPLORATION_BLOCKED", "HOST_SEMANTIC_REPEAT_BLOCKED",
      "DIAGNOSIS_COMPLETED", "REPAIR_SELECTED", "COMPLETION_VALIDATED",
    ];
    const raw = String(type || "").trim();
    let normalized = raw;
    if (!allowed.includes(normalized)) {
      const compact = raw.replace(/_/g, "").toUpperCase();
      normalized = allowed.find((item) => item.replace(/_/g, "").toUpperCase() === compact) || "";
    }
    // Alias legacy sin guiones bajos (p. ej. RECOVERYRESULTMISSING → RECOVERY_RESULT_MISSING).
    if (!normalized) {
      // No tumbar la tarea por un evento desconocido: registrar como gobernanza.
      return this.store.appendTaskEvent(taskId, {
        ...input,
        type: "GOVERNOR_DECISION",
        metadata: { ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}), invalidRuntimeEvent: raw },
      });
    }
    return this.store.appendTaskEvent(taskId, { ...input, type: normalized });
  }

  recordFileMutation(taskId, input = {}) { return this.store.recordFileMutation(taskId, input); }

  checkpoint(taskId, input = {}) {
    const task = this.store.getTask(taskId);
    const previous = task.status;
    if (canTransition(previous, "CHECKPOINTING")) this.transition(taskId, "CHECKPOINTING");
    const checkpoint = this.store.createCheckpoint(taskId, input);
    this.store.appendTaskEvent(taskId, { type: "CHECKPOINT_CREATED", previousState: previous, newState: previous, stage: checkpoint.currentStage, stepId: checkpoint.currentStep?.stepId || "", payloadReference: checkpoint.checkpointId });
    if (previous !== "CHECKPOINTING") this.transition(taskId, previous);
    return checkpoint;
  }

  updateTokenUsage(taskId, runId, usage = {}) {
    const currentTask = this.store.getTask(taskId);
    const currentRun = runId ? this.store.getRun(taskId, runId) : null;
    const incoming = tokenSummary({
      inputTokens: usage.confirmed_input_tokens || usage.input_tokens || usage.estimated_input_tokens,
      outputTokens: usage.confirmed_output_tokens || usage.output_tokens || usage.estimated_output_tokens,
      totalTokens: usage.total_tokens,
      confirmedTokens: Number(usage.confirmed_input_tokens || 0) + Number(usage.confirmed_output_tokens || 0),
      estimatedTokens: Number(usage.estimated_input_tokens || 0) + Number(usage.estimated_output_tokens || 0),
      calls: usage.provider_calls || 1, retries: usage.retries || 0, segments: usage.segments || 0,
    });
    const merge = (current = {}) => tokenSummary(Object.fromEntries(Object.keys(incoming).map((key) => [key, Number(current[key] || 0) + Number(incoming[key] || 0)])));
    this.store.updateTask(taskId, { tokenUsageSummary: merge(currentTask.tokenUsageSummary) });
    if (currentRun) this.store.saveRun(taskId, { ...currentRun, tokenUsageSummary: merge(currentRun.tokenUsageSummary) });
    return this.store.getTask(taskId).tokenUsageSummary;
  }

  recoverAbandonedTasks({ reason = "La aplicacion termino antes de cerrar la ejecucion.", tasks = null } = {}) {
    const recovered = [];
    for (const task of (Array.isArray(tasks) ? tasks : this.store.listTasks())) {
      if (!ACTIVE_TASK_STATES.includes(task.status)) continue;
      const runId = task.activeRunId;
      if (runId) {
        const run = this.store.getRun(task.taskId, runId);
        if (run && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status)) this.updateRun(task.taskId, runId, { status: "RECOVERABLE", recoveryReason: reason });
      }
      const checkpoint = this.store.getLatestCheckpoint(task.taskId);
      const next = checkpoint?.nextAction || task.nextAction || nextAction({ type: "RECOVER", description: "Validar el ultimo checkpoint y continuar sin repetir mutaciones." });
      this.transition(task.taskId, "RECOVERABLE", {
        activeRunId: "", resumeRequired: true, recoveryReason: reason, nextAction: next,
      }, "TASK_RECOVERABLE");
      this.store.releaseLock("runs", task.taskId);
      recovered.push(this.store.getTask(task.taskId));
    }
    return recovered;
  }

  reconcileConsistency({ tasks = null } = {}) {
    const reconciled = [];
    for (const task of (Array.isArray(tasks) ? tasks : this.store.listTasks())) {
      const runs = this.store.listRuns(task.taskId);
      const activeRuns = runs.filter((run) => ["RUN_CREATED", "RUNNING", "PAUSED"].includes(run.status));
      if (TERMINAL_TASK_STATES.includes(task.status) && activeRuns.length) {
        for (const run of activeRuns) this.updateRun(task.taskId, run.runId, { status: "INTERRUPTED", recoveryReason: `Reconciliado: TASK ${task.status}.` });
        this.store.updateTask(task.taskId, { activeRunId: "" });
        this.store.appendTaskEvent(task.taskId, { type: "STATE_RECONCILED", previousState: task.status, newState: task.status, metadata: { reason: "terminal_task_with_active_run", runIds: activeRuns.map((run) => run.runId) } });
        reconciled.push(task.taskId);
      } else if (task.activeRunId && !activeRuns.some((run) => run.runId === task.activeRunId)) {
        const next = this.store.getLatestCheckpoint(task.taskId)?.nextAction || task.nextAction;
        this.transition(task.taskId, "RECOVERABLE", {
          activeRunId: "", resumeRequired: true, recoveryReason: "RUN durable termino antes de actualizar TASK.", nextAction: next,
        }, "STATE_RECONCILED");
        reconciled.push(task.taskId);
      }
    }
    return reconciled;
  }

  prepareRecovery(taskId) {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== "RECOVERABLE") throw new Error("La tarea no esta disponible para recuperacion.");
    const checkpoint = this.store.getLatestCheckpoint(taskId);
    const steps = this.store.listSteps(taskId);
    return {
      task: this.transition(taskId, "RECOVERING", { resumeRequired: true }, "TASK_RESUMED"),
      checkpoint, steps, nextAction: checkpoint?.nextAction || task.nextAction,
      contextManifestReference: checkpoint?.contextManifestReference || task.contextManifestReference,
    };
  }
}

module.exports = { TaskManager, errorReason, recoveryStatus };
