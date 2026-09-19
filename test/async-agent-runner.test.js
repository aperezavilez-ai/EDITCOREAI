/**
 * Unit tests for AsyncAgentRunner (runtime/async-agent-runner.js)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { AsyncAgentRunner, TASK_STATUS } = require("../runtime/async-agent-runner");

test("AsyncAgentRunner: enqueues and executes background tasks", async () => {
  const runner = new AsyncAgentRunner();

  const task = runner.enqueueTask({
    name: "Test Task 1",
    type: "unit-tests",
    payload: {
      executor: async ({ log, setProgress }) => {
        log("Ejecutando pruebas...");
        setProgress(50);
        return { passed: 10, failed: 0 };
      },
    },
  });

  assert.ok(task.id.startsWith("bg_task_"));
  assert.strictEqual(task.name, "Test Task 1");

  // Wait a small tick for async executor to resolve
  await new Promise((r) => setTimeout(r, 60));

  const completed = runner.getTask(task.id);
  assert.strictEqual(completed.status, TASK_STATUS.COMPLETED);
  assert.strictEqual(completed.progress, 100);
  assert.strictEqual(completed.result.passed, 10);
  assert.ok(completed.logs.length >= 2);
});

test("AsyncAgentRunner: cancels queued and running tasks cleanly", () => {
  const runner = new AsyncAgentRunner({ maxConcurrent: 0 }); // paused workers

  const task = runner.enqueueTask({
    name: "Task to cancel",
    type: "heavy-analysis",
  });

  assert.strictEqual(task.status, TASK_STATUS.QUEUED);

  const cancelled = runner.cancelTask(task.id);
  assert.strictEqual(cancelled, true);
  assert.strictEqual(runner.getTask(task.id).status, TASK_STATUS.CANCELLED);
});

test("AsyncAgentRunner: lists tasks by project filter", () => {
  const runner = new AsyncAgentRunner();

  runner.enqueueTask({ name: "Proj A Task", projectRoot: "/path/to/a" });
  runner.enqueueTask({ name: "Proj B Task", projectRoot: "/path/to/b" });
  runner.enqueueTask({ name: "Global Task" });

  const projAList = runner.listTasks("/path/to/a");
  assert.strictEqual(projAList.length, 2); // /path/to/a + global
  const allList = runner.listTasks();
  assert.strictEqual(allList.length, 3);
});
