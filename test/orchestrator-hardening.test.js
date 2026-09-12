"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  evaluateAgentCommandPolicy,
  shouldRequireCommandConfirmation,
} = require("../runtime/rules-engine");
const {
  createMutationCheckpoint,
  rollbackMutationCheckpoint,
} = require("../runtime/mutation-checkpoint");

test("RulesEngine bloquea DROP/force-push incluso en full access", () => {
  const drop = evaluateAgentCommandPolicy("psql -c \"DROP TABLE users\"", { fullAccess: true });
  assert.equal(drop.level, "block");
  const force = evaluateAgentCommandPolicy("git push --force origin main", { fullAccess: true });
  assert.equal(force.level, "block");
});

test("RulesEngine exige confirmacion de git push / rm -rf en full access", () => {
  const push = evaluateAgentCommandPolicy("git push origin main", { fullAccess: true });
  assert.equal(push.level, "confirm");
  assert.equal(push.enforceEvenFullAccess, true);
  assert.equal(shouldRequireCommandConfirmation(push, { fullAccess: true }), true);

  const rm = evaluateAgentCommandPolicy("rm -rf dist", { fullAccess: true });
  assert.equal(rm.level, "confirm");
  assert.equal(shouldRequireCommandConfirmation(rm, { fullAccess: true }), true);

  const safe = evaluateAgentCommandPolicy("npm run lint", { fullAccess: true });
  assert.equal(shouldRequireCommandConfirmation(safe, { fullAccess: true }), false);
});

test("mutation checkpoint crea y restaura en repo git temporal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-mcp-"));
  spawnSync("git", ["init"], { cwd: root, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@editcore.local"], { cwd: root, windowsHide: true });
  spawnSync("git", ["config", "user.name", "EDITCOREAI Test"], { cwd: root, windowsHide: true });
  fs.writeFileSync(path.join(root, "a.js"), "console.log(1)\n");
  spawnSync("git", ["add", "a.js"], { cwd: root, windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], { cwd: root, windowsHide: true });

  const cp = createMutationCheckpoint(root, { runId: "R1" });
  assert.equal(cp.ok, true);
  assert.equal(cp.skipped, false);
  assert.ok(cp.head);

  fs.writeFileSync(path.join(root, "a.js"), "console.log(999)\n");
  const rb = rollbackMutationCheckpoint(root, cp);
  assert.equal(rb.ok, true);
  const content = fs.readFileSync(path.join(root, "a.js"), "utf8");
  assert.match(content, /console\.log\(1\)/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("sin git el checkpoint se omite sin tumbar", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-nogit-"));
  const cp = createMutationCheckpoint(root, { runId: "R2" });
  assert.equal(cp.ok, true);
  assert.equal(cp.skipped, true);
  fs.rmSync(root, { recursive: true, force: true });
});
