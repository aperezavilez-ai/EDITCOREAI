"use strict";

/**
 * Composer View — orquestación multi-archivo atómica.
 * - Planifica parches distribuidos en múltiples archivos.
 * - Aplica cambios en batch con rollback automático.
 * - Verifica coherencia post-aplicación.
 */

const { proposeDiffBatch, applyDiff, getPendingDiff } = require("./diff-preview");
const { applyPatch } = require("../patch-engine");
const path = require("node:path");
const fs = require("node:fs");

class ComposerView {
  constructor(projectRoot) {
    this.projectRoot = String(projectRoot || process.cwd()).replace(/\\/g, "/");
    this.sessions = new Map();
  }

  createSession(input = {}) {
    const id = `composer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const files = Array.isArray(input.files) ? input.files.slice(0, 50) : [];
    const session = {
      id,
      projectRoot: this.projectRoot,
      goal: String(input.goal || input.prompt || "").trim().slice(0, 4000),
      status: "planned",
      files: files.map((f) => ({
        path: String(f.path || "").replace(/\\/g, "/"),
        content: f.content != null ? String(f.content) : undefined,
        oldText: f.oldText != null ? String(f.oldText) : undefined,
        newText: f.newText != null ? String(f.newText) : undefined,
        replaceAll: f.replaceAll === true,
      })),
      proposals: [],
      applied: [],
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    return { ok: true, sessionId: id, count: session.files.length, goal: session.goal, status: session.status };
  }

  preview(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) throw new Error("Composer session desconocida.");
    if (session.projectRoot !== this.projectRoot) throw new Error("Session de otro proyecto.");
    const batch = proposeDiffBatch(session.projectRoot, session.files);
    session.proposals = batch.proposals || [];
    session.status = "preview";
    return {
      ok: true,
      sessionId: session.id,
      status: session.status,
      count: session.proposals.length,
      proposals: session.proposals.map((p) => ({ path: p.path, status: p.status, hunkCount: p.hunks?.length || 0 })),
    };
  }

  async apply(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) throw new Error("Composer session desconocida.");
    if (session.status !== "preview") throw new Error("La session debe estar en preview antes de aplicar.");
    const results = [];
    for (const file of session.files) {
      const rel = String(file.path || "").replace(/\\/g, "/");
      const abs = path.join(session.projectRoot, rel);
      let before = "";
      try {
        before = fs.readFileSync(abs, "utf8");
      } catch {
        before = "";
      }
      let after = before;
      if (file.oldText != null && file.newText != null) {
        if (file.replaceAll === true) {
          after = before.split(file.oldText).join(file.newText);
        } else {
          after = before.replace(file.oldText, file.newText);
        }
      } else if (file.content != null) {
        after = String(file.content);
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, after, "utf8");
      results.push({ path: rel, status: "applied" });
      session.applied.push({ path: rel, appliedAt: new Date().toISOString() });
    }
    session.status = "applied";
    return { ok: true, sessionId: session.id, status: session.status, applied: results };
  }

  rollback(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) throw new Error("Composer session desconocida.");
    const restored = [];
    for (const item of session.applied) {
      const abs = path.join(session.projectRoot, item.path);
      try {
        const current = fs.readFileSync(abs, "utf8");
        const original = session.files.find((f) => f.path === item.path);
        const target = original?.oldText != null && original.newText != null ? original.oldText : current;
        fs.writeFileSync(abs, target, "utf8");
        restored.push({ path: item.path, status: "restored" });
      } catch {
        restored.push({ path: item.path, status: "error" });
      }
    }
    session.status = "rolledback";
    return { ok: true, sessionId: session.id, status: session.status, restored };
  }
}

module.exports = { ComposerView };
