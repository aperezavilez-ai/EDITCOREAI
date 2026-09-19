/**
 * test/test-generator-agent.test.js
 * Unit tests for TestGeneratorAgent (Ciclo 32)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { TestGeneratorAgent } = require("../runtime/test-generator-agent.js");

describe("Cycle 32: Autonomous Test Generator Agent", () => {
  const sampleCode = `
class CalculatorService {
  constructor() {
    this.total = 0;
  }
}

function add(a, b) {
  return a + b;
}

const multiply = (a, b) => a * b;

module.exports = { CalculatorService, add, multiply };
`;

  test("analyzes source code and extracts functions and classes", () => {
    const agent = new TestGeneratorAgent();
    const analysis = agent.analyzeFileForTests("src/calculator.js", sampleCode);

    assert.strictEqual(analysis.baseName, "calculator");
    assert.strictEqual(analysis.classes.length, 1);
    assert.strictEqual(analysis.classes[0], "CalculatorService");
    assert.ok(analysis.functions.includes("add"));
    assert.ok(analysis.functions.includes("multiply"));
  });

  test("generates runnable test suite scaffolding for analyzed functions", () => {
    const agent = new TestGeneratorAgent();
    const suite = agent.generateTestSuite({
      filePath: "src/calculator.js",
      codeContent: sampleCode,
    });

    assert.strictEqual(suite.testFileName, "calculator.auto.test.js");
    assert.ok(suite.testContent.includes('describe("Auto-Generated Tests: calculator"'));
    assert.ok(suite.testContent.includes("instantiates CalculatorService correctly"));
    assert.ok(suite.testContent.includes("executes add"));
    assert.ok(suite.testContent.includes("executes multiply"));
  });

  test("saves generated test suite and executes it successfully", () => {
    const agent = new TestGeneratorAgent();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-testgen-"));

    const suite = agent.generateTestSuite({
      filePath: "sample.js",
      codeContent: "function hello() { return 'world'; }",
    });

    const testFilePath = path.join(tmpDir, "sample.auto.test.js");
    const result = agent.saveAndRunTest({
      projectRoot: tmpDir,
      testFilePath,
      testContent: suite.testContent,
    });

    assert.strictEqual(result.passed, true);
    assert.ok(fs.existsSync(testFilePath));
    assert.ok(result.output.includes("pass") || result.output.includes("✔") || result.output.includes("completed"));

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("generates test suites for a list of code patches", () => {
    const agent = new TestGeneratorAgent();
    const patches = [
      { filePath: "runtime/auth.js", content: "function login() {} function logout() {}" },
      { filePath: "runtime/db.js", content: "class DatabaseClient {}" },
    ];

    const generated = agent.generateTestsForPatches(patches);
    assert.strictEqual(generated.length, 2);
    assert.strictEqual(generated[0].sourceFile, "runtime/auth.js");
    assert.strictEqual(generated[1].sourceFile, "runtime/db.js");
  });
});
