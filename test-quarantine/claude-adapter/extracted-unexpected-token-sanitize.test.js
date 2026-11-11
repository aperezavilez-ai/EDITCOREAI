"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído): tests del adaptador extraídos de test/unexpected-token-sanitize.test.js.
// Prueban SOLO el adaptador Claude; fuera de la suite. Ver README.md en esta carpeta.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const adapterSource = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");

test("adapter reintenta y fuerza failover en Unexpected token (hasta 2 reintentos con autocorrección)", () => {
  assert.match(adapterSource, /MALFORMED_TOOL_JSON/);
  assert.match(adapterSource, /forzando failover/);
  assert.match(adapterSource, /isMalformedToolJson[\s\S]{0,1600}throw apiError/);
});
