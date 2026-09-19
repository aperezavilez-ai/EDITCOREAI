/**
 * test/parallel-agents.test.js
 * Unit tests for ParallelAgentRunner (Ciclo 30)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { ParallelAgentRunner, AGENT_STATUS } = require("../runtime/parallel-agent-runner.js");

describe("Cycle 30: Parallel Agent Runner", () => {
  test("spawns agents with isolated scratchpad workspaces", () => {
    const runner = new ParallelAgentRunner({ maxConcurrency: 2 });
    const agent = runner.spawnAgent({
      name: "Test Worker 1",
      goal: "Analyze AST in parallel",
      projectRoot: "d:/test/project",
    });

    assert.ok(agent.agentId.startsWith("agent_p_"));
    assert.strictEqual(agent.name, "Test Worker 1");
    assert.ok(fs.existsSync(agent.scratchDir), "Scratch directory should exist");

    const retrieved = runner.getAgent(agent.agentId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.goal, "Analyze AST in parallel");
    assert.ok(retrieved.contextLog.length >= 1);

    // Cleanup
    runner.cleanupAgent(agent.agentId);
    assert.strictEqual(fs.existsSync(agent.scratchDir), false, "Scratch dir should be cleaned up");
  });

  test("runs multiple parallel agents concurrently and aggregates results", async () => {
    const runner = new ParallelAgentRunner({ maxConcurrency: 3 });

    const tasks = [
      {
        name: "Linter Agent",
        goal: "Check lint errors",
        executor: async ({ log }) => {
          log("LINT", "Checking files");
          return { errors: 0, warnings: 1 };
        },
      },
      {
        name: "Security Agent",
        goal: "Check vulnerabilities",
        executor: async ({ log }) => {
          log("SEC", "Scanning dependencies");
          return { vulnerable: false };
        },
      },
      {
        name: "Formatter Agent",
        goal: "Format files",
        executor: async ({ log }) => {
          log("FMT", "Formatting source");
          return { formattedFiles: 4 };
        },
      },
    ];

    const results = await runner.runParallel(tasks);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].status, AGENT_STATUS.COMPLETED);
    assert.deepStrictEqual(results[0].result, { errors: 0, warnings: 1 });
    assert.strictEqual(results[1].status, AGENT_STATUS.COMPLETED);
    assert.deepStrictEqual(results[1].result, { vulnerable: false });
    assert.strictEqual(results[2].status, AGENT_STATUS.COMPLETED);
    assert.deepStrictEqual(results[2].result, { formattedFiles: 4 });

    for (const res of results) {
      runner.cleanupAgent(res.agentId);
    }
  });

  test("handles agent cancellation and errors properly", async () => {
    const runner = new ParallelAgentRunner({ maxConcurrency: 2 });

    const failedAgent = runner.spawnAgent({
      name: "Failing Agent",
      executor: async () => {
        throw new Error("Simulated agent runtime failure");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const failedInfo = runner.getAgent(failedAgent.agentId);
    assert.strictEqual(failedInfo.status, AGENT_STATUS.FAILED);
    assert.ok(failedInfo.error.includes("Simulated agent runtime failure"));

    const cancelAgent = runner.spawnAgent({
      name: "Long Agent",
      executor: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { done: true };
      },
    });

    const cancelled = runner.cancelAgent(cancelAgent.agentId, "Cancelled by test");
    assert.strictEqual(cancelled, true);

    const cancelledInfo = runner.getAgent(cancelAgent.agentId);
    assert.strictEqual(cancelledInfo.status, AGENT_STATUS.CANCELLED);

    runner.cleanupAgent(failedAgent.agentId);
    runner.cleanupAgent(cancelAgent.agentId);
  });

  test("lists agents filtered by projectRoot and status", () => {
    const runner = new ParallelAgentRunner();
    const a1 = runner.spawnAgent({ name: "A1", projectRoot: "/p1" });
    const a2 = runner.spawnAgent({ name: "A2", projectRoot: "/p2" });

    const p1List = runner.listAgents({ projectRoot: "/p1" });
    assert.strictEqual(p1List.length, 1);
    assert.strictEqual(p1List[0].agentId, a1.agentId);

    const allList = runner.listAgents();
    assert.ok(allList.length >= 2);

    runner.cleanupAgent(a1.agentId);
    runner.cleanupAgent(a2.agentId);
  });
});
