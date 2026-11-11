"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPlanFromEvidence,
  isHollowAnalysisReport,
  detectContradictoryEvidence,
  collectToolEvidence,
  buildGroundedAnalysisReport,
} = require("../runtime/evidence-grounding");
const ProjectAnalysis = require("../project-analysis");

const appRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");

test("F1: planAuthorized anula NO MODIFICAR en authorize", () => {
  // [COSECHA MODO AGENTE] El authorize() del despachador legado
  // (authorizedToMutate/readonlyDiagnostic) salió con la rama. En la ruta
  // del kernel, la ejecución autorizada entra con Acceso completo:
  // fullAccess y planAuthorizedExecution ligados a permissionHint "full".
  const agentRun = mainSource.slice(mainSource.indexOf('ipcMain.handle("agent:run"'));
  assert.match(agentRun, /fullAccess: permissionHint === "full"/);
  assert.match(agentRun, /planAuthorizedExecution: permissionHint === "full"/);
});

test("F1b: authorizedPlanExecutionPrompt anula diagnostico y evita .md basura", () => {
  const prompt = ProjectAnalysis.authorizedPlanExecutionPrompt({
    task: "MODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS\nAudita runtime",
    plan: "Corregir .claude/ANALISIS_ERRORES_EDITCORE.md con replace_in_file\nCorregir resources/app/runtime/editcore-claude-adapter.js",
  });
  assert.match(prompt, /ANULADAS|ANULADO/i);
  assert.match(prompt, /Puedes usar write_file/);
  assert.doesNotMatch(prompt, /MODO:\s*DIAGN/i);
  assert.doesNotMatch(prompt, /NO MODIFICAR ARCHIVOS/);
  assert.doesNotMatch(prompt, /Corregir \.claude\/ANALISIS_ERRORES/);
  assert.match(prompt, /editcore-claude-adapter/);
});

test("F2: buildPlanFromEvidence ignora ANALISIS_ERRORES.md", () => {
  const plan = buildPlanFromEvidence({
    findings: [
      { path: ".claude/ANALISIS_ERRORES_EDITCORE.md", label: "TODO" },
      { path: "resources/app/runtime/action-registry.js", label: "cache" },
    ],
    filesRead: [
      { path: ".claude/ANALISIS_ERRORES_EDITCORE.md" },
      { path: "resources/app/runtime/action-registry.js" },
    ],
  });
  assert.equal(plan.some((item) => /ANALISIS_ERRORES/i.test(item.target)), false);
  assert.ok(plan.some((item) => /action-registry/.test(item.target)));
});

test("F2b: analysisRepairPrompt prioriza runtime y anula NO MODIFICAR", () => {
  assert.match(rendererSource, /diagnostico NO MODIFICAR queda ANULADO/);
  assert.match(rendererSource, /PROHIBIDO usar replace_in_file solo para \.claude/);
});

test("F3: informe 'sin detalle de linea' es hueco/contradictorio", () => {
  const hollow = "read_file ejecutado ✔ — sin detalle de línea retenido\nNo conserva funciones ni números de línea citables.";
  assert.equal(isHollowAnalysisReport(`${hollow}\n${"Falta información en el contexto.\n".repeat(4)}`), true);
  const evidence = collectToolEvidence([
    {
      name: "read_file",
      ok: true,
      input: { path: "runtime/a.js" },
      result: { content: "function executeTask() {\n  if (analysisMode) return false;\n}\n" },
    },
  ], "D:/proj");
  const check = detectContradictoryEvidence(hollow, evidence);
  assert.equal(check.ok, false);
});

test("F3c: grounded report no recomienda .claude md", () => {
  const report = buildGroundedAnalysisReport({
    projectRoot: "D:/proj",
    listed: [{ path: "resources" }],
    filesRead: [
      { path: ".claude/ANALISIS_ERRORES_EDITCORE.md", content: "TODO fallback", forensicExcerpts: [] },
      {
        path: "resources/app/runtime/action-registry.js",
        content: "class ActionRegistry { wasExecuted() {} }",
        forensicExcerpts: [{ line: 1, text: "class ActionRegistry" }],
      },
    ],
    findings: [
      { path: ".claude/ANALISIS_ERRORES_EDITCORE.md", line: 60, label: "TODO", evidence: "TODO" },
    ],
    searches: [],
    toolLog: [],
    ledger: { entries: [] },
    realFileReadCount: 2,
  });
  assert.doesNotMatch(report, /Corregir \.claude\/ANALISIS_ERRORES/);
  assert.match(report, /FORENSIC_EXCERPTS|ActionRegistry/);
});
