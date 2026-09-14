"use strict";

/**
 * runtime/session.js — fachada estable de sesión de workspace.
 * Unifica session-state (árbol/mods), memoria de proyecto y helpers de workspace.
 * Evita "No existe: runtime/session.js" / "No hay memoria" cuando el agente pide sesión.
 */

const path = require("node:path");
const sessionState = require("./session-state");

function loadWorkspaceSession(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root) {
    return {
      ok: false,
      error: "projectRoot invalido",
      memory: null,
      state: null,
    };
  }
  const state = sessionState.ensureSessionState(root);
  let projectMemory = null;
  let memoryText = "";
  try {
    const { loadProjectMemory, formatMemoryForPrompt } = require("./project-memory");
    projectMemory = loadProjectMemory(root);
    memoryText = formatMemoryForPrompt(projectMemory, 1_800);
  } catch {
    projectMemory = null;
  }
  let analysisHint = "";
  try {
    const analysisPath = path.join(root, ".editcore", "analysis-memory.json");
    const fs = require("node:fs");
    if (fs.existsSync(analysisPath)) {
      const raw = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      if (raw && typeof raw === "object") {
        analysisHint = String(raw.summary || raw.task || "").slice(0, 400);
      }
    }
  } catch { /* ignore */ }

  const hasMemory = Boolean(
    (state.recentMods && state.recentMods.length)
    || (state.recentReads && state.recentReads.length)
    || (state.fileTree && state.fileTree.length)
    || memoryText
    || analysisHint,
  );

  return {
    ok: true,
    projectRoot: root,
    hasMemory,
    state,
    projectMemory,
    analysisHint,
    promptBlock: [
      sessionState.formatSessionStateForPrompt(root, 2_000),
      memoryText ? `## Memoria de proyecto\n${memoryText}` : "",
      analysisHint ? `## Memoria de analisis\n${analysisHint}` : "",
      hasMemory ? "" : "Memoria: vacia en este workspace (normal en proyecto nuevo). Continua con tools.",
    ].filter(Boolean).join("\n\n"),
  };
}

function rememberWorkspaceEvent(projectRoot, event = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root) return { ok: false, error: "projectRoot invalido" };
  if (event.path || event.filePath) {
    sessionState.recordModification(root, {
      path: event.path || event.filePath,
      action: event.action || "patch",
      summary: event.summary || event.message || "",
    });
  }
  if (event.task || event.nextAction) {
    sessionState.ensureSessionState(root, {
      task: event.task,
      nextAction: event.nextAction,
    });
  }
  try {
    if (event.message || event.type) {
      const { rememberProjectEvent } = require("./project-memory");
      rememberProjectEvent(root, {
        type: event.type || "session",
        message: String(event.message || event.summary || "").slice(0, 400),
      });
    }
  } catch { /* optional */ }
  return { ok: true, ...loadWorkspaceSession(root) };
}

function formatSessionMemoryOrFallback(projectRoot) {
  const loaded = loadWorkspaceSession(projectRoot);
  if (!loaded.ok) return "No hay workspace activo.";
  if (loaded.hasMemory) return loaded.promptBlock;
  return [
    "SESSION: workspace activo sin historial previo.",
    `Raiz: ${loaded.projectRoot}`,
    "No hay memoria de analisis previa. Usa tools (list_files/read_file) y continua; no te detengas.",
  ].join("\n");
}

module.exports = {
  ...sessionState,
  loadWorkspaceSession,
  rememberWorkspaceEvent,
  formatSessionMemoryOrFallback,
  // Alias esperados por consumidores / agente
  getSession: loadWorkspaceSession,
  loadSession: loadWorkspaceSession,
  saveSession: (projectRoot, patch = {}) => sessionState.saveSessionState(projectRoot, {
    ...sessionState.loadSessionState(projectRoot),
    ...patch,
  }),
};
