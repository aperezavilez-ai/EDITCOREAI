const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { ProactiveArchitect, proactiveArchitect } = require("../runtime/proactive-architect");

test("ProactiveArchitect: detecta variables de entorno faltantes y genera tarjeta", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-proactive-env-"));
  const appJs = path.join(tempDir, "app.js");
  fs.writeFileSync(appJs, 'const apiKey = process.env.MY_SECRET_API_KEY;\nconsole.log(apiKey);\n', 'utf-8');

  const architect = new ProactiveArchitect();
  const pulse = architect.scanWorkspace(tempDir);

  assert.ok(pulse.healthScore < 100);
  assert.strictEqual(pulse.findings.missingEnvVars.length, 1);
  assert.strictEqual(pulse.findings.missingEnvVars[0].varName, "MY_SECRET_API_KEY");

  const envCard = pulse.cards.find((c) => c.category === "env");
  assert.ok(envCard);
  assert.strictEqual(envCard.priority, "high");
  assert.ok(envCard.suggestedAction.includes(".env"));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("ProactiveArchitect: detecta mocks, stubs y TODOs en el código", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-proactive-mock-"));
  const serviceJs = path.join(tempDir, "service.js");
  fs.writeFileSync(
    serviceJs,
    `
    // TODO: Conectar a la base de datos real
    function fetchUsers() {
      const mockData = [{ id: 1, name: "Admin" }];
      return mockData;
    }
    function updateRecord() {
      throw new Error("Not implemented");
    }
    `,
    "utf-8"
  );

  const architect = new ProactiveArchitect();
  const pulse = architect.scanWorkspace(tempDir);

  assert.ok(pulse.findings.mocks.length >= 1);
  assert.ok(pulse.findings.incompleteCode.length >= 2);

  const mockCard = pulse.cards.find((c) => c.category === "mock");
  const todoCard = pulse.cards.find((c) => c.category === "quality");

  assert.ok(mockCard);
  assert.ok(todoCard);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("ProactiveArchitect: detecta dependencias no listadas en package.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-proactive-deps-"));
  const pkgJson = path.join(tempDir, "package.json");
  fs.writeFileSync(pkgJson, JSON.stringify({ name: "my-app", dependencies: {} }), "utf-8");

  const indexJs = path.join(tempDir, "index.js");
  fs.writeFileSync(indexJs, 'const express = require("express");\nconst app = express();\n', "utf-8");

  const architect = new ProactiveArchitect();
  const pulse = architect.scanWorkspace(tempDir);

  assert.strictEqual(pulse.findings.missingDeps.length, 1);
  assert.strictEqual(pulse.findings.missingDeps[0].pkgName, "express");

  const depsCard = pulse.cards.find((c) => c.category === "deps");
  assert.ok(depsCard);
  assert.ok(depsCard.actionPayload.command.includes("npm install express"));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("ProactiveArchitect: descarta tarjetas y mantiene caché del pulso", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-proactive-pulse-"));
  const testFile = path.join(tempDir, "main.js");
  fs.writeFileSync(testFile, 'const token = process.env.AUTH_TOKEN;\n', "utf-8");

  const architect = new ProactiveArchitect();
  const pulse = architect.scanWorkspace(tempDir);

  assert.ok(pulse.cards.length > 0);
  const cardId = pulse.cards[0].cardId;

  const dismissed = architect.dismissActionCard(tempDir, cardId);
  assert.strictEqual(dismissed, true);

  const cachedPulse = architect.getProjectPulse(tempDir);
  assert.strictEqual(cachedPulse.cards.find((c) => c.cardId === cardId).dismissed, true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
