"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const { AuthManager, createPkcePair } = require("../runtime/auth-manager");
const { loadCloudConfig, looksLikeServiceRole } = require("../runtime/editcore-cloud-config");

const CONFIG = { url: "https://cuentas.test", anonKey: "anon-publica", configured: true };

function fakeStore() {
  return {
    encrypt: (text) => Buffer.from(`ENC:${Buffer.from(text).toString("base64")}`),
    decrypt: (buf) => Buffer.from(String(buf).slice(4), "base64").toString("utf8"),
  };
}

function fakeServer(overrides = {}) {
  const state = { challenge: "", tokens: new Set(["at-1"]), calls: [], account: { user_id: "u1", email: "ana@gmail.com", role: "user", plan: "free", status: "active", credits_balance: 7, is_unlimited: false } };
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : {};
    const auth = String(opts.headers?.Authorization || "").replace(/^Bearer /, "");
    state.calls.push({ path: u.pathname + u.search, body, auth, apikey: opts.headers?.apikey });
    if (overrides[u.pathname]) return overrides[u.pathname]({ u, body, auth, json, state });
    if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "pkce") {
      const expected = crypto.createHash("sha256").update(body.code_verifier).digest("base64url");
      if (body.auth_code !== "codigo-google" || expected !== state.challenge) return json(400, { msg: "invalid pkce" });
      return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "Ana@gmail.com", user_metadata: { full_name: "Ana Pérez", avatar_url: "https://img/ana" } } });
    }
    if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token") {
      if (body.refresh_token !== "rt-1") return json(400, { msg: "invalid refresh" });
      state.tokens.add("at-2");
      return json(200, { access_token: "at-2", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "ana@gmail.com", user_metadata: { full_name: "Ana Pérez" } } });
    }
    if (u.pathname === "/rest/v1/rpc/editcoreai_my_account") {
      if (!state.tokens.has(auth)) return json(401, { message: "JWT expired" });
      return json(200, state.account);
    }
    if (u.pathname === "/auth/v1/logout") return json(204);
    return json(404, { message: "not found" });
  };
  return { state, fetchImpl };
}

let nextPort = 55600 + Math.floor(Math.random() * 300);

function makeManager(dir, server, extra = {}) {
  const port = nextPort++;
  return new AuthManager({
    storageDir: dir,
    config: CONFIG,
    fetchImpl: server.fetchImpl,
    secureStore: fakeStore(),
    callbackPort: port,
    openExternal: async (authorizeUrl) => {
      const u = new URL(authorizeUrl);
      server.state.challenge = u.searchParams.get("code_challenge");
      server.state.authorize = u;
      if (extra.skipCallback) return;
      await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/callback?code=codigo-google`, (res) => { res.resume(); res.on("end", resolve); }).on("error", reject);
      });
    },
    ...extra,
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "editcore-auth-test-"));

test("Sin sesión no hay acceso ni administrador automático", async () => {
  const dir = tmp();
  const mgr = makeManager(dir, fakeServer());
  const s = await mgr.getCurrentSession();
  assert.equal(s.isAuthenticated, false);
  assert.equal(s.user, null);
  assert.equal(await mgr.getAccessToken(), null);
  await assert.rejects(() => mgr.rpc("editcoreai_my_account"), (e) => e.code === "NO_SESSION");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Inicio con Google usa PKCE, guarda la sesión cifrada y el rol viene del servidor", async () => {
  const dir = tmp();
  const server = fakeServer();
  const mgr = makeManager(dir, server);
  const session = await mgr.loginWithGoogle();

  const authorize = server.state.authorize;
  assert.equal(authorize.pathname, "/auth/v1/authorize");
  assert.equal(authorize.searchParams.get("provider"), "google");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
  assert.match(authorize.searchParams.get("redirect_to"), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

  assert.equal(session.isAuthenticated, true);
  assert.equal(session.user.email, "ana@gmail.com");
  assert.equal(session.user.name, "Ana Pérez");
  assert.equal(session.user.role, "user");
  assert.equal(session.user.isAdmin, false);
  assert.equal(session.user.credits_balance, 7);

  const raw = fs.readFileSync(path.join(dir, "editcoreai-session.bin"), "utf8");
  assert.ok(raw.startsWith("ENC:"));
  assert.ok(!raw.includes("at-1") && !raw.includes("rt-1"), "los tokens no deben quedar en texto plano");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("La cuenta admin solo existe si el servidor lo dice", async () => {
  const dir = tmp();
  const server = fakeServer();
  server.state.account = { ...server.state.account, role: "admin" };
  const mgr = makeManager(dir, server);
  const session = await mgr.loginWithGoogle();
  assert.equal(session.user.isAdmin, true);
  server.state.account = { ...server.state.account, role: "admin", status: "suspended" };
  const later = await mgr.getCurrentSession({ refresh: true });
  assert.equal(later.user.isAdmin, false);
  assert.equal(later.user.status, "suspended");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("La sesión se recupera al reiniciar y se renueva si el token venció", async () => {
  const dir = tmp();
  const server = fakeServer();
  let now = Date.now();
  const first = makeManager(dir, server, { now: () => now });
  await first.loginWithGoogle();

  now += 2 * 3600 * 1000;
  const second = makeManager(dir, server, { now: () => now });
  assert.equal(second.isAuthenticated(), true);
  const s = await second.getCurrentSession();
  assert.equal(s.isAuthenticated, true);
  assert.ok(server.state.calls.some((c) => c.path.includes("grant_type=refresh_token")));
  assert.equal(second.session.access_token, "at-2");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Si el servidor rechaza la renovación, la sesión se cierra", async () => {
  const dir = tmp();
  const server = fakeServer();
  let now = Date.now();
  const mgr = makeManager(dir, server, { now: () => now });
  await mgr.loginWithGoogle();
  mgr.session.refresh_token = "revocado";
  now += 2 * 3600 * 1000;
  const s = await mgr.getCurrentSession({ refresh: true });
  assert.equal(s.isAuthenticated, false);
  assert.ok(!fs.existsSync(path.join(dir, "editcoreai-session.bin")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Cerrar sesión borra la sesión guardada", async () => {
  const dir = tmp();
  const server = fakeServer();
  const mgr = makeManager(dir, server);
  await mgr.loginWithGoogle();
  await mgr.logout();
  assert.equal((await mgr.getCurrentSession()).isAuthenticated, false);
  assert.ok(!fs.existsSync(path.join(dir, "editcoreai-session.bin")));
  assert.ok(server.state.calls.some((c) => c.path.startsWith("/auth/v1/logout")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Sin cifrado del sistema la sesión no se guarda en disco", async () => {
  const dir = tmp();
  const mgr = makeManager(dir, fakeServer(), { secureStore: null });
  await mgr.loginWithGoogle();
  assert.equal(mgr.isAuthenticated(), true);
  assert.ok(!fs.existsSync(path.join(dir, "editcoreai-session.bin")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("El inicio de sesión se puede cancelar y no deja sesión", async () => {
  const dir = tmp();
  const mgr = makeManager(dir, fakeServer(), { skipCallback: true });
  const pending = mgr.loginWithGoogle();
  setTimeout(() => mgr.cancelLogin(), 50);
  await assert.rejects(pending, (e) => e.code === "LOGIN_CANCELLED");
  assert.equal(mgr.isAuthenticated(), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Sin servidor configurado no se puede iniciar sesión", async () => {
  const dir = tmp();
  const mgr = new AuthManager({ storageDir: dir, config: { url: "", anonKey: "", configured: false }, secureStore: fakeStore() });
  await assert.rejects(() => mgr.loginWithGoogle(), (e) => e.code === "CLOUD_NOT_CONFIGURED");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PKCE: el challenge es el SHA-256 del verifier", () => {
  const { verifier, challenge } = createPkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
});

test("La configuración rechaza una service_role y no trae claves en el código", () => {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  const serviceLike = `xx.${payload}.yy`;
  assert.equal(looksLikeServiceRole(serviceLike), true);
  assert.equal(looksLikeServiceRole("sb_secret_abc"), true);
  const cfg = loadCloudConfig({ env: { EDITCOREAI_CLOUD_URL: "https://x.test", EDITCOREAI_CLOUD_ANON_KEY: serviceLike }, envFile: null, generatedFile: "no-existe.json" });
  assert.equal(cfg.configured, false);
  assert.equal(cfg.anonKey, "");

  const root = path.join(__dirname, "..");
  for (const rel of ["runtime/auth-manager.js", "runtime/credit-ledger.js", "runtime/editcore-cloud-config.js", "runtime/role-policy-guard.js", "chat-home.js", "index.html"]) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(text), `${rel} no debe contener JWT`);
    assert.ok(!/sb_(publishable|secret)_[A-Za-z0-9]/.test(text), `${rel} no debe contener claves`);
    assert.ok(!/aperezavilez@gmail\.com/i.test(text), `${rel} no debe dar privilegios por correo`);
    assert.ok(!/ADMINVIP|EDITCORE100|PROMO2026/.test(text), `${rel} no debe traer códigos de regalo`);
  }
});
