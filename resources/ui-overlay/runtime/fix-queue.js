"use strict";

/**
 * Cola durable de correcciones: 1 hallazgo → mutacion → verify → siguiente.
 * Se persiste en el plan (task-store) y se inyecta en PROCEDE.
 */

function normalizeTarget(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .trim();
}

function basenameOf(value = "") {
  return normalizeTarget(value).split("/").filter(Boolean).pop() || "";
}

function isJunkTarget(value = "") {
  const p = normalizeTarget(value);
  if (!p) return true;
  if (/\.claude\//i.test(p) && /\.md$/i.test(p)) return true;
  if (/ANALISIS_ERRORES/i.test(p)) return true;
  if (/(^|\/)ROADMAP(\/|$)/i.test(p) || /(^|\/)ROADMAP\.md$/i.test(p)) return true;
  if (/(^|\/)(?:REPORTE|CORRECCIONES)-/i.test(p) && /\.md$/i.test(p)) return true;
  // Vendor / PWA generada: nunca FOCO de PROCEDE.
  if (/(^|\/)workbox[^/]*\.js$/i.test(p) || /workbox-/i.test(p)) return true;
  if (/(^|\/)sw\.js$/i.test(p) && /(^|\/)public\//i.test(p)) return true;
  if (/\.min\.(js|css|mjs|cjs)$/i.test(p)) return true;
  if (/(^|\/)next-env\.d\.ts$/i.test(p)) return true;
  if (/(^|\/)public\/.*-[a-f0-9]{6,}\.(js|css)$/i.test(p)) return true;
  if (/(^|\/)(vendor|third[_-]?party|generated|__generated__)\//i.test(p)) return true;
  return false;
}

function looksLikeCodePath(value = "") {
  const p = normalizeTarget(value);
  if (!p || isJunkTarget(p)) return false;
  return /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|swift|cs|php)$/i.test(p)
    || /(^|\/)(package\.json|tsconfig[^/]*\.json|.*\.config\.(js|ts|mjs|cjs))$/i.test(p);
}

function extractPathsFromLine(line = "") {
  const raw = String(line || "");
  const out = [];
  const patterns = [
    /`([^`]+\.[A-Za-z0-9]{1,10})`/g,
    /\b((?:src|app|apps|api|lib|components|pages|runtime|resources)(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,10})\b/gi,
    /\b((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,10})\b/g,
  ];
  for (const re of patterns) {
    for (const match of raw.matchAll(re)) {
      const value = normalizeTarget(match[1] || "");
      if (looksLikeCodePath(value)) out.push(value);
    }
  }
  return out;
}

function queueItem(partial = {}, index = 0) {
  const target = normalizeTarget(partial.target || "");
  return {
    id: String(partial.id || `fix-${index + 1}`),
    index: index + 1,
    target,
    action: String(partial.action || (target ? `Corregir ${target}` : "Corregir hallazgo")).slice(0, 400),
    evidence: String(partial.evidence || "").slice(0, 300),
    status: ["pending", "in_progress", "mutated", "verified", "skipped"].includes(partial.status)
      ? partial.status
      : "pending",
    note: String(partial.note || "").slice(0, 240),
  };
}

/**
 * Construye cola desde hallazgos de evidencia + seccion "Como lo corregire" del reporte.
 */
function buildFixQueueFromReport(report = "", evidence = {}, options = {}) {
  const items = [];
  const seen = new Set();
  const push = (target, meta = {}) => {
    const norm = normalizeTarget(target);
    if (!looksLikeCodePath(norm) || seen.has(norm.toLowerCase())) return;
    seen.add(norm.toLowerCase());
    items.push(queueItem({
      target: norm,
      action: meta.action || `Corregir ${norm} con replace_in_file`,
      evidence: meta.evidence || "",
      status: "pending",
    }, items.length));
  };

  for (const finding of evidence.findings || []) {
    if (finding?.path && !isJunkTarget(finding.path)) {
      push(finding.path, {
        action: `Corregir ${finding.path}: ${finding.label || "hallazgo"}`,
        evidence: finding.source === "typecheck" ? "typecheck" : `read_file(${finding.path})`,
      });
    }
  }

  const reportText = String(report || "");
  const planSection = reportText.match(/##\s*C[oó]mo\s+lo\s+corregir[\s\S]*?(?=\n##\s|\nCuando autorices|$)/i)?.[0]
    || reportText.match(/##\s*Recomendaciones[\s\S]*?(?=\n##\s|\nCuando autorices|$)/i)?.[0]
    || "";
  for (const line of planSection.split(/\n/)) {
    if (!/^\s*\d+[\.)]|^-\s|\*\*|corregir|replace_in_file|arreglar/i.test(line)) continue;
    for (const filePath of extractPathsFromLine(line)) {
      push(filePath, { action: line.replace(/^\s*\d+[\.)]\s*/, "").trim().slice(0, 400), evidence: "plan" });
    }
  }

  if (!items.length) {
    for (const filePath of extractPathsFromLine(reportText)) {
      push(filePath, { action: `Revisar y corregir ${filePath}`, evidence: "report" });
    }
  }

  const maxItems = Math.max(1, Math.min(20, Number(options.maxItems) || 12));
  return items.slice(0, maxItems);
}

function syncFixQueueWithSteps(queue = [], steps = [], projectRoot = "") {
  const list = (Array.isArray(queue) ? queue : []).map((item, index) => queueItem(item, index));
  const mutations = (steps || []).filter((step) => {
    const name = String(step?.name || "");
    return ["write_file", "replace_in_file", "apply_diff", "delete_file"].includes(name)
      && step?.ok !== false
      && !step?.result?.error;
  });
  const mutationPaths = new Set(
    mutations.map((step) => normalizeTarget(step.input?.path || step.result?.path || "").toLowerCase())
      .filter(Boolean),
  );
  const mutationBases = new Set([...mutationPaths].map((p) => basenameOf(p).toLowerCase()));

  const verifiedPaths = new Set();
  let sawCommandVerify = false;
  for (const step of steps || []) {
    if (step?.ok === false) continue;
    if (step.name === "run_command") {
      sawCommandVerify = true;
      continue;
    }
    if (step.name === "read_file") {
      const p = normalizeTarget(step.input?.path || "").toLowerCase();
      if (p) verifiedPaths.add(p);
    }
  }

  for (const item of list) {
    const key = item.target.toLowerCase();
    const base = basenameOf(item.target).toLowerCase();
    const mutated = mutationPaths.has(key) || mutationBases.has(base);
    const verified = mutated && (
      verifiedPaths.has(key)
      || verifiedPaths.has(base)
      || sawCommandVerify
    );
    if (verified) {
      item.status = "verified";
    } else if (mutated) {
      item.status = "mutated";
    } else if (item.status === "in_progress") {
      /* keep */
    } else if (item.status !== "skipped") {
      item.status = "pending";
    }
  }

  const current = list.find((item) => item.status === "in_progress")
    || list.find((item) => item.status === "mutated")
    || list.find((item) => item.status === "pending")
    || null;
  if (current && current.status === "pending") current.status = "in_progress";

  const verifiedCount = list.filter((item) => item.status === "verified").length;
  const remaining = list.filter((item) => !["verified", "skipped"].includes(item.status));
  return {
    queue: list,
    current,
    verifiedCount,
    remainingCount: remaining.length,
    done: list.length === 0 || remaining.length === 0,
    summary: list.length
      ? `Cola fixes: ${verifiedCount}/${list.length} verificados; foco: ${current?.target || "ninguno"}`
      : "Cola fixes: vacia",
  };
}

function formatFixQueueBlock(queue = [], options = {}) {
  const hasSteps = Array.isArray(options.steps) && options.steps.length > 0;
  const synced = hasSteps
    ? syncFixQueueWithSteps(queue, options.steps, options.projectRoot || "")
    : (() => {
      const list = (Array.isArray(queue) ? queue : []).map((item, index) => queueItem(item, index));
      const current = list.find((item) => item.status === "in_progress")
        || list.find((item) => item.status === "mutated")
        || list.find((item) => item.status === "pending")
        || null;
      if (current && current.status === "pending") current.status = "in_progress";
      const verifiedCount = list.filter((item) => item.status === "verified").length;
      const remaining = list.filter((item) => !["verified", "skipped"].includes(item.status));
      return {
        queue: list,
        current,
        verifiedCount,
        remainingCount: remaining.length,
        done: list.length === 0 || remaining.length === 0,
        summary: list.length
          ? `Cola fixes: ${verifiedCount}/${list.length} verificados; foco: ${current?.target || "ninguno"}`
          : "Cola fixes: vacia",
      };
    })();
  const lines = [
    "FIX_QUEUE_DURABLE",
    synced.summary,
  ];
  if (options.focusOnly && synced.current) {
    lines.push(
      `FOCO OBLIGATORIO: ${synced.current.target}`,
      `Archivo actual de la cola: ${synced.current.target}`,
      `Accion: ${synced.current.action}`,
      synced.current.evidence ? `Evidencia: ${synced.current.evidence}` : "",
      "1) read_file del archivo actual",
      "2) replace_in_file/write_file en ese archivo",
      "3) read_file o typecheck de verificacion",
      "4) NO pases al siguiente hasta verificar este.",
      "PROHIBIDO declarar 'listo' con items pending/mutated.",
    );
  } else {
    for (const item of synced.queue) {
      lines.push(`${item.index}. [${item.status}] ${item.target} — ${item.action}`);
    }
    if (synced.current) {
      lines.push(`Siguiente en cola: ${synced.current.target}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function buildFixQueueExecutionPrompt(queue = [], report = "", options = {}) {
  const synced = syncFixQueueWithSteps(queue, options.steps || [], options.projectRoot || "");
  const block = formatFixQueueBlock(synced.queue, { ...options, focusOnly: true, steps: options.steps });
  return [
    "DISPATCHER DE COLA — COLA DE CORRECCIONES (obligatorio):",
    block,
    synced.done
      ? "Cola completa: cierra con ## Evidencia de correccion (archivos + verificaciones)."
      : "Trabaja el archivo actual. Cuando este verificado, el runtime avanzara al siguiente.",
    report ? `PLAN DE REFERENCIA (no re-analizar):\n${String(report).slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n\n");
}

module.exports = {
  buildFixQueueFromReport,
  syncFixQueueWithSteps,
  formatFixQueueBlock,
  buildFixQueueExecutionPrompt,
  normalizeTarget,
  looksLikeCodePath,
  isJunkTarget,
  queueItem,
};
