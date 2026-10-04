"use strict";

/**
 * Prompt de diseño UI contemporánea (estilo moderno).
 */

function uiDesignSystemPrompt() {
  return [
    "## UI/UX FIRST (obligatorio al crear o modificar interfaces)",
    "- Stack por defecto: Next.js App Router o Vite/React + TypeScript + Tailwind CSS + Lucide + Framer Motion + Radix/shadcn.",
    "- Estética: tipografía expresiva (no Inter/Roboto/Arial por defecto), jerarquía clara, layouts responsive.",
    "- Componentes: reutilizables, accesibles, sin HTML espagueti. Prefiere shadcn/ui patterns.",
    "- No uses CSS inline masivo ni estilos genéricos 'AI purple gradient' salvo petición explícita.",
    "- Tras cambios visuales, verifica coherencia (espaciado, contraste, jerarquía).",
    "",
    "## MOTION + ASSETS (obligatorio en web/PWA nuevas)",
    "- Siempre implementa micro-interacciones (hover/focus/press) con Tailwind transition utilities o Framer Motion.",
    "- Usa scroll suave en anclas y reveals on-scroll (whileInView / IntersectionObserver); respeta prefers-reduced-motion.",
    "- Placeholders de assets responsive: aspect-ratio, object-cover, fallback a SVG/logo si la imagen falla; guarda generados en public/assets/.",
    "- Si el usuario pide imagen/video y hay config: usa generate_image / generate_video; si no hay config, SVG/CSS/placeholder sin inventar URLs.",
  ].join("\n");
}

module.exports = { uiDesignSystemPrompt };
