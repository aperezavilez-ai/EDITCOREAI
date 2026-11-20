"use strict";
// [SOCIAL-META FASE 1] Batería del módulo social de Meta, SIN RED:
// el cliente se prueba con un fetch falso que registra las llamadas
// y responde como la Graph API; la superficie (clasificación +
// definición + dispatch) se prueba ejecutando las herramientas
// reales vía tools.execute con la bóveda simulada en memoria
// (helpers.readConnections/writeConnections) y el fetch global
// sustituido. Ningún token de las respuestas puede aparecer en los
// resultados que ve el chat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const social = require("../runtime/social-meta");
const tools = require("../runtime/tools/tools");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../runtime/tools/classify");

const CONFIG = { appId: "1234567890", appSecret: "secreto-de-prueba", redirectUri: "https://ejemplo.test/callback" };

function fetchFalso(registro, { fallarConErrorApi = false } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    registro.push({ url: u, method: init.method || "GET", body: init.body ? String(init.body) : "" });
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (fallarConErrorApi) {
      return json({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } });
    }
    if (u.includes("/oauth/access_token") && u.includes("fb_exchange_token=")) {
      return json({ access_token: "TOKEN_LARGO", token_type: "bearer", expires_in: 5184000 });
    }
    if (u.includes("/oauth/access_token") && u.includes("code=")) {
      return json({ access_token: "TOKEN_CORTO", token_type: "bearer", expires_in: 3600 });
    }
    if (u.includes("/me/accounts")) {
      return json({
        data: [{
          id: "111", name: "ALFA LUBES", access_token: "TOKEN_PAGINA",
          instagram_business_account: { id: "999", username: "alfalubes" },
        }],
      });
    }
    if (u.includes("/111/feed")) return json({ id: "111_555" });
    if (u.includes("/999/media_publish")) return json({ id: "MEDIA_1" });
    if (u.includes("/999/media")) return json({ id: "CONTENEDOR_1" });
    throw new Error(`fetch falso: URL no prevista ${u}`);
  };
}

test("URL OAuth bien formada, con los cinco scopes mínimos", () => {
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: async () => { throw new Error("sin red"); } });
  const url = new URL(client.buildAuthUrl());
  assert.equal(url.origin + url.pathname, "https://www.facebook.com/v21.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), CONFIG.appId);
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  const scopes = url.searchParams.get("scope").split(",");
  for (const s of ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"]) {
    assert.ok(scopes.includes(s), `falta el scope ${s}`);
  }
});

test("intercambio de código y extensión a token de larga duración", async () => {
  const registro = [];
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: fetchFalso(registro) });
  const corto = await client.exchangeCode("CODIGO_123");
  assert.equal(corto.ok, true);
  assert.equal(corto.accessToken, "TOKEN_CORTO");
  assert.ok(registro[0].url.includes("code=CODIGO_123"));
  assert.ok(registro[0].url.includes(`client_secret=${CONFIG.appSecret}`));
  const largo = await client.extendToken(corto.accessToken);
  assert.equal(largo.ok, true);
  assert.equal(largo.accessToken, "TOKEN_LARGO");
  assert.equal(largo.expiresIn, 5184000);
  assert.ok(registro[1].url.includes("grant_type=fb_exchange_token"));
  assert.ok(registro[1].url.includes("fb_exchange_token=TOKEN_CORTO"));
});

test("listado de páginas con su cuenta de Instagram vinculada", async () => {
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: fetchFalso([]) });
  const r = await client.listPages("TOKEN_LARGO");
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].id, "111");
  assert.equal(r.pages[0].accessToken, "TOKEN_PAGINA");
  assert.deepEqual(r.pages[0].instagram, { id: "999", username: "alfalubes" });
});

test("publicar en la página: POST a /feed con el token de la página", async () => {
  const registro = [];
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: fetchFalso(registro) });
  const r = await client.publishToPage({ pageId: "111", pageToken: "TOKEN_PAGINA", message: "Hola desde EditCoreAI", link: "https://ejemplo.test" });
  assert.equal(r.ok, true);
  assert.equal(r.postId, "111_555");
  assert.equal(registro[0].method, "POST");
  assert.ok(registro[0].url.includes("/v21.0/111/feed"));
  const body = new URLSearchParams(registro[0].body);
  assert.equal(body.get("message"), "Hola desde EditCoreAI");
  assert.equal(body.get("access_token"), "TOKEN_PAGINA");
});

test("publicar en Instagram: dos pasos (contenedor + publish)", async () => {
  const registro = [];
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: fetchFalso(registro) });
  const r = await client.publishToInstagram({ igUserId: "999", pageToken: "TOKEN_PAGINA", imageUrl: "https://ejemplo.test/foto.jpg", caption: "Pie de foto" });
  assert.equal(r.ok, true);
  assert.equal(r.mediaId, "MEDIA_1");
  assert.equal(registro.length, 2);
  assert.ok(registro[0].url.includes("/v21.0/999/media"));
  assert.equal(new URLSearchParams(registro[0].body).get("image_url"), "https://ejemplo.test/foto.jpg");
  assert.ok(registro[1].url.includes("/v21.0/999/media_publish"));
  assert.equal(new URLSearchParams(registro[1].body).get("creation_id"), "CONTENEDOR_1");
});

test("un error de la API vuelve como ok:false honesto, nunca como éxito", async () => {
  const client = social.createMetaClient({ ...CONFIG, fetchImpl: fetchFalso([], { fallarConErrorApi: true }) });
  const r = await client.listPages("TOKEN_MALO");
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid OAuth access token/);
  assert.match(r.error, /190/);
  const pub = await client.publishToPage({ pageId: "111", pageToken: "TOKEN_PAGINA", message: "x" });
  assert.equal(pub.ok, false);
});

test("superficie: clasificación, definición y dieta de escritura coherentes", () => {
  assert.ok(READ_ONLY_TOOLS.includes("social_estado"), "social_estado clasificada de lectura");
  assert.ok(WRITE_TOOLS.includes("social_conectar"), "social_conectar clasificada de escritura");
  assert.ok(WRITE_TOOLS.includes("social_publicar"), "social_publicar clasificada de escritura");
  const conEscritura = new Set(tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function.name));
  for (const n of ["social_conectar", "social_estado", "social_publicar"]) {
    assert.ok(conEscritura.has(n), `${n} servida con acceso completo`);
  }
  const sinEscritura = new Set(tools.getToolDefinitions({ allowWrite: false }).map((d) => d.function.name));
  assert.ok(sinEscritura.has("social_estado"), "social_estado servida en solo lectura");
  assert.ok(!sinEscritura.has("social_conectar"), "social_conectar fuera en solo lectura");
  assert.ok(!sinEscritura.has("social_publicar"), "social_publicar fuera en solo lectura");
});

test("flujo completo vía tools.execute: conectar → estado → publicar, sin filtrar tokens", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-meta-"));
  const registro = [];
  const fetchPrevio = globalThis.fetch;
  const envPrevio = { ...process.env };
  process.env.META_APP_ID = CONFIG.appId;
  process.env.META_APP_SECRET = CONFIG.appSecret;
  process.env.META_REDIRECT_URI = CONFIG.redirectUri;
  globalThis.fetch = fetchFalso(registro);
  // La bóveda simulada: el MISMO objeto de conexiones que main
  // guardaría cifrado; writeConnections fusiona el parche.
  let conexiones = {};
  const helpers = {
    readConnections: () => ({ ...conexiones }),
    writeConnections: (patch) => { conexiones = { ...conexiones, ...patch }; },
  };
  try {
    // 1) Sin código: solo la URL de autorización.
    const paso1 = await tools.execute("social_conectar", {}, tmp, true, helpers);
    assert.equal(paso1.ok, true);
    assert.equal(paso1.paso, "autorizar");
    assert.ok(String(paso1.url).includes("facebook.com/v21.0/dialog/oauth"));

    // 2) Con código: intercambia, extiende, lista y GUARDA en la bóveda.
    const paso2 = await tools.execute("social_conectar", { code: "CODIGO_123" }, tmp, true, helpers);
    assert.equal(paso2.ok, true);
    assert.equal(paso2.conectado, true);
    assert.equal(conexiones.metaUserToken, "TOKEN_LARGO");
    assert.ok(Number(conexiones.metaTokenExpiresAt) > Date.now());
    const paginasGuardadas = JSON.parse(conexiones.metaPagesJson);
    assert.equal(paginasGuardadas[0].accessToken, "TOKEN_PAGINA");
    assert.ok(!JSON.stringify(paso2).includes("TOKEN_LARGO"), "el resultado no filtra el token de usuario");
    assert.ok(!JSON.stringify(paso2).includes("TOKEN_PAGINA"), "el resultado no filtra el token de página");

    // 3) Estado: conectado y con la página, sin tokens.
    const estado = await tools.execute("social_estado", {}, tmp, false, helpers);
    assert.equal(estado.ok, true);
    assert.equal(estado.conectado, true);
    assert.deepEqual(estado.paginas, [{ id: "111", name: "ALFA LUBES", instagram: { id: "999", username: "alfalubes" } }]);
    assert.ok(!JSON.stringify(estado).includes("TOKEN"), "social_estado jamás devuelve tokens");

    // 4) Publicar en Facebook y en Instagram por el dispatch real.
    const pubFb = await tools.execute("social_publicar", { message: "Post de prueba" }, tmp, true, helpers);
    assert.equal(pubFb.ok, true);
    assert.equal(pubFb.postId, "111_555");
    const pubIg = await tools.execute("social_publicar", { instagram: true, imageUrl: "https://ejemplo.test/f.jpg", message: "Pie" }, tmp, true, helpers);
    assert.equal(pubIg.ok, true);
    assert.equal(pubIg.mediaId, "MEDIA_1");

    // 5) Sin escritura, publicar y conectar se cortan en el case.
    const sinPermiso = await tools.execute("social_publicar", { message: "x" }, tmp, false, helpers);
    assert.equal(sinPermiso.ok, false);
    const sinPermiso2 = await tools.execute("social_conectar", {}, tmp, false, helpers);
    assert.equal(sinPermiso2.ok, false);
  } finally {
    globalThis.fetch = fetchPrevio;
    for (const k of Object.keys(process.env)) if (!(k in envPrevio)) delete process.env[k];
    Object.assign(process.env, envPrevio);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sin configuración de Meta, social_conectar falla honesto y no inventa URL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-meta-nc-"));
  const envPrevio = { ...process.env };
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET; delete process.env.META_REDIRECT_URI;
  delete process.env.EDITCORE_META_APP_ID; delete process.env.EDITCORE_META_APP_SECRET; delete process.env.EDITCORE_META_REDIRECT_URI;
  try {
    const r = await tools.execute("social_conectar", {}, tmp, true, { readConnections: () => ({}) });
    assert.equal(r.ok, false);
    assert.match(r.error, /Meta no está configurado/);
  } finally {
    Object.assign(process.env, envPrevio);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
