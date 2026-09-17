"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAnalysisCommand } = require("../command-policy");
const { resolveRunDeadlineMs, resolveAnalysisDepth } = require("../runtime/analysis-depth");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");

test("analisis forense: deadline 15 min, no 4 min", () => {
  assert.equal(resolveRunDeadlineMs({ analysisMode: true, prompt: "analisis forense TAXIDRIV" }), 900_000);
  assert.equal(resolveAnalysisDepth("analisis forense").depth, "forensic");
});

test("analisis bloquea lint/eslint/test/build", () => {
  for (const cmd of [
    "npm run lint",
    "npm run lint 2>&1 | head -200",
    "npm test",
    "npx eslint .",
    "npx eslint . --format json",
    "npx tsc --noEmit",
    "node --test",
    "npm run build",
  ]) {
    assert.throws(() => parseAnalysisCommand(cmd), /MODO ANALISIS|Comando no permitido|no permitidos/, cmd);
  }
  assert.deepEqual(parseAnalysisCommand("npm audit"), { executable: "npm", args: ["audit"] });
  assert.deepEqual(parseAnalysisCommand("git status"), { executable: "git", args: ["status"] });
});

test("main no bypassea analysis con cursorParity (candado lint)", () => {
  const mainSource = require("fs").readFileSync(require("path").join(__dirname, "..", "main.js"), "utf8");
  assert.match(mainSource, /shouldBlockHeavyVerification/);
  assert.match(mainSource, /forbidHeavy/);
  assert.doesNotMatch(mainSource, /cursorParityMode \? "full" : \(analysisMode \? "analysis"/);
});

test("CONTINUA/forense bloquean lint aunque analysisMode sea false", () => {
  const { shouldBlockHeavyVerification, isAnalysisHeavyVerificationCommand } = require("../command-policy");
  assert.equal(shouldBlockHeavyVerification({
    analysisMode: false,
    planAuthorized: false,
    prompt: "CONTINUA",
  }), true);
  assert.equal(shouldBlockHeavyVerification({
    analysisMode: false,
    planAuthorized: false,
    prompt: "Voy a ejecutar el analisis forense real",
  }), true);
  assert.equal(shouldBlockHeavyVerification({
    analysisMode: false,
    planAuthorized: true,
    prompt: "PROCEDE",
  }), false);
  assert.equal(isAnalysisHeavyVerificationCommand("npm run lint 2>&1 | head -200"), true);
});

test("CONTINUA solo NO autoriza plan (evita Plan no encontrado tras reinicio)", () => {
  assert.equal(
    resolveUnifiedAgentPlan({
      prompt: "CONTINUA",
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
      permissionMode: "full",
      resumableTask: true,
      workflowPhase: "interrupted",
      authorizedContinuation: true,
      planAuthorizedExecution: false,
    }).mode,
    MODES.DISCOVER,
  );
});

test("PROCEDE con plan autorizado SI escribe", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "PROCEDE",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    planAuthorizedExecution: true,
    resumableTask: true,
    workflowPhase: "awaiting_authorization",
    authorizedContinuation: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.analysisMode, false);
});

test("doc noise: reportes/estado .md no cuentan como evidencia de codigo", () => {
  const { isDocNoisePath, collectToolEvidence, isHollowAnalysisReport, groundAnalysisReport } = require("../runtime/evidence-grounding");
  assert.equal(isDocNoisePath("REPORTE-ANALISIS-COMPLETO.md"), true);
  assert.equal(isDocNoisePath("CORRECCIONES-APLICADAS.md"), true);
  assert.equal(isDocNoisePath("src/app/page.tsx"), false);
  const evidence = collectToolEvidence([
    {
      name: "read_file",
      ok: true,
      input: { path: "REPORTE-ANALISIS-COMPLETO.md" },
      result: { content: "# REPORTE\nFalta informacion crucial\n" },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "src/lib/calc.ts" },
      result: { content: "export function suma(a,b){ return a+b }\n" },
    },
  ], "D:/proj");
  assert.equal((evidence.filesRead || []).some((f) => /REPORTE/i.test(f.path)), false);
  assert.equal((evidence.filesRead || []).some((f) => /calc\.ts/i.test(f.path)), true);
  assert.equal(isHollowAnalysisReport("Verificacion completada con evidencia real del proyecto. Acciones: 12."), true);
  const grounded = groundAnalysisReport(
    "Verificacion completada con evidencia real del proyecto. Acciones ejecutadas: 9.",
    [
      {
        name: "read_file",
        ok: true,
        input: { path: "src/lib/calc.ts" },
        result: { content: "export function suma(a,b){ return a+b }\n" },
      },
    ],
    "D:/proj",
  );
  assert.equal(grounded.replaced, true);
  assert.doesNotMatch(grounded.text, /Verificacion completada con evidencia real/i);
  assert.match(grounded.text, /Qu[eé] s[ií] funcion[oó]/i);
});

test("adapter nunca shippea Verificacion meta en analisis", () => {
  const adapterSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /Verificacion completada con evidencia real/);
  assert.match(adapterSrc, /isHollowAnalysisReport/);
  assert.match(adapterSrc, /ROADMAP|COVERAGE_MAP/i);
});

test("walker cobertura: adapter usa nextAnalysisWalkActions + COVERAGE_MAP", () => {
  const adapterSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /nextAnalysisWalkActions/);
  assert.match(adapterSrc, /formatCoverageBlock/);
  assert.match(adapterSrc, /COVERAGE_MAP/);
  const depth = require("../runtime/analysis-depth").resolveAnalysisDepth("analisis forense");
  assert.equal(depth.maxWalkDirs >= 18, true);
  assert.equal(depth.minListedDirs >= 6, true);
});

test("diagnostico acotado: typecheck permitido solo con flag; lint sigue bloqueado", () => {
  const {
    parseAnalysisCommand,
    isAcotadoDiagnosticCommand,
    isAnalysisHeavyVerificationCommand,
  } = require("../command-policy");
  assert.equal(isAcotadoDiagnosticCommand("npx tsc --noEmit"), true);
  assert.equal(isAcotadoDiagnosticCommand("npm run typecheck"), true);
  assert.equal(isAcotadoDiagnosticCommand("npm run lint"), false);
  assert.equal(isAnalysisHeavyVerificationCommand("npx tsc --noEmit"), true);
  assert.throws(() => parseAnalysisCommand("npx tsc --noEmit"), /MODO ANALISIS/);
  assert.deepEqual(
    parseAnalysisCommand("npx tsc --noEmit", { allowAcotadoDiagnostic: true }),
    { executable: "npx", args: ["tsc", "--noEmit"] },
  );
  assert.throws(() => parseAnalysisCommand("npm run lint", { allowAcotadoDiagnostic: true }), /MODO ANALISIS/);
});

test("cola de fixes: narracion sin mutacion se rechaza; typecheck exige verify", () => {
  const {
    assessFixQueue,
    buildExecutionEvidenceReport,
    extractDiagnosticFindings,
  } = require("../runtime/evidence-grounding");
  const lied = assessFixQueue([], "D:/demo", {
    finalText: "He corregido src/broken.ts y app/page.tsx. Listo.",
  });
  assert.equal(lied.ok, false);
  assert.ok(lied.reasons.some((r) => /sin mutacion/i.test(r)));

  const steps = [
    {
      name: "replace_in_file",
      ok: true,
      input: { path: "src/broken.ts", oldText: "a", newText: "b" },
      result: { ok: true },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "src/broken.ts" },
      result: { content: "b" },
    },
  ];
  const noDiag = buildExecutionEvidenceReport("Corregido src/broken.ts", steps, "D:/demo", {
    requireDiagnosticVerify: true,
  });
  assert.equal(noDiag.ok, false);
  assert.ok(noDiag.reasons.some((r) => /diagnostica/i.test(r)));

  const withDiag = [
    ...steps,
    {
      name: "run_command",
      ok: true,
      input: { command: "npx tsc --noEmit" },
      result: { output: "src/other.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'." },
    },
  ];
  const okReport = buildExecutionEvidenceReport("Corregido src/broken.ts", withDiag, "D:/demo", {
    requireDiagnosticVerify: true,
  });
  assert.equal(okReport.ok, true, okReport.reasons.join("; "));
  const findings = extractDiagnosticFindings(withDiag);
  assert.ok(findings.some((f) => /TS2322/.test(f.label) && /other\.ts/.test(f.path)));
});
