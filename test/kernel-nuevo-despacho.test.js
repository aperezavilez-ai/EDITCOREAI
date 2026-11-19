"use strict";
// ============================================================
// BATERÍA DE ACEPTACIÓN — KERNEL NUEVO (despacho por carriles)
// Escrita ANTES que el kernel, con los mensajes REALES de Luis
// (chat forense de PodcastStudio, 2026-11-16, y este chat).
// Especificación de conducta de Luis: «más parecido a ti» —
//   pregunta          -> RESPONDE      (carril CONVERSACION, sin herramientas)
//   propuesta pedida  -> PROPONE       (carril PROPUESTA, sin ejecutar)
//   consulta de código-> LEE DIRIGIDO  (carril CONSULTA, lectura acotada)
//   orden             -> PROCEDE       (carril ORDEN, set completo)
// El clasificador viejo (classify.js) falla esta batería: la
// pregunta «realizaste el analisis o leiste...» sale ANALYZE
// porque contiene el sustantivo «analisis» (ANALYSIS_NOUN_RE).
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { decidirTurno } = require("../editcore-chat-kernel/nuevo/despacho");

const CASOS = [
  // --- CONVERSACION: responder, jamás explorar ---
  ["realizaste el analisis o leiste un analisis creado por otra ia,,, no es lo que te pedi", "CONVERSACION"],
  ["¿qué queda pendiente?", "CONVERSACION"],
  ["porque no me respondes en el chat cuando le pregunto algo?", "CONVERSACION"],
  ["¿qué es un jitter buffer y por qué causa pantalla negra?", "CONVERSACION"],
  ["porque usas mi nombre en primer lugar? no deberia mencionarme a mi puesto que mis reglas son las reglas de editcoreai", "CONVERSACION"],
  ["la camara sigue fallando", "CONVERSACION"],
  ["gracias, quedó bien", "CONVERSACION"],
  // --- PROPUESTA: proponer, jamás ejecutar ---
  ["que propones para corregir editcoreai", "PROPUESTA"],
  ["dame tu propuesta para corregir el chat", "PROPUESTA"],
  // --- ORDEN: proceder con el set completo ---
  ["hazme un analisis 100% forense de la sesion de camara, conexion, usb, wifi, y remota con celulares, quiero un analisis 100% real de todo el codigo y al final dame un reporte completo con tu propuesta a corregir", "ORDEN"],
  ["corrije todas las fallas con evidencia de correccion orden inmediata", "ORDEN"],
  ["Publica este proyecto", "ORDEN"],
  ["¿puedes corregir el error del login?", "ORDEN"],
  ["procede", "ORDEN"],
  // --- CONSULTA: lectura dirigida, nunca explorador sobre la raíz ---
  ["¿dónde está la función getUserMediaWithTimeout en el código?", "CONSULTA"],
  ["lista los archivos de src", "CONSULTA"],
  // Casos reales capturados en vivo (2026-11-19):
  ["PORQUE NO SE VISUALIZA EL PROYECTO FALTA ALGO?", "CONVERSACION"],
  ["PORQUE EXISTE UNA CARPETA EN LA CARPETA DE RAIZ CON OTRO NOMBRE QUE NO ES EL PROYECTO CORRIJE ESE NOMBRE", "ORDEN"],
];

for (const [texto, esperado] of CASOS) {
  test(`despacho: «${texto.slice(0, 48)}…» -> ${esperado}`, () => {
    const d = decidirTurno(texto);
    assert.equal(d.carril, esperado, `motivo devuelto: ${d.motivo}`);
  });
}

test("invariante: CONVERSACION y PROPUESTA viajan sin herramientas y sin escritura", () => {
  for (const [texto, esperado] of CASOS) {
    if (esperado !== "CONVERSACION" && esperado !== "PROPUESTA") continue;
    const d = decidirTurno(texto);
    assert.equal(d.herramientas, "ninguna", texto);
    assert.equal(d.puedeEscribir, false, texto);
  }
});

test("invariante: CONSULTA es lectura dirigida y sin escritura", () => {
  for (const [texto, esperado] of CASOS) {
    if (esperado !== "CONSULTA") continue;
    const d = decidirTurno(texto);
    assert.equal(d.herramientas, "lectura-dirigida", texto);
    assert.equal(d.puedeEscribir, false, texto);
  }
});

test("invariante: ORDEN viaja con el set completo y puede escribir", () => {
  for (const [texto, esperado] of CASOS) {
    if (esperado !== "ORDEN") continue;
    const d = decidirTurno(texto);
    assert.equal(d.herramientas, "completa", texto);
    assert.equal(d.puedeEscribir, true, texto);
  }
});
