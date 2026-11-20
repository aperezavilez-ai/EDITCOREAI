"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  TestGuardian,
  testGuardian,
} = require("../runtime/test-guardian");

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-guardian-test-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  
  // Package.json con script de test
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "guardian-test-proj", scripts: { test: "node --test" } }, null, 2),
    "utf8"
  );
  
  // Archivo fuente y archivo de test correspondiente
  fs.writeFileSync(path.join(root, "src", "math.js"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n", "utf8");
  fs.writeFileSync(
    path.join(root, "test", "math.test.js"),
    `const test = require("node:test");
const assert = require("node:assert/strict");
const { add } = require("../src/math");

test("add computes sum", () => {
  assert.equal(add(2, 3), 5);
});
`,
    "utf8"
  );
  return root;
}

test("TestGuardian: findRelevantTests identifies corresponding test files", () => {
  const root = makeTempProject();
  try {
    const guardian = new TestGuardian({ projectRoot: root });
    const tests = guardian.findRelevantTests(["src/math.js"]);
    assert.equal(tests.length >= 1, true);
    assert.match(tests[0], /math\.test\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TestGuardian: diagnoseFile detects JavaScript and TypeScript syntax errors", () => {
  const guardian = new TestGuardian();
  
  // Código válido
  const validJs = guardian.diagnoseFile("app.js", "const x = 10; function run() { return x * 2; }");
  assert.equal(validJs.ok, true);

  // Código con error de sintaxis JS
  const brokenJs = guardian.diagnoseFile("app.js", "const x = ; function run() {");
  assert.equal(brokenJs.ok, false);
  assert.match(brokenJs.message, /Unexpected|SyntaxError/i);

  // Código con error de sintaxis JSON
  const brokenJson = guardian.diagnoseFile("config.json", '{ "key": "value", }');
  assert.equal(brokenJson.ok, false);
});

test("TestGuardian: inspectHealth runs targeted tests and reports pass or failure", async () => {
  const root = makeTempProject();
  try {
    const guardian = new TestGuardian({ projectRoot: root });

    // 1. Estado inicial saludable
    const initialHealth = await guardian.inspectHealth(["src/math.js"]);
    assert.equal(initialHealth.ok, true);
    assert.equal(initialHealth.hasFailures, false);

    // 2. Romper intencionalmente la lógica
    fs.writeFileSync(path.join(root, "src", "math.js"), "function add(a, b) { return a - b; }\nmodule.exports = { add };\n", "utf8");
    const brokenHealth = await guardian.inspectHealth(["src/math.js"]);
    assert.equal(brokenHealth.ok, false);
    assert.equal(brokenHealth.hasFailures, true);
    assert.equal(brokenHealth.testFailures.length >= 1, true);

    // 3. Generar plan de auto-fix
    const autoFixPrompt = guardian.generateAutoFixPrompt(brokenHealth);
    assert.ok(autoFixPrompt);
    assert.match(autoFixPrompt, /math\.test\.js|math\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
