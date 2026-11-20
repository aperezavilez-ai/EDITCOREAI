"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  createSnapshot,
  snapshotBeforeWrite,
  rollbackLastChange,
  rollbackFileChange,
  revertTurn,
  listSnapshots,
} = require("../runtime/tools/snapshot");

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-checkpoint-test-"));
  fs.writeFileSync(path.join(root, "fileA.txt"), "Version 1 of A\n", "utf8");
  fs.writeFileSync(path.join(root, "fileB.txt"), "Version 1 of B\n", "utf8");
  return root;
}

test("Checkpoints: snapshotBeforeWrite and rollbackFileChange revert a single file", () => {
  const root = makeTempProject();
  try {
    // 1. Snapshot antes de escribir
    const snap = snapshotBeforeWrite(root, "fileA.txt", "test-edit");
    assert.equal(snap.ok, true);

    // 2. Modificar el archivo
    fs.writeFileSync(path.join(root, "fileA.txt"), "MUTATED Version of A\n", "utf8");
    assert.equal(fs.readFileSync(path.join(root, "fileA.txt"), "utf8"), "MUTATED Version of A\n");

    // 3. Revertir solo fileA
    const roll = rollbackFileChange(root, "fileA.txt");
    assert.equal(roll.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "fileA.txt"), "utf8"), "Version 1 of A\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Checkpoints Time-Machine: revertTurn restores multiple files modified in a single turn", () => {
  const root = makeTempProject();
  try {
    const turnId = "turn-session-123";

    // 1. Simular mutaciones multi-archivo durante el mismo turno
    snapshotBeforeWrite(root, "fileA.txt", "write_file", { turnId });
    fs.writeFileSync(path.join(root, "fileA.txt"), "Turn changed A\n", "utf8");

    snapshotBeforeWrite(root, "fileB.txt", "replace_in_file", { turnId });
    fs.writeFileSync(path.join(root, "fileB.txt"), "Turn changed B\n", "utf8");

    // Archivo nuevo creado en este turno
    snapshotBeforeWrite(root, "fileC_new.txt", "create_file", { turnId });
    fs.writeFileSync(path.join(root, "fileC_new.txt"), "brand new file\n", "utf8");

    assert.equal(fs.existsSync(path.join(root, "fileC_new.txt")), true);
    assert.match(fs.readFileSync(path.join(root, "fileA.txt"), "utf8"), /Turn changed A/);
    assert.match(fs.readFileSync(path.join(root, "fileB.txt"), "utf8"), /Turn changed B/);

    // 2. Ejecutar revertTurn
    const result = revertTurn(root, turnId);
    assert.equal(result.ok, true);
    assert.equal(result.filesAffected >= 3, true);

    // 3. Verificar que A y B volvieron a su estado original
    assert.equal(fs.readFileSync(path.join(root, "fileA.txt"), "utf8"), "Version 1 of A\n");
    assert.equal(fs.readFileSync(path.join(root, "fileB.txt"), "utf8"), "Version 1 of B\n");

    // 4. Verificar que el archivo nuevo creado en el turno fue eliminado limpiamente
    assert.equal(fs.existsSync(path.join(root, "fileC_new.txt")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Checkpoints: listSnapshots reflects created checkpoints with turn metadata", () => {
  const root = makeTempProject();
  try {
    createSnapshot(root, ["fileA.txt", "fileB.txt"], "batch-edit", { turnId: "turn-999" });
    const list = listSnapshots(root);
    assert.equal(list.ok, true);
    assert.equal(list.snapshots.length >= 1, true);
    assert.equal(list.snapshots[0].turnId, "turn-999");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Checkpoints: rollbackFileTool in tools.js handles both file-level and turn-level revert", () => {
  const { rollbackFileTool } = require("../runtime/tools/tools");
  const root = makeTempProject();
  try {
    const turnId = "turn-auto-456";

    // 1. Simular escritura con snapshot
    snapshotBeforeWrite(root, "fileA.txt", "write_file", { turnId });
    fs.writeFileSync(path.join(root, "fileA.txt"), "A mutated by agent\n", "utf8");

    snapshotBeforeWrite(root, "fileB.txt", "write_file", { turnId });
    fs.writeFileSync(path.join(root, "fileB.txt"), "B mutated by agent\n", "utf8");

    // 2. Revertir turn completo (sin pasar path)
    const turnResult = rollbackFileTool(root, { turnId });
    assert.equal(turnResult.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "fileA.txt"), "utf8"), "Version 1 of A\n");
    assert.equal(fs.readFileSync(path.join(root, "fileB.txt"), "utf8"), "Version 1 of B\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

