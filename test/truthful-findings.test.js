"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isVendorOrGeneratedPath,
  isJunkRepairTargetPath,
  scanContentFindings,
  buildPlanFromEvidence,
  buildGroundedAnalysisReport,
  collectToolEvidence,
} = require("../runtime/evidence-grounding");
const { isJunkTarget, buildFixQueueFromReport } = require("../runtime/fix-queue");
const { buildDepthReportGuide, resolveAnalysisDepth } = require("../runtime/analysis-depth");

test("vendor/workbox no es target de correccion", () => {
  assert.equal(isVendorOrGeneratedPath("public/workbox-00a24876.js"), true);
  assert.equal(isJunkRepairTargetPath("public/workbox-00a24876.js"), true);
  assert.equal(isJunkTarget("public/workbox-00a24876.js"), true);
  assert.equal(isVendorOrGeneratedPath("public/sw.js"), true);
  assert.equal(isVendorOrGeneratedPath("src/lib/gpt-client.ts"), false);
});

test("catch vacio en workbox minificado no genera hallazgo", () => {
  const minified = 'define(["exports"],function(t){"use strict";try{self["workbox:core:6.5.4"]&&_()}catch(t){}const e=(t,...e)=>{let s=t;return e.length>0&&(s+=` :: ${JSON.stringify(e)}`),s};';
  const findings = scanContentFindings("public/workbox-00a24876.js", minified);
  assert.equal(findings.length, 0);
});

test("plan y cola no inventan correccion de workbox", () => {
  const evidence = {
    filesRead: [
      { path: "public/workbox-00a24876.js", content: "catch(t){}", contentHash: "x" },
      { path: "src/lib/gpt-client.ts", content: "export class GPTClient {}\n", contentHash: "y" },
    ],
    findings: [
      { path: "public/workbox-00a24876.js", line: 1, label: "catch vacio (errores silenciados)", evidence: "catch(t){}", source: "read_file" },
    ],
    listed: [],
    searches: [],
    toolLog: [],
  };
  const plan = buildPlanFromEvidence(evidence);
  assert.equal(plan.length, 0);
  const queue = buildFixQueueFromReport("## Cómo lo corregiré\n1. Corregir public/workbox-00a24876.js", evidence, { maxItems: 5 });
  assert.ok(!queue.some((item) => /workbox/i.test(item.target)));
  const report = buildGroundedAnalysisReport(evidence, "D:/demo", { prompt: "analiza el proyecto" });
  assert.match(report, /Sin hallazgos automaticos comprobables|No hay correcciones comprobables|Sin correcciones comprobables/i);
  assert.doesNotMatch(report, /Cuando autorices procedo/);
});

test("guia exige verdad comprobable y prohibe vendor", () => {
  const guide = buildDepthReportGuide(resolveAnalysisDepth("reporte completo del proyecto"));
  assert.match(guide, /100% comprobable|PROHIBIDO inventar/i);
  assert.match(guide, /workbox|vendor/i);
});
