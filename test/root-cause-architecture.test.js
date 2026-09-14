"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("runtime/session.js existe y expone memoria de workspace", () => {
  const session = require("../runtime/session");
  assert.equal(typeof session.loadWorkspaceSession, "function");
  assert.equal(typeof session.formatSessionMemoryOrFallback, "function");
  assert.equal(typeof session.ensureSessionState, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-session-"));
  try {
    const loaded = session.loadWorkspaceSession(root);
    assert.equal(loaded.ok, true);
    assert.ok(String(loaded.promptBlock || "").length > 10);
    const text = session.formatSessionMemoryOrFallback(root);
    assert.match(text, /SESSION|workspace|Memoria/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deploy-bridge commit usa -F y no shell -m", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "agent-core", "deploy-bridge.js"), "utf8");
  assert.match(source, /\["commit",\s*"\-F"/);
  assert.doesNotMatch(source, /run\(`git commit/);
  assert.doesNotMatch(source, /spawnSync\([^)]*shell:\s*true/);
  assert.match(source, /shell:\s*false/);
});

test("publish-pipeline llama ensureVercelProjectId(connections, opts)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "runtime", "publish-pipeline.js"), "utf8");
  assert.match(source, /ensureVercelProjectId\(connections,\s*\{/);
  assert.doesNotMatch(source, /ensureVercelProjectId\(root,\s*connections/);
  assert.match(source, /projectRoot:\s*root/);
});

test("orchestrator no pide escribe procede al cerrar analisis", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Si quieres que aplique cambios en disco, escribe \*\*procede\*\*/,
  );
});
