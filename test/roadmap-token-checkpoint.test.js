"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildRoadmapSyncFromRun,
  syncProjectRoadmap,
  readRoadmap,
} = require("../runtime/project-roadmap");
const { resolveHarnessProfile } = require("../runtime/agent-token-harness");

test("buildRoadmapSyncFromRun incluye archivos leidos y gaps del reporte", () => {
  const payload = buildRoadmapSyncFromRun({
    analysisMode: true,
    completed: true,
    task: "analiza el proyecto",
    steps: [
      { name: "list_files", ok: true, input: { path: "" }, result: { entries: [] } },
      { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: "{}" } },
      { name: "read_file", ok: true, input: { path: "src/app.ts" }, result: { content: "export {}" } },
    ],
    reportText: [
      "## Qué falta para que funcione",
      "- Falta .env con SUPABASE_URL",
      "- npm install pendiente",
      "",
      "## Evidencia",
    ].join("\n"),
  });
  assert.ok(payload.files.includes("package.json"));
  assert.ok(payload.files.includes("src/app.ts"));
  assert.match(payload.nextAction, /Gaps:|SUPABASE|\.env|npm install/i);
  assert.match(payload.status, /Analisis cerrado|indice compacto/i);
});

test("syncProjectRoadmap escribe checkpoint mid-run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-roadmap-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"demo"}', "utf8");
    const payload = buildRoadmapSyncFromRun({
      analysisMode: true,
      completed: false,
      task: "reporte completo",
      steps: [
        { name: "read_file", ok: true, input: { path: "package.json" }, result: { content: "{}" } },
      ],
    });
    syncProjectRoadmap(dir, payload);
    const loaded = readRoadmap(dir);
    assert.equal(loaded.exists, true);
    assert.match(loaded.content, /package\.json/);
    assert.match(loaded.content, /checkpoint|en curso|Analisis/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("harness analisis compacta mas agresivo", () => {
  const full = resolveHarnessProfile({ depth: "deep" }, null, {});
  const analysis = resolveHarnessProfile({ depth: "deep" }, null, { analysisMode: true });
  assert.equal(analysis.maxParallelReads, 1);
  assert.ok(Number(analysis.maxToolResultChars || analysis.toolResultChars || 0) <= Number(full.maxToolResultChars || full.toolResultChars || 8000));
  assert.ok(analysis.maxParallelReads <= full.maxParallelReads);
});

test("main y adapter cablean checkpoint ROADMAP + compact mid-run", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const adapterSrc = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(mainSrc, /onAnalysisCheckpoint/);
  assert.match(mainSrc, /buildRoadmapSyncFromRun/);
  assert.match(mainSrc, /ROADMAP siempre \(analisis o escritura\)/);
  assert.match(adapterSrc, /maybeCompactAndCheckpointAnalysis/);
  assert.match(adapterSrc, /onAnalysisCheckpoint/);
});
