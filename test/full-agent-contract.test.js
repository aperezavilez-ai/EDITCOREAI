"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const grounding = require("../runtime/evidence-grounding");
const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");

const DIAG = [
  "MODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS",
  "Audita SOLO estos archivos:",
  "resources/app/runtime/editcore-claude-adapter.js",
  "resources/app/runtime/intent-orchestrator.js",
  "resources/app/runtime/evidence-grounding.js",
  "resources/app/runtime/action-registry.js",
  "PROHIBIDO .claude/*.md y ANALISIS_ERRORES_EDITCORE.md.",
].join("\n");

test("diagnostico de 4 archivos es named-file diagnostic", () => {
  assert.equal(grounding.isNamedFileDiagnosticPrompt(DIAG), true);
  const targets = grounding.extractAnalysisTargets(DIAG);
  assert.ok(targets.some((t) => /editcore-claude-adapter\.js$/i.test(t)));
  assert.ok(!targets.some((t) => /ANALISIS_ERRORES/i.test(t)));
  assert.ok(!targets.some((t) => /\.claude/i.test(t)));
});

test("PROHIBIDO ANALISIS_ERRORES no es target obligatorio", () => {
  const coverage = grounding.analysisTargetCoverage(DIAG, {
    filesRead: [
      { path: "resources/app/runtime/editcore-claude-adapter.js", content: "x".repeat(200) },
      { path: "resources/app/runtime/intent-orchestrator.js", content: "x".repeat(200) },
      { path: "resources/app/runtime/evidence-grounding.js", content: "x".repeat(200) },
      { path: "resources/app/runtime/action-registry.js", content: "x".repeat(200) },
    ],
    realFileReadCount: 4,
    listed: [],
  });
  assert.equal(coverage.missing.filter((m) => /ANALISIS|ROADMAP|\.claude/i.test(m)).length, 0);
});

test("Acceso total + PROCEDE → EXECUTE (no analisis eterno)", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "PROCEDE",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    planAuthorizedExecution: true,
    authorizedContinuation: true,
  });
  assert.equal(plan.analysisMode, false);
  assert.equal(plan.mode, "execute");
  assert.ok(plan.allowedTools.includes("write_file"));
});

test("Acceso total + diagnostico NO MODIFICAR → discover readonly", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: DIAG,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
  });
  assert.equal(plan.analysisMode, true);
  assert.ok(plan.allowedTools.includes("read_file"));
  assert.ok(!plan.allowedTools.includes("write_file"));
});

test("targets explicitos del prompt se pueden leer sin list_files previo", () => {
  const root = path.join(__dirname, "..", "..", ".."); // EDITCOREAI repo root
  const ledger = grounding.createDiscoveryLedger({
    projectRoot: root,
    explicitTargets: [
      "resources/app/runtime/editcore-claude-adapter.js",
      "resources/app/runtime/intent-orchestrator.js",
    ],
  });
  assert.doesNotThrow(() => ledger.assertReadable("resources/app/runtime/editcore-claude-adapter.js"));
  assert.doesNotThrow(() => ledger.assertReadable("editcore-claude-adapter.js"));
  assert.throws(() => ledger.assertReadable("resources/app/runtime/no-existe-xyz.js"));
});

test("adapter: ROADMAP no corta analisis; named diagnostic existe", () => {
  const src = fs.readFileSync(path.join(__dirname, "../runtime/editcore-claude-adapter.js"), "utf8");
  assert.match(src, /seedNamedDiagnosticTargets/);
  assert.match(src, /isNamedFileDiagnosticPrompt/);
  assert.match(src, /PROHIBIDO cerrar el analisis solo con ROADMAP/);
  assert.match(src, /permissionFullNow/);
  assert.match(src, /CONTRATO ACCESO TOTAL/);
  assert.doesNotMatch(src, /ROADMAP precargado\. Es el punto de partida/);
});
