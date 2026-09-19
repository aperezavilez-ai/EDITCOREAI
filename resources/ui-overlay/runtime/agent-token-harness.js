"use strict";

/**
 * Harness de tokens + cache local de lecturas (por corrida).
 * Reduce reenvío de archivos al modelo y recorta tool results.
 */

function resolveHarnessProfile(depthProfile = {}, budget = null, options = {}) {
  const analysisMode = options.analysisMode === true;
  const remaining = budget && typeof budget.remainingRatio === "function"
    ? budget.remainingRatio()
    : 1;
  let strategy = "full";
  if (remaining < 0.18) strategy = "minimal";
  else if (remaining < 0.4) strategy = "moderate";
  else if (analysisMode) strategy = "moderate";

  return {
    strategy,
    forceReport: remaining < 0.12,
    maxToolResultChars: strategy === "minimal" ? 2500 : strategy === "moderate" ? 6000 : 12000,
    maxParallelReads: analysisMode ? 1 : (strategy === "full" ? 6 : strategy === "moderate" ? 4 : 2),
    preferCache: strategy !== "full",
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

/**
 * Cache de lecturas por path dentro de una corrida de agente.
 * Key: path normalizado + mtime si se conoce.
 */
class RunReadCache {
  constructor() {
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  normalize(pathValue) {
    return String(pathValue || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  }

  get(pathValue, mtimeMs = null) {
    const key = this.normalize(pathValue);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (mtimeMs != null && entry.mtimeMs != null && Number(mtimeMs) !== Number(entry.mtimeMs)) {
      this.misses += 1;
      this.map.delete(key);
      return null;
    }
    this.hits += 1;
    return entry.result;
  }

  set(pathValue, result, mtimeMs = null) {
    const key = this.normalize(pathValue);
    this.map.set(key, {
      result,
      mtimeMs: mtimeMs == null ? null : Number(mtimeMs),
      at: Date.now(),
    });
  }

  stats() {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}

module.exports = {
  resolveHarnessProfile,
  clipToolResultForHarness,
  buildHarnessSystemNudge,
  RunReadCache,
};
