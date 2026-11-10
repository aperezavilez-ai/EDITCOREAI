"use strict";

/**
 * Política de proveedores e infraestructura del administrador — MÓDULO ÚNICO.
 *
 * Toda decisión de "qué proveedor puede usar esta instalación" pasa por aquí:
 * - adminInfra: la infraestructura del administrador (Supabase propio, claves
 *   directas) solo se ofrece cuando la sesión activa es la del administrador.
 *   main.js la sincroniza con setAdminInfra(rol === "admin" && !sesión cloud).
 * - assertProviderAllowed: en la app INSTALADA (packaged) sin sesión admin,
 *   la única ruta de IA permitida es el proxy del servidor de EditCoreAI
 *   (cloudProxyPrefix). Cualquier URL directa lanza PROVIDER_LOCKED.
 *   En desarrollo, o con sesión admin, no se bloquea ningún proveedor.
 *
 * Antes este módulo era una fachada: setAdminInfra ignoraba el flag,
 * adminInfraEnabled() devolvía siempre true y assertProviderAllowed era
 * un no-op con un comentario de "uso personal". La política parecía existir
 * y no existía.
 */

// Sin host por defecto (regla del dueño, 2026-11-10): solo el administrador
// usa SU conexión de Supabase (la oficial, configurada explícitamente), y
// cada usuario conecta sus propias cuentas de Supabase, Vercel y GitHub.
// Antes el valor era el servidor propio dado de baja (supabase.gafcore.com)
// y, como origen de reserva, aprovisionar sin URL explícita apuntaba a un
// dominio muerto. Sin configuración explícita, el origen es "" (cerrado).
const ADMIN_SUPABASE_ORIGIN = "";

let adminInfra = true;

function setAdminInfra(on) {
  adminInfra = on !== false;
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
    const url = String(loadCloudConfig({ ...options, packaged: true }).url || "").replace(/\/+$/, "");
    return url ? `${url}/functions/v1/ai-proxy/` : "";
  } catch {
    return "";
  }
}

function assertProviderAllowed(baseUrl, options = {}) {
  // Desarrollo o sesión del administrador: sin candado. Si el llamante no
  // dice si la app está instalada, se detecta igual que en editcore-cloud-config
  // (las dos rutas vivas, ai-core y el provider del kernel, llaman sin options).
  let packaged = options.packaged;
  if (packaged === undefined) {
    try { packaged = require("./editcore-cloud-config").isPackagedApp(); } catch { packaged = false; }
  }
  if (packaged !== true || adminInfra) return;
  const prefix = cloudProxyPrefix(options);
  const url = String(baseUrl || "").trim();
  if (prefix && url.startsWith(prefix)) return;
  const err = new Error(
    "Proveedor bloqueado: la app instalada solo puede usar la IA del servidor de EditCoreAI. " +
    "Conecta una cuenta o inicia sesión como administrador para usar proveedores directos."
  );
  err.code = "PROVIDER_LOCKED";
  throw err;
}

module.exports = {
  ADMIN_SUPABASE_ORIGIN,
  setAdminInfra,
  adminInfraEnabled,
  defaultSupabaseOrigin,
  cloudProxyPrefix,
  assertProviderAllowed,
};
