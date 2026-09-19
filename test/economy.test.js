"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeEconomy } = require("../runtime/compute-economy");

test("Ciclo 47: Gobernanza Financiera y Cómputo Autónomo", () => {
  const usage = computeEconomy.recordUsage({ tokens: 2000, costUsd: 0.02, task: "AST Benchmark" });
  assert.ok(usage.id);

  const routeLow = computeEconomy.resolveRoutingStrategy("low");
  assert.equal(routeLow.strategy, "LOCAL_FAST_MODEL");

  const routeHigh = computeEconomy.resolveRoutingStrategy("high");
  assert.equal(routeHigh.strategy, "CLOUD_SMART_ROUTER");

  const cluster = computeEconomy.provisionEphemeralCluster({ maxNodes: 2 });
  assert.ok(cluster.clusterId);
  assert.equal(cluster.status, "ACTIVE");

  const report = computeEconomy.getEconomyReport();
  assert.ok(report.budgetLimitUsd > 0);
  assert.ok(report.activeClustersCount >= 1);

  const tornDown = computeEconomy.teardownCluster(cluster.clusterId);
  assert.equal(tornDown, true);
});
