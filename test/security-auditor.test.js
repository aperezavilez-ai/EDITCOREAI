"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { SecurityAuditor } = require("../runtime/security-auditor");

test("security-auditor: detecta vulnerabilidades criticas y de inyeccion", () => {
  const auditor = new SecurityAuditor();
  const badCode = [
    'const apiKey = "sk-live-1234567890abcdef123456";',
    'eval("console.log(\'danger\')");',
    'exec(`rm -rf ${userInput}`);',
    'const rand = Math.random();'
  ].join("\n");

  const report = auditor.scanContent(badCode, "test-vulnerable.js");
  assert.equal(report.file, "test-vulnerable.js");
  assert.ok(report.totalIssues >= 4, "Debe detectar al menos 4 problemas");

  const ids = report.issues.map((i) => i.id);
  assert.ok(ids.includes("SEC001_HARDCODED_SECRET"));
  assert.ok(ids.includes("SEC002_UNSAFE_EVAL"));
  assert.ok(ids.includes("SEC003_COMMAND_INJECTION"));
  assert.ok(ids.includes("SEC006_INSECURE_RANDOM"));
  assert.ok(report.score < 50, "El score de seguridad debe ser bajo");
  assert.equal(report.grade, "F");
});

test("security-auditor: genera y aplica refactorizaciones predictivas", () => {
  const auditor = new SecurityAuditor();
  const legacyCode = "var oldVar = 123;\nconsole.log(oldVar);";

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sec-test-"));
  const tempFile = path.join(tempDir, "sample.js");
  fs.writeFileSync(tempFile, legacyCode, "utf8");

  try {
    const plan = auditor.predictRefactor(tempFile);
    assert.equal(plan.hasChanges, true);
    assert.ok(plan.appliedFixes.length > 0);

    const applyRes = auditor.applyRefactor(tempFile);
    assert.equal(applyRes.ok, true);
    assert.equal(applyRes.changed, true);

    const updated = fs.readFileSync(tempFile, "utf8");
    assert.ok(!updated.includes("var oldVar"));
    assert.ok(updated.includes("const oldVar"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("security-auditor: escaneo de workspace completo", () => {
  const auditor = new SecurityAuditor();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sec-ws-"));
  fs.writeFileSync(path.join(tempDir, "clean.js"), "const x = 1;\nmodule.exports = x;\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "secret.js"), 'const token = "ghp_1234567890abcdef12345678";\n', "utf8");

  try {
    const wsReport = auditor.scanWorkspace(tempDir);
    assert.equal(wsReport.scannedFilesCount, 2);
    assert.ok(wsReport.totalIssues >= 1);
    assert.equal(wsReport.fileReports.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
