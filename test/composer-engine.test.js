"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { ComposerEngine } = require("../agent-core/composer-engine");

test("ComposerEngine plans multi-file tasks, stages diffs, commits and rolls back cleanly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-composer-test-"));
  
  // Crear archivo existente
  const existingFile = path.join(tmpDir, "src", "config.js");
  fs.mkdirSync(path.dirname(existingFile), { recursive: true });
  fs.writeFileSync(existingFile, "export const API_URL = 'http://localhost:3000';", "utf8");

  const engine = new ComposerEngine({ projectRoot: tmpDir });
  
  // 1. Crear sesión
  const session = engine.createSession({
    goal: "Actualizar URL y crear nuevo módulo",
    tasks: [
      { title: "Actualizar config.js", targetFiles: ["src/config.js"], subagent: "backend" },
      { title: "Crear nuevo servicio auth.js", targetFiles: ["src/auth.js"], subagent: "ui_builder" },
    ],
  });

  assert.ok(session.id.startsWith("comp_"));
  assert.equal(session.tasks.length, 2);

  // 2. Stage changes
  const change1 = engine.stageFileChange(session.id, "src/config.js", "export const API_URL = 'https://api.editcore.ai';");
  assert.ok(change1.diff.includes("-export const API_URL = 'http://localhost:3000';"));
  assert.ok(change1.diff.includes("+export const API_URL = 'https://api.editcore.ai';"));

  const change2 = engine.stageFileChange(session.id, "src/auth.js", "export function login() { return true; }");
  assert.ok(change2.diff.includes("+export function login() { return true; }"));

  // 3. Update task progress
  engine.updateTaskProgress(session.id, "task_1", "completed");
  engine.updateTaskProgress(session.id, "task_2", "completed");
  assert.equal(session.status, "completed");

  // 4. Stream summary
  const summary = engine.getStreamingDiffSummary(session.id);
  assert.equal(summary.diffs.length, 2);
  assert.equal(summary.diffs[0].linesAdded, 1);
  assert.equal(summary.diffs[0].linesRemoved, 1);

  // 5. Commit session to disk
  const commitRes = engine.commitSession(session.id);
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.appliedCount, 2);

  // Verificar que el disco fue actualizado
  assert.equal(fs.readFileSync(existingFile, "utf8"), "export const API_URL = 'https://api.editcore.ai';");
  assert.equal(fs.readFileSync(path.join(tmpDir, "src", "auth.js"), "utf8"), "export function login() { return true; }");

  // 6. Rollback session
  const rollbackRes = engine.rollbackSession(session.id);
  assert.equal(rollbackRes.ok, true);

  // Verificar restauración
  assert.equal(fs.readFileSync(existingFile, "utf8"), "export const API_URL = 'http://localhost:3000';");
  assert.equal(fs.existsSync(path.join(tmpDir, "src", "auth.js")), false);

  // Cleanup tmpDir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
