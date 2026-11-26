// ============================================================
// CORRECCIÓN 9 — el turno abre con su plan (2026-11-26)
//
// Hoy el turno abre con un eco enlatado del propio texto del
// usuario: «📋 Requerimientos analizados: <su texto> 🚀
// Iniciando ejecución técnica agéntica en el proyecto...»
// (adaptador.js). No dice qué hará el agente. El panel de plan
// del renderer está apagado a propósito («el progreso se
// escribe en el chat») — el plan vive en el chat, como apertura
// del turno, compuesto desde el encargo: un paso por frente en
// las revisiones, pasos por intención en construir/corregir, y
// el cierre del contrato (reporte + propuesta) como último
// paso. Sin intención detectable no se fabrica plan.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { componerPlanTurno } = require("../runtime/tools/nuevo/plan");

test("P-1: la revisión de la captura abre con un paso por frente", () => {
  const plan = componerPlanTurno({
    texto: "revisa el proyecto completo: la seguridad, los datos. dime cómo está cada frente",
    conProyecto: true,
  });
  assert.match(plan, /^Voy a trabajar así:/);
  assert.match(plan, /1\. Revisar la seguridad/i);
  assert.match(plan, /2\. Revisar los datos/i);
  assert.match(plan, /Reportar lo hecho y proponer el siguiente paso/);
  assert.ok(!plan.includes("Iniciando ejecución técnica"), "nada del eco enlatado");
});

test("P-2: un encargo con viñetas abre con un paso por viñeta", () => {
  const plan = componerPlanTurno({
    texto: "Necesito dos cosas:\n- crear el archivo notas.md con el resumen\n- agregar la sección de precios a la landing",
    conProyecto: true,
  });
  assert.match(plan, /crear el archivo notas\.md/i);
  assert.match(plan, /agregar la sección de precios/i);
});

test("P-3: corregir abre con localizar, aplicar y verificar", () => {
  const plan = componerPlanTurno({ texto: "corrige el error del login que no deja entrar", conProyecto: true });
  assert.match(plan, /Localizar/);
  assert.match(plan, /Aplicar la corrección/);
  assert.match(plan, /Verificar/);
});

test("P-4: crear abre con explorar, construir y verificar", () => {
  const plan = componerPlanTurno({ texto: "crea una landing para el taller con la lista de servicios", conProyecto: true });
  assert.match(plan, /Explorar el proyecto/);
  assert.match(plan, /Construir lo pedido/);
  assert.match(plan, /Verificar el resultado/);
});

test("P-5: sin proyecto abierto no hay plan de agente", () => {
  const plan = componerPlanTurno({ texto: "revisa el proyecto completo: la seguridad, los datos", conProyecto: false });
  assert.equal(plan, "");
});

test("P-6: sin intención detectable no se fabrica plan", () => {
  const plan = componerPlanTurno({ texto: "hola, ¿cómo estás?", conProyecto: true });
  assert.equal(plan, "");
});

test("P-7: el adaptador abre con el plan y el eco enlatado murió", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "runtime", "tools", "nuevo", "adaptador.js"), "utf8");
  assert.ok(fuente.includes("componerPlanTurno"), "el adaptador compone el plan del turno");
  assert.ok(!fuente.includes("Iniciando ejecución técnica agéntica"), "el eco enlatado ya no existe en el adaptador");
});
