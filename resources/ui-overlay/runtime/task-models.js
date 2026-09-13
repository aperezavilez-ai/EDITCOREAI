"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const MIGRATION_VERSION = 1;

const TASK_STATES = Object.freeze([
  "CREATED", "PLANNING", "READY", "DISCOVERY", "IMPLEMENTING", "VERIFYING",
  "REPAIRING", "CHECKPOINTING", "PAUSED", "WAITING", "RECOVERING",
  "ANALYZING", "PLAN_READY", "AWAITING_AUTHORIZATION", "APPROVED", "EXECUTING", "VALIDATING",
  "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE",
]);
const ACTIVE_TASK_STATES = Object.freeze([
  "PLANNING", "DISCOVERY", "IMPLEMENTING", "VERIFYING", "REPAIRING",
  "CHECKPOINTING", "RECOVERING", "ANALYZING", "EXECUTING", "VALIDATING",
]);
const AWAITING_AUTHORIZATION_STATES = Object.freeze(["PLAN_READY", "AWAITING_AUTHORIZATION"]);
const TERMINAL_TASK_STATES = Object.freeze(["COMPLETED", "FAILED", "CANCELLED"]);
const RUN_STATES = Object.freeze([
  "RUN_CREATED", "RUNNING", "PAUSED", "INTERRUPTED", "TIMEOUT", "FAILED",
  "RECOVERABLE", "COMPLETED",
]);

const TASK_TRANSITIONS = Object.freeze({
  CREATED: ["PLANNING", "READY", "ANALYZING", "PAUSED", "CANCELLED", "FAILED"],
  PLANNING: ["READY", "PAUSED", "FAILED", "CANCELLED", "RECOVERABLE"],
  READY: ["DISCOVERY", "ANALYZING", "IMPLEMENTING", "AWAITING_AUTHORIZATION", "PAUSED", "WAITING", "CANCELLED", "FAILED", "RECOVERABLE"],
  ANALYZING: ["PLAN_READY", "AWAITING_AUTHORIZATION", "FAILED", "CANCELLED", "RECOVERABLE", "WAITING"],
  PLAN_READY: ["AWAITING_AUTHORIZATION", "APPROVED", "EXECUTING", "IMPLEMENTING", "DISCOVERY", "FAILED", "CANCELLED"],
  AWAITING_AUTHORIZATION: ["APPROVED", "EXECUTING", "IMPLEMENTING", "DISCOVERY", "ANALYZING", "CANCELLED", "FAILED"],
  APPROVED: ["EXECUTING", "FAILED", "CANCELLED"],
  EXECUTING: ["VALIDATING", "REPAIRING", "VERIFYING", "CHECKPOINTING", "PAUSED", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE"],
  VALIDATING: ["COMPLETED", "REPAIRING", "FAILED", "CANCELLED"],
  DISCOVERY: ["IMPLEMENTING", "VERIFYING", "PLAN_READY", "AWAITING_AUTHORIZATION", "CHECKPOINTING", "PAUSED", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE", "ANALYZING"],
  IMPLEMENTING: ["VERIFYING", "REPAIRING", "CHECKPOINTING", "PAUSED", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE", "VALIDATING", "EXECUTING"],
  VERIFYING: ["REPAIRING", "CHECKPOINTING", "COMPLETED", "PAUSED", "WAITING", "FAILED", "CANCELLED", "RECOVERABLE", "VALIDATING"],
  REPAIRING: ["IMPLEMENTING", "VERIFYING", "CHECKPOINTING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE", "EXECUTING"],
  CHECKPOINTING: ["READY", "DISCOVERY", "IMPLEMENTING", "VERIFYING", "REPAIRING", "EXECUTING", "PAUSED", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "RECOVERABLE"],
  PAUSED: ["READY", "RECOVERING", "CANCELLED", "FAILED", "AWAITING_AUTHORIZATION", "APPROVED", "EXECUTING"],
  WAITING: ["READY", "RECOVERING", "EXECUTING", "PAUSED", "CANCELLED", "FAILED", "RECOVERABLE", "AWAITING_AUTHORIZATION"],
  RECOVERING: ["READY", "DISCOVERY", "IMPLEMENTING", "VERIFYING", "REPAIRING", "EXECUTING", "PAUSED", "FAILED", "CANCELLED", "RECOVERABLE", "AWAITING_AUTHORIZATION", "ANALYZING", "COMPLETED", "APPROVED"],
  RECOVERABLE: ["RECOVERING", "READY", "PAUSED", "FAILED", "CANCELLED", "AWAITING_AUTHORIZATION", "ANALYZING", "DISCOVERY", "COMPLETED", "APPROVED", "EXECUTING"],
  // Terminales reabribles: el usuario puede escribir procede/continua tras un
  // cierre prematuro o incompleto; sin esto el chat queda muerto en COMPLETED.
  COMPLETED: ["RECOVERING", "RECOVERABLE"],
  FAILED: ["RECOVERING", "RECOVERABLE"],
  CANCELLED: ["RECOVERING", "RECOVERABLE"],
});

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function tokenSummary(value = {}) {
  return {
    inputTokens: finite(value.inputTokens),
    outputTokens: finite(value.outputTokens),
    totalTokens: finite(value.totalTokens),
    confirmedTokens: finite(value.confirmedTokens),
    estimatedTokens: finite(value.estimatedTokens),
    calls: finite(value.calls),
    retries: finite(value.retries),
    segments: finite(value.segments),
  };
}

function nextAction(value = {}) {
  if (typeof value === "string") value = { description: value };
  return {
    actionId: String(value.actionId || id("action")),
    type: String(value.type || "CONTINUE"),
    description: String(value.description || "Continuar desde el ultimo estado persistente."),
    requiredTools: Array.isArray(value.requiredTools) ? [...new Set(value.requiredTools.map(String))] : [],
    requiredContextLevel: Math.max(0, Number(value.requiredContextLevel) || 0),
    targetFiles: Array.isArray(value.targetFiles) ? [...new Set(value.targetFiles.map(String))] : [],
    dependsOn: Array.isArray(value.dependsOn) ? [...new Set(value.dependsOn.map(String))] : [],
    verificationRequired: value.verificationRequired === true,
    status: String(value.status || "PENDING"),
  };
}

function createTaskModel(input = {}) {
  const timestamp = now();
  return {
    taskId: String(input.taskId || id("task")),
    projectId: String(input.projectId || ""),
    projectRoot: String(input.projectRoot || ""),
    createdAt: String(input.createdAt || timestamp),
    updatedAt: String(input.updatedAt || timestamp),
    status: TASK_STATES.includes(input.status) ? input.status : "CREATED",
    priority: String(input.priority || "NORMAL"),
    goal: String(input.goal || ""),
    originalRequestReference: String(input.originalRequestReference || ""),
    currentStage: String(input.currentStage || "planning"),
    currentStepId: String(input.currentStepId || ""),
    nextAction: nextAction(input.nextAction),
    resultReference: String(input.resultReference || ""),
    contextManifestReference: String(input.contextManifestReference || ""),
    lastCheckpointId: String(input.lastCheckpointId || ""),
    lastEventId: String(input.lastEventId || ""),
    verificationStatus: String(input.verificationStatus || "pending"),
    planReference: String(input.planReference || ""),
    planId: String(input.planId || ""),
    approvalId: String(input.approvalId || ""),
    executionMode: String(input.executionMode || ""),
    engineeringStateReference: String(input.engineeringStateReference || ""),
    retryCount: finite(input.retryCount),
    failureCount: finite(input.failureCount),
    tokenUsageSummary: tokenSummary(input.tokenUsageSummary),
    activeRunId: String(input.activeRunId || ""),
    resumeRequired: input.resumeRequired === true,
    recoveryReason: String(input.recoveryReason || ""),
    version: Math.max(1, Number(input.version) || 1),
    schemaVersion: SCHEMA_VERSION,
    migrationVersion: MIGRATION_VERSION,
  };
}

function createRunModel(input = {}) {
  const timestamp = now();
  return {
    runId: String(input.runId || id("run")), taskId: String(input.taskId || ""),
    createdAt: String(input.createdAt || timestamp), updatedAt: String(input.updatedAt || timestamp),
    startedAt: String(input.startedAt || ""), completedAt: String(input.completedAt || ""),
    status: RUN_STATES.includes(input.status) ? input.status : "RUN_CREATED",
    sequence: Math.max(1, Number(input.sequence) || 1), currentStepId: String(input.currentStepId || ""),
    contextManifestReference: String(input.contextManifestReference || ""), checkpointId: String(input.checkpointId || ""),
    resultReference: String(input.resultReference || ""),
    nextAction: nextAction(input.nextAction), tokenUsageSummary: tokenSummary(input.tokenUsageSummary),
    errorReference: String(input.errorReference || ""), recoveryReason: String(input.recoveryReason || ""),
    schemaVersion: SCHEMA_VERSION, migrationVersion: MIGRATION_VERSION,
  };
}

function createStepModel(input = {}) {
  const timestamp = now();
  return {
    stepId: String(input.stepId || id("step")), taskId: String(input.taskId || ""), runId: String(input.runId || ""),
    sequence: Math.max(1, Number(input.sequence) || 1), stage: String(input.stage || "discovery"),
    goal: String(input.goal || ""), toolName: String(input.toolName || ""), status: String(input.status || "STEP_CREATED"), nextAction: nextAction(input.nextAction),
    requiredContextLevel: Math.max(0, Number(input.requiredContextLevel) || 0),
    requiredTools: Array.isArray(input.requiredTools) ? input.requiredTools.map(String) : [],
    targetFiles: Array.isArray(input.targetFiles) ? input.targetFiles.map(String) : [],
    attemptCount: finite(input.attemptCount), startedAt: String(input.startedAt || timestamp), completedAt: String(input.completedAt || ""),
    resultReference: String(input.resultReference || ""), errorReference: String(input.errorReference || ""),
    actionId: String(input.actionId || ""), schemaVersion: SCHEMA_VERSION,
  };
}

function createAttemptModel(input = {}) {
  return {
    attemptId: String(input.attemptId || id("attempt")), actionId: String(input.actionId || id("action")),
    taskId: String(input.taskId || ""), runId: String(input.runId || ""), stepId: String(input.stepId || ""),
    sequence: Math.max(1, Number(input.sequence) || 1), status: String(input.status || "STARTED"),
    startedAt: String(input.startedAt || now()), completedAt: String(input.completedAt || ""),
    resultReference: String(input.resultReference || ""), errorReference: String(input.errorReference || ""),
    schemaVersion: SCHEMA_VERSION,
  };
}

function canTransition(from, to) {
  return from === to || Boolean(TASK_TRANSITIONS[from]?.includes(to));
}

module.exports = {
  ACTIVE_TASK_STATES, AWAITING_AUTHORIZATION_STATES, MIGRATION_VERSION, RUN_STATES, SCHEMA_VERSION, TASK_STATES,
  TASK_TRANSITIONS, TERMINAL_TASK_STATES, canTransition, createAttemptModel,
  createRunModel, createStepModel, createTaskModel, id, nextAction, now, tokenSummary,
};
