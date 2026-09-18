"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execSync } = require("node:child_process");

const gitManager = require("../runtime/git-manager");

function createTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-git-test-"));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync('git config user.email "test@editcore.ai"', { cwd: tmp, stdio: "pipe" });
  execSync('git config user.name "EditCore Test"', { cwd: tmp, stdio: "pipe" });
  return tmp;
}

test("git-manager: getStatus devuelve error si no es repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-not-git-"));
  const result = gitManager.getStatus(tmp);
  assert.equal(result.ok, false);
  assert.match(result.message, /No es un repositorio Git/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("git-manager: getStatus devuelve estado limpio en repo vacío", () => {
  const repo = createTempRepo();
  const result = gitManager.getStatus(repo);
  assert.equal(result.ok, true);
  assert.equal(result.repo, repo);
  assert.ok(Array.isArray(result.changes));
  assert.equal(result.changes.length, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: detectLocalChanges detecta cambios", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "test.txt");
  fs.writeFileSync(filePath, "hello");
  const result = gitManager.detectLocalChanges(repo);
  assert.equal(result.ok, true);
  assert.equal(result.hasChanges, true);
  assert.ok(result.changes.length > 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: stageFiles y commit funcionan", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "file.txt");
  fs.writeFileSync(filePath, "contenido");
  const stageResult = gitManager.stageFiles(["file.txt"], repo);
  assert.equal(stageResult.ok, true);
  const commitResult = gitManager.commit("primer commit", repo);
  assert.equal(commitResult.ok, true);
  const statusAfter = gitManager.getStatus(repo);
  assert.equal(statusAfter.changes.length, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: getBranches devuelve al menos main/master", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "init.txt");
  fs.writeFileSync(filePath, "init");
  gitManager.stageFiles(["init.txt"], repo);
  gitManager.commit("init", repo);
  const result = gitManager.getBranches(repo);
  assert.equal(result.ok, true);
  assert.ok(result.branches.length >= 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: createBranch y checkoutBranch", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "base.txt");
  fs.writeFileSync(filePath, "base");
  gitManager.stageFiles(["base.txt"], repo);
  gitManager.commit("base", repo);
  const createResult = gitManager.createBranch("feature-x", repo);
  assert.equal(createResult.ok, true);
  const checkoutResult = gitManager.checkoutBranch("feature-x", repo);
  assert.equal(checkoutResult.ok, true);
  const status = gitManager.getStatus(repo);
  assert.ok(status.branch.includes("feature-x"));
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: getCommitHistory devuelve commits", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "log.txt");
  fs.writeFileSync(filePath, "log");
  gitManager.stageFiles(["log.txt"], repo);
  gitManager.commit("commit para historial", repo);
  const result = gitManager.getCommitHistory(5, repo);
  assert.equal(result.ok, true);
  assert.ok(result.commits.length >= 1);
  assert.equal(result.commits[0].message, "commit para historial");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: getDiff muestra diferencias", () => {
  const repo = createTempRepo();
  const filePath = path.join(repo, "diff.txt");
  fs.writeFileSync(filePath, "original");
  gitManager.stageFiles(["diff.txt"], repo);
  gitManager.commit("original", repo);
  fs.writeFileSync(filePath, "modificado");
  const diffResult = gitManager.getDiff(["diff.txt"], repo);
  assert.equal(diffResult.ok, true);
  assert.ok(diffResult.unstaged.includes("modificado") || diffResult.unstaged.length > 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: commit sin mensaje devuelve error", () => {
  const repo = createTempRepo();
  const result = gitManager.commit("", repo);
  assert.equal(result.ok, false);
  assert.match(result.message, /mensaje de commit/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("git-manager: stageFiles sin archivos devuelve error", () => {
  const repo = createTempRepo();
  const result = gitManager.stageFiles([], repo);
  assert.equal(result.ok, false);
  assert.match(result.message, /No se indicaron archivos/);
  fs.rmSync(repo, { recursive: true, force: true });
});
