"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del test mixto de
// test/fix-queue.test.js: workflow-orchestrator y task-ipc se quedan).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter expone cola durable (refreshFixQueueFocus)", () => {
  const adapter = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapter, /refreshFixQueueFocus/);
  assert.match(adapter, /FIX_QUEUE_DURABLE|formatFixQueueBlock/);
});
