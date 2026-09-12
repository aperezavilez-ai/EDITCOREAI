"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  writeFileBatch,
  scaffoldProject,
  manageProcess,
  verifyProjectHealth,
  orchestrateProjectBuild,
} = require("./agent-tools-suite");

test("write_file_batch escribe multiples archivos atomicamente", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-test-batch-"));
  const res = writeFileBatch(tmpDir, [
    { path: "src/index.ts", content: "console.log('hello');" },
    { path: "README.md", content: "# Test" },
  ]);

  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(fs.readFileSync(path.join(tmpDir, "src/index.ts"), "utf8"), "console.log('hello');");
  assert.equal(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8"), "# Test");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("scaffold_project genera plantillas Next.js y FastAPI", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-test-scaffold-"));
  
  const nextRes = scaffoldProject(path.join(tmpDir, "next-app"), { template: "nextjs", name: "mi-next-app" });
  assert.equal(nextRes.ok, true);
  assert.equal(fs.existsSync(path.join(tmpDir, "next-app/package.json")), true);
  assert.equal(fs.existsSync(path.join(tmpDir, "next-app/src/app/page.tsx")), true);

  const pyRes = scaffoldProject(path.join(tmpDir, "py-app"), { template: "fastapi", name: "mi-fastapi-app" });
  assert.equal(pyRes.ok, true);
  assert.equal(fs.existsSync(path.join(tmpDir, "py-app/requirements.txt")), true);
  assert.equal(fs.existsSync(path.join(tmpDir, "py-app/main.py")), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("verifyProjectHealth evalua la salud del proyecto", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-test-health-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));

  const health = verifyProjectHealth(tmpDir);
  assert.equal(health.ok, false); // missing node_modules
  assert.equal(health.issuesCount > 0, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("orchestrateProjectBuild ejecuta el flujo guiado", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-test-orch-"));
  
  const res = orchestrateProjectBuild(tmpDir, { template: "vite-react-ts", name: "test-orch" });
  assert.equal(res.ok, true);
  assert.equal(res.phase, "orchestrated_completion");
  assert.equal(Array.isArray(res.recommendedNextSteps), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
