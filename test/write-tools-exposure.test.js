"use strict";

// [EDITCORE-INTEGRAL-B10] La parte viva de este archivo (el plan del
// orquestador de intención) sigue en la suite; los tests del adaptador
// salieron a test-quarantine/claude-adapter/extracted-write-tools-exposure.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TOOL_ALLOWLIST, MODES, resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");

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

