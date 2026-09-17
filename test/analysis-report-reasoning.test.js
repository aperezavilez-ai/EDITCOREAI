"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveUnifiedAgentPlan,
  isAnalysisOnlyRequest,
  MODES,
} = require("../runtime/intent-orchestrator");
const ProjectAnalysis = require("../project-analysis");

test("Acceso completo + analiza/reporte = DISCOVER analysisMode (no execute/lint)", () => {
  const prompt = "ANALIZA TAXIDRIV Y DAME UN REPORTE";
  assert.equal(isAnalysisOnlyRequest(prompt, true), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(plan.mode, MODES.DISCOVER);
  assert.equal(plan.analysisMode, true);
  assert.equal(plan.directReadOnly, true);
  assert.equal(plan.runProfile?.cursorParityMode, false);
  assert.ok(!plan.allowedTools.includes("run_command"), "analisis no debe tener run_command");
  assert.ok(!plan.allowedTools.includes("write_file"), "analisis no debe tener write_file");
  assert.match(plan.statusLabel, /reporte|Analizando|Analisis/i);
});

test("corrige con Acceso completo sigue en EXECUTE", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "Corrige el error de login en TAXIDRIV",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.analysisMode, false);
});

test("reporte structured headers cuentan como analisis completo", () => {
  const report = [
    "## Qué sí funcionó",
    "",
    "La app abre y el landing carga.",
    "",
    "## Qué falló / hallazgos",
    "",
    "- Falta validacion en auth (src/auth.ts).",
    "",
    "## Evidencia",
    "",
    "Leido package.json y src/auth.ts.",
    "",
    "## Cómo lo corregiré",
    "",
    "1. Añadir validacion en auth.",
    "",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  assert.equal(ProjectAnalysis.isAnalysisReport(report), true);
  assert.equal(ProjectAnalysis.isAnalysisReport("Verificacion completada con evidencia real del proyecto. Acciones ejecutadas: 3"), false);
});
