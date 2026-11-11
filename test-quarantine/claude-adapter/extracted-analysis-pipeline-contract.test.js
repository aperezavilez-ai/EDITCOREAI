"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído de test/analysis-pipeline-contract.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter nunca shippea Verificacion meta en analisis", () => {
  const adapterSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /Verificacion completada con evidencia real/);
  assert.match(adapterSrc, /isHollowAnalysisReport/);
  assert.match(adapterSrc, /ROADMAP|COVERAGE_MAP/i);
});

test("walker cobertura: adapter usa nextAnalysisWalkActions + COVERAGE_MAP", () => {
  const adapterSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /nextAnalysisWalkActions/);
  assert.match(adapterSrc, /formatCoverageBlock/);
  assert.match(adapterSrc, /COVERAGE_MAP/);
  const depth = require("../../runtime/analysis-depth").resolveAnalysisDepth("analisis forense");
  assert.equal(depth.maxWalkDirs >= 18, true);
  assert.equal(depth.minListedDirs >= 6, true);
});
