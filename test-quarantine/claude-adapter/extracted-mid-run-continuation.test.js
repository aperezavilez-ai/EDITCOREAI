"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/mid-run-continuation.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("adapter no cierra analisis con Verificacion completada", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"),
    "utf8",
  );
  assert.match(source, /neverEvidenceFinalForAnalysis/);
  assert.match(source, /Emite write_file AHORA/);
  assert.match(source, /modelIterations|providerCalls >=/);
});
