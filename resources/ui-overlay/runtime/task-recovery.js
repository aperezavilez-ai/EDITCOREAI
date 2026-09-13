"use strict";

const { ACTIVE_TASK_STATES } = require("./task-models");

class TaskRecovery {
  constructor({ manager } = {}) {
    if (!manager) throw new Error("TaskRecovery requiere TaskManager.");
    this.manager = manager;
  }

  recoverOnStartup() {
    const startedAt = Date.now();
    const recoveredLocks = this.manager.store.recoverOrphanedLocks();
    // Evitar listTasks() x2 sobre cientos de tareas (bloqueaba UI 6-10s).
    const summaries = typeof this.manager.store.listTaskBootSummaries === "function"
      ? this.manager.store.listTaskBootSummaries()
      : [];
    const interestingIds = summaries
      .filter((row) => row.activeRunId || ACTIVE_TASK_STATES.includes(row.status) || ["RECOVERABLE", "RECOVERING", "PAUSED", "FAILED"].includes(row.status))
      .map((row) => row.taskId);
    const interestingTasks = interestingIds
      .map((taskId) => this.manager.store.getTask(taskId))
      .filter(Boolean);
    const reconciledTasks = this.manager.reconcileConsistency({ tasks: interestingTasks });
    const tasks = this.manager.recoverAbandonedTasks({ tasks: interestingTasks });
    return {
      tasks,
      recoveredLocks,
      reconciledTasks,
      recoveryTimeMs: Date.now() - startedAt,
      scanned: summaries.length,
      touched: interestingTasks.length,
    };
  }

  describe(taskId) {
    const task = this.manager.getTask(taskId);
    if (!task) return null;
    const checkpoint = this.manager.getCheckpoint(taskId);
    const events = this.manager.getEvents(taskId, { limit: 5000 });
    return {
      taskId: task.taskId, state: task.status, currentStage: task.currentStage,
      currentStepId: task.currentStepId, nextAction: checkpoint?.nextAction || task.nextAction,
      resultReference: checkpoint?.resultReference || task.resultReference || "",
      lastCheckpoint: checkpoint, lastEvent: events.at(-1) || null,
      relevantContext: {
        contextManifestReference: checkpoint?.contextManifestReference || task.contextManifestReference,
        planReference: task.planReference || "",
        engineeringStateReference: task.engineeringStateReference || "",
        relevantFiles: checkpoint?.relevantFiles || [], relevantSymbols: checkpoint?.relevantSymbols || [],
        openIssues: checkpoint?.openIssues || [],
      },
    };
  }

  validate(taskId) {
    const description = this.describe(taskId);
    if (!description) throw new Error(`Tarea no encontrada: ${taskId}`);
    const task = this.manager.getTask(taskId);
    const run = task.activeRunId ? this.manager.store.getRun(taskId, task.activeRunId) : null;
    const step = task.currentStepId ? this.manager.store.getStep(taskId, task.currentStepId) : null;
    const action = step?.actionId ? this.manager.store.getAction(taskId, step.actionId) : null;
    const alreadyCompleted = action?.status === "COMPLETED" || step?.status === "COMPLETED";
    const result = {
      ...description, run, step, alreadyCompleted,
      safeToResume: ["RECOVERABLE", "RECOVERING", "READY", "PAUSED", "FAILED"].includes(task.status),
      recoveryOrder: ["TASK", "CHECKPOINT", "NEXT_ACTION", "EVENTS", "FILES", "SYMBOLS", "CONTEXT_MANIFEST"],
    };
    this.manager.recordRuntimeEvent(taskId, alreadyCompleted ? "RECOVERY_SKIPPED_DUPLICATE" : "RECOVERY_VALIDATED", {
      runId: run?.runId || "", stepId: step?.stepId || "", actionId: step?.actionId || "",
      metadata: { safeToResume: result.safeToResume, alreadyCompleted, checkpointId: description.lastCheckpoint?.checkpointId || "" },
    });
    return result;
  }

  reconstructContext(taskId, { maxEvents = 12, maxManifestChars = 8000 } = {}) {
    const validated = this.validate(taskId);
    const task = this.manager.getTask(taskId);
    const checkpoint = validated.lastCheckpoint;
    const reference = checkpoint?.contextManifestReference || task.contextManifestReference;
    let manifest = null;
    if (reference && this.manager.contextStore?.has(reference)) {
      manifest = this.manager.contextStore.retrieve(reference, { maxChars: maxManifestChars });
    }
    const events = this.manager.getEvents(taskId, { limit: 5000 }).slice(-Math.max(1, Math.min(50, Number(maxEvents) || 12)));
    return {
      task: { taskId: task.taskId, goal: task.goal, status: task.status, currentStage: task.currentStage, currentStepId: task.currentStepId },
      checkpoint, nextAction: checkpoint?.nextAction || task.nextAction,
      resultReference: checkpoint?.resultReference || task.resultReference || "",
      events: events.map(({ eventId, timestamp, type, stage, stepId, runId, actionId, attemptId, newState, metadata }) => ({ eventId, timestamp, type, stage, stepId, runId, actionId, attemptId, newState, metadata })),
      manifest,
      plan: task.planReference && this.manager.store.getPlan(taskId, task.planReference)
        ? this.manager.store.getPlan(taskId, task.planReference)
        : (task.planId && this.manager.store.getPlan(taskId, task.planId)
          ? this.manager.store.getPlan(taskId, task.planId)
          : (task.planReference && this.manager.contextStore?.has(task.planReference)
            ? this.manager.contextStore.retrieve(task.planReference, { maxChars: 12000 }) : null)),
      engineeringState: task.engineeringStateReference && this.manager.contextStore?.has(task.engineeringStateReference)
        ? this.manager.contextStore.retrieve(task.engineeringStateReference, { maxChars: 12000 }) : null,
      relevantFiles: checkpoint?.relevantFiles || [], relevantSymbols: checkpoint?.relevantSymbols || [],
      contextSource: manifest ? "DURABLE_MANIFEST" : checkpoint ? "CHECKPOINT" : "TASK_STATE",
      fullConversationLoaded: false,
    };
  }
}

module.exports = { TaskRecovery };
