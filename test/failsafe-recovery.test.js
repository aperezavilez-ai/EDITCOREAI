"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { createSnapshot, rollbackLastChange, listSnapshots } = require("../editcore-chat-kernel/snapshot");
const { verifySyntax } = require("../scripts/failsafe-recovery");

test("snapshot engine creates backup and rolls back cleanly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-snapshot-test-"));
  const testFile = path.join(tmpDir, "test-file.js");
  fs.writeFileSync(testFile, 'console.log("version 1");', "utf8");

  // Crear snapshot v1
  const snap1 = createSnapshot(tmpDir, ["test-file.js"], "Version 1 baseline");
  assert.ok(snap1);

  // Modificar archivo a v2
  fs.writeFileSync(testFile, 'console.log("version 2 modified");', "utf8");
  assert.equal(fs.readFileSync(testFile, "utf8"), 'console.log("version 2 modified");');

  // Listar snapshots
  const list = listSnapshots(tmpDir);
  assert.ok(list.snapshots.length >= 1);

  // Revertir a v1
  const rollbackRes = rollbackLastChange(tmpDir, snap1.id);
  assert.equal(rollbackRes.ok, true);
  assert.equal(fs.readFileSync(testFile, "utf8"), 'console.log("version 1");');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("failsafe-recovery verifySyntax functions cleanly", () => {
  assert.equal(typeof verifySyntax, "function");
  const syntaxOk = verifySyntax();
  assert.equal(syntaxOk, true);
});
