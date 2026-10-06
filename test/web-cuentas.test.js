"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const CLIENT = fs.readFileSync(path.join(ROOT, "web-portal", "js", "cuentas.js"), "utf8");
const BRIDGE = fs.readFileSync(path.join(ROOT, "web-portal", "js", "web-ide-bridge.js"), "utf8");
const AGENT = fs.readFileSync(path.join(ROOT, "web-portal", "js", "web-agent.js"), "utf8");
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

test("web: el agente usa la misma voz de EditCoreAI que el IDE y trabaja con herramientas sobre el proyecto", () => {
  assert.match(AGENT, /window\.EditCoreEliteCommunication\?\.ELITE_COMMUNICATION_POLICY/);
  assert.match(AGENT, /CONTEXTO: EDITCOREAI WEB/);
  assert.match(AGENT, /Nunca nombres a los proveedores/);
  for (const tool of ["list_files", "read_file", "search_files", "write_file", "replace_in_file", "delete_file"]) {
    assert.match(AGENT, new RegExp(`name: "${tool}"`), `falta la herramienta ${tool}`);
  }
  assert.match(AGENT, /phase: "narration_delta"/);
  assert.match(AGENT, /phase: "tool", name: call\.name, input: args, stage: "done"/);
  assert.match(AGENT, /phase: "final_report"/);
});

test("web: Enter envía la consulta y Shift+Enter hace salto de línea (mismo compositor del IDE)", () => {
  const chatHome = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");
  const handler = chatHome.match(/\$\("chatHomePrompt"\)\?\.addEventListener\("keydown"[\s\S]*?\n    \}\);/)?.[0] || "";
  assert.match(handler, /ev\.key === "Enter" && !ev\.shiftKey/);
  assert.match(handler, /submitHomePrompt\(\)/);
  assert.doesNotMatch(BRIDGE, /addEventListener\("keydown", \(ev\) => ev\.stopImmediatePropagation/, "la web no debe bloquear Enter");
});

test("web: login sin contraseñas fijas ni accesos de respaldo", () => {
  const login = fs.readFileSync(path.join(ROOT, "web-portal", "login.html"), "utf8");
  assert.doesNotMatch(login, /admin-master|signInWithPassword|password\s*===/);
  assert.match(login, /startGoogleLogin/);
  for (const src of [BRIDGE, AGENT]) {
    assert.doesNotMatch(src, /aperezavilez@gmail\.com/, "el rol lo decide el servidor, nunca un correo fijo");
    assert.doesNotMatch(src, /\/api\/chat/);
  }
  assert.match(AGENT, /\/functions\/v1\/ai-proxy\/v1/);
});

function loadBridge({ accountData, session = true, preloadApi = {} } = {}) {
  const ls = storage();
  if (session) {
    ls.setItem("editcoreai_web_session", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 9e9, user: { id: "u1", email: "ana@gmail.com", name: "Ana" } }));
  }
  const rpcCalls = [];
  const cuentas = {
    isConfigured: () => true,
    hasSession: () => Boolean(ls.getItem("editcoreai_web_session")),
    sessionUser: () => JSON.parse(ls.getItem("editcoreai_web_session") || "{}").user || {},
    completeLoginFromUrl: async () => null,
    account: async () => accountData,
    rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return fn === "editcoreai_admin_overview" ? { users_total: 3 } : { ok: true }; },
    meaiBalance: async () => ({ remaining: 10 }),
    listModels: async () => ["gpt-5.6-luna", "claude-sonnet-4.6"],
    logout: async () => ls.removeItem("editcoreai_web_session"),
  };
  const win = {
    EditCoreCuentas: cuentas,
    localStorage: ls,
    location: { href: "https://www.editcore.mx/app.html", pathname: "/app.html", search: "", origin: "https://www.editcore.mx" },
    addEventListener() {},
    dispatchEvent() {},
    __EDITCORE_PRELOAD_API: preloadApi,
  };
  win.window = win;
  class Document { createElement() { return {}; } }
  const context = {
    window: win,
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], documentElement: { setAttribute() {}, getAttribute: () => "blanco", classList: { add() {} } } },
    Document,
    MutationObserver: class { observe() {} },
    queueMicrotask,
    localStorage: ls,
    location: win.location,
    history: { replaceState() {} },
    URL, Event: class { constructor(type) { this.type = type; } }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Promise, Error, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, Date, RegExp, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(context);
  vm.runInContext(BRIDGE, context);
  const { webCommonJs } = require("../scripts/write-web-config");
  vm.runInContext(webCommonJs(fs.readFileSync(path.join(ROOT, "runtime", "credit-ledger.js"), "utf8"), "__editcoreCreditLedgerModule"), context);
  return { win, rpcCalls };
}

test("web: el administrador entra con su panel y el usuario sin él (lo decide el servidor)", async () => {
  const admin = loadBridge({ accountData: { email: "ana@gmail.com", role: "admin", status: "active", credits_balance: 0 } });
  const s = await admin.win.editcoreAuth.getSession({ refresh: true });
  assert.equal(s.isAuthenticated, true);
  assert.equal(s.user.isAdmin, true);
  assert.equal(s.user.name, "Ana");
  const overview = await admin.win.editcoreCredits.adminOverview();
  assert.equal(overview.ok, true);
  assert.equal(overview.overview.users_total, 3);
  assert.equal(admin.rpcCalls[0].fn, "editcoreai_admin_overview");
  const bal = await admin.win.editcoreCredits.getBalance();
  assert.equal(bal.isUnlimited, true);

  const user = loadBridge({ accountData: { email: "luis@gmail.com", role: "user", status: "active", credits_balance: 4.5, topup_base: 20 } });
  const us = await user.win.editcoreAuth.getSession({ refresh: true });
  assert.equal(us.user.isAdmin, false);
  assert.equal(us.user.credits_balance, 4.5);
  const ubal = await user.win.editcoreCredits.getBalance();
  assert.equal(ubal.isUnlimited, false);
  assert.equal(ubal.canExecute, true);

  const none = loadBridge({ session: false, accountData: null });
  const ns = await none.win.editcoreAuth.getSession({ refresh: true });
  assert.equal(ns.isAuthenticated, false);
  assert.equal(ns.user, null);
});

test("web: canjear código usa el mismo servidor y lo que es de escritorio responde «no disponible»", async () => {
  const { win, rpcCalls } = loadBridge({
    accountData: { email: "luis@gmail.com", role: "user", status: "active", credits_balance: 1 },
    preloadApi: { editcoreUpdates: ["check"], editcorePty: ["create", "onData"], editcoreProject: ["pick", "onboard"] },
  });
  await win.editcoreCredits.redeem("ABC-123");
  assert.equal(JSON.stringify(rpcCalls[0]), JSON.stringify({ fn: "editcoreai_redeem_voucher", args: { p_code: "ABC-123" } }));
  const update = await win.editcoreUpdates.check();
  assert.equal(update.ok, false);
  assert.equal(update.webUnavailable, true);
  assert.match(update.error, /app de escritorio/);
  assert.equal(typeof win.editcorePty.onData(() => {}), "function", "los on* devuelven una función para desuscribirse");
  assert.equal((await win.editcoreProject.onboard()).webUnavailable, true);
  assert.equal(await win.editcoreProject.pick(), null, "en la web no se abren carpetas del disco");
  assert.equal(win.EDITCORE_IS_WEB, true);
  assert.equal(win.EDITCORE_WEB_CATALOG, "/proyectos");
});

test("web: los proyectos y sus archivos viven en la cuenta (crear, listar, editar, renombrar, borrar y vista previa)", async () => {
  const { win } = loadBridge({ accountData: { email: "luis@gmail.com", role: "user", status: "active", credits_balance: 1 } });
  const P = win.editcoreProject;
  const created = await P.create({ name: "Mi Tienda", parentPath: "/proyectos" });
  assert.equal(created.root, "/proyectos/mi-tienda");
  assert.equal((await P.create({ name: "Mi Tienda" })).root, "/proyectos/mi-tienda-2", "no pisa un proyecto con el mismo nombre");
  assert.equal(JSON.stringify((await P.catalog()).map((p) => p.root).sort()), JSON.stringify(["/proyectos/mi-tienda", "/proyectos/mi-tienda-2"]));
  const names = (await P.list(created.root, "")).map((e) => e.name).sort();
  assert.equal(JSON.stringify(names), JSON.stringify(["app.js", "index.html", "styles.css"]));
  await P.saveEditor({ projectRoot: created.root, path: "css/extra.css", content: "h1{color:red}" });
  assert.equal((await P.readText({ projectRoot: created.root, path: "css/extra.css" })).content, "h1{color:red}");
  assert.ok((await P.list(created.root, "")).some((e) => e.name === "css" && e.kind === "directory"));
  await P.renameEntry({ projectRoot: created.root, from: "css/extra.css", to: "css/main.css" });
  await assert.rejects(P.readText({ projectRoot: created.root, path: "css/extra.css" }));
  await P.deleteEntry({ projectRoot: created.root, path: "css", recursive: true });
  assert.ok(!(await P.list(created.root, "")).some((e) => e.name === "css"));
  await assert.rejects(P.readText({ projectRoot: created.root, path: "../otro/index.html" }), "no sale de la carpeta del proyecto");
  const preview = await P.startPreview(created.root);
  assert.equal(preview.available, true);
  assert.match(preview.url, /\/preview\/mi-tienda\/index\.html$/);
});

test("web: /app es el IDE completo (mismo index.html y mismos scripts) en cada publicación", () => {
  const { writeWebConfig, ideSourceFiles } = require("../scripts/write-web-config");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sources = ideSourceFiles(indexHtml);
  for (const f of ["renderer.js", "chat-home.js", "styles.css", "ide/editor-pane.js", "runtime/project-files-ui.js", "assets/editcore-logo.png"]) {
    assert.ok(sources.includes(f), `index.html debe cargar ${f}`);
  }
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ec-webapp-"));
  try {
    writeWebConfig(dir, { EDITCOREAI_CLOUD_PUBLIC_URL: "https://api.test", EDITCOREAI_CLOUD_ANON_KEY: ANON });
    const app = fs.readFileSync(path.join(dir, "app.html"), "utf8");
    for (const id of ['id="welcomeScreen"', 'id="chatForm"', 'id="previewWebview"', 'id="fileList"', 'id="appStatusBar"', "chatHomeShell", "authPortalOverlay", "outOfCreditsModal", "settingsAdminMasterDashboard"]) {
      assert.ok(app.includes(id), `falta ${id} en /app`);
    }
    assert.doesNotMatch(app, /Content-Security-Policy/, "la CSP de escritorio (connect-src 'none') no aplica en la web");
    assert.doesNotMatch(app, /(src|href)="\.\//, "todas las rutas apuntan a /ide/");
    assert.match(app, /<body[^>]*class="is-web"/);
    assert.match(app, /localStorage\.setItem\("editcore-app-mode","ide"\)/, "la web abre con el diseño del IDE aunque antes se usara solo el chat");
    const scripts = [...app.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts.slice(0, 6), ["/js/cuentas-config.js", "/js/cuentas.js", "/ide/preload-api.js", "/js/web-ide-bridge.js", "/js/web-agent.js", "/ide/credit-ledger.js"], "el puente web va antes que los scripts del IDE");
    assert.ok(scripts.includes("/ide/renderer.js") && scripts.includes("/ide/chat-home.js"));
    for (const f of sources) {
      assert.ok(fs.readFileSync(path.join(dir, "ide", f)).equals(fs.readFileSync(path.join(ROOT, f))), `${f} debe ser idéntico al del IDE`);
    }
    assert.match(fs.readFileSync(path.join(dir, "ide", "credit-ledger.js"), "utf8"), /__editcoreWebRequire[\s\S]*__editcoreCreditLedgerModule/);
    const api = JSON.parse(fs.readFileSync(path.join(dir, "ide", "preload-api.js"), "utf8").replace(/^window\.__EDITCORE_PRELOAD_API = /, "").replace(/;\s*$/, ""));
    assert.ok(api.editcoreAgent.includes("run") && api.editcoreProject.includes("list") && api.editcorePty.includes("create"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const css = fs.readFileSync(path.join(ROOT, "web-portal", "css", "web-ide-shell.css"), "utf8");
  for (const id of ["terminalBtn", "connectionsBtn", "providersBtn", "publishBtn", "updatesBtn", "voiceBtn", "pickProjectBtn", "welcomeOpenBtn", "inspectBrowserBtn"]) {
    assert.match(css, new RegExp(`body\\.is-web #${id}\\b`), `${id} es de escritorio y se oculta en la web`);
  }
  const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split(/\r?\n/);
  for (const f of [...sources, "preload.js", "package.json", "runtime/credit-ledger.js"]) {
    assert.ok(ignore.includes(`!/${f}`), `${f} debe subir a Vercel para armar /app`);
  }
  const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^web-portal\/app\.html$/m);
  assert.match(gitignore, /^web-portal\/ide\/$/m);
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
  assert.deepEqual(local, [], "el script no depende de otros módulos locales");
  assert.ok(ignore.includes("/runtime/*"), "el resto de runtime no sube");

  const { writeWebConfig } = require("../scripts/write-web-config");
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ec-webcfg-"));
  try {
    const out = writeWebConfig(dir, { EDITCOREAI_CLOUD_PUBLIC_URL: "https://api.test", EDITCOREAI_CLOUD_ANON_KEY: ANON });
    assert.match(fs.readFileSync(out, "utf8"), /^window\.EDITCOREAI_CUENTAS = /);
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
