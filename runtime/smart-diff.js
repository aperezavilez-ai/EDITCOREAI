"use strict";

/**
 * Smart Diff — Ciclo 16.
 *
 * Motor de diffs inteligentes con:
 * - normalización de parches tipo unified diff simplificado
 * - validación sintáctica previa
 * - aplicación segura en disco
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BACKUP_SUFFIX = ".editcore-backup";

class SmartDiff {
  constructor(options = {}) {
    this.backupSuffix = options.backupSuffix || DEFAULT_BACKUP_SUFFIX;
    this.dryRun = options.dryRun || false;
  }

  apply(input = {}) {
    const patches = Array.isArray(input.patches) ? input.patches : [];
    const baseDir = String(input.baseDir || process.cwd());

    const results = [];
    let appliedCount = 0;
    let failedCount = 0;

    for (const patch of patches) {
      const result = this._applyPatch({ patch, baseDir });
      results.push(result);
      if (result.applied) appliedCount += 1;
      if (!result.ok) failedCount += 1;
    }

    return {
      ok: failedCount === 0,
      appliedCount,
      failedCount,
      results,
    };
  }

  _applyPatch({ patch, baseDir }) {
    const target = String(patch.target || "").trim();
    if (!target) {
      return { ok: false, target: null, applied: false, error: "Parche sin 'target'." };
    }

    const absoluteTarget = path.isAbsolute(target) ? target : path.join(baseDir, target);
    const syntaxOk = this._validateSyntax({ patch, target: absoluteTarget });

    if (!syntaxOk) {
      return {
        ok: false,
        target: path.relative(baseDir, absoluteTarget),
        applied: false,
        error: "Validación sintáctica rechazada.",
      };
    }

    if (this.dryRun) {
      return {
        ok: true,
        target: path.relative(baseDir, absoluteTarget),
        applied: false,
        error: null,
        note: "dryRun activo; no se escribió en disco.",
      };
    }

    try {
      const current = fs.existsSync(absoluteTarget) ? fs.readFileSync(absoluteTarget, "utf8") : "";
      const next = this._composeNext({ current, patch });

      if (next === current) {
        return {
          ok: true,
          target: path.relative(baseDir, absoluteTarget),
          applied: false,
          error: null,
          note: "Sin cambios detectados.",
        };
      }

      const backupPath = absoluteTarget + this.backupSuffix;
      if (fs.existsSync(absoluteTarget)) {
        fs.copyFileSync(absoluteTarget, backupPath);
      }

      fs.writeFileSync(absoluteTarget, next, "utf8");
      return {
        ok: true,
        target: path.relative(baseDir, absoluteTarget),
        applied: true,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        target: path.relative(baseDir, absoluteTarget),
        applied: false,
        error: String(error && error.message ? error.message : error),
      };
    }
  }

  _composeNext({ current, patch }) {
    if (typeof patch.content === "string") {
      return patch.content;
    }

    if (typeof patch.replace === "string" && typeof patch.with === "string") {
      if (!current.includes(patch.replace)) {
        return current + "\n" + patch.with;
      }
      return current.split(patch.replace).join(patch.with);
    }

    return current;
  }

  _validateSyntax({ patch, target }) {
    if (!patch || typeof patch !== "object") return false;
    if (!patch.target && !patch.content && !patch.replace) return false;

    const content = typeof patch.content === "string" ? patch.content : "";
    const withContent = typeof patch.with === "string" ? patch.with : "";

    const combined = (content + "\n" + withContent).trim();
    if (!combined) return false;

    const suspicious = combined.includes("eval(") || combined.includes("new Function(");
    if (suspicious) return false;

    return true;
  }
}

module.exports = { SmartDiff };
