"use strict";

/**
 * EDITCOREAI patch-engine — API procedural estable.
 * Exports: applyPatch, generateDiff, writeFileAtomic, rollbackPatch, listBackups, validateContext
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let buildUnifiedDiff = null;
try {
  ({ buildUnifiedDiff } = require("./runtime/diff-preview"));
} catch {
  buildUnifiedDiff = null;
}

let createMutationCheckpoint = null;
try {
  ({ createMutationCheckpoint } = require("./runtime/mutation-checkpoint"));
} catch {
  createMutationCheckpoint = null;
}

const BACKUP_DIR_NAME = ".editcore-patch-backups";

function resolveAbsPath(projectRoot, filePath) {
  if (!filePath) throw new Error("filePath is required");
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.resolve(projectRoot || process.cwd(), filePath);
}

function backupRootFor(filePath) {
  return path.join(path.dirname(filePath), BACKUP_DIR_NAME);
}

function validateContext(fileContent, searchText) {
  if (typeof searchText !== "string" || !searchText) {
    return { valid: false, count: 0, error: "searchText is empty or invalid" };
  }
  const normalizedContent = String(fileContent || "").replace(/\r\n/g, "\n");
  const normalizedSearch = String(searchText).replace(/\r\n/g, "\n");
  if (!normalizedSearch.trim()) {
    return { valid: false, count: 0, error: "searchText is empty after trimming" };
  }
  let count = 0;
  let pos = 0;
  while ((pos = normalizedContent.indexOf(normalizedSearch, pos)) !== -1) {
    count += 1;
    pos += normalizedSearch.length;
  }
  if (count === 0) {
    return { valid: false, count: 0, error: "Context not found in file (oldText mismatch)" };
  }
  if (count > 1) {
    return {
      valid: false,
      count,
      error: `Context is not unique: found ${count} matches. Provide more surrounding lines.`,
    };
  }
  return { valid: true, count: 1 };
}

function generateDiff(filePath, before, after) {
  const rel = String(filePath || "file").replace(/\\/g, "/");
  if (typeof buildUnifiedDiff === "function") {
    try {
      return buildUnifiedDiff(rel, before, after, { context: 3, maxLines: 1000, maxHunks: 100 });
    } catch {
      /* fallthrough */
    }
  }
  const beforeLines = String(before || "").split("\n");
  const afterLines = String(after || "").split("\n");
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.slice(0, 40).map((line) => `-${line}`),
    ...afterLines.slice(0, 40).map((line) => `+${line}`),
  ].join("\n");
}

function writeFileAtomic(filePath, content, encoding = "utf8") {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(abs)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, encoding);
    fs.renameSync(tmpPath, abs);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw new Error(`Atomic write failed: ${error.message}`);
  }
  return abs;
}

function createLocalBackup(absPath) {
  const root = backupRootFor(absPath);
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(root, `${path.basename(absPath)}.${stamp}.bak`);
  fs.copyFileSync(absPath, backupPath);
  return backupPath;
}

function listBackups(filePath, projectRoot = "") {
  const abs = resolveAbsPath(projectRoot, filePath);
  const root = backupRootFor(abs);
  if (!fs.existsSync(root)) return [];
  const base = path.basename(abs);
  return fs.readdirSync(root)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak"))
    .map((name) => {
      const full = path.join(root, name);
      const st = fs.statSync(full);
      return { path: full, name, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function rollbackPatch(filePath, backupPath, projectRoot = "") {
  const abs = resolveAbsPath(projectRoot, filePath);
  if (!backupPath || !fs.existsSync(backupPath)) {
    const latest = listBackups(abs)[0];
    if (!latest) return { ok: false, error: "No backup available for rollback" };
    backupPath = latest.path;
  }
  if (!fs.existsSync(backupPath)) {
    return { ok: false, error: `Backup not found: ${backupPath}` };
  }
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const restored = fs.readFileSync(backupPath, "utf8");
  writeFileAtomic(abs, restored);
  return {
    ok: true,
    path: abs,
    backupPath,
    diff: generateDiff(abs, before, restored),
  };
}

/**
 * Aplica un patch por reemplazo de contexto (oldText → newText) o escritura completa.
 * @param {string} projectRoot
 * @param {string} filePath
 * @param {string} [oldText]
 * @param {string} [newText]
 * @param {{ runId?: string, skipCheckpoint?: boolean, createBackup?: boolean }} [options]
 */
function applyPatch(projectRoot, filePath, oldText, newText, options = {}) {
  const {
    runId = "",
    skipCheckpoint = false,
    createBackup = true,
  } = options || {};

  let absPath;
  try {
    absPath = resolveAbsPath(projectRoot, filePath);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const exists = fs.existsSync(absPath);
  const originalContent = exists ? fs.readFileSync(absPath, "utf8") : "";

  let patchedContent;
  if (oldText == null || oldText === "") {
    patchedContent = String(newText ?? "");
  } else {
    if (!exists) {
      return { ok: false, error: `File not found: ${absPath}` };
    }
    const validation = validateContext(originalContent, oldText);
    if (!validation.valid) {
      return { ok: false, error: validation.error, matches: validation.count };
    }
    const normalizedOriginal = originalContent.replace(/\r\n/g, "\n");
    const normalizedOld = String(oldText).replace(/\r\n/g, "\n");
    const normalizedNew = String(newText ?? "").replace(/\r\n/g, "\n");
    patchedContent = normalizedOriginal.replace(normalizedOld, normalizedNew);
    if (normalizedOriginal === patchedContent) {
      return { ok: true, skipped: true, reason: "No changes detected after replacement", path: absPath };
    }
  }

  let checkpoint = null;
  if (!skipCheckpoint && projectRoot && typeof createMutationCheckpoint === "function") {
    try {
      checkpoint = createMutationCheckpoint(projectRoot, {
        runId,
        label: `patch-${path.basename(absPath)}`,
      });
    } catch {
      checkpoint = { ok: false, skipped: true, reason: "checkpoint-error" };
    }
  }

  let backupPath = null;
  try {
    if (exists && createBackup) backupPath = createLocalBackup(absPath);
    writeFileAtomic(absPath, patchedContent);
    return {
      ok: true,
      path: absPath,
      backupPath,
      diff: generateDiff(absPath, originalContent, patchedContent),
      checkpoint,
      bytesWritten: Buffer.byteLength(patchedContent, "utf8"),
      created: !exists,
    };
  } catch (error) {
    return { ok: false, error: error.message, checkpoint, backupPath };
  }
}

module.exports = {
  validateContext,
  generateDiff,
  writeFileAtomic,
  applyPatch,
  rollbackPatch,
  listBackups,
  PatchEngine: {
    validateContext,
    generateDiff,
    writeFileAtomic,
    applyPatch,
    rollbackPatch,
    listBackups,
  },
};
