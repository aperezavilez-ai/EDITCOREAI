"use strict";
// ============================================================
// Batería — tiempos medidos del turno + tope de salida por carril
// (corrección única tras la traza completa del juicio v5.2.7).
//
// La traza probó que todo el camino local suma milisegundos y que
// la espera vive DENTRO de la única llamada al proveedor, sin
// ningún instrumento que la desglose. Esta batería fija:
//  1. El turno reporta sus tiempos (memoria local / primer texto
//     del modelo / respuesta completa) y la línea «Tiempos:» llega
//     al detalle de hechos que el chat muestra.
//  2. El tope de salida viaja en el cable según el carril:
//     pregunta 1500 · propuesta 2500 · orden sin tope.
//  3. El primer texto se mide sobre deltas de CONTENIDO: el
//     razonamiento no cuenta como primer texto.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { manejarChatNuevo, TOPE_SALIDA_POR_CARRIL } = require("../editcore-chat-kernel/nuevo/adaptador");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Proveedor falso con tiempos controlados: razonamiento a los
// ~10 ms, primer contenido a los ~40 ms, fin a los ~90 ms.
// Captura los argumentos de cada llamada para inspeccionar el cable.
function proveedorConTiempos(captura) {
  return async function callChat(args) {
    captura.push(args);
    if (typeof args.onTextDelta === "function") {
      await sleep(10);
      args.onTextDelta("pensando en voz alta", { reasoning: true });
      await sleep(30);
      args.onTextDelta("Respuesta");
      await sleep(50);
      args.onTextDelta(" completa.");
    }
    return {
      content: "Respuesta completa.",
      toolCalls: [],
      usage: { input_tokens: 100, output_tokens: 10 },
      partial: false,
    };
  };
}

const depsBase = (captura) => ({
  callChat: proveedorConTiempos(captura),
  toolsMod: {
    execute: async () => ({ ok: true }),
    getToolDefinitions: () => [],
    slimToolDefinitions: (d) => d,
  },
  construirMemoria: async () => { await sleep(15); return "Mapa de prueba"; },
});

test("el turno reporta tiempos y la línea llega al detalle de hechos", async () => {
  const captura = [];
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "/proyecto", history: [] },
    depsBase(captura),
  );
  assert.ok(out.tiempos, "el resultado trae el desglose de tiempos");
  assert.ok(out.tiempos.memoriaMs >= 10, `memoria medida (${out.tiempos.memoriaMs} ms)`);
  assert.ok(out.tiempos.proveedorMs >= 80, `proveedor medido (${out.tiempos.proveedorMs} ms)`);
  assert.ok(
    out.tiempos.primerDeltaMs !== null && out.tiempos.primerDeltaMs >= 30,
    `primer texto medido tras el contenido, no tras el razonamiento (${out.tiempos.primerDeltaMs} ms)`,
  );
  assert.ok(out.tiempos.primerDeltaMs <= out.tiempos.proveedorMs, "el primer texto no puede llegar tras el total");
  assert.match(out.detalle, /Tiempos: memoria local: .*primer texto a los .*modelo: respuesta completa en/);
});

test("el tope de salida viaja por carril: pregunta 1500, propuesta 8000, orden sin tope", async () => {
  assert.equal(TOPE_SALIDA_POR_CARRIL.CONVERSACION, 1500);
  assert.equal(TOPE_SALIDA_POR_CARRIL.PROPUESTA, 8000);
  assert.equal(TOPE_SALIDA_POR_CARRIL.ORDEN, 0);

  // [Re-delimitada 2026-11-18] Los topes por carril gobiernan
  // los turnos SIN proyecto. Con proyecto abierto manda la
  // capacidad estructural: el tope es el de ORDEN (sin tope)
  // en todo turno, porque una llamada a herramienta grande
  // truncada a 1500 tokens muere a mitad de JSON — por eso la
  // pregunta y la propuesta de abajo van sin proyecto, y se
  // agrega el caso con proyecto.
  const capPregunta = [];
  await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "", history: [] },
    depsBase(capPregunta),
  );
  assert.equal(capPregunta[0].maxTokens, 1500, "la pregunta sin proyecto lleva tope de 1500 en el cable");

  const capPreguntaProyecto = [];
  await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "/proyecto", history: [] },
    depsBase(capPreguntaProyecto),
  );
  assert.equal(capPreguntaProyecto[0].maxTokens, 0, "con proyecto, la pregunta va sin tope: puede emitir herramientas");

  const capPropuesta = [];
  await manejarChatNuevo(
    { message: "¿qué propones para corregir el chat?", projectRoot: "", history: [] },
    depsBase(capPropuesta),
  );
  assert.equal(capPropuesta[0].maxTokens, 8000, "la propuesta sin proyecto lleva tope de 8000 en el cable");

  const capOrden = [];
  await manejarChatNuevo(
    { message: "crea un archivo de notas con el resumen", projectRoot: "/proyecto", history: [] },
    depsBase(capOrden),
  );
  assert.equal(capOrden[0].maxTokens, 0, "la orden va sin tope: manda su presupuesto del bucle");
});
