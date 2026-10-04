"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const rendererSrc = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
const chatHomeSrc = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");

function sliceFunction(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `no se encontró ${signature}`);
  let depth = 0;
  for (let i = src.indexOf(") {", start) + 2; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`función sin cerrar: ${signature}`);
}

function loadRoleFilter(session) {
  const code = [
    sliceFunction(rendererSrc, "function isCurrentUserAdmin()"),
    'const USER_MODEL_GROUP_LABEL = "Modelos";',
    sliceFunction(rendererSrc, "function isUserVisibleModelOption("),
    sliceFunction(rendererSrc, "function filterModelOptionsForRole("),
    "module.exports = { filterModelOptionsForRole };",
  ].join("\n");
  const sandbox = { window: { __editcoreSession: session }, module: { exports: {} } };
  vm.runInNewContext(code, sandbox);
  return sandbox.module.exports.filterModelOptionsForRole;
}

const CATALOG = [
  { providerKey: "custom:gafcore-gateway", modelProviderGroup: "meai", providerLabel: "ME AI Cloud", model: "meai/claude-opus-4.8" },
  { providerKey: "custom:gafcore-gateway", modelProviderGroup: "apicredits", providerLabel: "APICredits", model: "apicredits/gpt-5" },
  { providerKey: "meai", modelProviderGroup: "meai", providerLabel: "ME AI Cloud", model: "claude-sonnet-4.6" },
  { providerKey: "apicredits", modelProviderGroup: "apicredits", providerLabel: "APICredits", model: "gpt-5-mini" },
];

test("usuario normal: solo modelos ME AI y sin nombres de proveedor", () => {
  const filter = loadRoleFilter({ user: { isAdmin: false, role: "user" } });
  const visible = filter(CATALOG);
  assert.deepEqual(visible.map((e) => e.model), ["meai/claude-opus-4.8", "claude-sonnet-4.6"]);
  for (const entry of visible) {
    assert.equal(entry.providerLabel, "Modelos");
    assert.doesNotMatch(JSON.stringify(entry.providerLabel), /ME AI|APICredits/i);
  }
});

test("sin sesión se trata como usuario normal", () => {
  const filter = loadRoleFilter(null);
  assert.equal(filter(CATALOG).some((e) => /apicredits/i.test(e.modelProviderGroup)), false);
});

test("administrador ve todos los modelos con sus proveedores", () => {
  const filter = loadRoleFilter({ user: { isAdmin: true, role: "admin" } });
  const visible = filter(CATALOG);
  assert.equal(visible.length, CATALOG.length);
  assert.ok(visible.some((e) => e.providerLabel === "APICredits"));
});

test("las listas del chat y de Auto pasan por el filtro de rol", () => {
  assert.match(sliceFunction(rendererSrc, "function catalogChatModelOptions()"), /filterModelOptionsForRole\(/);
  assert.match(sliceFunction(rendererSrc, "function verifiedChatModelOptions()"), /filterModelOptionsForRole\(/);
  assert.match(sliceFunction(rendererSrc, "function currentAutoProviderScope()"), /!isCurrentUserAdmin\(\) \|\| PRIMARY_PROVIDER_KEYS\.length === 1\)\) return "meai"/);
  assert.match(sliceFunction(rendererSrc, "function resolveActiveChatProfile("), /isCurrentUserAdmin\(\)[\s\S]*: "meai"/);
});

test("proveedores y 'Configurar modelos' solo para el administrador", () => {
  assert.match(sliceFunction(rendererSrc, "function openProviders()"), /if \(!isCurrentUserAdmin\(\)\)[\s\S]*return;/);
  const setOptions = sliceFunction(rendererSrc, "function setChatModelOptions(");
  assert.match(setOptions, /if \(isAdmin\) \{\s*const configureOption/);
  assert.match(setOptions, /if \(isAdmin && PRIMARY_PROVIDER_KEYS\.length > 1\) \{\s*const allAuto/);
  const picker = sliceFunction(rendererSrc, "function renderModelPickerMenu()");
  assert.match(picker, /const autoScopes = isAdmin\s*\? \[[\s\S]*?\]\s*: \[\{ scope: "meai", title: "Auto"/);
  assert.match(chatHomeSrc, /\["providersBtn", "settingsOpenModelsDialogBtn"\][\s\S]*isAdm \? "" : "none"/);
  assert.match(chatHomeSrc, /normalized === "models" && window\.__editcoreSession\?\.user\?\.isAdmin !== true/);
});
