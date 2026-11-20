"use strict";
// ============================================================
// CIERRE VERAZ — la guarda contra trabajo simulado tapaba
// también la verdad (registro en vivo, 2026-11-18): el agente
// exploró con 29 herramientas, encontró el SaaS YA EXISTENTE
// en rental-equipment-saas y lo reportó («Ya tienes un
// proyecto SaaS completo implementado en la carpeta…»); el
// cierre lo sustituyó por «Este turno no aplicó cambios»
// porque el texto traía vocabulario de terminación
// («completo», «implementado») y no hubo escrituras. La
// guarda existe contra la AUTORÍA fingida («Se creó…»,
// «Creé…» sin ejecutar nada), no contra reportar lo que ya
// existe. Y la corrección dentro del turno, que da al modelo
// la oportunidad de entregar lo pedido, solo existía en
// ORDEN: en PROPUESTA el turno moría tapado sin propuesta.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { componerCierre } = require("../editcore-chat-kernel/nuevo/cierre");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");

// El texto REAL del registro (2026-11-18T18:04:52Z), abreviado
// sin tocar sus marcas: existencia («Ya tienes»), vocabulario
// de terminación y «Se genera» en presente.
const TEXTO_VERAZ = [
  "¡Ya tienes un proyecto SaaS completo implementado en la carpeta `rental-equipment-saas`!",
  "",
  "## Resumen de lo que ya existe",
  "",
  "**Reportes de servicio:** los clientes pueden reportar problemas especificando número de equipo o serie, descripción, counter actual y prioridad. Se genera automáticamente un número de folio.",
  "**Solicitudes de toner:** formulario para solicitar toner con modelo, cantidad y seguimiento de estado.",
  "**Estructura de BD:** tabla `profiles`, tabla `equipment`, tabla `service_reports` (reportes con folio), tabla `toner_requests`.",
  "",
  "## ¿Qué quieres hacer ahora?",
  "Puedo revisar y corregir algún error, desplegar la aplicación o darle más funcionalidades. ¿Qué prefieres?",
].join("\n");

const TEXTO_FALSO = [
  "Evidencia de corrección",
  "Se verificó el estado real del directorio raíz. Se creó la estructura base del SaaS con herramientas de escritura:",
  "package.json, next.config.js, tsconfig.json, prisma/schema.prisma, lib/prisma.ts, app/layout.tsx, app/page.tsx.",
  "search_files confirmó la creación de los archivos.",
].join("\n");

test("cierre: el reporte veraz de trabajo YA EXISTENTE no se tapa", () => {
  const c = componerCierre({
    resultado: {
      carril: "ORDEN",
      textoFinal: TEXTO_VERAZ,
      resumen: "Carril: ORDEN · llamadas: 5 · tokens: 100",
      herramientasEjecutadas: 29,
      hechos: { aplicados: [], fallos: [], denegadas: [] },
    },
  });
  assert.equal(c.corregida, false);
  assert.equal(c.voz, TEXTO_VERAZ);
});

test("cierre: el reporte FALSO de autoría (sin herramientas) sí se tapa", () => {
  const c = componerCierre({
    resultado: {
      carril: "ORDEN",
      textoFinal: TEXTO_FALSO,
      resumen: "Carril: ORDEN · llamadas: 1 · tokens: 100",
      herramientasEjecutadas: 0,
      hechos: { aplicados: [], fallos: [], denegadas: [] },
    },
  });
  assert.equal(c.corregida, true);
  assert.match(c.voz, /^Este turno no aplicó cambios\./);
});

function stubTurno(respuestas) {
  let i = 0;
  return async () => respuestas[Math.min(i++, respuestas.length - 1)];
}

test("turno PROPUESTA: la autoría fingida se corrige en el acto y llega la propuesta", async () => {
  const llamarModelo = stubTurno([
    { texto: "Ya creé tu SaaS completo: package.json, app/page.tsx y prisma/schema.prisma quedaron listos.", toolCalls: [], uso: { total: 100 } },
    { texto: "Propuesta: construir el SaaS en la raíz con package.json, app/ y prisma/, en este orden: base, datos, páginas. ¿La apruebas?", toolCalls: [], uso: { total: 100 } },
  ]);
  const r = await ejecutarTurno({
    texto: "quiero un saas de reportes para mis clientes, espero tu mejor propuesta o que me propones tu",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: [],
  });
  assert.equal(r.carril, "PROPUESTA");
  assert.equal(r.llamadas, 2);
  assert.match(r.textoFinal, /^Propuesta:/);
});

test("turno CONVERSACION: la autoría fingida se corrige en el acto", async () => {
  const llamarModelo = stubTurno([
    { texto: "He generado el resumen con resumen.md y datos.json como pediste.", toolCalls: [], uso: { total: 50 } },
    { texto: "Para generarlo necesito que me confirmes el rango de fechas; en cuanto me lo des, lo creo con la herramienta de documentos.", toolCalls: [], uso: { total: 50 } },
  ]);
  const r = await ejecutarTurno({
    texto: "¿qué opinas del resumen?",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: [],
  });
  assert.equal(r.carril, "CONVERSACION");
  assert.equal(r.llamadas, 2);
  assert.match(r.textoFinal, /^Para generarlo/);
});

test("turno ORDEN: el reporte de existencia tras explorar NO dispara corrección", async () => {
  const llamarModelo = stubTurno([
    { texto: "", toolCalls: [{ id: "1", nombre: "list_files", argumentos: {} }], uso: { total: 50 } },
    { texto: TEXTO_VERAZ, toolCalls: [], uso: { total: 50 } },
  ]);
  const r = await ejecutarTurno({
    texto: "crea una aplicacion o un saas de reportes de equipos en renta",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "3 entradas" }),
    herramientasCompletas: ["list_files"],
  });
  assert.equal(r.carril, "ORDEN");
  assert.equal(r.llamadas, 2);
  assert.equal(r.textoFinal, TEXTO_VERAZ);
});
