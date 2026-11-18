"use strict";

// [SOCIAL-META FASE 1] Cliente de la Graph API de Meta (Facebook Pages
// + Instagram) para las herramientas social_* del kernel.
//
// Diseño:
// - Sin dependencias y con fetch INYECTABLE (fetchImpl) para poder
//   probarlo sin red; en producción usa el fetch global, resuelto en
//   el momento de la llamada.
// - Ninguna función finge éxito: todo error de la API (campo `error`
//   de Graph), de HTTP o de red vuelve como { ok:false, error }.
// - El app id/secret y la redirect URI NUNCA van hardcodeados: salen
//   de las variables de entorno (META_APP_ID / META_APP_SECRET /
//   META_REDIRECT_URI) o de la configuración de Conexiones existente
//   (metaAppId / metaAppSecret / metaRedirectUri).
// - Los tokens del usuario viven en la bóveda de Conexiones (el estado
//   seguro cifrado con safeStorage que main expone vía
//   helpers.readConnections/writeConnections), en los campos
//   metaUserToken / metaTokenExpiresAt / metaPagesJson. Este módulo
//   solo sabe LEER ese estado de un objeto de conexiones y CONSTRUIR
//   el parche a guardar; quien escribe en la bóveda es main.

const GRAPH_HOST = "https://graph.facebook.com";
const DIALOG_HOST = "https://www.facebook.com";
const DEFAULT_API_VERSION = "v21.0";

// Scopes mínimos de la Fase 1: listar páginas, leer su engagement,
// publicar en páginas y publicar en Instagram (cuenta vinculada).
const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
];

function cleanStr(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Resuelve la configuración de la app de Meta desde el entorno o
 * desde el objeto de Conexiones. `configured` exige appId, appSecret
 * y redirectUri; `missing` lista lo que falte, para el error honesto.
 */
function resolveMetaConfig({ connections = {}, env = process.env } = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  const e = env && typeof env === "object" ? env : {};
  const appId = cleanStr(e.META_APP_ID || e.EDITCORE_META_APP_ID || c.metaAppId);
  const appSecret = cleanStr(e.META_APP_SECRET || e.EDITCORE_META_APP_SECRET || c.metaAppSecret);
  const redirectUri = cleanStr(e.META_REDIRECT_URI || e.EDITCORE_META_REDIRECT_URI || c.metaRedirectUri);
  const apiVersion = cleanStr(e.META_API_VERSION || c.metaApiVersion) || DEFAULT_API_VERSION;
  const missing = [];
  if (!appId) missing.push("appId (META_APP_ID o metaAppId en Conexiones)");
  if (!appSecret) missing.push("appSecret (META_APP_SECRET o metaAppSecret en Conexiones)");
  if (!redirectUri) missing.push("redirectUri (META_REDIRECT_URI o metaRedirectUri en Conexiones)");
  return { appId, appSecret, redirectUri, apiVersion, configured: missing.length === 0, missing };
}

/**
 * Lee el estado social guardado en un objeto de Conexiones.
 * Devuelve las páginas SIN exponer nunca los tokens de página fuera
 * de `pages[].accessToken` (uso interno del cliente; las herramientas
 * deben recortar antes de devolver nada al chat).
 */
function readSocialState(connections = {}) {
  const c = connections && typeof connections === "object" ? connections : {};
  let pages = [];
  try {
    const parsed = JSON.parse(cleanStr(c.metaPagesJson) || "[]");
    if (Array.isArray(parsed)) {
      pages = parsed
        .filter((p) => p && cleanStr(p.id))
        .map((p) => ({
          id: cleanStr(p.id),
          name: cleanStr(p.name),
          accessToken: cleanStr(p.accessToken),
          instagram: p.instagram && cleanStr(p.instagram.id)
            ? { id: cleanStr(p.instagram.id), username: cleanStr(p.instagram.username) }
            : null,
        }));
    }
  } catch { pages = []; }
  return {
    userToken: cleanStr(c.metaUserToken),
    expiresAt: Number(c.metaTokenExpiresAt || 0) || 0,
    pages,
  };
}

/** Construye el parche de Conexiones que main guarda en la bóveda. */
function buildSocialPatch({ userToken = "", expiresIn = 0, pages = [] } = {}) {
  const limpias = (Array.isArray(pages) ? pages : []).map((p) => ({
    id: cleanStr(p.id),
    name: cleanStr(p.name),
    accessToken: cleanStr(p.accessToken),
    instagram: p && p.instagram && cleanStr(p.instagram.id)
      ? { id: cleanStr(p.instagram.id), username: cleanStr(p.instagram.username) }
      : null,
  }));
  return {
    metaUserToken: cleanStr(userToken),
    metaTokenExpiresAt: expiresIn > 0 ? Date.now() + Number(expiresIn) * 1000 : 0,
    metaPagesJson: JSON.stringify(limpias),
  };
}

/** Vista pública de una página: sin token, apta para el chat. */
function paginaPublica(p) {
  return {
    id: p.id,
    name: p.name,
    instagram: p.instagram ? { id: p.instagram.id, username: p.instagram.username } : null,
  };
}

function createMetaClient({ appId = "", appSecret = "", redirectUri = "", apiVersion = DEFAULT_API_VERSION, fetchImpl = null } = {}) {
  const version = cleanStr(apiVersion) || DEFAULT_API_VERSION;
  const doFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (...args) => globalThis.fetch(...args);

  async function graph(pathname, { method = "GET", query = {}, body = null } = {}) {
    const url = new URL(`${GRAPH_HOST}/${version}/${String(pathname).replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const init = { method };
    if (body) {
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    }
    let res;
    try {
      res = await doFetch(url.toString(), init);
    } catch (error) {
      return { ok: false, error: `Meta no respondió (red): ${error?.message || String(error)}` };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (data && data.error) {
      const e = data.error;
      const detalle = [e.message || "error de la Graph API", e.code ? `código ${e.code}` : "", e.error_subcode ? `subcódigo ${e.error_subcode}` : ""].filter(Boolean).join(" · ");
      return { ok: false, error: `Meta: ${detalle}` };
    }
    if (!res.ok) {
      return { ok: false, error: `Meta devolvió HTTP ${res.status} sin detalle.` };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "Meta devolvió una respuesta no válida (sin JSON)." };
    }
    return { ok: true, data };
  }

  /** URL del diálogo OAuth que el usuario abre para autorizar. */
  function buildAuthUrl({ state = "" } = {}) {
    const url = new URL(`${DIALOG_HOST}/${version}/dialog/oauth`);
    url.searchParams.set("client_id", cleanStr(appId));
    url.searchParams.set("redirect_uri", cleanStr(redirectUri));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES.join(","));
    if (state) url.searchParams.set("state", String(state));
    return url.toString();
  }

  /** Intercambia el código del redirect por un token de usuario. */
  async function exchangeCode(code) {
    const r = await graph("oauth/access_token", {
      query: {
        client_id: cleanStr(appId),
        client_secret: cleanStr(appSecret),
        redirect_uri: cleanStr(redirectUri),
        code: cleanStr(code),
      },
    });
    if (!r.ok) return r;
    if (!r.data.access_token) return { ok: false, error: "Meta no devolvió access_token al intercambiar el código." };
    return { ok: true, accessToken: String(r.data.access_token), expiresIn: Number(r.data.expires_in || 0) || 0 };
  }

  /** Extiende un token corto a uno de larga duración (~60 días). */
  async function extendToken(shortToken) {
    const r = await graph("oauth/access_token", {
      query: {
        grant_type: "fb_exchange_token",
        client_id: cleanStr(appId),
        client_secret: cleanStr(appSecret),
        fb_exchange_token: cleanStr(shortToken),
      },
    });
    if (!r.ok) return r;
    if (!r.data.access_token) return { ok: false, error: "Meta no devolvió access_token al extender el token." };
    return { ok: true, accessToken: String(r.data.access_token), expiresIn: Number(r.data.expires_in || 0) || 0 };
  }

  /** Páginas que administra el usuario, con su page token y su IG. */
  async function listPages(userToken) {
    const r = await graph("me/accounts", {
      query: {
        fields: "id,name,access_token,instagram_business_account{id,username}",
        access_token: cleanStr(userToken),
      },
    });
    if (!r.ok) return r;
    const pages = (Array.isArray(r.data.data) ? r.data.data : []).map((p) => ({
      id: cleanStr(p.id),
      name: cleanStr(p.name),
      accessToken: cleanStr(p.access_token),
      instagram: p.instagram_business_account && cleanStr(p.instagram_business_account.id)
        ? { id: cleanStr(p.instagram_business_account.id), username: cleanStr(p.instagram_business_account.username) }
        : null,
    })).filter((p) => p.id);
    return { ok: true, pages };
  }

  /** Publica un post (mensaje y/o enlace) en una página. */
  async function publishToPage({ pageId = "", pageToken = "", message = "", link = "" } = {}) {
    if (!cleanStr(pageId) || !cleanStr(pageToken)) return { ok: false, error: "Falta la página o su token para publicar." };
    if (!cleanStr(message) && !cleanStr(link)) return { ok: false, error: "El post necesita «message» o «link»." };
    const r = await graph(`${cleanStr(pageId)}/feed`, {
      method: "POST",
      body: { message: cleanStr(message), link: cleanStr(link), access_token: cleanStr(pageToken) },
    });
    if (!r.ok) return r;
    if (!r.data.id) return { ok: false, error: "Meta no devolvió el id del post publicado." };
    return { ok: true, postId: String(r.data.id) };
  }

  /**
   * Publica en Instagram en dos pasos: crea el contenedor de medio
   * y luego lo publica. Requiere imageUrl (o videoUrl) pública.
   */
  async function publishToInstagram({ igUserId = "", pageToken = "", imageUrl = "", videoUrl = "", caption = "" } = {}) {
    if (!cleanStr(igUserId) || !cleanStr(pageToken)) return { ok: false, error: "Falta la cuenta de Instagram o su token para publicar." };
    if (!cleanStr(imageUrl) && !cleanStr(videoUrl)) return { ok: false, error: "Instagram necesita «imageUrl» (o «videoUrl») pública del medio a publicar." };
    const contenedor = await graph(`${cleanStr(igUserId)}/media`, {
      method: "POST",
      body: {
        image_url: cleanStr(imageUrl),
        video_url: cleanStr(videoUrl),
        media_type: cleanStr(videoUrl) ? "REELS" : "",
        caption: cleanStr(caption),
        access_token: cleanStr(pageToken),
      },
    });
    if (!contenedor.ok) return contenedor;
    const creationId = cleanStr(contenedor.data.id);
    if (!creationId) return { ok: false, error: "Meta no devolvió el id del contenedor de Instagram." };
    const publicado = await graph(`${cleanStr(igUserId)}/media_publish`, {
      method: "POST",
      body: { creation_id: creationId, access_token: cleanStr(pageToken) },
    });
    if (!publicado.ok) return publicado;
    if (!publicado.data.id) return { ok: false, error: "Meta no devolvió el id del medio publicado en Instagram." };
    return { ok: true, mediaId: String(publicado.data.id), containerId: creationId };
  }

  return { buildAuthUrl, exchangeCode, extendToken, listPages, publishToPage, publishToInstagram };
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
  const config = resolveMetaConfig({ connections, env: process.env });
  if (!config.configured) {
    return {
      ok: false,
      error: `Meta no está configurado: faltan ${config.missing.join(", ")}. Sin eso no se puede conectar ninguna red social.`,
      config,
      connections,
    };
  }
  return { ok: true, client: createMetaClient(config), config, connections };
}

/**
 * Guarda el parche social en la bóveda vía helpers.writeConnections
 * (la costura de main que escribe en el estado seguro cifrado).
 * Sin esa costura, devuelve ok:false: el token NO se guarda en
 * ningún otro sitio (ni en el repo ni en texto plano).
 */
function saveSocialPatch(helpers, patch) {
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
  DEFAULT_API_VERSION,
  resolveMetaConfig,
  readSocialState,
  buildSocialPatch,
  paginaPublica,
  createMetaClient,
  readConnectionsSafe,
  createClientFromHelpers,
  saveSocialPatch,
};
