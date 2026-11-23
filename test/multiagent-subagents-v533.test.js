"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { validateDelegateTasks, runDelegatedTasks, ROLES } = require("../runtime/tools/parallel-delegate");
const { runSubagent } = require("../runtime/subagent-runner");

test("MultiAgent v5.3.3: validateDelegateTasks accepts all specialist roles", () => {
  const rolesExpected = ["explorer", "analyst", "writer", "security", "database", "ui_ux", "devops", "verifier"];
  for (const r of rolesExpected) {
    assert.equal(ROLES.has(r), true, `El rol ${r} debe estar en el catálogo de ROLES`);
  }

  const { tasks, notes } = validateDelegateTasks([
    { role: "security", target: "src", question: "Auditar secretos" },
    { role: "database", target: "supabase", question: "Inspeccionar migraciones" },
    { role: "ui_ux", target: "src/components", question: "Revisar estilos" },
    { role: "devops", target: ".", question: "Revisar CI" },
    { role: "verifier", target: ".", question: "Verificar sintaxis" },
    { role: "explorer", target: "runtime", question: "Mapear runtime" },
    { role: "analyst", target: "package.json", question: "Analizar dependencias" },
  ]);

  assert.equal(tasks.length, 7);
  assert.equal(notes.length, 0);
});

test("MultiAgent v5.3.3: runDelegatedTasks executes tasks concurrently and returns aggregated report", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const result = await runDelegatedTasks({
    projectRoot,
    tasks: [
      { role: "security", target: "runtime", question: "Auditar seguridad en runtime" },
      { role: "verifier", target: "runtime/tools", question: "Verificar sintaxis" },
      { role: "devops", target: ".", question: "Verificar scripts" },
    ],
    runners: {
      security: async (t) => ({ ok: true, summary: "Sin vulnerabilidades detectadas en " + t.target }),
      verifier: async (t) => ({ ok: true, summary: "Sintaxis válida en " + t.target }),
      devops: async (t) => ({ ok: true, summary: "Scripts verificados en " + t.target }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.delegated, 3);
  assert.equal(result.completed, 3);
  assert.ok(result.text.includes("Delegación en paralelo: 3/3"));
  assert.ok(result.text.includes("SECURITY"));
  assert.ok(result.text.includes("VERIFIER"));
  assert.ok(result.text.includes("DEVOPS"));
});

test("MultiAgent v5.3.3: runSubagent executes specialist subagents without role degradation", async () => {
  const projectRoot = path.resolve(__dirname, "..");

  const secResult = await runSubagent(projectRoot, { role: "security", target: "runtime" });
  assert.equal(secResult.ok, true);
  assert.equal(secResult.degradedRole, undefined);
  assert.ok(typeof secResult.summary === "string");
  assert.ok(secResult.summary.includes("Auditoría de Ciberseguridad"));

  const dbResult = await runSubagent(projectRoot, { role: "database", target: "." });
  assert.equal(dbResult.ok, true);
  assert.equal(dbResult.degradedRole, undefined);
  assert.ok(typeof dbResult.summary === "string");
  assert.ok(dbResult.summary.includes("Diagnóstico de Base de Datos"));

  const verResult = await runSubagent(projectRoot, { role: "verifier", target: "runtime/tools" });
  assert.equal(verResult.ok, true);
  assert.equal(verResult.degradedRole, undefined);
  assert.ok(typeof verResult.summary === "string");
  assert.ok(verResult.summary.includes("Verificación de Integridad"));
});
