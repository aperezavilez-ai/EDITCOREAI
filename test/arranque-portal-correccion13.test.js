// ============================================================
// CORRECCIÓN 13 — el destello de Google al arrancar (2026-11-26)
//
// Reporte de Luis en vivo: al abrir la app sale el selector de
// proyecto, ~2 s después aparece la pantalla «Continuar con
// Google» y, como la sesión ya existe, se regresa solo al
// selector. Causa leída en código (chat-home.js,
// setupAuthPortal): el portal de sesión se muestra
// INCONDICIONALMENTE al arrancar («Sesión obligatoria…»),
// antes de comprobar nada; la comprobación
// getSession({refresh:true}) tarda lo que tarda el refresco
// contra el servidor y solo entonces applySession lo oculta.
// Un usuario con sesión válida veía la pantalla de login en
// cada arranque durante todo el refresco.
//
// La raíz: la cubierta de arranque nace en modo «comprobando»
// (setChecking(true)): cubre la app pero SIN el botón de
// Google; el botón solo aparece cuando una comprobación real
// resuelve «no autenticado» (applySession y la ruta de error
// restauran la caja con setChecking(false)).
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "chat-home.js"), "utf8");

function segmento(desde, hasta) {
  const i = fuente.indexOf(desde);
  assert.ok(i >= 0, `no se encontró: ${desde}`);
  const j = fuente.indexOf(hasta, i);
  assert.ok(j > i, `no se encontró el cierre tras: ${desde}`);
  return fuente.slice(i, j);
}

test("C13-1: la cubierta de arranque nace en modo comprobando, sin botón de Google", () => {
  assert.match(fuente, /setChecking\(true\);\s*\n\s*showAuthPortal\(\);/);
  // [RE-APUNTADO 2026-11-26, Corrección 14] El texto del aviso
  // se mudó de chat-home.js al markup de index.html (elemento
  // authBootStatus, fuera de la caja): ahí se verifica ahora.
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes("Comprobando tu sesión"), "el modo comprobando se anuncia como estado, no como login");
});

test("C13-2: el modo comprobando oculta la caja de Google", () => {
  const helper = segmento("const setChecking = (checking) => {", "};");
  assert.ok(helper.includes("googleBox.hidden = checking"), "setChecking gobierna la visibilidad de authGoogleBox");
});

test("C13-3: al resolver la sesión, applySession restaura la caja", () => {
  const apply = segmento("const applySession = (sessionData) => {", "googleBtn?.addEventListener");
  assert.ok(apply.includes("setChecking(false)"), "cualquier resolución (válida o no) sale del modo comprobando");
});

test("C13-4: la ruta de error de la comprobación también restaura la caja", () => {
  const idx = fuente.indexOf("No se pudo comprobar tu sesión");
  assert.ok(idx > 0, "existe el mensaje de error de comprobación");
  const antes = fuente.slice(Math.max(0, idx - 200), idx);
  assert.ok(antes.includes("setChecking(false)"), "el catch restaura la caja antes de mostrar el error");
});

test("C13-5: ya no existe la muestra incondicional vieja al arrancar", () => {
  assert.ok(
    !/Sesión obligatoria: sin sesión válida la app queda cubierta por esta pantalla\.\s*\n\s*showAuthPortal\(\);/.test(fuente),
    "el showAuthPortal() pelado de arranque desapareció",
  );
});
