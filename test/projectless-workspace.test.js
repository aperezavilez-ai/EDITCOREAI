"use strict";

// La teletransportación al último proyecto (hallazgo en vivo de Luis,
// 2026-11-10, dos veces): una corrida con herramientas nacida en una
// conversación sin proyecto llegaba al proceso principal SIN raíz, y
// agent:run la resolvía con resolveIncomingWorkspaceRoot — cuyo respaldo
// es "el último workspace conocido" (VIXERAI). El agente mapeó VIXERAI y
// empezó a crear la landing DENTRO del punto de venta. Estos tests fijan
// el contrato en sus tres piezas: la conversación se declara sin proyecto
// al nacer el trabajo, la creación del proyecto cubre también los
// trabajos con herramientas de un build nuevo (no solo isAgent) y el
// proceso principal jamás hereda un workspace a una corrida declarada
// sin proyecto.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");

test("el trabajo declara si su conversación nació sin proyecto", () => {
  assert.match(renderer, /projectlessConversation: Boolean\(project && !String\(project\.projectRoot \|\| ""\)\.trim\(\) && !String\(state\.projectRoot \|\| ""\)\.trim\(\)\)/);
});

test("la creación desde la conversación cubre builds con herramientas, no solo isAgent", () => {
  assert.match(renderer, /if \(\(isAgent \|\| \(usesProjectTools && job\.orchestratorPlan\?\.greenfieldCreate\)\) && !job\.projectRoot\)/);
});

test("la corrida lleva la declaración al proceso principal", () => {
  assert.match(renderer, /projectless: Boolean\(job\.projectlessConversation\)/);
});

test("agent:run nunca hereda el último workspace a una corrida sin proyecto", () => {
  assert.match(main, /const requestedRootRaw = input\?\.projectless === true\s*\n\s*\? String\(input\?\.projectRoot \|\| ""\)\.trim\(\)\s*\n\s*: resolveIncomingWorkspaceRoot\(event, input, task\);/);
});
