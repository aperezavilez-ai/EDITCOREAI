"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ToolDispatcher } = require("./tool-dispatcher");
const { WorkspaceApi } = require("./workspace-api");
const { normalizeProviderDefinition } = require("./provider-contract");
const { BRAIN_TOOL_DEFINITIONS, registerBrainTools } = require("./brain-tools");

test("provider definitions are normalized and validated", () => {
  const definition = normalizeProviderDefinition({ id: "MeAI", kind: "openai-compatible", baseUrl: "https://api.example.com/v1/", models: ["a", "a"] });
  assert.equal(definition.id, "meai");
  assert.equal(definition.baseUrl, "https://api.example.com/v1");
  assert.deepEqual(definition.models, ["a"]);
  assert.throws(() => normalizeProviderDefinition({ id: "bad", baseUrl: "http://localhost" }));
});

test("dispatcher applies write authorization and returns uniform errors", async () => {
  const audit = [];
  const dispatcher = new ToolDispatcher({ authorize: async () => false, audit: async (row) => audit.push(row) });
  dispatcher.register({ name: "write_file", write: true, execute: async () => "written" });
  const result = await dispatcher.dispatch("write_file", {}, {});
  assert.equal(result.ok, false);
  assert.equal(result.error, "Operacion no autorizada.");
  assert.equal(audit.length, 1);
});

test("dispatcher normalizes actionId metadata and enforces tool timeout", async () => {
  const dispatcher = new ToolDispatcher({ defaultTimeoutMs: 20 });
  dispatcher.register({ name: "fast", execute: async () => "ok" });
  dispatcher.register({ name: "slow", timeoutMs: 10, execute: async () => new Promise((resolve) => setTimeout(resolve, 50)) });
  const fast = await dispatcher.dispatch("fast", {}, { actionId: "action-1", metadata: { stepId: "step-1" } });
  assert.equal(fast.actionId, "action-1"); assert.equal(fast.metadata.stepId, "step-1"); assert.equal(fast.metadata.timeoutMs, 20);
  const slow = await dispatcher.dispatch("slow", {}, { actionId: "action-2" });
  assert.equal(slow.ok, false); assert.equal(slow.actionId, "action-2"); assert.match(slow.error, /excedio 10 ms/);
});

test("workspace API confines file operations to its root", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-runtime-"));
  const workspace = new WorkspaceApi({ root });
  workspace.writeFile("src/app.js", "ok");
  const read = workspace.readFile("src/app.js");
  assert.equal(read.content, "1| ok", "el contenido va numerado para que el modelo pueda citar lineas");
  assert.equal(read.totalLines, 1);
  assert.throws(() => workspace.readFile("../outside.txt"));
});

test("readFile numera en base 1 igual que search_files", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-lines-"));
  const workspace = new WorkspaceApi({ root });
  workspace.writeFile("a.txt", "uno\ndos\ntres\ncuatro");

  // Pedir la linea 2 debe devolver "dos". Con la base 0 anterior devolvia "tres",
  // asi que una linea sacada de search_files apuntaba a la siguiente al leerla.
  const one = workspace.readFile("a.txt", { startLine: 2, endLine: 2 });
  assert.equal(one.content, "2| dos");
  assert.equal(one.truncated, true);

  const all = workspace.readFile("a.txt");
  assert.equal(all.content.split("\n")[0], "1| uno");
  assert.equal(all.startLine, 1);
  assert.equal(all.totalLines, 4);
  assert.equal(all.truncated, false);

  // Un endLine fuera de rango se recorta al archivo en vez de inventar lineas vacias.
  assert.equal(workspace.readFile("a.txt", { startLine: 3, endLine: 99 }).endLine, 4);
});

test("brain tools expose the installed brain and audit dynamic access", async () => {
  const audit = [];
  const calls = [];
  const brain = {
    async searchForAgent(root, query, options) {
      calls.push(["search", root, query, options]);
      return { query, memory: [{ title: "decision" }], knowledge: [], catalog: [] };
    },
    async readSkillForAgent(root, name) {
      calls.push(["skill", root, name]);
      return { name, content: "skill instructions" };
    },
    async agentInventory(root, query, limit) {
      calls.push(["inventory", root, query, limit]);
      return { skills: [{ name: "frontend-design" }], installed: [], catalog: [] };
    },
  };
  const dispatcher = new ToolDispatcher();
  registerBrainTools(dispatcher, {
    brain,
    rootPath: "C:/workspace",
    hostTools: () => [{ type: "function", function: { name: "read_file", description: "read" } }],
    onAccess: async (row) => audit.push(row),
  });

  assert.deepEqual(BRAIN_TOOL_DEFINITIONS.map(item => item.function.name), ["brain_search", "brain_skill", "brain_tools"]);
  const search = await dispatcher.dispatch("brain_search", { query: "decision", scope: "memory", limit: 3 });
  const skill = await dispatcher.dispatch("brain_skill", { name: "frontend-design" });
  const inventory = await dispatcher.dispatch("brain_tools", { query: "frontend", limit: 10 });
  assert.equal(search.ok, true);
  assert.equal(skill.result.content, "skill instructions");
  assert.equal(inventory.result.agentTools[0].name, "read_file");
  assert.deepEqual(calls.map(call => call[0]), ["search", "skill", "inventory"]);
  assert.deepEqual(audit.map(row => row.kind), ["search", "skill", "inventory"]);
  assert.ok(audit.every(row => row.ok));
});
