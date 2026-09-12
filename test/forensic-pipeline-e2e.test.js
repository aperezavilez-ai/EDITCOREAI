"use strict";

/**
 * E2E headless del circuito forense → plan durable → PROCEDE → mutacion verificada.
 * No requiere LLM ni ventana Electron (siempre corre en CI/local).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const {
  buildFixQueueFromReport,
  syncFixQueueWithSteps,
  buildFixQueueExecutionPrompt,
} = require("../runtime/fix-queue");
const { buildExecutionEvidenceReport, collectToolEvidence } = require("../runtime/evidence-grounding");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-forensic-e2e-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "forensic-e2e",
    scripts: { typecheck: "tsc --noEmit" },
  }, null, 2));
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true },
    include: ["src/**/*"],
  }, null, 2));
  fs.writeFileSync(path.join(root, "src", "broken.ts"), "export function suma(a: number, b: number) {\n  return a - b;\n}\n");
  fs.writeFileSync(path.join(root, "src", "ok.ts"), "export const ok = 1;\n");
  return root;
}

test("E2E forense→plan→PROCEDE→mutacion en disco (headless)", () => {
  const projectRoot = makeFixture();
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-tasks-e2e-"));
  const store = new TaskStore({ root: storeRoot });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });

  const analysis = workflow.prepareAgentRun({
    projectId: "e2e-forensic",
    projectRoot,
    goal: "analisis forense del proyecto y prepara correcciones",
    analysisMode: true,
    runId: "R-analysis",
  });
  assert.ok(analysis.taskId);
  assert.equal(analysis.analysisMode, true);

  const analysisSteps = [
    {
      name: "list_files",
      ok: true,
      input: { path: "" },
      result: {
        entries: [
          { path: "package.json", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "tsconfig.json", kind: "file" },
        ],
      },
    },
    {
      name: "list_files",
      ok: true,
      input: { path: "src" },
      result: {
        entries: [
          { path: "src/broken.ts", kind: "file" },
          { path: "src/ok.ts", kind: "file" },
        ],
      },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "package.json" },
      result: { content: fs.readFileSync(path.join(projectRoot, "package.json"), "utf8") },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "src/broken.ts" },
      result: { content: fs.readFileSync(path.join(projectRoot, "src", "broken.ts"), "utf8") },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "src/ok.ts" },
      result: { content: "export const ok = 1;\n" },
    },
    {
      name: "run_command",
      ok: true,
      input: { command: "npx tsc --noEmit" },
      result: { output: "src/broken.ts(2,3): error TS2322: Type 'number' is not assignable (demo)." },
    },
  ];

  const evidence = collectToolEvidence(analysisSteps, projectRoot);
  const report = [
    "## Qué sí funcionó",
    `- Proyecto: ${projectRoot}`,
    "## Mapa carpeta por carpeta",
    "- src",
    "## Qué falló / hallazgos",
    "- **src/broken.ts**: suma resta en lugar de sumar",
    "## Cómo lo corregiré",
    "1. Corregir `src/broken.ts` con replace_in_file (return a + b)",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");

  const queue = buildFixQueueFromReport(report, evidence);
  assert.ok(queue.some((item) => /broken\.ts/.test(item.target)), JSON.stringify(queue));

  const plan = workflow.completeAnalysisRun(analysis.taskId, report, {
    projectId: "e2e-forensic",
    projectRoot,
    steps: analysisSteps,
    fixQueue: queue,
  });
  assert.ok(plan.planId);
  assert.ok(Array.isArray(plan.fixQueue) && plan.fixQueue.length >= 1);
  assert.equal(manager.getTask(analysis.taskId).status, "AWAITING_AUTHORIZATION");

  const described = workflow.describeWorkflow(analysis.taskId);
  assert.equal(described.awaitingAuthorization, true);
  assert.ok((described.fixQueue || []).length >= 1);

  const exec = workflow.prepareAgentRun({
    taskId: analysis.taskId,
    planId: plan.planId,
    planAuthorized: true,
    executionMode: "AUTHORIZED_PLAN",
    prompt: "PROCEDE",
    runId: "R-fix",
  });
  assert.equal(exec.planAuthorized, true);
  assert.match(exec.durableTaskContext || "", /FIX_QUEUE_DURABLE|FOCO|Cola fixes/i);

  const focusPrompt = buildFixQueueExecutionPrompt(plan.fixQueue, report);
  assert.match(focusPrompt, /FOCO OBLIGATORIO|DISPATCHER/);

  // Mutacion real en disco del FOCO
  const brokenPath = path.join(projectRoot, "src", "broken.ts");
  const before = fs.readFileSync(brokenPath, "utf8");
  assert.match(before, /a\s*-\s*b/);
  const after = before.replace("a - b", "a + b");
  fs.writeFileSync(brokenPath, after, "utf8");

  const fixSteps = [
    {
      name: "read_file",
      ok: true,
      input: { path: "src/broken.ts" },
      result: { content: before },
    },
    {
      name: "replace_in_file",
      ok: true,
      input: { path: "src/broken.ts", oldText: "return a - b;", newText: "return a + b;" },
      result: { ok: true },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "src/broken.ts" },
      result: { content: after },
    },
    {
      name: "run_command",
      ok: true,
      input: { command: "npx tsc --noEmit" },
      result: { output: "" },
    },
  ];

  const synced = syncFixQueueWithSteps(plan.fixQueue, fixSteps, projectRoot);
  assert.ok(synced.verifiedCount >= 1, synced.summary);
  assert.match(fs.readFileSync(brokenPath, "utf8"), /a\s*\+\s*b/);

  const execReport = buildExecutionEvidenceReport("Corregido src/broken.ts", fixSteps, projectRoot, {
    requireDiagnosticVerify: true,
  });
  assert.equal(execReport.ok, true, execReport.reasons.join("; "));

  workflow.completeImplementationRun(analysis.taskId, "R-fix", { ok: true });
  assert.equal(manager.getTask(analysis.taskId).status, "COMPLETED");

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(storeRoot, { recursive: true, force: true });
});

test("pipeline forense es interno (sin franja visible en chat)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.doesNotMatch(html, /id="agentPipelineStrip"/);
  assert.doesNotMatch(html, /id="pipelineCoverage"/);
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(css, /\.agent-pipeline-strip[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.agent-plan-panel[\s\S]*display:\s*none\s*!important/);
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /updateAgentPipelineUi/);
  assert.match(renderer, /__editcorePipeline/);
  assert.match(renderer, /Nunca mostrar franja en UI|Chat limpio/);
});
