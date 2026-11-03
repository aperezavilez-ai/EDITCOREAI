"use strict";

/**
 * EDITCORE BRAIN - Atomic File Editor
 * 
 * Implementa la precisión del EditorExecutor de Cline:
 * - Detección y respeto absoluto del EOL (CRLF vs LF) del archivo de destino.
 * - Validación de ocurrencia EXACTA (1 sola vez).
 * - Generación de bloques diff estructurados para inspección en la UI.
 * - Escritura atómica a disco.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

function detectLineEnding(content = "") {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeLineEndings(text = "", eol = "\n") {
  return text.replace(/\r\n|\n/g, eol);
}

function countOccurrences(content, needle) {
  if (!needle) return 0;
  return content.split(needle).length - 1;
}

function buildDiffPreview(oldContent, newContent, maxDiffLines = 120) {
  const oldLines = oldContent.split(/\r\n|\n/);
  const newLines = newContent.split(/\r\n|\n/);

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const diff = ["```diff"];
  for (let i = start; i < Math.min(oldEnd, start + maxDiffLines); i++) {
    diff.push(`-${i + 1}: ${oldLines[i]}`);
  }
  for (let i = start; i < Math.min(newEnd, start + maxDiffLines); i++) {
    diff.push(`+${i + 1}: ${newLines[i]}`);
  }
  diff.push("```");
  return diff.join("\n");
}

class AtomicFileEditor {
  constructor(workspaceRoot) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
  }

  resolveSafePath(targetPath) {
    if (!targetPath) throw new Error("Ruta de archivo no especificada");
    if (path.isAbsolute(targetPath)) return path.normalize(targetPath);
    return path.resolve(this.workspaceRoot, targetPath);
  }

  async readFile(filePath, { startLine = null, endLine = null } = {}) {
    const fullPath = this.resolveSafePath(filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split(/\r\n|\n/);

    if (startLine != null && endLine != null) {
      const s = Math.max(1, Number(startLine));
      const e = Math.min(lines.length, Number(endLine));
      return {
        ok: true,
        path: filePath,
        startLine: s,
        endLine: e,
        totalLines: lines.length,
        content: lines.slice(s - 1, e).join("\n"),
      };
    }

    return {
      ok: true,
      path: filePath,
      totalLines: lines.length,
      content,
    };
  }

  async writeFile(filePath, content) {
    const fullPath = this.resolveSafePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const eol = detectLineEnding(content);
    const normalized = normalizeLineEndings(content, eol);
    await fs.writeFile(fullPath, normalized, "utf-8");
    return {
      ok: true,
      path: filePath,
      action: "created",
      bytes: Buffer.byteLength(normalized, "utf-8"),
    };
  }

  async replaceInFile(filePath, oldText, newText) {
    const fullPath = this.resolveSafePath(filePath);
    let original;
    try {
      original = await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      throw new Error(`No se pudo leer el archivo '${filePath}': ${err.message}`);
    }

    const eol = detectLineEnding(original);
    const normOld = normalizeLineEndings(oldText, eol);
    const normNew = normalizeLineEndings(newText ?? "", eol);

    const occurrences = countOccurrences(original, normOld);
    if (occurrences === 0) {
      throw new Error(`[EditCore Brain] Texto no encontrado en '${filePath}'. El bloque old_text debe coincidir exactamente con el contenido en disco (incluyendo sangría y saltos de línea).`);
    }
    if (occurrences > 1) {
      throw new Error(`[EditCore Brain] Se encontraron ${occurrences} coincidencias de 'old_text' en '${filePath}'. Proporciona un bloque con más líneas de contexto circundante para garantizar unicidad.`);
    }

    const updated = original.replace(normOld, () => normNew);
    await fs.writeFile(fullPath, updated, "utf-8");
    const diff = buildDiffPreview(original, updated);

    return {
      ok: true,
      path: filePath,
      action: "replaced",
      diff,
    };
  }
}

module.exports = {
  AtomicFileEditor,
  detectLineEnding,
  normalizeLineEndings,
};
