"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ensureSessionState,
  formatSessionStateForPrompt,
  noteSuccessfulPatch,
  loadSessionState,
} = require("../runtime/session-state");
const { appendPatchSummaryToRoadmap, readRoadmap } = require("../runtime/project-roadmap");
const { applyPatch } = require("../patch-engine");
const { defaultChatSystemPrompt } = require("../runtime/elite-communication-policy");
const { ROADMAP_FIRST_RULE, formatJarvisContextForPrompt } = require("../runtime/jarvis-port");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-session-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("defaultChatSystemPrompt exige ROADMAP-FIRST", () => {
  const p = defaultChatSystemPrompt();
  assert.match(p, /ROADMAP-FIRST/i);
  assert.match(p, /session-state\.json/i);
});

test("jarvis-port expone ROADMAP_FIRST_RULE", () => {
  assert.match(ROADMAP_FIRST_RULE, /ROADMAP\.md/);
  assert.match(formatJarvisContextForPrompt(), /session-state\.json/);
});

test("session-state cachea arbol y mods", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "package.json"), "{\"name\":\"demo\"}\n");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.js"), "export const a=1;\n");
    const state = ensureSessionState(dir, { task: "demo" });
    assert.ok(state.fileTree.some((row) => /package\.json/.test(row.path)));
    assert.match(formatSessionStateForPrompt(dir), /SESSION-STATE/);
    noteSuccessfulPatch(dir, { path: "src/a.js", action: "applyPatch", summary: "bump" });
    const loaded = loadSessionState(dir);
    assert.equal(loaded.recentMods[0].path, "src/a.js");
    assert.match(readRoadmap(dir).content, /src\/a\.js/);
  });
});

test("applyPatch OK actualiza ROADMAP y session-state", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "hello.js"), "const n=1;\n");
    const r = applyPatch(dir, "hello.js", "const n=1;", "const n=2;", { createBackup: false, skipCheckpoint: true });
    assert.equal(r.ok, true);
    assert.match(readRoadmap(dir).content, /hello\.js/);
    assert.equal(loadSessionState(dir).recentMods[0].path, "hello.js");
  });
});

test("appendPatchSummaryToRoadmap ignora indices internos", () => {
  withTempDir((dir) => {
    const skipped = appendPatchSummaryToRoadmap(dir, { path: "ROADMAP.md", summary: "x" });
    assert.equal(skipped.skipped, true);
  });
});
