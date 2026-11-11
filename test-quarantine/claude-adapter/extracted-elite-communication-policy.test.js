"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/elite-communication-policy.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("inyeccion: adapter agente envuelve system prompt", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(src, /withEliteCommunicationPolicy\(`/);
  assert.match(src, /stripEliteFiller/);
});
