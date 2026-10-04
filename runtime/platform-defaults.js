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

module.exports = {
  ADMIN_SUPABASE_ORIGIN,
  setAdminInfra,
  adminInfraEnabled,
  defaultSupabaseOrigin,
};
