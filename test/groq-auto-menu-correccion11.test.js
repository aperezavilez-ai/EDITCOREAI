// ============================================================
// CORRECCIÓN 11 — Auto por proveedor en el menú del chat (2026-11-26)
//
// Captura de Luis (2026-11-26 12:23): el menú de modelos del
// chat muestra UN solo «Auto» (el general). No aparece «Auto ·
// EditCore Nube» para que los modelos de Groq roten por tarea.
// Causa leída en código: renderModelPickerMenu construye sus
// filas Auto con un arreglo fijo de UNA fila (scope "all"); las
// filas por proveedor existían solo en el selector de listas
// (el que arma <option> por grupo), no en este menú. El motor
// (Groq en Auto) ya sabe rotar por ámbito — faltaba la fila.
// M-1/M-2 replican el hueco en el menú; M-3 conserva el
// invariante del motor del que la fila depende.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AutoModel = require("../auto-model-selection");

function seccionMenu() {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const inicio = fuente.indexOf("function renderModelPickerMenu");
  assert.ok(inicio >= 0, "renderModelPickerMenu existe");
  const resto = fuente.slice(inicio);
  const fin = resto.indexOf("\nfunction ", 10);
  return resto.slice(0, fin > 0 ? fin : 4000);
}

test("M-1: el menú construye las filas Auto desde los proveedores con ámbito", () => {
  const menu = seccionMenu();
  assert.ok(menu.includes("isScopedAutoProvider"), "el menú consulta el ámbito Auto de cada proveedor");
  assert.ok(menu.includes("formatAutoLabel"), "el menú etiqueta las filas por proveedor (Auto · EditCore Nube)");
});

test("M-2: la fila única fija ya no es la única fuente de filas", () => {
  const menu = seccionMenu();
  assert.ok(menu.includes("[CORRECCIÓN 11"), "la construcción nueva está marcada");
  assert.ok(menu.includes("PRIMARY_PROVIDER_KEYS"), "las filas salen de los proveedores primarios");
});

test("M-3: el motor sostiene el ámbito groq que la fila activa", () => {
  assert.equal(AutoModel.isScopedAutoProvider("groq"), true);
  assert.equal(AutoModel.formatAutoLabel("groq"), "Auto · EditCore Nube");
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue("groq")), "groq");
  assert.equal(AutoModel.isScopedAutoProvider("nexus"), false);
});
