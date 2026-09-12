"use strict";

/**
 * Prompt de diseño UI contemporánea (Lovable/Cursor style).
 */

function uiDesignSystemPrompt() {
  return [
    "## UI/UX FIRST (obligatorio al crear o modificar interfaces)",
    "- Stack por defecto: Next.js App Router + TypeScript + Tailwind CSS (v4 preferido; v3 aceptable en scaffold) + Lucide + Framer Motion + Radix/shadcn.",
    "- Estética: modo oscuro profesional, tipografía Inter/Geist, bordes border-white/10, sombras suaves, layouts responsive.",
    "- Componentes: reutilizables, accesibles, sin HTML espagueti. Prefiere shadcn/ui patterns.",
    "- No uses CSS inline masivo ni estilos genéricos 'AI purple gradient' salvo petición explícita.",
    "- Tras cambios visuales, verifica coherencia (espaciado, contraste, jerarquía).",
  ].join("\n");
}

module.exports = { uiDesignSystemPrompt };
