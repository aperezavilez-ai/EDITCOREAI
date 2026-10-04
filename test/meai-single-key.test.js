"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { unifyMeaiSecureState, pickMeaiKey } = require("../runtime/meai-single-key");

const root = path.resolve(__dirname, "..");

test("todos los modelos ME AI usan la clave de claude-sonnet-4.6", () => {
  const { state, changed } = unifyMeaiSecureState({
    "editcore-providers": { meai: { apiKey: "sk-vieja" } },
    "editcore-provider-profiles": [
      { id: "meai:claude-sonnet-4.6", providerKey: "meai", model: "claude-sonnet-4.6", apiKey: "sk-buena", status: "active" },
      { id: "meai:glm-5", providerKey: "meai", model: "glm-5", apiKey: "sk-otra", status: "active" },
      { id: "meai:kimi-k2.6", providerKey: "meai", model: "kimi-k2.6", apiKey: "", status: "" },
    ],
  });
  assert.equal(changed, true);
  assert.equal(state["editcore-providers"].meai.apiKey, "sk-buena");
  assert.equal(state["editcore-providers"].meai.singleKey, true);
  assert.ok(state["editcore-provider-profiles"].every((p) => p.apiKey === "sk-buena"));
});

test("tras unificar, la clave del panel manda (el admin puede cambiarla)", () => {
  assert.equal(pickMeaiKey({ apiKey: "sk-nueva", singleKey: true }, [
    { providerKey: "meai", model: "claude-sonnet-4.6", apiKey: "sk-buena", status: "active" },
  ]), "sk-nueva");
});

test("APICredits queda oculto sin borrarse y el chat pasa a Auto de ME AI", () => {
  const { state } = unifyMeaiSecureState({
    "editcore-providers": { meai: { apiKey: "sk-meai", singleKey: true } },
    "editcore-provider-profiles": [
      { id: "apicredits:gpt-5.6-sol", providerKey: "apicredits", model: "gpt-5.6-sol", apiKey: "sk-ac", status: "active" },
    ],
    "editcore-chat-config": { providerKey: "apicredits", model: "gpt-5.6-sol", apiKey: "sk-ac", modelSelectionMode: "manual" },
  });
  const [ac] = state["editcore-provider-profiles"];
  assert.equal(ac.status, "hidden");
  assert.equal(ac.hiddenStatus, "active");
  assert.equal(ac.apiKey, "sk-ac");
  const chat = state["editcore-chat-config"];
  assert.equal(chat.providerKey, "meai");
  assert.equal(chat.apiKey, "sk-meai");
  assert.equal(chat.modelSelectionMode, "auto");
  assert.equal(chat.autoProviderScope, "meai");
});

test("el estado ya unificado no se reescribe", () => {
  const first = unifyMeaiSecureState({
    "editcore-providers": { meai: { apiKey: "sk-meai" } },
    "editcore-provider-profiles": [{ providerKey: "meai", model: "glm-5", apiKey: "sk-meai", status: "active" }],
  }).state;
  assert.equal(unifyMeaiSecureState(first).changed, false);
});

test("main aplica la regla al leer y al guardar la bóveda", () => {
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const uses = main.match(/require\("\.\/runtime\/meai-single-key"\)\.unifyMeaiSecureState/g) || [];
  assert.ok(uses.length >= 2);
  assert.match(main, /meaiAlreadyConfigured \|\| !apiKey\.startsWith\("sk-"\)/);
});

test("panel y chat: solo ME AI, sin clave por modelo, un solo Auto", () => {
  const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  assert.match(renderer, /const PRIMARY_PROVIDER_KEYS = \["meai"\];/);
  assert.match(renderer, /const SINGLE_KEY_PROVIDER_KEYS = \["meai"\];/);
  assert.match(renderer, /api\.hidden = true;/);
  assert.match(renderer, /async function verifyAllSingleKeyModels\(key\)/);
  assert.match(renderer, /const autoScopes = \[\{ scope: "meai", title: "Auto"/);
  assert.doesNotMatch(renderer, /Auto · APICredits/);
});
