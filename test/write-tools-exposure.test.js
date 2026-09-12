"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EditCoreClaudeAdapter,
  narrationClaimsWriteToolsMissing,
} = require("../runtime/editcore-claude-adapter");
const { ActionRegistry } = require("../runtime/action-registry");
const { TOOL_ALLOWLIST, MODES, resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");

function temporaryProject(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return dir;
}

test("detecta el mensaje de write_file no expuesto", () => {
  const msg = [
    "No puedo ejecutar write_file ni replace_in_file porque no estan expuestas",
    "entre las herramientas reales de esta sesion; unicamente esta disponible read_file.",
    "No simulare una escritura ni afirmare que se realizo.",
  ].join(" ");
  assert.equal(narrationClaimsWriteToolsMissing(msg), true);
});

test("EXECUTE no deja allowedTools en solo read_file aunque el prompt sea FOCO", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "PROCEDE",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    planAuthorizedExecution: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.ok(plan.allowedTools.includes("write_file"));
  assert.ok(plan.allowedTools.includes("replace_in_file"));
});

test("analisis: claim de write missing cierra en 1 turno (no quema tokens)", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-write-missing-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }, null, 2));

  let providerCalls = 0;
  const adapter = new EditCoreClaudeAdapter({
    maxIterations: 8,
    tokenBudget: 50_000,
    logger: { log() {}, warn() {}, error() {} },
  });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = {
    call: async () => {
      providerCalls += 1;
      return {
        text: [
          "No puedo ejecutar write_file ni replace_in_file porque no estan expuestas",
          "entre las herramientas reales de esta sesion; unicamente esta disponible read_file.",
          "No simulare una escritura ni afirmare que se realizo.",
          "Estado verificable: no se modifico ningun archivo.",
        ].join(" "),
        toolCalls: [],
        usage: { total_tokens: 20 },
      };
    },
  };
  adapter.toolExecutor = {
    execute: async () => {
      throw new Error("no deberia ejecutar tools");
    },
  };

  const result = await adapter.executeTask({
    prompt: "corrige el bug",
    projectRoot,
    analysisMode: true,
    allowWrite: false,
    requireEvidence: false,
    enforceController: false,
    orchestratorPlan: {
      mode: MODES.DISCOVER,
      analysisMode: true,
      allowedTools: TOOL_ALLOWLIST[MODES.DISCOVER],
    },
  });

  assert.ok(providerCalls <= 2, `debia cortar ya; calls=${providerCalls}`);
  assert.match(String(result.report?.stopReason || result.stopReason || ""), /escritura|PROCEDE|autoriz/i);
  assert.doesNotMatch(String(result.text || ""), /unicamente esta disponible read_file/i);
});

test("getAvailableTools en ejecucion reinyecta write_file si el allowlist era de analisis", () => {
  const adapter = new EditCoreClaudeAdapter({ logger: { log() {}, warn() {}, error() {} } });
  const tools = adapter.getAvailableTools({
    allowWrite: true,
    analysisMode: false,
    listOnly: false,
    prompt: "PROCEDE",
    orchestratorPlan: {
      mode: MODES.DISCOVER,
      analysisMode: false,
      allowedTools: ["read_file", "list_files", "search_files"],
    },
    runProfile: {
      allowedTools: ["read_file", "list_files", "search_files"],
    },
  });
  const names = tools.map((item) => item.function.name);
  assert.ok(names.includes("write_file"), names.join(","));
  assert.ok(names.includes("replace_in_file"), names.join(","));
});
