"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/parity-tools.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter expone herramientas operador con allowWrite", () => {
  const { EditCoreClaudeAdapter } = require("../../runtime/editcore-claude-adapter");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 10_000, logger: { log() {}, warn() {}, error() {} } });
  const names = adapter.getAvailableTools({ allowWrite: true }).map((item) => item.function.name);
  for (const toolName of [
    "onboard_project", "publish_project", "connect_project", "provision_project", "create_supabase_project",
  ]) {
    assert.ok(names.includes(toolName), `falta ${toolName} en adapter`);
  }
});
