"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldCloseAfterVerifiedWork } = require("../runtime/cursor-parity");
const { buildExecutionEvidenceReport, collectToolEvidence } = require("../runtime/evidence-grounding");
const { validateAgentCompletion, verificationStepPassed, isFailedDiagnosticResult } = require("../agent-runtime");

const failedLint = {
  name: "run_command",
  ok: true,
  input: { command: "npm run lint" },
  result: {
    diagnostic: true,
    toolOk: true,
    passed: false,
    exitCode: 1,
    output: "Comando de verificacion finalizado con exit 1.\nResultado de verificacion: FALLO.",
  },
};

test("N2: lint exit!=0 no cierra shouldCloseAfterVerifiedWork", () => {
  assert.equal(shouldCloseAfterVerifiedWork({
    allowWrite: true,
    analysisMode: false,
    steps: [
      { name: "write_file", ok: true, input: { path: "src/a.js" }, result: { ok: true } },
      failedLint,
    ],
  }), false);
});

test("N2: verificationStepPassed es false con diagnostic failed", () => {
  assert.equal(isFailedDiagnosticResult(failedLint.result), true);
  assert.equal(verificationStepPassed(failedLint), false);
});

test("N2: buildExecutionEvidenceReport no OK si solo hay lint fallido", () => {
  const report = buildExecutionEvidenceReport("Corregido", [
    { name: "write_file", ok: true, input: { path: "src/a.js", content: "x" }, result: { content: "x" } },
    failedLint,
  ], "");
  assert.equal(report.ok, false);
  assert.match(report.reasons.join(" "), /FALLO|exit/i);
  const evidence = collectToolEvidence([
    { name: "write_file", ok: true, input: { path: "src/a.js", content: "x" }, result: { content: "x" } },
    failedLint,
  ], "");
  assert.equal(evidence.verifications.some((v) => v.diagnosticFailed), true);
  assert.equal(evidence.verifications.every((v) => v.ok !== true || v.diagnosticFailed), true);
});

test("N2: validateAgentCompletion exige verificacion real tras lint fallido", () => {
  const result = validateAgentCompletion(
    "corrige login y verifica con lint",
    [
      { name: "write_file", ok: true, input: { path: "src/a.js", content: "x" }, result: { ok: true } },
      failedLint,
    ],
    true,
    { planAuthorized: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.verificationFailed, true);
});
