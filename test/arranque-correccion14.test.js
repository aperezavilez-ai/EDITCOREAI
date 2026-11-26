// ============================================================
// CORRECCIÓN 14 — el arranque correcto (2026-11-26)
//
// Juicio en vivo de Luis sobre la C13: «sale igual… el
// recuadro de conectar con google encima de ese panel 5
// segundos y luego se quitaba… lo que hiciste fue hacerlo
// mas rapido que desaparezca, no es correcto: debe abrir
// correctamente en el proceso de deber ser de apertura».
//
// Tenía razón: la C13 solo maquilló la espera. La raíz
// completa, leída en código:
// (1) index.html traía el portal OCULTO y la app visible:
//     la primera pintura era el selector de proyecto, y la
//     cubierta llegaba después, encima de la app ya abierta.
// (2) El estado «Comprobando tu sesión…» vivía DENTRO de la
//     caja de Google que el modo comprobando oculta: ni el
//     aviso se veía; quedaba la tarjeta de login vacía.
// (3) Sin getSession disponible, nada sacaba la cubierta del
//     modo comprobando.
//
// El proceso correcto de apertura: la PRIMERA pintura ya es
// la cubierta de arranque (marca + «Comprobando tu
// sesión…», sin app debajo y sin formulario de Google); la
// sesión se resuelve UNA vez y hay UNA sola transición: a
// la app (sesión válida) o al login (sin sesión). El
// formulario de Google solo existe en el estado «sin
// sesión», nunca como pantalla intermedia.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "..", "chat-home.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "chat-home.css"), "utf8");

test("C14-1: la primera pintura es la cubierta de arranque (portal visible, sin hidden)", () => {
  const tag = html.match(/<div id="authPortalOverlay"[^>]*>/);
  assert.ok(tag, "existe el overlay");
  assert.ok(!/\shidden(\s|>|=)/.test(tag[0]), "el overlay NO nace hidden: es la primera pantalla");
  assert.ok(tag[0].includes('aria-hidden="false"'), "aria coherente con visible");
});

test("C14-2: el formulario de Google nace oculto en el arranque", () => {
  const tag = html.match(/<div class="ec-auth-form" id="authGoogleBox"[^>]*>/);
  assert.ok(tag, "existe la caja de Google");
  assert.ok(/\bhidden\b/.test(tag[0]), "la caja nace hidden: el login no es pantalla intermedia");
});

test("C14-3: el aviso de comprobación vive FUERA de la caja de Google y se ve desde la primera pintura", () => {
  const iBoot = html.indexOf('id="authBootStatus"');
  const iBox = html.indexOf('id="authGoogleBox"');
  assert.ok(iBoot > 0 && iBox > 0, "existen el aviso de arranque y la caja");
  assert.ok(iBoot < iBox, "el aviso de arranque va antes de la caja (fuera de ella)");
  const seg = html.slice(iBoot, iBoot + 200);
  assert.ok(seg.includes("Comprobando tu sesión"), "el aviso nace con su texto en el markup");
});

test("C14-4: setChecking gobierna caja y aviso de arranque a la vez", () => {
  const i = js.indexOf("const setChecking = (checking) => {");
  assert.ok(i > 0, "existe setChecking");
  const helper = js.slice(i, js.indexOf("};", i));
  assert.ok(helper.includes("googleBox.hidden = checking"), "la caja sigue al modo");
  assert.ok(helper.includes("bootStatus.hidden = !checking"), "el aviso de arranque es el espejo del modo");
});

test("C14-5: sin getSession disponible, la cubierta sale del modo comprobando (no se queda trabada)", () => {
  // El ancla es la llamada de arranque de setupAuthPortal (la
  // otra getSession del archivo es un flujo distinto, línea 643).
  const i = js.indexOf("getSession({ refresh: true }).then((sessionData) => {");
  assert.ok(i > 0, "existe la comprobación de arranque");
  const seg = js.slice(i, i + 900);
  assert.ok(/else\s*\{[^}]*setChecking\(false\);/.test(seg), "la rama else restaura la caja de login");
});

test("C14-6: el aviso de arranque tiene estilo y su [hidden] manda", () => {
  assert.ok(css.includes(".ec-auth-boot-status"), "existe la clase del aviso");
  assert.ok(/\.ec-auth-boot-status\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css), "su hidden es real");
});
