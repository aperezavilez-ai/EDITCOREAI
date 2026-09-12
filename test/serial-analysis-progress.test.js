"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  nextAnalysisWalkActions,
  formatIncrementalAnalysisNote,
  collectToolEvidence,
  buildAnalysisCoverageMap,
} = require("../runtime/evidence-grounding");
const { resolveAnalysisDepth, buildDepthReportGuide } = require("../runtime/analysis-depth");

test("walker serial: como maximo 1 accion por paso", () => {
  const depthProfile = resolveAnalysisDepth("analiza el proyecto y dame un reporte completo");
  const evidence = collectToolEvidence([
    {
      name: "list_files",
      ok: true,
      input: { path: "" },
      result: {
        entries: [
          { path: "package.json", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "app", kind: "directory" },
        ],
      },
    },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: '{"name":"demo"}' } },
  ], "D:/demo");
  const next = nextAnalysisWalkActions(evidence, { prompt: "reporte completo", depthProfile });
  assert.ok(next.length <= 1, `esperaba <=1 accion, got ${next.length}`);
  assert.equal(next[0]?.name, "list_files");
});

test("nota incremental: read_file muestra avance legible", () => {
  const note = formatIncrementalAnalysisNote(
    "read_file",
    { path: "src/lib/gpt-client.ts" },
    { content: "export async function chat() {\n  return 1;\n}\n// TODO fix\n" },
  );
  assert.match(note, /Avance — leí `src\/lib\/gpt-client\.ts`/);
  assert.match(note, /chat/);
  assert.match(note, /TODO\/FIXME/);
});

test("guia de profundidad exige metodo serial", () => {
  const guide = buildDepthReportGuide(resolveAnalysisDepth("analiza este proyecto completo"));
  assert.match(guide, /METODO SERIAL|UNA sola herramienta/i);
  assert.match(guide, /3-8 lineas|avance/i);
});

test("guia de profundidad: ROADMAP lo actualiza EDITCOREAI, no se ignora del todo", () => {
  const guide = buildDepthReportGuide(resolveAnalysisDepth("analiza este proyecto completo"));
  assert.match(guide, /EDITCOREAI lo actualiza solo|indice compacto/i);
  assert.doesNotMatch(guide, /IGNORA ROADMAP\.md y docs de estado/i);
  assert.match(guide, /Hallazgos SOLO desde codigo|no cites bugs desde ROADMAP/i);
  const deep = resolveAnalysisDepth("analisis profundo del proyecto");
  assert.doesNotMatch(String(deep.orchestrationHint || ""), /\bIGNORA ROADMAP\b/i);
});

test("adapter limita a 1 tool en analysisMode y emite avance", () => {
  const adapterSrc = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapterSrc, /SERIAL_ANALYSIS: solo 1 herramienta por turno/);
  assert.match(adapterSrc, /emitAnalysisStepProgress/);
  assert.match(adapterSrc, /bootstrap ligero|SERIAL como Cursor/i);
  assert.doesNotMatch(adapterSrc, /actions\.slice\(0,\s*4\)/);
});

test("coverage map sigue exigiendo profundidad (no baja calidad)", () => {
  const depthProfile = resolveAnalysisDepth("reporte completo del proyecto");
  assert.ok(depthProfile.minCodeReads >= 6);
  const map = buildAnalysisCoverageMap(collectToolEvidence([], "D:/demo"), { depthProfile });
  assert.equal(map.ok, false);
});
