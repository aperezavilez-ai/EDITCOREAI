"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const { decidirTurno } = require("../runtime/tools/nuevo/despacho.js");
const { anunciaTrabajoSinEjecutar } = require("../runtime/tools/nuevo/textos.js");
const { componerCierre } = require("../runtime/tools/nuevo/cierre.js");

// ---------------------------------------------------------------------------
// 1. decidirTurno — órdenes colectivas
// ---------------------------------------------------------------------------
describe("decidirTurno — órdenes colectivas deben clasificar como ORDEN", () => {
  const colectivas = [
    "debemos terminar el proyecto",
    "debemos completar el sistema",
    "tenemos que finalizar esto",
    "hay que avanzar con el backend",
    "vamos a construir el módulo de pagos",
    "necesitamos implementar el login",
  ];

  for (const texto of colectivas) {
    it(`"${texto}" → carril ORDEN`, () => {
      const r = decidirTurno(texto, { carril: "CONVERSACION" });
      assert.equal(r.carril, "ORDEN", `Se esperaba ORDEN para: "${texto}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. decidirTurno — órdenes directas de acción
// ---------------------------------------------------------------------------
describe("decidirTurno — órdenes directas cortas", () => {
  it('"termina esto" → ORDEN', () => {
    const r = decidirTurno("termina esto", {});
    assert.equal(r.carril, "ORDEN");
  });
  it('"completa el backend" → ORDEN', () => {
    const r = decidirTurno("completa el backend", {});
    assert.equal(r.carril, "ORDEN");
  });
  it('"finaliza la implementación" → ORDEN', () => {
    const r = decidirTurno("finaliza la implementación", {});
    assert.equal(r.carril, "ORDEN");
  });
});

// ---------------------------------------------------------------------------
// 3. anunciaTrabajoSinEjecutar — detecta promesas en futuro sin herramientas
// ---------------------------------------------------------------------------
describe("anunciaTrabajoSinEjecutar — frases del caso real", () => {
  const casosPositivos = [
    "Voy a completar el proyecto. Estado actual detectado… Empiezo ahora mismo.",
    "Empiezo ahora mismo. Primero cierro el schema de Prisma y luego implemento el motor de IA.",
    "Tengo el panorama completo. Empiezo por lo bloqueante: cerrar el schema de Prisma.",
    "A continuación voy a implementar el módulo de autenticación.",
    "Déjame revisar el archivo primero para entender el contexto.",
    "Voy a terminar el módulo de pagos.",
  ];

  for (const texto of casosPositivos) {
    it(`detecta anuncio en: "${texto.slice(0, 60)}…"`, () => {
      assert.ok(
        anunciaTrabajoSinEjecutar(texto),
        `anunciaTrabajoSinEjecutar debería retornar true para: "${texto.slice(0, 80)}"`
      );
    });
  }

  const casosNegativos = [
    "El archivo fue modificado correctamente.",
    "Se aplicaron 3 cambios en schema.prisma.",
    "¿Deseas que continúe con el siguiente módulo?",
    "El error estaba en la línea 42.",
  ];

  for (const texto of casosNegativos) {
    it(`NO detecta anuncio en: "${texto}"`, () => {
      assert.ok(
        !anunciaTrabajoSinEjecutar(texto),
        `anunciaTrabajoSinEjecutar debería retornar false para: "${texto}"`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 4. componerCierre — cierre-recibo (Corrección 8, 2026-11-26)
//    La función recibe { resultado, delegaciones }
//    [RE-APUNTADO 2026-11-26] Estas pruebas codificaban el menú
//    enlatado «¿Cómo deseas continuar? / Escribe procede», que la
//    Corrección 8 eliminó por orden de Luis (contrato de turno).
//    El contrato nuevo: sin trabajo no se cose nada; con trabajo
//    y sin propuesta del modelo, el cierre propone desde los
//    hechos — nunca el menú.
// ---------------------------------------------------------------------------
describe("componerCierre — cierre-recibo C8 sin menú «procede»", () => {
  function mkResultado(overrides = {}) {
    return {
      textoFinal: "He analizado el proyecto.",
      hechos: { aplicados: [], pasos: [], fallos: [], denegadas: [] },
      carril: "CONVERSACION",
      herramientasEjecutadas: 0,
      resumen: "",
      ...overrides,
    };
  }

  it("sin trabajo no cose ni menú ni recibo: la voz queda tal cual", () => {
    const { voz } = componerCierre({ resultado: mkResultado() });
    assert.equal(voz, "He analizado el proyecto.");
    assert.ok(!voz.includes("¿Cómo deseas continuar?"), "el menú enlatado murió con la C8");
    assert.ok(!voz.includes("«procede»"), "nada de «procede» enlatado");
  });

  it("en ORDEN con exploración y sin aplicados, el cierre propone desde los hechos", () => {
    const { voz } = componerCierre({
      resultado: mkResultado({
        textoFinal: "Voy a revisar el schema.",
        carril: "ORDEN",
        herramientasEjecutadas: 2,
        hechos: {
          aplicados: [], fallos: [], denegadas: [],
          pasos: [
            { nombre: "read_file", ok: true, resumen: "Leído: prisma/schema.prisma" },
            { nombre: "list_files", ok: true, resumen: "Carpeta .: 6 carpetas, 17 archivos" },
          ],
        },
      }),
    });
    assert.ok(voz.startsWith("Voy a revisar el schema."), "la voz del modelo se conserva");
    assert.ok(voz.includes("Siguiente paso que propongo"), "el cierre propone desde los hechos");
    assert.ok(!voz.includes("¿Cómo deseas continuar?"), "sin menú enlatado");
    assert.ok(!voz.includes("«procede»"), "sin «procede» enlatado");
  });

  it("retorna un objeto con campo voz de tipo string", () => {
    const resultado = componerCierre({ resultado: mkResultado() });
    assert.equal(typeof resultado.voz, "string");
  });

  it("NO duplica sugerencias si texto ya contiene pregunta de continuación", () => {
    const { voz } = componerCierre({
      resultado: mkResultado({
        textoFinal: "¿Deseas que continúe con el siguiente paso?",
      }),
    });
    // El bloque "procede/continúa" no debe aparecer si ya hay pregunta
    const matches = (voz.match(/procede|contin[uú]a/gi) || []).length;
    assert.ok(matches <= 2, `No debería duplicar el bloque. Encontrado ${matches} veces en: "${voz.slice(0, 300)}"`);
  });
});
