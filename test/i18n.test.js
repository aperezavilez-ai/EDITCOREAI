"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { I18nManager } = require("../runtime/i18n");

test("I18nManager: returns Spanish translations by default", () => {
  const i18n = new I18nManager({ defaultLanguage: "es" });
  assert.equal(i18n.getLanguage(), "es");

  const t = i18n.getTranslations("es");
  assert.equal(t.settings, "Configuración");
  assert.equal(t.new_chat, "Nuevo Chat");
  assert.equal(t.credits_billing, "Créditos y Facturación");
  assert.equal(t.out_of_credits_title, "¡Créditos de IA Agotados!");
});

test("I18nManager: can switch to English and translate keys", () => {
  const i18n = new I18nManager({ defaultLanguage: "es" });
  i18n.setLanguage("en");
  assert.equal(i18n.getLanguage(), "en");

  assert.equal(i18n.t("settings"), "Settings");
  assert.equal(i18n.t("new_chat"), "New Chat");
  assert.equal(i18n.t("credits_billing"), "Credits & Billing");
});
