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
  assert.match(mainSource, /max 3s|setTimeout\(\(\) => resolve\(\["", emptyInventory\]\), 3_000\)/);
  assert.match(mainSource, /skipBrainNow = analysisMode/);
});

test("live activity: ticker esperando modelo", () => {
  assert.match(adapterSource, /Esperando al modelo/);
  assert.match(adapterSource, /waitTicker/);
  assert.match(adapterSource, /onStreamActivity/);
  assert.match(adapterSource, /Recibiendo herramientas del modelo/);
});

test("live thinking: adapter streamea deltas", () => {
  assert.match(adapterSource, /phase: "narration_delta"/);
});
