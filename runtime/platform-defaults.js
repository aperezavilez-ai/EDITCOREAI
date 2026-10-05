"use strict";

/**
 * Infraestructura del administrador (servidor Supabase propio, etc.) como valor por defecto.
 * Solo se activa con la sesión del administrador; los usuarios conectan sus propias cuentas.
 */

const ADMIN_SUPABASE_ORIGIN = "https://supabase.gafcore.com";

let adminInfra = false;

function setAdminInfra(on) {
  adminInfra = on === true;
}

function adminInfraEnabled() {
  return adminInfra;
}

function defaultSupabaseOrigin() {
  return adminInfra ? ADMIN_SUPABASE_ORIGIN : "";
}

function cloudProxyPrefix(options = {}) {
  try {
    const { loadCloudConfig } = require("./editcore-cloud-config");
    const url = String(loadCloudConfig(options).url || "").replace(/\/+$/, "");
    return url ? `${url}/functions/v1/ai-proxy/` : "";
  } catch {
    return "";
  }
}

// En la app instalada, solo el administrador (verificado por el servidor) puede llamar a otro proveedor;
// los usuarios usan siempre la IA del servidor de EditCoreAI, que cobra de su saldo.
function assertProviderAllowed(baseUrl, options = {}) {
  const packaged = options.packaged ?? require("./editcore-cloud-config").isPackagedApp();
  if (!packaged || adminInfra) return;
  const prefix = cloudProxyPrefix({ packaged });
  const base = `${String(baseUrl || "").trim().replace(/\/+$/, "")}/`;
  if (prefix && base.startsWith(prefix)) return;
  throw Object.assign(new Error("La IA de EditCoreAI se usa con tu saldo. Recarga para seguir."), {
    code: "PROVIDER_LOCKED",
    status: 403,
  });
}

module.exports = {
  ADMIN_SUPABASE_ORIGIN,
  setAdminInfra,
  adminInfraEnabled,
  defaultSupabaseOrigin,
  assertProviderAllowed,
};
