"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { ReversibleContextStore } = require("../runtime/context-store");
const { TaskManager } = require("../runtime/task-manager");
const { TaskRecovery } = require("../runtime/task-recovery");
const { TaskStore, digest } = require("../runtime/task-store");

process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";
const reportPath = path.resolve(process.env.EDITCORE_PHASE2B_ELECTRON_REPORT || path.join(process.cwd(), "phase2b-results", "electron-reopen.json"));
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
  throw new Error("Electron no quedo listo para verificar la reapertura.");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), ok: false };
  try {
    await readyWindow();
    const userData = app.getPath("userData");
    const taskId = process.env.EDITCORE_PHASE2B_TASK_ID || "task-electron-acceptance";
    const taskRoot = path.join(userData, "task-store");
    const contextStore = new ReversibleContextStore({ root: path.join(taskRoot, "references") });
    const store = new TaskStore({ root: taskRoot });
    const manager = new TaskManager({ store, contextStore });
    const recovery = new TaskRecovery({ manager });
    const task = manager.getTask(taskId);
    const description = recovery.describe(taskId);
    const reconstructed = recovery.reconstructContext(taskId);
    const checkpoint = manager.getCheckpoint(taskId);
    const seedRun = store.listRuns(taskId)[0];
    const seedStep = store.listSteps(taskId)[0];
    const seedAttempt = store.listAttempts(taskId)[0];
    const mutation = store.getFileMutation(taskId, seedStep.actionId);
    const ledgerPath = checkpoint.tokenLedgerReference;
    const ledgerRows = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
    const target = path.join(task.projectRoot, "proof.txt");
    const duplicate = manager.recordFileMutation(taskId, mutation).duplicate;

    const before = {
      state: task.status, taskId: task.taskId, runId: seedRun?.runId || "", runState: seedRun?.status || "",
      stepId: seedStep?.stepId || "", stepState: seedStep?.status || "", attemptId: seedAttempt?.attemptId || "", attemptState: seedAttempt?.status || "",
      checkpointId: checkpoint?.checkpointId || "", nextAction: checkpoint?.nextAction || null,
      contextManifestReference: checkpoint?.contextManifestReference || "", planReference: task.planReference,
      engineeringStateReference: task.engineeringStateReference, projectRoot: task.projectRoot,
      tokenLedgerReference: ledgerPath, tokenRows: ledgerRows.length, tokenUsageSummary: task.tokenUsageSummary,
      eventCount: manager.getEvents(taskId).length, mutation, duplicatePrevented: duplicate,
      fileHash: fs.existsSync(target) ? digest(fs.readFileSync(target, "utf8")) : "",
      contextSource: reconstructed.contextSource, fullConversationLoaded: reconstructed.fullConversationLoaded,
      planRecovered: Boolean(reconstructed.plan), engineeringStateRecovered: Boolean(reconstructed.engineeringState),
    };

    const prepared = manager.prepareRecovery(taskId);
    const verifyRun = manager.startRun(taskId, { runId: `run-${taskId}-verify`, stage: "verification", taskStatus: "VERIFYING" });
    const verifyStep = manager.startStep(taskId, verifyRun.runId, { stepId: `step-${taskId}-verify`, stage: "verification", goal: "Verificar mutacion recuperada", actionId: `action-${taskId}-verify` });
    manager.startAttempt(taskId, verifyRun.runId, verifyStep.stepId, { attemptId: `attempt-${taskId}-verify`, actionId: verifyStep.actionId });
    const verified = fs.readFileSync(target, "utf8") === "after" && digest(fs.readFileSync(target, "utf8")) === mutation.newHash;
    manager.completeStep(taskId, verifyStep.stepId, { ok: verified, result: { verified, filePath: "proof.txt", hash: mutation.newHash } });
    manager.recordRuntimeEvent(taskId, verified ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED", { runId: verifyRun.runId, stepId: verifyStep.stepId });
    manager.checkpoint(taskId, {
      currentStage: "verification", currentStep: verifyStep, completedSteps: [...checkpoint.completedSteps, verifyStep.stepId],
      relevantFiles: checkpoint.relevantFiles, relevantSymbols: checkpoint.relevantSymbols,
      contextManifestReference: checkpoint.contextManifestReference, tokenLedgerReference: checkpoint.tokenLedgerReference,
      verificationStatus: verified ? "passed" : "failed", nextAction: { type: "NONE", description: "Recovery verificado.", status: "COMPLETED" },
    });
    manager.updateRun(taskId, verifyRun.runId, { status: "COMPLETED", nextAction: { type: "NONE", status: "COMPLETED" } });
    const completed = manager.markTaskCompleted(taskId, { verificationStatus: "completed", nextAction: { type: "NONE", description: "Tarea completada.", status: "COMPLETED" } });
    const consistency = manager.validateConsistency(taskId);
    const events = manager.getEvents(taskId);
    report.before = before;
    report.recovery = {
      safeToResume: prepared.task.status === "RECOVERING", durableSteps: prepared.steps.length,
      verified, finalState: completed.status, consistency: consistency.ok, issues: consistency.issues,
      finalCheckpointId: manager.getCheckpoint(taskId)?.checkpointId || "",
      eventTypes: events.map((event) => event.type), mutationCount: store.listEntityDir(taskId, "mutations").length,
    };
    report.ok = Boolean(
      before.state === "RECOVERABLE" && before.runState === "RECOVERABLE"
      && before.stepState === "COMPLETED" && before.attemptState === "COMPLETED"
      && before.checkpointId && before.nextAction?.type === "VERIFY"
      && before.contextManifestReference && before.planReference && before.engineeringStateReference
      && before.projectRoot && before.tokenRows === 1 && before.tokenUsageSummary?.totalTokens === 18
      && before.mutation?.previousHash && before.mutation?.newHash && before.duplicatePrevented
      && before.fileHash === before.mutation.newHash && before.contextSource === "DURABLE_MANIFEST"
      && before.fullConversationLoaded === false && before.planRecovered && before.engineeringStateRecovered
      && report.recovery.verified && report.recovery.finalState === "COMPLETED" && report.recovery.consistency
      && report.recovery.mutationCount === 1
    );
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    app.exit(report.ok ? 0 : 2);
  }
});
