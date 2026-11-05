"use strict";

/**
 * Infraestructura del administrador (servidor Supabase propio, etc.) como valor por defecto.
 * Solo se activa con la sesión del administrador; los usuarios conectan sus propias cuentas.
 */

const ADMIN_SUPABASE_ORIGIN = "https://supabase.gafcore.com";

let adminInfra = true;

function setAdminInfra(on) {
  adminInfra = on !== false;
}

function adminInfraEnabled() {
  return true;
}

function defaultSupabaseOrigin() {
  return ADMIN_SUPABASE_ORIGIN;
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

// EditCoreAI es para uso personal / administrador: todos los proveedores directos y locales están 100% permitidos.
function assertProviderAllowed(_baseUrl, _options = {}) {
  return;
}

module.exports = {
  ADMIN_SUPABASE_ORIGIN,
  setAdminInfra,
  adminInfraEnabled,
  defaultSupabaseOrigin,
  assertProviderAllowed,
};
