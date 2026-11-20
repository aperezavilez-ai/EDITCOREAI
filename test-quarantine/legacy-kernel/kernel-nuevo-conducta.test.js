"use strict";
// ============================================================
// CONDUCTA Y CAPACIDADES — la prueba que Luis pidió antes de
// tocar su máquina (2026-11-18): el agente del chat actúa
// como debe (las reglas de conducta que recibe en CADA turno)
// y sus capacidades de creación funcionan sin errores de
// punta a punta: escribir en la raíz y en subcarpetas, editar,
// ejecutar en la terminal y verificar con la salida real.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { SISTEMA_NUCLEO } = require("../editcore-chat-kernel/nuevo/textos");
const { handleChatKernel } = require("../runtime/chat-kernel-bridge");

test("conducta: las reglas del agente cubren pregunta, propuesta, orden, existencia, recomendación única, fallo y verificación", () => {
  const reglas = [
    /pregunta o una duda, respondo: desde la conversación/,
    /se me pide una propuesta, propongo/,
    /es una orden, procedo: ejecuto con las herramientas/,
    /Nunca me quedo mudo/,
    /ya existe, lo digo con claridad/,
    /recomiendo esa una y procedo/,
    /leo el error y cambio el curso: nunca repito la misma llamada/,
    /Antes de cerrar un trabajo como hecho, lo verifico/,
    /en la raíz del proyecto abierto/,
    /Nunca describo como hecho/,
    /Tengo terminal \(run_command\)/,
  ];
  for (const re of reglas) assert.match(SISTEMA_NUCLEO, re);
});

function llamada(texto, toolCalls = []) {
  return { text: texto, toolCalls, usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 } };
}
function tc(id, nombre, args) {
  return { id, function: { name: nombre, arguments: JSON.stringify(args) } };
}

test("capacidades: crear un proyecto desde cero — escribir, anidar, ejecutar, editar y verificar con salida real", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conducta-cap-"));
  let i = 0;
  const mock = async ({ messages }) => {
    i += 1;
    const ultimo = messages[messages.length - 1];
    if (i === 1) return llamada("", [tc("1", "write_file", { path: "package.json", content: "{\"name\":\"mini\",\"type\":\"commonjs\"}" })]);
    if (i === 2) return llamada("", [tc("2", "write_file", { path: "src/index.js", content: "console.log(\"HOLA\");\n" })]);
    if (i === 3) return llamada("", [tc("3", "run_command", { command: "node src/index.js" })]);
    if (i === 4) {
      // La salida REAL del comando llegó al modelo: HOLA.
      assert.match(JSON.stringify(ultimo), /HOLA/);
      return llamada("", [tc("4", "replace_in_file", { path: "src/index.js", oldText: "HOLA", newText: "HOLA MUNDO" })]);
    }
    if (i === 5) return llamada("", [tc("5", "run_command", { command: "node src/index.js" })]);
    // Segunda verificación: la salida ya dice HOLA MUNDO.
    assert.match(JSON.stringify(ultimo), /HOLA MUNDO/);
    return llamada("Proyecto creado y verificado: package.json y src/index.js aplicados; la terminal imprimió HOLA y, tras la edición, HOLA MUNDO.");
  };
  const res = await handleChatKernel({
    message: "crea un proyecto node mínimo con package.json y src/index.js que imprima HOLA, córrelo para verificar, cambia el saludo a HOLA MUNDO y vuelve a correrlo",
    projectRoot: tmpDir,
    apiKey: "test",
    model: "test-model",
    allowWrite: true,
    permissionMode: "full",
    fullAccess: true,
    helpers: { callChat: mock },
    onProgress: () => {},
  });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "ORDEN");
  assert.equal(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8"), "{\"name\":\"mini\",\"type\":\"commonjs\"}");
  assert.equal(fs.readFileSync(path.join(tmpDir, "src", "index.js"), "utf8"), "console.log(\"HOLA MUNDO\");\n");
  assert.match(res.text, /verificado/);
});
