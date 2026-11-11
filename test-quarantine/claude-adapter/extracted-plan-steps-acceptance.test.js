"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del Paso6b de test/plan-steps-acceptance.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Paso6b (parte adaptador): expone git_push/git_pull y fixQueue", () => {
  const adapter = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapter, /tool\("git_push"/);
  assert.match(adapter, /tool\("git_pull"/);
  assert.match(adapter, /fixQueue: resultFixQueue/);
});
