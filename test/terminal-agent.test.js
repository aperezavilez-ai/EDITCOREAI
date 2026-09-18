"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { TerminalAgent } = require("../runtime/terminal-agent");

describe("TerminalAgent", () => {
  let agent;

  beforeEach(() => {
    agent = new TerminalAgent({
      projectRoot: process.cwd(),
      timeoutMs: 5000,
    });
  });

  it("rechaza comandos vacíos", async () => {
    const result = await agent.runCommand({ command: "   " });
    assert.strictEqual(result.ok, false);
    assert.ok(String(result.error || "").includes("Falta 'command'"));
  });

  it("ejecuta un comando válido y devuelve salida", async () => {
    const result = await agent.runCommand({ command: "echo hello-terminal-agent" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(String(result.stdout || "").includes("hello-terminal-agent"));
  });

  it("detecta fallo y entra en self-healing sin IA/RAG", async () => {
    const result = await agent.runCommand({ command: "node -e \"process.exit(1)\"" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.selfHealing);
    assert.strictEqual(result.selfHealing.attempted, true);
    assert.strictEqual(result.selfHealing.failed, true);
  });

  it("no entra en self-healing cuando el comando tiene éxito", async () => {
    const result = await agent.runCommand({ command: "echo ok" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(!result.selfHealing);
  });
});
