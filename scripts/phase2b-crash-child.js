"use strict";

const path = require("node:path");
const { ReversibleContextStore } = require("../runtime/context-store");
const { TaskManager } = require("../runtime/task-manager");
const { TaskStore } = require("../runtime/task-store");

const root = path.resolve(process.env.EDITCORE_PHASE2B_CRASH_ROOT || "");
if (!root) process.exit(2);
const store = new TaskStore({ root: path.join(root, "task-store") });
const manager = new TaskManager({ store, contextStore: new ReversibleContextStore({ root: path.join(root, "context") }) });
const task = manager.createTask({ taskId: "task-crash-acceptance", projectId: "acceptance", projectRoot: root, goal: "Sobrevivir terminacion forzada" });
manager.transition(task.taskId, "PLANNING");
manager.transition(task.taskId, "READY");
const run = manager.startRun(task.taskId, { runId: "run-crash-acceptance", stage: "discovery" });
const step = manager.startStep(task.taskId, run.runId, { stepId: "step-crash-acceptance", stage: "discovery", goal: "Persistir antes del kill", actionId: "action-crash-acceptance" });
manager.startAttempt(task.taskId, run.runId, step.stepId, { actionId: "action-crash-acceptance" });
manager.recordFileMutation(task.taskId, { actionId: "action-crash-acceptance", filePath: "proof.txt", previousHash: "0".repeat(64), newHash: "1".repeat(64), operation: "write" });
manager.checkpoint(task.taskId, {
  currentStage: "discovery", currentStep: step,
  nextAction: { type: "TOOL", description: "Continuar despues del crash", requiredTools: ["read_file"] },
  relevantFiles: ["proof.txt"], contextManifestReference: "a".repeat(64), lastToolResultReference: "b".repeat(64), tokenLedgerReference: "c".repeat(64),
});
process.stdout.write("READY\n");
setInterval(() => undefined, 1000);
