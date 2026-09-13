"use strict";

/**
 * Parche CORS para el webview de preview (partition persist:editcore-browser).
 * Permite que frontends en 127.0.0.1 llamen a Supabase GafCore/QatCore sin bloqueo del navegador.
 */

const SUPABASE_HOST_RE = /^(?:.+\.)?supabase\.(?:gafcore|qatcore)\.com$/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

function isSupabaseUrl(url = "") {
  try {
    return SUPABASE_HOST_RE.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

function pickAllowOrigin(details = {}) {
  const headers = details.requestHeaders || {};
  const origin = String(headers.Origin || headers.origin || "").trim();
  if (origin && LOCAL_ORIGIN_RE.test(origin)) return origin;
  return "http://127.0.0.1";
}

function setHeader(headers, name, value) {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
  headers[key] = Array.isArray(value) ? value : [String(value)];
}

/**
 * @param {Electron.Session} targetSession
 */
function installPreviewCorsBridge(targetSession) {
  if (!targetSession?.webRequest) return { ok: false, reason: "no-webRequest" };
  if (targetSession.__editcoreCorsBridgeInstalled) return { ok: true, already: true };
  targetSession.__editcoreCorsBridgeInstalled = true;

  targetSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      if (!isSupabaseUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const headers = { ...(details.responseHeaders || {}) };
      const allowOrigin = pickAllowOrigin(details);
      setHeader(headers, "Access-Control-Allow-Origin", allowOrigin);
      setHeader(headers, "Access-Control-Allow-Credentials", "true");
      setHeader(headers, "Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, accept, prefer, x-supabase-api-version");
      setHeader(headers, "Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      setHeader(headers, "Vary", "Origin");
      callback({ responseHeaders: headers });
    } catch {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  targetSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    // OPTIONS preflight: Electron no siempre emite respuesta; dejamos pasar.
    callback({});
  });

  return { ok: true };
}

module.exports = {
  installPreviewCorsBridge,
  isSupabaseUrl,
  SUPABASE_HOST_RE,
};
