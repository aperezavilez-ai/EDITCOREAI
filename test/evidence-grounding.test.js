"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectToolEvidence,
  validateGroundedAnalysisReport,
  groundAnalysisReport,
  buildExecutionEvidenceReport,
  verifyMutationsOnDisk,
  analysisEvidenceSufficient,
  requiredConcreteReads,
  buildEvidenceLedger,
} = require("../runtime/evidence-grounding");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("collectToolEvidence cuenta archivos leidos y mutados", () => {
  const evidence = collectToolEvidence([
    { name: "list_files", ok: true, input: { path: "." }, result: { entries: ["package.json", "src"] } },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: '{"name":"demo"}' } },
    { name: "read_file", ok: true, input: { path: "src/app.ts" }, result: { content: "export const x = 1;\n// TODO fix" } },
    { name: "read_file", ok: true, input: { path: "src/b.ts" }, result: { content: " const y = 2;" } },
    { name: "replace_in_file", ok: true, input: { path: "src/app.ts", oldText: "x", newText: "z" }, result: { ok: true } },
    { name: "run_command", ok: true, input: { command: "npm run lint" }, result: { output: "ok" } },
  ], "D:/demo");
  assert.equal(evidence.realFileReadCount, 3);
  assert.equal(evidence.mutationCount, 1);
  assert.ok(evidence.findings.some((item) => /TODO/i.test(item.label)));
  assert.equal(evidence.verifications.length, 1);
  assert.ok(buildEvidenceLedger(evidence.toolLog.length ? [] : [], "D:/demo"));
  assert.equal(evidence.ledger.entries.length, 6);
});

test("rechaza reportes que inventan backend/frontend sin evidencia", () => {
  const evidence = collectToolEvidence([
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: ["package.json", "src"] } },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: "{}" } },
    { name: "read_file", ok: true, input: { path: "src/page.tsx" }, result: { content: "export default function Page(){}" } },
    { name: "read_file", ok: true, input: { path: "src/lib.ts" }, result: { content: "export const a=1" } },
  ], "D:/demo");
  const invented = [
    "## Análisis del proyecto",
    "Estructura:",
    "backend/",
    "frontend/",
    "uploads/",
    "## Errores y riesgos encontrados",
    "Falta CORS en backend/server.js",
    "## Recomendaciones concretas",
    "Arreglar frontend",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  const validation = validateGroundedAnalysisReport(invented, evidence);
  assert.equal(validation.ok, false);
  assert.ok(validation.inventedRoots.includes("backend") || validation.inventedRoots.includes("frontend"));
});

test("groundAnalysisReport sustituye inventos por evidencia real", () => {
  const steps = [
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: ["package.json", "src/a.ts", "src/b.ts"] } },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: '{"scripts":{"lint":"eslint ."}}' } },
    { name: "read_file", ok: true, input: { path: "src/a.ts" }, result: { content: "// FIXME broken\nexport const a=1" } },
    { name: "read_file", ok: true, input: { path: "src/b.ts" }, result: { content: "export const b=2" } },
  ];
  const grounded = groundAnalysisReport("## Análisis\nbackend/ y frontend/ estan mal\nCuando autorices procedo con las correcciones.", steps, "D:/demo");
  assert.equal(grounded.replaced, true);
  assert.match(grounded.text, /Evidencia real de herramientas/);
  assert.match(grounded.text, /package\.json|src\/a\.ts/);
});

test("buildExecutionEvidenceReport exige mutacion y verificacion", () => {
  const noMutation = buildExecutionEvidenceReport("Listo", [
    { name: "read_file", ok: true, input: { path: "a.ts" }, result: { content: "x" } },
  ], "D:/demo");
  assert.equal(noMutation.ok, false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ev-"));
  fs.writeFileSync(path.join(root, "a.ts"), "z", "utf8");
  const ok = buildExecutionEvidenceReport("Corregido", [
    { name: "replace_in_file", ok: true, input: { path: "a.ts", oldText: "x", newText: "z" }, result: { ok: true } },
    { name: "run_command", ok: true, input: { command: "npm run lint" }, result: { output: "pass" } },
  ], root);
  assert.equal(ok.ok, true);
  assert.match(ok.text, /Qu[eé] hice|Archivos tocados|Evidencia real/);
  assert.match(ok.text, /a\.ts/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("verifyMutationsOnDisk detecta write mentiroso", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-disk-"));
  fs.writeFileSync(path.join(root, "a.js"), "old", "utf8");
  const steps = [
    { name: "write_file", ok: true, input: { path: "a.js", content: "new" }, result: { ok: true } },
    { name: "read_file", ok: true, input: { path: "a.js" }, result: { content: "old", isDirectory: false } },
  ];
  const soft = verifyMutationsOnDisk(steps, root);
  assert.equal(soft.ok, false);
  const strict = verifyMutationsOnDisk(steps, root, { strictDisk: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.failures.some((item) => /disco|confirma/i.test(item)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("requiredConcreteReads es adaptativo", () => {
  const small = collectToolEvidence([
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: [{ path: "only.js", kind: "file" }] } },
    { name: "read_file", ok: true, input: { path: "only.js" }, result: { content: "x", isDirectory: false } },
  ], "/tmp/x");
  assert.equal(requiredConcreteReads(small), 1);
  assert.equal(analysisEvidenceSufficient(small).ok, true);
});

test("discovery ledger bloquea paths inventados tras listar raiz", () => {
  const { createDiscoveryLedger } = require("../runtime/evidence-grounding");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ledger-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.writeFileSync(path.join(root, "next.config.js"), "module.exports={}");
  fs.mkdirSync(path.join(root, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app", "page.tsx"), "export default function Page(){}");
  const ledger = createDiscoveryLedger({ projectRoot: root });
  ledger.rememberList("", [
    { path: "package.json", kind: "file" },
    { path: "src", kind: "directory" },
    { path: "next.config.js", kind: "file" },
  ]);
  assert.doesNotThrow(() => ledger.assertReadable("package.json"));
  assert.doesNotThrow(() => ledger.assertReadable("next.config.js"));
  assert.throws(() => ledger.assertReadable("vite.config.js"), /no aparecio al listar|Path no descubierto|Antes de leer/);
  assert.throws(() => ledger.assertReadable("App.jsx"), /no aparecio al listar|Path no descubierto|Antes de leer/);
  // Archivo real bajo ancestro listado: permitir (no mentir con omitido).
  assert.doesNotThrow(() => ledger.assertReadable("src/app/page.tsx"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("bloquea narracion de creacion sin write_file", () => {
  const { narrationLooksLikeSimulatedWork } = require("../runtime/evidence-grounding");
  const fake = "He creado el proyecto con package.json y layout.tsx en la carpeta app.";
  assert.equal(narrationLooksLikeSimulatedWork(fake, [], "D:/x", { requiresWrite: true }), true);
  const steps = [{ name: "write_file", ok: true, input: { path: "app/layout.tsx" }, result: {} }];
  assert.equal(narrationLooksLikeSimulatedWork(fake, steps, "D:/x", { requiresWrite: true }), false);
});

test("detecta narracion Vite inventada sin evidencia", () => {
  const { narrationLooksLikeInventedAnalysis, collectToolEvidence } = require("../runtime/evidence-grounding");
  const steps = [
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: [{ path: "package.json", kind: "file" }, { path: "next.config.js", kind: "file" }, { path: "src", kind: "directory" }] } },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: '{"name":"calili","scripts":{"dev":"next dev"}}', isDirectory: false } },
  ];
  const fake = [
    "REPORTE DE ANALISIS",
    "vite.config.js",
    "src/App.jsx",
    "Vite + React",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  assert.equal(narrationLooksLikeInventedAnalysis(fake, steps, "D:/x"), true);
  const okReport = [
    "## Analisis",
    "Se leyo package.json (Next.js).",
    "## Evidencia real de herramientas",
    "- package.json",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");
  // Puede seguir fallando sufficiency de lecturas, pero no phantom vite si no lo menciona
  assert.equal(narrationLooksLikeInventedAnalysis("Solo package.json de Next sin vite.", steps, "D:/x"), false);
});

test("rechaza reporte que niega archivos leidos con read_file exitoso (bug forense)", () => {
  const {
    detectContradictoryEvidence,
    validateGroundedAnalysisReport,
    groundAnalysisReport,
    collectToolEvidence,
  } = require("../runtime/evidence-grounding");
  const steps = [
    { name: "list_files", ok: true, input: { path: "" }, result: { entries: ["src/calculator.js", "src/secret-module.js"] } },
    { name: "read_file", ok: true, input: { path: "src/calculator.js" }, result: { content: "function suma(a, b) {\n  return a - b;\n}\n\nmodule.exports = { suma };\n" } },
    { name: "read_file", ok: true, input: { path: "src/secret-module.js" }, result: { content: 'const REAL_EDITCORE_SECRET = "REALITY_SECRET_739184";\n\nmodule.exports = { REAL_EDITCORE_SECRET };\n' } },
    { name: "read_file", ok: false, input: { path: "calculator.js" }, result: { error: '"calculator.js" no aparecio al listar "."' } },
    { name: "read_file", ok: false, input: { path: "secret-module.js" }, result: { error: '"secret-module.js" no aparecio al listar "."' } },
  ];
  const evidence = collectToolEvidence(steps, "D:/PROGRAMAS IA/editcore-forensic-reality");
  const falseReport = [
    "## Reporte Final de Analisis",
    "Los archivos calculator.js y secret-module.js no existen en el proyecto.",
    "No puedo completar la tarea porque no fue posible determinar el secreto.",
    "Cuando autorices procedo con las correcciones.",
  ].join("\n");

  const contradiction = detectContradictoryEvidence(falseReport, evidence);
  assert.equal(contradiction.ok, false);
  assert.ok(contradiction.contradictions.some((item) => item.code === "CONTRADICTORY_EVIDENCE"));

  const validation = validateGroundedAnalysisReport(falseReport, evidence);
  assert.equal(validation.ok, false);
  assert.ok((validation.contradictoryEvidence || []).length >= 1);

  const grounded = groundAnalysisReport(falseReport, steps, "D:/PROGRAMAS IA/editcore-forensic-reality");
  assert.equal(grounded.replaced, true);
  assert.match(grounded.text, /return a - b/);
  assert.match(grounded.text, /REALITY_SECRET_739184/);
  assert.doesNotMatch(grounded.text, /no existen en el proyecto/i);
});

test("coverage map exige list_files reales carpeta por carpeta (forense)", () => {
  const {
    buildAnalysisCoverageMap,
    nextAnalysisWalkActions,
    analysisEvidenceSufficient,
    collectToolEvidence,
  } = require("../runtime/evidence-grounding");
  const { resolveAnalysisDepth } = require("../runtime/analysis-depth");
  const depthProfile = resolveAnalysisDepth("analisis forense del proyecto");
  assert.equal(depthProfile.folderByFolder, true);
  assert.ok(depthProfile.maxWalkDirs >= depthProfile.minListedDirs);

  const shallow = collectToolEvidence([
    {
      name: "list_files",
      ok: true,
      input: { path: "" },
      result: {
        entries: [
          { path: "package.json", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "app", kind: "directory" },
          { path: "REPORTE-ANALISIS.md", kind: "file" },
        ],
      },
    },
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: '{"name":"x"}' } },
  ], "D:/demo");

  const map = buildAnalysisCoverageMap(shallow, { prompt: "analisis forense", depthProfile });
  assert.equal(map.dirsListedCount, 1);
  assert.ok(map.pendingDirs.includes("src") || map.pendingDirs.includes("app"));
  assert.equal(map.ok, false);

  const next = nextAnalysisWalkActions(shallow, { prompt: "analisis forense", depthProfile });
  assert.ok(next.some((a) => a.name === "list_files" && /src|app/.test(String(a.input?.path || ""))));
  assert.equal(analysisEvidenceSufficient(shallow, { prompt: "analisis forense", depthProfile }).ok, false);

  const deeperSteps = [
    ...[
      { name: "list_files", ok: true, input: { path: "" }, result: { entries: [{ path: "package.json", kind: "file" }, { path: "src", kind: "directory" }, { path: "app", kind: "directory" }] } },
      { name: "list_files", ok: true, input: { path: "src" }, result: { entries: [{ path: "src/lib", kind: "directory" }, { path: "src/a.ts", kind: "file" }, { path: "src/b.ts", kind: "file" }] } },
      { name: "list_files", ok: true, input: { path: "app" }, result: { entries: [{ path: "app/page.tsx", kind: "file" }] } },
      { name: "list_files", ok: true, input: { path: "src/lib" }, result: { entries: [{ path: "src/lib/x.ts", kind: "file" }] } },
      { name: "list_files", ok: true, input: { path: "src/components" }, result: { entries: [{ path: "src/components/ui.tsx", kind: "file" }] } },
      { name: "list_files", ok: true, input: { path: "api" }, result: { entries: [{ path: "api/route.ts", kind: "file" }] } },
    ],
    { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: "{}" } },
    { name: "read_file", ok: true, input: { path: "src/a.ts" }, result: { content: "export const a=1" } },
    { name: "read_file", ok: true, input: { path: "src/b.ts" }, result: { content: "export const b=2" } },
    { name: "read_file", ok: true, input: { path: "app/page.tsx" }, result: { content: "export default function Page(){}" } },
    { name: "read_file", ok: true, input: { path: "src/lib/x.ts" }, result: { content: "export const x=3" } },
    { name: "read_file", ok: true, input: { path: "src/components/ui.tsx" }, result: { content: "export const Ui=()=>null" } },
    { name: "read_file", ok: true, input: { path: "api/route.ts" }, result: { content: "export async function GET(){}" } },
    { name: "read_file", ok: true, input: { path: "src/c.ts" }, result: { content: "export const c=4" } },
    { name: "read_file", ok: true, input: { path: "src/d.ts" }, result: { content: "export const d=5" } },
    { name: "read_file", ok: true, input: { path: "src/e.ts" }, result: { content: "export const e=6" } },
    { name: "read_file", ok: true, input: { path: "src/f.ts" }, result: { content: "export const f=7" } },
    { name: "read_file", ok: true, input: { path: "src/g.ts" }, result: { content: "export const g=8" } },
    { name: "read_file", ok: true, input: { path: "src/h.ts" }, result: { content: "export const h=9" } },
    { name: "read_file", ok: true, input: { path: "src/i.ts" }, result: { content: "export const i=10" } },
    { name: "read_file", ok: true, input: { path: "src/j.ts" }, result: { content: "export const j=11" } },
    { name: "read_file", ok: true, input: { path: "src/k.ts" }, result: { content: "export const k=12" } },
    { name: "read_file", ok: true, input: { path: "src/l.ts" }, result: { content: "export const l=13" } },
    { name: "read_file", ok: true, input: { path: "src/m.ts" }, result: { content: "export const m=14" } },
    { name: "read_file", ok: true, input: { path: "src/n.ts" }, result: { content: "export const n=15" } },
    { name: "read_file", ok: true, input: { path: "src/o.ts" }, result: { content: "export const o=16" } },
    { name: "search_files", ok: true, input: { query: "TODO" }, result: { matches: [] } },
    { name: "search_files", ok: true, input: { query: "FIXME" }, result: { matches: [] } },
    { name: "search_files", ok: true, input: { query: "throw new" }, result: { matches: [] } },
  ];
  const deepEvidence = collectToolEvidence(deeperSteps, "D:/demo");
  const deepMap = buildAnalysisCoverageMap(deepEvidence, { prompt: "analisis forense", depthProfile });
  assert.ok(deepMap.dirsListedCount >= depthProfile.minListedDirs, deepMap.summary);
  assert.ok(deepMap.codeFilesRead.length >= depthProfile.minCodeReads || deepEvidence.realFileReadCount >= depthProfile.minCodeReads, deepMap.summary);
  assert.equal(analysisEvidenceSufficient(deepEvidence, { prompt: "analisis forense", depthProfile }).ok, true, deepMap.summary);
});
