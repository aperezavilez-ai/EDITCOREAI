"use strict";

const { SPECIALISTS } = require("./specialists");

/**
 * Despacha un rol especialista según el texto de la solicitud.
 * @param {string} prompt - Mensaje o tarea del usuario.
 * @returns {object|null} Especialista con { name, systemPrompt } o null.
 */
function dispatchSpecialist(prompt = "", contextPrompt = "") {
  const imm = String(prompt || "").toLowerCase();
  const ctx = String(contextPrompt || "").toLowerCase();
  if (!imm && !ctx) return null;

  // 1. Fullstack Architecture & Release Specialist (commits, push, deploy, build exe, releases)
  if (/\b(?:commit|push|deploy|release|roadmap|exe|empaquetar|dist:win|build-exe|publicar|producci[oó]n)\b/i.test(imm) ||
      (/\b(?:procede|ejecuta|continua|adelante)\b/i.test(imm) && /\b(?:commit|push|deploy|release|roadmap|exe|empaquetar|dist:win|build-exe|publicar)\b/i.test(ctx)) ||
      (/\b(?:commit|push|deploy|release|roadmap|exe|empaquetar|dist:win|build-exe|publicar|producci[oó]n)\b/i.test(imm || ctx))) {
    return SPECIALISTS.FULLSTACK_RELEASE || SPECIALISTS.DEVOPS;
  }

  // 2. DevOps & Build Specialist
  if (/\b(?:build|compilaci[oó]n|devops|docker|next\s+build|tsc|typecheck|error\s+de\s+compilaci|paquete|dependencia|npm\s+install|package\.json|electron:build)\b/i.test(imm) ||
      (/\b(?:procede|ejecuta|continua|adelante)\b/i.test(imm) && /\b(?:build|compilaci[oó]n|electron:build|npm\s+run\s+electron)\b/i.test(ctx)) ||
      (/\b(?:build|compilaci[oó]n|devops|docker|next\s+build|tsc|typecheck|error\s+de\s+compilaci|paquete|dependencia|npm\s+install|package\.json)\b/i.test(imm || ctx))) {
    return SPECIALISTS.DEVOPS;
  }

  // 3. Media & Streaming Specialist (cámaras, WebRTC, video, buffering, latencia)
  if (/\b(?:c[aá]mara|webcam|video|stream|streaming|webrtc|remoto|wifi|barrido|fps|pausado|lento|buffer|framerate|rvfc|playoutdelay|audiovideo)\b/i.test(imm) ||
      (/\b(?:procede|ejecuta|continua|adelante)\b/i.test(imm) && /\b(?:c[aá]mara|webcam|video|stream|streaming|webrtc|remoto|wifi|barrido)\b/i.test(ctx)) ||
      (/\b(?:c[aá]mara|webcam|video|stream|streaming|webrtc|remoto|wifi|barrido|fps|pausado|lento|buffer|framerate|rvfc|playoutdelay|audiovideo)\b/i.test(imm || ctx))) {
    return SPECIALISTS.MEDIA_STREAMING;
  }

  // 4. UI/UX Specialist
  if (/\b(?:ui|ux|diseño|diseno|estilo|css|tailwind|framer|interfaz|responsive|layout|modal|bot[oó]n|componente|visual|animaci[oó]n|color|tema\s+oscuro|dark\s+mode|icono|lucide)\b/i.test(imm || ctx)) {
    return SPECIALISTS.UI_UX;
  }

  // 5. Security & Auth Specialist
  if (/\b(?:auth|seguridad|security|login|jwt|token|permiso|rol|credencial|api\s*key|password|contrase[ñn]a|oauth|middleware|proteger\s+ruta)\b/i.test(imm || ctx)) {
    return SPECIALISTS.SECURITY;
  }

  // 6. Database / Supabase Specialist (Only genuine database keywords, excluding connection status tables or general Spanish)
  if (/\b(?:supabase\s+(?:schema|table|migrat|db|query)|sql|postgres|database|base\s+de\s+datos|tabla\s+sql|esquema|schema|migraci[oó]n|migration|rls|foreign\s+key|uuid|relaci[oó]n\s+(?:de\s+tablas|entre\s+tablas|sql))\b/i.test(imm || ctx)) {
    return SPECIALISTS.DATABASE;
  }

  return null;
}

module.exports = {
  dispatchSpecialist,
  SPECIALISTS,
};
