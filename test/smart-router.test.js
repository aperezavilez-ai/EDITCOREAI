/**
 * Unit tests for SmartRouter (runtime/smart-router.js)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { SmartRouter, TASK_CATEGORIES } = require("../runtime/smart-router");

test("SmartRouter: classifies task types to appropriate model tiers", () => {
  const router = new SmartRouter();

  assert.strictEqual(router.classifyTaskTier(TASK_CATEGORIES.GHOST_COMPLETION), "lightweight");
  assert.strictEqual(router.classifyTaskTier("inline"), "lightweight");
  assert.strictEqual(router.classifyTaskTier(TASK_CATEGORIES.ARCHITECTURE), "reasoning");
  assert.strictEqual(router.classifyTaskTier(TASK_CATEGORIES.CHAT), "balanced");
  assert.strictEqual(router.classifyTaskTier(TASK_CATEGORIES.EXPLANATION), "balanced");
  assert.strictEqual(router.classifyTaskTier(TASK_CATEGORIES.REFACTOR, "arquitectura completa"), "reasoning");
});

test("SmartRouter: resolves candidate and fallback chain", () => {
  const router = new SmartRouter();
  const resolution = router.resolveCandidate(TASK_CATEGORIES.GHOST_COMPLETION);

  assert.ok(resolution.candidate);
  assert.strictEqual(resolution.tier, "lightweight");
  assert.ok(resolution.candidate.model);
  assert.ok(Array.isArray(resolution.fallbackChain));
  assert.ok(resolution.fallbackChain.length > 0);
});

test("SmartRouter: tracks execution metrics and calculates estimated costs", () => {
  const router = new SmartRouter();
  
  const log = router.recordExecution("anthropic", {
    success: true,
    latencyMs: 350,
    inputTokens: 1000,
    outputTokens: 200,
    model: "claude-3-5-sonnet-20241022",
  });

  assert.strictEqual(log.success, true);
  assert.strictEqual(log.latencyMs, 350);
  assert.ok(log.costEstimated > 0);

  const stats = router.getStats();
  assert.strictEqual(stats.historyCount, 1);
  assert.ok(stats.totalCostEstimated > 0);
  assert.strictEqual(stats.providerHealth.anthropic.status, "healthy");
});

test("SmartRouter: marks unhealthy after repeated failures and provides fallback", () => {
  const router = new SmartRouter();

  router.recordExecution("openai", { success: false, latencyMs: 5000 });
  router.recordExecution("openai", { success: false, latencyMs: 5000 });
  router.recordExecution("openai", { success: false, latencyMs: 5000 });

  const stats = router.getStats();
  assert.strictEqual(stats.providerHealth.openai.status, "unhealthy");

  const fallback = router.getFallbackFor("openai", TASK_CATEGORIES.CHAT);
  assert.ok(fallback);
  assert.notStrictEqual(fallback.provider, "openai");
});
