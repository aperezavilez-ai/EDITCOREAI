"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del C4 de
// test/no-regression-contracts.test.js: los topes de la ruta viva —
// bridge y analysis-depth — se quedan en la suite).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("C4 (parte adaptador): hardCap de iteraciones del adaptador", () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapterSource, /const hardCap = listOnly/);
  assert.doesNotMatch(adapterSource, /input\.allowWrite && input\.analysisMode !== true \? 80 : 36/);
});
