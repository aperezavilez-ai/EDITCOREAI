"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
}

function unique(values = [], limit = 20) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

function relevantFiles(steps = [], rootFiles = []) {
  const fromSteps = steps.flatMap((step) => [step?.input?.path, ...(step?.changedFiles || [])]);
  return unique([...fromSteps, ...rootFiles.slice(0, 8).map((entry) => entry.path || entry.name)], 16);
}

function createContextManifest(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const last = steps.at(-1) || null;
  const errors = steps.filter((step) => step?.ok === false || step?.result?.error).slice(-4);
  const manifest = {
    TASK_ID: String(input.taskId || input.runId || ""),
    RUN_ID: String(input.runId || ""),
    PROJECT_ID: String(input.projectId || path.basename(String(input.projectRoot || "")) || ""),
    STAGE: String(input.stage || "discovery"),
    CONTEXT_LEVEL: Number(input.contextLevel) || 0,
    GOAL: String(input.goal || "").slice(0, 1200),
    REQUEST_REF: String(input.taskRef || ""),
    CURRENT_STEP: last ? { index: steps.length, tool: last.name, ok: last.ok !== false } : null,
    NEXT_ACTION: String(input.nextAction || "Seleccionar y ejecutar la siguiente accion comprobable.").slice(0, 500),
    RELEVANT_FILES: relevantFiles(steps, input.rootFiles || []),
    RELEVANT_SYMBOLS: unique(input.symbols || [], 20),
    DEPENDENCIES: unique(input.dependencies || [], 20),
    OPEN_ISSUES: errors.map((step) => String(step?.result?.error || `${step?.name || "accion"} fallo`).slice(0, 400)),
    LAST_TOOL: last?.name || "",
    LAST_RESULT_REFERENCE: last?.contextRef || input.lastResultRef || "",
    LAST_CHECKPOINT: String(input.lastCheckpoint || ""),
    VERIFICATION_STATUS: String(input.verificationStatus || "pending"),
    ERROR_STATE: errors.length ? "open" : "clear",
    REASONING_STATE_SUMMARY: String(input.reasoningSummary || "Sin razonamiento oculto; continuar desde evidencia y estado registrados.").slice(0, 800),
    BRAIN_REF: String(input.brainRef || ""),
    BRAIN_SUMMARY: String(input.brainSummary || "").slice(0, 1000),
    BRAIN_RELEVANCE: String(input.brainRelevance || (input.brainRef ? "available_on_demand" : "none")),
    HISTORY_REF: String(input.historyRef || ""),
    DOCUMENT_REF: String(input.documentRef || ""),
    TOOL_CATALOG: input.toolCatalog || [],
    SELECTED_TOOLS: input.selectedTools || [],
    PLAN_REF: String(input.planReference || ""),
    CODEBASE_MAP_REF: String(input.codebaseMapReference || ""),
    DISCOVERY_REF: String(input.discoveryReference || ""),
  };
  return { ...manifest, CONTEXT_HASH: digest(manifest) };
}

function serializeContextManifest(manifest) {
  return `CONTEXT_MANIFEST\n${JSON.stringify(manifest)}`;
}

module.exports = { createContextManifest, digest, relevantFiles, serializeContextManifest };
