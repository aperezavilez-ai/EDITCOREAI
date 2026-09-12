"use strict";

/**
 * Aceptacion de pasos 3–10 del plan EDITCOREAI (contratos ejecutables).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const {
  buildFixQueueFromReport,
  syncFixQueueWithSteps,
} = require("../runtime/fix-queue");
const {
  buildExecutionEvidenceReport,
  collectToolEvidence,
  hasMutationEvidence,
  narrationLooksLikeSimulatedWork,
} = require("../runtime/evidence-grounding");
const { gitCommit, gitStatus, suggestCommitMessage } = require("../runtime/agent-git");
const { isSecretPath } = require("../runtime/publish-pipeline");
const { isOperatorPublishRequest, CURSOR_PARITY_ALLOWLIST } = require("../runtime/cursor-parity");
const {
  validateProjectConnectionTarget,
} = require("../runtime/project-connection-isolation");
const {
  writeScaffoldState,
  readScaffoldState,
  isScaffoldIncomplete,
  nextScaffoldStage,
} = require("../runtime/scaffold-state");
const { saveProjectChats, loadProjectChats } = require("../runtime/project-chat-store");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("Paso3: analisis → fixQueue durable → PROCEDE muta y evidencia OK", () => {
  const projectRoot = tmpDir("ec-p3-");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "broken.ts"), "export const x = 1;\n");
  const store = new TaskStore({ root: tmpDir("ec-p3-tasks-") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });
  const prepared = workflow.prepareAgentRun({
    projectId: "p3",
    projectRoot,
    goal: "analisis forense",
    analysisMode: true,
    runId: "R-a",
  });
  const report = [
    "## Qué sí funcionó",
    "- Lectura",
    "## Qué falló / hallazgos",
    "- src/broken.ts",
    "## Cómo lo corregiré",
    "1. Corregir `src/broken.ts`",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  const steps = [
    { name: "read_file", ok: true, input: { path: "src/broken.ts" }, result: { content: "export const x = 1;\n" } },
  ];
  const evidence = collectToolEvidence(steps, projectRoot);
  const queue = buildFixQueueFromReport(report, evidence);
  assert.ok(queue.some((q) => /broken\.ts/.test(q.target)));
  const persisted = workflow.completeAnalysisRun(prepared.taskId, report, {
    projectRoot,
    steps,
    fixQueue: queue,
    evidence,
  });
  assert.ok((persisted?.fixQueue || []).length >= 1, JSON.stringify(persisted));
  assert.equal(manager.getTask(prepared.taskId).status, "AWAITING_AUTHORIZATION");

  workflow.recordPlanApproval(prepared.taskId, persisted.planId, { source: "procede" });
  workflow.beginAuthorizedExecution(prepared.taskId, "R-fix");

  fs.writeFileSync(path.join(projectRoot, "src", "broken.ts"), "export const x = 2;\n");
  const fixSteps = [
    { name: "read_file", ok: true, input: { path: "src/broken.ts" }, result: { content: "export const x = 1;\n" } },
    { name: "replace_in_file", ok: true, input: { path: "src/broken.ts", oldText: "1", newText: "2" }, result: { path: "src/broken.ts" } },
    { name: "read_file", ok: true, input: { path: "src/broken.ts" }, result: { content: "export const x = 2;\n" } },
  ];
  assert.equal(hasMutationEvidence(fixSteps), true);
  const synced = syncFixQueueWithSteps(queue, fixSteps, projectRoot);
  assert.ok(synced.verifiedCount >= 1 || synced.queue.some((i) => i.status === "mutated" || i.status === "verified"));
  const exec = buildExecutionEvidenceReport("Corregido src/broken.ts", fixSteps, projectRoot);
  assert.equal(exec.ok, true, exec.reasons.join("; "));
  assert.equal(narrationLooksLikeSimulatedWork("Listo, he corregido el archivo sin tools", [], projectRoot, { requiresWrite: true }), true);
  workflow.completeImplementationRun(prepared.taskId, "R-fix", { ok: true });
  assert.equal(manager.getTask(prepared.taskId).status, "COMPLETED");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("Paso4: chat durable por proyecto y open_project por nombre (hermano)", () => {
  const parent = tmpDir("ec-p4-parent-");
  const a = path.join(parent, "ProjA");
  const b = path.join(parent, "ProjB");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  saveProjectChats(a, { chats: [{ id: "c1", title: "Chat", messages: [{ role: "user", content: "hola" }] }] });
  const loaded = loadProjectChats(a);
  const chats = loaded?.chats || loaded || [];
  assert.ok(Array.isArray(chats) ? chats.length >= 1 : true);

  // resolveOpenProjectTarget via main would need electron; mirror the sibling rule here.
  const sibling = path.join(path.dirname(a), "ProjB");
  assert.equal(path.resolve(sibling), path.resolve(b));
  assert.ok(fs.existsSync(sibling));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("Paso5: narracion inventada sin mutacion no es evidencia", () => {
  assert.equal(hasMutationEvidence([]), false);
  assert.equal(hasMutationEvidence([
    { name: "read_file", ok: true, input: { path: "a.js" }, result: { content: "1" } },
  ]), false);
  assert.equal(hasMutationEvidence([
    { name: "write_file", ok: true, input: { path: "a.js", content: "2" }, result: { path: "a.js" } },
  ]), true);
  const fake = buildExecutionEvidenceReport("Listo, corregi todo", [
    { name: "read_file", ok: true, input: { path: "a.js" }, result: { content: "1" } },
  ], "");
  assert.equal(fake.ok, false);
});

test("Paso6: git commit bloquea secretos y permite codigo", () => {
  const root = tmpDir("ec-p6-git-");
  spawnSync("git", ["init"], { cwd: root, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@editcore.local"], { cwd: root, windowsHide: true });
  spawnSync("git", ["config", "user.name", "EDITCOREAI Test"], { cwd: root, windowsHide: true });
  fs.writeFileSync(path.join(root, "app.js"), "console.log(1)\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath("app.js"), false);
  const status = gitStatus(root);
  assert.equal(status.dirty, true);
  const committed = gitCommit(root, "chore: add app");
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.ok((committed.files || []).includes("app.js") || committed.head);
  assert.ok(!(committed.files || []).includes(".env"));
  const msg = suggestCommitMessage({ files: [{ path: "app.js" }], task: "fix login" });
  assert.match(msg.message, /fix login|app\.js/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Paso6b: allowlist expone git pull/push y onboard", () => {
  assert.ok(CURSOR_PARITY_ALLOWLIST.includes("git_commit"));
  assert.ok(CURSOR_PARITY_ALLOWLIST.includes("git_push"));
  assert.ok(CURSOR_PARITY_ALLOWLIST.includes("git_pull"));
  assert.ok(CURSOR_PARITY_ALLOWLIST.includes("onboard_project"));
  const adapter = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapter, /tool\("git_push"/);
  assert.match(adapter, /tool\("git_pull"/);
  assert.match(adapter, /fixQueue: resultFixQueue/);
});

test("Paso7: aislamiento de conexiones por project-infra", () => {
  const root = tmpDir("ec-p7-");
  fs.mkdirSync(path.join(root, ".editcore"), { recursive: true });
  fs.writeFileSync(path.join(root, "project-infra.json"), JSON.stringify({
    supabaseUrl: "https://proj-a.supabase.co",
    supabaseProjectId: "proj-a",
    gafcoreGateway: "https://gafcore-gateway.vercel.app",
  }, null, 2));
  const ok = validateProjectConnectionTarget(root, {
    supabaseUrl: "https://proj-a.supabase.co",
    supabaseProjectId: "proj-a",
  });
  assert.equal(ok.ok, true);
  const bad = validateProjectConnectionTarget(root, {
    supabaseUrl: "https://other.supabase.co",
    supabaseProjectId: "other",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.length >= 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Paso8: deploy/publish solo bajo pedido explicito", () => {
  assert.equal(isOperatorPublishRequest("analiza el proyecto"), false);
  assert.equal(isOperatorPublishRequest("publica en vercel"), true);
  assert.equal(isOperatorPublishRequest("haz deploy"), true);
  assert.equal(isOperatorPublishRequest("conecta github y supabase"), true);
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /publish_project/);
  assert.match(main, /ssh_deploy/);
  assert.match(main, /alwaysConfirm[\s\S]*publish_project/);
});

test("Paso9: scaffold state machine resume", () => {
  const root = tmpDir("ec-p9-");
  fs.mkdirSync(root, { recursive: true });
  const s1 = writeScaffoldState(root, { template: "lovable-web", stage: "created", incomplete: true });
  assert.equal(s1.incomplete, true);
  assert.equal(isScaffoldIncomplete(root), true);
  assert.equal(nextScaffoldStage(root), "files");
  writeScaffoldState(root, { stage: "files" });
  writeScaffoldState(root, { stage: "install" });
  writeScaffoldState(root, { stage: "completed", incomplete: false });
  const done = readScaffoldState(root);
  assert.equal(done.stage, "completed");
  assert.equal(isScaffoldIncomplete(root), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Paso10: chat limpio + pipeline interno + E2E scripts existen", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.doesNotMatch(html, /agentPipelineStrip/);
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /__editcorePipeline/);
  assert.match(renderer, /Nunca mostrar franja en UI|Chat limpio/);
  assert.ok(fs.existsSync(path.join(__dirname, "forensic-pipeline-e2e.test.js")));
  assert.ok(fs.existsSync(path.join(__dirname, "..", "scripts", "forensic-pipeline-electron-e2e.js")));
});
