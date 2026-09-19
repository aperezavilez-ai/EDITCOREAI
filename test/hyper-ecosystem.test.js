"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { ciCdPipeline } = require("../runtime/ci-cd-pipeline");
const { astGraphEngine } = require("../runtime/ast-graph");
const { intentAnticipator } = require("../runtime/intent-anticipation");
const { securitySentinel } = require("../runtime/security-sentinel");
const { loraStyleAdapter } = require("../runtime/lora-adapter");

const projectRoot = path.resolve(__dirname, "..");

test("Ciclo 40: Pipeline CI/CD Autónomo (PR-to-Deploy Self-Pilot)", async () => {
  const result = await ciCdPipeline.runPipeline({
    projectRoot,
    branchName: "feature/hyper-autonomous-core",
    prTitle: "feat: hyper-autonomous modules",
    targetEnv: "preview",
    changedFiles: ["runtime/ci-cd-pipeline.js", "runtime/ast-graph.js"],
  });

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.stages.length, 4);
  assert.ok(result.pr);
  assert.equal(result.pr.status, "OPEN");
  assert.ok(result.pr.url.includes("github.com/editcoreai"));
  assert.ok(result.preview);
  assert.equal(result.preview.status, "ONLINE");
  assert.ok(result.preview.url.includes(".editcore.internal"));

  const previews = ciCdPipeline.getActivePreviews();
  assert.ok(previews.length > 0);

  const tornDown = ciCdPipeline.teardownPreview(result.preview.previewId);
  assert.equal(tornDown, true);
});

test("Ciclo 41: Grafo Semántico Neural (Deep AST Code Graph)", () => {
  const graphSummary = astGraphEngine.buildGraph(projectRoot, [
    "runtime/ci-cd-pipeline.js",
    "runtime/lora-adapter.js",
  ]);

  assert.ok(graphSummary.totalNodes > 0);
  assert.ok(graphSummary.totalEdges > 0);

  const queried = astGraphEngine.querySymbol("CiCdPipeline");
  assert.ok(queried.length > 0);
  assert.equal(queried[0].type, "Class");

  const refs = astGraphEngine.findReferences("CiCdPipeline");
  assert.ok(refs.length > 0);

  const subgraph = astGraphEngine.getDependencySubgraph("runtime/ci-cd-pipeline.js");
  assert.ok(subgraph.nodeCount > 0);

  const integrity = astGraphEngine.verifyContractIntegrity();
  assert.equal(typeof integrity.isValid, "boolean");
});

test("Ciclo 42: Anticipación de Intención y Pre-carga", async () => {
  intentAnticipator.recordUserAction({
    actionType: "FILE_OPEN",
    filePath: "runtime/ci-cd-pipeline.js",
    query: "deploy and pipeline",
  });

  const prediction = intentAnticipator.predictNextActions(projectRoot);
  assert.ok(prediction.confidence > 0.8);
  assert.ok(Array.isArray(prediction.predictedFiles));
  assert.ok(prediction.predictedFiles.length > 0);

  const prewarmRes = await intentAnticipator.preWarmContext(projectRoot);
  assert.ok(prewarmRes.prewarmedCount >= 0);

  const state = intentAnticipator.getAnticipationState();
  assert.ok(state.historyLength > 0);
});

test("Ciclo 43: Centinela de Seguridad y Auto-Parcheo", async () => {
  const scanReport = await securitySentinel.scanWorkspace(projectRoot);
  assert.ok(scanReport.filesScanned > 0);
  assert.equal(typeof scanReport.totalVulnerabilities, "number");

  const mockVuln = {
    id: "MOCK-SEC-1",
    severity: "HIGH",
    type: "CODE_INJECTION",
    cve: "CWE-94",
    file: "runtime/sample.js",
    line: 42,
  };

  const patchCard = securitySentinel.generateSecurityPatch(mockVuln, projectRoot);
  assert.ok(patchCard.cardId);
  assert.ok(patchCard.suggestedPatch.includes("JSON.parse"));
  assert.equal(patchCard.requiresApproval, true);

  const isolation = securitySentinel.isolateThreat(mockVuln.id);
  assert.equal(isolation.status, "QUARANTINED");
});

test("Ciclo 44: Fine-Tuning Local Dinámico (LoRA Style Adaptation)", () => {
  const profile = loraStyleAdapter.analyzeStyleDna(projectRoot);
  assert.ok(profile.dna);
  assert.ok(profile.dna.indentation);
  assert.ok(profile.generatedRules.length > 0);
  assert.ok(profile.styleWeights.consistencyConfidence > 0.8);

  const styledPrompt = loraStyleAdapter.applyStyleToPrompt("Crea una función para autenticar usuarios", projectRoot);
  assert.ok(styledPrompt.includes("[ESTILO DE PROYECTO LoRA - DNA EDITCOREAI]"));

  const updatedProfile = loraStyleAdapter.saveCustomRules(projectRoot, ["Prohibido usar callbacks sin envolver"]);
  assert.ok(updatedProfile.customRules.includes("Prohibido usar callbacks sin envolver"));
});
