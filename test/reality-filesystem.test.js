"use strict";

/**
 * Tests de REALIDAD: filesystem real + tool evidence.
 * No aceptan narracion del modelo como prueba de correccion.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
const { ActionRegistry } = require("../runtime/action-registry");
const { WorkflowOrchestrator } = require("../runtime/workflow-orchestrator");
const { TaskStore } = require("../runtime/task-store");
const { TaskManager } = require("../runtime/task-manager");
const {
  collectToolEvidence,
  verifyMutationsOnDisk,
  hasMutationEvidence,
  buildExecutionEvidenceReport,
} = require("../runtime/evidence-grounding");

const REALITY_TOKEN = "EDITCORE_REAL_PROJECT_TEST_839271";
const BUG_APP = "function suma(a, b) {\n  return a - b;\n}\n";
const FIXED_APP = "function suma(a, b) {\n  return a + b;\n}\n";

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

function toolCall(name, input) {
  return {
    id: `call_${name}_${Math.random().toString(16).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(input || {}) },
  };
}

function createRealityProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-reality-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "editcore-reality-test",
    version: "1.0.0",
    private: true,
    scripts: { test: "node -e \"require('./src/app.js')\"" },
  }, null, 2));
  fs.writeFileSync(path.join(root, "src", "app.js"), BUG_APP, "utf8");
  fs.writeFileSync(path.join(root, "REALITY_CHECK.txt"), `${REALITY_TOKEN}\n`, "utf8");
  return root;
}

function makeFsExecutor(projectRoot, { corruptWrite = false } = {}) {
  return {
    async execute(name, input = {}) {
      const rel = String(input.path || "").replace(/^[/\\]+/, "");
      const absolute = rel ? path.resolve(projectRoot, rel) : projectRoot;
      const relative = path.relative(projectRoot, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Ruta fuera del proyecto temporal");
      }
      if (name === "list_files") {
        const target = rel ? absolute : projectRoot;
        const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
          path: rel ? path.join(rel, entry.name).replace(/\\/g, "/") : entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }));
        return { entries };
      }
      if (name === "search_files") {
        const query = String(input.query || "");
        const hits = [];
        const walk = (dir, prefix = "") => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const next = path.join(dir, entry.name);
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(next, relPath);
            else {
              const text = fs.readFileSync(next, "utf8");
              if (text.includes(query) || relPath.includes(query)) hits.push({ path: relPath, preview: text.slice(0, 120) });
            }
          }
        };
        walk(projectRoot);
        return { hits };
      }
      if (name === "read_file") {
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
          throw new Error(`ENOENT: ${rel}`);
        }
        return { path: rel.replace(/\\/g, "/"), content: fs.readFileSync(absolute, "utf8"), isDirectory: false };
      }
      if (name === "write_file") {
        if (!corruptWrite) {
          fs.mkdirSync(path.dirname(absolute), { recursive: true });
          fs.writeFileSync(absolute, String(input.content || ""), "utf8");
        }
        return { path: rel.replace(/\\/g, "/"), bytes: Buffer.byteLength(String(input.content || "")), ok: true };
      }
      if (name === "replace_in_file") {
        const current = fs.readFileSync(absolute, "utf8");
        const oldText = String(input.oldText || "");
        const newText = String(input.newText || "");
        if (!current.includes(oldText)) throw new Error("oldText no existe");
        if (!corruptWrite) {
          fs.writeFileSync(absolute, current.replace(oldText, newText), "utf8");
        }
        return { path: rel.replace(/\\/g, "/"), ok: true };
      }
      if (name === "run_command") {
        return { output: "ok", code: 0 };
      }
      if (name === "project_discovery") {
        return {
          summary: "node project",
          files: ["package.json", "src/app.js", "REALITY_CHECK.txt"],
          roots: ["src"],
        };
      }
      throw new Error(`Herramienta inesperada: ${name}`);
    },
  };
}

function makeAdapter(responses, executor) {
  const adapter = new EditCoreClaudeAdapter({
    maxIterations: 24,
    tokenBudget: 200_000,
    logger: silentLogger(),
  });
  adapter.actionRegistry = new ActionRegistry();
  const queue = [...responses];
  adapter.providerApi = {
    call: async () => {
      if (!queue.length) return { text: JSON.stringify({ type: "final", text: "Sin mas acciones" }), toolCalls: [], usage: { total_tokens: 1 } };
      return queue.shift();
    },
  };
  adapter.toolExecutor = executor;
  return adapter;
}

test("REALITY 1: analisis lee app.js, detecta suma, NO escribe, deja plan con evidencia", async (t) => {
  const projectRoot = createRealityProject(t);
  const before = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
  assert.equal(before, BUG_APP);

  const adapter = makeAdapter([
    { text: "", toolCalls: [toolCall("list_files", { path: "" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("search_files", { query: "suma" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "package.json" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "src/app.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "REALITY_CHECK.txt" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "## Análisis\nRevisado.\nCuando autorices procedo con las correcciones." }), usage: { total_tokens: 5 } },
  ], makeFsExecutor(projectRoot));

  const result = await adapter.executeTask({
    prompt: "Analiza este proyecto, encuentra el error de suma y prepara las correcciones.",
    projectRoot,
    allowWrite: false,
    analysisMode: true,
    requireEvidence: true,
    enforceController: true,
    maxIterations: 20,
  });

  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.ok(result.steps.some((step) => step.name === "list_files" && step.ok !== false));
  assert.ok(result.steps.some((step) => step.name === "search_files" && step.ok !== false));
  const appRead = result.steps.find((step) => step.name === "read_file" && String(step.input?.path || "").includes("app.js"));
  assert.ok(appRead, "debe existir read_file real de src/app.js");
  assert.match(String(appRead.result?.content || ""), /return a - b/);
  assert.match(result.text, /suma|a - b|Evidencia real/i);
  assert.match(result.text, /Cuando autorices procedo/);
  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8"), BUG_APP, "analisis no debe escribir");
  assert.ok(!hasMutationEvidence(result.steps));
});

test("REALITY 2: procede muta app.js en disco y verifica (BEFORE/AFTER)", async (t) => {
  const projectRoot = createRealityProject(t);
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-wf-"));
  t.after(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
  const store = new TaskStore({ root: path.join(storeRoot, "tasks") });
  const manager = new TaskManager({ store });
  const workflow = new WorkflowOrchestrator({ manager });

  const analysis = workflow.prepareAgentRun({
    projectId: "reality",
    projectRoot,
    goal: "Analiza y corrige suma",
    prompt: "Analiza este proyecto, encuentra el error de suma y prepara las correcciones.",
    analysisMode: true,
  });
  const plan = workflow.completeAnalysisRun(analysis.taskId, [
    "## Análisis del proyecto",
    "src/app.js tiene return a - b",
    "## Cómo lo corregiré",
    "1. Corregir src/app.js",
    "   evidencia: read_file(src/app.js)",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n"));
  const approval = workflow.recordPlanApproval(analysis.taskId, plan.planId, {
    authorizationText: "Procede con todas las correcciones.",
  });
  const execution = workflow.prepareAgentRun({
    taskId: analysis.taskId,
    projectId: "reality",
    projectRoot,
    prompt: "Procede con todas las correcciones.",
    analysisMode: false,
    planAuthorized: true,
    planId: plan.planId,
    approvalId: approval.approval?.approvalId || approval.approvalId,
    runId: "run-reality-1",
    executionMode: "AUTHORIZED_PLAN",
  });

  assert.equal(execution.taskId, analysis.taskId);
  assert.equal(execution.planId, plan.planId);
  assert.equal(execution.approvalId, approval.approval?.approvalId || execution.approvalId);
  assert.equal(execution.analysisMode, false);
  assert.equal(execution.planAuthorized, true);

  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8"), BUG_APP);

  const adapter = makeAdapter([
    { text: "", toolCalls: [toolCall("read_file", { path: "src/app.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "src/app.js", oldText: "return a - b;", newText: "return a + b;" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "src/app.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm test" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido y verificado" }), usage: { total_tokens: 5 } },
  ], makeFsExecutor(projectRoot));

  const result = await adapter.executeTask({
    prompt: "Procede con todas las correcciones.\n\nPLAN:\nCorregir src/app.js evidencia read_file(src/app.js)",
    projectRoot,
    allowWrite: true,
    analysisMode: false,
    planAuthorized: true,
    requireEvidence: true,
    enforceController: true,
    taskId: execution.taskId,
    maxIterations: 20,
  });

  const after = fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8");
  assert.equal(result.completed, true, `${result.stopReason}\n${result.text}`);
  assert.ok(hasMutationEvidence(result.steps));
  assert.equal(after, FIXED_APP, "AFTER debe ser return a + b en disco");
  assert.match(result.text, /Evidencia de correccion|src\/app\.js/);
  const disk = verifyMutationsOnDisk(result.steps, projectRoot);
  assert.equal(disk.ok, true, disk.failures.join("; "));

  workflow.completeImplementationRun(execution.taskId, "run-reality-1", { ok: true });
  const task = manager.getTask(execution.taskId);
  assert.equal(task.status, "COMPLETED");
});

test("REALITY 3: REALITY_CHECK.txt solo es valido con read_file real", async (t) => {
  const projectRoot = createRealityProject(t);
  const adapter = makeAdapter([
    { text: "", toolCalls: [toolCall("read_file", { path: "REALITY_CHECK.txt" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: `Contiene: ${REALITY_TOKEN}` }), usage: { total_tokens: 5 } },
  ], makeFsExecutor(projectRoot));

  const result = await adapter.executeTask({
    prompt: "Lee REALITY_CHECK.txt y dime exactamente qué contiene.",
    projectRoot,
    allowWrite: false,
    analysisMode: false,
    requireEvidence: true,
    enforceController: true,
    maxIterations: 8,
  });

  const readStep = result.steps.find((step) => step.name === "read_file" && /REALITY_CHECK/.test(String(step.input?.path || "")));
  assert.ok(readStep, "debe existir tool read_file sobre REALITY_CHECK.txt");
  assert.match(String(readStep.result?.content || ""), new RegExp(REALITY_TOKEN));
  assert.match(result.text, new RegExp(REALITY_TOKEN));
});

test("REALITY 4: modelo solo narra tras PROCEDE => NO COMPLETED", async (t) => {
  const projectRoot = createRealityProject(t);
  const adapter = makeAdapter([
    { text: "ACCIÓN 1: corregir src/app.js\nEl archivo ha sido corregido.", toolCalls: [], usage: { total_tokens: 5 } },
    { text: "ACCIÓN 2: ya termine las correcciones.", toolCalls: [], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Corregido sin tools" }), usage: { total_tokens: 5 } },
  ], makeFsExecutor(projectRoot));

  const result = await adapter.executeTask({
    prompt: "Procede con todas las correcciones.",
    projectRoot,
    allowWrite: true,
    analysisMode: false,
    planAuthorized: true,
    requireEvidence: true,
    enforceController: true,
    maxIterations: 6,
  });

  assert.equal(result.completed, false);
  assert.ok(!hasMutationEvidence(result.steps));
  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8"), BUG_APP);
  assert.match(String(result.stopReason || result.text), /mutacion|narracion|escritura|autorizad|repetio|herramientas/i);
});

test("REALITY 5: write_file success falso (disco no cambia) => NO COMPLETED", async (t) => {
  const projectRoot = createRealityProject(t);
  const adapter = makeAdapter([
    { text: "", toolCalls: [toolCall("read_file", { path: "src/app.js" })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("write_file", { path: "src/app.js", content: FIXED_APP })], usage: { total_tokens: 5 } },
    { text: "", toolCalls: [toolCall("read_file", { path: "src/app.js" })], usage: { total_tokens: 5 } },
    { text: JSON.stringify({ type: "final", text: "Escrito y verificado" }), usage: { total_tokens: 5 } },
  ], makeFsExecutor(projectRoot, { corruptWrite: true }));

  const result = await adapter.executeTask({
    prompt: "Procede con todas las correcciones.",
    projectRoot,
    allowWrite: true,
    analysisMode: false,
    planAuthorized: true,
    requireEvidence: true,
    enforceController: true,
    maxIterations: 10,
  });

  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8"), BUG_APP);
  const report = buildExecutionEvidenceReport(result.text, result.steps, projectRoot);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.some((reason) => /disco|verificacion|mutacion|confirma/i.test(reason)));
  const diskStrict = verifyMutationsOnDisk(result.steps, projectRoot, { strictDisk: true });
  assert.equal(diskStrict.ok, false);
  assert.equal(result.completed, false);
});

test("REALITY 6: proyecto pequeno (1 archivo fuente) no exige 3 lecturas arbitrarias", () => {
  const evidence = collectToolEvidence([
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: [{ path: "app.js", kind: "file" }] } },
    { name: "read_file", ok: true, input: { path: "app.js" }, result: { content: "module.exports = 1;\n", isDirectory: false } },
  ], "/tmp/small");
  assert.equal(evidence.requiredConcreteReads, 1);
  assert.equal(evidence.realFileReadCount, 1);
  assert.equal(require("../runtime/evidence-grounding").analysisEvidenceSufficient(evidence).ok, true);
});
