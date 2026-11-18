"use strict";
// ============================================================
// Batería — la vista previa SOLO arranca por gesto explícito.
//
// El defecto (juicio v5.2.7): la app del proyecto abierto se
// abría sola detrás de EditCoreAI. Había CUATRO rutas de
// arranque automático en renderer.js: al activar un proyecto
// (cada apertura de la app), tras escribir ciertos archivos, en
// la recuperación por salud del preview y dentro de openPreview
// cuando el servidor no respondía — más el gancho tras cada
// turno en main.js (retirado en 956b551). Esta batería fija la
// regla: existe la bandera previewArranquePermitido, solo la
// levantan el botón de vista previa y el Enter de la URL, y
// toda llamada a startPreview vive detrás de esa compuerta o
// en el propio gesto.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function cuerpoDe(fn) {
  const i = renderer.indexOf(`function ${fn}`);
  assert.ok(i >= 0, `existe ${fn}`);
  return renderer.slice(i, i + 6000);
}

test("la bandera existe y solo la levantan los gestos explícitos y la activación con arranque logrado", () => {
  assert.match(renderer, /let previewArranquePermitido = false;/);
  const levantadas = renderer.match(/previewArranquePermitido = true;/g) || [];
  assert.equal(levantadas.length, 4, "refreshPreview (botón), el Enter de la URL y las dos ramas de activación que enlazan/arrancan la vista previa");
  assert.match(cuerpoDe("refreshPreview"), /previewArranquePermitido = true;/);
  assert.match(renderer, /if \(e\.key === "Enter"\) \{ previewArranquePermitido = true; openPreview\(\); \}/);
});

test("ninguna ruta automática arranca el preview", () => {
  assert.match(cuerpoDe("monitorPreviewHealth"), /if \(!previewArranquePermitido\) return;/,
    "el vigilante de salud no resucita previews no pedidas");
  assert.match(cuerpoDe("maybeRefreshPreviewAfterWrite"), /if \(!previewArranquePermitido\) return;/,
    "tras escribir solo se refresca una preview ya pedida");
  assert.match(cuerpoDe("openPreview"), /if \(!previewArranquePermitido\) \{\s*\n\s*\/\/ Sin gesto explícito/,
    "openPreview no arranca el servidor sin gesto");
  const activacion = renderer.slice(renderer.indexOf("Chat Home: no listar archivos"), renderer.indexOf("Chat Home: no listar archivos") + 5200);
  assert.match(activacion, /previewHealth/, "al activar primero se consulta si ya hay un servidor vivo");
  assert.match(activacion, /startPreview\?\.\(project\.projectRoot, \{ soloWeb: true \}\)/,
    "al activar se arranca SOLO en modo soloWeb (orden de Luis 2026-11-17: el navegador entra solo)");
});

test("main honra soloWeb: una app de escritorio nunca se abre sola", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const sitios = mainSrc.match(/omitidaEscritorio: true/g) || [];
  assert.equal(sitios.length, 2, "los dos sitios que resuelven destino de escritorio devuelven omitidaEscritorio en modo soloWeb");
  assert.match(mainSrc, /startProjectPreviewNow\(safeRoot, ownerId, opciones\?\.soloWeb === true\)/);
  assert.match(mainSrc, /ipcMain\.handle\("project:preview-start", async \(event, rootPath, opciones\)/);
});

test("main.js ya no arranca previews al cerrar un turno", () => {
  assert.match(main, /SIN arranque automático de preview/);
  assert.ok(!main.includes("startProjectPreview(rootPath, event.sender.id)"),
    "el gancho post-turno que lanzaba el dev del proyecto ya no existe");
});

test("main: un respaldo de preview nunca queda pegado — la siguiente petición reintenta el servidor real", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const i = mainSrc.indexOf("if (existing?.fallback) {");
  assert.ok(i > 0, "existe el retiro del respaldo al arrancar");
  const seg = mainSrc.slice(i, i + 700);
  assert.match(seg, /stopPreviewRuntime\(existing\)/);
  assert.match(seg, /previewProcesses\.delete\(safeRoot\)/);
  assert.match(seg, /existing = undefined/);
});
