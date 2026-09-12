"use strict";

const { SPECIALISTS } = require("./specialists");

/**
 * Detecta qué especialista requiere la tarea basándose en palabras clave.
 */
function dispatchSpecialist(userPrompt) {
  const text = String(userPrompt || "").toLowerCase();

  if (/\b(diseño|ui|ux|componente|estilo|tailwind|animacion|pantalla|dashboard|layout)\b/i.test(text)) {
    return SPECIALISTS.UI_UX;
  }
  if (/\b(base de datos|tabla|sql|supabase|prisma|migration|esquema|columna)\b/i.test(text)) {
    return SPECIALISTS.DATABASE;
  }
  if (/\b(auth|login|seguridad|token|jwt|permisos|rls|password|clave)\b/i.test(text)) {
    return SPECIALISTS.SECURITY;
  }
  if (/\b(build|error|tsc|compile|next|cache|dev|servidor|deploy)\b/i.test(text)) {
    return SPECIALISTS.DEVOPS;
  }

  // Si es una tarea general, retorna null (se procesa con el flujo estándar)
  return null;
}

module.exports = { dispatchSpecialist };