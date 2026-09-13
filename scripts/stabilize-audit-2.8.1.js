"use strict";

/**
 * Auditoría estabilización EDITCOREAI v2.8.1 — 4 puntos + integral.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const evidence = [];
let score = 0;
const max = 100;

function pass(points, msg) {
  score += points;
  evidence.push(`PASS (+${points}) ${msg}`);
}
function fail(msg) {
  evidence.push(`FAIL ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// ── Punto 1: Task núcleo ───────────────────────────────────────────
try {
  assert.ok(exists("runtime/task-store.js"));
  assert.ok(exists("runtime/task-manager.js"));
  assert.ok(exists("runtime/task-ipc.js"));
  const main = read("main.js");
  assert.match(main, /initializeTaskRuntime/);
  assert.match(main, /registerTaskIpc/);
  assert.match(read("runtime/task-ipc.js"), /task:create/);
  pass(15, "TaskStore/TaskManager/TaskIPC enlazados en main");
} catch (error) {
  fail(`Task núcleo: ${error.message}`);
}

// ── Punto 2: Patch IPC + exports ───────────────────────────────────
try {
  const pe = require("../patch-engine");
  assert.equal(typeof pe.applyPatch, "function");
  assert.equal(typeof pe.generateDiff, "function");
  assert.equal(typeof pe.writeFileAtomic, "function");
  assert.equal(typeof pe.rollbackPatch, "function");
  const main = read("main.js");
  const preload = read("preload.js");
  for (const ch of ["patch:apply", "patch:rollback", "patch:list-backups"]) {
    assert.ok(main.includes(`"${ch}"`), `main missing ${ch}`);
    assert.ok(preload.includes(ch), `preload missing ${ch}`);
  }
  assert.match(preload, /editcorePatch/);
  pass(15, "patch-engine + canales patch:* activos");
} catch (error) {
  fail(`Patch IPC: ${error.message}`);
}

// ── Punto 3: Test repair loop integrado ────────────────────────────
try {
  assert.ok(exists("runtime/test-repair-loop.js"));
  const reg = read("runtime/register-agent-capability-tools.js");
  assert.match(reg, /run_test_repair_loop/);
  assert.match(reg, /test-repair-loop/);
  const orch = read("runtime/intent-orchestrator.js");
  assert.match(orch, /run_test_repair_loop/);
  const main = read("main.js");
  assert.match(main, /project:test-repair/);
  const preload = read("preload.js");
  assert.match(preload, /testRepair|project:test-repair/);
  const { runTddRepair, extractFailureHints } = require("../runtime/test-repair-loop");
  assert.equal(typeof runTddRepair, "function");
  assert.ok(extractFailureHints("Error at src/foo.js:1").files.length >= 1);
  pass(20, "test-repair-loop cableado a tools/IPC/allowlist");
} catch (error) {
  fail(`Repair loop: ${error.message}`);
}

// ── Punto 4: Deploy bridges + bóveda ───────────────────────────────
try {
  assert.ok(exists("runtime/vercel-env-sync.js"));
  assert.ok(exists("runtime/ssh-deploy.js"));
  assert.ok(exists("agent-core/deploy-bridge.js"));
  const main = read("main.js");
  assert.match(main, /safeStorage/);
  assert.match(main, /readSecureState/);
  assert.match(main, /syncEnvToVercel/);
  assert.match(main, /sshDeploy/);
  const bridge = read("agent-core/deploy-bridge.js");
  assert.match(bridge, /credentials/);
  assert.match(bridge, /vercelToken|GITHUB_TOKEN|safeStorage|bóveda|boveda/i);
  assert.doesNotMatch(bridge, /ghp_[A-Za-z0-9]{10,}/);
  pass(15, "Deploy bridges sin secretos en claro; main usa safeStorage");
} catch (error) {
  fail(`Deploy: ${error.message}`);
}

// ── Mutación atómica caliente ──────────────────────────────────────
try {
  const { applyPatch, rollbackPatch, listBackups, writeFileAtomic } = require("../patch-engine");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-hot-patch-"));
  const file = path.join(dir, "demo.js");
  writeFileAtomic(file, "const x = 1;\n");
  const applied = applyPatch(dir, file, "const x = 1;", "const x = 2;", {
    runId: "audit-hot",
    createBackup: true,
  });
  assert.equal(applied.ok, true);
  assert.match(fs.readFileSync(file, "utf8"), /const x = 2/);
  assert.ok(applied.backupPath);
  const backups = listBackups(file);
  assert.ok(backups.length >= 1);
  const rolled = rollbackPatch(file, applied.backupPath);
  assert.equal(rolled.ok, true);
  assert.match(fs.readFileSync(file, "utf8"), /const x = 1/);
  pass(15, "applyPatch hot + backup + rollback OK");
} catch (error) {
  fail(`Hot patch: ${error.message}`);
}

// ── Arranque / IPC preload inventory ───────────────────────────────
try {
  const preload = read("preload.js");
  for (const api of ["editcoreChat", "editcoreProject", "editcoreAgent", "editcorePatch", "editcoreSession"]) {
    assert.match(preload, new RegExp(api));
  }
  const startup = path.join(process.env.APPDATA || "", "EDITCOREAI", "startup.log");
  if (fs.existsSync(startup)) {
    const tail = fs.readFileSync(startup, "utf8").split(/\r?\n/).slice(-40).join("\n");
    assert.match(tail, /startup:window-shown|startup:ready|brain-ready/);
    assert.doesNotMatch(tail, /No handler registered/i);
    pass(10, "startup.log limpio (sin No handler registered)");
  } else {
    pass(5, "APIs preload presentes (startup.log ausente en esta pasada)");
  }
} catch (error) {
  fail(`Boot/IPC: ${error.message}`);
}

// ── Resiliencia mínima (task + failover módulos) ───────────────────
try {
  assert.ok(exists("runtime/model-failover.js"));
  assert.ok(exists("runtime/task-recovery.js"));
  assert.ok(exists("runtime/worker-supervisor.js"));
  pass(10, "Módulos failover/recovery/supervisor presentes");
} catch (error) {
  fail(`Resiliencia: ${error.message}`);
}

evidence.push(`SCORE ${score}/${max}`);
console.log(evidence.join("\n"));
if (score < 85) {
  console.error("AUDIT_BELOW_THRESHOLD");
  process.exit(1);
}
console.log("AUDIT_OK");
process.exit(0);
