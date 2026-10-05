"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const loadPricing = () => import(pathToFileURL(path.join(ROOT, "supabase/functions/ai-proxy/pricing.mjs")).href);

const PAYLOAD = {
  group_ratio: { default: 1, vip: 10 },
  data: [
    { model_name: "claude-opus-4.8", quota_type: 0, model_ratio: 3, completion_ratio: 5, cache_ratio: 0.666666666667, create_cache_ratio: 3.333333333333, enable_groups: ["default", "vip"], supported_endpoint_types: ["openai", "anthropic"] },
    { model_name: "qwen3.5", quota_type: 0, model_ratio: 2, completion_ratio: 1, enable_groups: ["default"], supported_endpoint_types: ["openai"] },
    { model_name: "sd-2-fast", quota_type: 1, model_ratio: 0, model_price: 80, enable_groups: ["default"], supported_endpoint_types: ["openai"] },
    { model_name: "solo-vip", quota_type: 0, model_ratio: 1, completion_ratio: 1, enable_groups: ["vip"], supported_endpoint_types: ["openai"] },
  ],
};

test("Precios: ratio 3 = $6 por millón de entrada y $30 por millón de salida", async () => {
  const { indexPricing, providerCostUsd } = await loadPricing();
  const pricing = indexPricing(PAYLOAD, "default");
  const opus = pricing.models.get("claude-opus-4.8");
  assert.equal(providerCostUsd(opus, { prompt_tokens: 1_000_000, completion_tokens: 0 }, pricing.groupRatio), 6);
  assert.equal(providerCostUsd(opus, { prompt_tokens: 0, completion_tokens: 1_000_000 }, pricing.groupRatio), 30);
});

test("Precios: los tokens en caché cuestan menos", async () => {
  const { indexPricing, providerCostUsd } = await loadPricing();
  const pricing = indexPricing(PAYLOAD, "default");
  const opus = pricing.models.get("claude-opus-4.8");
  const sinCache = providerCostUsd(opus, { prompt_tokens: 100_000, completion_tokens: 1000 });
  const conCache = providerCostUsd(opus, { prompt_tokens: 100_000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 90_000 } });
  assert.ok(conCache < sinCache);
  assert.equal(conCache, Math.round((10_000 + 90_000 * 0.666666666667 + 1000 * 5) * 3 * 2) / 1e6);
});

test("Solo modelos de chat del grupo correcto y lista permitida", async () => {
  const { indexPricing, allowedModelNames } = await loadPricing();
  const pricing = indexPricing(PAYLOAD, "default");
  assert.deepEqual([...pricing.models.keys()], ["claude-opus-4.8", "qwen3.5"]);
  assert.deepEqual(allowedModelNames(pricing, null), ["claude-opus-4.8", "qwen3.5"]);
  assert.deepEqual(allowedModelNames(pricing, ["meai/qwen3.5"]), ["qwen3.5"]);
});

test("Los modelos repetidos con otro nombre se muestran una sola vez", async () => {
  const { dedupeModelNames, indexPricing, isModelAllowed } = await loadPricing();
  const meai = [
    "claude-opus-4.7", "minimax-m3", "claude-haiku-4-5", "qwen3.6", "claude-opus-4-6-thinking", "claude-opus-5",
    "kimi-k2.6", "deepseek-v4", "claude-opus-4-8", "minimax-m2.5", "claude-opus-5.5", "claude-sonnet-4.6",
    "claude-haiku-4.5", "claude-opus-4-7-thinking", "claude-haiku-4-5-20251001", "claude-opus-4.6",
    "claude-opus-4.7-thinking", "claude-opus-4.6-thinking", "claude-opus-5-5", "qwen3.5", "glm-5.2",
    "step-3.7-flash", "glm-5", "glm-5.1", "claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4.8",
    "claude-opus-4-6", "deepseek-v4-pro", "minimax-m2.7", "mimo-v2.5", "qwen3.6-plus", "claude-sonnet-5",
    "deepseek-v4-flash",
  ];
  const unique = dedupeModelNames(meai);
  assert.equal(unique.length, 25);
  for (const kept of ["claude-opus-4.8", "claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.7-thinking", "glm-5", "glm-5.1", "qwen3.6-plus"]) {
    assert.ok(unique.includes(kept), kept);
  }
  for (const hidden of ["claude-opus-4-8", "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"]) {
    assert.equal(unique.includes(hidden), false, hidden);
  }
  const pricing = indexPricing({ data: meai.map((model_name) => ({ model_name, quota_type: 0, model_ratio: 3, completion_ratio: 5 })) });
  assert.equal(isModelAllowed(pricing, null, "claude-opus-4-8"), true);
  assert.equal(isModelAllowed(pricing, null, "no-existe"), false);
});

test("El flujo de respuesta se lee sin modificarlo y toma el uso real", async () => {
  const { StreamUsageTracker, usageOrEstimate } = await loadPricing();
  const tracker = new StreamUsageTracker();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hola "}}]}\n\nda',
    'ta: {"choices":[{"delta":{"content":"mundo"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":40}}\n\n',
    "data: [DONE]\n\n",
  ];
  for (const c of chunks) tracker.push(c);
  tracker.finish();
  assert.equal(tracker.outputChars, "Hola mundo".length);
  assert.deepEqual(usageOrEstimate(tracker.usage, "x", tracker.outputChars), { prompt_tokens: 1200, completion_tokens: 40 });
});

test("Sin uso del proveedor se estima por caracteres (nunca gratis)", async () => {
  const { usageOrEstimate } = await loadPricing();
  const est = usageOrEstimate(null, "a".repeat(4000), 400);
  assert.equal(est.prompt_tokens, 1000);
  assert.equal(est.completion_tokens, 100);
  assert.equal(est.estimated, true);
});

test("Los errores no muestran el nombre del proveedor", async () => {
  const { sanitizeProviderText, normalizeModelName } = await loadPricing();
  const out = sanitizeProviderText("ME AI Cloud: saldo insuficiente en https://api.meai.cloud/v1 (meai) apicredits");
  assert.doesNotMatch(out, /me\s?ai|meai|apicredits/i);
  assert.equal(normalizeModelName("meai/claude-opus-4.8"), "claude-opus-4.8");
});

test("La app desvía las consultas de usuarios al servidor y no se cobra sola", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const ledger = fs.readFileSync(path.join(ROOT, "runtime/credit-ledger.js"), "utf8");
  assert.match(main, /creditLedger\.checkCanRun\(\)/);
  assert.match(main, /if \(access\.role !== "admin"[^)]*\)[\s\S]{0,400}aiProxyBaseUrl\(\)/);
  assert.match(main, /fallbackProfiles: cloudRoute \? \[\] :/);
  assert.doesNotMatch(ledger, /editcoreai_consume_credits/);
  const fn = fs.readFileSync(path.join(ROOT, "supabase/functions/ai-proxy/index.ts"), "utf8");
  assert.match(fn, /Deno\.env\.get\("MEAI_API_KEY"\)/);
  assert.doesNotMatch(fn, /sk-[A-Za-z0-9]{16,}/);
});

test("Respuestas: se quitan los datos internos del proveedor y queda el modelo pedido", async () => {
  const { scrubProviderFields } = await loadPricing();
  const clean = scrubProviderFields({
    model: "meai/minimax-m2.7",
    provider: "x",
    choices: [{ message: { content: "hola", provider_metadata: { gateway: { cost: "0" } } } }],
    usage: { prompt_tokens: 3, gateway_cost: 0.0049, market_cost: 0.0049 },
  }, "minimax-m2.7");
  assert.deepEqual(clean, { model: "minimax-m2.7", choices: [{ message: { content: "hola" } }], usage: { prompt_tokens: 3 } });
});

test("Solo se ofrecen los modelos a los que la clave tiene acceso", async () => {
  const { indexPricing, restrictToModels, allowedModelNames } = await loadPricing();
  const pricing = indexPricing(PAYLOAD, "default");
  assert.deepEqual(allowedModelNames(restrictToModels(pricing, ["claude-opus-4.8", "otro"]), null), ["claude-opus-4.8"]);
  assert.equal(restrictToModels(pricing, []), pricing);
});

test("Tabla de precios por millón en dólares de panel (entrada y salida)", async () => {
  const { indexPricing, panelPricesPerMillion } = await loadPricing();
  const rows = panelPricesPerMillion(indexPricing(PAYLOAD, "default"));
  assert.deepEqual(rows, [
    { model: "qwen3.5", input: 4, output: 4 },
    { model: "claude-opus-4.8", input: 6, output: 30 },
  ]);
});

test("Saldo de ME AI: ruta solo para administrador y cobro con costo real × margen", () => {
  const fn = fs.readFileSync(path.join(ROOT, "supabase/functions/ai-proxy/index.ts"), "utf8");
  assert.match(fn, /\/v1\/admin\/meai-balance/);
  assert.match(fn, /isMeaiBalance && account\.role !== "admin"/);
  assert.match(fn, /\/dashboard\/billing\/subscription/);
  assert.match(fn, /Number\(usage\?\.total_usage\) \/ 100/);
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261004120000_editcoreai_meai_balance.sql"), "utf8");
  assert.match(sql, /\('panel_usd_rate', '0\.02'::jsonb\)/);
  assert.match(sql, /v_real := round\(v_cost \* editcoreai\.setting_numeric\('panel_usd_rate', 0\.02\), 6\)/);
  assert.match(sql, /least\(round\(v_real \* editcoreai\.setting_numeric\('markup', 2\), 6\), acc\.credits_balance\)/);
  assert.match(sql, /grant execute on function public\.editcoreai_proxy_meai_snapshot\(numeric, numeric\) to service_role/);
  assert.match(sql, /editcoreai_admin_meai_summary\(\)[\s\S]{0,200}require_admin\(\)/);
});

test("Panel de administración: tarjeta de saldo de ME AI conectada de punta a punta", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const ledger = fs.readFileSync(path.join(ROOT, "runtime/credit-ledger.js"), "utf8");
  const auth = fs.readFileSync(path.join(ROOT, "runtime/auth-manager.js"), "utf8");
  for (const id of ["adminMeaiCard", "adminMeaiRemaining", "adminMeaiRemainingReal", "adminMeaiDaysLeft", "adminMeaiBarFill", "adminMeaiTable", "adminMeaiPrices"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(home, /renderMeaiCard\(\), renderAdminUsers\(\), renderAdminPayments\(\)/);
  assert.match(preload, /adminMeaiBalance: \(\) => ipcRenderer\.invoke\("credits:admin-meai-balance"\)/);
  assert.match(main, /creditsIpc\("credits:admin-meai-balance", \(ledger\) => ledger\.adminMeaiBalance\(\)\)/);
  assert.match(ledger, /editcoreai_admin_meai_summary/);
  assert.match(auth, /\/functions\/v1\/ai-proxy\/v1\/admin\/meai-balance/);
});

test("Saldo global: el administrador registra recargas y corrige el saldo", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  for (const id of ["adminMeaiTopupToggle", "adminMeaiAdjustToggle", "adminMeaiTopupSave", "adminMeaiAdjustSave", "adminMeaiTopupPanel",
    "adminMeaiTopupAmount", "adminMeaiTopupCurrency", "adminMeaiTopupFx", "adminMeaiTopupPack", "adminMeaiMarkup", "adminMeaiMarkupSave", "adminMeaiAdjustValue"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<option value="500\|21000">¥500 → 21,000 de panel<\/option>/);
  assert.match(html, /<option value="200\|8000">¥200 → 8,000 de panel<\/option>/);
  assert.match(home, /adminMeaiTopup\?\.\(\{ panel, amount, currency, fx/);
  assert.match(home, /adminMeaiSetBalance\?\.\(\{ remaining:/);
  assert.match(home, /adminSetMarkup\?\.\(markup\)/);
  assert.match(home, /Number\(live\.remaining_panel\) \+ offset/);
  assert.doesNotMatch(home, /panel × 0\.02|× 0\.02/);
  assert.match(preload, /adminMeaiTopup: \(payload\) => ipcRenderer\.invoke\("credits:admin-meai-topup", payload\)/);
  assert.match(preload, /fxRate: \(currency\) => ipcRenderer\.invoke\("credits:fx-rate", currency\)/);
  assert.match(main, /creditsIpc\("credits:admin-meai-set-balance"/);
  assert.match(main, /creditsIpc\("credits:admin-set-markup"/);
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261004130000_editcoreai_meai_adjust.sql"), "utf8");
  assert.match(sql, /editcoreai_admin_meai_set_balance\([\s\S]{0,300}require_admin\(\)/);
});

test("Costo real: compras en yuanes × tipo de cambio ÷ dólares de panel recibidos", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261004140000_editcoreai_meai_yuan.sql"), "utf8");
  assert.match(sql, /select 21000, round\(500 \* 0\.148808, 4\), 'Paquete ¥500 \(saldo actual\)', 'sistema', 'CNY', 500, 0\.148808/);
  assert.match(sql, /round\(sum\(real_usd\) \/ nullif\(sum\(panel_usd\), 0\), 8\)/);
  assert.match(sql, /values \(p_panel, round\(p_amount \* v_fx, 4\)/);
  assert.match(sql, /editcoreai_admin_meai_topup\([\s\S]{0,400}require_admin\(\)/);
  assert.match(sql, /editcoreai_admin_set_markup\([\s\S]{0,300}require_admin\(\)/);
  assert.match(sql, /editcoreai_admin_meai_delete_topup\([\s\S]{0,300}require_admin\(\)/);
  assert.ok(Math.abs((500 * 0.148808) / 21000 - 0.00354305) < 1e-8);
});

test("Panel de administración ocupa todo el ancho de la ventana", () => {
  const css = fs.readFileSync(path.join(ROOT, "chat-home.css"), "utf8");
  assert.match(css, /\.ec-settings-modal-card:has\(#settingsPaneCredits:not\(\[hidden\]\) #settingsAdminMasterDashboard:not\(\[hidden\]\)\) \{\s*width: calc\(100vw - 32px\);/);
  assert.match(css, /#settingsAdminMasterDashboard \.mx-card \{\s*width: 100%;/);
});

test("Streaming: limpia cada bloque data aunque llegue partido en trozos", async () => {
  const { SseScrubber } = await loadPricing();
  const sse = new SseScrubber("glm-5.1");
  const raw = 'data: {"model":"meai/glm","choices":[{"delta":{"content":"ho","provider_metadata":{"a":1}}}]}\n\ndata: [DONE]\n\n';
  const out = sse.push(raw.slice(0, 25)) + sse.push(raw.slice(25)) + sse.finish();
  assert.doesNotMatch(out, /provider_metadata/);
  assert.match(out, /"model":"glm-5\.1"/);
  assert.match(out, /"content":"ho"/);
  assert.ok(out.endsWith("data: [DONE]\n\n"));
});
