"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  MIGRATION_VERSION, SCHEMA_VERSION, createAttemptModel, createRunModel,
  createStepModel, createTaskModel, id, nextAction, now,
} = require("./task-models");

function safeId(value, label = "id") {
  const result = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(result)) throw new Error(`${label} invalido.`);
  return result;
}

function digest(value) {
  const source = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value ?? null);
  return crypto.createHash("sha256").update(source).digest("hex");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class TaskStore {
  constructor({ root, lockTimeoutMs = 120_000 } = {}) {
    if (!root) throw new Error("TaskStore requiere una ruta persistente.");
    this.root = path.resolve(root);
    this.tasksRoot = path.join(this.root, "tasks");
    this.locksRoot = path.join(this.root, "locks");
    this.lockTimeoutMs = Math.max(5_000, Number(lockTimeoutMs) || 120_000);
    this.ownerId = `${process.pid}:${crypto.randomUUID()}`;
    fs.mkdirSync(this.tasksRoot, { recursive: true });
    fs.mkdirSync(this.locksRoot, { recursive: true });
  }

  atomicWrite(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
    return clone(value);
  }

  readJson(filePath, fallback = null) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      if (!content || !content.trim()) return fallback;
      return JSON.parse(content);
    } catch {
      return fallback;
    }
  }

  taskDir(taskId) { return path.join(this.tasksRoot, safeId(taskId, "taskId")); }
  taskPath(taskId) { return path.join(this.taskDir(taskId), "task.json"); }
  runPath(taskId, runId) { return path.join(this.taskDir(taskId), "runs", `${safeId(runId, "runId")}.json`); }
  stepPath(taskId, stepId) { return path.join(this.taskDir(taskId), "steps", `${safeId(stepId, "stepId")}.json`); }
  attemptPath(taskId, attemptId) { return path.join(this.taskDir(taskId), "attempts", `${safeId(attemptId, "attemptId")}.json`); }
  checkpointPath(taskId, checkpointId) { return path.join(this.taskDir(taskId), "checkpoints", `${safeId(checkpointId, "checkpointId")}.json`); }

  lockPath(kind, key) { return path.join(this.locksRoot, kind, `${digest(String(key).toLowerCase())}.json`); }

  acquireLock(kind, key, metadata = {}) {
    const target = this.lockPath(kind, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const lock = { kind, key: String(key), ownerId: this.ownerId, acquiredAt: Date.now(), metadata };
    try {
      fs.writeFileSync(target, `${JSON.stringify(lock)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const current = this.readJson(target, null);
    if (current?.ownerId === this.ownerId) return current;
    const currentAge = current ? Date.now() - Number(current.acquiredAt || 0) : Infinity;
    if (current && currentAge <= this.lockTimeoutMs) {
      throw Object.assign(new Error(`Recurso ocupado por otra ejecucion: ${key}`), { code: "TASK_LOCKED", lock: current });
    }
    fs.rmSync(target, { force: true });
    return this.acquireLock(kind, key, metadata);
  }

  releaseLock(kind, key) {
    const target = this.lockPath(kind, key);
    const current = this.readJson(target, null);
    if (!current || current.ownerId !== this.ownerId) return false;
    fs.rmSync(target, { force: true });
    return true;
  }

  recoverOrphanedLocks() {
    const recovered = [];
    if (!fs.existsSync(this.locksRoot)) return recovered;
    for (const kindEntry of fs.readdirSync(this.locksRoot, { withFileTypes: true })) {
      if (!kindEntry.isDirectory()) continue;
      const kindRoot = path.join(this.locksRoot, kindEntry.name);
      for (const entry of fs.readdirSync(kindRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const target = path.join(kindRoot, entry.name);
        const lock = this.readJson(target, null);
        if (!lock || lock.ownerId === this.ownerId) continue;
        fs.rmSync(target, { force: true });
        recovered.push(lock);
      }
    }
    return recovered;
  }

  withTaskLock(taskId, operation) {
    this.acquireLock("tasks", taskId);
    try { return operation(); } finally { this.releaseLock("tasks", taskId); }
  }

  migrateTask(raw) {
    if (!raw) return null;
    const migrated = createTaskModel({ ...raw, schemaVersion: SCHEMA_VERSION, migrationVersion: MIGRATION_VERSION });
    migrated.createdAt = raw.createdAt || migrated.createdAt;
    migrated.version = Math.max(1, Number(raw.version) || 1);
    return migrated;
  }

  createTask(input = {}) {
    const task = createTaskModel(input);
    return this.withTaskLock(task.taskId, () => {
      if (fs.existsSync(this.taskPath(task.taskId))) throw new Error(`La tarea ${task.taskId} ya existe.`);
      fs.mkdirSync(this.taskDir(task.taskId), { recursive: true });
      this.atomicWrite(this.taskPath(task.taskId), task);
      this.atomicWrite(path.join(this.taskDir(task.taskId), "events.json"), []);
      return task;
    });
  }

  getTask(taskId) {
    const raw = this.readJson(this.taskPath(taskId), null);
    if (!raw) return null;
    const migrated = this.migrateTask(raw);
    if (raw.schemaVersion !== migrated.schemaVersion || raw.migrationVersion !== migrated.migrationVersion) {
      this.withTaskLock(taskId, () => this.atomicWrite(this.taskPath(taskId), migrated));
    }
    return migrated;
  }

  updateTask(taskId, patch = {}) {
    return this.withTaskLock(taskId, () => {
      const current = this.getTaskUnlocked(taskId);
      if (!current) throw new Error(`Tarea no encontrada: ${taskId}`);
      const updated = this.migrateTask({ ...current, ...clone(patch), taskId: current.taskId, createdAt: current.createdAt });
      updated.updatedAt = now();
      updated.version = Number(current.version || 0) + 1;
      this.atomicWrite(this.taskPath(taskId), updated);
      return updated;
    });
  }

  getTaskUnlocked(taskId) {
    return this.migrateTask(this.readJson(this.taskPath(taskId), null));
  }

  listTasks(filter = {}) {
    const rows = fs.readdirSync(this.tasksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getTask(entry.name))
      .filter(Boolean);
    return rows.filter((task) => {
      if (filter.projectId && task.projectId !== filter.projectId) return false;
      if (filter.projectRoot && path.resolve(task.projectRoot || ".").toLowerCase() !== path.resolve(filter.projectRoot).toLowerCase()) return false;
      if (filter.status && task.status !== filter.status) return false;
      if (Array.isArray(filter.statuses) && !filter.statuses.includes(task.status)) return false;
      return true;
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  /** Lectura ligera para arranque: sin migrar/reescribir 100s de task.json. */
  listTaskBootSummaries() {
    if (!fs.existsSync(this.tasksRoot)) return [];
    const rows = [];
    for (const entry of fs.readdirSync(this.tasksRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const raw = this.readJson(this.taskPath(entry.name), null);
      if (!raw) continue;
      rows.push({
        taskId: entry.name,
        status: String(raw.status || ""),
        activeRunId: String(raw.activeRunId || ""),
      });
    }
    return rows;
  }

  appendTaskEvent(taskId, input = {}) {
    return this.withTaskLock(taskId, () => {
      const task = this.getTaskUnlocked(taskId);
      if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
      const target = path.join(this.taskDir(taskId), "events.json");
      const events = this.readJson(target, []);
      const sequence = events.length ? Number(events.at(-1).sequence) + 1 : 1;
      if (input.sequence && Number(input.sequence) !== sequence) throw new Error(`Secuencia de evento invalida; se esperaba ${sequence}.`);
      const event = {
        eventId: String(input.eventId || `event_${crypto.randomUUID()}`), taskId, timestamp: String(input.timestamp || now()),
        type: String(input.type || "TASK_UPDATED"), stage: String(input.stage || task.currentStage || ""),
        stepId: String(input.stepId || task.currentStepId || ""), runId: String(input.runId || task.activeRunId || ""),
        payloadReference: String(input.payloadReference || ""), previousState: String(input.previousState || task.status),
        newState: String(input.newState || task.status), sequence, actionId: String(input.actionId || ""),
        attemptId: String(input.attemptId || ""), metadata: clone(input.metadata || {}), schemaVersion: SCHEMA_VERSION,
      };
      events.push(event);
      this.atomicWrite(target, events);
      task.lastEventId = event.eventId;
      task.updatedAt = now();
      task.version += 1;
      this.atomicWrite(this.taskPath(taskId), task);
      return event;
    });
  }

  getEvents(taskId, { afterSequence = 0, limit = 500 } = {}) {
    const events = this.readJson(path.join(this.taskDir(taskId), "events.json"), []);
    return events.filter((event) => Number(event.sequence) > Number(afterSequence || 0)).slice(0, Math.max(1, Math.min(5000, Number(limit) || 500)));
  }

  saveRun(taskId, input = {}) {
    const run = createRunModel({ ...input, taskId });
    return this.withTaskLock(taskId, () => {
      const current = this.readJson(this.runPath(taskId, run.runId), null);
      const value = createRunModel({ ...current, ...run, taskId, createdAt: current?.createdAt || run.createdAt, updatedAt: now() });
      this.atomicWrite(this.runPath(taskId, value.runId), value);
      return value;
    });
  }

  getRun(taskId, runId) { return this.readJson(this.runPath(taskId, runId), null); }
  listRuns(taskId) { return this.listEntityDir(taskId, "runs"); }

  saveStep(taskId, input = {}) {
    const step = createStepModel({ ...input, taskId });
    return this.withTaskLock(taskId, () => {
      const current = this.readJson(this.stepPath(taskId, step.stepId), null);
      const value = createStepModel({ ...current, ...step, taskId, startedAt: current?.startedAt || step.startedAt });
      this.atomicWrite(this.stepPath(taskId, value.stepId), value);
      return value;
    });
  }

  getStep(taskId, stepId) { return this.readJson(this.stepPath(taskId, stepId), null); }
  listSteps(taskId) { return this.listEntityDir(taskId, "steps").sort((a, b) => Number(a.sequence) - Number(b.sequence)); }

  saveAttempt(taskId, input = {}) {
    const attempt = createAttemptModel({ ...input, taskId });
    return this.withTaskLock(taskId, () => {
      const current = this.readJson(this.attemptPath(taskId, attempt.attemptId), null);
      const value = createAttemptModel({ ...current, ...attempt, taskId, startedAt: current?.startedAt || attempt.startedAt });
      this.atomicWrite(this.attemptPath(taskId, value.attemptId), value);
      return value;
    });
  }

  getAttempt(taskId, attemptId) { return this.readJson(this.attemptPath(taskId, attemptId), null); }
  listAttempts(taskId) { return this.listEntityDir(taskId, "attempts").sort((a, b) => Number(a.sequence) - Number(b.sequence)); }

  createCheckpoint(taskId, input = {}) {
    return this.withTaskLock(taskId, () => {
      const task = this.getTaskUnlocked(taskId);
      if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
      const events = this.readJson(path.join(this.taskDir(taskId), "events.json"), []);
      const checkpointId = String(input.checkpointId || `checkpoint_${crypto.randomUUID()}`);
      const checkpoint = {
        taskId, checkpointId, timestamp: String(input.timestamp || now()), taskState: String(input.taskState || task.status),
        currentStage: String(input.currentStage || task.currentStage), currentStep: clone(input.currentStep || null),
        nextAction: nextAction(input.nextAction || task.nextAction), completedSteps: clone(input.completedSteps || []),
        pendingSteps: clone(input.pendingSteps || []), relevantFiles: clone(input.relevantFiles || []),
        relevantSymbols: clone(input.relevantSymbols || []), openIssues: clone(input.openIssues || []),
        verificationStatus: String(input.verificationStatus || task.verificationStatus),
        resultReference: String(input.resultReference || task.resultReference || ""),
        contextManifestReference: String(input.contextManifestReference || task.contextManifestReference || ""),
        lastToolResultReference: String(input.lastToolResultReference || ""), lastErrorReference: String(input.lastErrorReference || ""),
        retryState: clone(input.retryState || { retryCount: task.retryCount, failureCount: task.failureCount }),
        tokenLedgerReference: String(input.tokenLedgerReference || ""), eventSequence: events.length ? Number(events.at(-1).sequence) : 0,
        schemaVersion: SCHEMA_VERSION,
      };
      this.atomicWrite(this.checkpointPath(taskId, checkpointId), checkpoint);
      this.atomicWrite(path.join(this.taskDir(taskId), "latest-checkpoint.json"), { checkpointId, sequence: checkpoint.eventSequence });
      task.lastCheckpointId = checkpointId;
      task.nextAction = checkpoint.nextAction;
      task.resultReference = checkpoint.resultReference;
      task.contextManifestReference = checkpoint.contextManifestReference;
      task.updatedAt = now(); task.version += 1;
      this.atomicWrite(this.taskPath(taskId), task);
      return checkpoint;
    });
  }

  getLatestCheckpoint(taskId) {
    const pointer = this.readJson(path.join(this.taskDir(taskId), "latest-checkpoint.json"), null);
    return pointer?.checkpointId ? this.readJson(this.checkpointPath(taskId, pointer.checkpointId), null) : null;
  }

  getNextAction(taskId) { return this.getLatestCheckpoint(taskId)?.nextAction || this.getTask(taskId)?.nextAction || null; }

  getAction(taskId, actionId) {
    if (!taskId || !actionId) return null;
    return this.readJson(path.join(this.taskDir(taskId), "actions", `${safeId(actionId, "actionId")}.json`), null);
  }

  recordAction(taskId, input = {}) {
    const actionId = safeId(input.actionId, "actionId");
    return this.withTaskLock(taskId, () => {
      const target = path.join(this.taskDir(taskId), "actions", `${actionId}.json`);
      const current = this.readJson(target, null);
      if (current?.status === "COMPLETED") {
        current.duplicatePreventedCount = Number(current.duplicatePreventedCount || 0) + 1;
        current.updatedAt = now();
        this.atomicWrite(target, current);
        return { duplicate: true, action: current };
      }
      const action = { ...current, ...clone(input), taskId, actionId, updatedAt: now(), createdAt: current?.createdAt || now(), schemaVersion: SCHEMA_VERSION };
      this.atomicWrite(target, action);
      return { duplicate: false, action };
    });
  }

  recordFileMutation(taskId, input = {}) {
    const actionId = safeId(input.actionId, "actionId");
    const mutation = {
      mutationId: String(input.mutationId || `mutation_${crypto.randomUUID()}`), taskId, actionId,
      filePath: String(input.filePath || ""), previousHash: String(input.previousHash || ""), newHash: String(input.newHash || ""),
      operation: String(input.operation || "write"), timestamp: String(input.timestamp || now()), schemaVersion: SCHEMA_VERSION,
    };
    const target = path.join(this.taskDir(taskId), "mutations", `${actionId}.json`);
    return this.withTaskLock(taskId, () => {
      const current = this.readJson(target, null);
      if (current && current.newHash === mutation.newHash && current.filePath === mutation.filePath) return { duplicate: true, mutation: current };
      this.atomicWrite(target, mutation);
      return { duplicate: false, mutation };
    });
  }

  getFileMutation(taskId, actionId) {
    return this.readJson(path.join(this.taskDir(taskId), "mutations", `${safeId(actionId, "actionId")}.json`), null);
  }

  listEntityDir(taskId, name) {
    const root = path.join(this.taskDir(taskId), name);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => this.readJson(path.join(root, entry.name), null)).filter(Boolean);
  }

  planPath(taskId, planId) {
    return path.join(this.taskDir(taskId), "plans", `${safeId(planId, "planId")}.json`);
  }

  approvalPath(taskId, approvalId) {
    return path.join(this.taskDir(taskId), "approvals", `${safeId(approvalId, "approvalId")}.json`);
  }

  savePlan(taskId, input = {}) {
    return this.withTaskLock(taskId, () => {
      const task = this.getTaskUnlocked(taskId);
      if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
      const planId = String(input.planId || id("plan"));
      const current = this.readJson(this.planPath(taskId, planId), null);
      const plan = {
        ...current,
        planId,
        taskId,
        projectId: String(input.projectId || task.projectId || ""),
        version: Math.max(1, Number(input.version) || Number(current?.version) || 1),
        status: String(input.status || current?.status || "PENDING_APPROVAL"),
        content: String(input.content ?? current?.content ?? ""),
        summary: String(input.summary ?? current?.summary ?? "").slice(0, 4000),
        fixQueue: Array.isArray(input.fixQueue)
          ? input.fixQueue
          : (Array.isArray(current?.fixQueue) ? current.fixQueue : []),
        createdAt: String(current?.createdAt || input.createdAt || now()),
        updatedAt: now(),
        schemaVersion: SCHEMA_VERSION,
      };
      this.atomicWrite(this.planPath(taskId, planId), plan);
      this.atomicWrite(path.join(this.taskDir(taskId), "latest-plan.json"), { planId, updatedAt: plan.updatedAt });
      task.planId = planId;
      task.planReference = planId;
      task.updatedAt = now();
      task.version += 1;
      this.atomicWrite(this.taskPath(taskId), task);
      return plan;
    });
  }

  getPlan(taskId, planId) {
    if (!taskId || !planId) return null;
    return this.readJson(this.planPath(taskId, planId), null);
  }

  getLatestPlan(taskId) {
    const pointer = this.readJson(path.join(this.taskDir(taskId), "latest-plan.json"), null);
    return pointer?.planId ? this.getPlan(taskId, pointer.planId) : null;
  }

  saveApproval(taskId, input = {}) {
    return this.withTaskLock(taskId, () => {
      const task = this.getTaskUnlocked(taskId);
      if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
      const approvalId = String(input.approvalId || id("approval"));
      const current = this.readJson(this.approvalPath(taskId, approvalId), null);
      const approval = {
        ...current,
        approvalId,
        taskId,
        planId: String(input.planId || task.planId || ""),
        type: String(input.type || "PLAN_EXECUTION"),
        status: String(input.status || "APPROVED"),
        createdAt: String(current?.createdAt || now()),
        approvedAt: String(input.approvedAt || current?.approvedAt || now()),
        schemaVersion: SCHEMA_VERSION,
      };
      this.atomicWrite(this.approvalPath(taskId, approvalId), approval);
      this.atomicWrite(path.join(this.taskDir(taskId), "latest-approval.json"), { approvalId, planId: approval.planId, approvedAt: approval.approvedAt });
      task.approvalId = approvalId;
      task.updatedAt = now();
      task.version += 1;
      this.atomicWrite(this.taskPath(taskId), task);
      return approval;
    });
  }

  getApproval(taskId, approvalId) {
    if (!taskId || !approvalId) return null;
    return this.readJson(this.approvalPath(taskId, approvalId), null);
  }

  getLatestApproval(taskId) {
    const pointer = this.readJson(path.join(this.taskDir(taskId), "latest-approval.json"), null);
    return pointer?.approvalId ? this.getApproval(taskId, pointer.approvalId) : null;
  }

  findActivePlanApproval(taskId, planId) {
    const approvals = this.listEntityDir(taskId, "approvals");
    return approvals.find((item) => item.planId === planId && item.status === "APPROVED") || null;
  }

  metrics() {
    const tasks = this.listTasks();
    const result = { tasksCreated: tasks.length, tasksRecovered: 0, tasksCompleted: 0, tasksFailed: 0, tasksInterrupted: 0, tasksRecoverable: 0, runs: 0, steps: 0, checkpoints: 0, events: 0, duplicateActionsPrevented: 0 };
    for (const task of tasks) {
      if (task.status === "COMPLETED") result.tasksCompleted += 1;
      if (task.status === "FAILED") result.tasksFailed += 1;
      if (task.status === "RECOVERABLE") result.tasksRecoverable += 1;
      result.runs += this.listRuns(task.taskId).length;
      result.tasksRecovered += this.getEvents(task.taskId, { limit: 5000 }).some((event) => event.type === "TASK_RECOVERABLE") ? 1 : 0;
      result.tasksInterrupted += this.listRuns(task.taskId).some((run) => ["INTERRUPTED", "TIMEOUT", "RECOVERABLE"].includes(run.status)) ? 1 : 0;
      result.steps += this.listSteps(task.taskId).length;
      result.checkpoints += this.listEntityDir(task.taskId, "checkpoints").length;
      result.events += this.getEvents(task.taskId, { limit: 5000 }).length;
      result.duplicateActionsPrevented += this.listEntityDir(task.taskId, "actions").reduce((sum, action) => sum + Number(action.duplicatePreventedCount || 0), 0);
    }
    return result;
  }
}

module.exports = { TaskStore, clone, digest, safeId };
