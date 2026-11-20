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
// 4. componerCierre — appends next-steps when 0 mutations
//    La función recibe { resultado, delegaciones }
// ---------------------------------------------------------------------------
describe("componerCierre — agrega sugerencias cuando no hay mutaciones", () => {
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

  it("incluye prompt de continuación cuando no hay aplicados ni actividad", () => {
    const { voz } = componerCierre({ resultado: mkResultado() });
    assert.ok(
      /procede|contin[uú]a/i.test(voz),
      `El cierre debería incluir sugerencia de «procede» o «continúa». Obtenido: "${voz.slice(0, 200)}"`
    );
  });

  it("incluye prompt de continuación en carril ORDEN sin aplicados", () => {
    const { voz } = componerCierre({
      resultado: mkResultado({
        textoFinal: "Voy a revisar el schema.",
        carril: "ORDEN",
      }),
    });
    assert.ok(
      /procede|contin[uú]a/i.test(voz),
      `El cierre debería incluir sugerencia cuando no hubo actividad. Obtenido: "${voz.slice(0, 200)}"`
    );
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
