"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleChat, steerChat, isChatRunning } = require("../editcore-chat-kernel/index");
const { crearEjecutarHerramienta } = require("../editcore-chat-kernel/nuevo/adaptador");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");

test("steerChat: inyecta la instrucción en vuelo y se incorpora en el turno", async () => {
  const steeringQueue = [];
  const llamadas = [];

  const llamarModelo = async ({ mensajes }) => {
    llamadas.push(mensajes);
    if (llamadas.length === 1) {
      // Simula que durante la primera llamada llega una instrucción de steering
      steeringQueue.push({ instruction: "No toques la base de datos, enfócate en el CSS" });
      return {
        toolCalls: [{ nombre: "read_file", args: { path: "style.css" } }],
        uso: { total: 100 },
      };
    }
    return {
      texto: "Entendido, aplicando cambios solo al CSS.",
      toolCalls: [],
      uso: { total: 100 },
    };
  };

  const ejecutarHerramienta = async () => ({ ok: true, resumen: "contenido css" });

  const resultado = await ejecutarTurno({
    texto: "Arregla la página",
    llamarModelo,
    ejecutarHerramienta,
    herramientasCompletas: ["read_file"],
    conHerramientas: true,
    steeringQueue,
  });

  assert.equal(resultado.carril, "ORDEN");
  assert.equal(llamadas.length, 2);
  // La segunda llamada al modelo debe contener el mensaje de steering en vuelo
  const segundoPrompt = llamadas[1];
  const mensajeSteering = segundoPrompt.find(
    (m) => m.role === "user" && m.content.includes("[Instrucción prioritaria del usuario recibida en vuelo]")
  );
  assert.ok(mensajeSteering, "El steering en vuelo debe estar presente en los mensajes del modelo");
  assert.ok(mensajeSteering.content.includes("No toques la base de datos, enfócate en el CSS"));
});

test("token harness readCache: lecturas repetidas de un archivo se sirven de caché", async () => {
  let conteoExecutes = 0;
  const execute = async (nombre, args) => {
    conteoExecutes += 1;
    return { ok: true, content: "const PORT = 3000;\nconsole.log(PORT);" };
  };

  const ejecutar = crearEjecutarHerramienta({
    execute,
    root: "/fake/root",
    helpers: {},
  });

  // Primera lectura: llama a execute
  const r1 = await ejecutar("read_file", { path: "server.js" });
  assert.equal(r1.ok, true);
  assert.equal(conteoExecutes, 1);

  // Segunda lectura del mismo archivo: se sirve de caché sin llamar a execute de nuevo
  const r2 = await ejecutar("read_file", { path: "server.js" });
  assert.equal(r2.ok, true);
  assert.equal(r2.cacheHit, true);
  assert.equal(conteoExecutes, 1, "La segunda lectura no debe volver a ejecutar I/O ni gastar tokens");

  // Si se escribe en el archivo, la caché se invalida
  await ejecutar("write_file", { path: "server.js", content: "nuevo contenido" });
  
  // Tercera lectura tras escritura: debe volver a llamar a execute
  const r3 = await ejecutar("read_file", { path: "server.js" });
  assert.equal(r3.ok, true);
  assert.equal(conteoExecutes, 3, "Tras write_file la caché de ese archivo se invalidó");
});
