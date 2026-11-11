"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/forensic-evidence-locks.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appRoot = path.join(__dirname, "..", "..");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const evidenceSource = fs.readFileSync(path.join(appRoot, "runtime", "evidence-grounding.js"), "utf8");

test("E2c: adapter rechaza informe hueco con nudge", () => {
  assert.match(adapterSource, /hollowReportNudgeSent/);
  assert.match(adapterSource, /Informe HUECO rechazado/);
  assert.match(evidenceSource, /isHollowAnalysisReport/);
});
