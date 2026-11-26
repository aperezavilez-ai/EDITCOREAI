// ============================================================
// CORRECCIÓN 7 — el cierre nunca tira trabajo completado (2026-11-26)
//
// Réplica del turno real de AI ANALYTICS (2026-11-26 14:26Z):
// la delegación CORRIÓ (pasos:1) y su resumen — con los
// informes de los especialistas — quedó en hechos.pasos. El
// modelo se descarriló en su siguiente bloque, la llamada de
// cierre volvió vacía y el piso anti-mudo de cierre.js cerró
// con una línea hueca + el «procede» enlatado: los informes
// reales nunca llegaron a la voz.
//
// C7-1 y C7-2 replican el fallo (antes: la voz NO contiene el
// informe). C7-3, C7-4 y C7-5 son los verdes que deben
// conservarse: el piso sigue hablando sin pasos, la voz del
// modelo manda cuando existe, y el cierre de aplicados sigue.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { componerCierre } = require("../runtime/tools/nuevo/cierre");

const INFORME_DB = "Las tablas estan definidas en prisma/schema.prisma y las politicas de datos se revisaron sin hallazgos criticos.";
const RESUMEN_DELEGACION = `Subagentes: 1/1 entregaron\n\n[database] Informe:\n${INFORME_DB}`;

function resultadoConDelegacion(resumenDelegacion, okDelegacion) {
  return {
    carril: "ORDEN",
    textoFinal: "",
    resumen: "Turno ORDEN · 1 herramienta ejecutada",
    herramientasEjecutadas: 1,
    hechos: {
      aplicados: [],
      archivos: [],
      fallos: okDelegacion ? [] : [{ nombre: "delegate_parallel", ok: false, resumen: resumenDelegacion }],
      denegadas: [],
      listados: [],
      pasos: [{ nombre: "delegate_parallel", ok: okDelegacion, resumen: resumenDelegacion }],
    },
  };
}

test("C7-1: con la voz vacia, el cierre presenta el informe delegado real", () => {
  const { voz } = componerCierre({ resultado: resultadoConDelegacion(RESUMEN_DELEGACION, true) });
  assert.ok(voz.includes(INFORME_DB), "la voz debe traer el informe del especialista");
  assert.ok(!voz.includes("procede"), "nada de cierre enlatado cuando el turno entrego trabajo");
  assert.ok(!voz.includes("Revisión técnica del proyecto completada"), "nada de linea hueca");
});

test("C7-2: delegacion incompleta: se presenta lo entregado Y lo que falto", () => {
  const resumen = "Subagentes: 1/2 entregaron\n\n[database] Informe:\n" + INFORME_DB +
    "\n\n[security] SIN INFORME (sin_informe): este frente NO entregó — no des por revisado lo que no se revisó.";
  const { voz } = componerCierre({ resultado: resultadoConDelegacion(resumen, false) });
  assert.ok(voz.includes(INFORME_DB), "lo entregado se presenta");
  assert.ok(voz.includes("SIN INFORME"), "lo que falto tambien se dice");
  assert.ok(!voz.includes("procede"), "sin enlatado");
});

test("C7-3: sin pasos y sin voz, el piso sigue hablando (comportamiento previo)", () => {
  const { voz } = componerCierre({
    resultado: {
      carril: "ORDEN", textoFinal: "", resumen: "", herramientasEjecutadas: 0,
      hechos: { aplicados: [], archivos: [], fallos: [], denegadas: [], listados: [], pasos: [] },
    },
  });
  assert.ok(String(voz || "").trim().length > 0, "el agente nunca se queda mudo");
});

test("C7-4: si el modelo SI cerro con su voz, esa voz manda (no se sustituye)", () => {
  const resultado = resultadoConDelegacion(RESUMEN_DELEGACION, true);
  resultado.textoFinal = "Revise los dos frentes: los datos estan definidos en el esquema y sin hallazgos criticos.";
  const { voz } = componerCierre({ resultado });
  assert.ok(voz.startsWith("Revise los dos frentes"), "la voz del modelo se conserva");
});

test("C7-5: con archivos aplicados y voz vacia, el cierre de aplicados sigue", () => {
  const { voz } = componerCierre({
    resultado: {
      carril: "ORDEN", textoFinal: "", resumen: "", herramientasEjecutadas: 1,
      hechos: {
        aplicados: ["notas.md"], archivos: [{ path: "notas.md" }], fallos: [], denegadas: [], listados: [],
        pasos: [{ nombre: "write_file", ok: true, resumen: "Archivo creado: notas.md" }],
      },
    },
  });
  assert.ok(voz.includes("Apliqué 1 archivo(s): notas.md"), "el cierre de aplicados se conserva");
});
