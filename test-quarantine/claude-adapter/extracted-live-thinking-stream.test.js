"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/live-thinking-stream.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appRoot = path.join(__dirname, "..", "..");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");

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
