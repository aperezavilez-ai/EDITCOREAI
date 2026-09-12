"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  filterStepsForScope,
  stepMatchesScope,
  extractAnalysisTargets,
  analysisTargetCoverage,
  collapseDuplicateReportSections,
  formatCurrentRunEvidenceBlock,
  collectToolEvidence,
  analysisEvidenceSufficient,
  STALE_EVIDENCE_LOG,
  logStaleEvidenceRejection,
} = require("../runtime/evidence-grounding");
const { ConversationLog } = require("../runtime/conversation-log");

test("filterStepsForScope rechaza evidencia de otro runId", () => {
  STALE_EVIDENCE_LOG.length = 0;
  const scope = { runId: "run-B", taskId: "task-B", projectRoot: "D:/demo" };
  const steps = [
    { runId: "run-A", taskId: "task-A", name: "read_file", ok: true, input: { path: "src/old.js" }, result: { content: "stale" } },
    { runId: "run-B", taskId: "task-B", name: "read_file", ok: true, input: { path: "src/new.js" }, result: { content: "fresh" } },
  ];
  const scoped = filterStepsForScope(steps, scope);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].input.path, "src/new.js");
  assert.ok(STALE_EVIDENCE_LOG.some((row) => row.code === "STALE_EVIDENCE_REJECTED"));
});

test("analysisTargetCoverage exige solo archivos nombrados en el prompt", () => {
  const prompt = "Lee src/calculator.js y src/secret-module.js y dime que hacen.";
  const targets = extractAnalysisTargets(prompt);
  assert.ok(targets.some((item) => /calculator\.js/i.test(item)));
  assert.ok(targets.some((item) => /secret-module\.js/i.test(item)));
  const evidence = collectToolEvidence([
    { runId: "run-1", name: "read_file", ok: true, input: { path: "src/calculator.js" }, result: { content: "return a - b;" } },
    { runId: "run-1", name: "read_file", ok: true, input: { path: "src/secret-module.js" }, result: { content: "REALITY_SECRET_739184" } },
  ], "D:/demo", { runId: "run-1", prompt, analysisTargets: targets });
  const coverage = analysisTargetCoverage(prompt, evidence);
  assert.equal(coverage.percent, 100);
  const sufficiency = analysisEvidenceSufficient(evidence, { prompt, targets });
  assert.equal(sufficiency.ok, true);
  assert.equal(sufficiency.required, targets.length);
});

test("analysisEvidenceSufficient no exige 3 lecturas si el usuario pidio 2 archivos", () => {
  const prompt = "Analiza calculator.js y secret-module.js";
  const targets = extractAnalysisTargets(prompt);
  const evidence = collectToolEvidence([
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: ["package.json", "src/calculator.js", "src/secret-module.js", "src/utils.js"] } },
    { name: "read_file", ok: true, input: { path: "src/calculator.js" }, result: { content: "export function sub(a,b){return a-b;}" } },
    { name: "read_file", ok: true, input: { path: "src/secret-module.js" }, result: { content: "export const SECRET='x';" } },
  ], "D:/demo", { runId: "run-x", analysisTargets: targets });
  const sufficiency = analysisEvidenceSufficient(evidence, { prompt, targets });
  assert.equal(sufficiency.ok, true);
});

test("collapseDuplicateReportSections elimina reportes repetidos al final", () => {
  const duplicate = [
    "## Análisis del proyecto",
    "Proyecto pequeño con dos archivos.",
    "## Evidencia real de herramientas",
    "- src/calculator.js",
    "## Análisis del proyecto",
    "Proyecto pequeño con dos archivos.",
    "## Evidencia real de herramientas",
    "- src/calculator.js",
  ].join("\n");
  const collapsed = collapseDuplicateReportSections(duplicate);
  assert.equal((collapsed.match(/## Análisis del proyecto/g) || []).length, 1);
});

test("ConversationLog preserva CURRENT_RUN_EVIDENCE al compactar", () => {
  const block = formatCurrentRunEvidenceBlock(
    { runId: "run-1", taskId: "task-1", projectRoot: "D:/demo" },
    {
      runId: "run-1",
      filesRead: [{ path: "src/calculator.js", content: "return a-b;", contentHash: "abc" }],
      toolLog: [],
    },
  );
  const log = new ConversationLog({ keepLastTurns: 2, evidencePreservationBlock: block });
  for (let i = 0; i < 8; i += 1) {
    log.appendUser(`turno largo ${i} `.repeat(30));
    log.appendAssistant({ text: `respuesta ${i} `.repeat(30), toolCalls: [] });
  }
  log.maxChars = Math.max(200, Math.floor(log.serializedLength() * 0.4));
  const compacted = log.compact();
  assert.equal(compacted, true);
  const serialized = log.turns.map((row) => row.content).join("\n");
  assert.match(serialized, /CURRENT_RUN_EVIDENCE/);
  assert.match(serialized, /src\/calculator\.js/);
});

test("stepMatchesScope acepta steps sin metadatos cuando no hay scope estricto", () => {
  assert.equal(stepMatchesScope({ name: "read_file" }, {}), true);
  assert.equal(stepMatchesScope({ runId: "a" }, { runId: "b" }), false);
});

test("logStaleEvidenceRejection registra rechazo sin contenido sensible", () => {
  const before = STALE_EVIDENCE_LOG.length;
  const entry = logStaleEvidenceRejection({
    runId: "run-new",
    sourceRunId: "run-old",
    tool: "read_file",
    path: "src/x.js",
  });
  assert.equal(entry.code, "STALE_EVIDENCE_REJECTED");
  assert.equal(STALE_EVIDENCE_LOG.length, before + 1);
  assert.equal(entry.path, "src/x.js");
});
