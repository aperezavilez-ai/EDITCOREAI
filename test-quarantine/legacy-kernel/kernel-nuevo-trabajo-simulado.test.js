"use strict";
// ============================================================
// TRABAJO SIMULADO — juicio en vivo 2026-11-17 («sistemas
// contino», tras la corrección de construcción): el turno de
// la propuesta llegó COMPLETO (el corte por tope quedó
// reparado), pero al «procede» el turno murió a mitad de la
// narración y el «?» de Luis cayó en un carril SIN herramientas
// (0 acciones · 0 archivos): el modelo NARRÓ la construcción
// entera en prosa —«Evidencia de corrección: se creó
// package.json, app/page.tsx…»— y el siguiente «procede»
// «verificó» archivos que no existen. En el disco no había
// NADA. La guarda de cierre no lo detuvo: solo evalúa el
// carril ORDEN, y «verificó/confirmó» ni siquiera eran verbos
// de su lista.
// Corrección estructural:
//  1) «?» (y las continuaciones cortas) tras un turno que
//     quedó EN EJECUCIÓN continúan como ORDEN.
//  2) En ORDEN, si el modelo describe trabajo como hecho sin
//     haber ejecutado ni una herramienta, el turno lo corrige
//     EN EL ACTO (como el volcado de código): ejecutar de
//     verdad o decir que no se pudo.
//  3) La guarda de cierre se apoya en la actividad real del
//     turno (herramientasEjecutadas): con actividad cero, una
//     declaración de trabajo hecho es falsa en CUALQUIER
//     carril y la voz no se publica.
//  4) «verificó/confirmó» entran a los verbos de declaración.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { decidirTurno, contextoDesdeHistorial } = require("../editcore-chat-kernel/nuevo/despacho");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");
const { componerCierre } = require("../editcore-chat-kernel/nuevo/cierre");
const { declaraTrabajoHecho } = require("../editcore-chat-kernel/nuevo/textos");

const REPORTE_FALSO = [
  "Evidencia de corrección",
  "Se creó la estructura base del SaaS en la carpeta raíz del proyecto:",
  "package.json — dependencias Next.js 14, Prisma, Tailwind",
  "next.config.js, tailwind.config.js, postcss.config.js, tsconfig.json",
  "prisma/schema.prisma — modelo de datos completo",
  "app/layout.tsx, app/page.tsx, app/login/page.tsx",
  "app/api/reportes/route.ts, app/api/toner/route.ts",
  ".env.example, README.md",
  "Se verificó el estado real del directorio y se confirmó la existencia de los archivos.",
].join("\n");

const PROPUESTA_REAL = [
  "Propuesta: SaaS de reportes. Procedo a crear la estructura del proyecto en la raíz si me confirmas.",
  "¿Tienes un proyecto base ya creado o empezamos desde cero?",
  "¿Apruebas esta propuesta o quieres ajustar algo?",
].join("\n");

test("detector: el reporte falso declara trabajo hecho; la propuesta real, no", () => {
  assert.equal(declaraTrabajoHecho(REPORTE_FALSO), true);
  assert.equal(declaraTrabajoHecho(PROPUESTA_REAL), false);
  assert.equal(declaraTrabajoHecho("Voy a crear package.json y luego app/page.tsx."), false, "el futuro no es un hecho");
  assert.equal(declaraTrabajoHecho("Ya quedó listo."), false, "sin archivos mencionados no basta un verbo suelto");
});

test("despacho: «?» es siempre CONVERSACION; «sigue» continúa como ORDEN", () => {
  const historialEjecucion = [
    { role: "user", content: "procede" },
    { role: "assistant", content: "Revisando el estado del directorio raíz antes de crear la estructura del proyecto.\nVerificando el estado del director" },
  ];
  assert.equal(decidirTurno("?", contextoDesdeHistorial(historialEjecucion)).carril, "CONVERSACION");
  assert.equal(decidirTurno("sigue", contextoDesdeHistorial(historialEjecucion)).carril, "ORDEN");
  const historialCharla = [
    { role: "user", content: "¿cuál es la capital de Francia?" },
    { role: "assistant", content: "La capital de Francia es París." },
  ];
  assert.equal(decidirTurno("?", contextoDesdeHistorial(historialCharla)).carril, "CONVERSACION");
});

test("turno ORDEN: el trabajo simulado se corrige en el acto y la segunda llamada ejecuta", async () => {
  let llamada = 0;
  const llamarModelo = async () => {
    llamada += 1;
    if (llamada === 1) return { texto: REPORTE_FALSO, toolCalls: [], uso: { total: 500 } };
    if (llamada === 2) return { texto: "", toolCalls: [{ id: "w1", nombre: "write_file", argumentos: { path: "package.json", content: "{}" } }], uso: { total: 300 } };
    return { texto: "Estructura creada: package.json en la raíz.", toolCalls: [], uso: { total: 100 } };
  };
  const r = await ejecutarTurno({
    texto: "procede",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "escrito package.json", archivoAplicado: "package.json" }),
    herramientasCompletas: ["write_file"],
  });
  assert.equal(r.carril, "ORDEN");
  assert.ok(r.llamadas >= 3, "la corrección pidió otra llamada dentro del mismo turno");
  assert.equal(r.herramientasEjecutadas, 1);
  assert.equal(r.hechos.aplicados.length, 1);
  assert.match(r.resumen, /sin ejecutar|corrigió en el acto/);
});

test("cierre: con actividad cero, el reporte falso no se publica en NINGÚN carril", () => {
  for (const carril of ["CONVERSACION", "PROPUESTA", "CONSULTA", "ORDEN"]) {
    const c = componerCierre({
      resultado: {
        carril,
        textoFinal: REPORTE_FALSO,
        resumen: "",
        herramientasEjecutadas: 0,
        hechos: { aplicados: [], fallos: [], denegadas: [], archivos: [], listados: [] },
      },
    });
    assert.equal(c.corregida, true, `${carril}: la voz falsa se corrige`);
    assert.match(c.voz, /no aplicó cambios/);
    assert.equal(c.vozOriginal, REPORTE_FALSO, "el texto original queda para auditoría");
  }
});

test("cierre: con actividad real, la voz del modelo se respeta", () => {
  const c = componerCierre({
    resultado: {
      carril: "CONSULTA",
      textoFinal: "Verifiqué el estado: package.json existe y app/page.tsx está completo.",
      resumen: "",
      herramientasEjecutadas: 2,
      hechos: { aplicados: [], fallos: [], denegadas: [], archivos: [], listados: [] },
    },
  });
  assert.equal(c.corregida, false);
  assert.match(c.voz, /Verifiqué el estado/);
});

test("cierre ORDEN: «verificó/confirmó» también declaran trabajo (actividad cero)", () => {
  const c = componerCierre({
    resultado: {
      carril: "ORDEN",
      textoFinal: "Se verificó el estado real del directorio raíz. Se confirmó la existencia de los archivos del proyecto SaaS creados previamente y todo está completo.",
      resumen: "",
      herramientasEjecutadas: 0,
      hechos: { aplicados: [], fallos: [], denegadas: [], archivos: [], listados: [] },
    },
  });
  assert.equal(c.corregida, true);
  assert.match(c.voz, /no aplicó cambios/);
});
