"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("saldo: sin códigos ni ajustes manuales; solo Mercado Pago y regalo de bienvenida", () => {
  const html = read("index.html");
  for (const id of ["adminVoucherCreateBtn", "adminGrantBtn", "settingsVoucherBtn", "outOfCreditsRedeemBtn", "adminPayLinkSaveBtn"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${id} ya no existe`);
  }
  assert.match(html, /id="adminSignupBonus"/);
  assert.match(html, /id="adminSignupBonusSaveBtn"/);
  assert.match(html, /id="outOfCreditsMsg"/, "el popup conserva su mensaje de estado del pago");

  const js = read("chat-home.js");
  assert.match(js, /adminSetSignupBonus/);
  assert.match(js, /function promptTopupIfEmpty/);
  assert.doesNotMatch(js, /startLinkPayment|adminCreateVoucher|adminGrant\?\./);
});

test("saldo: regalo por registro disponible en escritorio y web", () => {
  assert.match(read("preload.js"), /adminSetSignupBonus: \(payload\) => ipcRenderer\.invoke\("credits:admin-set-signup-bonus"/);
  assert.match(read("main.js"), /creditsIpc\("credits:admin-set-signup-bonus"/);
  assert.match(read("runtime/credit-ledger.js"), /editcoreai_admin_set_signup_bonus/);
  assert.match(read("web-portal/js/web-ide-bridge.js"), /adminSetSignupBonus:/);
});

test("servidor: regalo una vez por correo y un solo administrador", () => {
  const sql = read("supabase/migrations/20261006130000_editcoreai_signup_bonus.sql");
  assert.match(sql, /signup_bonus_claims/);
  assert.match(sql, /'bonus'/);
  assert.match(sql, /create unique index if not exists accounts_single_admin_idx on editcoreai\.accounts \(\(true\)\) where role = 'admin'/);
  assert.match(sql, /function public\.editcoreai_admin_set_signup_bonus/);
  assert.match(sql, /require_admin\(\)/);
});
