"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  POLICY_MARKER,
  FACTUAL_TEMPERATURE,
  ANTI_HALLUCINATION_POLICY,
  withAntiHallucinationPolicy,
  hasAntiHallucinationPolicy,
  resolveFactualTemperature,
} = require("../runtime/anti-hallucination-policy");
const { withEliteCommunicationPolicy } = require("../runtime/elite-communication-policy");

test("anti-alucinacion: las 4 restricciones duras estan en la politica", () => {
  assert.match(ANTI_HALLUCINATION_POLICY, /ZERO DRIFT/);
  assert.match(ANTI_HALLUCINATION_POLICY, /GROUNDING EMPIRICO/);
  assert.match(ANTI_HALLUCINATION_POLICY, /NO PREGUNTES LO QUE PUEDES VER/);
  assert.match(ANTI_HALLUCINATION_POLICY, /PLACEHOLDERS Y FABRICACIONES/);
  assert.match(ANTI_HALLUCINATION_POLICY, /RESPUESTA DE INSPECCION/);
  assert.match(ANTI_HALLUCINATION_POLICY, /MAXIMA PRIORIDAD/);
  assert.match(ANTI_HALLUCINATION_POLICY, /SI PUEDES RECOMENDAR/);
  assert.match(ANTI_HALLUCINATION_POLICY, /PROHIBIDO EJECUTAR acciones no pedidas/);
  assert.equal(FACTUAL_TEMPERATURE, 0.1);
});

test("anti-alucinacion: wrapper idempotente y prioriza el marcador", () => {
  const once = withAntiHallucinationPolicy("Haz solo list_files de api.");
  assert.ok(hasAntiHallucinationPolicy(once));
  assert.ok(once.indexOf(POLICY_MARKER) < once.indexOf("list_files"));
  assert.equal(withAntiHallucinationPolicy(once), once);
});

test("elite apila anti-alucinacion encima (maxima prioridad)", () => {
  const stacked = withEliteCommunicationPolicy("Eres EDITCOREAI Agent. Completa la tarea.");
  assert.match(stacked, /POLITICA_ANTIALUCINACION_V1/);
  assert.match(stacked, /POLITICA_COMUNICACION_ELITE_V/);
  assert.ok(
    stacked.indexOf("POLITICA_ANTIALUCINACION_V1")
      < stacked.search(/POLITICA_COMUNICACION_ELITE_V/),
    "anti-alucinacion debe ir antes que elite",
  );
});

test("temperatura factual: default 0.1 y respeta override bajo", () => {
  assert.equal(resolveFactualTemperature(undefined), 0.1);
  assert.equal(resolveFactualTemperature(0), 0);
  assert.equal(resolveFactualTemperature(0.1), 0.1);
  assert.equal(resolveFactualTemperature(0.4), 0.1);
  assert.equal(resolveFactualTemperature(0.9), 0.1);
});

test("inyeccion: main.js y ai-core usan resolveFactualTemperature", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /resolveFactualTemperature/);
  assert.doesNotMatch(main, /temperature: Number\(input\.temperature\) \|\| 0\.4/);
  const ai = fs.readFileSync(path.join(__dirname, "..", "runtime", "ai-core.js"), "utf8");
  assert.match(ai, /resolveFactualTemperature\(input\.temperature\)/);
});

test("inyeccion: index.html carga anti-hallucination antes de elite", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const anti = html.indexOf("anti-hallucination-policy.js");
  const elite = html.indexOf("elite-communication-policy.js");
  assert.ok(anti > 0 && elite > anti, "anti debe cargarse antes que elite");
});

test("defaultChatSystemPrompt incluye anti-alucinacion via elite", () => {
  const { defaultChatSystemPrompt } = require("../runtime/elite-communication-policy");
  const p = defaultChatSystemPrompt();
  assert.match(p, /POLITICA_ANTIALUCINACION_V1/);
  assert.match(p, /ZERO DRIFT/);
});
