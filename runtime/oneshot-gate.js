"use strict";

/**
 * Checklist local para greenfield one-shot (sin APIs de pago).
 * Evalúa evidencia real de tools ya ejecutadas.
 */

function evaluateOneShotFromSteps(steps = []) {
  const okSteps = (Array.isArray(steps) ? steps : []).filter((step) => step && step.ok !== false);
  const names = new Set(okSteps.map((step) => step.name));
  const hasFiles = okSteps.some((step) => ["write_file", "create_project", "replace_in_file"].includes(step.name));
  const previewSteps = okSteps.filter((step) => ["inspect_preview", "inspect_browser", "browser_interact"].includes(step.name));
  const hasPreview = previewSteps.length > 0;

  let overflow = false;
  let consoleErrors = 0;
  let bodyTooShort = false;
  for (const step of previewSteps) {
    const diag = step.result?.diagnostics || step.result?.dom;
    if (diag?.horizontalOverflow === true) overflow = true;
    if (Number(diag?.bodyTextLength) > 0 && Number(diag.bodyTextLength) < 40) bodyTooShort = true;
    if (Number(diag?.bodyText?.length) > 0 && Number(diag.bodyText.length) < 40) bodyTooShort = true;
    const logs = step.result?.logs || [];
    consoleErrors += logs.filter((row) => String(row.level || "").toLowerCase() === "error").length;
  }

  const hasInstallOrDev = okSteps.some((step) =>
    step.name === "run_command"
    && /\b(npm|pnpm|yarn|bun)\b/i.test(String(step.input?.command || ""))
  );

  const checks = [
    { id: "files", ok: hasFiles, label: "Archivos creados o modificados en disco" },
    { id: "preview", ok: hasPreview, label: "Preview inspeccionado (inspect_* / browser_interact)" },
    { id: "overflow", ok: !hasPreview || !overflow, label: "Sin overflow horizontal evidente" },
    { id: "content", ok: !hasPreview || !bodyTooShort, label: "Contenido visible en el preview" },
    { id: "console", ok: consoleErrors === 0, label: "Sin errores de consola del preview" },
    { id: "deps", ok: hasInstallOrDev || names.has("create_project"), label: "Deps/dev intentados (npm/create_project)" },
  ];
  const missing = checks.filter((item) => !item.ok);
  return {
    ok: missing.length === 0,
    checks,
    missing,
    summary: missing.length
      ? `One-shot incompleto: falta ${missing.map((item) => item.id).join(", ")}.`
      : "One-shot checklist OK.",
  };
}

function buildOneShotGatePrompt(evaluation = {}) {
  if (!evaluation || evaluation.ok) return "";
  const lines = (evaluation.missing || []).map((item) => `- ${item.label}`);
  return [
    "VALIDACION ONE-SHOT EDITCORE:",
    evaluation.summary || "Checklist visual incompleto.",
    "Completa AHORA lo pendiente con herramientas reales:",
    ...lines,
    "- Usa inspect_preview/inspect_browser/browser_interact y corrige UI si hace falta.",
    "- No cierres solo narrando.",
  ].join("\n");
}

module.exports = {
  evaluateOneShotFromSteps,
  buildOneShotGatePrompt,
};
