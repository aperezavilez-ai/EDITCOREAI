"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del test mixto «main no bypassea analysis» de test/analysis-pipeline-contract.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter aplica shouldBlockHeavyVerification (forbidHeavy)", () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapterSource, /forbidHeavy = shouldBlockHeavyVerification/);
});
