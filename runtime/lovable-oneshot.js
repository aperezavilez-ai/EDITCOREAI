"use strict";

/**
 * Pipeline estilo Lovable: un solo turno de agente debe entregar UI usable.
 * Solo afecta prompts de orquestacion; no escribe disco por si mismo.
 */

function wantsPolishedUi(prompt = "") {
  const text = String(prompt || "");
  return /\b(lovable|ui\s+pulida|interfaz\s+pulida|app\s+web\s+profesional|landing|one[- ]?shot|producci[oó]n|hermosa|bonita|moderna|premium|shadcn|tailwind|figma|pixel[- ]perfect|responsive)\b/i.test(text)
    || /\b(crea|genera|construye|implementa)\b[\s\S]{0,80}\b(app|web|landing|dashboard|saas)\b/i.test(text);
}

function isLovableOneShotRequest(prompt = "", { greenfieldCreate = false } = {}) {
  if (!greenfieldCreate) return false;
  // Si el usuario pide Next SaaS / stack concreto distinto, no forzar lovable-web.
  try {
    const { resolveTemplateIntent } = require("./template-intent");
    const choice = resolveTemplateIntent(prompt);
    if (choice.id && choice.id !== "blank" && choice.id !== "lovable-web" && choice.id !== "react"
      && Number(choice.confidence || 0) >= 0.7) {
      return false;
    }
  } catch {
    // ignore
  }
  return wantsPolishedUi(prompt);
}

function buildLovableOneShotBlock({ permissionFull = false, prompt = "" } = {}) {
  let templateHint = "lovable-web (o react si lovable-web no aplica)";
  try {
    const { resolveTemplateIntent, describeTemplateChoice } = require("./template-intent");
    const choice = resolveTemplateIntent(prompt);
    if (choice.id && choice.id !== "blank") {
      templateHint = `${choice.id} (${describeTemplateChoice(choice)})`;
    }
  } catch {
    // ignore
  }
  return [
    "PIPELINE LOVABLE ONE-SHOT (obligatorio en este turno):",
    "- Entrega una app web usable en UN ciclo: plantilla + personalizacion + deps + preview.",
    "- Orden fijo:",
    "  1) brain_skill frontend-design (y project-templates si existe).",
    `  2) create_project template=${templateHint}.`,
    "  3) Personaliza copy, paleta, tipografia y layout al pedido del usuario (sin inventar producto ajeno).",
    "  4) npm install + npm run dev (un comando por llamada).",
    "  5) inspect_preview / inspect_browser / browser_interact (dom+click) desktop y mobile; corrige overflow/a11y.",
    "  6) run_diagnostics; si AUTO-FIX llega, corrige y reintenta.",
    "- CHECKLIST DE CIERRE (no termines sin cumplirlo):",
    "  · archivos reales en disco",
    "  · preview inspeccionado",
    "  · sin overflow horizontal",
    "  · contenido visible",
    "  · sin errores graves de consola del preview",
    "- Tipografia expresiva (no Inter/Roboto/Arial/system). Hero full-bleed si es landing.",
    "- Una composicion clara en el primer viewport; evita dashboard generico salvo que el usuario lo pida.",
    "- generate_image solo si el usuario pide imagenes/assets y hay config local; si no, usa CSS/SVG.",
    "- run_parallel_explore / run_subagent implementer (max 5 patches) si acelera; sin APIs de pago.",
    permissionFull
      ? "- Acceso completo: puedes usar MCP bajo demanda y comandos reales."
      : "- Sin acceso completo: respeta restricciones de run_command; prioriza write_file/create_project.",
    "- PROHIBIDO terminar solo narrando. Debe haber archivos reales y preview intentado.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  wantsPolishedUi,
  isLovableOneShotRequest,
  buildLovableOneShotBlock,
};
