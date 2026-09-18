"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TerminalHealer } = require("../runtime/terminal-healer");

test("terminal-healer: analiza errores de módulo faltante y syntax error", () => {
  const healer = new TerminalHealer();

  // Test 1: Module Not Found
  const errMod = "Error: Cannot find module 'express'\nRequire stack:\n- /app/server.js";
  const analysisMod = healer.analyzeError(errMod);
  assert.equal(analysisMod.hasError, true);
  assert.equal(analysisMod.errorType, "ModuleNotFound");
  assert.equal(analysisMod.missingModule, "express");

  const planMod = healer.createHealingPlan(analysisMod);
  assert.equal(planMod.actions.length, 1);
  assert.equal(planMod.actions[0].type, "command");
  assert.ok(planMod.actions[0].command.includes("npm install express"));

  // Test 2: SyntaxError con Stack Trace
  const errSyntax = "SyntaxError: Unexpected token '}'\n    at Object.<anonymous> (d:/app/main.js:42:15)";
  const analysisSyntax = healer.analyzeError(errSyntax);
  assert.equal(analysisSyntax.hasError, true);
  assert.equal(analysisSyntax.errorType, "SyntaxError");
  assert.equal(analysisSyntax.line, 42);
  assert.equal(analysisSyntax.column, 15);

  const planSyntax = healer.createHealingPlan(analysisSyntax);
  assert.equal(planSyntax.actions[0].type, "patch_code");
});

test("terminal-healer: auto-heal loop con simulación exitosa", async () => {
  const healer = new TerminalHealer({ maxRetries: 2 });
  const result = await healer.executeAutoHeal("node -e \"process.exit(0)\"");
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 1);
});
