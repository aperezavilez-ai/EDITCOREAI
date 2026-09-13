"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.join(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");

test("live activity: una sola fila setAgentLiveActivity", () => {
  assert.match(rendererSource, /function setAgentLiveActivity/);
  assert.match(rendererSource, /agent-live-activity/);
  assert.match(rendererSource, /setAgentLiveActivity\(thinkingEl, label\)/);
});

test("live activity: analisis no bloquea minutos en Cerebro", () => {
  assert.match(mainSource, /analysisMode/);
  assert.match(mainSource, /setTimeout\(\(\) => resolve\(\["", emptyInventory\]\), 3_000\)/);
  assert.match(mainSource, /const skipBrainNow =/);
});

test("live activity: ticker trabajando silencioso", () => {
  assert.match(adapterSource, /Trabajando…/);
  assert.match(adapterSource, /waitTicker/);
  assert.match(adapterSource, /onProgress/);
  assert.match(adapterSource, /silentFailover/);
  assert.match(rendererSource, /sanitizeLiveActivityLabel/);
});

test("live thinking: adapter streamea deltas", () => {
  assert.match(adapterSource, /phase: "narration_delta"/);
});
