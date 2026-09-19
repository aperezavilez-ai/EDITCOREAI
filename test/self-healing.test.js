const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { SelfHealingAgent, selfHealingAgent } = require("../runtime/self-healing-agent");
const { agentPlanner } = require("../runtime/agent-planner");

test("SelfHealingAgent: parseError extrae tipo, mensaje, fichero y línea de un stack trace", () => {
  const agent = new SelfHealingAgent();
  const stackTrace = `
ReferenceError: activeUser is not defined
    at loginHandler (src/auth.js:42:15)
    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)
    at next (node_modules/express/lib/router/route.js:144:13)
  `;

  const parsed = agent.parseError(stackTrace);

  assert.strictEqual(parsed.type, "ReferenceError");
  assert.ok(parsed.message.includes("activeUser is not defined"));
  assert.strictEqual(parsed.filePath, "src/auth.js");
  assert.strictEqual(parsed.line, 42);
  assert.strictEqual(parsed.column, 15);
  assert.ok(parsed.stackFrames.length >= 2);
});

test("SelfHealingAgent: generateHeuristicPatch produce soluciones para ReferenceError y TypeError", () => {
  const agent = new SelfHealingAgent();

  const refError = {
    type: "ReferenceError",
    message: "token is not defined",
    line: 2,
  };
  const fileContent = "function authenticate() {\n  return token.validate();\n}";
  const refPatch = agent.generateHeuristicPatch(refError, fileContent);

  assert.ok(refPatch.suggestedPatch.includes("let token = null;"));
  assert.ok(refPatch.explanation.includes("token"));

  const typeError = {
    type: "TypeError",
    message: "cannot read property 'data' of undefined",
    line: 2,
  };
  const typePatch = agent.generateHeuristicPatch(typeError, fileContent);
  assert.ok(typePatch.suggestedPatch.includes("?."));
});

test("SelfHealingAgent: diagnoseError genera diagnósticos y planes en AgentPlanner", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-selfheal-"));
  const sampleFile = path.join(tempDir, "sample.js");
  fs.writeFileSync(sampleFile, "const x = 10;\nconst y = z + 1;\n", "utf-8");

  const agent = new SelfHealingAgent();
  const errorLog = `
ReferenceError: z is not defined
    at compute (${sampleFile}:2:11)
  `;

  const result = agent.diagnoseError(errorLog, tempDir);

  assert.ok(result.diagnosis);
  assert.ok(result.plan);
  assert.strictEqual(result.plan.status, "WAITING_FOR_APPROVAL");
  assert.ok(result.plan.targetFiles.length > 0);
  assert.strictEqual(result.diagnosis.parsedError.type, "ReferenceError");

  const recent = agent.getRecentDiagnoses(tempDir);
  assert.strictEqual(recent.length, 1);

  agent.clearDiagnoses(tempDir);
  assert.strictEqual(agent.getRecentDiagnoses(tempDir).length, 0);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
