"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ReversibleContextStore } = require("../runtime/context-store");
const { TaskManager } = require("../runtime/task-manager");
const { TaskRecovery } = require("../runtime/task-recovery");
const { TaskStore } = require("../runtime/task-store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-phase2b-crash-"));
const reportPath = path.resolve(process.env.EDITCORE_PHASE2B_CRASH_REPORT || path.join(process.cwd(), "phase2b-results", "crash-acceptance.json"));

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("El proceso de prueba no creo el checkpoint.")), 10_000);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("READY")) return;
      clearTimeout(timer); resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => { if (code !== null && code !== 0) reject(new Error(`Proceso hijo termino antes del kill: ${code}`)); });
  });
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), ok: false };
  const child = spawn(process.execPath, [path.join(__dirname, "phase2b-crash-child.js")], {
    env: { ...process.env, EDITCORE_PHASE2B_CRASH_ROOT: root, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  try {
    await waitForReady(child);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const store = new TaskStore({ root: path.join(root, "task-store") });
    const manager = new TaskManager({ store, contextStore: new ReversibleContextStore({ root: path.join(root, "context") }) });
    const recovery = new TaskRecovery({ manager });
    const recovered = recovery.recoverOnStartup();
    const task = manager.getTask("task-crash-acceptance");
    const run = store.getRun(task.taskId, "run-crash-acceptance");
    const step = store.getStep(task.taskId, "step-crash-acceptance");
    const checkpoint = manager.getCheckpoint(task.taskId);
    const events = manager.getEvents(task.taskId);
    const mutation = store.getFileMutation(task.taskId, "action-crash-acceptance");
    const activeRuns = store.listRuns(task.taskId).filter((item) => ["RUN_CREATED", "RUNNING", "PAUSED"].includes(item.status));
    report.result = {
      taskExists: Boolean(task), runExists: Boolean(run), stepExists: Boolean(step), checkpointExists: Boolean(checkpoint),
      eventsExist: events.length > 0, nextActionExists: Boolean(checkpoint?.nextAction?.description),
      contextManifestExists: Boolean(checkpoint?.contextManifestReference), lastResultExists: Boolean(checkpoint?.lastToolResultReference),
      mutationExists: Boolean(mutation), activeRuns: activeRuns.length, recoveredTasks: recovered.tasks.length,
      state: task?.status, runState: run?.status,
    };
    report.ok = Object.entries(report.result).every(([key, value]) => key === "activeRuns" ? value === 0 : key === "state" ? value === "RECOVERABLE" : key === "runState" ? value === "RECOVERABLE" : Boolean(value));
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.exitCode = report.ok ? 0 : 2;
}

main();
