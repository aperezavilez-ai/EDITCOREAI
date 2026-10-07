"use strict";

/**
 * Prompt de diseño UI — EditCoreAI (Fase 6: Elite)
 * Archivo COMPLETO para reemplazar el existente.
 */

const {
  eliteUiSystemPrompt,
  withEliteUiPolicy,
  visualQaChecklist,
  isUiTask,
} = require("../runtime/elite-ui-policy");

function uiDesignSystemPrompt() {
  return [
    eliteUiSystemPrompt(),
    "",
    "## UI/UX FIRST (implementación)",
    "- Stack por defecto si el proyecto no impone otro: Next.js App Router o Vite/React + TypeScript + Tailwind + Lucide + Framer Motion + Radix/shadcn patterns.",
    "- Estética: tipografía expresiva (no Inter/Roboto/Arial por defecto), jerarquía clara, layouts responsive.",
    "- Componentes reutilizables y accesibles; sin HTML espagueti.",
    "- Evita CSS inline masivo y el cliché 'AI purple gradient' salvo petición explícita.",
    "- Tras cambios visuales: coherencia de espaciado, contraste y jerarquía.",
    "",
    "## MOTION + ASSETS",
    "- Micro-interacciones (hover/focus/press) con Tailwind transitions o Framer Motion.",
    "- Scroll suave y reveals on-scroll cuando aporte; respeta prefers-reduced-motion.",
    "- Assets: aspect-ratio, object-cover, fallback SVG; no inventes URLs de imágenes.",
    "",
    visualQaChecklist(),
  ].join("\n");
}

/**
 * Inyecta elite UI solo cuando la tarea es visual (ahorra tokens en tareas no-UI).
 */
function uiDesignPromptForTask(userText = "") {
  if (!isUiTask(userText) && !/(?:crea|haz|construye|diseña).{0,30}(?:web|app|landing|dashboard|ui)/i.test(String(userText || ""))) {
    return "";
  }
  return uiDesignSystemPrompt();
}

module.exports = {
  uiDesignSystemPrompt,
  uiDesignPromptForTask,
  withEliteUiPolicy,
};
