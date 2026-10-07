"use strict";

/**
 * PRODUCT PIPELINE — Brief → Design → Build → QA
 * EditCoreAI Fase 6
 *
 * Orquesta el orden de trabajo para productos de calidad
 * (evita saltar directo a código genérico).
 */

const {
  isUiTask,
  isProductBuildTask,
  visualQaChecklist,
  eliteUiSystemPrompt,
} = require("./elite-ui-policy");

const PIPELINE_VERSION = "6.0";

const PHASES = Object.freeze({
  BRIEF: "brief",
  DESIGN: "design",
  BUILD: "build",
  QA: "qa",
  DONE: "done",
});

/**
 * Decide si la tarea debe usar pipeline completo de producto.
 */
function shouldUseProductPipeline(userText = "") {
  return isProductBuildTask(userText) || (isUiTask(userText) && /(?:completa|profesional|premium|producci[oó]n|landing|dashboard|app|saas)/i.test(userText));
}

/**
 * Plan de fases por defecto para builds de producto/UI seria.
 */
function defaultProductPhases(userText = "") {
  const ui = isUiTask(userText) || isProductBuildTask(userText);
  if (!ui) {
    return [PHASES.BRIEF, PHASES.BUILD, PHASES.QA];
  }
  return [PHASES.BRIEF, PHASES.DESIGN, PHASES.BUILD, PHASES.QA];
}

/**
 * Instrucciones por fase (inyectar al agente según fase activa).
 */
function phaseInstructions(phase) {
  switch (phase) {
    case PHASES.BRIEF:
      return [
        "[FASE BRIEF]",
        "Antes de código, resume en 5-8 líneas:",
        "- Usuario objetivo y problema",
        "- Promesa del producto (1 frase)",
        "- Pantallas o flujos prioritarios (máx 5)",
        "- Constraints (stack, marca, plazo)",
        "No implementes aún. Si el usuario ya dio brief claro, confirma y pasa a DESIGN.",
      ].join("\n");
    case PHASES.DESIGN:
      return [
        "[FASE DESIGN]",
        "Define identidad visual ANTES de páginas largas:",
        "- Tokens: primary, neutrals, success/danger, radius, shadow",
        "- Tipografía: display + body (nombres concretos; evita Inter por defecto)",
        "- Layout base y componentes reutilizables (Button, Input, Card, Nav)",
        "- Anti-genérico: una decisión memorable (tipo, color o composición)",
        "Puedes escribir tokens/theme y componentes base. Evita 10 páginas de golpe.",
        eliteUiSystemPrompt(),
      ].join("\n");
    case PHASES.BUILD:
      return [
        "[FASE BUILD]",
        "Implementa sobre los tokens/componentes de DESIGN.",
        "- Pantallas prioritarias primero",
        "- Estados empty/error/loading",
        "- Responsive",
        "- Sin TODOs de implementación ni archivos a medias",
        "- Reutiliza componentes; no copies el mismo card 3 veces con distinto texto solo",
      ].join("\n");
    case PHASES.QA:
      return [
        "[FASE QA]",
        visualQaChecklist(),
        "- Verifica que los archivos existen y el contenido es completo",
        "- Si hay dev server / preview, úsalo; si no, revisa código con criterio visual",
        "- Si falla el checklist anti-genérico, vuelve a BUILD y corrige",
        "- No declares 'listo' si la UI parece plantilla PowerPoint/SaaS genérica",
      ].join("\n");
    case PHASES.DONE:
      return "[FASE DONE] Resumen de entregables (paths) y cómo correr el proyecto.";
    default:
      return "";
  }
}

/**
 * Construye el bloque de pipeline para el system/prompt del turno.
 */
function buildPipelinePrompt(userText = {}, options = {}) {
  const text = typeof userText === "string" ? userText : String(userText?.text || userText?.message || "");
  if (!shouldUseProductPipeline(text) && !options.force) {
    return {
      active: false,
      phases: [],
      current: null,
      prompt: "",
    };
  }

  const phases = options.phases || defaultProductPhases(text);
  const current = options.currentPhase || phases[0];
  const idx = Math.max(0, phases.indexOf(current));

  const lines = [
    `[PRODUCT PIPELINE v${PIPELINE_VERSION}]`,
    `Fases: ${phases.join(" → ")}`,
    `Fase activa: ${current} (${idx + 1}/${phases.length})`,
    "",
    phaseInstructions(current),
    "",
    "REGLA: No saltes a BUILD sin DESIGN cuando el trabajo es UI/producto visual.",
    "REGLA: No cierres en DONE sin pasar QA visual si hubo UI.",
  ];

  return {
    active: true,
    phases,
    current,
    prompt: lines.join("\n"),
  };
}

/**
 * Avanza a la siguiente fase.
 */
function nextPhase(phases, current) {
  const list = Array.isArray(phases) ? phases : defaultProductPhases("");
  const i = list.indexOf(current);
  if (i < 0 || i >= list.length - 1) return PHASES.DONE;
  return list[i + 1];
}

module.exports = {
  PIPELINE_VERSION,
  PHASES,
  shouldUseProductPipeline,
  defaultProductPhases,
  phaseInstructions,
  buildPipelinePrompt,
  nextPhase,
};
