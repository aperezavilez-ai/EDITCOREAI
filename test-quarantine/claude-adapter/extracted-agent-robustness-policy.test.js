"use strict";

// [EDITCORE-INTEGRAL-B10] CUARENTENA (extraído del test mixto de
// test/agent-robustness-policy.test.js: sus aserciones sobre main.js y
// las políticas vivas se quedan en la suite).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("agentes (adaptador): contrato de trabajo en la fuente del adaptador", () => {
  const adapter = fs.readFileSync(path.join(__dirname, "..", "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(adapter, /CONTRATO DE TRABAJO/);
  assert.match(adapter, /Qué falta para que funcione/);
  assert.match(adapter, /rejectionCounts/);
  assert.match(adapter, /skillCatalogBlock|brainInventory\?\.skills/);
  assert.match(adapter, /anti-bucle tokens|coverageRejects/);
});
