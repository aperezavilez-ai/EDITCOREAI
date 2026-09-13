"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { git } = require("../runtime/git-utils");
const { commitIfNeeded } = require("../runtime/publish-pipeline");

function initRepo(dir) {
  spawnSync("git", ["init"], { cwd: dir, shell: false, windowsHide: true });
  spawnSync("git", ["config", "user.email", "test@editcore.local"], { cwd: dir, shell: false, windowsHide: true });
  spawnSync("git", ["config", "user.name", "EditCore Test"], { cwd: dir, shell: false, windowsHide: true });
}

test("git commit con mensaje multi-palabra NO produce pathspec (bug Windows shell)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-git-commit-"));
  initRepo(dir);
  fs.writeFileSync(path.join(dir, "hello.txt"), "a\n", "utf8");
  await git(dir, ["add", "hello.txt"]);
  const msg = "chore: fullstack publish FUXION SERVICE 2026-09-13";
  const result = await git(dir, ["commit", "-m", msg]);
  assert.equal(result.code, 0, `commit fallo: ${result.stderr || result.stdout}`);
  assert.doesNotMatch(result.stderr || "", /pathspec/i);
  const log = await git(dir, ["log", "-1", "--pretty=%s"]);
  assert.equal(log.stdout.trim(), msg);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commitIfNeeded usa -F y preserva mensaje con espacios", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-commit-f-"));
  initRepo(dir);
  fs.writeFileSync(path.join(dir, "app.js"), "console.log(1)\n", "utf8");
  await git(dir, ["add", "app.js"]);
  const msg = "chore: fullstack publish FUXION SERVICE 2026-09-13";
  const result = await commitIfNeeded(dir, msg);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.committed, true);
  assert.equal(result.message, msg);
  assert.doesNotMatch(String(result.message), /pathspec/i);
  const log = await git(dir, ["log", "-1", "--pretty=%s"]);
  assert.equal(log.stdout.trim(), msg);
  fs.rmSync(dir, { recursive: true, force: true });
});
