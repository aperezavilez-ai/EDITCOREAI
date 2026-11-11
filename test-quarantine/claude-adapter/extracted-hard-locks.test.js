"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído de test/hard-locks.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appRoot = path.join(__dirname, "..", "..");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const {
  looksLikePromptEcho,
} = require("../../runtime/editcore-claude-adapter");

test("H1b: adapter usa CACHE HIT en vez de error en repeats>=1", () => {
  assert.match(adapterSource, /CACHE HIT: mismo archivo/);
  assert.match(adapterSource, /cachedResult = this\.actionRegistry\.getResult\(action\)/);
  assert.doesNotMatch(adapterSource, /repeats >= 1[\s\S]{0,80}error/);
});

test("H2b: evidenceFinalText en analysisMode no es Verificacion completada", () => {
  assert.match(adapterSource, /if \(input\?\.analysisMode === true\) \{\s*return this\.buildAnalysisFallbackReport/);
  assert.match(adapterSource, /Verificacion completada con evidencia real/);
});

test("H2c: eco del prompt se rechaza", () => {
  const prompt = "EDITCOREAI — AUTOAUDITORÍA FORENSE DE SU PROPIO RUNTIME\nMODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS\nQuiero que audites el proyecto";
  assert.equal(looksLikePromptEcho(prompt, prompt), true);
  assert.equal(looksLikePromptEcho(prompt, `${prompt}\n\nextra`), true);
  assert.equal(looksLikePromptEcho(prompt, "## Qué sí funcionó\n\nLa app abre."), false);
  assert.match(adapterSource, /looksLikePromptEcho/);
});

test("H3b (parte adaptador): analisis marca brainRequiredNudgeSent", () => {
  assert.match(adapterSource, /brainRequiredNudgeSent/);
});
