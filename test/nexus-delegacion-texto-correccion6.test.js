// ============================================================
// CORRECCIÓN 6 — la delegación por la vía texto (2026-11-26)
//
// El modelo propio SOLO habla el dialecto de texto (bloques
// ```json con {"tool": ...}). El parser de ese dialecto
// (runtime/tools/parse-text-tools.js) acepta únicamente los
// nombres de su lista NATIVE, y delegate_parallel /
// invoke_subagent NO estaban en ella: toda delegación emitida
// por el modelo local se descartaba en silencio, emitiera el
// bloque perfecto o no. Réplica del fallo real del 2026-11-26
// (turnos.jsonl de AI ANALYTICS): el modelo emitió
// delegate_parallel y el turno cerró con pasos:0.
//
// C6-1 y C6-2 replican el fallo (antes: 0 llamadas).
// C6-3 y C6-4 son los verdes que deben conservarse: el filtro
// sigue descartando nombres inexistentes y las herramientas
// de siempre siguen parseando.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { parseTextToolCalls } = require("../runtime/tools/parse-text-tools");

const OPTS = { projectRoot: path.resolve(__dirname, "..") };

// El bloque EXACTO que el juicio HTTP de la v6 produjo y que
// la app debió ejecutar (con el prefijo del servidor incluido).
const BLOQUE_DELEGAR_LIMPIO =
  "[⚡ EditCore Nexus] ```json\n" +
  '{"tool": "delegate_parallel", "args": {"tasks": [' +
  '{"role": "security", "target": ".", "question": "existen credenciales escritas en los archivos del proyecto?"}, ' +
  '{"role": "database", "target": "src", "question": "las tablas y politicas de datos estan bien definidas?"}]}}\n```';

const BLOQUE_SUBAGENTE =
  '```json\n{"tool": "invoke_subagent", "args": {"role": "security", "target": ".", "question": "existen credenciales escritas en los archivos del proyecto?"}}\n```';

test("C6-1: el bloque delegate_parallel del modelo local SÍ se reconoce", () => {
  const llamadas = parseTextToolCalls(BLOQUE_DELEGAR_LIMPIO, OPTS);
  assert.equal(llamadas.length, 1, "la delegación en texto debe producir 1 llamada");
  assert.equal(llamadas[0].function.name, "delegate_parallel");
  const args = JSON.parse(llamadas[0].function.arguments);
  assert.equal(args.tasks.length, 2, "las dos tareas del bloque llegan intactas");
  assert.equal(args.tasks[0].role, "security");
  assert.equal(args.tasks[1].role, "database");
});

test("C6-2: el bloque invoke_subagent del modelo local SÍ se reconoce", () => {
  const llamadas = parseTextToolCalls(BLOQUE_SUBAGENTE, OPTS);
  assert.equal(llamadas.length, 1, "invoke_subagent en texto debe producir 1 llamada");
  assert.equal(llamadas[0].function.name, "invoke_subagent");
});

test("C6-3: un nombre inexistente en texto sigue descartado", () => {
  const llamadas = parseTextToolCalls(
    '```json\n{"tool": "herramienta_inventada", "args": {}}\n```', OPTS);
  assert.equal(llamadas.length, 0, "el filtro de nombres conocidos sigue protegiendo");
});

test("C6-4: list_files por la vía texto sigue parseando", () => {
  const llamadas = parseTextToolCalls(
    '[⚡ EditCore Nexus] ```json\n{"tool": "list_files", "args": {"path": "."}}\n```', OPTS);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].function.name, "list_files");
});
