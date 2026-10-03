"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fc = require("../editcore-chat-kernel/forensic-checks");
const { runVerifier } = require("../editcore-chat-kernel/subagents/verifier");

function tempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-forensic-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function withProject(files, fn) {
  const dir = tempProject(files);
  return Promise.resolve().then(() => fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

const keysOf = (res, check) => res.findings.filter((f) => f.check === check).map((f) => f.key);

test("el lexer distingue imports reales de strings, comentarios, try/catch y regex", () => {
  const src = [
    "const a = require('./a');",
    "// const b = require('./comentado');",
    "const fixture = 'const c = require(\"./en-string\")';",
    "const tpl = `import x from \"./en-template\"`;",
    "const re = /\"/g; const d = require(\"./despues-de-regex\");",
    "try { require('./opcional'); } catch { require('../fallback'); }",
    "function lazy() { return require('pkg-lazy'); }",
    "import e from './esm';",
    "export * from './reexport';",
    "const f = import('./dinamico');",
  ].join("\n");
  const specs = fc.scanModuleSpecifiers(src);
  const bySpec = Object.fromEntries(specs.map((s) => [s.spec, s]));
  assert.deepEqual(Object.keys(bySpec).sort(), ["../fallback", "./a", "./despues-de-regex", "./dinamico", "./esm", "./opcional", "./reexport", "pkg-lazy"].sort());
  assert.equal(bySpec["./a"].line, 1);
  assert.equal(bySpec["./a"].optional, false);
  assert.equal(bySpec["./opcional"].optional, true);
  assert.equal(bySpec["../fallback"].optional, true);
  assert.equal(bySpec["pkg-lazy"].lazy, true);
  assert.equal(bySpec["./a"].lazy, false);
});

test("detecta sintaxis rota, JSON inválido, imports rotos y conflictos con archivo y línea", () => withProject({
  "package.json": JSON.stringify({ name: "demo", dependencies: { "dep-declarada": "1.0.0" } }),
  "node_modules/.keep": "",
  "ok.js": "const x = require('./util');\ntry { require('./no-existe-opcional'); } catch {}\nmodule.exports = x;\n",
  "util.js": "module.exports = 1;\n",
  "cortado.js": "function a() {\n  if (true) {\n    return 1;\n",
  "malo.js": "const = 5;\n",
  "roto.js": "const ok = 1;\nconst falta = require('./fantasma');\n",
  "usa-dep.js": "const d = require('dep-declarada');\n",
  "usa-ausente.js": "const z = require('paquete-ausente');\n",
  "lazy.js": "function f() { return require('otro-ausente'); }\nmodule.exports = f;\n",
  "config.json": "{ clave: 1 }",
  "conflicto.js": "const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n=======\nconst b = 3;\n>>>>>>> rama\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: false, runTypecheck: false });
  const find = (file) => res.findings.filter((f) => f.file === file);
  assert.match(find("cortado.js")[0].message, /termina a mitad de código/);
  assert.match(find("malo.js")[0].message, /Error de sintaxis/);
  assert.equal(find("malo.js")[0].line, 1);
  assert.match(find("config.json")[0].message, /JSON inválido/);
  const roto = find("roto.js").find((f) => f.check === "imports");
  assert.equal(roto.line, 2);
  assert.match(roto.message, /\.\/fantasma/);
  assert.equal(find("ok.js").length, 0);
  assert.match(find("usa-dep.js")[0].message, /declarado en package\.json pero no está instalado/);
  assert.equal(find("usa-ausente.js")[0].severity, "error");
  assert.equal(find("lazy.js")[0].severity, "warning");
  assert.ok(find("conflicto.js").some((f) => f.check === "conflicts" && f.line === 2));
  assert.equal(res.ok, false);
  assert.ok(res.counts.error >= 6);
}));

test("env compara solo nombres y nunca expone valores", () => withProject({
  "package.json": JSON.stringify({ name: "demo" }),
  ".env.example": "API_URL=\nSECRET_KEY=\nVACIA=\n",
  ".env.local": "API_URL=https://x\nVACIA=\nOTRA=SUPERSECRETO123\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: false, runTypecheck: false });
  const md = fc.formatForensicMarkdown(res);
  assert.ok(res.findings.some((f) => f.key === "env|SECRET_KEY"));
  assert.ok(res.findings.some((f) => f.key === "env|VACIA|empty"));
  assert.ok(!res.findings.some((f) => f.key.startsWith("env|API_URL")));
  assert.doesNotMatch(md, /SUPERSECRETO123|https:\/\/x/);
}));

test("referencias rotas en documentación y exclusiones declaradas en package.json", () => withProject({
  "package.json": JSON.stringify({ name: "demo", editcoreForensic: { skip: ["plantillas"] } }),
  "AGENTS.md": "Ver `src/existe.js` y `src/no-existe.js`.\n",
  "src/existe.js": "module.exports = 1;\n",
  "plantillas/app.js": "require('./no-esta');\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: false, runTypecheck: false });
  const docs = res.findings.filter((f) => f.check === "docs");
  assert.equal(docs.length, 1);
  assert.match(docs[0].message, /src\/no-existe\.js/);
  assert.equal(docs[0].line, 1);
  assert.ok(!res.findings.some((f) => f.file.startsWith("plantillas/")));
  assert.deepEqual(res.excluded, ["plantillas"]);
  assert.match(fc.formatForensicMarkdown(res), /Excluido por configuración del proyecto: `plantillas`/);
}));

test("sin falsos positivos: lazy protegido con require.resolve y docs que listan archivos eliminados", () => withProject({
  "package.json": JSON.stringify({ name: "demo" }),
  "node_modules/.keep": "",
  "opcional.js": "function f() { return require('pw-opcional'); }\nasync function g() {\n  try {\n    require.resolve('pw-opcional');\n    return f();\n  } catch { return null; }\n}\nmodule.exports = g;\n",
  "ROADMAP.md": [
    "- Hallazgos pendientes: `runtime/borrado.js` ya no existe.",
    "- Archivos eliminados en la limpieza:",
    "  - `src/viejo-a.js`",
    "  - `src/viejo-b.js`",
    "- Sigue vigente `src/real.js` y `src/falta.js`.",
  ].join("\n"),
  "src/real.js": "module.exports = 1;\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: false, runTypecheck: false });
  assert.ok(!res.findings.some((f) => f.file === "opcional.js"));
  const docs = res.findings.filter((f) => f.check === "docs");
  assert.equal(docs.length, 1);
  assert.match(docs[0].message, /src\/falta\.js/);
  assert.equal(docs[0].line, 5);
}));

test("el reporte del modelo no repite la tabla de chequeos ni los verificados que ya van arriba", () => {
  const modelText = [
    "## 📊 Resumen ejecutivo",
    "- Proyecto Electron.",
    "",
    "## ⚠️ Errores verificados: prioridad y causa",
    "Sin errores ni advertencias verificados.",
    "",
    "## 📁 Evidencia real",
    "| Archivo | Líneas |",
    "|---|---|",
    "| main.js | 1-74 |",
    "",
    "## 🧪 Chequeos reales ejecutados",
    "| Chequeo | Resultado | Detalle |",
    "|---|---|---|",
    "| Tests | ✅ pasa | 897 tests |",
    "",
    "### ❌ Errores verificados",
    "- **0 errores** detectados por los chequeos ejecutados.",
    "",
    "**⚠️ Advertencias verificadas (0)**",
    "Ninguna.",
    "_Excluido por configuración del proyecto: `x`._",
    "",
    "¿Querés que profundice en algún módulo?",
  ].join("\n");
  const out = fc.stripRepeatedForensic(modelText);
  assert.doesNotMatch(out, /Chequeos reales ejecutados|897 tests|0 errores|Advertencias verificadas|Excluido por/);
  assert.match(out, /## ⚠️ Errores verificados: prioridad y causa\nSin errores ni advertencias verificados\./);
  assert.match(out, /\| main\.js \| 1-74 \|/);
  assert.match(out, /¿Querés que profundice en algún módulo\?$/);
  assert.equal(fc.stripRepeatedForensic("## Resumen\n- a"), "## Resumen\n- a");

  const orch = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(orch, /\$\{verifiedMd\}\\n\\n---\\n\\n\$\{forensic\.stripRepeatedForensic\(res\.text\)\}/);
  assert.doesNotMatch(orch, /En este modo no se ejecutan tests ni builds/);
  assert.doesNotMatch(fc.formatForensicPromptBlock({ checks: [], findings: [], counts: { error: 0, warning: 0 } }), /lista TODOS los hallazgos/);
});

test("respaldos y copias viejas se excluyen y se informan", () => withProject({
  "package.json": JSON.stringify({ name: "demo" }),
  "src/app.js": "module.exports = require('./util');\n",
  "src/util.js": "module.exports = 1;\n",
  "_backups/pre-v1/app.js": "require('./falta');\n",
  "src.bak/app.js": "require('./falta');\n",
  "respaldo-2026/app.js": "require('./falta');\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: false, runTypecheck: false });
  assert.equal(res.counts.error, 0);
  assert.deepEqual([...res.autoExcluded].sort(), ["_backups", "respaldo-2026", "src.bak"]);
  assert.match(fc.formatForensicMarkdown(res), /Excluido automáticamente/);
}));

test("corre los tests reales del proyecto y reporta cada test fallando", () => withProject({
  "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
  "a.test.js": "const test = require('node:test');\nconst assert = require('node:assert');\ntest('suma bien', () => assert.equal(1 + 1, 2));\ntest('resta mal', () => assert.equal(2 - 1, 5));\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: true, runTypecheck: false, testTimeoutMs: 120_000 });
  const tests = res.checks.find((c) => c.id === "tests");
  assert.equal(tests.status, "fail");
  assert.match(tests.summary, /2 tests, 1 pass, 1 fail/);
  const failing = res.findings.filter((f) => f.check === "tests");
  assert.ok(failing.some((f) => /resta mal/.test(f.message)));
  assert.ok(!failing.some((f) => /suma bien/.test(f.message)));
}));

test("sin script de test lo dice en vez de inventar un resultado", () => withProject({
  "package.json": JSON.stringify({ name: "demo", scripts: { test: "echo \"Error: no test specified\" && exit 1" } }),
  "index.js": "module.exports = 1;\n",
}, async (dir) => {
  const res = await fc.runForensicChecks(dir, { runTests: true, runTypecheck: false });
  const tests = res.checks.find((c) => c.id === "tests");
  assert.equal(tests.status, "skipped");
  assert.match(tests.summary, /no tiene script `test`/);
}));

test("parsers de salida de tests y typecheck", () => {
  const node = fc.parseTestOutput("✖ falla uno (2.1ms)\n  at TestContext.<anonymous> (D:\\p\\test\\a.test.js:12:5)\nℹ tests 3\nℹ pass 2\nℹ fail 1\nℹ skipped 0\n✖ failing tests:\n✖ falla uno (2.1ms)\n");
  assert.deepEqual([node.total, node.passed, node.failed], [3, 2, 1]);
  assert.equal(node.failures.length, 1);
  assert.equal(node.failures[0].loc.line, 12);
  const jest = fc.parseTestOutput("  ● Suite › hace algo\n\nTests:       1 failed, 4 passed, 5 total\n");
  assert.deepEqual([jest.total, jest.passed, jest.failed], [5, 4, 1]);
  assert.equal(jest.failures[0].name, "Suite › hace algo");
  const vitest = fc.parseTestOutput(" FAIL  src/a.test.ts > grupo > caso\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)\n");
  assert.deepEqual([vitest.total, vitest.passed, vitest.failed], [4, 3, 1]);
  const mocha = fc.parseTestOutput("  7 passing (20ms)\n  2 failing\n");
  assert.deepEqual([mocha.total, mocha.passed, mocha.failed], [9, 7, 2]);
  const tsc = fc.parseTscOutput("src/app.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.\n", "D:\\p");
  assert.equal(tsc[0].file, "src/app.ts");
  assert.equal(tsc[0].line, 4);
  assert.match(tsc[0].message, /TS2322/);
});

test("antes/después: resuelto solo si el chequeo que lo detectó ahora pasa", () => {
  const before = {
    checks: [{ id: "syntax", status: "fail" }, { id: "tests", status: "fail" }],
    findings: [
      { check: "syntax", key: "syntax|a.js", file: "a.js", severity: "error", message: "x" },
      { check: "syntax", key: "syntax|b.js", file: "b.js", severity: "error", message: "x" },
      { check: "tests", key: "tests|t1", file: "", severity: "error", message: "Test fallando: t1" },
    ],
  };
  const fullAfter = {
    checks: [{ id: "syntax", status: "fail" }],
    findings: [
      { check: "syntax", key: "syntax|b.js", file: "b.js", severity: "error", message: "x" },
      { check: "syntax", key: "syntax|c.js", file: "c.js", severity: "error", message: "nuevo" },
    ],
  };
  const cmp = fc.compareForensic(before, fullAfter);
  assert.deepEqual(cmp.resolved.map((f) => f.key), ["syntax|a.js"]);
  assert.deepEqual(cmp.remaining.map((f) => f.key), ["syntax|b.js"]);
  assert.deepEqual(cmp.introduced.map((f) => f.key), ["syntax|c.js"]);
  assert.deepEqual(cmp.unverified.map((f) => f.key), ["tests|t1"]);
  const scoped = fc.compareForensic(before, { checks: [{ id: "syntax", status: "pass" }], findings: [], onlyFiles: ["a.js"] });
  assert.deepEqual(scoped.resolved.map((f) => f.key), ["syntax|a.js"]);
  assert.ok(scoped.unverified.some((f) => f.key === "syntax|b.js"));
  assert.match(fc.formatComparisonMarkdown(cmp), /Resueltos \(el chequeo que los detectó ahora pasa\): 1/);
});

test("el verificador nunca dice OK sin verificar y detecta errores reales", () => withProject({
  "package.json": JSON.stringify({ name: "demo" }),
  "index.js": "module.exports = 1;\n",
}, async (dir) => {
  const okRun = await runVerifier({ projectRoot: dir, learn: false });
  assert.equal(okRun.verified, true);
  assert.equal(okRun.testsRan, false);
  assert.equal(okRun.skippedHeavyBuild, undefined);
  assert.match(okRun.report, /solo se verificó sintaxis e imports/);
  fs.writeFileSync(path.join(dir, "index.js"), "module.exports = {\n");
  const badRun = await runVerifier({ projectRoot: dir, learn: false });
  assert.equal(badRun.ok, false);
  assert.match(badRun.result.error, /index\.js/);
}));

test("la cola de correcciones carga en PROCEDE", () => {
  const PA = require("../runtime/project-analysis");
  const prompt = PA.authorizedPlanExecutionPrompt({ task: "corrige", plan: "1. Corregir `src/app.js`: error." });
  assert.match(prompt, /COLA DE CORRECCIONES/);
  assert.match(prompt, /FOCO OBLIGATORIO: src\/app\.js/);
});

test("el chat usa los chequeos reales en análisis, verificación y cambios", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(src, /forensic\.runForensicChecks\(projectRoot, \{\s*runTests: deep/);
  assert.match(src, /res\.text = `\$\{verifiedMd\}/);
  assert.match(src, /appendBeforeAfter\(projectRoot, written, textOut, onProgress\)/);
  assert.match(src, /ERRORES VERIFICADOS PENDIENTES/);
  assert.match(src, /## 🔎 Hipótesis \(no verificadas\)/);
});
