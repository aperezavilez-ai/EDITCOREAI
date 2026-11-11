"use strict";

// [EDITCORE-INTEGRAL-B10] NOTA DE MIGRACIÓN POR RIESGO: estos tres
// tests son VIGILANCIA ESTRUCTURAL SECUNDARIA (regex sobre el texto
// de renderer.js). La guarda que vigilan
// (isIntentionalProjectlessConversation) es una clausura del renderer
// sobre su estado global (activeProject/state) SIN costura pura
// ejecutable: no existe un módulo puro que la exponga — el resolvedor
// puro del Bloque 7 (runtime/chat-turn-ownership.js) resuelve el
// DESTINO del turno, no esta guarda de rehidratación. Por eso el
// archivo se queda como vigilancia secundaria y NO es la prueba que
// manda. Las pruebas de COMPORTAMIENTO que mandan sobre este camino:
//   - test/projectless-chat.test.js (el kernel sin proyecto conversa
//     y con proyecto ejecuta, con proveedor falso),
//   - test/projectless-workspace.test.js (la declaración sin proyecto
//     llega a agent:run y main no hereda el último workspace),
//   - test/turno-chat-b7.test.js (comportamiento del resolvedor puro
//     de propiedad del turno con costuras inyectadas).
// Si este archivo y uno de comportamiento discrepan, manda el de
// comportamiento.

// El amarre incondicional (hallazgo en vivo de Luis, TRES veces:
// v4.6.3, v4.6.4 y v4.6.5): send() abría con «si no hay raíz global,
// rehidrata el activo» llamando a ensureActiveProjectBound() SIN
// condiciones — antes de clasificar el mensaje y antes de construir el
// trabajo. Su cascada termina en «el proyecto reciente» y lo selecciona:
// toda conversación sin proyecto quedaba amarrada al último proyecto
// abierto (VIXERAI) en el primer Enter, y el agente construía ahí. Por
// eso ni la puerta (v4.6.4) ni la declaración sin proyecto en el proceso
// principal (v4.6.5) pudieron verse: el trabajo ya nacía amarrado.
// Estos tests fijan el guardia en sus dos sitios.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

test("existe el detector de conversación intencionalmente sin proyecto", () => {
  assert.match(renderer, /function isIntentionalProjectlessConversation\(\) \{\s*\n\s*const project = activeProject\(\);\s*\n\s*return Boolean\(project && !String\(project\.projectRoot \|\| ""\)\.trim\(\) && !String\(state\.projectRoot \|\| ""\)\.trim\(\)\);\s*\n\}/);
});

test("la rehidratación previa al envío respeta la conversación sin proyecto", () => {
  assert.match(renderer, /if \(!String\(state\.projectRoot \|\| ""\)\.trim\(\) && !isIntentionalProjectlessConversation\(\)\) \{\s*\n\s*await ensureActiveProjectBound\(effectivePrompt\);\s*\n\s*\}/);
});

test("la rama missingProject tampoco amarra una conversación sin proyecto", () => {
  assert.match(renderer, /const rebound = isIntentionalProjectlessConversation\(\)\s*\n\s*\? false\s*\n\s*: await ensureActiveProjectBound\(effectivePrompt\);/);
});
