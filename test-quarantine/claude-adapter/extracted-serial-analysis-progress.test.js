"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/serial-analysis-progress.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter limita a 1 tool en analysisMode y emite avance", () => {
  const adapterSrc = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapterSrc, /SERIAL_ANALYSIS: solo 1 herramienta por turno/);
  assert.match(adapterSrc, /emitAnalysisStepProgress/);
  assert.match(adapterSrc, /bootstrap ligero|SERIAL como Cursor/i);
  assert.doesNotMatch(adapterSrc, /actions\.slice\(0,\s*4\)/);
});
