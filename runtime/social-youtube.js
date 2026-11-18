"use strict";

// [SOCIAL-FASE 2] Cliente de YouTube (OAuth de Google + YouTube
// Data API v3) para las herramientas youtube_* del kernel.
//
// Diseño (el mismo de la Fase 1, runtime/social-meta.js):
// - Sin dependencias y con fetch INYECTABLE (fetchImpl) para poder
//   probarlo sin red; en producción usa el fetch global, resuelto en
//   el momento de la llamada.
// - Ninguna función finge éxito: todo error de la API (campo
//   `error` de Google, como string en el endpoint de tokens o como
//   objeto en la Data API), de HTTP o de red vuelve como
//   { ok:false, error }.
// - El client id/secret y la redirect URI NUNCA van hardcodeados:
//   salen de las variables de entorno (GOOGLE_CLIENT_ID /
//   GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI) o de la
//   configuración de Conexiones existente (googleClientId /
//   googleClientSecret / googleRedirectUri).
// - Los tokens del usuario viven en la bóveda de Conexiones (el
//   estado seguro cifrado con safeStorage que main expone vía
//   helpers.readConnections/writeConnections), en los campos
//   youtubeAccessToken / youtubeRefreshToken / youtubeChannelJson.
//   Este módulo solo sabe LEER ese estado y CONSTRUIR el parche;
//   quien escribe en la bóveda es main.
// - La URL OAuth pide access_type=offline + prompt=consent: sin
//   eso Google NO entrega refresh_token y la conexión caducaría a
//   la hora sin poder renovarse.

const AUTH_HOST = "https://accounts.google.com";
const TOKEN_HOST = "https://oauth2.googleapis.com";
const API_HOST = "https://www.googleapis.com";

// Scopes de la Fase 2: subir videos y leer los datos del canal.
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function cleanStr(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Resuelve la configuración OAuth de Google desde el entorno o
 * desde el objeto de Conexiones. `configured` exige clientId,
 * clientSecret y redirectUri; `missing` lista lo que falte.
 */
function resolveGoogleConfig({ connections = {}, env = process.env } = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  const e = env && typeof env === "object" ? env : {};
  const clientId = cleanStr(e.GOOGLE_CLIENT_ID || e.EDITCORE_GOOGLE_CLIENT_ID || c.googleClientId);
  const clientSecret = cleanStr(e.GOOGLE_CLIENT_SECRET || e.EDITCORE_GOOGLE_CLIENT_SECRET || c.googleClientSecret);
  const redirectUri = cleanStr(e.GOOGLE_REDIRECT_URI || e.EDITCORE_GOOGLE_REDIRECT_URI || c.googleRedirectUri);
  const missing = [];
  if (!clientId) missing.push("clientId (GOOGLE_CLIENT_ID o googleClientId en Conexiones)");
  if (!clientSecret) missing.push("clientSecret (GOOGLE_CLIENT_SECRET o googleClientSecret en Conexiones)");
  if (!redirectUri) missing.push("redirectUri (GOOGLE_REDIRECT_URI o googleRedirectUri en Conexiones)");
  return { clientId, clientSecret, redirectUri, configured: missing.length === 0, missing };
}

/** Lee el estado de YouTube guardado en un objeto de Conexiones. */
function readYoutubeState(connections = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  let channel = null;
  try {
    const parsed = JSON.parse(cleanStr(c.youtubeChannelJson) || "null");
    if (parsed && cleanStr(parsed.id)) {
      channel = { id: cleanStr(parsed.id), title: cleanStr(parsed.title) };
    }
  } catch { channel = null; }
  return {
    accessToken: cleanStr(c.youtubeAccessToken),
    refreshToken: cleanStr(c.youtubeRefreshToken),
    channel,
  };
}

/**
 * Construye el parche de Conexiones que main guarda en la bóveda.
 * Solo incluye los campos definidos, para que un refresco de token
 * no borre el refresh token ni el canal ya guardados.
 */
function buildYoutubePatch({ accessToken, refreshToken, channel } = {}) {
  const patch = {};
  if (accessToken !== undefined) patch.youtubeAccessToken = cleanStr(accessToken);
  if (refreshToken !== undefined) patch.youtubeRefreshToken = cleanStr(refreshToken);
  if (channel !== undefined) {
    patch.youtubeChannelJson = channel && cleanStr(channel.id)
      ? JSON.stringify({ id: cleanStr(channel.id), title: cleanStr(channel.title) })
      : "";
  }
  return patch;
}

/** Vista pública del canal: sin tokens, apta para el chat. */
function canalPublico(channel) {
  return channel ? { id: channel.id, title: channel.title } : null;
}

function createYoutubeClient({ clientId = "", clientSecret = "", redirectUri = "", fetchImpl = null } = {}) {
  const doFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (...args) => globalThis.fetch(...args);

  /** Extrae el error de Google (string u objeto) de una respuesta. */
  function errorDeGoogle(data, status) {
    if (!data || typeof data !== "object" || !data.error) return null;
    if (typeof data.error === "string") {
      return [data.error, cleanStr(data.error_description)].filter(Boolean).join(": ");
    }
    if (typeof data.error === "object") {
      const e = data.error;
      const detalle = [e.message || "error de la API de Google", e.code ? `código ${e.code}` : "", e.status || ""].filter(Boolean).join(" · ");
      return detalle;
    }
    return `Google devolvió HTTP ${status} con un error sin detalle.`;
  }

  async function leerJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  /** URL de autorización de Google que el usuario abre. */
  function buildAuthUrl({ state = "" } = {}) {
    const url = new URL(`${AUTH_HOST}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", cleanStr(clientId));
    url.searchParams.set("redirect_uri", cleanStr(redirectUri));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    // offline + consent: la única combinación que garantiza que
    // Google entregue refresh_token.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (state) url.searchParams.set("state", String(state));
    return url.toString();
  }

  async function pedirTokens(formBody, contexto) {
    let res;
    try {
      res = await doFetch(`${TOKEN_HOST}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(Object.entries(formBody).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString(),
      });
    } catch (error) {
      return { ok: false, error: `Google no respondió (red): ${error?.message || String(error)}` };
    }
    const data = await leerJson(res);
    const apiError = errorDeGoogle(data, res.status);
    if (apiError) return { ok: false, error: `Google: ${apiError}` };
    if (!res.ok) return { ok: false, error: `Google devolvió HTTP ${res.status} sin detalle al ${contexto}.` };
    if (!data || !cleanStr(data.access_token)) {
      return { ok: false, error: `Google no devolvió access_token al ${contexto}.` };
    }
    return {
      ok: true,
      accessToken: String(data.access_token),
      refreshToken: cleanStr(data.refresh_token),
      expiresIn: Number(data.expires_in || 0) || 0,
      scope: cleanStr(data.scope),
    };
  }

  /** Intercambia el código del redirect por access/refresh token. */
  async function exchangeCode(code) {
    return pedirTokens({
      code: cleanStr(code),
      client_id: cleanStr(clientId),
      client_secret: cleanStr(clientSecret),
      redirect_uri: cleanStr(redirectUri),
      grant_type: "authorization_code",
    }, "intercambiar el código");
  }

  /**
   * Renueva el access token con el refresh token guardado. Google
   * NO devuelve un refresh token nuevo: el guardado sigue valiendo.
   */
  async function refreshAccessToken(refreshToken) {
    return pedirTokens({
      client_id: cleanStr(clientId),
      client_secret: cleanStr(clientSecret),
      grant_type: "refresh_token",
      refresh_token: cleanStr(refreshToken),
    }, "refrescar el token");
  }

  /** Datos del canal del usuario conectado (channels.list mine). */
  async function getMyChannel(accessToken) {
    if (!cleanStr(accessToken)) return { ok: false, error: "Falta el access token para leer el canal de YouTube." };
    const url = new URL(`${API_HOST}/youtube/v3/channels`);
    url.searchParams.set("part", "snippet,statistics");
    url.searchParams.set("mine", "true");
    let res;
    try {
      res = await doFetch(url.toString(), { headers: { Authorization: `Bearer ${cleanStr(accessToken)}` } });
    } catch (error) {
      return { ok: false, error: `YouTube no respondió (red): ${error?.message || String(error)}` };
    }
    const data = await leerJson(res);
    const apiError = errorDeGoogle(data, res.status);
    if (apiError) return { ok: false, error: `YouTube: ${apiError}` };
    if (!res.ok) return { ok: false, error: `YouTube devolvió HTTP ${res.status} sin detalle.` };
    const item = data && Array.isArray(data.items) ? data.items[0] : null;
    if (!item || !cleanStr(item.id)) {
      return { ok: false, error: "La cuenta de Google no tiene un canal de YouTube asociado." };
    }
    return {
      ok: true,
      channel: { id: String(item.id), title: cleanStr(item.snippet?.title) },
      subscribers: item.statistics && item.statistics.subscriberCount !== undefined ? String(item.statistics.subscriberCount) : null,
    };
  }

  /**
   * Sube un video con la subida reanudable oficial, en dos pasos:
   * 1) POST de inicio a upload/v3/videos?uploadType=resumable con
   *    la metadata (snippet + status); Google responde con la URL
   *    de sesión en la cabecera Location.
   * 2) PUT del contenido completo a esa URL; la respuesta es el
   *    recurso del video ya creado (con su id).
   * `content` es el video en memoria (Buffer/Uint8Array).
   */
  async function uploadVideo({ accessToken = "", title = "", description = "", tags = [], categoryId = "", privacyStatus = "private", content = null, contentType = "video/mp4" } = {}) {
    if (!cleanStr(accessToken)) return { ok: false, error: "Falta el access token para subir a YouTube." };
    if (!cleanStr(title)) return { ok: false, error: "El video necesita «title»." };
    if (!content || typeof content.length !== "number" || content.length === 0) {
      return { ok: false, error: "Falta el contenido del video (archivo vacío o no leído)." };
    }
    const metadata = {
      snippet: {
        title: cleanStr(title),
        description: cleanStr(description),
        ...(Array.isArray(tags) && tags.length ? { tags: tags.map((t) => cleanStr(t)).filter(Boolean) } : {}),
        ...(cleanStr(categoryId) ? { categoryId: cleanStr(categoryId) } : {}),
      },
      status: { privacyStatus: cleanStr(privacyStatus) || "private" },
    };
    const inicioUrl = new URL(`${API_HOST}/upload/youtube/v3/videos`);
    inicioUrl.searchParams.set("uploadType", "resumable");
    inicioUrl.searchParams.set("part", "snippet,status");
    let resInicio;
    try {
      resInicio = await doFetch(inicioUrl.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cleanStr(accessToken)}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": cleanStr(contentType) || "video/mp4",
          "X-Upload-Content-Length": String(content.length),
        },
        body: JSON.stringify(metadata),
      });
    } catch (error) {
      return { ok: false, error: `YouTube no respondió (red) al iniciar la subida: ${error?.message || String(error)}` };
    }
    const dataInicio = await leerJson(resInicio);
    const errorInicio = errorDeGoogle(dataInicio, resInicio.status);
    if (errorInicio) return { ok: false, error: `YouTube: ${errorInicio}` };
    if (!resInicio.ok) return { ok: false, error: `YouTube devolvió HTTP ${resInicio.status} al iniciar la subida.` };
    const sessionUrl = cleanStr(resInicio.headers?.get?.("location") || resInicio.headers?.get?.("Location"));
    if (!sessionUrl) return { ok: false, error: "YouTube no devolvió la URL de sesión de la subida reanudable (cabecera Location)." };
    let resPut;
    try {
      resPut = await doFetch(sessionUrl, {
        method: "PUT",
        headers: { "Content-Type": cleanStr(contentType) || "video/mp4" },
        body: content,
      });
    } catch (error) {
      return { ok: false, error: `YouTube no respondió (red) al enviar el video: ${error?.message || String(error)}` };
    }
    const dataPut = await leerJson(resPut);
    const errorPut = errorDeGoogle(dataPut, resPut.status);
    if (errorPut) return { ok: false, error: `YouTube: ${errorPut}` };
    if (!resPut.ok) return { ok: false, error: `YouTube devolvió HTTP ${resPut.status} al enviar el video.` };
    if (!dataPut || !cleanStr(dataPut.id)) {
      return { ok: false, error: "YouTube no devolvió el id del video subido." };
    }
    return {
      ok: true,
      videoId: String(dataPut.id),
      url: `https://www.youtube.com/watch?v=${cleanStr(dataPut.id)}`,
      privacyStatus: cleanStr(dataPut.status?.privacyStatus) || metadata.status.privacyStatus,
    };
  }

  return { buildAuthUrl, exchangeCode, refreshAccessToken, getMyChannel, uploadVideo };
}

/** Lee las conexiones vía helpers sin lanzar jamás. */
function readConnectionsSafe(helpers) {
  try {
    return typeof helpers?.readConnections === "function" ? (helpers.readConnections() || {}) : {};
  } catch { return {}; }
}

/**
 * Cliente listo desde los helpers del kernel: configuración desde
 * Conexiones/entorno. Devuelve { ok:false, error } si falta config.
 */
function createClientFromHelpers(helpers) {
  const connections = readConnectionsSafe(helpers);
  const config = resolveGoogleConfig({ connections, env: process.env });
  if (!config.configured) {
    return {
      ok: false,
      error: `YouTube no está configurado: faltan ${config.missing.join(", ")}. Sin eso no se puede conectar el canal.`,
      config,
      connections,
    };
  }
  return { ok: true, client: createYoutubeClient(config), config, connections };
}

/**
 * Guarda el parche de YouTube en la bóveda vía
 * helpers.writeConnections. Sin esa costura, devuelve ok:false: el
 * token NO se guarda en ningún otro sitio.
 */
function saveYoutubePatch(helpers, patch) {
  if (typeof helpers?.writeConnections !== "function") {
    return { ok: false, error: "Esta ruta no tiene canal de escritura a la bóveda de Conexiones (helpers.writeConnections): el token NO se guardó en ningún sitio." };
  }
  try {
    helpers.writeConnections(patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `No se pudo guardar en la bóveda de Conexiones: ${error?.message || String(error)}` };
  }
}

module.exports = {
  OAUTH_SCOPES,
  resolveGoogleConfig,
  readYoutubeState,
  buildYoutubePatch,
  canalPublico,
  createYoutubeClient,
  readConnectionsSafe,
  createClientFromHelpers,
  saveYoutubePatch,
};
