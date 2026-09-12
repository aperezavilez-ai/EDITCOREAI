"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { ReversibleContextStore } = require("../runtime/context-store");
const { TaskManager } = require("../runtime/task-manager");
const { TaskStore, digest } = require("../runtime/task-store");

process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";
require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readyWindow() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) {
      const ready = await window.webContents.executeJavaScript(`document.body.dataset.editcoreReady === "1"`).catch(() => false);
      if (ready) return window;
    }
    await wait(50);
  }
  throw new Error("Electron no quedo listo para sembrar la tarea.");
}

app.whenReady().then(async () => {
  await readyWindow();
  const userData = app.getPath("userData");
  const taskId = process.env.EDITCORE_PHASE2B_TASK_ID || "task-electron-acceptance";
  const projectRoot = path.join(userData, "acceptance-project");
  const target = path.join(projectRoot, "proof.txt");
  const taskRoot = path.join(userData, "task-store");
  const contextStore = new ReversibleContextStore({ root: path.join(taskRoot, "references") });
  const store = new TaskStore({ root: taskRoot });
  const manager = new TaskManager({ store, contextStore });

  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(target, "before", "utf8");
  const task = manager.createTask({
    taskId, projectId: "electron", projectRoot, goal: "Recuperar y verificar una mutacion Electron completa",
    nextAction: { type: "PLAN", description: "Crear plan durable.", status: "PENDING" },
  });
  manager.transition(task.taskId, "PLANNING");
  const planReference = manager.reference({ objective: task.goal, steps: ["mutate", "verify"] }, { kind: "plan", taskId });
  manager.recordRuntimeEvent(taskId, "PLAN_CREATED", { payloadReference: planReference });
  manager.transition(task.taskId, "READY", { planReference });
  const run = manager.startRun(task.taskId, { runId: `run-${taskId}-seed`, stage: "implementation", taskStatus: "IMPLEMENTING" });
  const step = manager.startStep(taskId, run.runId, {
    stepId: `step-${taskId}-mutation`, stage: "implementation", goal: "Persistir mutacion", actionId: `action-${taskId}-write`,
  });
  const started = manager.startAttempt(taskId, run.runId, step.stepId, { attemptId: `attempt-${taskId}-write`, actionId: step.actionId });
  const previousHash = digest("before");
  fs.writeFileSync(target, "after", "utf8");
  const newHash = digest("after");
  manager.recordFileMutation(taskId, { actionId: step.actionId, filePath: "proof.txt", previousHash, newHash, operation: "write" });
  manager.completeStep(taskId, step.stepId, { result: { filePath: "proof.txt", previousHash, newHash } });

  const contextManifestReference = manager.reference({ taskId, projectRoot, relevantFiles: ["proof.txt"], nextAction: "VERIFY" }, { kind: "context-manifest", taskId });
  const engineeringStateReference = manager.reference({ planReference, currentStepId: step.stepId, previousHash, newHash }, { kind: "engineering-state", taskId });
  manager.updateTask(taskId, { planReference, engineeringStateReference, contextManifestReference });
  manager.recordRuntimeEvent(taskId, "CODEBASE_MAPPED", { runId: run.runId, metadata: { files: ["proof.txt"] } });
  manager.recordRuntimeEvent(taskId, "SYMBOLS_SELECTED", { runId: run.runId, metadata: { symbols: ["proof.txt"] } });

  const ledgerRoot = path.join(userData, "agent-token-ledger", taskId);
  const ledgerPath = path.join(ledgerRoot, "token-ledger.jsonl");
  fs.mkdirSync(ledgerRoot, { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({ taskId, runId: run.runId, stepId: step.stepId, attemptId: started.attempt.attemptId, actionId: step.actionId, stage: "implementation", provider: "acceptance", model: "local", inputTokens: 11, outputTokens: 7, totalTokens: 18 })}\n`, "utf8");
  manager.updateTokenUsage(taskId, run.runId, { confirmed_input_tokens: 11, confirmed_output_tokens: 7, total_tokens: 18, provider_calls: 1 });
  manager.checkpoint(taskId, {
    currentStage: "verification", currentStep: manager.store.getStep(taskId, step.stepId),
    nextAction: { type: "VERIFY", description: "Verificar proof.txt sin repetir la mutacion.", targetFiles: ["proof.txt"], verificationRequired: true, status: "PENDING" },
    completedSteps: [step.stepId], pendingSteps: ["verify-proof"], relevantFiles: ["proof.txt"], relevantSymbols: ["proof.txt"],
    contextManifestReference, planReference, engineeringStateReference,
    tokenLedgerReference: ledgerPath, verificationStatus: "pending",
  });
  process.stdout.write("READY\n");
  if (process.env.EDITCORE_PHASE2B_NORMAL_EXIT === "1") setTimeout(() => app.exit(0), 100);
});
