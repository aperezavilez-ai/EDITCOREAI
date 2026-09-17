"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ELITE_COMMUNICATION_POLICY } = require("../runtime/elite-communication-policy");
const { ANTI_HALLUCINATION_POLICY } = require("../runtime/anti-hallucination-policy");

test("agentes: politicas permiten recomendar y ser propositivos", () => {
  assert.match(ANTI_HALLUCINATION_POLICY, /SI PUEDES RECOMENDAR/);
  assert.match(ANTI_HALLUCINATION_POLICY, /PROHIBIDO EJECUTAR acciones no pedidas/);
  assert.match(ANTI_HALLUCINATION_POLICY, /NO PREGUNTES LO QUE PUEDES VER/);
  assert.match(ELITE_COMMUNICATION_POLICY, /POSTURA PROPOSITIVA/);
  assert.match(ELITE_COMMUNICATION_POLICY, /Qué FALTA para que arranque|FALTA para que arranque/i);
  assert.match(ELITE_COMMUNICATION_POLICY, /Sé directo|Se directo|toma posici/i);
});

test("agentes: knowledge pack y contrato de trabajo en fuentes", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(main, /EDITCORE_AGENT_KNOWLEDGE_PACK/);
  assert.match(main, /CO-CREACION/);
  assert.match(main, /Jerarquia de conocimiento/);
  assert.doesNotMatch(main, /const skipBrainNow = analysisMode/);
  assert.match(adapter, /CONTRATO DE TRABAJO/);
  assert.match(adapter, /Qué falta para que funcione/);
  assert.match(adapter, /rejectionCounts/);
  assert.match(adapter, /skillCatalogBlock|brainInventory\?\.skills/);
  assert.match(adapter, /anti-bucle tokens|coverageRejects/);
});

test("agentes: guia de profundidad pide recomendacion concreta", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "runtime", "analysis-depth.js"), "utf8");
  assert.match(src, /Qué falta para que funcione/);
  assert.match(src, /recomienda SOLO correcciones|recomienda en 2-4 lineas|correccion de mayor impacto/i);
});
