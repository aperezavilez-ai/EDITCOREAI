"use strict";
// [SOCIAL-FASE 2] Batería de TikTok y YouTube, SIN RED: los
// clientes se prueban con fetches falsos que registran las llamadas
// y responden como las APIs reales (Login Kit + Content Posting de
// TikTok; OAuth de Google + YouTube Data API v3 con subida
// reanudable); la superficie (clasificación + definición +
// dispatch) se prueba ejecutando las herramientas reales vía
// tools.execute con la bóveda simulada en memoria
// (helpers.readConnections/writeConnections) y el fetch global
// sustituido. Ningún token puede aparecer en los resultados que ve
// el chat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tiktok = require("../runtime/social-tiktok");
const youtube = require("../runtime/social-youtube");
const tools = require("../editcore-chat-kernel/tools");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../editcore-chat-kernel/classify");

const CONFIG_TT = { clientKey: "aw_tiktok_key", clientSecret: "secreto-tiktok", redirectUri: "https://ejemplo.test/tiktok" };
const CONFIG_YT = { clientId: "123.apps.googleusercontent.com", clientSecret: "secreto-google", redirectUri: "https://ejemplo.test/google" };

function fetchTiktokFalso(registro, { fallarConErrorApi = false } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    registro.push({ url: u, method: init.method || "GET", body: init.body ? String(init.body) : "", headers: init.headers || {} });
    if (fallarConErrorApi) {
      return { ok: false, status: 401, json: async () => ({ error: { code: "invalid_client", message: "client_key inválida", log_id: "LOG1" } }) };
    }
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    const ok = { code: "ok", message: "", log_id: "LOG0" };
    if (u.includes("/v2/oauth/token/")) {
      const body = new URLSearchParams(String(init.body || ""));
      if (body.get("grant_type") === "refresh_token") {
        return json({ data: { open_id: "OPEN_123", access_token: "TT_ACCESS_2", refresh_token: "TT_REFRESH_2", expires_in: 86400, scope: "user.info.basic,video.publish" }, error: ok });
      }
      return json({ data: { open_id: "OPEN_123", access_token: "TT_ACCESS", refresh_token: "TT_REFRESH", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish,video.upload", token_type: "Bearer" }, error: ok });
    }
    if (u.includes("/v2/user/info/")) {
      return json({ data: { user: { open_id: "OPEN_123", union_id: "UNION_1", display_name: "ALFA LUBES", avatar_url: "https://ejemplo.test/a.jpg" } }, error: ok });
    }
    if (u.includes("/v2/post/publish/video/init/")) {
      const body = JSON.parse(String(init.body || "{}"));
      if (body.source_info && body.source_info.source === "FILE_UPLOAD") {
        return json({ data: { publish_id: "PUB_FILE", upload_url: "https://upload.tiktokapis.test/video/?upload_id=U1" }, error: ok });
      }
      return json({ data: { publish_id: "PUB_PULL" }, error: ok });
    }
    if (u.includes("/v2/post/publish/status/fetch/")) {
      return json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7300000000000000001"] }, error: ok });
    }
    throw new Error(`fetch falso TikTok: URL no prevista ${u}`);
  };
}

function fetchYoutubeFalso(registro, { fallarConErrorApi = false } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    registro.push({ url: u, method, body: init.body ?? null, headers: init.headers || {} });
    if (fallarConErrorApi) {
      if (u.includes("oauth2.googleapis.com/token")) {
        return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) };
      }
      return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } }) };
    }
    const json = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data });
    if (u.includes("oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init.body || ""));
      if (body.get("grant_type") === "refresh_token") {
        return json({ access_token: "YT_ACCESS_2", expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/youtube.upload" });
      }
      return json({ access_token: "YT_ACCESS", refresh_token: "YT_REFRESH", expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/youtube.upload" });
    }
    if (u.includes("/youtube/v3/channels")) {
      return json({ items: [{ id: "CHAN_1", snippet: { title: "ALFA LUBES TV" }, statistics: { subscriberCount: "42" } }] });
    }
    if (u.includes("/upload/youtube/v3/videos") && method === "POST") {
      return {
        ok: true, status: 200,
        headers: { get: (n) => (String(n).toLowerCase() === "location" ? "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=SESION_1" : null) },
        json: async () => ({}),
      };
    }
    if (u.includes("upload_id=SESION_1") && method === "PUT") {
      return json({ id: "VIDEO_1", snippet: { title: "Episodio 1" }, status: { privacyStatus: "private" } });
    }
    throw new Error(`fetch falso YouTube: URL no prevista ${u}`);
  };
}

/** Fetch global que enruta a cada red, como haría el real. */
function fetchGlobalFalso(registro) {
  const tt = fetchTiktokFalso(registro);
  const yt = fetchYoutubeFalso(registro);
  return async (url, init) => (String(url).includes("googleapis") ? yt(url, init) : tt(url, init));
}

function restaurarEnv(envPrevio) {
  for (const k of Object.keys(process.env)) if (!(k in envPrevio)) delete process.env[k];
  Object.assign(process.env, envPrevio);
}

// ---------- TikTok: cliente ----------

test("TikTok: URL de Login Kit bien formada, con sus tres scopes", () => {
  const client = tiktok.createTiktokClient({ ...CONFIG_TT, fetchImpl: async () => { throw new Error("sin red"); } });
  const url = new URL(client.buildAuthUrl());
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("client_key"), CONFIG_TT.clientKey);
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG_TT.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  const scopes = url.searchParams.get("scope").split(",");
  for (const s of ["user.info.basic", "video.publish", "video.upload"]) {
    assert.ok(scopes.includes(s), `falta el scope ${s}`);
  }
});

test("TikTok: intercambio de código, refresco e info del usuario", async () => {
  const registro = [];
  const client = tiktok.createTiktokClient({ ...CONFIG_TT, fetchImpl: fetchTiktokFalso(registro) });
  const tokens = await client.exchangeCode("CODIGO_TT");
  assert.equal(tokens.ok, true);
  assert.equal(tokens.accessToken, "TT_ACCESS");
  assert.equal(tokens.refreshToken, "TT_REFRESH");
  assert.equal(tokens.openId, "OPEN_123");
  const body = new URLSearchParams(registro[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "CODIGO_TT");
  assert.equal(body.get("client_key"), CONFIG_TT.clientKey);
  assert.equal(body.get("client_secret"), CONFIG_TT.clientSecret);

  const renovado = await client.refreshAccessToken("TT_REFRESH");
  assert.equal(renovado.ok, true);
  assert.equal(renovado.accessToken, "TT_ACCESS_2");
  assert.equal(new URLSearchParams(registro[1].body).get("grant_type"), "refresh_token");

  const info = await client.getUserInfo("TT_ACCESS");
  assert.equal(info.ok, true);
  assert.equal(info.openId, "OPEN_123");
  assert.equal(info.displayName, "ALFA LUBES");
  assert.equal(registro[2].headers.Authorization, "Bearer TT_ACCESS");
});

test("TikTok: publicar con PULL_FROM_URL y consultar el estado", async () => {
  const registro = [];
  const client = tiktok.createTiktokClient({ ...CONFIG_TT, fetchImpl: fetchTiktokFalso(registro) });
  const pub = await client.publishVideo({ accessToken: "TT_ACCESS", videoUrl: "https://ejemplo.test/video.mp4", title: "Cambio de aceite" });
  assert.equal(pub.ok, true);
  assert.equal(pub.publishId, "PUB_PULL");
  assert.equal(pub.privacidad, "SELF_ONLY");
  assert.equal(pub.aviso, undefined);
  const initBody = JSON.parse(registro[0].body);
  assert.equal(initBody.source_info.source, "PULL_FROM_URL");
  assert.equal(initBody.source_info.video_url, "https://ejemplo.test/video.mp4");
  assert.equal(initBody.post_info.privacy_level, "SELF_ONLY");
  assert.equal(initBody.post_info.title, "Cambio de aceite");
  assert.equal(registro[0].headers.Authorization, "Bearer TT_ACCESS");

  const estado = await client.fetchPublishStatus({ accessToken: "TT_ACCESS", publishId: "PUB_PULL" });
  assert.equal(estado.ok, true);
  assert.equal(estado.status, "PUBLISH_COMPLETE");
  assert.deepEqual(estado.postIds, ["7300000000000000001"]);
  assert.equal(JSON.parse(registro[1].body).publish_id, "PUB_PULL");
});

test("TikTok: FILE_UPLOAD devuelve publish_id y upload_url; otra privacidad avisa de la auditoría", async () => {
  const registro = [];
  const client = tiktok.createTiktokClient({ ...CONFIG_TT, fetchImpl: fetchTiktokFalso(registro) });
  const pub = await client.publishVideo({ accessToken: "TT_ACCESS", videoSize: 2048, title: "Local" });
  assert.equal(pub.ok, true);
  assert.equal(pub.publishId, "PUB_FILE");
  assert.ok(pub.uploadUrl.includes("upload_id=U1"));
  const initBody = JSON.parse(registro[0].body);
  assert.equal(initBody.source_info.source, "FILE_UPLOAD");
  assert.equal(initBody.source_info.video_size, 2048);
  assert.equal(initBody.source_info.chunk_size, 2048);
  assert.equal(initBody.source_info.total_chunk_count, 1);

  const publica = await client.publishVideo({ accessToken: "TT_ACCESS", videoUrl: "https://ejemplo.test/v.mp4", privacyLevel: "PUBLIC_TO_EVERYONE" });
  assert.equal(publica.ok, true);
  assert.equal(publica.privacidad, "PUBLIC_TO_EVERYONE");
  assert.match(publica.aviso, /SELF_ONLY/);
  assert.match(publica.aviso, /auditoría/);
});

test("TikTok: un error de la API vuelve como ok:false honesto", async () => {
  const client = tiktok.createTiktokClient({ ...CONFIG_TT, fetchImpl: fetchTiktokFalso([], { fallarConErrorApi: true }) });
  const r = await client.exchangeCode("CODIGO_MALO");
  assert.equal(r.ok, false);
  assert.match(r.error, /inválida/);
  assert.match(r.error, /invalid_client/);
  const pub = await client.publishVideo({ accessToken: "TT_ACCESS", videoUrl: "https://ejemplo.test/v.mp4" });
  assert.equal(pub.ok, false);
});

// ---------- YouTube: cliente ----------

test("YouTube: URL OAuth de Google con offline + consent y sus dos scopes", () => {
  const client = youtube.createYoutubeClient({ ...CONFIG_YT, fetchImpl: async () => { throw new Error("sin red"); } });
  const url = new URL(client.buildAuthUrl());
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), CONFIG_YT.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG_YT.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  const scopes = url.searchParams.get("scope").split(" ");
  assert.ok(scopes.includes("https://www.googleapis.com/auth/youtube.upload"), "falta youtube.upload");
  assert.ok(scopes.includes("https://www.googleapis.com/auth/youtube.readonly"), "falta youtube.readonly");
});

test("YouTube: intercambio de código, refresco y datos del canal", async () => {
  const registro = [];
  const client = youtube.createYoutubeClient({ ...CONFIG_YT, fetchImpl: fetchYoutubeFalso(registro) });
  const tokens = await client.exchangeCode("CODIGO_YT");
  assert.equal(tokens.ok, true);
  assert.equal(tokens.accessToken, "YT_ACCESS");
  assert.equal(tokens.refreshToken, "YT_REFRESH");
  const body = new URLSearchParams(registro[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "CODIGO_YT");
  assert.equal(body.get("client_secret"), CONFIG_YT.clientSecret);

  const renovado = await client.refreshAccessToken("YT_REFRESH");
  assert.equal(renovado.ok, true);
  assert.equal(renovado.accessToken, "YT_ACCESS_2");
  assert.equal(new URLSearchParams(registro[1].body).get("grant_type"), "refresh_token");

  const canal = await client.getMyChannel("YT_ACCESS");
  assert.equal(canal.ok, true);
  assert.deepEqual(canal.channel, { id: "CHAN_1", title: "ALFA LUBES TV" });
  assert.equal(registro[2].headers.Authorization, "Bearer YT_ACCESS");
  assert.ok(registro[2].url.includes("mine=true"));
});

test("YouTube: subida reanudable completa (inicio con metadata + PUT del contenido)", async () => {
  const registro = [];
  const client = youtube.createYoutubeClient({ ...CONFIG_YT, fetchImpl: fetchYoutubeFalso(registro) });
  const contenido = Buffer.from([0, 1, 2, 3, 4, 5]);
  const r = await client.uploadVideo({
    accessToken: "YT_ACCESS", title: "Episodio 1", description: "Desc", tags: ["aceite"],
    privacyStatus: "private", content: contenido, contentType: "video/mp4",
  });
  assert.equal(r.ok, true);
  assert.equal(r.videoId, "VIDEO_1");
  assert.equal(r.url, "https://www.youtube.com/watch?v=VIDEO_1");
  assert.equal(registro.length, 2);
  // Paso 1: inicio reanudable con la metadata y las cabeceras X-Upload.
  assert.equal(registro[0].method, "POST");
  assert.ok(registro[0].url.includes("uploadType=resumable"));
  assert.equal(registro[0].headers["X-Upload-Content-Length"], String(contenido.length));
  assert.equal(registro[0].headers["X-Upload-Content-Type"], "video/mp4");
  const metadata = JSON.parse(String(registro[0].body));
  assert.equal(metadata.snippet.title, "Episodio 1");
  assert.deepEqual(metadata.snippet.tags, ["aceite"]);
  assert.equal(metadata.status.privacyStatus, "private");
  // Paso 2: PUT de los bytes a la URL de sesión.
  assert.equal(registro[1].method, "PUT");
  assert.ok(registro[1].url.includes("upload_id=SESION_1"));
  assert.equal(Buffer.from(registro[1].body).length, contenido.length);
});

test("YouTube: un error de la API vuelve como ok:false honesto", async () => {
  const client = youtube.createYoutubeClient({ ...CONFIG_YT, fetchImpl: fetchYoutubeFalso([], { fallarConErrorApi: true }) });
  const r = await client.exchangeCode("CODIGO_MALO");
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid_grant/);
  const canal = await client.getMyChannel("YT_ACCESS");
  assert.equal(canal.ok, false);
  assert.match(canal.error, /invalid authentication/);
});

// ---------- Superficie y flujo completo vía tools.execute ----------

test("superficie: clasificación, definición y dieta de escritura coherentes (6 herramientas)", () => {
  assert.ok(READ_ONLY_TOOLS.includes("tiktok_estado"), "tiktok_estado clasificada de lectura");
  assert.ok(READ_ONLY_TOOLS.includes("youtube_estado"), "youtube_estado clasificada de lectura");
  for (const n of ["tiktok_conectar", "tiktok_publicar", "youtube_conectar", "youtube_subir"]) {
    assert.ok(WRITE_TOOLS.includes(n), `${n} clasificada de escritura`);
  }
  const conEscritura = new Set(tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function.name));
  for (const n of ["tiktok_conectar", "tiktok_estado", "tiktok_publicar", "youtube_conectar", "youtube_estado", "youtube_subir"]) {
    assert.ok(conEscritura.has(n), `${n} servida con acceso completo`);
  }
  const sinEscritura = new Set(tools.getToolDefinitions({ allowWrite: false }).map((d) => d.function.name));
  assert.ok(sinEscritura.has("tiktok_estado"), "tiktok_estado servida en solo lectura");
  assert.ok(sinEscritura.has("youtube_estado"), "youtube_estado servida en solo lectura");
  for (const n of ["tiktok_conectar", "tiktok_publicar", "youtube_conectar", "youtube_subir"]) {
    assert.ok(!sinEscritura.has(n), `${n} fuera en solo lectura`);
  }
});

test("flujo TikTok vía tools.execute: conectar → estado → publicar → estado de publicación, sin filtrar tokens", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-tt-"));
  const registro = [];
  const fetchPrevio = globalThis.fetch;
  const envPrevio = { ...process.env };
  process.env.TIKTOK_CLIENT_KEY = CONFIG_TT.clientKey;
  process.env.TIKTOK_CLIENT_SECRET = CONFIG_TT.clientSecret;
  process.env.TIKTOK_REDIRECT_URI = CONFIG_TT.redirectUri;
  globalThis.fetch = fetchGlobalFalso(registro);
  let conexiones = {};
  const helpers = {
    readConnections: () => ({ ...conexiones }),
    writeConnections: (patch) => { conexiones = { ...conexiones, ...patch }; },
  };
  try {
    const paso1 = await tools.execute("tiktok_conectar", {}, tmp, true, helpers);
    assert.equal(paso1.ok, true);
    assert.equal(paso1.paso, "autorizar");
    assert.ok(String(paso1.url).includes("tiktok.com/v2/auth/authorize"));

    const paso2 = await tools.execute("tiktok_conectar", { code: "CODIGO_TT" }, tmp, true, helpers);
    assert.equal(paso2.ok, true);
    assert.equal(paso2.conectado, true);
    assert.equal(paso2.cuenta.openId, "OPEN_123");
    assert.equal(conexiones.tiktokAccessToken, "TT_ACCESS");
    assert.equal(conexiones.tiktokRefreshToken, "TT_REFRESH");
    assert.equal(conexiones.tiktokOpenId, "OPEN_123");
    assert.ok(!JSON.stringify(paso2).includes("TT_ACCESS"), "el resultado no filtra el access token");
    assert.ok(!JSON.stringify(paso2).includes("TT_REFRESH"), "el resultado no filtra el refresh token");

    const estado = await tools.execute("tiktok_estado", {}, tmp, false, helpers);
    assert.equal(estado.ok, true);
    assert.equal(estado.conectado, true);
    assert.deepEqual(estado.cuenta, { openId: "OPEN_123" });
    assert.ok(!JSON.stringify(estado).includes("TT_"), "tiktok_estado jamás devuelve tokens");

    const pub = await tools.execute("tiktok_publicar", { videoUrl: "https://ejemplo.test/v.mp4", title: "Hola TikTok" }, tmp, true, helpers);
    assert.equal(pub.ok, true);
    assert.equal(pub.publishId, "PUB_PULL");
    assert.equal(pub.privacidad, "SELF_ONLY");

    const stPub = await tools.execute("tiktok_publicar", { publishId: "PUB_PULL" }, tmp, true, helpers);
    assert.equal(stPub.ok, true);
    assert.equal(stPub.estadoPublicacion, "PUBLISH_COMPLETE");

    const sinPermiso = await tools.execute("tiktok_publicar", { videoUrl: "https://ejemplo.test/v.mp4" }, tmp, false, helpers);
    assert.equal(sinPermiso.ok, false);
    const sinPermiso2 = await tools.execute("tiktok_conectar", {}, tmp, false, helpers);
    assert.equal(sinPermiso2.ok, false);
  } finally {
    globalThis.fetch = fetchPrevio;
    restaurarEnv(envPrevio);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("flujo YouTube vía tools.execute: conectar → estado → subir (con refresco), sin filtrar tokens", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-yt-"));
  const registro = [];
  const fetchPrevio = globalThis.fetch;
  const envPrevio = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = CONFIG_YT.clientId;
  process.env.GOOGLE_CLIENT_SECRET = CONFIG_YT.clientSecret;
  process.env.GOOGLE_REDIRECT_URI = CONFIG_YT.redirectUri;
  globalThis.fetch = fetchGlobalFalso(registro);
  let conexiones = {};
  const helpers = {
    readConnections: () => ({ ...conexiones }),
    writeConnections: (patch) => { conexiones = { ...conexiones, ...patch }; },
  };
  try {
    const paso1 = await tools.execute("youtube_conectar", {}, tmp, true, helpers);
    assert.equal(paso1.ok, true);
    assert.equal(paso1.paso, "autorizar");
    assert.ok(String(paso1.url).includes("accounts.google.com/o/oauth2/v2/auth"));

    const paso2 = await tools.execute("youtube_conectar", { code: "CODIGO_YT" }, tmp, true, helpers);
    assert.equal(paso2.ok, true);
    assert.equal(paso2.conectado, true);
    assert.deepEqual(paso2.canal, { id: "CHAN_1", title: "ALFA LUBES TV" });
    assert.equal(conexiones.youtubeAccessToken, "YT_ACCESS");
    assert.equal(conexiones.youtubeRefreshToken, "YT_REFRESH");
    assert.deepEqual(JSON.parse(conexiones.youtubeChannelJson), { id: "CHAN_1", title: "ALFA LUBES TV" });
    assert.ok(!JSON.stringify(paso2).includes("YT_ACCESS"), "el resultado no filtra el access token");
    assert.ok(!JSON.stringify(paso2).includes("YT_REFRESH"), "el resultado no filtra el refresh token");

    const estado = await tools.execute("youtube_estado", {}, tmp, false, helpers);
    assert.equal(estado.ok, true);
    assert.equal(estado.conectado, true);
    assert.deepEqual(estado.canal, { id: "CHAN_1", title: "ALFA LUBES TV" });
    assert.ok(!JSON.stringify(estado).includes("YT_"), "youtube_estado jamás devuelve tokens");

    // Subir: la herramienta lee el archivo del proyecto, refresca
    // el token (el guardado pasa a ser YT_ACCESS_2) y sube.
    fs.writeFileSync(path.join(tmp, "episodio.mp4"), Buffer.from([9, 8, 7, 6, 5]));
    const subida = await tools.execute("youtube_subir", { path: "episodio.mp4", title: "Episodio 1" }, tmp, true, helpers);
    assert.equal(subida.ok, true, JSON.stringify(subida));
    assert.equal(subida.videoId, "VIDEO_1");
    assert.equal(subida.url, "https://www.youtube.com/watch?v=VIDEO_1");
    assert.equal(conexiones.youtubeAccessToken, "YT_ACCESS_2", "el refresco previo a subir se guardó en la bóveda");
    assert.equal(conexiones.youtubeRefreshToken, "YT_REFRESH", "el refresh token no se borró al refrescar");
    assert.ok(!JSON.stringify(subida).includes("YT_ACCESS"), "la subida no filtra tokens");

    // Fuera del proyecto no se lee nada.
    const fuera = await tools.execute("youtube_subir", { path: "../fuera.mp4", title: "X" }, tmp, true, helpers);
    assert.equal(fuera.ok, false);

    const sinPermiso = await tools.execute("youtube_subir", { path: "episodio.mp4", title: "X" }, tmp, false, helpers);
    assert.equal(sinPermiso.ok, false);
    const sinPermiso2 = await tools.execute("youtube_conectar", {}, tmp, false, helpers);
    assert.equal(sinPermiso2.ok, false);
  } finally {
    globalThis.fetch = fetchPrevio;
    restaurarEnv(envPrevio);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sin configuración, tiktok_conectar y youtube_conectar fallan honesto y no inventan URL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-f2-nc-"));
  const envPrevio = { ...process.env };
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI", "EDITCORE_TIKTOK_CLIENT_KEY", "EDITCORE_TIKTOK_CLIENT_SECRET", "EDITCORE_TIKTOK_REDIRECT_URI", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "EDITCORE_GOOGLE_CLIENT_ID", "EDITCORE_GOOGLE_CLIENT_SECRET", "EDITCORE_GOOGLE_REDIRECT_URI"]) {
    delete process.env[k];
  }
  try {
    const r1 = await tools.execute("tiktok_conectar", {}, tmp, true, { readConnections: () => ({}) });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /TikTok no está configurado/);
    const r2 = await tools.execute("youtube_conectar", {}, tmp, true, { readConnections: () => ({}) });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /YouTube no está configurado/);
  } finally {
    restaurarEnv(envPrevio);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
