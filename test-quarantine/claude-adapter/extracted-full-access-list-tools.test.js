"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/full-access-list-tools.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EditCoreClaudeAdapter } = require("../../runtime/editcore-claude-adapter");

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
