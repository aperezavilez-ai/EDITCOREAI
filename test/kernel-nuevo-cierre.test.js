"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: cierre y presentación desde hechos.
// La voz del agente va primero; el detalle (contabilidad) se
// construye SOLO desde los hechos del kernel, nunca desde la
// prosa del modelo. Y la guarda que el kernel viejo no tenía:
// si en un turno de ORDEN el texto del modelo declara trabajo
// completado que los hechos no registran (sin aplicados, o
// subagentes sin entregar), esa voz NO se publica: el cierre
// lo genera el kernel desde los hechos, y el texto original
// queda guardado como vozOriginal para auditoría.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { componerCierre } = require("../editcore-chat-kernel/nuevo/cierre");

function resultadoOrden({ textoFinal, aplicados = [], fallos = [] }) {
  return {
    carril: "ORDEN",
    textoFinal,
    llamadas: 2,
    tokensUsados: 8000,
    presupuestoAgotado: false,
    hechos: { pasos: [], aplicados, fallos, denegadas: [] },
    resumen: [
      "Carril: ORDEN · llamadas: 2 · tokens: 8000",
      ...(aplicados.length ? [`Aplicado: ${aplicados.join(", ")}`] : ["Sin cambios aplicados en este turno."]),
      ...(fallos.length ? [`Fallos: ${fallos.map((f) => f.nombre).join(", ")}`] : []),
    ].join("\n"),
  };
}

test("cierre honesto: voz del modelo + detalle de hechos cuando coinciden", () => {
  const c = componerCierre({
    resultado: resultadoOrden({ textoFinal: "Corregí el login en src/x.js y lo verifiqué.", aplicados: ["src/x.js"] }),
  });
  assert.equal(c.corregida, false);
  assert.match(c.voz, /Corregí el login/);
  assert.match(c.detalle, /Aplicado: src\/x\.js/);
});

test("cierre falso imposible: declara completado sin aplicar y el kernel lo corrige", () => {
  const c = componerCierre({
    resultado: resultadoOrden({ textoFinal: "Listo, todo corregido y completado al 100%." }),
  });
  assert.equal(c.corregida, true);
  assert.match(c.voz, /no aplicó cambios/);
  assert.match(c.vozOriginal, /completado al 100%/);
  assert.match(c.detalle, /Sin cambios aplicados/);
});

test("delegación incompleta: declarar completo es falso y se corrige nombrando la auditoría", () => {
  const delegaciones = [
    { id: "e1", rol: "explorador", entrego: true, texto: "informe" },
    { id: "a1", rol: "analista", entrego: false, motivoNoEntrega: "sin_informe" },
  ];
  const c = componerCierre({
    resultado: resultadoOrden({ textoFinal: "Análisis completo: todo revisado.", aplicados: ["docs/reporte.md"] }),
    delegaciones,
  });
  assert.equal(c.corregida, true);
  assert.match(c.detalle, /1\/2 entregaron/);
  assert.match(c.detalle, /a1 \(sin_informe\)/);
  assert.match(c.voz, /sin entregar/);
});

test("delegación completa + aplicados: el cierre del modelo pasa intacto", () => {
  const delegaciones = [{ id: "e1", rol: "explorador", entrego: true, texto: "informe" }];
  const c = componerCierre({
    resultado: resultadoOrden({ textoFinal: "Análisis completo y reporte aplicado.", aplicados: ["docs/reporte.md"] }),
    delegaciones,
  });
  assert.equal(c.corregida, false);
  assert.match(c.detalle, /1\/1 entregaron/);
});

test("conversación no se guarda: mencionar el pasado no es declarar trabajo del turno", () => {
  const c = componerCierre({
    resultado: {
      carril: "CONVERSACION",
      textoFinal: "Eso quedó corregido la semana pasada, en la v3.4.2.",
      llamadas: 1,
      tokensUsados: 900,
      presupuestoAgotado: false,
      hechos: { pasos: [], aplicados: [], fallos: [], denegadas: [] },
      resumen: "Carril: CONVERSACION · llamadas: 1 · tokens: 900",
    },
  });
  assert.equal(c.corregida, false);
  assert.equal(c.voz, "Eso quedó corregido la semana pasada, en la v3.4.2.");
});

test("el detalle es puro: se compone solo del resumen y la auditoría, sin prosa del modelo", () => {
  const r = resultadoOrden({ textoFinal: "Afirmo que revisé 169 archivos y 5 advertencias.", aplicados: ["a.js"] });
  const c = componerCierre({ resultado: r });
  assert.equal(c.detalle, r.resumen);
  assert.ok(!/169/.test(c.detalle));
});
