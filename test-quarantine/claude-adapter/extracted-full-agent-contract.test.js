"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/full-agent-contract.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter: ROADMAP no corta analisis; named diagnostic existe", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../runtime/editcore-claude-adapter.js"), "utf8");
  assert.match(src, /seedNamedDiagnosticTargets/);
  assert.match(src, /isNamedFileDiagnosticPrompt/);
  assert.match(src, /PROHIBIDO cerrar el analisis solo con ROADMAP/);
  assert.match(src, /permissionFullNow/);
  assert.match(src, /CONTRATO ACCESO TOTAL/);
  assert.doesNotMatch(src, /ROADMAP precargado\. Es el punto de partida/);
});
