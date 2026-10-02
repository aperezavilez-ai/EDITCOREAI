"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tools = require("../editcore-chat-kernel/tools");
const { runAnalyst } = require("../editcore-chat-kernel/subagents/analyst");
const {
  syncProjectRoadmap,
  appendPatchSummaryToRoadmap,
  buildRoadmapSyncFromRun,
  isCuratedRoadmap,
} = require("../runtime/project-roadmap");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-truthful-"));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

function bigModule(functions = 300) {
  const rows = [];
  for (let i = 0; i < functions; i += 1) {
    rows.push(`function helper${i}(value) {`, `  return value + ${i};`, "}", "");
  }
  rows.push(`module.exports = { helper0, helper${functions - 1} };`, "");
  return rows.join("\n");
}

test("read_file parcial declara el rango y no marca el archivo como truncado", () => withTempDir((dir) => {
  fs.writeFileSync(path.join(dir, "big.js"), bigModule());
  const res = tools.readFile(dir, "big.js", 2000);
  assert.equal(res.ok, true);
  assert.equal(res.partial, true);
  assert.equal(res.totalLines, 1201);
  assert.equal(res.startLine, 1);
  assert.ok(res.endLine > 1 && res.endLine < res.totalLines);
  assert.doesNotMatch(res.content, /\[truncado\]/);
  assert.equal(res.content.split("\n").length, res.endLine);
  assert.match(res.note, /NO está truncado/);
  assert.match(res.note, new RegExp(`startLine=${res.endLine + 1}`));
}));

test("read_file continúa por startLine hasta el final del archivo", () => withTempDir((dir) => {
  fs.writeFileSync(path.join(dir, "big.js"), bigModule());
  const first = tools.readFile(dir, "big.js", 2000);
  const tail = tools.readFile(dir, "big.js", 2000, { startLine: 1190 });
  assert.equal(tail.startLine, 1190);
  assert.equal(tail.endLine, 1201);
  assert.match(tail.content, /module\.exports = \{ helper0, helper299 \};/);
  const next = tools.readFile(dir, "big.js", 2000, { startLine: first.endLine + 1 });
  assert.equal(next.startLine, first.endLine + 1);
  const outOfRange = tools.readFile(dir, "big.js", 2000, { startLine: 5000 });
  assert.equal(outOfRange.ok, false);
  assert.match(outOfRange.error, /1201 líneas/);
}));

test("read_file completo no es parcial y la tool respeta startLine/endLine", () => withTempDir(async (dir) => {
  fs.writeFileSync(path.join(dir, "small.js"), "const a = 1;\nconst b = 2;\nmodule.exports = { a, b };\n");
  const whole = tools.readFile(dir, "small.js", 2000);
  assert.equal(whole.partial, false);
  assert.equal(whole.totalLines, 3);
  assert.equal(whole.note, undefined);
  const ranged = await tools.execute("read_file", { path: "small.js", startLine: 2, endLine: 2 }, dir, false, {});
  assert.equal(ranged.content, "const b = 2;");
  assert.equal(ranged.startLine, 2);
  assert.equal(ranged.endLine, 2);
  const def = tools.DEFINITIONS.find((t) => t.function?.name === "read_file");
  assert.ok(def.function.parameters.properties.startLine);
  assert.ok(def.function.parameters.properties.endLine);
  assert.doesNotMatch(def.function.description, /\(truncado\)/);
}));

test("el recorte de payload de tools aclara que no es un problema del archivo", () => {
  const out = tools.truncatePayload("x".repeat(3000), 2000);
  assert.match(out, /no un problema del archivo/);
});

test("el analista entrega encabezados de integridad reales y reglas de evidencia", () => withTempDir(async (dir) => {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node --test" } }, null, 2));
  fs.writeFileSync(path.join(dir, "main.js"), bigModule());
  const out = await runAnalyst({ projectRoot: dir, maxReads: 6, userMessage: "analiza el proyecto" });
  assert.match(out.report, /### main\.js — 1201 líneas, \d+ bytes · extracto: líneas 1-\d+ \(el archivo continúa\) · sintaxis JS OK \(archivo completo\)/);
  assert.match(out.report, /### package\.json — .*JSON válido/);
  assert.doesNotMatch(out.report, /\[truncado\]/);
  assert.match(out.report, /No ejecutado en este análisis/);
  assert.match(out.report, /## Reglas de evidencia/);
}));

test("el analista detecta un archivo realmente cortado", () => withTempDir(async (dir) => {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  fs.writeFileSync(path.join(dir, "main.js"), "function ok() {\n  return 1;\n}\nfunction roto() {\n  if (true) {\n    return 2;\n");
  const out = await runAnalyst({ projectRoot: dir, maxReads: 4, userMessage: "analiza" });
  assert.match(out.report, /### main\.js — .*ERROR: el archivo termina a mitad de código/);
  assert.match(out.report, /package\.json no define script `test`/);
}));

test("el prompt de análisis prohíbe reportar extractos como archivos truncados", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(src, /PROHIBIDO reportar un archivo como 'truncado'/);
  assert.match(src, /no verificado en este analisis/);
  assert.match(src, /task: this\._currentUserText \|\| message/);
});

const CURATED = [
  "# DEMO — ROADMAP",
  "",
  "## Proceso",
  "- Fase: implementacion",
  "- Estado: 1.2.0 — estado escrito a mano",
  "- Actualizado: 2026-01-01",
  "",
  "## Mapa",
  "- package.json — metadata",
  "",
  "### src/",
  "- app.js — servidor",
  "- db.js — base de datos",
  "",
  "## Tarea activa",
  "- Sin tarea en curso.",
  "",
  "## Cambios recientes (2026-01-01)",
  "- Hallazgos:",
  "  - `abc123` fix #1 escrito a mano",
  "",
  "## Hechos del proyecto",
  "- Nota que solo existe aquí.",
  "",
].join("\r\n");

test("un análisis de solo lectura no reescribe un ROADMAP curado", () => withTempDir((dir) => {
  const file = path.join(dir, "ROADMAP.md");
  const padded = CURATED + `${"- relleno largo para pasar el tope de 8000 caracteres\r\n".repeat(200)}## Final\r\n- cola que debe sobrevivir\r\n`;
  fs.writeFileSync(file, padded);
  assert.equal(isCuratedRoadmap(padded), true);
  const payload = buildRoadmapSyncFromRun({
    analysisMode: true,
    completed: true,
    task: "Pregunta del usuario: analiza el proyecto\nEvidencia relevante: ...",
    steps: [{ name: "read_file", ok: true, input: { path: "src/app.js" }, result: { content: "x" } }],
  });
  const res = syncProjectRoadmap(dir, payload);
  assert.equal(res.updated, false);
  assert.equal(fs.readFileSync(file, "utf8"), padded);
}));

test("un cambio real parchea el ROADMAP curado sin perder lo escrito a mano", () => withTempDir((dir) => {
  const file = path.join(dir, "ROADMAP.md");
  fs.writeFileSync(file, CURATED);
  const payload = buildRoadmapSyncFromRun({
    completed: true,
    task: "agrega login",
    steps: [{ name: "write_file", ok: true, input: { path: "src/login.js" }, result: { ok: true } }],
  });
  const res = syncProjectRoadmap(dir, payload);
  assert.equal(res.updated, true);
  const next = fs.readFileSync(file, "utf8");
  assert.ok(next.includes("\r\n"));
  assert.doesNotMatch(next.replace(/\r\n/g, ""), /\n/);
  assert.match(next, /### src\/\r\n- app\.js — servidor/);
  assert.match(next, /  - `abc123` fix #1 escrito a mano/);
  assert.match(next, /## Hechos del proyecto\r\n- Nota que solo existe aquí\./);
  assert.match(next, /- Estado: 1\.2\.0 — estado escrito a mano/);
  assert.doesNotMatch(next, /- Actualizado: 2026-01-01\r\n/);
  assert.match(next, /## Tarea activa\r\n- agrega login\r\n/);
  assert.match(next, /## Cambios recientes \(2026-01-01\)\r\n- \[EditCore\] src\/login\.js — agrega login\r\n- Hallazgos:/);
}));

test("appendPatchSummaryToRoadmap en ROADMAP curado no duplica ni crece sin límite", () => withTempDir((dir) => {
  const file = path.join(dir, "ROADMAP.md");
  fs.writeFileSync(file, CURATED);
  const autoLines = () => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.startsWith("- [EditCore] "));
  appendPatchSummaryToRoadmap(dir, { path: "src/app.js", summary: "primero" });
  appendPatchSummaryToRoadmap(dir, { path: "src/app.js", summary: "segundo" });
  const appLines = autoLines().filter((line) => line.includes("src/app.js"));
  assert.equal(appLines.length, 1);
  assert.match(appLines[0], /segundo/);
  for (let i = 0; i < 15; i += 1) appendPatchSummaryToRoadmap(dir, { path: `src/f${i}.js`, summary: "x" });
  assert.equal(autoLines().length, 10);
  assert.match(autoLines()[0], /src\/f14\.js/);
  const next = fs.readFileSync(file, "utf8");
  assert.match(next, /### src\/\r\n- app\.js — servidor/);
  assert.match(next, /## Hechos del proyecto/);
}));
