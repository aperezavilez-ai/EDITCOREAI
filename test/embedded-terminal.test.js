"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TerminalManager, DESTRUCTIVE_COMMAND_PATTERNS } = require("../runtime/embedded-terminal");
const { AutoHealingInterceptor } = require("../runtime/auto-healing-interceptor");

test("TerminalManager creates sessions, blocks destructive commands and catches outputs", async (t) => {
  const manager = new TerminalManager();
  const session = manager.createSession({ projectRoot: process.cwd() });

  assert.ok(session.id.startsWith("term-"));
  assert.equal(session.isAlive, true);

  // Verificación de seguridad de comandos
  const dangerous = session.write("rm -rf /");
  assert.equal(dangerous.ok, false);
  assert.equal(dangerous.safetyBlocked, true);

  const dangerousWin = session.write("del /s /q C:\\Windows");
  assert.equal(dangerousWin.ok, false);
  assert.equal(dangerousWin.safetyBlocked, true);

  // Verificación de comando seguro
  const safe = session.write("echo 'EditCoreAI Terminal Ready'\n");
  assert.equal(safe.ok, true);

  // Resize
  const resized = session.resize(120, 30);
  assert.equal(resized.cols, 120);
  assert.equal(resized.rows, 30);

  // Cleanup
  session.kill();
  assert.equal(session.isAlive, false);
});

test("AutoHealingInterceptor detects missing modules, syntax errors and generates proposals", () => {
  const interceptor = new AutoHealingInterceptor();

  // Test Missing Module
  const missingModLog = "Error: Cannot find module 'canvas-confetti'\n    at require (node:internal/modules/cjs/loader:1143:18)";
  const res1 = interceptor.analyzeOutput(missingModLog);
  assert.ok(res1);
  assert.equal(res1.finding.type, "MISSING_MODULE");
  assert.equal(res1.finding.moduleName, "canvas-confetti");
  assert.equal(res1.proposal.autoExecutable, true);
  assert.equal(res1.proposal.suggestedCommand, "npm install canvas-confetti");

  // Test Syntax/TypeScript Error
  const tsErrorLog = "src/components/SiteHeader.tsx:42:15: error TS2322: Type 'string' is not assignable to type 'number'.";
  const res2 = interceptor.analyzeOutput(tsErrorLog);
  assert.ok(res2);
  assert.equal(res2.finding.type, "SYNTAX_OR_TYPE_ERROR");
  assert.equal(res2.finding.file, "src/components/SiteHeader.tsx");
  assert.equal(res2.finding.line, 42);
  assert.equal(res2.proposal.fixType, "patch_code");

  // Test Port in Use
  const portLog = "Error: listen EADDRINUSE: address already in use :::3000";
  const res3 = interceptor.analyzeOutput(portLog);
  assert.ok(res3);
  assert.equal(res3.finding.type, "PORT_IN_USE");
  assert.equal(res3.proposal.fixType, "kill_port");
});
