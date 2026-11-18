"use strict";
// ============================================================
// REGISTRO DE DIAGNÓSTICO — el instrumento, no la cura.
// Verifica que la respuesta cruda del proveedor queda
// anotada tal como llegó (para poder diagnosticar en la
// máquina del usuario qué emite realmente el modelo cuando
// «narra y no ejecuta») y que el registro jamás rompe un
// turno aunque la ruta sea inválida.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { crearRegistro } = require("../editcore-chat-kernel/nuevo/registro");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");

test("registro: escribe JSONL legible en .editcore/turnos.jsonl", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
  const { anotar, archivo } = crearRegistro(raiz);
  anotar({ tipo: "inicio_turno", mensaje: "procede" });
  anotar({ tipo: "respuesta_proveedor", textoCrudo: "hola" });
  const lineas = fs.readFileSync(archivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].tipo, "inicio_turno");
  assert.equal(lineas[1].textoCrudo, "hola");
  assert.ok(lineas[0].ts);
});

test("registro: una ruta inválida nunca lanza", () => {
  const { anotar } = crearRegistro(path.join(os.tmpdir(), "reg-no-existe-\0x"));
  assert.doesNotThrow(() => anotar({ tipo: "x" }));
  const vacio = crearRegistro("");
  assert.doesNotThrow(() => vacio.anotar({ tipo: "x" }));
});

test("adaptador: la respuesta cruda del proveedor se reporta tal como llegó", async () => {
  const crudas = [];
  const callChat = async () => ({
    content: "Verificando el estado del directorio.\n<tool_code>{\"name\":\"list_files\",\"arguments\":{\"path\":\".\"}}</tool_code>",
    toolCalls: [],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  await manejarChatNuevo(
    { message: "procede", projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m", history: [] },
    {
      callChat,
      getToolDefinitions: () => [],
      execute: async () => ({ ok: true }),
      construirMemoria: async () => "",
      onRespuestaCruda: (info) => crudas.push(info),
    },
  );
  assert.equal(crudas.length, 1);
  assert.match(crudas[0].textoCrudo, /<tool_code>/, "el texto crudo conserva el dialecto para diagnosticarlo");
  assert.equal(crudas[0].nEstructurales, 0);
});
