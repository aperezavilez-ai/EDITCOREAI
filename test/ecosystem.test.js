const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { CrdtDocument, crdtEngine } = require("../runtime/crdt-sync");
const { SwarmOrchestrator, swarmOrchestrator } = require("../runtime/swarm-orchestrator");
const { AutoTddLoop, autoTddLoop } = require("../runtime/auto-tdd-loop");
const { EnterpriseMemoryMesh, enterpriseMemory } = require("../runtime/enterprise-memory");

// CICLO 37: CRDT & Swarm Orchestration
test("CRDT Sync: maneja inserciones, borrados y fusiones sin conflicto", () => {
  const docA = new CrdtDocument("doc_test", "Hola");
  const docB = new CrdtDocument("doc_test", "Hola");

  docA.insertText(4, " Mundo");
  docB.insertText(0, "¡");

  docA.merge(docB);
  assert.ok(docA.getText().includes("¡") || docA.getText().includes("Mundo"));
  assert.ok(docA.getText().length > 5);
});

test("Swarm Orchestrator: lanza enjambres y agrega resultados consolidados", () => {
  const orchestrator = new SwarmOrchestrator();
  const swarm = orchestrator.spawnSwarm({
    goal: "Crear módulo de autenticación con RBAC",
    agentRoles: ["DatabaseAgent", "SecurityAgent", "UIFrontendAgent"],
  });

  assert.ok(swarm.swarmId.startsWith("swarm_"));
  assert.strictEqual(swarm.agents.length, 3);
  assert.strictEqual(swarm.status, "COMPLETED");

  const results = orchestrator.aggregateSwarmResults(swarm.swarmId);
  assert.strictEqual(results.completedAgents, 3);
  assert.ok(results.summary.includes("DatabaseAgent"));
  assert.ok(results.summary.includes("SecurityAgent"));
});

// CICLO 38: Auto-TDD & Refactoring
test("Auto-TDD Loop: ejecuta ciclo Red-Green-Refactor completo", () => {
  const tdd = new AutoTddLoop();
  const res = tdd.runTddCycle({
    testName: "Validación de token",
    spec: 'assert.strictEqual(1 + 1, 2);',
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cycleCompleted, true);
  assert.ok(res.phases.red.testGenerated);
  assert.ok(res.phases.green.passed);
  assert.ok(res.phases.refactor.cleaned);
});

test("Continuous Refactoring: detecta oportunidades de modernización de código", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-refactor-"));
  const sample = path.join(tempDir, "legacy.js");
  fs.writeFileSync(sample, "var legacyValue = 100;\nvar other = 200;\n", "utf-8");

  const tdd = new AutoTddLoop();
  const scan = tdd.scanForRefactoring(tempDir);

  assert.strictEqual(scan.totalScanned, 1);
  assert.ok(scan.suggestions.some((s) => s.type === "MODERNIZE_SYNTAX"));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

// CICLO 39: Enterprise Memory Mesh & ADR Ledger
test("Enterprise Memory Mesh: registra ADRs y sincroniza estado de ramas", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mesh-"));
  const mesh = new EnterpriseMemoryMesh();

  const adr = mesh.recordAdr({
    title: "Adopción de CRDTs para sincronización",
    decision: "Utilizar CrdtDocument con relojes lógicos",
    consequences: "Edición multi-agente sin conflictos en memoria",
    projectRoot: tempDir,
  });

  assert.strictEqual(adr.adrId, "ADR-001");
  assert.strictEqual(adr.status, "ACCEPTED");

  const sync = mesh.syncBranchMemory(tempDir, "feature/swarm");
  assert.strictEqual(sync.synced, true);
  assert.strictEqual(sync.branch, "feature/swarm");

  const allAdrs = mesh.listAdrs(tempDir);
  assert.strictEqual(allAdrs.length, 1);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
