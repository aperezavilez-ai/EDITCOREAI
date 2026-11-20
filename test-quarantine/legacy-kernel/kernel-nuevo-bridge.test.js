"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: contratos del puente y la superficie.
// 1) ARCHIVOS ENTREGADOS EN EL CHAT: cuando el turno crea un
//    archivo (un PDF, p. ej.), el resultado del puente trae
//    `archivos` [{ path, nombre, bytes }] para que la vista lo
//    ofrezca EN la burbuja con las dos acciones que preload ya
//    expone (Abrir y Mostrar en carpeta): el usuario actúa
//    sobre el archivo desde el propio mensaje, sin ir a
//    cazarlo al Explorador. Y el cierre lo nombra como
//    entregado en el mensaje, no como ruta suelta. El clic en
//    vivo lo juzga el usuario; aquí se prueba el contrato de
//    datos y el pintado en renderer.js.
// 2) La inyección del proveedor por helpers.callChat es la
//    costura que los contratos existentes ya usan con el
//    kernel viejo: el kernel nuevo la honra igual.
// 3) MEMORIA ENMARCADA COMO REFERENCIA: el Mapa y el Cerebro
//    entran al turno envueltos en un encabezado que los marca
//    como material de referencia — NO palabras del usuario en
//    esta conversación, posiblemente desactualizado, a
//    verificar antes de darlo por hecho. (En el juicio en
//    vivo el agente recitó la «Prioridad 1» del expediente
//    como si fuera el estado real y atribuyó al usuario un
//    síntoma que nunca escribió.)
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { handleChatKernel } = require("../runtime/chat-kernel-bridge");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

test("adaptador: el turno que crea un PDF entrega `archivos` con nombre y bytes", async () => {
  let llamada = 0;
  const callChat = async () => {
    llamada += 1;
    if (llamada === 1) {
      return {
        content: "",
        toolCalls: [{ id: "c1", type: "function", function: { name: "create_pdf", arguments: JSON.stringify({ path: "resumen.pdf", paragraphs: ["x"] }) } }],
        usage: { input_tokens: 900, output_tokens: 50 },
      };
    }
    return { content: "PDF creado con el resumen.", toolCalls: [], usage: { input_tokens: 1000, output_tokens: 40 } };
  };
  const DEFINICIONES = [
    { type: "function", function: { name: "create_pdf", description: "pdf", parameters: { type: "object", properties: {} } } },
  ];
  const out = await manejarChatNuevo(
    { message: "Crea un PDF con el resumen de este proyecto", projectRoot: "/proyecto", threadId: "ta1", runId: "ra1", apiBaseUrl: "x", apiKey: "k", model: "m" },
    {
      callChat,
      getToolDefinitions: () => DEFINICIONES,
      execute: async () => ({ ok: true, path: "resumen.pdf", bytes: 2332, format: "pdf" }),
      construirMemoria: async () => "",
    },
  );
  assert.deepEqual(out.archivos, [{ path: "resumen.pdf", nombre: "resumen.pdf", bytes: 2332 }]);
  // El cierre nombra el archivo como ENTREGADO en el mensaje,
  // no como una ruta suelta que haya que ir a buscar al disco.
  assert.match(out.detalle, /[Ee]ntregad/);
  assert.match(out.detalle, /resumen\.pdf/);
});

test("puente: el resultado trae `archivos` cuando el kernel nuevo crea un PDF real", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-bridge-archivos-"));
  let llamada = 0;
  const callChat = async () => {
    llamada += 1;
    if (llamada === 1) {
      return {
        content: "",
        toolCalls: [{ id: "c1", type: "function", function: { name: "create_pdf", arguments: JSON.stringify({ path: "resumen.pdf", title: "Resumen", paragraphs: ["Resumen del proyecto de prueba."] }) } }],
        usage: { input_tokens: 900, output_tokens: 50 },
      };
    }
    return { content: "PDF creado con el resumen del proyecto.", toolCalls: [], usage: { input_tokens: 1000, output_tokens: 40 } };
  };
  const res = await handleChatKernel({
    message: "Crea un PDF con el resumen de este proyecto",
    projectRoot: tmp,
    apiKey: "test-key",
    model: "test-model",
    kernelNuevo: true,
    helpers: { callChat },
  });
  assert.equal(res.ok, true);
  assert.equal(res.kernelNuevo, true);
  assert.ok(Array.isArray(res.archivos), "el resultado del puente trae archivos");
  assert.equal(res.archivos.length, 1);
  assert.equal(res.archivos[0].nombre, "resumen.pdf");
  // El entregable se genera en .editcore/entregables/ (regla de
  // Luis: la raíz no se llena de documentos) y esa es la ruta
  // que la tarjeta usa para su enlace de descarga.
  assert.equal(res.archivos[0].path, ".editcore/entregables/resumen.pdf");
  assert.ok(res.archivos[0].bytes > 400, `bytes reales del PDF: ${res.archivos[0].bytes}`);
  assert.ok(fs.existsSync(path.join(tmp, ".editcore", "entregables", "resumen.pdf")));
  assert.equal(fs.existsSync(path.join(tmp, "resumen.pdf")), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("puente: la memoria del turno llega ENMARCADA como referencia, no como palabras del usuario", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-bridge-memoria-"));
  let sistemaVisto = "";
  const callChat = async ({ messages }) => {
    sistemaVisto = String(messages?.[0]?.content || "");
    return { content: "Te respondo desde la conversación.", toolCalls: [], usage: { input_tokens: 600, output_tokens: 30 } };
  };
  const res = await handleChatKernel({
    message: "¿qué queda pendiente?",
    projectRoot: tmp,
    apiKey: "test-key",
    model: "test-model",
    kernelNuevo: true,
    helpers: {
      callChat,
      brainSearch: async () => [{ text: "DATO-CEREBRO-XYZ: frente abierto de ejemplo" }],
    },
  });
  assert.equal(res.ok, true);
  // El material del Cerebro llegó al turno…
  assert.match(sistemaVisto, /DATO-CEREBRO-XYZ/);
  // …pero ENVUELTO en el marco: referencia, no palabras del
  // usuario; puede estar desactualizado; no atribuir al usuario
  // síntomas ni frases que no escribió en este chat.
  assert.match(sistemaVisto, /[Mm]aterial de referencia/);
  assert.match(sistemaVisto, /NO son palabras del usuario/);
  assert.match(sistemaVisto, /desactualizad/);
  assert.match(sistemaVisto, /nunca atribuyas al usuario/);
  // Y el marco va ANTES del material enmarcado.
  assert.ok(sistemaVisto.indexOf("Material de referencia") < sistemaVisto.indexOf("DATO-CEREBRO-XYZ"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("textos: el sistema del núcleo enmarca la memoria como referencia", () => {
  const { SISTEMA_NUCLEO } = require("../editcore-chat-kernel/nuevo/textos");
  assert.match(SISTEMA_NUCLEO, /material de referencia/i);
  assert.match(SISTEMA_NUCLEO, /no.*palabras del usuario/i);
  assert.match(SISTEMA_NUCLEO, /desactualizad/i);
});

test("renderer: pinta los archivos entregados con su enlace Descargar desde el mensaje", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(src, /function pintarArchivosEntregados/);
  const inicio = src.indexOf("function pintarArchivosEntregados");
  const segmento = src.slice(inicio, inicio + 2600);
  assert.match(segmento, /editcoreProject/);
  // La acción de la tarjeta (regla de Luis): un enlace
  // «Descargar» que baja el archivo a Descargas vía preload.
  assert.match(segmento, /downloadFile/);
  assert.match(segmento, /Descargar/);
  // La función se invoca desde los puntos donde se pinta el
  // resultado (rama agente y rama chat), leyendo result.archivos.
  const invocaciones = src.match(/pintarArchivosEntregados\(/g) || [];
  assert.ok(invocaciones.length >= 3, `definición + 2 llamadas (hay ${invocaciones.length})`);
  assert.ok((src.match(/result\.archivos/g) || []).length >= 2);
});
