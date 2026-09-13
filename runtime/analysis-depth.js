"use strict";

/**
 * Profundidad de analisis/accion EDITCOREAI.
 * El pedido del usuario decide umbral de evidencia, iteraciones y tono del reporte.
 */

const DEPTHS = Object.freeze({
  SURFACE: "surface",
  STANDARD: "standard",
  DEEP: "deep",
  SURGICAL: "surgical",
  FORENSIC: "forensic",
  EXHAUSTIVE: "exhaustive",
});

const DEPTH_LABELS = Object.freeze({
  [DEPTHS.SURFACE]: "Analisis superficial",
  [DEPTHS.STANDARD]: "Analisis estandar",
  [DEPTHS.DEEP]: "Analisis profundo",
  [DEPTHS.SURGICAL]: "Analisis quirurgico",
  [DEPTHS.FORENSIC]: "Analisis de causa raiz",
  [DEPTHS.EXHAUSTIVE]: "Analisis exhaustivo",
});

/**
 * @param {string} prompt
 * @returns {{
 *   depth: string,
 *   label: string,
 *   minimumEvidence: number,
 *   minCodeReads: number,
 *   minSearches: number,
 *   minListedDirs: number,
 *   maxIterations: number,
 *   tokenBudget: number,
 *   ignoreRoadmap: boolean,
 *   requireLineEvidence: boolean,
 *   requireRootCause: boolean,
 *   orchestrationHint: string,
 * }}
 */
function resolveAnalysisDepth(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) {
    return buildDepthProfile(DEPTHS.STANDARD);
  }

  // FOCO acotado gana sobre forense/exhaustivo: RETIRADO.
  // resolveInstructionConstraints ya no activa scoped; profundidad normal.

  if (/\b(?:forense|forensic|MODO:\s*DIAGN|NO\s+MODIFICAR|cadena\s+causal|root\s*cause|evidencia\s+linea\s+a\s+linea)\b/i.test(text)) {
    return buildDepthProfile(DEPTHS.FORENSIC);
  }
  if (/\b(?:exhaustiv[oa]|integral|todo\s+el\s+proyecto|completo|completamente|a\s+fondo|sin\s+dejar\s+nada|carpeta\s+por\s+carpeta|archivo\s+por\s+archivo|funcion\s+por\s+funcion|sin\s+omitir)\b/i.test(text)) {
    return buildDepthProfile(DEPTHS.EXHAUSTIVE);
  }
  if (/\b(?:quir[uú]rgic[oa]|surgical|punto\s+exacto|defect[oa]\s+exacto)\b/i.test(text)) {
    return buildDepthProfile(DEPTHS.SURGICAL);
  }
  if (/\b(?:profund[oa]|deep\s+dive|entra[nñ]as|a\s+fondo|hallazgos\s+completos?|reporte\s+completo)\b/i.test(text)
    || (/\b(?:analiz(?:a|ame|ar)|audita|diagnostica)\b/i.test(text)
      && /\b(?:proyecto|hallazgos|errores|reporte|codigo|c[oó]digo)\b/i.test(text))) {
    return buildDepthProfile(DEPTHS.DEEP);
  }
  if (/\b(?:rapido|r[aá]pido|superfic|overview|solo\s+mira|vistazo|resumen\s+corto)\b/i.test(text)) {
    return buildDepthProfile(DEPTHS.SURFACE);
  }
  if (/\b(?:analiz|audita|diagnost|revisa|explora|inspecciona|reporte|hallazgos)\b/i.test(text)) {
    return buildDepthProfile(DEPTHS.STANDARD);
  }
  return buildDepthProfile(DEPTHS.STANDARD);
}

function buildDepthProfile(depth) {
  const profiles = {
    [DEPTHS.SURFACE]: {
      minimumEvidence: 3,
      minCodeReads: 3,
      minSearches: 0,
      minListedDirs: 1,
      maxIterations: 8,
      tokenBudget: 60_000,
      ignoreRoadmap: true,
      requireLineEvidence: false,
      requireRootCause: false,
      orchestrationHint: "Analisis SUPERFICIAL: panorama rapido. 3-5 archivos clave. No abras todo el arbol.",
    },
    [DEPTHS.STANDARD]: {
      minimumEvidence: 6,
      minCodeReads: 6,
      minSearches: 1,
      minListedDirs: 2,
      maxIterations: 16,
      tokenBudget: 120_000,
      ignoreRoadmap: true,
      requireLineEvidence: false,
      requireRootCause: false,
      orchestrationHint: "Analisis ESTANDAR: package.json + src/api principales + 1 busqueda. Reporte con hallazgos anclados.",
    },
    [DEPTHS.DEEP]: {
      minimumEvidence: 14,
      minCodeReads: 12,
      minSearches: 2,
      minListedDirs: 5,
      maxWalkDirs: 14,
      maxIterations: 28,
      tokenBudget: 220_000,
      ignoreRoadmap: true,
      requireLineEvidence: true,
      requireRootCause: false,
      folderByFolder: true,
      orchestrationHint: "Analisis PROFUNDO: carpeta por carpeta (src/api/app/android/ios). Archivo por archivo en codigo critico. Hallazgos desde codigo; EDITCOREAI actualiza ROADMAP.md como indice.",
    },
    [DEPTHS.SURGICAL]: {
      minimumEvidence: 10,
      minCodeReads: 8,
      minSearches: 3,
      minListedDirs: 4,
      maxWalkDirs: 12,
      maxIterations: 24,
      tokenBudget: 180_000,
      ignoreRoadmap: true,
      requireLineEvidence: true,
      requireRootCause: true,
      folderByFolder: true,
      orchestrationHint: "Analisis QUIRURGICO: defecto exacto (archivo+funcion+linea). Cada hallazgo con causa puntual y solucion concreta.",
    },
    [DEPTHS.FORENSIC]: {
      minimumEvidence: 16,
      minCodeReads: 16,
      minSearches: 3,
      minListedDirs: 6,
      maxWalkDirs: 18,
      maxIterations: 36,
      tokenBudget: 260_000,
      ignoreRoadmap: true,
      requireLineEvidence: true,
      requireRootCause: true,
      folderByFolder: true,
      orchestrationHint: "Analisis DE CAUSA RAIZ: walker carpeta por carpeta hasta cobertura minima. Cadena causal, extractos, sin inventar. NO MODIFICAR.",
    },
    [DEPTHS.EXHAUSTIVE]: {
      minimumEvidence: 20,
      minCodeReads: 20,
      minSearches: 4,
      minListedDirs: 8,
      maxWalkDirs: 24,
      maxIterations: 40,
      tokenBudget: 300_000,
      ignoreRoadmap: true,
      requireLineEvidence: true,
      requireRootCause: true,
      folderByFolder: true,
      orchestrationHint: "Analisis EXHAUSTIVO: carpeta por carpeta + archivo por archivo en modulos clave. Cubre funcionalidad, viabilidad, errores y soluciones.",
    },
  };
  const base = profiles[depth] || profiles[DEPTHS.STANDARD];
  const reportSections = [
    "## Profundidad detectada",
    "## Mapa carpeta por carpeta",
    "## Funcionalidad (que hace / que deberia hacer)",
    "## Viabilidad (stack, deps, build/runtime)",
    "## Qué sí funcionó",
    "## Qué falló / errores",
    "## Qué falta para que funcione",
    "## Evidencia (paths + simbolos)",
    "## Soluciones / Cómo lo corregiré",
  ];
  return {
    depth,
    label: DEPTH_LABELS[depth] || DEPTH_LABELS[DEPTHS.STANDARD],
    folderByFolder: false,
    reportSections,
    ...base,
  };
}

/** Bloque de instrucciones de reporte completo segun profundidad. */
function buildDepthReportGuide(depthProfile = {}) {
  const label = depthProfile.label || "Analisis estandar";
  if (depthProfile.scopedFocus === true) {
    // FOCO retirado: tratar como profundidad normal.
  }
  const sections = Array.isArray(depthProfile.reportSections) && depthProfile.reportSections.length
    ? depthProfile.reportSections
    : [
      "## Qué sí funcionó",
      "## Qué falló / hallazgos",
      "## Qué falta para que funcione",
      "## Evidencia",
      "## Cómo lo corregiré",
    ];
  const nextOptionsCloser = depthProfile.skipAuthCloser === true
    || depthProfile.fullAccess === true
    || depthProfile.nextOptionsCloser === true;
  const closer = nextOptionsCloser
    ? [
      "CIERRE (Acceso completo / sin puerta PROCEDE):",
      "1) Resume hallazgos en 3-6 lineas claras.",
      "2) Aplica YA las correcciones comprobables con write_file/replace_in_file (Acceso completo ya autoriza).",
      "3) Si no hay correcciones comprobables, dilo y cierra.",
      "PROHIBIDO: 'Cuando autorices procedo', 'Escribe procede', '¿Procedo?', 'elige una opcion'.",
    ].join("\n")
    : "Si HAY correcciones comprobables: ultima linea exacta `Cuando autorices procedo con las correcciones.` Si NO hay: `Sin correcciones comprobables pendientes. No se solicita PROCEDE.`";
  return [
    `PROFUNDIDAD DETECTADA: ${label} (${depthProfile.depth || "standard"}).`,
    depthProfile.orchestrationHint || "",
    "METODO SERIAL (estilo Cursor, obligatorio):",
    "1) UNA sola herramienta por turno (list_files O read_file O search_files).",
    "2) Tras cada tool, escribe en el chat 3-8 lineas de avance: que miraste y que encontraste.",
    "3) Luego la siguiente tool. PROHIBIDO planear 'leer los 8 archivos' de golpe o saturar el contexto.",
    "4) Hallazgos SOLO desde codigo fuente del producto, 100% comprobable con read_file/list_files/search_files.",
    "4b) PROHIBIDO inventar bugs. PROHIBIDO proponer correcciones sobre workbox/sw.minificado/vendor/bundles generados.",
    "4c) Si no hay defecto comprobable: dilo claro y NO pidas PROCEDE inventado.",
    "5) ROADMAP.md: EDITCOREAI lo actualiza solo (indice compacto / tokens). TU no lo reescribas con write_file en analisis.",
    "6) Orden: list raiz → package.json → carpeta clave → archivo critico → siguiente.",
    depthProfile.folderByFolder
      ? "7) Cobertura minima antes del reporte FINAL."
      : "7) Lee archivos clave con evidencia real antes del reporte FINAL.",
    "El reporte FINAL (solo al cerrar) debe cubrir: funcionalidad, viabilidad, errores, gaps, soluciones y evidencia. Secciones:",
    ...sections.map((s) => `- ${s}`),
    "- En \"Qué falta para que funcione\": SOLO gaps leidos del disco (package.json, .env.example). Sin inventar Docker/workers si no hay evidencia.",
    "- Tras las secciones: recomienda SOLO correcciones con path+evidencia real; si no hay, no inventes.",
    closer,
  ].filter(Boolean).join("\n");
}

function isDeepOrHeavier(depth = "") {
  return [DEPTHS.DEEP, DEPTHS.SURGICAL, DEPTHS.FORENSIC, DEPTHS.EXHAUSTIVE].includes(String(depth || ""));
}

/**
 * Tope duro de corrida (ms). Analisis forense/profundo con Opus supera 4 min;
 * no volver a 25 min ni a 120 loops.
 */
function resolveRunDeadlineMs({ analysisMode = false, prompt = "" } = {}) {
  if (!analysisMode) return 480_000; // 8 min escritura
  const profile = resolveAnalysisDepth(prompt);
  if (profile.depth === DEPTHS.FORENSIC || profile.depth === DEPTHS.EXHAUSTIVE) {
    return 900_000; // 15 min
  }
  if (isDeepOrHeavier(profile.depth)) {
    return 720_000; // 12 min
  }
  return 360_000; // 6 min analisis estandar
}

module.exports = {
  DEPTHS,
  DEPTH_LABELS,
  resolveAnalysisDepth,
  buildDepthProfile,
  buildDepthReportGuide,
  isDeepOrHeavier,
  resolveRunDeadlineMs,
};
