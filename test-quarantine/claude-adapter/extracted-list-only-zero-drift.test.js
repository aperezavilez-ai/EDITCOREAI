"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/list-only-zero-drift.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("finalizeExecutionText no sustituye listado por Sin cambios reales", () => {
  const {
    formatListOnlyAnswerFromSteps,
    looksLikeNoMutationMessage,
  } = require("../../runtime/editcore-claude-adapter");
  const steps = [{
    name: "list_files",
    ok: true,
    input: { path: "api" },
    result: [
      { name: "public", path: "api/public", kind: "directory" },
      { name: "index.js", path: "api/index.js", kind: "file" },
    ],
  }];
  const listing = formatListOnlyAnswerFromSteps(steps, "D:/TAXIDRIV", "LISTA solamente la carpeta api");
  assert.match(listing, /public/);
  assert.match(listing, /index\.js/);
  assert.doesNotMatch(listing, /Sin cambios reales/);
  assert.equal(looksLikeNoMutationMessage("## Sin cambios reales en disco\nNo hubo write_file"), true);
});
