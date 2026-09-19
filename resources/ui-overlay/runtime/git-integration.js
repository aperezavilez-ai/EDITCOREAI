"use strict";

/**
 * Git Integration — Ciclo 16.
 *
 * - Detecta estado del repositorio.
 * - Genera mensajes de commit contextuales.
 * - Devuelve cambios pendientes de forma estructurada.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

class GitIntegration {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.git = options.git || "git";
  }

  async status() {
    try {
      const { stdout } = await execFileAsync(this.git, ["status", "--porcelain", "--branch"], {
        cwd: this.cwd,
        maxBuffer: 4 * 1024 * 1024,
      });

      const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("## ")) || "";
      const branch = branchLine.replace(/^##\s+/, "").split("...")[0] || null;

      const changes = lines
        .filter((line) => !line.startsWith("## "))
        .map((line) => {
          const status = line.slice(0, 2);
          const filePath = line.slice(3);
          return { status, filePath };
        });

      return {
        ok: true,
        branch,
        changes,
        hasChanges: changes.length > 0,
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error),
        branch: null,
        changes: [],
        hasChanges: false,
      };
    }
  }

  async diffSummary() {
    try {
      const { stdout } = await execFileAsync(this.git, ["diff", "--stat", "--cached"], {
        cwd: this.cwd,
        maxBuffer: 4 * 1024 * 1024,
      });

      const stats = String(stdout || "").split(/\r?\n/).filter(Boolean);
      return {
        ok: true,
        stagedStats: stats,
      };
    } catch (error) {
      return {
        ok: false,
        stagedStats: [],
        error: String(error && error.message ? error.message : error),
      };
    }
  }

  async generateCommitMessage(input = {}) {
    const task = String(input.task || "").trim();
    const status = await this.status();

    if (!status.ok) {
      return {
        ok: false,
        message: null,
        error: "No se pudo obtener el estado de git.",
      };
    }

    const changeCount = status.changes.length;
    const files = status.changes.map((item) => item.filePath).slice(0, 8);
    const suffix = changeCount > 8 ? ` y ${changeCount - 8} más` : "";

    const subject = task
      ? `chore(ciclo16): ${task}`
      : "chore(ciclo16): cambios automáticos del orquestador";

    const body = [
      `- Ciclo 16: multi-agente + smart diff + git integration.`,
      `- Archivos afectados: ${files.join(", ")}${suffix}.`,
      `- Branch: ${status.branch || "unknown"}.`,
    ].join("\n");

    return {
      ok: true,
      message: `${subject}\n\n${body}`,
      branch: status.branch,
      changeCount,
    };
  }
}

module.exports = { GitIntegration };
