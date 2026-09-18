"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { MultiAgentOrchestrator } = require("../runtime/multi-agent-orchestrator");
const { SmartDiff } = require("../runtime/smart-diff");
const { GitIntegration } = require("../runtime/git-integration");

describe("Ciclo 16 — Multi-Agent Orchestrator", () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new MultiAgentOrchestrator({
      workspace: process.cwd(),
    });
  });

  it("rechaza tareas vacías", async () => {
    const result = await orchestrator.run({ task: "   " });
    assert.strictEqual(result.ok, false);
    assert.ok(String(result.error || "").includes("Falta 'task'"));
  });

  it("ejecuta pipeline completo con plan, coder y reviewer", async () => {
    const result = await orchestrator.run({ task: "agregar log de depuración en runtime" });
    assert.strictEqual(result.ok, true);
    assert.ok(result.plan);
    assert.ok(Array.isArray(result.changes));
    assert.ok(result.review);
    assert.ok(result.review.status === "approved" || result.review.status === "approved_with_warnings");
  });

  it("el planner genera pasos estructurados", async () => {
    const plan = await orchestrator.agents.planner.plan({
      task: "refactorizar módulo de terminal",
      workspace: process.cwd(),
    });
    assert.strictEqual(plan.ok, true);
    assert.ok(Array.isArray(plan.plan.steps));
    assert.ok(plan.plan.steps.length >= 3);
  });

  it("el coder identifica archivos candidatos", async () => {
    const implementation = await orchestrator.agents.coder.implement({
      plan: {
        steps: [
          { id: "locate", description: "buscar archivos de runtime" },
        ],
      },
      workspace: process.cwd(),
    });
    assert.strictEqual(implementation.ok, true);
    assert.ok(Array.isArray(implementation.changes));
    assert.ok(implementation.changes.length > 0);
  });

  it("el reviewer aprueba cambios sin bloqueos", async () => {
    const review = await orchestrator.agents.reviewer.review({
      implementation: {
        changes: [
          { stepId: "locate", targetFile: "runtime/terminal-agent.js", status: "ready" },
        ],
      },
      workspace: process.cwd(),
    });
    assert.strictEqual(review.ok, true);
    assert.strictEqual(review.review.status, "approved");
    assert.strictEqual(review.applied, true);
  });

  it("el reviewer marca advertencias si hay archivos sin seleccionar", async () => {
    const review = await orchestrator.agents.reviewer.review({
      implementation: {
        changes: [
          { stepId: "locate", targetFile: null, status: "needs_manual_selection" },
        ],
      },
      workspace: process.cwd(),
    });
    assert.strictEqual(review.ok, true);
    assert.strictEqual(review.review.status, "approved_with_warnings");
    assert.strictEqual(review.applied, false);
  });
});

describe("Ciclo 16 — Smart Diff", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-smartdiff-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rechaza parches sin target", () => {
    const diff = new SmartDiff();
    const result = diff.apply({ patches: [{}], baseDir: tmpDir });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failedCount, 1);
  });

  it("aplica parche de contenido completo en archivo nuevo", () => {
    const diff = new SmartDiff();
    const target = "nuevo.js";
    const result = diff.apply({
      patches: [{ target, content: "// archivo generado\nconsole.log('ok');" }],
      baseDir: tmpDir,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appliedCount, 1);

    const written = fs.readFileSync(path.join(tmpDir, target), "utf8");
    assert.ok(written.includes("archivo generado"));
  });

  it("aplica parche de reemplazo en archivo existente", () => {
    const diff = new SmartDiff();
    const target = "existente.js";
    const original = "const x = 1;\nconst y = 2;\n";
    fs.writeFileSync(path.join(tmpDir, target), original, "utf8");

    const result = diff.apply({
      patches: [{ target, replace: "const y = 2;", with: "const y = 42;" }],
      baseDir: tmpDir,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appliedCount, 1);

    const written = fs.readFileSync(path.join(tmpDir, target), "utf8");
    assert.ok(written.includes("const y = 42;"));
    assert.ok(!written.includes("const y = 2;"));
  });

  it("crea backup antes de sobrescribir", () => {
    const diff = new SmartDiff();
    const target = "backup.js";
    const original = "// original\n";
    fs.writeFileSync(path.join(tmpDir, target), original, "utf8");

    const result = diff.apply({
      patches: [{ target, content: "// nuevo\n" }],
      baseDir: tmpDir,
    });
    assert.strictEqual(result.ok, true);

    const backupPath = path.join(tmpDir, target + ".editcore-backup");
    assert.ok(fs.existsSync(backupPath));
    const backupContent = fs.readFileSync(backupPath, "utf8");
    assert.strictEqual(backupContent, original);
  });

  it("rechaza parches con eval o new Function", () => {
    const diff = new SmartDiff();
    const target = "unsafe.js";
    const result = diff.apply({
      patches: [{ target, content: "eval('malicious');" }],
      baseDir: tmpDir,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failedCount, 1);
  });

  it("dryRun no escribe en disco", () => {
    const diff = new SmartDiff({ dryRun: true });
    const target = "dryrun.js";
    const result = diff.apply({
      patches: [{ target, content: "// dry\n" }],
      baseDir: tmpDir,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appliedCount, 0);
    assert.ok(!fs.existsSync(path.join(tmpDir, target)));
  });
});

describe("Ciclo 16 — Git Integration", () => {
  let git;

  beforeEach(() => {
    git = new GitIntegration({ cwd: process.cwd() });
  });

  it("devuelve estado del repositorio", async () => {
    const result = await git.status();
    assert.ok(result.ok || result.error);
    assert.ok(Array.isArray(result.changes));
  });

  it("genera mensaje de commit contextual", async () => {
    const result = await git.generateCommitMessage({ task: "integrar smart diff" });
    assert.strictEqual(result.ok, true);
    assert.ok(result.message);
    assert.ok(result.message.includes("ciclo16"));
    assert.ok(result.message.includes("smart diff"));
  });

  it("genera mensaje genérico si no hay tarea", async () => {
    const result = await git.generateCommitMessage({});
    assert.strictEqual(result.ok, true);
    assert.ok(result.message);
    assert.ok(result.message.includes("ciclo16"));
  });
});
