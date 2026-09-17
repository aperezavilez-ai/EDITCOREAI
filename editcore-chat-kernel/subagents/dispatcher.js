"use strict";

const { SPECIALISTS } = require("./specialists");

/**
 * Despacha un rol especialista según el texto de la solicitud.
 * @param {string} prompt - Mensaje o tarea del usuario.
 * @returns {object|null} Especialista con { name, systemPrompt } o null.
 */
function dispatchSpecialist(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  if (!text) return null;

  // UI/UX Specialist
  if (/\b(?:ui|ux|diseño|diseno|estilo|css|tailwind|framer|interfaz|responsive|layout|modal|bot[oó]n|componente|visual|animaci[oó]n|color|tema\s+oscuro|dark\s+mode|icono|lucide)\b/i.test(text)) {
    return SPECIALISTS.UI_UX;
  }

  // Database / Supabase Specialist
  if (/\b(?:supabase|sql|postgres|database|base\s+de\s+datos|tabla|esquema|schema|migraci[oó]n|migration|rls|foreign\s+key|uuid|relaci[oó]n|query)\b/i.test(text)) {
    return SPECIALISTS.DATABASE;
  }

  // Security & Auth Specialist
  if (/\b(?:auth|seguridad|security|login|jwt|token|permiso|rol|credencial|api\s*key|password|contrase[ñn]a|oauth|middleware|proteger\s+ruta)\b/i.test(text)) {
    return SPECIALISTS.SECURITY;
  }

  // DevOps & Build Specialist
  if (/\b(?:build|compilaci[oó]n|devops|docker|deploy|next\s+build|tsc|typecheck|error\s+de\s+compilaci|paquete|dependencia|npm\s+install|package\.json)\b/i.test(text)) {
    return SPECIALISTS.DEVOPS;
  }

  return null;
}

module.exports = {
  dispatchSpecialist,
  SPECIALISTS,
};
