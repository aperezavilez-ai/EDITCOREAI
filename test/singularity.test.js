"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { singularityCompiler } = require("../runtime/singularity-compiler");

test("Ciclo 46: Compilador Auto-Evolutivo & Runtime (Singularity Engine)", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const analysis = await singularityCompiler.analyzeSelfEngine(projectRoot);
  assert.ok(analysis.runtimeFilesScanned > 0);

  const optimization = singularityCompiler.applySelfOptimization({
    file: "runtime/ai-core.js",
    type: "HOT_PATH_MEMOIZATION",
  });
  assert.ok(optimization.patchId);
  assert.equal(optimization.status, "APPLIED_HOT");

  const worker = singularityCompiler.scaleReplicationWorker({ workerType: "AST_COMPILER" });
  assert.ok(worker.workerId);
  assert.equal(worker.status, "RUNNING");

  const status = singularityCompiler.getSingularityStatus();
  assert.equal(status.status, "SINGULARITY_ACTIVE");
  assert.ok(status.activeWorkers.length > 0);

  const terminated = singularityCompiler.terminateWorker(worker.workerId);
  assert.equal(terminated, true);
});
