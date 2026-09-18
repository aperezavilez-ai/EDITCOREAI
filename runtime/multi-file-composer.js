"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");

class MultiFileComposer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.plans = new Map(); // planId -> { id, goal, files, snapshots, status, createdAt }
  }

  /**
   * Crea un plan transaccional de edición multi-archivo guardando snapshots de respaldo.
   */
  createPlan({ goal = "Multi-file patch", workspace = process.cwd(), changes = [] } = {}) {
    const planId = `plan_${randomUUID()}`;
    const snapshots = new Map(); // fullPath -> originalContent
    const validChanges = [];

    for (const change of changes) {
      const fullPath = path.isAbsolute(change.path) ? change.path : path.join(workspace, change.path);
      const relative = path.relative(workspace, fullPath).replace(/\\/g, "/");

      let originalContent = null;
      let exists = false;
      if (fs.existsSync(fullPath)) {
        originalContent = fs.readFileSync(fullPath, "utf8");
        exists = true;
      }

      snapshots.set(fullPath, { originalContent, exists });
      validChanges.push({
        path: relative,
        fullPath,
        newContent: change.newContent,
        diff: this._generateSimpleDiff(originalContent || "", change.newContent || "", relative),
      });
    }

    const plan = {
      id: planId,
      goal,
      workspace,
      changes: validChanges,
      snapshots,
      status: "pending", // pending | applied | rolled_back | failed
      createdAt: new Date().toISOString(),
    };

    this.plans.set(planId, plan);
    this.emit("plan:created", { planId, goal, filesCount: validChanges.length });
    return {
      planId,
      goal,
      filesCount: validChanges.length,
      diffs: validChanges.map((c) => ({ file: c.path, diff: c.diff })),
    };
  }

  /**
   * Previsualiza los diffs de un plan sin aplicar cambios a disco.
   */
  previewChanges(planId) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} no encontrado`);

    return {
      planId: plan.id,
      goal: plan.goal,
      status: plan.status,
      files: plan.changes.map((c) => ({
        file: c.path,
        diff: c.diff,
        originalLength: plan.snapshots.get(c.fullPath)?.originalContent?.length || 0,
        newLength: c.newContent?.length || 0,
      })),
    };
  }

  /**
   * Aplica atómicamente todos los cambios del plan. Si cualquiera falla, revierte todos.
   */
  async applyAtomicChanges(planId) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} no encontrado`);

    const appliedFiles = [];
    try {
      for (const change of plan.changes) {
        const dir = path.dirname(change.fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(change.fullPath, change.newContent, "utf8");
        appliedFiles.push(change.fullPath);
      }

      plan.status = "applied";
      this.emit("plan:applied", { planId, filesModified: appliedFiles.length });
      return {
        ok: true,
        planId,
        filesModified: appliedFiles.length,
        status: "applied",
      };
    } catch (error) {
      // Fallo en la aplicación -> Rollback inmediato de todos los archivos modificados
      for (const fullPath of appliedFiles) {
        const snap = plan.snapshots.get(fullPath);
        if (snap) {
          if (snap.exists) {
            fs.writeFileSync(fullPath, snap.originalContent, "utf8");
          } else if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        }
      }
      plan.status = "failed";
      this.emit("plan:failed", { planId, error: error.message });
      throw new Error(`Fallo atómico al escribir archivos: ${error.message}. Rollback completado.`);
    }
  }

  /**
   * Revierte un plan previamente aplicado restaurando los snapshots originales.
   */
  async rollbackAtomicChanges(planId) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} no encontrado`);

    for (const [fullPath, snap] of plan.snapshots.entries()) {
      if (snap.exists) {
        fs.writeFileSync(fullPath, snap.originalContent, "utf8");
      } else if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    plan.status = "rolled_back";
    this.emit("plan:rolled_back", { planId });
    return { ok: true, planId, status: "rolled_back" };
  }

  /**
   * Obtiene la lista de planes pendientes o activos.
   */
  getPendingDiffs() {
    const list = [];
    for (const plan of this.plans.values()) {
      list.push({
        planId: plan.id,
        goal: plan.goal,
        status: plan.status,
        createdAt: plan.createdAt,
        files: plan.changes.map((c) => ({ file: c.path, diff: c.diff })),
      });
    }
    return list;
  }

  _generateSimpleDiff(oldText, newText, filename) {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const diffLines = [`--- a/${filename}`, `+++ b/${filename}`];

    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        diffLines.push(` ${oldLines[i]}`);
        i++;
        j++;
      } else {
        if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
          diffLines.push(`-${oldLines[i]}`);
          i++;
        }
        if (j < newLines.length && (i >= oldLines.length || oldLines[i - 1] !== newLines[j])) {
          diffLines.push(`+${newLines[j]}`);
          j++;
        }
      }
    }
    return diffLines.slice(0, 100).join("\n");
  }
}

const multiFileComposerInstance = new MultiFileComposer();

module.exports = {
  MultiFileComposer,
  multiFileComposer: multiFileComposerInstance,
};
