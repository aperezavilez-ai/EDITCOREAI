"use strict";
// ============================================================
// RESPUESTA COMPLETA Y TURNO QUE HABLA — dos defectos en vivo
// (2026-11-17, «sistemas contino»):
//  1) La propuesta llegó tras 1:09 de silencio total y «al
//     final solo vomita todo»: el modelo razona primero (eso
//     nunca se pinta, por regla) y la superficie no decía ni
//     una palabra mientras tanto.
//  2) La respuesta TERMINÓ A MITAD DE UNA FRASE («Formulario
//     independiente o») sin decir nada más: el tope de salida
//     del carril cortó la generación (finish_reason "length")
//     y NADIE en la cadena capturaba ese dato — el corte era
//     invisible y el muñón se presentaba como respuesta plena.
// Corrección: el finish_reason viaja (ai-core → provider →
// adaptador), el bucle pide UNA continuación cuando el corte
// es por tope y no hay herramientas de por medio, los topes de
// PROPUESTA/CONSULTA suben a lo que un entregable legible
// necesita, y el turno AVISA al empezar (según el carril) y
// late mientras espera el primer contenido.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { readOpenAiStream } = require("../runtime/ai-core");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");
const { manejarChatNuevo, crearLlamarModelo, TOPE_SALIDA_POR_CARRIL } = require("../editcore-chat-kernel/nuevo/adaptador");

test("ai-core: el stream captura finish_reason 'length'", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hola"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{"content":" mundo"},"finish_reason":"length"}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const out = await readOpenAiStream(new Response(sse), null, null, null);
  assert.equal(out.text, "Hola mundo");
  assert.equal(out.finishReason, "length");
});

test("ai-core: sin corte, finish_reason es 'stop'", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Fin."},"finish_reason":"stop"}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const out = await readOpenAiStream(new Response(sse), null, null, null);
  assert.equal(out.finishReason, "stop");
});

test("despacho: «espero tu mejor propuesta o que me propones tu» es PROPUESTA (caso real en vivo)", () => {
  const { decidirTurno } = require("../editcore-chat-kernel/nuevo/despacho");
  assert.equal(decidirTurno("espero tu mejor propuesta o que me propones tu").carril, "PROPUESTA");
  assert.equal(
    decidirTurno("necesito una aplicacion o un saas donde los clientes puedan hacer levantamientos de reportes de sus equipos que tienen bajo contrato de renta y espero tu mejor propuesta o que me propones tu").carril,
    "PROPUESTA",
  );
  assert.equal(decidirTurno("hola, ¿qué puedes hacer?").carril, "CONVERSACION");
});

test("topes: PROPUESTA y CONSULTA caben un entregable entero; CONVERSACION sigue breve", () => {
  assert.equal(TOPE_SALIDA_POR_CARRIL.PROPUESTA, 8000);
  assert.equal(TOPE_SALIDA_POR_CARRIL.CONSULTA, 4000);
  assert.equal(TOPE_SALIDA_POR_CARRIL.CONVERSACION, 1500);
  assert.equal(TOPE_SALIDA_POR_CARRIL.ORDEN, 0);
});

test("turno: respuesta cortada por tope se continúa una vez y llega entera", async () => {
  let llamada = 0;
  const llamarModelo = async ({ herramientas }) => {
    llamada += 1;
    if (llamada === 1) {
      return { texto: "Módulo de Toner:\n- Formulario independiente o", toolCalls: [], uso: { total: 900 }, cortadaPorTope: true };
    }
    assert.deepEqual(herramientas, [], "la continuación va sin herramientas");
    return { texto: "ficial de solicitud.\n\n¿Procedo con esta propuesta?", toolCalls: [], uso: { total: 400 } };
  };
  const r = await ejecutarTurno({
    texto: "¿qué propones para este proyecto?",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: ["write_file"],
  });
  assert.equal(r.carril, "PROPUESTA");
  assert.equal(r.textoFinal, "Módulo de Toner:\n- Formulario independiente oficial de solicitud.\n\n¿Procedo con esta propuesta?");
  assert.equal(r.respuestaParcial, false);
  assert.match(r.resumen, /dos partes/);
});

test("turno: si la continuación también se corta, el turno lo declara parcial", async () => {
  const llamarModelo = async () => ({ texto: "trozo ", toolCalls: [], uso: { total: 100 }, cortadaPorTope: true });
  const r = await ejecutarTurno({
    texto: "¿qué propones para este proyecto?",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: [],
  });
  assert.equal(r.textoFinal, "trozo trozo ");
  assert.equal(r.respuestaParcial, true);
  assert.match(r.resumen, /[Pp]arcial/);
});

test("aviso inicial por carril: ORDEN y PROPUESTA hablan al empezar; CONVERSACION no", async () => {
  const definicionesVacias = [];
  const mk = () => {
    const avisos = [];
    return { avisos, onAviso: (t) => avisos.push(String(t)) };
  };
  const callChatRapido = async () => ({ content: "Respuesta.", toolCalls: [], usage: { input_tokens: 10, output_tokens: 5 } });
  const base = { projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m" };

  const a1 = mk();
  await manejarChatNuevo(
    { ...base, message: "crea el archivo principal del proyecto" },
    { callChat: callChatRapido, getToolDefinitions: () => definicionesVacias, execute: async () => ({ ok: true }), construirMemoria: async () => "", onAviso: a1.onAviso },
  );
  assert.ok(a1.avisos.some((t) => /Manos a la obra/.test(t)), `ORDEN avisa al empezar: ${JSON.stringify(a1.avisos)}`);

  const a2 = mk();
  await manejarChatNuevo(
    { ...base, message: "¿qué propones para corregir el chat?" },
    { callChat: callChatRapido, getToolDefinitions: () => definicionesVacias, execute: async () => ({ ok: true }), construirMemoria: async () => "", onAviso: a2.onAviso },
  );
  assert.ok(a2.avisos.some((t) => /Preparo la propuesta/.test(t)), `PROPUESTA avisa al empezar: ${JSON.stringify(a2.avisos)}`);

  const a3 = mk();
  await manejarChatNuevo(
    { ...base, message: "hola, ¿qué puedes hacer?" },
    { callChat: callChatRapido, getToolDefinitions: () => definicionesVacias, execute: async () => ({ ok: true }), construirMemoria: async () => "", onAviso: a3.onAviso },
  );
  assert.ok(!a3.avisos.some((t) => /Manos a la obra|Preparo la propuesta|Reviso el proyecto/.test(t)), "CONVERSACION no necesita aviso inicial");
});

test("latido: si el modelo tarda, el turno dice que sigue en ello; si responde rápido, no", async () => {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const avisosLentos = [];
  const callChatLento = async ({ onTextDelta }) => {
    await dormir(170);
    onTextDelta?.("respuesta tardía");
    return { content: "respuesta tardía", toolCalls: [], usage: { input_tokens: 10, output_tokens: 5 } };
  };
  const llamarLento = crearLlamarModelo({
    callChat: callChatLento,
    perfil: {},
    definiciones: [],
    projectRoot: "/tmp/x",
    onTextDelta: null,
    onAviso: (t) => avisosLentos.push(String(t)),
    latidoMs: 40,
  });
  await llamarLento({ mensajes: [], herramientas: [] });
  assert.ok(avisosLentos.some((t) => /Sigo en ello/.test(t)), `el latido habló: ${JSON.stringify(avisosLentos)}`);

  const avisosRapidos = [];
  const callChatRapido = async ({ onTextDelta }) => {
    onTextDelta?.("ya");
    return { content: "ya", toolCalls: [], usage: { input_tokens: 10, output_tokens: 5 } };
  };
  const llamarRapido = crearLlamarModelo({
    callChat: callChatRapido,
    perfil: {},
    definiciones: [],
    projectRoot: "/tmp/x",
    onTextDelta: null,
    onAviso: (t) => avisosRapidos.push(String(t)),
    latidoMs: 40,
  });
  await llamarRapido({ mensajes: [], herramientas: [] });
  assert.ok(!avisosRapidos.some((t) => /Sigo en ello/.test(t)), "sin latido cuando el contenido llega enseguida");
});
