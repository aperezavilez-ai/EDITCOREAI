"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SwarmOrchestrator, SWARM_ROLES } = require("../agent-core/swarm-orchestrator");

test("SwarmOrchestrator creates plans, runs parallel agents, and detects file collisions", async () => {
  const orchestrator = new SwarmOrchestrator({ projectRoot: process.cwd() });

  // 1. Crear plan de enjambre
  const plan = orchestrator.createSwarmPlan("Sistema de autenticación y panel", [
    { role: "ui_engineer", task: "Diseñar login modal", targetFiles: ["src/LoginModal.tsx"] },
    { role: "backend_engineer", task: "Crear endpoint /api/auth", targetFiles: ["src/api/auth.ts"] },
    { role: "qa_engineer", task: "Pruebas unitarias de login", targetFiles: ["src/LoginModal.test.tsx"] },
  ]);

  assert.ok(plan.id.startsWith("swarm_"));
  assert.equal(plan.agents.length, 3);
  assert.equal(plan.status, "ready");

  // 2. Comprobar colisiones (no debe haber colisiones)
  const noCollisions = orchestrator.detectFileCollisions(plan);
  assert.equal(noCollisions.hasCollisions, false);

  // 3. Ejecutar subagentes en paralelo
  const execution = await orchestrator.executeSwarm(plan.id, async (agent) => {
    // Simular trabajo asíncrono
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, fileCreated: agent.targetFiles[0] };
  });

  assert.equal(execution.ok, true);
  assert.equal(execution.status, "completed");
  assert.equal(execution.results.length, 3);

  // 4. Testear detección de colisiones cuando dos agentes tocan el mismo archivo
  const collidingPlan = orchestrator.createSwarmPlan("Refactor global", [
    { role: "ui_engineer", task: "Añadir botón en App.tsx", targetFiles: ["src/App.tsx"] },
    { role: "backend_engineer", task: "Añadir provider en App.tsx", targetFiles: ["src/App.tsx"] },
  ]);

  const collisions = orchestrator.detectFileCollisions(collidingPlan);
  assert.equal(collisions.hasCollisions, true);
  assert.equal(collisions.collisions[0].filePath, "src/App.tsx");
  assert.equal(collisions.collisions[0].agents.length, 2);
});
