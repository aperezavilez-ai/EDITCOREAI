"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del test mixto de
// test/roadmap-token-checkpoint.test.js: main.js se queda en la suite).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter cablea checkpoint de analisis (maybeCompactAndCheckpointAnalysis)", () => {
  const adapterSrc = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapterSrc, /maybeCompactAndCheckpointAnalysis/);
  assert.match(adapterSrc, /onAnalysisCheckpoint/);
});
