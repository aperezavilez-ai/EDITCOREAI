"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  saveLastAgentRun,
  peekLastAgentRun,
  restoreLastAgentRun,
  buildLastRunReview,
  reviewFileDecision,
  acceptAllPending,
} = require("../runtime/agent-run-checkpoint");

function resolveInside(root, rel) {
  const target = path.resolve(root, rel);
  if (!target.startsWith(path.resolve(root))) throw new Error("outside");
  return target;
}

test("save + restore last agent run recreate/delete", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-undo-ud-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-undo-proj-"));
  const rel = "notes/SMOKE_UNDO.txt";
  const abs = path.join(project, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "before", "utf8");

  const backupDir = path.join(userData, "backups-temp");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "before.txt");
  fs.copyFileSync(abs, backupPath);
  fs.writeFileSync(abs, "after", "utf8");

  saveLastAgentRun(userData, project, {
    runId: "run-1",
    files: [{ path: rel, action: "replace_in_file", backupPath, created: false }],
  });

  const peek = peekLastAgentRun(userData, project);
  assert.equal(peek.files.length, 1);
  assert.equal(fs.readFileSync(abs, "utf8"), "after");

  const restored = restoreLastAgentRun(userData, project, { resolveInside });
  assert.equal(restored.restored, 1);
  assert.equal(fs.readFileSync(abs, "utf8"), "before");
  assert.equal(peekLastAgentRun(userData, project).restored, true);

  assert.throws(
    () => restoreLastAgentRun(userData, project, { resolveInside }),
    /ya fue deshecha/i,
  );
});

test("restore created file deletes it", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-undo-ud2-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-undo-proj2-"));
  const rel = "tmp/created.txt";
  const abs = path.join(project, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "new", "utf8");

  saveLastAgentRun(userData, project, {
    runId: "run-2",
    files: [{ path: rel, action: "write_file", backupPath: "", created: true }],
  });
  restoreLastAgentRun(userData, project, { resolveInside });
  assert.equal(fs.existsSync(abs), false);
});

test("review: reject one file restores backup", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-rev-ud-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-rev-proj-"));
  const rel = "a.txt";
  const abs = path.join(project, rel);
  fs.writeFileSync(abs, "NEW", "utf8");
  const backup = path.join(userData, "a.bak");
  fs.writeFileSync(backup, "OLD", "utf8");
  saveLastAgentRun(userData, project, {
    runId: "r3",
    files: [{ path: rel, action: "replace_in_file", backupPath: backup, created: false }],
  });

  const review = buildLastRunReview(userData, project, { resolveInside });
  assert.equal(review.files.length, 1);
  assert.match(review.files[0].diff, /OLD|NEW|\+/);

  const out = reviewFileDecision(userData, project, rel, "reject", { resolveInside });
  assert.equal(out.status, "rejected");
  assert.equal(fs.readFileSync(abs, "utf8"), "OLD");
});

test("review: accept all keeps disk content", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-acc-ud-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-acc-proj-"));
  const rel = "b.txt";
  const abs = path.join(project, rel);
  fs.writeFileSync(abs, "KEEP", "utf8");
  const backup = path.join(userData, "b.bak");
  fs.writeFileSync(backup, "OLD", "utf8");
  saveLastAgentRun(userData, project, {
    runId: "r4",
    files: [{ path: rel, action: "replace_in_file", backupPath: backup, created: false }],
  });
  const accepted = acceptAllPending(userData, project);
  assert.equal(accepted.accepted, 1);
  assert.equal(fs.readFileSync(abs, "utf8"), "KEEP");
  assert.equal(peekLastAgentRun(userData, project).files[0].status, "accepted");
});
