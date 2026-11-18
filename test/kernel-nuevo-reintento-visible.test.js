"use strict";
// ============================================================
// Batería — reintento VISIBLE y recuperación de respuestas
// cortadas (corrección tras el turno de 2:49 del juicio v5.2.7).
//
// La firma verificada en código: el gateway del proveedor corta
// a los ~2 min (524, transitorio) y provider.js reintentaba UNA
// vez EN SILENCIO — intento muerto sin una letra + reintento =
// una «espera eterna» de 2:49 con la respuesta cortada al final.
// Esta batería fija el comportamiento corregido:
//  1. provider.callChat avisa (onRetry) ANTES de reintentar.
//  2. El adaptador pasa el tope de inactividad por intento
//     (90 s, no los 300 s históricos) y reenvía el aviso.
//  3. Una respuesta parcial y casi vacía en una llamada SIN
//     herramientas se pide una vez más y se conserva la mejor;
//     con herramientas ofrecidas, jamás (nada de re-ejecutar
//     llamadas a medio escribir).
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-retry-log-"));
process.env.EDITCORE_USER_DATA_PATH = logDir;

const { callChat, rejectedKeys } = require("../editcore-chat-kernel/provider");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => text,
  };
}

test("provider: un 524 se reintenta UNA vez y el reintento se AVISA antes", async () => {
  rejectedKeys.clear();
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return jsonResponse(524, { error: { message: "gateway time-out" } });
    return jsonResponse(200, { choices: [{ message: { content: "respuesta del reintento" } }] });
  };
  const avisos = [];
  try {
    const out = await callChat({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "<redacted>",
      model: "modelo-x",
      messages: [{ role: "user", content: "hola" }],
      stream: false,
      onRetry: (info) => avisos.push(info),
    });
    assert.equal(out.text, "respuesta del reintento");
    assert.equal(fetchCalls, 2, "un intento + un reintento");
    assert.equal(avisos.length, 1, "el reintento se avisó exactamente una vez");
    assert.equal(avisos[0].status, 524);
  } finally {
    global.fetch = originalFetch;
  }
});

const toolsModVacio = {
  execute: async () => ({ ok: true }),
  getToolDefinitions: () => [],
  slimToolDefinitions: (d) => d,
};

test("adaptador: parcial casi vacía sin herramientas se pide otra vez y gana la completa", async () => {
  let llamadas = 0;
  const callChat = async () => {
    llamadas += 1;
    if (llamadas === 1) {
      return { content: "Según el mapa de orientación del proyecto (PODCAST", toolCalls: [], usage: { input_tokens: 50, output_tokens: 5 }, partial: true };
    }
    return { content: "Respuesta completa: quedan dos frentes abiertos.", toolCalls: [], usage: { input_tokens: 50, output_tokens: 20 }, partial: false };
  };
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "/proyecto", history: [] },
    { callChat, toolsMod: toolsModVacio, construirMemoria: async () => "" },
  );
  assert.equal(llamadas, 2, "la parcial casi vacía se re-pidió una vez");
  assert.match(out.text, /Respuesta completa/);
  assert.equal(out.incomplete, false, "la respuesta recuperada no queda marcada incompleta");
  assert.equal(out.usage.total_tokens, 125, "el uso suma AMBOS intentos (50+5 + 50+20), sin maquillar");
});

test("adaptador: parcial con sustancia NO se re-pide (se declara y ya)", async () => {
  let llamadas = 0;
  const textoLargo = "Análisis extenso del proyecto. ".repeat(20); // > 200 caracteres
  const callChat = async () => {
    llamadas += 1;
    return { content: textoLargo, toolCalls: [], usage: { input_tokens: 10, output_tokens: 10 }, partial: true };
  };
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "/proyecto", history: [] },
    { callChat, toolsMod: toolsModVacio, construirMemoria: async () => "" },
  );
  assert.equal(llamadas, 1, "una parcial con sustancia no se duplica: se presenta declarada");
  assert.equal(out.incomplete, true, "y el turno la declara incompleta");
});

test("adaptador: el cable lleva timeout de intento de 90s y el aviso de reintento llega a la superficie", async () => {
  let capturado = null;
  let avisos = 0;
  const callChat = async (args) => {
    capturado = args;
    if (typeof args.onRetry === "function") args.onRetry({ attempt: 0, status: 524 });
    return { content: "ok", toolCalls: [], usage: { input_tokens: 1, output_tokens: 1 }, partial: false };
  };
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", projectRoot: "/proyecto", history: [] },
    { callChat, toolsMod: toolsModVacio, construirMemoria: async () => "", onAviso: () => { avisos += 1; } },
  );
  assert.equal(capturado.timeoutMs, 90_000, "el intento muere a los 90s sin bytes, no a los 300s");
  assert.equal(avisos, 1, "el aviso de reintento subió hasta la superficie");
  assert.match(out.text, /ok/);
});
