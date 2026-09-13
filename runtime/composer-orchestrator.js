"use strict";

/**
 * Multi-file Composer orchestrator — plan + proposeDiffBatch + apply.
 */

const path = require("node:path");
const { proposeDiffBatch, applyDiff, getPendingDiff } = require("./diff-preview");
const { applyPatch, generateDiff } = require("../patch-engine");

const composerSessions = new Map();

function createComposerPlan(projectRoot, input = {}) {
  const id = `composer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const files = Array.isArray(input.files) ? input.files : [];
  const goal = String(input.goal || input.prompt || "").trim().slice(0, 2000);
  const session = {
    id,
    projectRoot: String(projectRoot || ""),
    goal,
    status: "planned",
    createdAt: new Date().toISOString(),
    files: files.slice(0, 20).map((f) => ({
      path: String(f.path || "").replace(/\\/g, "/"),
      content: f.content != null ? String(f.content) : undefined,
      oldText: f.oldText != null ? String(f.oldText) : undefined,
      newText: f.newText != null ? String(f.newText) : undefined,
      replaceAll: f.replaceAll === true,
    })),
    proposals: [],
    applied: [],
  };
  composerSessions.set(id, session);
  return { ok: true, sessionId: id, count: session.files.length, goal, status: session.status };
}

function previewComposer(projectRoot, sessionId) {
  const session = composerSessions.get(String(sessionId || ""));
  if (!session) throw new Error("Composer session desconocida.");
  if (path.resolve(session.projectRoot) !== path.resolve(String(projectRoot || ""))) {
    throw new Error("Composer session de otro proyecto.");
  }
  const batch = proposeDiffBatch(session.projectRoot, session.files);
  session.proposals = batch.proposals || [];
  session.status = "preview";
  return {
    ok: true,
    sessionId: session.id,
    status: session.status,
    count: session.proposals.length,
    proposals: session.proposals.map((p) => ({
      proposalId: p.proposalId,
      path: p.path,
      diff: p.diff,
      hunks: p.hunks,
      bytesBefore: p.bytesBefore,
      bytesAfter: p.bytesAfter,
    })),
  };
}

function applyComposer(projectRoot, sessionId, { writeFile } = {}) {
  const session = composerSessions.get(String(sessionId || ""));
  if (!session) throw new Error("Composer session desconocida.");
  if (path.resolve(session.projectRoot) !== path.resolve(String(projectRoot || ""))) {
    throw new Error("Composer session de otro proyecto.");
  }
  if (!session.proposals.length) {
    previewComposer(projectRoot, sessionId);
  }
  const applied = [];
  for (const proposal of session.proposals) {
    if (typeof writeFile === "function") {
      applied.push(applyDiff(projectRoot, { proposalId: proposal.proposalId }, { writeFile }));
    } else {
      const pending = getPendingDiff(proposal.proposalId);
      if (!pending) continue;
      const result = applyPatch(projectRoot, pending.path, pending.before, pending.after, {
        createBackup: true,
        runId: session.id,
      });
      applied.push({ ok: result.ok, path: pending.path, proposalId: proposal.proposalId, ...result });
    }
  }
  session.applied = applied;
  session.status = "applied";
  return { ok: true, sessionId: session.id, status: session.status, applied };
}

function getComposer(sessionId) {
  const session = composerSessions.get(String(sessionId || ""));
  if (!session) return null;
  return {
    id: session.id,
    goal: session.goal,
    status: session.status,
    files: session.files.map((f) => f.path),
    proposals: session.proposals.map((p) => ({ proposalId: p.proposalId, path: p.path })),
    applied: session.applied,
  };
}

function listComposerSessions(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  return [...composerSessions.values()]
    .filter((s) => path.resolve(s.projectRoot) === root)
    .map((s) => getComposer(s.id));
}

module.exports = {
  createComposerPlan,
  previewComposer,
  applyComposer,
  getComposer,
  listComposerSessions,
  generateDiff,
};
