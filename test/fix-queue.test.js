"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFixQueueFromReport,
  syncFixQueueWithSteps,
  formatFixQueueBlock,
  buildFixQueueExecutionPrompt,
} = require("../runtime/fix-queue");

test("buildFixQueueFromReport extrae paths de hallazgos y plan", () => {
  const report = [
    "## Qué falló / hallazgos",
    "- bug en codigo",
    "## Cómo lo corregiré",
    "1. Corregir `src/lib/calc.ts` con replace_in_file",
    "2. Corregir app/page.tsx",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  const queue = buildFixQueueFromReport(report, {
    findings: [{ path: "src/broken.ts", label: "TODO", source: "read_file" }],
  });
  assert.ok(queue.some((item) => item.target.includes("broken.ts")));
  assert.ok(queue.some((item) => item.target.includes("calc.ts")));
  assert.ok(queue.every((item) => item.status === "pending"));
});

test("syncFixQueueWithSteps avanza mutado → verificado y FOCO", () => {
  const queue = buildFixQueueFromReport("## Cómo lo corregiré\n1. Corregir src/a.ts\n2. Corregir src/b.ts\n");
  assert.ok(queue.length >= 2);
  const mid = syncFixQueueWithSteps(queue, [
    { name: "replace_in_file", ok: true, input: { path: "src/a.ts", oldText: "x", newText: "y" }, result: {} },
  ]);
  assert.equal(mid.current?.target, "src/a.ts");
  assert.equal(mid.queue.find((item) => item.target === "src/a.ts")?.status, "mutated");

  const doneFirst = syncFixQueueWithSteps(queue, [
    { name: "replace_in_file", ok: true, input: { path: "src/a.ts", oldText: "x", newText: "y" }, result: {} },
    { name: "read_file", ok: true, input: { path: "src/a.ts" }, result: { content: "y" } },
  ]);
  assert.equal(doneFirst.queue.find((item) => item.target === "src/a.ts")?.status, "verified");
  assert.equal(doneFirst.current?.target, "src/b.ts");

  const block = formatFixQueueBlock(doneFirst.queue, { focusOnly: true });
  assert.match(block, /FOCO OBLIGATORIO/);
  assert.match(block, /src\/b\.ts/);

  const prompt = buildFixQueueExecutionPrompt(doneFirst.queue, "plan");
  assert.match(prompt, /DISPATCHER DE COLA/);
});

test("adapter y workflow exponen cola durable", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapter, /refreshFixQueueFocus/);
  assert.match(adapter, /FIX_QUEUE_DURABLE|formatFixQueueBlock/);
  const wf = fs.readFileSync(path.join(__dirname, "..", "runtime", "workflow-orchestrator.js"), "utf8");
  assert.match(wf, /buildFixQueueFromReport/);
  assert.match(wf, /fixQueue/);
  const ipc = fs.readFileSync(path.join(__dirname, "..", "runtime", "task-ipc.js"), "utf8");
  assert.match(ipc, /workflow:persist-plan/);
});
