"use strict";

/** Validación exacta de los 4 pilares + auditoría A/B/C. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const out = [];
function ok(msg) { out.push(`OK  ${msg}`); }
function bad(msg) { out.push(`BAD ${msg}`); throw new Error(msg); }

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

// 1) Task núcleo — registerTaskIpc incondicional en arranque
{
  const main = read("main.js");
  const ipc = read("runtime/task-ipc.js");
  assert.match(main, /initializeTaskRuntime\(\);/);
  assert.match(main, /registerTaskIpc\(ipcMain,\s*taskManager,\s*taskRecovery,\s*workflowOrchestrator\)/);
  for (const ch of ["task:create", "task:list", "task:update", "task:get", "task:status"]) {
    assert.ok(ipc.includes(`"${ch}"`), `falta ${ch}`);
  }
  ok("Pilar1 TaskStore/Manager/IPC + registerTaskIpc en arranque + task:update");
}

// 2) Patch engine + canales
{
  const pe = require("../patch-engine");
  assert.equal(typeof pe.applyPatch, "function");
  assert.equal(typeof pe.generateDiff, "function");
  assert.equal(typeof pe.writeFileAtomic, "function");
  const main = read("main.js");
  assert.match(main, /applyPatch\(projectRoot,\s*filePath,\s*oldText,\s*newText,\s*options\)/);
  assert.match(main, /"patch:apply"/);
  assert.match(read("preload.js"), /editcorePatch/);
  ok("Pilar2 patch-engine exports + main params + patch:* IPC");
}

// 3) Test repair loop
{
  const mod = require("../runtime/test-repair-loop");
  assert.equal(typeof mod.TestRepairLoop, "function");
  assert.equal(typeof mod.runTddRepair, "function");
  assert.match(read("runtime/register-agent-capability-tools.js"), /run_test_repair_loop/);
  assert.match(read("main.js"), /project:test-repair/);
  ok("Pilar3 TestRepairLoop + runTddRepair + tool/IPC");
}

// 4) Deploy + safeStorage
{
  const main = read("main.js");
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.match(main, /syncEnvToVercel/);
  assert.match(main, /sshDeploy/);
  assert.match(main, /deployOneClick/);
  assert.ok(fs.existsSync(path.join(root, "runtime/vercel-env-sync.js")));
  assert.ok(fs.existsSync(path.join(root, "runtime/ssh-deploy.js")));
  assert.ok(fs.existsSync(path.join(root, "runtime/deploy-one-click.js")));
  ok("Pilar4 deploy bridges + safeStorage encrypt/decrypt");
}

// Hot patch mutation
{
  const { applyPatch, writeFileAtomic, listBackups, rollbackPatch } = require("../patch-engine");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pillars-patch-"));
  const file = path.join(dir, "x.js");
  writeFileAtomic(file, "let n=1;\n");
  const r = applyPatch(dir, file, "let n=1;", "let n=2;", { createBackup: true, runId: "pillars" });
  assert.equal(r.ok, true);
  assert.ok(listBackups(file).length >= 1);
  assert.equal(rollbackPatch(file, r.backupPath).ok, true);
  ok("Hot applyPatch + backup + rollback");
}

// Paso A: startup.log
{
  const logPath = path.join(process.env.APPDATA || "", "EDITCOREAI", "startup.log");
  assert.ok(fs.existsSync(logPath), "startup.log ausente");
  const tail = fs.readFileSync(logPath, "utf8").split(/\r?\n/).slice(-60).join("\n");
  assert.match(tail, /startup:ready/);
  assert.match(tail, /startup:window-shown|brain-ready/);
  assert.doesNotMatch(tail, /No handler registered/i);
  assert.doesNotMatch(tail, /UnhandledPromiseRejection/i);
  ok("PasoA cold start log limpio");
}

// Paso B: preload APIs
{
  const preload = read("preload.js");
  assert.match(preload, /editcoreChat/);
  assert.match(preload, /editcorePatch/);
  assert.match(preload, /editcoreTasks/);
  assert.match(preload, /editcoreComposer/);
  assert.match(preload, /editcoreExtensions/);
  assert.match(preload, /editcorePty/);
  assert.match(preload, /patch:apply/);
  assert.match(preload, /task:create/);
  assert.match(preload, /composer:plan/);
  assert.match(preload, /pty:create/);
  ok("PasoB APIs IPC chat/patch/tasks/composer/extensions/pty");
}

// Paso C: failover
{
  const failover = require("../runtime/model-failover");
  assert.equal(typeof failover.isRecoverableModelError, "function");
  assert.equal(failover.isRecoverableModelError({ status: 503, message: "unavailable" }), true);
  assert.equal(failover.isRecoverableModelError({ status: 400, message: "bad request" }), false);
  assert.ok(fs.existsSync(path.join(root, "runtime/task-recovery.js")));
  ok("PasoC model-failover recoverable + task-recovery presente");
}

// Release Setup
{
  const setup = path.join(root, "release", "EDITCOREAI-Setup.exe");
  assert.ok(fs.existsSync(setup), "Falta release/EDITCOREAI-Setup.exe");
  const size = fs.statSync(setup).size;
  assert.ok(size > 50_000_000, `Setup demasiado pequeno: ${size}`);
  ok(`Release Setup presente (${Math.round(size / 1e6)} MB)`);
}

console.log(out.join("\n"));
console.log("PILLARS_AUDIT_100");
