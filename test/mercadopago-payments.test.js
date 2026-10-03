"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const loadMp = () => import(pathToFileURL(path.join(ROOT, "supabase/functions/payments/mp.mjs")).href);

test("Mercado Pago: la preferencia cobra en pesos, avisa al servidor y vuelve a la página de EditCoreAI", async () => {
  const { buildPreference } = await loadMp();
  const pref = buildPreference({
    paymentId: "8cc6bf89-e4f7-4967-bfa2-76e16689d393",
    email: "cliente@gmail.com",
    amount: 399,
    currency: "mxn",
    creditUsd: 20,
    publicUrl: "https://api-editcoreai.gafcore.com/",
  });
  assert.equal(pref.items[0].unit_price, 399);
  assert.equal(pref.items[0].currency_id, "MXN");
  assert.match(pref.items[0].title, /\$20\.00 USD/);
  assert.equal(pref.external_reference, "8cc6bf89-e4f7-4967-bfa2-76e16689d393");
  assert.equal(pref.notification_url, "https://api-editcoreai.gafcore.com/functions/v1/payments/webhook");
  assert.equal(pref.back_urls.success, "https://api-editcoreai.gafcore.com/functions/v1/payments/return");
  assert.equal(pref.payer.email, "cliente@gmail.com");
});

test("Mercado Pago: solo los avisos de pagos con id numérico se procesan", async () => {
  const { webhookPaymentId } = await loadMp();
  const base = "https://x/functions/v1/payments/webhook";
  assert.equal(webhookPaymentId(`${base}?type=payment&data.id=123`, null), "123");
  assert.equal(webhookPaymentId(base, { type: "payment", data: { id: 456 } }), "456");
  assert.equal(webhookPaymentId(`${base}?topic=payment&id=789`, null), "789");
  assert.equal(webhookPaymentId(`${base}?topic=merchant_order&id=1`, null), "");
  assert.equal(webhookPaymentId(base, { type: "payment", data: { id: "1;drop" } }), "");
});

test("Mercado Pago: la firma x-signature se verifica cuando hay secreto", async () => {
  const { verifySignature } = await loadMp();
  const secret = "secreto-de-prueba";
  const manifest = "id:123;request-id:req-1;ts:1704908010;";
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const ok = await verifySignature({ secret, signature: `ts=1704908010,v1=${v1}`, requestId: "req-1", dataId: "123" });
  assert.equal(ok, true);
  const bad = await verifySignature({ secret, signature: `ts=1704908010,v1=${v1}`, requestId: "req-1", dataId: "124" });
  assert.equal(bad, false);
  assert.equal(await verifySignature({ secret, signature: "", requestId: "", dataId: "123" }), false);
  assert.equal(await verifySignature({ secret: "", signature: "", requestId: "", dataId: "123" }), true);
});

test("Mercado Pago: la app solo abre enlaces https de Mercado Pago", async () => {
  const { isMercadoPagoCheckoutUrl } = await loadMp();
  assert.equal(isMercadoPagoCheckoutUrl("https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1"), true);
  assert.equal(isMercadoPagoCheckoutUrl("http://www.mercadopago.com.mx/checkout"), false);
  assert.equal(isMercadoPagoCheckoutUrl("https://mercadopago.com.mx.evil.com/x"), false);
  assert.equal(isMercadoPagoCheckoutUrl("javascript:alert(1)"), false);
  assert.equal(isMercadoPagoCheckoutUrl("https://mpago.la/2HM7vGJ"), true);
  assert.equal(isMercadoPagoCheckoutUrl("https://mpago.la.evil.com/2HM7vGJ"), false);
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  assert.match(main, /if \(!isMercadoPagoCheckoutUrl\(res\.url\)\)[\s\S]{0,120}shell\.openExternal\(res\.url\)/);
});

test("Mercado Pago: el token solo vive en el servidor y el pago se confirma con su API", () => {
  const fn = fs.readFileSync(path.join(ROOT, "supabase/functions/payments/index.ts"), "utf8");
  assert.match(fn, /Deno\.env\.get\("MP_ACCESS_TOKEN"\)/);
  assert.doesNotMatch(fn, /APP_USR-[0-9a-f-]{10,}/i);
  assert.match(fn, /\/v1\/payments\/\$\{paymentId\}/);
  assert.match(fn, /editcoreai_payment_settle/);
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  assert.match(toml, /MP_ACCESS_TOKEN = "env\(EDITCOREAI_MP_ACCESS_TOKEN\)"/);
});

test("Link fijo: sin token se usa el link guardado en el servidor, validado antes de abrirlo", () => {
  const fn = fs.readFileSync(path.join(ROOT, "supabase/functions/payments/index.ts"), "utf8");
  assert.match(fn, /const mode = auto \? "auto" : link \? "link" : "manual";/);
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  assert.match(main, /if \(!offer\?\.ok \|\| !isMercadoPagoCheckoutUrl\(offer\.payment_link\)\)[\s\S]{0,120}shell\.openExternal\(offer\.payment_link\)/);
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261003170000_editcoreai_payment_link.sql"), "utf8");
  assert.match(sql, /editcoreai\.require_admin\(\)/);
});

test("Ver como usuario: las consultas del admin en esa vista pasan por el servidor de usuarios", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  assert.match(main, /const CLOUD_SESSION_KEY = "editcore-session";/);
  assert.match(main, /if \(access\.role !== "admin" \|\| apiKey === CLOUD_SESSION_KEY\)/);
  const home = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");
  assert.match(home, /realSession\.user\?\.isAdmin !== true\) return realSession;/);
  assert.match(home, /isAdmin: false,/);
});
