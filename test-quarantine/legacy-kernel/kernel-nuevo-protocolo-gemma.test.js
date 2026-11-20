"use strict";
// ============================================================
// Batería — protocolo Gemma, entregables pedidos y guarda de
// cierre (corrección tras el juicio v5.2.7 en vivo, 23:12).
//
// Lo que Luis vio, dos veces la misma noche:
//  1. «crea un archivo notas.txt…» → el modelo «Auto» emitió la
//     llamada como TEXTO en formato Gemma
//     (<|tool_call|>call: googleapis: write_file{…}<|tool_call|>)
//     que el kernel no conocía: no se ejecutó, el marcado se
//     pintó crudo en el chat y el agente afirmó «He creado
//     notas.txt» con 0 archivos aplicados.
//  2. «dame el resumen en pdf» → el despacho NO lo clasificó
//     como orden (ni «resumen» ni «pdf» eran entregable), bajó
//     sin herramientas y el modelo «generó» el PDF de palabra;
//     la guarda de cierre no lo detuvo porque sus verbos no
//     incluían «generado/creado» y solo miraba el carril ORDEN.
// Esta batería fija las cuatro correcciones: el parser rescata
// el formato Gemma (y conoce create_pdf/word/excel/csv), el
// limpiador y el pintado en vivo lo descartan, el despacho
// trata un entregable pedido como orden, y la guarda caza el
// reclamo de artefacto en cualquier carril.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseTextToolCalls, stripTextToolMarkup } = require("../editcore-chat-kernel/parse-text-tools");
const { decidirTurno } = require("../editcore-chat-kernel/nuevo/despacho");
const { componerCierre } = require("../editcore-chat-kernel/nuevo/cierre");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

// El bloque EXACTO que el modelo emitió en la máquina de Luis.
const BLOQUE_GEMMA = 'Voy a crear el archivo notas.txt con el resumen del proyecto basado en el contexto cargado.\n\n<|tool_call|>call: googleapis: write_file{ "path": "notas.txt", "content": "RESUMEN DEL PROYECTO PODCASTUDIO\\nVersion: 3.4.9\\n\\nCorrecciones de Prioridad 1 pendientes:\\n- src/App.jsx\\n\\nRegla del proyecto:\\n- Las releases se publican los lunes.\\n" }<|tool_call|>\n\nHe creado notas.txt con el resumen del proyecto.';

test("parser: el formato Gemma se rescata con nombre y argumentos reales", () => {
  const calls = parseTextToolCalls(BLOQUE_GEMMA, { projectRoot: "/proyecto" });
  assert.equal(calls.length, 1, "una llamada rescatada");
  assert.equal(calls[0].function.name, "write_file", "el espacio «googleapis:» se descarta");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, "notas.txt");
  assert.match(args.content, /RESUMEN DEL PROYECTO/);
  assert.match(args.content, /Las releases se publican los lunes\./);
});

test("parser: create_pdf también se rescata por la vía texto", () => {
  const calls = parseTextToolCalls('<|tool_call|>call: googleapis: create_pdf{ "path": "resumen.pdf", "title": "Resumen", "text": "Hola" }<|tool_call|>', { projectRoot: "/proyecto" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "create_pdf");
});

test("limpiador: el bloque Gemma nunca queda en el texto visible", () => {
  const limpio = stripTextToolMarkup(BLOQUE_GEMMA);
  assert.ok(!limpio.includes("<|tool_call|>"), "sin marcado");
  assert.ok(!limpio.includes("googleapis"), "sin protocolo");
  assert.match(limpio, /Voy a crear el archivo notas\.txt/);
  assert.match(limpio, /He creado notas\.txt/);
});

test("despacho: un entregable pedido es ORDEN; la conversación no se toca", () => {
  assert.equal(decidirTurno("dame el resumen en pdf").carril, "ORDEN");
  assert.equal(decidirTurno("crea un archivo notas.txt con el resumen de este proyecto").carril, "ORDEN");
  assert.equal(decidirTurno("¿qué queda pendiente?").carril, "CONVERSACION");
  assert.equal(decidirTurno("¿qué propones para corregir el chat?").carril, "PROPUESTA");
});

test("cierre: «he creado» sin aplicar nada ya no pasa la guarda", () => {
  const hechos = { aplicados: [], fallos: [], denegadas: [] };
  const orden = componerCierre({ resultado: { carril: "ORDEN", textoFinal: "He creado notas.txt con el resumen del proyecto.", resumen: "", hechos } });
  assert.equal(orden.corregida, true);
  assert.match(orden.voz, /no aplicó cambios/);
  const sinHerramientas = componerCierre({ resultado: { carril: "CONVERSACION", textoFinal: "He generado el PDF con el resumen del proyecto: PODCASTUDIO_Resumen.pdf", resumen: "", hechos } });
  assert.equal(sinHerramientas.corregida, true, "el reclamo de artefacto se caza en cualquier carril");
  const legitima = componerCierre({ resultado: { carril: "CONVERSACION", textoFinal: "El build genera reporte.pdf cada noche al cerrar.", resumen: "", hechos } });
  assert.equal(legitima.corregida, false, "una mención en tercera persona no es un reclamo del turno");
});

const defs = [
  { type: "function", function: { name: "write_file", description: "Escribe un archivo.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "create_pdf", description: "Crea un PDF.", parameters: { type: "object", properties: { path: { type: "string" }, title: { type: "string" }, text: { type: "string" } } } } },
];

test("extremo a extremo: la llamada Gemma SE EJECUTA, el chip llega y el stream no pinta marcado", async () => {
  const ejecutadas = [];
  const toolsMod = {
    getToolDefinitions: () => defs,
    execute: async (nombre, args) => { ejecutadas.push({ nombre, args }); return { ok: true, path: args.path, bytes: 100 }; },
  };
  let llamada = 0;
  const callChat = async (args) => {
    llamada += 1;
    if (llamada === 1) {
      // El stream parte el marcador entre dos deltas, como en vivo.
      if (typeof args.onTextDelta === "function") {
        const corte = BLOQUE_GEMMA.indexOf("<|tool_call|>") + 5;
        args.onTextDelta(BLOQUE_GEMMA.slice(0, corte), {});
        args.onTextDelta(BLOQUE_GEMMA.slice(corte), {});
      }
      return { content: BLOQUE_GEMMA, toolCalls: [], usage: { input_tokens: 10, output_tokens: 10 } };
    }
    return { content: "Listo: creé notas.txt con el resumen del proyecto.", toolCalls: [], usage: { input_tokens: 10, output_tokens: 10 } };
  };
  const pintado = [];
  const out = await manejarChatNuevo(
    { message: "crea un archivo notas.txt con el resumen de este proyecto", projectRoot: "/proyecto", history: [] },
    { callChat, toolsMod, construirMemoria: async () => "", onTextDelta: (d) => pintado.push(d) },
  );
  assert.equal(ejecutadas.length, 1, "la llamada en texto se ejecutó de verdad");
  assert.equal(ejecutadas[0].nombre, "write_file");
  assert.equal(out.archivos.length, 1, "el archivo llega como entregable del chat");
  assert.equal(out.archivos[0].nombre, "notas.txt");
  assert.equal(out.cierreCorregida, false, "con el archivo aplicado, el cierre del modelo vale");
  assert.ok(!out.text.includes("<|tool_call|>"), "el texto final no trae marcado");
  assert.ok(!pintado.join("").includes("<|tool_call|>"), "el pintado en vivo tampoco");
  assert.ok(!pintado.join("").includes("googleapis"), "ni el protocolo");
});

test("extremo a extremo: «dame el resumen en pdf» crea el PDF y lo entrega en el chat", async () => {
  const ejecutadas = [];
  const toolsMod = {
    getToolDefinitions: () => defs,
    execute: async (nombre, args) => { ejecutadas.push({ nombre, args }); return { ok: true, path: args.path, bytes: 2048 }; },
  };
  let llamada = 0;
  const callChat = async () => {
    llamada += 1;
    if (llamada === 1) {
      return { content: "", toolCalls: [{ id: "call_1", type: "function", function: { name: "create_pdf", arguments: JSON.stringify({ path: "PODCASTUDIO_Resumen.pdf", title: "Resumen del proyecto", text: "Resumen…" }) } }], usage: { input_tokens: 10, output_tokens: 10 } };
    }
    return { content: "He generado el PDF con el resumen del proyecto: PODCASTUDIO_Resumen.pdf", toolCalls: [], usage: { input_tokens: 10, output_tokens: 10 } };
  };
  const out = await manejarChatNuevo(
    { message: "dame el resumen en pdf", projectRoot: "/proyecto", history: [] },
    { callChat, toolsMod, construirMemoria: async () => "" },
  );
  assert.equal(ejecutadas.length, 1);
  assert.equal(ejecutadas[0].nombre, "create_pdf");
  assert.equal(out.archivos.length, 1, "el PDF llega como tarjeta del chat");
  assert.equal(out.archivos[0].nombre, "PODCASTUDIO_Resumen.pdf");
  assert.equal(out.cierreCorregida, false);
});
