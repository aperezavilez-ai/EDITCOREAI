"use strict";
// Batería — estilo de la tarjeta de archivos entregados.
// En el juicio v5.2.7 el PDF llegó al chat, pero las acciones
// «Abrir» / «Mostrar en carpeta» se pintaban con el botón por
// defecto del sistema («cuadros de PowerPoint», dijo Luis): las
// clases msg-attachment* no tenían NI UNA regla en styles.css.
// Esta batería fija que la tarjeta tiene estilo propio y que
// las acciones son enlaces de texto, sin caja.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("la tarjeta de entregados tiene estilo propio y acciones-enlace", () => {
  assert.match(css, /\.msg-attachment--entregado\s*\{[^}]*border-radius:\s*10px/);
  const accion = /\.msg-attachment-accion\s*\{([^}]*)\}/.exec(css);
  assert.ok(accion, "existe la regla de las acciones");
  assert.match(accion[1], /background:\s*none/);
  assert.match(accion[1], /border:\s*none/);
  assert.match(accion[1], /color:\s*var\(--ec-accent\)/);
  assert.match(css, /\.msg-attachment-accion:hover\s*\{\s*text-decoration:\s*underline/);
});
