"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertProjectRoot, resolveInside, resolveInsideForWrite } = require("../project-path-policy");

class WorkspaceApi {
  constructor({ root, operations = {} } = {}) {
    this.root = assertProjectRoot(root);
    this.operations = operations;
  }

  resolve(relativePath = "") { return resolveInside(this.root, relativePath); }

  resolveForWrite(relativePath = "") { return resolveInsideForWrite(this.root, relativePath); }

  listFiles(relativePath = "") {
    try {
      const target = this.resolve(relativePath);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new Error(`El directorio no existe o no es una carpeta: ${relativePath}`);
      }
      return fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        path: path.relative(this.root, path.join(target, entry.name)).replace(/\\/g, "/"),
        kind: entry.isDirectory() ? "directory" : "file",
      }));
    } catch (error) {
      throw new Error(`Error al listar archivos en '${relativePath}': ${error.message}`);
    }
  }

  readFile(relativePath, options = {}) {
    if (this.operations.readFile) return this.operations.readFile(relativePath, options);
    try {
      const target = this.resolve(relativePath);
      if (!fs.existsSync(target)) throw new Error("Archivo no encontrado.");
      const raw = fs.readFileSync(target, "utf8");
      const lines = raw.split(/\r?\n/);
      const totalLines = lines.length;
      const startLine = Math.max(1, Number(options.startLine) || 1);
      const endLine = Number.isFinite(Number(options.endLine))
        ? Math.min(totalLines, Math.max(startLine, Number(options.endLine)))
        : totalLines;
      const width = String(endLine).length;
      const content = lines
        .slice(startLine - 1, endLine)
        .map((line, index) => `${String(startLine + index).padStart(width, " ")}| ${line}`)
        .join("\n");
      return {
        path: relativePath,
        content,
        startLine,
        endLine,
        totalLines,
        truncated: startLine > 1 || endLine < totalLines,
        numbered: true,
      };
    } catch (error) {
      throw new Error(`Error al leer '${relativePath}': ${error.message}`);
    }
  }

  writeFile(relativePath, content) {
    if (this.operations.writeFile) return this.operations.writeFile(relativePath, content);
    try {
      const target = this.resolveForWrite(relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(content), "utf8");
      return { path: relativePath, bytes: Buffer.byteLength(String(content), "utf8") };
    } catch (error) {
      throw new Error(`Error al escribir '${relativePath}': ${error.message}`);
    }
  }

  searchFiles(query, relativePath = "") {
    if (this.operations.searchFiles) return this.operations.searchFiles(query, relativePath);
    const target = this.resolve(relativePath);
    if (!fs.existsSync(target)) return [];
    const results = [];
    // Skip ampliado para evitar bloqueos del agente en carpetas irrelevantes
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".cache", "vendor", "target", ".svelte-kit", "release-275", "phase4-results"]);
    const MAX_RESULTS = 100;
    const MAX_FILE_SIZE = 512 * 1024;
    const walk = (dir, rel) => {
      if (results.length >= MAX_RESULTS) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        const full = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP.has(entry.name.toLowerCase())) walk(full, relPath);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > MAX_FILE_SIZE) continue;
            const content = fs.readFileSync(full, "utf8");
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push({ file: relPath.replace(/\\/g, "/"), line: i + 1, text: lines[i].slice(0, 200) });
                if (results.length >= MAX_RESULTS) return;
              }
            }
          } catch {}
        }
      }
    };
    walk(target, relativePath || "");
    return results;
  }

  runTerminal(command, options = {}) {
    if (!this.operations.runTerminal) throw new Error("runTerminal no esta configurado.");
    return this.operations.runTerminal(command, options);
  }

  diagnostics() { return this.operations.getDiagnostics ? this.operations.getDiagnostics() : []; }
  gitStatus() { return this.operations.gitStatus ? this.operations.gitStatus() : null; }
}

module.exports = { WorkspaceApi };