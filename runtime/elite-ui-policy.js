"use strict";

/**
 * ELITE UI POLICY — Anti-genérico + calidad visual profesional
 * EditCoreAI Fase 6
 *
 * Objetivo: evitar UIs tipo "plantilla PowerPoint / SaaS genérico AI"
 * y forzar decisiones de diseño de producto real.
 */

const POLICY_VERSION = "6.0";
const POLICY_MARKER = "EDITCORE_ELITE_UI_V6";

const FORBIDDEN_DEFAULTS = [
  "Inter como fuente principal sin justificación",
  "Roboto / Arial / system-ui como única tipografía de marca",
  "Gradiente púrpura-azul genérico de IA en heroes",
  "Tres cards idénticas con icono Lucide + título + párrafo",
  "Navbar genérica Logo | Links | Button sin personalidad",
  "Fondos solo gray-50 / slate-900 sin acento de marca",
  "Espaciado inconsistente (mezclar p-2, p-5, p-7 al azar)",
  "Botones default sin estados hover/focus/disabled claros",
  "Placeholders Lorem sin microcopy real",
  "Dashboard con 4 KPIs iguales en fila sin jerarquía",
];

const REQUIRED_WHEN_UI = [
  "Definir o reutilizar design tokens (color, tipo, spacing, radius, shadow)",
  "Jerarquía tipográfica explícita (display / title / body / caption)",
  "Estados: default, hover, focus-visible, disabled, loading, empty, error",
  "Responsive: móvil primero o al menos sm/md/lg verificados",
  "Contraste legible (texto sobre fondo)",
  "Una decisión de identidad (no genérico): tipografía o color o layout memorable",
  "Motion sutil o transitions; respetar prefers-reduced-motion",
];

/**
 * Prompt de sistema inyectable (bloque estático → bueno para cache).
 */
function eliteUiSystemPrompt() {
  return [
    `[${POLICY_MARKER}]`,
    "## ELITE UI — CALIDAD VISUAL PROFESIONAL (obligatorio)",
    "",
    "### Prohibido (anti-genérico / anti-PowerPoint)",
    ...FORBIDDEN_DEFAULTS.map((x) => `- ${x}`),
    "",
    "### Obligatorio al crear o cambiar UI",
    ...REQUIRED_WHEN_UI.map((x) => `- ${x}`),
    "",
    "### Stack visual preferido (si el proyecto no impone otro)",
    "- React/Next o Vite + TypeScript + Tailwind",
    "- Componentes accesibles (Radix / shadcn patterns)",
    "- Iconos consistentes (una sola librería)",
    "- Framer Motion o transitions Tailwind para micro-interacciones",
    "",
    "### Proceso mínimo antes de escribir UI",
    "1. Identidad: ¿quién es el usuario y qué debe sentir la interfaz?",
    "2. Tokens: 1 color primario, neutros, éxito/error, radios, sombras",
    "3. Tipografía: 1 display + 1 body (evitar Inter por defecto)",
    "4. Layout: grid/espaciado consistentes (escala 4/8)",
    "5. Implementar componentes reutilizables, no páginas monolito",
    "6. Verificar estados vacíos, error y loading",
    "",
    "### Criterio de rechazo (Verifier / auto)",
    "Si la UI parece plantilla genérica de IA, dashboard de 4 cards clones,",
    "o carece de identidad tipográfica/color, NO dar por terminado:",
    "corregir antes de cerrar la tarea.",
    "",
    "### Código",
    "- No dejar TODOs de implementación ni archivos a medias",
    "- Preferir componentes con props claras y className componible",
    "- Imágenes: aspect-ratio, object-cover, fallback; no URLs inventadas",
  ].join("\n");
}

/**
 * Detecta si el mensaje del usuario pide trabajo de UI/producto visual.
 */
function isUiTask(text = "") {
  return /(?:\bui\b|\bux\b|interfaz|dise[nñ]o|landing|dashboard|pantalla|p[aá]gina|frontend|css|tailwind|componente|bot[oó]n|modal|nav(?:bar)?|hero|pricing|onboarding|responsive|visual|estilo|tema|dark\s*mode|layout|card|formulario|login|signup|marketing)/i.test(
    String(text || "")
  );
}

/**
 * Detecta si el mensaje pide crear producto / app / web desde cero o grande.
 */
function isProductBuildTask(text = "") {
  return /(?:crea(?:r)?|arma(?:r)?|construye|build|desarrolla|haz(?:me)?|genera).{0,40}(?:app|aplicaci[oó]n|web|saas|plataforma|producto|mvp|landing|dashboard|tienda|portal)/i.test(
    String(text || "")
  ) || /(?:desde\s+cero|greenfield|nuevo\s+proyecto)/i.test(String(text || ""));
}

/**
 * Checklist de QA visual (texto para el agente / verifier).
 */
function visualQaChecklist() {
  return [
    "[QA VISUAL]",
    "- [ ] No parece plantilla genérica de 3 cards + gradiente IA",
    "- [ ] Tipografía con personalidad (no solo Inter/Roboto)",
    "- [ ] Tokens de color coherentes; contraste OK",
    "- [ ] Espaciado en escala consistente",
    "- [ ] Hover/focus/disabled en controles principales",
    "- [ ] Empty/error/loading contemplados donde aplica",
    "- [ ] Móvil legible (sin desborde horizontal obvio)",
    "- [ ] Iconografía consistente",
    "- [ ] Microcopy real (no Lorem)",
  ].join("\n");
}

/**
 * Heurística rápida sobre código/CSS generado (señales de UI genérica).
 * No es perfecta; sirve para advertir al agente.
 */
function detectGenericUiSignals(code = "") {
  const s = String(code || "");
  const signals = [];
  if (/from-purple-\d+.*to-blue-\d+|from-violet-\d+.*to-indigo-\d+/i.test(s)) {
    signals.push("gradiente púrpura/azul típico de plantillas IA");
  }
  if ((s.match(/rounded-xl[\s\S]{0,80}shadow/g) || []).length >= 3) {
    signals.push("múltiples cards rounded-xl+shadow similares");
  }
  if (/font-sans(?![\w-])|font-\[Inter\]|font-inter/i.test(s) && !/font-\[|font-display|font-serif/i.test(s)) {
    signals.push("tipografía genérica sin display alternativo");
  }
  if (/bg-gray-50|bg-slate-50/i.test(s) && !/primary|brand|accent|#[0-9a-fA-F]{3,8}/i.test(s)) {
    signals.push("solo neutros grises sin acento de marca");
  }
  return {
    genericRisk: signals.length >= 2,
    signals,
  };
}

function withEliteUiPolicy(systemPrompt = "") {
  const rest = String(systemPrompt || "").trim();
  const elite = eliteUiSystemPrompt();
  if (rest.includes(POLICY_MARKER)) return rest;
  if (!rest) return elite;
  return `${elite}\n\n${rest}`;
}

module.exports = {
  POLICY_VERSION,
  POLICY_MARKER,
  FORBIDDEN_DEFAULTS,
  REQUIRED_WHEN_UI,
  eliteUiSystemPrompt,
  isUiTask,
  isProductBuildTask,
  visualQaChecklist,
  detectGenericUiSignals,
  withEliteUiPolicy,
};
