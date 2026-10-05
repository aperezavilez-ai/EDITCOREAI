"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const CLIENT = fs.readFileSync(path.join(ROOT, "web-portal", "js", "cuentas.js"), "utf8");
const URL_BASE = "https://cuentas.test";
const ANON = "anon-publica-de-pruebas-0123456789";

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const jsonResponse = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function loadClient({ href = "https://www.editcore.mx/app.html", fetch } = {}) {
  const calls = [];
  const win = {
    EDITCOREAI_CUENTAS: { url: URL_BASE, anonKey: ANON },
    localStorage: storage(),
    sessionStorage: storage(),
    location: { href, origin: new URL(href).origin, assign(url) { win.assigned = url; } },
    history: { replaceState(_s, _t, url) { win.location.href = new URL(url, win.location.origin).href; } },
    crypto: crypto.webcrypto,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: async (url, opts = {}) => {
      calls.push({ url, ...opts, body: opts.body ? JSON.parse(opts.body) : undefined });
      return fetch(url, opts);
    },
  };
  vm.runInNewContext(CLIENT, { window: win, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Date, Math, Number, String, Boolean, Array, Object });
  return { win, api: win.EditCoreCuentas, calls };
}

function seedSession(win, { expiresIn = 3600 } = {}) {
  win.localStorage.setItem("editcoreai_web_session", JSON.stringify({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: { id: "u1", email: "ana@gmail.com" },
  }));
}

test("web: sin config no se considera conectada", () => {
  const { win, api } = loadClient({ fetch: async () => jsonResponse(500) });
  assert.equal(api.isConfigured(), true);
  win.EDITCOREAI_CUENTAS = undefined;
  assert.equal(api.isConfigured(), false);
});

test("web: login con Google usa PKCE s256 y vuelve a la misma web", async () => {
  const { win, api } = loadClient({ fetch: async () => jsonResponse(500) });
  await api.startGoogleLogin("/app.html");
  const url = new URL(win.assigned);
  assert.equal(url.origin + url.pathname, `${URL_BASE}/auth/v1/authorize`);
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("redirect_to"), "https://www.editcore.mx/app.html");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  const verifier = win.sessionStorage.getItem("editcoreai_web_pkce");
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(url.searchParams.get("code_challenge"), expected);
});

test("web: al volver de Google canjea el código una vez y limpia la URL", async () => {
  const { win, api, calls } = loadClient({
    href: "https://www.editcore.mx/app.html?code=abc123",
    fetch: async () => jsonResponse(200, { access_token: "at-9", refresh_token: "rt-9", expires_in: 3600, user: { id: "u9", email: "luis@gmail.com" } }),
  });
  win.sessionStorage.setItem("editcoreai_web_pkce", "verificador");
  const session = await api.completeLoginFromUrl();
  assert.equal(session.user.email, "luis@gmail.com");
  assert.equal(calls[0].url, `${URL_BASE}/auth/v1/token?grant_type=pkce`);
  assert.deepEqual(calls[0].body, { auth_code: "abc123", code_verifier: "verificador" });
  assert.equal(calls[0].headers.apikey, ANON);
  assert.equal(win.location.href, "https://www.editcore.mx/app.html");
  assert.equal(win.sessionStorage.getItem("editcoreai_web_pkce"), null);
  assert.equal(api.hasSession(), true);
});

test("web: el saldo viene del servidor y el token vencido se renueva antes", async () => {
  const { win, api, calls } = loadClient({
    fetch: async (url) => url.includes("grant_type=refresh_token")
      ? jsonResponse(200, { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, user: { id: "u1", email: "ana@gmail.com" } })
      : jsonResponse(200, { email: "ana@gmail.com", role: "user", status: "active", credits_balance: 12.5 }),
  });
  seedSession(win, { expiresIn: 10 });
  const acc = await api.account();
  assert.equal(acc.credits_balance, 12.5);
  assert.equal(api.isUnlimited(acc), false);
  assert.equal(api.isUnlimited({ role: "admin" }), true);
  assert.equal(calls[1].url, `${URL_BASE}/rest/v1/rpc/editcoreai_my_account`);
  assert.equal(calls[1].headers.Authorization, "Bearer at-2");
});

test("web: un 401 renueva la sesión y reintenta; si falla, la cierra", async () => {
  let accountCalls = 0;
  const { win, api } = loadClient({
    fetch: async (url) => {
      if (url.includes("grant_type=refresh_token")) return jsonResponse(400, { error: "invalid_grant" });
      accountCalls += 1;
      return jsonResponse(401, { message: "JWT expired" });
    },
  });
  seedSession(win);
  await assert.rejects(api.account(), (err) => err.code === "SESSION_EXPIRED");
  assert.equal(accountCalls, 1);
  assert.equal(api.hasSession(), false);
});

test("web: recarga crea el pago en el servidor y devuelve el enlace de Mercado Pago", async () => {
  const { win, api, calls } = loadClient({
    fetch: async (url) => url.endsWith("/offer")
      ? jsonResponse(200, { ok: true, enabled: true, mode: "auto", price: 399, currency: "MXN", credit_usd: 20 })
      : jsonResponse(200, { ok: true, url: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1" }),
  });
  seedSession(win);
  const offer = await api.paymentOffer();
  assert.equal(offer.mode, "auto");
  const checkout = await api.createCheckout();
  assert.match(checkout.url, /mercadopago/);
  assert.equal(calls[1].url, `${URL_BASE}/functions/v1/payments/checkout`);
  assert.equal(calls[1].method, "POST");
});

test("web: chat en streaming junta el texto y respeta saldo agotado", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: {"choices":[{"delta":{"content":" mundo"}}]}\n\ndata: [DONE]\n\n';
  const { win, api, calls } = loadClient({ fetch: async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }) });
  seedSession(win);
  const parts = [];
  const full = await api.chat({ model: "m1", messages: [{ role: "user", content: "hi" }], onDelta: (d) => parts.push(d) });
  assert.equal(full, "Hola mundo");
  assert.deepEqual(parts, ["Hola", " mundo"]);
  assert.equal(calls[0].url, `${URL_BASE}/functions/v1/ai-proxy/v1/chat/completions`);
  assert.equal(calls[0].body.stream, true);

  const broke = loadClient({ fetch: async () => jsonResponse(402, { error: { code: "OUT_OF_CREDITS", message: "Tu saldo se agotó." } }) });
  seedSession(broke.win);
  await assert.rejects(broke.api.chat({ model: "m1", messages: [] }), (err) => err.code === "OUT_OF_CREDITS" && err.status === 402);
});

const sseResponse = (body) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

test("web: modelos que razonan (Opus) muestran el razonamiento y luego la respuesta", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning":"Pienso"}}]}',
    'data: {"choices":[{"delta":{"reasoning":" bien"}}]}',
    'data: {"choices":[{"delta":{"content":"# Plan"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const { win, api } = loadClient({ fetch: async () => sseResponse(sse) });
  seedSession(win);
  const thoughts = [];
  const full = await api.chat({ model: "claude-opus-4.6", messages: [], onThinking: (t) => thoughts.push(t) });
  assert.equal(full, "# Plan");
  assert.deepEqual(thoughts, ["Pienso", "Pienso bien"]);
});

test("web: si la IA corta la respuesta durante el razonamiento se avisa en vez de quedar colgado", async () => {
  const cut = 'data: {"choices":[{"delta":{"reasoning":"Pienso"}}]}\n\n';
  const { win, api } = loadClient({ fetch: async () => sseResponse(cut) });
  seedSession(win);
  await assert.rejects(api.chat({ model: "claude-opus-4.6", messages: [] }), (err) => err.code === "STREAM_CUT");

  const partial = 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n';
  const p = loadClient({ fetch: async () => sseResponse(partial) });
  seedSession(p.win);
  assert.match(await p.api.chat({ model: "m1", messages: [] }), /^Hola\n\n⚠️ La conexión se cortó/);
});

test("web: el markdown de la IA se ve con formato y nunca inyecta HTML", () => {
  const md = require("../web-portal/js/markdown.js");
  const html = md.render("## Título\n\nTexto **fuerte** y `código`.\n\n- uno\n- dos\n\n```js\nconst a = 1 < 2;\n```\n\n<img src=x onerror=alert(1)>");
  assert.match(html, /<h2>Título<\/h2>/);
  assert.match(html, /<strong>fuerte<\/strong>/);
  assert.match(html, /<code>código<\/code>/);
  assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(html, /<pre><span class="code-lang">js<\/span>.*<code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(md.render("[x](javascript:alert(1))"), /^<p>\[x\]\(javascript:alert\(1\)\)<\/p>$/);
  assert.match(md.render("| A | B |\n|---|---|\n| 1 | 2 |"), /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
});

test("web: el chat usa la misma voz de EditCoreAI que el IDE, sin prometer herramientas", () => {
  const { webPersonaPrompt } = require("../scripts/write-web-config");
  const persona = webPersonaPrompt();
  assert.match(persona, /POLITICA_COMUNICACION_ELITE_V5/);
  assert.match(persona, /PRIMERA FRASE = RESPUESTA/);
  assert.match(persona, /VERSIÓN WEB/);
  assert.doesNotMatch(persona, /run_e2e_pipeline|ROADMAP|\(tools\)/);
  const app = fs.readFileSync(path.join(ROOT, "web-portal", "app.html"), "utf8");
  assert.match(app, /window\.EDITCORE_WEB_PERSONA/);
  assert.match(app, /onThinking:/);
  assert.match(app, /md\.render\(/);
});

test("web: login sin contraseñas fijas ni accesos de respaldo", () => {
  const login = fs.readFileSync(path.join(ROOT, "web-portal", "login.html"), "utf8");
  assert.doesNotMatch(login, /admin-master|signInWithPassword|password\s*===/);
  assert.match(login, /startGoogleLogin/);
  const app = fs.readFileSync(path.join(ROOT, "web-portal", "app.html"), "utf8");
  assert.doesNotMatch(app, /\|\|\s*"aperezavilez@gmail\.com"/, "sin sesión nadie debe quedar como administrador");
  assert.doesNotMatch(app, /fetch\("\/api\/chat"/);
  assert.match(app, /cuentas\.chat\(/);
});

test("web: la config pública se genera al publicar y nunca con service_role", () => {
  const { cuentasConfigJs } = require("../scripts/deploy-web");
  const js = cuentasConfigJs({ EDITCOREAI_CLOUD_PUBLIC_URL: "https://api.test/", EDITCOREAI_CLOUD_ANON_KEY: ANON });
  assert.equal(js, `window.EDITCOREAI_CUENTAS = ${JSON.stringify({ url: "https://api.test", anonKey: ANON })};\n`);
  const fakeServiceRole = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
  assert.throws(() => cuentasConfigJs({ EDITCOREAI_CLOUD_PUBLIC_URL: "https://api.test", EDITCOREAI_CLOUD_ANON_KEY: fakeServiceRole }), /service_role/);
  assert.throws(() => cuentasConfigJs({ EDITCOREAI_CLOUD_PUBLIC_URL: "http://api.test", EDITCOREAI_CLOUD_ANON_KEY: ANON }), /https/);
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /web-portal\/js\/cuentas-config\.js/);
});

test("web: los despliegues desde GitHub generan la config en el build de Vercel", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.equal(vercel.outputDirectory, "web-portal");
  assert.equal(vercel.buildCommand, "node scripts/write-web-config.js");
  const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split(/\r?\n/);
  assert.ok(ignore.includes("!/scripts/write-web-config.js"), "el script debe subir a Vercel");
  assert.ok(ignore.includes("/scripts/*"), "el resto de scripts no sube");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "write-web-config.js"), "utf8");
  const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  const local = requires.filter((r) => !r.startsWith("node:"));
  assert.deepEqual(local, ["../runtime/elite-communication-policy.js"], "en Vercel solo sube este archivo local");
  assert.ok(ignore.includes("!/runtime/elite-communication-policy.js"), "la política de comunicación debe subir a Vercel");
  assert.ok(ignore.includes("/runtime/*"), "el resto de runtime no sube");

  const { writeWebConfig } = require("../scripts/write-web-config");
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ec-webcfg-"));
  try {
    const out = writeWebConfig(dir, { EDITCOREAI_CLOUD_PUBLIC_URL: "https://api.test", EDITCOREAI_CLOUD_ANON_KEY: ANON });
    assert.match(fs.readFileSync(out, "utf8"), /^window\.EDITCOREAI_CUENTAS = /);
    assert.match(fs.readFileSync(path.join(dir, "js", "editcore-persona.js"), "utf8"), /^window\.EDITCORE_WEB_PERSONA = /);
    assert.throws(() => writeWebConfig(dir, {}), /EDITCOREAI_CLOUD_PUBLIC_URL/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("web: el servidor de cuentas acepta volver a editcore.mx tras Google", () => {
  const toml = fs.readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8");
  const line = toml.split(/\r?\n/).find((l) => l.startsWith("additional_redirect_urls"));
  assert.match(line, /https:\/\/www\.editcore\.mx\/\*\*/);
  assert.match(line, /https:\/\/editcore\.mx\/\*\*/);
  assert.match(line, /127\.0\.0\.1:55399\/callback/);
});
