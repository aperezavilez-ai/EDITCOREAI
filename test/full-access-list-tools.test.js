"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveUnifiedAgentPlan,
  wantsExplicitFilesystemWork,
  isListOnlyRequest,
} = require("../runtime/intent-orchestrator");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");

test("Acceso completo + Agente lista rutas con herramientas (no chat vacio)", () => {
  for (const prompt of [
    "enlistame todo D:\\PROGRAMAS IA",
    "listar D:\\PROGRAMAS IA",
    "analiza el proyecto",
    "D:\\PROGRAMAS IA",
  ]) {
    const plan = resolveUnifiedAgentPlan({
      prompt,
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
      permissionMode: "full",
      cursorParityEnabled: true,
    });
    assert.equal(plan.usesProjectTools, true, `${prompt} => ${plan.mode} ${plan.reason}`);
    assert.notEqual(plan.mode, "chat", prompt);
  }
  assert.equal(wantsExplicitFilesystemWork("enlistame todo D:\\PROGRAMAS IA"), true);
  assert.equal(wantsExplicitFilesystemWork("listar D:\\PROGRAMAS IA"), true);
});

test("enlistar/listar es list-only; analizar no", () => {
  assert.equal(isListOnlyRequest("enlistame D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("enlistame todo D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("listar D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("analiza el proyecto"), false);
  assert.equal(isListOnlyRequest("enlistame y analiza cada proyecto"), false);

  const listPlan = resolveUnifiedAgentPlan({
    prompt: "enlistame D:\\PROGRAMAS IA",
    requestedAgent: true,
    projectOpen: false,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(listPlan.listOnly, true);
  assert.equal(listPlan.runProfile.listOnly, true);
  assert.deepEqual(listPlan.allowedTools, ["list_files"]);
  assert.match(listPlan.statusLabel, /Listando/i);

  const analyzePlan = resolveUnifiedAgentPlan({
    prompt: "analiza el proyecto",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(analyzePlan.listOnly, false);
});

test("list-only usa el agente: seed list_files + 1 turno de modelo (no respuesta programada)", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-list-only-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "Alpha"));
  fs.mkdirSync(path.join(root, "Beta"));
  fs.writeFileSync(path.join(root, "readme.txt"), "x", "utf8");

  const adapter = new EditCoreClaudeAdapter({ maxIterations: 18, logger: { log() {}, warn() {}, error() {} } });
  let providerCalls = 0;
  adapter.actionRegistry = { maxEntries: 10 };
  adapter.providerApi = {
    call: async () => {
      providerCalls += 1;
      return {
        text: `## Contenido\n- Alpha/\n- Beta/\n- readme.txt`,
        toolCalls: [],
        usage: { confirmed_input_tokens: 40, confirmed_output_tokens: 20, total_tokens: 60 },
      };
    },
  };
  adapter.toolExecutor = {
    execute: async (name, input = {}) => {
      assert.equal(name, "list_files");
      const target = String(input.path || root);
      const dir = path.isAbsolute(target) && fs.existsSync(target) ? target : root;
      return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        path: entry.name,
      }));
    },
  };

  const result = await adapter.executeTask({
    prompt: `enlistame ${root}`,
    projectRoot: root,
    allowWrite: true,
    permissionMode: "full",
    analysisMode: false,
    orchestratorPlan: { listOnly: true, runProfile: { listOnly: true, allowedTools: ["list_files"] } },
    runProfile: { listOnly: true, allowedTools: ["list_files"] },
  });

  assert.equal(providerCalls, 1, "el agente debe llamar al modelo una vez");
  assert.equal(result.completed, true);
  assert.notEqual(result.usage?.local_response, true);
  assert.ok(result.steps.some((step) => step.name === "list_files" && step.ok === true));
  assert.match(result.text, /Alpha/);
  assert.ok(providerCalls <= 2);
});
