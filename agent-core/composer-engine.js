"use strict";

const path = require("path");
const fs = require("fs");
const { generateDiff, applyPatch } = require("../patch-engine");

class ComposerEngine {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.sessions = new Map();
  }

  /**
   * Crea una sesión de Composer con un objetivo y plan desglosado
   */
  createSession({ goal = "", tasks = [], files = [] } = {}) {
    const sessionId = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const formattedTasks = tasks.map((t, idx) => ({
      id: `task_${idx + 1}`,
      title: typeof t === "string" ? t : t.title || `Paso ${idx + 1}`,
      status: "pending", // pending | in_progress | completed | failed
      targetFiles: Array.isArray(t.targetFiles) ? t.targetFiles : [],
      subagent: t.subagent || "general", // ui_builder | test_runner | backend | general
      result: null,
    }));

    const session = {
      id: sessionId,
      goal,
      status: "initialized", // initialized | executing | completed | rolled_back | error
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: formattedTasks,
      plannedFiles: files,
      stagedChanges: new Map(), // filePath -> { original, modified, diff, hunks }
      appliedBackups: new Map(), // filePath -> original content
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Prepara un cambio propuesto para un archivo dentro de la sesión
   */
  stageFileChange(sessionId, filePath, newContent) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Sesión no encontrada: ${sessionId}`);

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);
    const relPath = path.relative(this.projectRoot, absPath).replace(/\\/g, "/");

    let originalContent = "";
    if (fs.existsSync(absPath)) {
      originalContent = fs.readFileSync(absPath, "utf8");
    }

    const diff = generateDiff(relPath, originalContent, newContent);

    const changeRecord = {
      filePath: relPath,
      absolutePath: absPath,
      originalContent,
      newContent,
      diff,
      stagedAt: Date.now(),
    };

    session.stagedChanges.set(relPath, changeRecord);
    session.updatedAt = Date.now();
    return changeRecord;
  }

  /**
   * Actualiza el progreso de una tarea específica
   */
  updateTaskProgress(sessionId, taskId, status, result = null) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Sesión no encontrada: ${sessionId}`);

    const task = session.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);

    task.status = status;
    task.result = result;
    session.updatedAt = Date.now();

    // Check if all tasks completed
    const allDone = session.tasks.every((t) => t.status === "completed");
    if (allDone) {
      session.status = "completed";
    } else if (session.tasks.some((t) => t.status === "in_progress")) {
      session.status = "executing";
    }

    return { session, task };
  }

  /**
   * Aplica todos los cambios staged a disco y guarda backups atómicos
   */
  commitSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Sesión no encontrada: ${sessionId}`);

    const results = [];

    for (const [relPath, change] of session.stagedChanges.entries()) {
      try {
        const dir = path.dirname(change.absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Guardar copia original para rollback
        session.appliedBackups.set(relPath, change.originalContent);

        fs.writeFileSync(change.absolutePath, change.newContent, "utf8");
        results.push({ filePath: relPath, ok: true });
      } catch (err) {
        results.push({ filePath: relPath, ok: false, error: err.message });
      }
    }

    session.status = "committed";
    session.updatedAt = Date.now();
    return { ok: true, sessionId, appliedCount: results.length, results };
  }

  /**
   * Revierte con 1-clic todos los cambios aplicados en la sesión
   */
  rollbackSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Sesión no encontrada: ${sessionId}`);

    const rollbacks = [];

    for (const [relPath, originalContent] of session.appliedBackups.entries()) {
      const absPath = path.join(this.projectRoot, relPath);
      try {
        if (originalContent === "") {
          // El archivo fue creado nuevo en la sesión -> borrarlo
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
          }
        } else {
          fs.writeFileSync(absPath, originalContent, "utf8");
        }
        rollbacks.push({ filePath: relPath, restored: true });
      } catch (err) {
        rollbacks.push({ filePath: relPath, restored: false, error: err.message });
      }
    }

    session.status = "rolled_back";
    session.updatedAt = Date.now();
    return { ok: true, sessionId, rollbacks };
  }

  /**
   * Genera un stream visual de diffs formateados para la UI
   */
  getStreamingDiffSummary(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const diffs = [];
    for (const [relPath, change] of session.stagedChanges.entries()) {
      diffs.push({
        filePath: relPath,
        diff: change.diff,
        linesAdded: (change.diff.match(/^\+[^+]/gm) || []).length,
        linesRemoved: (change.diff.match(/^-[^-]/gm) || []).length,
      });
    }

    return {
      sessionId: session.id,
      goal: session.goal,
      status: session.status,
      tasks: session.tasks,
      diffs,
    };
  }
}

module.exports = {
  ComposerEngine,
};
