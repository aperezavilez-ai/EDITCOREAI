"use strict";

/**
 * Harness de tokens del agente: cache-first, recorte de resultados,
 * compactacion agresiva y cierre temprano cuando el presupuesto se agota.
 */

function resolveHarnessProfile(depthProfile = {}, budget = null, options = {}) {
  const strategy = typeof budget?.getStrategy === "function" ? budget.getStrategy() : "full";
  const depth = String(depthProfile.depth || "standard");
  const deep = ["deep", "surgical", "forensic", "exhaustive"].includes(depth);
  const analysisMode = options.analysisMode === true;

  const conversation = {
    full: { maxChars: deep ? 96_000 : 80_000, keepLastTurns: deep ? 6 : 8 },
    moderate: { maxChars: 64_000, keepLastTurns: 5 },
    minimal: { maxChars: 40_000, keepLastTurns: 4 },
    emergency: { maxChars: 24_000, keepLastTurns: 3 },
  }[strategy] || { maxChars: 80_000, keepLastTurns: 6 };

  // Analisis serial: compactar antes para no quemar tokens con tool dumps.
  if (analysisMode) {
    conversation.maxChars = Math.min(conversation.maxChars, deep ? 56_000 : 48_000);
    conversation.keepLastTurns = Math.min(conversation.keepLastTurns, 4);
  }

  const toolResultChars = {
    full: deep ? 8_000 : 10_000,
    moderate: 5_000,
    minimal: 2_500,
    emergency: 1_200,
  }[strategy] || 8_000;

  return {
    strategy,
    depth,
    deep,
    analysisMode,
    conversation,
    toolResultChars: analysisMode ? Math.min(toolResultChars, 4_000) : toolResultChars,
    forceReport: strategy === "emergency" || (strategy === "minimal" && deep),
    allowNewSearch: strategy === "full" || strategy === "moderate",
    allowBrain: strategy === "full",
    preferCache: true,
    maxParallelReads: analysisMode ? 1 : (strategy === "full" ? 6 : strategy === "moderate" ? 4 : 2),
  };
}

function clipToolResultForHarness(result, maxChars = 8_000) {
  const limit = Math.max(800, Number(maxChars) || 8_000);
  if (result == null) return result;
  if (typeof result === "string") {
    return result.length > limit ? `${result.slice(0, limit)}\n…[recortado por harness de tokens]` : result;
  }
  if (typeof result !== "object") return result;
  try {
    const clone = JSON.parse(JSON.stringify(result));
    const clipString = (value) => {
      if (typeof value !== "string") return value;
      return value.length > limit ? `${value.slice(0, limit)}\n…[recortado por harness de tokens]` : value;
    };
    if (typeof clone.content === "string") clone.content = clipString(clone.content);
    if (typeof clone.text === "string") clone.text = clipString(clone.text);
    if (typeof clone.snippet === "string") clone.snippet = clipString(clone.snippet);
    if (Array.isArray(clone.entries) && clone.entries.length > 80) {
      clone.entries = clone.entries.slice(0, 80);
      clone._truncated = true;
    }
    if (Array.isArray(clone.matches) && clone.matches.length > 40) {
      clone.matches = clone.matches.slice(0, 40);
      clone._truncated = true;
    }
    const encoded = JSON.stringify(clone);
    if (encoded.length <= limit * 2) return clone;
    return {
      ok: clone.ok !== false,
      path: clone.path || null,
      truncated: true,
      preview: encoded.slice(0, limit),
      note: "Resultado compactado por harness de tokens para preservar presupuesto.",
    };
  } catch {
    return { truncated: true, note: "No se pudo serializar el resultado; harness omitio el cuerpo." };
  }
}

function buildHarnessSystemNudge(harness = {}) {
  if (!harness || harness.strategy === "full") return "";
  if (harness.forceReport) {
    return "HARNESS TOKENS (CRITICO): presupuesto casi agotado. NO abras mas carpetas. Escribe YA el reporte final con la evidencia acumulada.";
  }
  if (harness.strategy === "minimal") {
    return "HARNESS TOKENS: modo minimal. Solo read_file de paths criticos ya listados. Preferir resultados en cache. Prepara el reporte pronto.";
  }
  if (harness.strategy === "moderate") {
    return "HARNESS TOKENS: modo moderate. Evita releer archivos. Usa cache. Busquedas acotadas. No pegues codigo largo.";
  }
  return "";
}

module.exports = {
  resolveHarnessProfile,
  clipToolResultForHarness,
  buildHarnessSystemNudge,
};
