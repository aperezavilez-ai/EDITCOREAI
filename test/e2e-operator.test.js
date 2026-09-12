"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runE2EOperatorSuite, e2eEnabled } = require("../runtime/e2e-operator");

test("e2e operator idle sin tokens", async () => {
  const prev = process.env.E2E_OPERATOR;
  delete process.env.E2E_OPERATOR;
  delete process.env.E2E_GITHUB_TOKEN;
  const result = await runE2EOperatorSuite();
  assert.equal(result.skipped, true);
  if (prev) process.env.E2E_OPERATOR = prev;
});

test("e2e operator smoke local", async (t) => {
  if (!e2eEnabled() && !process.env.E2E_OPERATOR_LOCAL) {
    t.skip("Define E2E_OPERATOR_LOCAL=1 para smoke local.");
  }
  process.env.E2E_OPERATOR = "1";
  const result = await runE2EOperatorSuite();
  assert.equal(result.skipped, false);
  assert.equal(result.ok, true);
  if (result.tmp) fs.rmSync(result.tmp, { recursive: true, force: true });
});
