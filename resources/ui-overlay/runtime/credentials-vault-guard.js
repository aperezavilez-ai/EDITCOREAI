"use strict";

/**
 * credentials-vault-guard.js
 *
 * Protección contra sobreescritura automática de credenciales del usuario.
 *
 * PROBLEMA QUE RESUELVE:
 * main.js ejecuta en cada arranque:
 *   - ensureDirectUpstreamProfiles()      → inyecta keys de .apicredits-keys.local / .meai-keys.local
 *   - ensureExpandedMeaiGatewayModels()   → limpia/injecta gateway residual
 *   - importLegacyConnectionsIntoCurrentVault() → copia de carpetas legacy
 *
 * Estos tres procesos PISAN las credenciales que el usuario guardó manualmente
 * en Modelos / Conexiones del IDE, porque las keys de los archivos .local son
 * viejas y siempre distintas a las actuales.
 *
 * SOLUCIÓN:
 * - Cuando el usuario guarda credenciales vía `secure-config:save`, se marca
 *   un flag persistente `editcore-user-lock: true` en la bóveda segura.
 * - Las funciones de importación consultan `hasUserLock(state)` y si el flag
 *   existe, salen sin tocar nada.
 * - El flag se mantiene hasta que el usuario lo borre explícitamente.
 *
 * USO (integración mínima en main.js):
 *
 *   const { hasUserLock, markUserLock } = require("./runtime/credentials-vault-guard");
 *
 *   // En ensureDirectUpstreamProfiles():
 *   const secure = readSecureState();
 *   if (hasUserLock(secure)) return false;
 *
 *   // En ensureExpandedMeaiGatewayModels():
 *   if (hasUserLock(readSecureState())) return false;
 *
 *   // En migrateLegacyUserData() (al inicio):
 *   if (hasUserLock(readSecureState())) return;
 *
 *   // En importLegacyConnectionsIntoCurrentVault():
 *   if (!force && hasUserLock(readSecureState())) return { ok: true, skipped: true, imported: false };
 *
 *   // En ipcMain.handle("secure-config:save"):
 *   writeSecureState(markUserLock(merged));
 */

const LOCK_KEY = "editcore-user-lock";
const LOCK_AT_KEY = "editcore-user-lock-at";

function hasUserLock(state = {}) {
  if (!state || typeof state !== "object") return false;
  if (state[LOCK_KEY] === true) return true;
  const at = Number(state[LOCK_AT_KEY]) || 0;
  return at > 0;
}

function markUserLock(state = {}) {
  const next = { ...(state || {}) };
  next[LOCK_KEY] = true;
  next[LOCK_AT_KEY] = Date.now();
  return next;
}

function clearUserLock(state = {}) {
  const next = { ...(state || {}) };
  delete next[LOCK_KEY];
  delete next[LOCK_AT_KEY];
  return next;
}

function describeLock(state = {}) {
  if (!hasUserLock(state)) return "sin-lock";
  const at = Number(state?.[LOCK_AT_KEY]) || 0;
  return at > 0 ? `lock-por-usuario (${new Date(at).toISOString()})` : "lock-por-usuario";
}

module.exports = {
  hasUserLock,
  markUserLock,
  clearUserLock,
  describeLock,
  LOCK_KEY,
  LOCK_AT_KEY,
};