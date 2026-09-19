"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

class GitCheckpointManager {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.checkpointDir = path.join(this.projectRoot, ".editcore", "checkpoints");
    this.checkpoints = [];
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.checkpointDir)) {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }
      this.loadCheckpoints();
    } catch (err) {
      // Non-fatal init
    }
  }

  loadCheckpoints() {
    const indexPath = path.join(this.checkpointDir, "index.json");
    if (fs.existsSync(indexPath)) {
      try {
        this.checkpoints = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      } catch {
        this.checkpoints = [];
      }
    }
  }

  saveIndex() {
    try {
      const indexPath = path.join(this.checkpointDir, "index.json");
      fs.writeFileSync(indexPath, JSON.stringify(this.checkpoints, null, 2), "utf8");
    } catch {
      // Non-fatal
    }
  }

  /**
   * Crea un checkpoint instantáneo antes de una mutación
   */
  createCheckpoint({ description = "Snapshot antes de cambios", modifiedFiles = [] } = {}) {
    const id = `chk_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const timestamp = Date.now();
    const snapDir = path.join(this.checkpointDir, id);

    fs.mkdirSync(snapDir, { recursive: true });

    const backedUpFiles = [];

    for (const relPath of modifiedFiles) {
      const absPath = path.isAbsolute(relPath) ? relPath : path.join(this.projectRoot, relPath);
      const cleanRel = path.relative(this.projectRoot, absPath).replace(/\\/g, "/");
      const targetBackup = path.join(snapDir, cleanRel);

      if (fs.existsSync(absPath)) {
        fs.mkdirSync(path.dirname(targetBackup), { recursive: true });
        fs.copyFileSync(absPath, targetBackup);
        backedUpFiles.push({ path: cleanRel, exists: true });
      } else {
        backedUpFiles.push({ path: cleanRel, exists: false });
      }
    }

    const checkpoint = {
      id,
      timestamp,
      description,
      filesCount: backedUpFiles.length,
      files: backedUpFiles,
    };

    this.checkpoints.unshift(checkpoint);
    if (this.checkpoints.length > 50) this.checkpoints.pop();
    this.saveIndex();

    return checkpoint;
  }

  /**
   * Restaura el proyecto al estado exacto del checkpoint (Time Travel)
   */
  timeTravelTo(checkpointId) {
    const checkpoint = this.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      return { ok: false, error: `Checkpoint no encontrado: ${checkpointId}` };
    }

    const snapDir = path.join(this.checkpointDir, checkpoint.id);
    const restored = [];

    for (const fileInfo of checkpoint.files) {
      const absTarget = path.join(this.projectRoot, fileInfo.path);
      const backupPath = path.join(snapDir, fileInfo.path);

      try {
        if (fileInfo.exists && fs.existsSync(backupPath)) {
          fs.mkdirSync(path.dirname(absTarget), { recursive: true });
          fs.copyFileSync(backupPath, absTarget);
          restored.push({ path: fileInfo.path, action: "restored" });
        } else if (!fileInfo.exists) {
          if (fs.existsSync(absTarget)) {
            fs.unlinkSync(absTarget);
            restored.push({ path: fileInfo.path, action: "deleted_created_file" });
          }
        }
      } catch (err) {
        restored.push({ path: fileInfo.path, error: err.message });
      }
    }

    return { ok: true, checkpointId, restoredCount: restored.length, details: restored };
  }

  /**
   * Genera un mensaje de commit semántico basado en los archivos modificados
   */
  generateSemanticCommitMessage(modifiedFiles = []) {
    const files = Array.isArray(modifiedFiles) ? modifiedFiles : [];
    if (files.length === 0) return "chore: update project dependencies and files";

    const hasTest = files.some((f) => /test|spec/i.test(f));
    const hasUI = files.some((f) => /\.(tsx|jsx|vue|svelte|css|html)$/i.test(f));
    const hasDocs = files.some((f) => /\.(md|txt)$/i.test(f));
    const hasConfig = files.some((f) => /(package\.json|tsconfig|\.env|config)/i.test(f));

    let scope = "core";
    if (hasUI) scope = "ui";
    else if (hasTest) scope = "test";
    else if (hasConfig) scope = "config";
    else if (hasDocs) scope = "docs";

    const baseName = path.basename(files[0]).replace(/\.[^/.]+$/, "");
    return `feat(${scope}): update ${baseName} and related components`;
  }

  listCheckpoints() {
    return this.checkpoints;
  }
}

module.exports = {
  GitCheckpointManager,
};
