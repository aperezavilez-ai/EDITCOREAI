"use strict";
// ============================================================
// EL MENÚ DE MODELOS NO DEBE TERMINAR EN EL MODAL —
// probado en vivo (2026-11-18): el menú inferior lista el
// CATÁLOGO (catalogChatModelOptions: todos los modelos de la
// nube), pero el <select> oculto lleva UN modelo por perfil
// (verifiedChatModelOptions). Al pulsar un modelo del
// catálogo distinto al «actual» de su perfil,
// selectModelFromPicker no encontraba la opción y abría el
// modal de proveedores sin decir por qué: «al darle clic solo
// se abre eso». Corrección: la entrada sin opción se activa
// por su perfil verificado, con el mismo camino del change
// del select (verifiedProfileForModel + activateProvider);
// el modal queda solo para lo que no tiene perfil. Y la fila
// Auto responde al clic en todo el renglón, no solo en el
// interruptor.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const inicio = fuente.indexOf("async function selectModelFromPicker");
const cuerpo = fuente.slice(inicio, fuente.indexOf("\n}", inicio));

test("la entrada sin opción se activa por su perfil verificado antes de cualquier modal", () => {
  const iPerfil = cuerpo.indexOf("verifiedProfileForModel(entry.providerKey, entry.model)");
  const iActivar = cuerpo.indexOf("activateProvider(");
  const iModal = cuerpo.indexOf("openProviders()");
  assert.ok(iPerfil > -1, "resuelve el perfil por providerKey+modelo");
  assert.ok(iActivar > iPerfil, "activa el perfil resuelto");
  assert.ok(iModal > iActivar, "el modal es el último recurso, no el primero");
  assert.match(cuerpo, /loadProviderProfiles\(\)\.find\(\(item\) => item\.id === entry\.profileId && item\.status === "active"\)/);
});

test("la fila Auto del menú responde al clic en todo el renglón", () => {
  assert.match(fuente, /autoCopy\.addEventListener\("click", \(\) => toggle\.click\(\)\)/);
});

test("con un solo proveedor primario no se ofrece el Auto de ámbito «all» (su valor no existe en el select)", () => {
  // PRIMARY_PROVIDER_KEYS = ["meai"]: el select solo recibe
  // la opción Auto de ámbito «meai». La fila «all» ponía un
  // valor inexistente, el change caía en «sin modelo» y abría
  // el modal — el clic en «Auto» de Luis, probado en vivo.
  // [RE-APUNTADO 2026-11-26 — Corrección 11] La construcción
  // cambió (arreglo base «meai» + filas por proveedor), pero el
  // invariante es el mismo: la fila «all» solo nace dentro de
  // la compuerta isAdmin && PRIMARY_PROVIDER_KEYS.length > 1.
  assert.match(fuente, /const autoScopes = \[\{ scope: "meai", title: "Auto"[\s\S]*?if \(isAdmin && PRIMARY_PROVIDER_KEYS\.length > 1\)/);
});

test("la rama Auto cae en la primera opción Auto existente si el valor pedido no está en el select", () => {
  const iAuto = fuente.indexOf("async function selectModelFromPicker");
  const cuerpoAuto = fuente.slice(iAuto, fuente.indexOf("\n}", iAuto));
  assert.match(cuerpoAuto, /option\.dataset\?\.auto === "1"/);
});
