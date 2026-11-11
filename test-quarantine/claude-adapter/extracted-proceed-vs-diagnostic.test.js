"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/proceed-vs-diagnostic.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appRoot = path.join(__dirname, "..", "..");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");

test("F3b: adapter fuerza lectura de targets del prompt", () => {
  assert.match(adapterSource, /resources\/app\/runtime\/\$\{base\}/);
  assert.match(adapterSource, /analysisTargetCoverage/);
});
