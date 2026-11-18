"use strict";
// ============================================================
// SELECTOR DE MODELOS — un endpoint personalizado SIN clave
// (local, tipo Ollama) quedaba «Funcional» en el modal de
// Modelos pero su modelo jamás aparecía en el selector del
// chat (caso real 2026-11-18: EDITCORE MODEL en
// localhost:11435, clave vacía, editcore-base-0.1 detectado y
// activado). Causa: los DOS constructores de la lista del
// chat exigían apiKey no vacía al perfil —
// verifiedChatModelOptions (el <select>) con `profile.apiKey`
// y catalogChatModelOptions (el menú del selector) con la
// clave efectiva — y el auto-detectar deja el perfil
// active + chatVerified + catalogConfirmed con apiKey ""
// porque esa ES la configuración válida del endpoint.
// La prueba evalúa las funciones REALES de renderer.js con el
// estado exacto que el auto-detectar guardó en la máquina.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

function extraer(desde, hasta) {
  const i = renderer.indexOf(desde);
  const j = renderer.indexOf(hasta);
  assert.ok(i >= 0 && j > i, `no se encontró el tramo ${desde} … ${hasta}`);
  return renderer.slice(i, j);
}

// El tramo con los constructores de la lista del chat y sus
// dependencias directas (mapProfileToModelOption →
// syncCustomProviderProfiles, que queda fuera).
const tramo = extraer("function mapProfileToModelOption", "async function syncCustomProviderProfiles");

function construirListas({ profiles, customProviders }) {
  const sandbox = {
    PRIMARY_PROVIDER_KEYS: ["meai"],
    PROVIDERS: { meai: { label: "ME AI Cloud", baseUrl: "https://api.meai.cloud/v1" } },
    loadProviderProfiles: () => profiles,
    loadCustomProviders: () => customProviders,
    resolveProviderApiKey: () => "",
    window: { __editcoreSession: { user: { isAdmin: true, role: "admin" } } },
    console,
  };
  vm.runInNewContext(
    `${tramo}\n;globalThis.__salida = { verifiedChatModelOptions, catalogChatModelOptions, perfilUtilizableSinClave };`,
    sandbox,
  );
  return sandbox.__salida;
}

// El perfil EXACTO que el auto-detectar guardó para Luis:
// active, verificado en vivo, clave vacía.
const PERFIL_LOCAL = {
  id: "editcore-model-local:editcore-base-0.1",
  providerKey: "custom:editcore-model-local",
  providerName: "EDITCORE MODEL",
  baseUrl: "http://localhost:11435/v1",
  apiKey: "",
  model: "editcore-base-0.1",
  modelCount: 1,
  status: "active",
  catalogConfirmed: true,
  chatVerified: true,
  checkedAt: 1760000000000,
  error: "",
};
const PROVEEDOR_LOCAL = {
  id: "editcore-model-local",
  name: "EDITCORE MODEL",
  baseUrl: "http://localhost:11435/v1",
  apiKey: "",
  enabledModels: ["editcore-base-0.1"],
};
const PERFIL_MEAI = {
  id: "meai:kimi-k2.6",
  providerKey: "meai",
  providerName: "ME AI Cloud",
  baseUrl: "https://api.meai.cloud/v1",
  apiKey: "clave-del-proxy",
  model: "kimi-k2.6",
  status: "active",
};

test("el modelo del endpoint sin clave APARECE en las dos listas del chat", () => {
  const listas = construirListas({ profiles: [PERFIL_LOCAL, PERFIL_MEAI], customProviders: [PROVEEDOR_LOCAL] });
  const verificadas = listas.verifiedChatModelOptions();
  const catalogo = listas.catalogChatModelOptions();
  const localEnVerificadas = verificadas.find((e) => e.model === "editcore-base-0.1");
  const localEnCatalogo = catalogo.find((e) => e.model === "editcore-base-0.1");
  assert.ok(localEnVerificadas, "verifiedChatModelOptions (el <select>) incluye editcore-base-0.1");
  assert.ok(localEnCatalogo, "catalogChatModelOptions (el menú) incluye editcore-base-0.1");
  assert.equal(localEnCatalogo.providerLabel, "EDITCORE MODEL");
  assert.equal(localEnVerificadas.providerKey, "custom:editcore-model-local");
});

test("el catálogo ME AI sigue intacto junto al endpoint local", () => {
  const listas = construirListas({ profiles: [PERFIL_LOCAL, PERFIL_MEAI], customProviders: [PROVEEDOR_LOCAL] });
  const modelos = listas.catalogChatModelOptions().map((e) => e.model).sort();
  assert.equal(JSON.stringify(modelos), JSON.stringify(["editcore-base-0.1", "kimi-k2.6"]));
});

test("la compuerta de envío no exige clave a un perfil verificado sin clave", () => {
  const listas = construirListas({ profiles: [PERFIL_LOCAL], customProviders: [PROVEEDOR_LOCAL] });
  assert.equal(listas.perfilUtilizableSinClave(PERFIL_LOCAL), true);
  assert.equal(listas.perfilUtilizableSinClave({ ...PERFIL_LOCAL, chatVerified: false }), false);
  assert.equal(listas.perfilUtilizableSinClave({ ...PERFIL_LOCAL, catalogConfirmed: false }), false);
  assert.equal(listas.perfilUtilizableSinClave(null), false);
  // La compuerta del envío (renderer.js) usa esa misma
  // exención: sin ella, mandar un mensaje con el modelo local
  // seleccionado moría en «Falta configurar la API key».
  const fuente = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(fuente, /if \(!modelFields\?\.apiKey && !perfilUtilizableSinClave\(selectedProfile\)\)/);
});

test("un perfil sin clave y SIN verificar no se cuela al selector", () => {
  const sinVerificar = { ...PERFIL_LOCAL, id: "x:fantasma", model: "fantasma-0.1", chatVerified: false, catalogConfirmed: false, checkedAt: 0 };
  const listas = construirListas({ profiles: [sinVerificar], customProviders: [PROVEEDOR_LOCAL] });
  assert.equal(listas.verifiedChatModelOptions().length, 0);
  assert.equal(listas.catalogChatModelOptions().length, 0);
});
