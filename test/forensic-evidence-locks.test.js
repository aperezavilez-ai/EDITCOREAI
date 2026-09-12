"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  collectToolEvidence,
  formatEvidencePreservationBlock,
  formatCurrentRunEvidenceBlock,
  extractForensicExcerpts,
  isHollowAnalysisReport,
  groundAnalysisReport,
} = require("../runtime/evidence-grounding");
const ProjectAnalysis = require("../project-analysis");

const appRoot = path.join(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const evidenceSource = fs.readFileSync(path.join(appRoot, "runtime", "evidence-grounding.js"), "utf8");

test("E1: preservacion incluye FORENSIC_EXCERPTS no solo contentLength", () => {
  const steps = [
    {
      name: "read_file",
      ok: true,
      input: { path: "runtime/editcore-claude-adapter.js" },
      result: {
        content: [
          "async function executeTask(input) {",
          "  let completed = false;",
          "  if (input.analysisMode === true) {",
          "    return this.finalizeAnalysisOnce(input, steps, '');",
          "  }",
          "  if (repeats >= 1) break;",
          "}",
        ].join("\n"),
      },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "runtime/intent-orchestrator.js" },
      result: {
        content: "function resolveUnifiedAgentPlan(options = {}) {\n  const analysisMode = true;\n  return { analysisMode };\n}\n",
      },
    },
  ];
  const evidence = collectToolEvidence(steps, "D:/proj");
  assert.ok((evidence.filesRead[0].forensicExcerpts || []).length >= 1);
  const block = formatEvidencePreservationBlock(evidence, { runId: "run-1", projectRoot: "D:/proj" });
  assert.match(block, /FORENSIC_EXCERPTS/);
  assert.match(block, /analysisMode|finalizeAnalysisOnce|executeTask/);
  assert.match(block, /PROHIBIDO afirmar que falta el contenido fuente/);
  const current = formatCurrentRunEvidenceBlock({ runId: "run-1" }, evidence);
  assert.match(current, /FORENSIC_EXCERPTS/);
});

test("E2: isHollowAnalysisReport detecta el informe vacio del usuario", () => {
  const hollow = [
    "CAPACIDADES REALES: Falta información en el contexto.",
    "FLUJO REAL: Falta información en el contexto.",
    "PRIMER PUNTO: Falta información en el contexto.",
    "CAUSA RAIZ: Falta información en el contexto.",
    "Los otros nueve archivos leidos no aportan evidencia forense porque su contenido fuente no fue incluido.",
    "VEREDICTO NO-GO — NO EXISTE EVIDENCIA SUFICIENTE",
  ].join("\n");
  assert.equal(isHollowAnalysisReport(hollow), true);
  assert.equal(isHollowAnalysisReport("## Qué sí funcionó\n\nLeido adapter.\n\nL42: function executeTask()\n"), false);
});

test("E2b: groundAnalysisReport reemplaza informe hueco si hubo lecturas", () => {
  const steps = [
    {
      name: "list_files",
      ok: true,
      input: { path: "" },
      result: { entries: [{ name: "runtime", type: "dir" }] },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "a.js" },
      result: { content: "function earlyExit() {\n  if (!ok) return false;\n  completed = true;\n}\n" },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "b.js" },
      result: { content: "function authorize(tool) {\n  if (analysisMode) return false;\n}\n" },
    },
  ];
  const hollow = "Falta información en el contexto.\n".repeat(6) + "\nNO-GO — NO EXISTE EVIDENCIA SUFICIENTE";
  const grounded = groundAnalysisReport(hollow, steps, "D:/proj");
  assert.equal(grounded.replaced, true);
  assert.match(grounded.text, /FORENSIC_EXCERPTS|Qué sí funcionó/);
  assert.doesNotMatch(grounded.text, /Falta información en el contexto\.\nFalta información/);
});

test("E2c: adapter rechaza informe hueco con nudge", () => {
  assert.match(adapterSource, /hollowReportNudgeSent/);
  assert.match(adapterSource, /Informe HUECO rechazado/);
  assert.match(evidenceSource, /isHollowAnalysisReport/);
});

test("E3: propuesta no es changeRequest y responde local", () => {
  const prompt = "CUAL SERIA TU PROPUESTA PARA CORREGIR TODO DIME";
  assert.equal(ProjectAnalysis.isProposalFollowUp(prompt), true);
  assert.equal(ProjectAnalysis.isChangeRequest(prompt), false);
  assert.equal(ProjectAnalysis.isAnalysisFollowUp(prompt, true), true);
  assert.match(rendererSource, /isProposalFollowUp/);
  assert.match(rendererSource, /proposalFromAnalysisMemory/);
  assert.match(rendererSource, /Propuesta desde memoria de analisis/);
});

test("E3b: proposalFromAnalysisMemory no pide reexplorar todo", () => {
  const text = ProjectAnalysis.proposalFromAnalysisMemory({
    filesInspected: ["runtime/editcore-claude-adapter.js", "runtime/intent-orchestrator.js"],
    resultSummary: "Falta información en el contexto.\nNO-GO — NO EXISTE EVIDENCIA SUFICIENTE",
  });
  assert.match(text, /sin reexplorar/i);
  assert.match(text, /editcore-claude-adapter\.js/);
  assert.match(text, /hueco/i);
});

test("E1b: extractForensicExcerpts encuentra firmas", () => {
  const excerpts = extractForensicExcerpts("x.js", "function foo() {\n  if (analysisMode) return false;\n}\n");
  assert.ok(excerpts.some((item) => /foo|analysisMode|return false/i.test(item.text)));
});
