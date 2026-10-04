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

test("APICredits sigue disponible para el administrador y vuelve con su status si estaba oculto", () => {
  const { state } = unifyMeaiSecureState({
    "editcore-providers": { meai: { apiKey: "sk-meai", singleKey: true } },
    "editcore-provider-profiles": [
      { id: "apicredits:gpt-5.6-sol", providerKey: "apicredits", model: "gpt-5.6-sol", apiKey: "sk-ac", status: "hidden", hiddenStatus: "active" },
      { id: "apicredits:gpt-5-mini", providerKey: "apicredits", model: "gpt-5-mini", apiKey: "sk-ac2", status: "active" },
    ],
    "editcore-chat-config": { providerKey: "apicredits", model: "gpt-5.6-sol", apiKey: "sk-ac", modelSelectionMode: "auto", autoProviderScope: "all" },
  });
  const [restored, kept] = state["editcore-provider-profiles"];
  assert.equal(restored.status, "active");
  assert.equal("hiddenStatus" in restored, false);
  assert.equal(restored.apiKey, "sk-ac");
  assert.equal(kept.status, "active");
  const chat = state["editcore-chat-config"];
  assert.equal(chat.providerKey, "apicredits");
  assert.equal(chat.apiKey, "sk-ac");
  assert.equal(chat.autoProviderScope, "all");
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

test("panel: ME AI con una sola clave y APICredits para el administrador", () => {
  const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  assert.match(renderer, /const PRIMARY_PROVIDER_KEYS = \["meai", "apicredits"\];/);
  assert.match(renderer, /const HIDDEN_PROVIDER_KEYS = \[\];/);
  assert.match(renderer, /const SINGLE_KEY_PROVIDER_KEYS = \["meai"\];/);
  assert.match(renderer, /api\.hidden = true;/);
  assert.match(renderer, /async function verifyAllSingleKeyModels\(key\)/);
  assert.match(renderer, /const autoScopes = isAdmin\s*\? \[[\s\S]{0,300}scope: "apicredits", title: "Auto · APICredits"[\s\S]{0,200}: \[\{ scope: "meai", title: "Auto"/);
});
