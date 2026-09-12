"use strict";

/**
 * Checkpoint Git aditivo (no muta el worktree al crear).
 * Si no hay repo git o falla → skipped:true y el flujo sigue como antes.
 */

const fs = require("node:fs");
const path = require("node:path");
const { runGit } = require("./agent-git");

function isGitRepo(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  if (!root) return false;
  try {
    runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, head?: string, stashHash?: string, runId?: string, at?: string }}
 */
function createMutationCheckpoint(projectRoot = "", { runId = "", label = "" } = {}) {
  const root = String(projectRoot || "").trim();
  if (!root || !fs.existsSync(root)) {
    return { ok: true, skipped: true, reason: "project-missing" };
  }
  if (!isGitRepo(root)) {
    return { ok: true, skipped: true, reason: "no-git" };
  }
  try {
    let head = "";
    try {
      head = runGit(root, ["rev-parse", "HEAD"]).stdout || "";
    } catch {
      head = "";
    }
    const tag = String(label || `editcore-${runId || Date.now()}`).slice(0, 80);
    let stashHash = "";
    try {
      // No modifica el worktree; solo crea un objeto stash.
      stashHash = runGit(root, ["stash", "create", tag]).stdout || "";
    } catch {
      stashHash = "";
    }
    return {
      ok: true,
      skipped: false,
      head,
      stashHash,
      runId: String(runId || ""),
      at: new Date().toISOString(),
      label: tag,
    };
  } catch (error) {
    return { ok: true, skipped: true, reason: String(error?.message || error).slice(0, 200) };
  }
}

/**
 * Revierte el worktree al estado previo a la ráfaga del agente.
 * Preferible combinar con restoreLastAgentRun (backups por archivo).
 */
function rollbackMutationCheckpoint(projectRoot = "", checkpoint = null) {
  const root = String(projectRoot || "").trim();
  if (!root || !checkpoint || checkpoint.skipped || (!checkpoint.stashHash && !checkpoint.head)) {
    return { ok: false, skipped: true, reason: "no-checkpoint" };
  }
  if (!isGitRepo(root)) {
    return { ok: false, skipped: true, reason: "no-git" };
  }
  try {
    // Quita cambios tracked del agente (y dirty intermedio) → HEAD limpio.
    runGit(root, ["reset", "--hard", "HEAD"]);
    if (checkpoint.stashHash) {
      // Restaura el estado previo a la ráfaga (incluye dirty del usuario).
      runGit(root, ["stash", "apply", String(checkpoint.stashHash)]);
    }
    return {
      ok: true,
      skipped: false,
      head: checkpoint.head || "",
      stashHash: checkpoint.stashHash || "",
      restoredAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, skipped: false, error: String(error?.message || error).slice(0, 400) };
  }
}

function checkpointStatePath(projectRoot = "") {
  return path.join(String(projectRoot || ""), ".editcore", "mutation-checkpoint.json");
}

function persistMutationCheckpoint(projectRoot, checkpoint) {
  const root = String(projectRoot || "").trim();
  if (!root || !checkpoint || checkpoint.skipped) return null;
  try {
    const dir = path.join(root, ".editcore");
    fs.mkdirSync(dir, { recursive: true });
    const file = checkpointStatePath(root);
    fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2), "utf8");
    return file;
  } catch {
    return null;
  }
}

function readPersistedMutationCheckpoint(projectRoot) {
  try {
    const file = checkpointStatePath(projectRoot);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  isGitRepo,
  createMutationCheckpoint,
  rollbackMutationCheckpoint,
  persistMutationCheckpoint,
  readPersistedMutationCheckpoint,
  checkpointStatePath,
};
