"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { quantumCrypto } = require("../runtime/quantum-crypto");
const { neuralUiBuilder } = require("../runtime/neural-ui-builder");
const { ast3dVisualizer } = require("../runtime/ast-3d-visualizer");
const { ecosystemReplication } = require("../runtime/ecosystem-replication");
const { omegaCore } = require("../runtime/omega-core");

test("Ciclo 48: Criptografía Post-Cuántica (Quantum-Resistant Shield)", () => {
  const secret = "EDITCOREAI_TOP_SECRET_CODEBASE_KEY";
  const encrypted = quantumCrypto.encryptPayload(secret);
  assert.equal(encrypted.quantumShielded, true);
  assert.ok(encrypted.cipherText);

  const decrypted = quantumCrypto.decryptPayload(encrypted);
  assert.equal(decrypted, secret);

  const sig = quantumCrypto.signVectorEmbedding([0.123, 0.456, 0.789]);
  assert.equal(sig.verified, true);
  assert.ok(sig.signature.startsWith("dilithium_sig_"));
});

test("Ciclo 49: Generador Visual de Interfaces por Intención (Neural UI Builder)", () => {
  const comp = neuralUiBuilder.synthesizeComponent({
    prompt: "Formulario de login en modo oscuro",
    framework: "react",
    styleSystem: "tailwind",
  });
  assert.ok(comp.componentId);
  assert.ok(comp.code.includes("LoginForm"));
  assert.ok(comp.previewHtml.includes("Iniciar Sesión"));
});

test("Ciclo 50: Visualizador Espacial de Arquitectura 3D (AST 3D Visualizer)", () => {
  const mockNodes = [
    { id: "1", name: "AppController", type: "Class", file: "app.js", sideEffects: ["FS_WRITE"] },
    { id: "2", name: "getUserData", type: "Function", file: "user.js", sideEffects: [] },
  ];
  const mockEdges = [{ from: "1", to: "2", type: "calls" }];

  const layout = ast3dVisualizer.generate3dLayout(mockNodes, mockEdges);
  assert.equal(layout.totalNodes, 2);
  assert.equal(layout.totalEdges, 1);
  assert.ok(layout.nodes[0].position3d.x !== undefined);
  assert.ok(layout.nodes[0].color);
});

test("Ciclo 51: Auto-Replicación y Distribución Multiplataforma (Ecosystem Replication)", () => {
  const manifest = ecosystemReplication.generateBuildManifest({ target: "win32-x64", version: "4.0.0" });
  assert.ok(manifest.buildId);
  assert.equal(manifest.binaryName, "EDITCOREAI.exe");
  assert.equal(manifest.status, "READY_FOR_DEPLOYMENT");

  const matrix = ecosystemReplication.getReplicationMatrix();
  assert.ok(matrix.supportedTargets.length >= 5);
});

test("Ciclo 52: El Núcleo Omega - Gobernanza Simbiótica Universal", () => {
  const autonomy = omegaCore.setAutonomyLevel(4);
  assert.equal(autonomy.level, 4);
  assert.equal(autonomy.mode.name, "FULL_AUTONOMOUS");

  const actionCheck = omegaCore.evaluateActionSafety("WRITE_FILE", "HIGH");
  assert.equal(actionCheck.allowedImmediately, true);

  omegaCore.setAutonomyLevel(2);
  const strictCheck = omegaCore.evaluateActionSafety("SYSTEM_MUTATION", "HIGH");
  assert.equal(strictCheck.allowedImmediately, false);
  assert.equal(strictCheck.gate, "PLAN_FIRST_REQUIRED");

  const status = omegaCore.getOmegaStatus();
  assert.equal(status.status, "OMEGA_HORIZON_ACTIVE");
  assert.ok(status.activeSubsystems.length >= 8);
});
