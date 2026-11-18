"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: adaptador a los contratos reales.
// El kernel nuevo no reimplementa proveedor ni herramientas:
// se conecta a callChat (provider.js) y a tools.execute /
// getToolDefinitions (tools.js) traduciendo formatos:
//  - callChat devuelve toolCalls en forma OpenAI
//    ({function:{name, arguments:JSON}}) y usage normalizado
//    ({input_tokens, output_tokens}): el adaptador los traduce
//    al formato del bucle y de vuelta.
//  - Las definiciones que viajan al proveedor se filtran por
//    el carril: en CONVERSACION viajan CERO definiciones.
//  - La salida tiene la forma que el bridge ya consume
//    (text / steps / kind / usage / mutations / incomplete).
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

const DEFINICIONES = [
  { type: "function", function: { name: "read_file", description: "lee", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_files", description: "busca", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_files", description: "lista", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "write_file", description: "escribe", parameters: { type: "object", properties: {} } } },
];

function depsBase(extra = {}) {
  return {
    getToolDefinitions: () => DEFINICIONES,
    construirMemoria: async () => "MAPA DEL PROYECTO (falso para la bateria)",
    execute: async () => ({ ok: true }),
    ...extra,
  };
}

test("pregunta de punta a punta: cero definiciones al proveedor, respuesta directa", async () => {
  const vistos = [];
  const callChat = async ({ messages, tools }) => {
    vistos.push({ messages, tools });
    return { content: "Te respondo desde la memoria.", toolCalls: [], usage: { input_tokens: 700, output_tokens: 60 } };
  };
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", threadId: "t1", runId: "r1", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  assert.equal(vistos.length, 1);
  assert.deepEqual(vistos[0].tools, []);
  assert.match(vistos[0].messages[0].content, /EditCoreAI/);
  assert.match(vistos[0].messages[0].content, /MAPA DEL PROYECTO/);
  assert.equal(out.text, "Te respondo desde la memoria.");
  assert.equal(out.kind, "CONVERSACION");
  assert.equal(out.usage.total_tokens, 760);
  assert.equal(out.threadId, "t1");
  assert.equal(out.runId, "r1");
});

test("orden de punta a punta: toolCall OpenAI se traduce, se ejecuta y se registra aplicado", async () => {
  let llamada = 0;
  const herramientasVistas = [];
  const callChat = async ({ tools }) => {
    llamada += 1;
    herramientasVistas.push((tools || []).map((t) => t.function.name));
    if (llamada === 1) {
      return {
        content: "",
        toolCalls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/x.js", content: "codigo" }) } }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      };
    }
    return { content: "Corregido y aplicado.", toolCalls: [], usage: { input_tokens: 1200, output_tokens: 80 } };
  };
  const ejecutadas = [];
  const execute = async (name, args) => { ejecutadas.push([name, args]); return { ok: true }; };
  const out = await manejarChatNuevo(
    { message: "corrije el error del login", threadId: "t2", runId: "r2", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat, execute }),
  );
  assert.deepEqual(ejecutadas, [["write_file", { path: "src/x.js", content: "codigo" }]]);
  assert.ok(herramientasVistas[0].includes("write_file"));
  assert.deepEqual(out.mutations, ["src/x.js"]);
  assert.equal(out.text, "Corregido y aplicado.");
  assert.equal(out.cierreCorregida, false);
});

test("consulta: al proveedor solo viajan las definiciones de lectura del carril", async () => {
  let toolsVistas = null;
  const callChat = async ({ tools }) => {
    toolsVistas = (tools || []).map((t) => t.function.name);
    return { content: "Esta en src/App.jsx.", toolCalls: [], usage: { input_tokens: 500, output_tokens: 40 } };
  };
  const out = await manejarChatNuevo(
    { message: "¿dónde está la función getUserMediaWithTimeout en el código?", threadId: "t3", runId: "r3", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  assert.equal(out.kind, "CONSULTA");
  assert.ok(toolsVistas.every((n) => ["list_files", "read_file", "search_files", "read_pdf"].includes(n)), `viajaron: ${toolsVistas}`);
});

test("imágenes del turno: viajan como partes image_url del último mensaje de usuario", async () => {
  let mensajesVistos = null;
  const callChat = async ({ messages }) => {
    mensajesVistos = messages;
    return { content: "Veo la captura.", toolCalls: [], usage: { input_tokens: 800, output_tokens: 30 } };
  };
  await manejarChatNuevo(
    { message: "¿qué ves en esta captura?", images: ["data:image/png;base64,AAA"], threadId: "t5", runId: "r5", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  const ultimoUsuario = [...mensajesVistos].reverse().find((m) => m.role === "user");
  assert.ok(Array.isArray(ultimoUsuario.content));
  assert.equal(ultimoUsuario.content[0].type, "text");
  assert.equal(ultimoUsuario.content[1].type, "image_url");
  assert.equal(ultimoUsuario.content[1].image_url.url, "data:image/png;base64,AAA");
});

test("una ruta local no se disfraza de imagen para el proveedor", async () => {
  let mensajesVistos = null;
  const callChat = async ({ messages }) => {
    mensajesVistos = messages;
    return { content: "ok", toolCalls: [], usage: { input_tokens: 100, output_tokens: 10 } };
  };
  await manejarChatNuevo(
    { message: "¿qué ves?", images: ["C:\\fotos\\captura.png"], threadId: "t6", runId: "r6", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  const ultimoUsuario = [...mensajesVistos].reverse().find((m) => m.role === "user");
  assert.equal(typeof ultimoUsuario.content, "string");
});

test("parcial propagado: partial del proveedor marca el resultado incomplete", async () => {
  const callChat = async () => ({ content: "Respuesta a mit", toolCalls: [], usage: { input_tokens: 500, output_tokens: 20 }, partial: true });
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", threadId: "tp2", runId: "rp2", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  assert.equal(out.incomplete, true);
  assert.match(out.detalle, /Respuesta (parcial|incompleta|cortada)/);
});

test("parcial propagado: streamError del proveedor también marca incomplete", async () => {
  const callChat = async () => ({ content: "Respuesta a mit", toolCalls: [], usage: { input_tokens: 500, output_tokens: 20 }, streamError: new Error("corte") });
  const out = await manejarChatNuevo(
    { message: "¿qué queda pendiente?", threadId: "tp3", runId: "rp3", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  assert.equal(out.incomplete, true);
});

test("cierre falso a traves de toda la pila: la salida lleva la correccion del kernel", async () => {
  const callChat = async () => ({ content: "Listo, todo corregido y completado.", toolCalls: [], usage: { input_tokens: 900, output_tokens: 50 } });
  const out = await manejarChatNuevo(
    { message: "corrije todas las fallas", threadId: "t4", runId: "r4", apiBaseUrl: "x", apiKey: "k", model: "m" },
    depsBase({ callChat }),
  );
  assert.equal(out.cierreCorregida, true);
  assert.match(out.text, /no aplicó cambios/);
  assert.deepEqual(out.mutations, []);
});
