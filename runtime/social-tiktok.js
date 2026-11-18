"use strict";

// [SOCIAL-FASE 2] Cliente de TikTok (Login Kit + Content Posting
// API) para las herramientas tiktok_* del kernel.
//
// Diseño (el mismo de la Fase 1, runtime/social-meta.js):
// - Sin dependencias y con fetch INYECTABLE (fetchImpl) para poder
//   probarlo sin red; en producción usa el fetch global, resuelto en
//   el momento de la llamada.
// - Ninguna función finge éxito: todo error de la API (sobre
//   { error: { code, message } } de TikTok, donde code !== "ok" es
//   fallo), de HTTP o de red vuelve como { ok:false, error }.
// - El client key/secret y la redirect URI NUNCA van hardcodeados:
//   salen de las variables de entorno (TIKTOK_CLIENT_KEY /
//   TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI) o de la
//   configuración de Conexiones existente (tiktokClientKey /
//   tiktokClientSecret / tiktokRedirectUri).
// - Los tokens del usuario viven en la bóveda de Conexiones (el
//   estado seguro cifrado con safeStorage que main expone vía
//   helpers.readConnections/writeConnections), en los campos
//   tiktokAccessToken / tiktokRefreshToken / tiktokOpenId. Este
//   módulo solo sabe LEER ese estado y CONSTRUIR el parche; quien
//   escribe en la bóveda es main.
// - PRIVACIDAD: mientras la app no pase la auditoría de la Content
//   Posting API, TikTok SOLO acepta privacidad SELF_ONLY (el video
//   queda privado, visible solo para el autor). Pedir otra
//   privacidad con la app sin auditar la rechaza TikTok; el cliente
//   lo avisa en el resultado en vez de callarlo.

const AUTH_HOST = "https://www.tiktok.com";
const API_HOST = "https://open.tiktokapis.com";

// Scopes de la Fase 2: identidad básica del usuario y publicación
// de video (publish = publicación directa; upload = borrador en la
// bandeja de TikTok).
const OAUTH_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
];

// Privacidad por defecto y única garantizada sin auditoría.
const PRIVACIDAD_SIN_AUDITORIA = "SELF_ONLY";
const AVISO_PRIVACIDAD = "Si la app de TikTok aún no pasó la auditoría de la Content Posting API, TikTok solo acepta privacidad SELF_ONLY (video privado, solo lo ve el autor): cualquier otra privacidad será rechazada hasta completar la auditoría.";

function cleanStr(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Resuelve la configuración de la app de TikTok desde el entorno o
 * desde el objeto de Conexiones. `configured` exige clientKey,
 * clientSecret y redirectUri; `missing` lista lo que falte.
 */
function resolveTiktokConfig({ connections = {}, env = process.env } = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  const e = env && typeof env === "object" ? env : {};
  const clientKey = cleanStr(e.TIKTOK_CLIENT_KEY || e.EDITCORE_TIKTOK_CLIENT_KEY || c.tiktokClientKey);
  const clientSecret = cleanStr(e.TIKTOK_CLIENT_SECRET || e.EDITCORE_TIKTOK_CLIENT_SECRET || c.tiktokClientSecret);
  const redirectUri = cleanStr(e.TIKTOK_REDIRECT_URI || e.EDITCORE_TIKTOK_REDIRECT_URI || c.tiktokRedirectUri);
  const missing = [];
  if (!clientKey) missing.push("clientKey (TIKTOK_CLIENT_KEY o tiktokClientKey en Conexiones)");
  if (!clientSecret) missing.push("clientSecret (TIKTOK_CLIENT_SECRET o tiktokClientSecret en Conexiones)");
  if (!redirectUri) missing.push("redirectUri (TIKTOK_REDIRECT_URI o tiktokRedirectUri en Conexiones)");
  return { clientKey, clientSecret, redirectUri, configured: missing.length === 0, missing };
}

/** Lee el estado de TikTok guardado en un objeto de Conexiones. */
function readTiktokState(connections = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  return {
    accessToken: cleanStr(c.tiktokAccessToken),
    refreshToken: cleanStr(c.tiktokRefreshToken),
    openId: cleanStr(c.tiktokOpenId),
  };
}

/**
 * Construye el parche de Conexiones que main guarda en la bóveda.
 * Solo incluye los campos definidos, para que un refresco de token
 * no borre el refresh token ni el open_id ya guardados.
 */
function buildTiktokPatch({ accessToken, refreshToken, openId } = {}) {
  const patch = {};
  if (accessToken !== undefined) patch.tiktokAccessToken = cleanStr(accessToken);
  if (refreshToken !== undefined) patch.tiktokRefreshToken = cleanStr(refreshToken);
  if (openId !== undefined) patch.tiktokOpenId = cleanStr(openId);
  return patch;
}

function createTiktokClient({ clientKey = "", clientSecret = "", redirectUri = "", fetchImpl = null } = {}) {
  const doFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (...args) => globalThis.fetch(...args);

  /**
   * Llamada a la API de TikTok. El sobre de respuesta es
   * { data, error: { code, message, log_id } }: code "ok" (o la
   * ausencia de error) es éxito; cualquier otro code es fallo,
   * aunque el HTTP sea 200.
   */
  async function api(pathname, { method = "GET", accessToken = "", jsonBody = null, formBody = null } = {}) {
    const url = `${API_HOST}${pathname}`;
    const init = { method, headers: {} };
    if (accessToken) init.headers.Authorization = `Bearer ${cleanStr(accessToken)}`;
    if (jsonBody) {
      init.headers["Content-Type"] = "application/json; charset=UTF-8";
      init.body = JSON.stringify(jsonBody);
    } else if (formBody) {
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(Object.entries(formBody).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    }
    let res;
    try {
      res = await doFetch(url, init);
    } catch (error) {
      return { ok: false, error: `TikTok no respondió (red): ${error?.message || String(error)}` };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const apiError = data && data.error && cleanStr(data.error.code) && data.error.code !== "ok" ? data.error : null;
    if (apiError) {
      const detalle = [apiError.message || "error de la API de TikTok", apiError.code ? `código ${apiError.code}` : ""].filter(Boolean).join(" · ");
      return { ok: false, error: `TikTok: ${detalle}` };
    }
    if (!res.ok) {
      return { ok: false, error: `TikTok devolvió HTTP ${res.status} sin detalle.` };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "TikTok devolvió una respuesta no válida (sin JSON)." };
    }
    return { ok: true, data: data.data && typeof data.data === "object" ? data.data : data };
  }

  /** URL de autorización de Login Kit que el usuario abre. */
  function buildAuthUrl({ state = "" } = {}) {
    const url = new URL(`${AUTH_HOST}/v2/auth/authorize/`);
    url.searchParams.set("client_key", cleanStr(clientKey));
    url.searchParams.set("scope", OAUTH_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", cleanStr(redirectUri));
    if (state) url.searchParams.set("state", String(state));
    return url.toString();
  }

  function mapearTokens(data, contexto) {
    if (!data || !cleanStr(data.access_token)) {
      return { ok: false, error: `TikTok no devolvió access_token al ${contexto}.` };
    }
    return {
      ok: true,
      accessToken: String(data.access_token),
      refreshToken: cleanStr(data.refresh_token),
      openId: cleanStr(data.open_id),
      expiresIn: Number(data.expires_in || 0) || 0,
      refreshExpiresIn: Number(data.refresh_expires_in || 0) || 0,
      scope: cleanStr(data.scope),
    };
  }

  /** Intercambia el código del redirect por access/refresh token. */
  async function exchangeCode(code) {
    const r = await api("/v2/oauth/token/", {
      method: "POST",
      formBody: {
        client_key: cleanStr(clientKey),
        client_secret: cleanStr(clientSecret),
        code: cleanStr(code),
        grant_type: "authorization_code",
        redirect_uri: cleanStr(redirectUri),
      },
    });
    if (!r.ok) return r;
    return mapearTokens(r.data, "intercambiar el código");
  }

  /** Renueva el access token con el refresh token guardado. */
  async function refreshAccessToken(refreshToken) {
    const r = await api("/v2/oauth/token/", {
      method: "POST",
      formBody: {
        client_key: cleanStr(clientKey),
        client_secret: cleanStr(clientSecret),
        grant_type: "refresh_token",
        refresh_token: cleanStr(refreshToken),
      },
    });
    if (!r.ok) return r;
    return mapearTokens(r.data, "refrescar el token");
  }

  /** Info básica del usuario conectado (open_id, nombre, avatar). */
  async function getUserInfo(accessToken) {
    if (!cleanStr(accessToken)) return { ok: false, error: "Falta el access token para leer el usuario de TikTok." };
    const r = await api("/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
      accessToken: cleanStr(accessToken),
    });
    if (!r.ok) return r;
    const user = r.data.user && typeof r.data.user === "object" ? r.data.user : {};
    if (!cleanStr(user.open_id)) return { ok: false, error: "TikTok no devolvió el open_id del usuario." };
    return {
      ok: true,
      openId: String(user.open_id),
      unionId: cleanStr(user.union_id),
      displayName: cleanStr(user.display_name),
      avatarUrl: cleanStr(user.avatar_url),
    };
  }

  /**
   * Inicia la publicación de un video (Content Posting API):
   * - Con «videoUrl» pública: fuente PULL_FROM_URL (TikTok la
   *   descarga y la publica directamente).
   * - Con «videoSize» (bytes): fuente FILE_UPLOAD; TikTok devuelve
   *   el publish_id y la upload_url a la que subir los trozos.
   * La privacidad por defecto es SELF_ONLY, la única que TikTok
   * acepta sin auditoría de la app; pedir otra añade el aviso.
   */
  async function publishVideo({ accessToken = "", videoUrl = "", videoSize = 0, chunkSize = 0, title = "", privacyLevel = "", disableDuet = false, disableComment = false, disableStitch = false } = {}) {
    if (!cleanStr(accessToken)) return { ok: false, error: "Falta el access token para publicar en TikTok." };
    const privacidad = cleanStr(privacyLevel) || PRIVACIDAD_SIN_AUDITORIA;
    const sourceInfo = {};
    if (cleanStr(videoUrl)) {
      sourceInfo.source = "PULL_FROM_URL";
      sourceInfo.video_url = cleanStr(videoUrl);
    } else if (Number(videoSize) > 0) {
      const size = Math.floor(Number(videoSize));
      // Trozo único si el video cabe en el máximo por trozo (64 MB);
      // si no, trozos de 64 MB y el último lleva el resto.
      const trozo = Number(chunkSize) > 0 ? Math.floor(Number(chunkSize)) : Math.min(size, 64 * 1024 * 1024);
      sourceInfo.source = "FILE_UPLOAD";
      sourceInfo.video_size = size;
      sourceInfo.chunk_size = trozo;
      sourceInfo.total_chunk_count = Math.max(1, Math.ceil(size / trozo));
    } else {
      return { ok: false, error: "Publicar en TikTok necesita «videoUrl» pública (PULL_FROM_URL) o «videoSize» en bytes (FILE_UPLOAD)." };
    }
    const r = await api("/v2/post/publish/video/init/", {
      method: "POST",
      accessToken: cleanStr(accessToken),
      jsonBody: {
        post_info: {
          title: cleanStr(title),
          privacy_level: privacidad,
          disable_duet: Boolean(disableDuet),
          disable_comment: Boolean(disableComment),
          disable_stitch: Boolean(disableStitch),
        },
        source_info: sourceInfo,
      },
    });
    if (!r.ok) return r;
    const publishId = cleanStr(r.data.publish_id);
    if (!publishId) return { ok: false, error: "TikTok no devolvió el publish_id de la publicación." };
    return {
      ok: true,
      publishId,
      uploadUrl: cleanStr(r.data.upload_url),
      privacidad,
      ...(privacidad !== PRIVACIDAD_SIN_AUDITORIA ? { aviso: AVISO_PRIVACIDAD } : {}),
    };
  }

  /** Estado de una publicación iniciada (por su publish_id). */
  async function fetchPublishStatus({ accessToken = "", publishId = "" } = {}) {
    if (!cleanStr(accessToken)) return { ok: false, error: "Falta el access token para consultar el estado en TikTok." };
    if (!cleanStr(publishId)) return { ok: false, error: "Falta el «publishId» a consultar." };
    const r = await api("/v2/post/publish/status/fetch/", {
      method: "POST",
      accessToken: cleanStr(accessToken),
      jsonBody: { publish_id: cleanStr(publishId) },
    });
    if (!r.ok) return r;
    return {
      ok: true,
      status: cleanStr(r.data.status),
      failReason: cleanStr(r.data.fail_reason),
      postIds: Array.isArray(r.data.publicaly_available_post_id) ? r.data.publicaly_available_post_id.map(String) : [],
    };
  }

  return { buildAuthUrl, exchangeCode, refreshAccessToken, getUserInfo, publishVideo, fetchPublishStatus };
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
  const config = resolveTiktokConfig({ connections, env: process.env });
  if (!config.configured) {
    return {
      ok: false,
      error: `TikTok no está configurado: faltan ${config.missing.join(", ")}. Sin eso no se puede conectar la cuenta.`,
      config,
      connections,
    };
  }
  return { ok: true, client: createTiktokClient(config), config, connections };
}

/**
 * Guarda el parche de TikTok en la bóveda vía
 * helpers.writeConnections. Sin esa costura, devuelve ok:false: el
 * token NO se guarda en ningún otro sitio.
 */
function saveTiktokPatch(helpers, patch) {
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
  PRIVACIDAD_SIN_AUDITORIA,
  AVISO_PRIVACIDAD,
  resolveTiktokConfig,
  readTiktokState,
  buildTiktokPatch,
  createTiktokClient,
  readConnectionsSafe,
  createClientFromHelpers,
  saveTiktokPatch,
};
