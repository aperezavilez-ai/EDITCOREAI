"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { SKIP_DIRECTORIES } = require("./project-discovery");
const { SymbolIntelligence } = require("./symbol-intelligence");

const PARSE_EXTENSIONS = new Set([".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx", ".json"]);

function hashFile(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function normalizeRelative(value) { return String(value || "").replace(/\\/g, "/"); }

class CodebaseMap {
  constructor({ symbols = new SymbolIntelligence(), maxFiles = 2000 } = {}) {
    this.symbols = symbols;
    this.maxFiles = Math.max(100, Number(maxFiles) || 2000);
    this.projects = new Map();
  }

  listFiles(root) {
    const rows = []; const stack = [""];
    while (stack.length && rows.length < this.maxFiles) {
      const relative = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (entry.isFile()) rows.push(normalizeRelative(child));
        if (rows.length >= this.maxFiles) break;
      }
    }
    return rows.sort();
  }

  build(projectRoot, { refresh = false } = {}) {
    const root = path.resolve(String(projectRoot || ""));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Proyecto invalido para Codebase Map.");
    const listed = this.listFiles(root);
    const signature = crypto.createHash("sha256").update(JSON.stringify(listed.map((file) => {
      const stat = fs.statSync(path.join(root, file)); return [file, stat.size, stat.mtimeMs];
    }))).digest("hex");
    const cached = this.projects.get(root);
    if (!refresh && cached?.signature === signature) return { ...cached.map, cacheHit: true };
    const previousFiles = cached?.files || new Map();
    const files = new Map();
    for (const relativePath of listed) {
      const absolute = path.join(root, relativePath);
      const stat = fs.statSync(absolute);
      const previous = previousFiles.get(relativePath);
      if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) { files.set(relativePath, previous); continue; }
      const extension = path.extname(relativePath).toLowerCase();
      const analysis = PARSE_EXTENSIONS.has(extension) && stat.size <= 1_000_000 ? this.symbols.parseFile(absolute) : { symbols: [], imports: [], exports: [], references: [] };
      files.set(relativePath, {
        path: relativePath, extension, size: stat.size, mtimeMs: stat.mtimeMs, hash: hashFile(absolute),
        symbols: analysis.symbols || [], imports: analysis.imports || [], exports: analysis.exports || [], references: analysis.references || [], diagnostics: analysis.diagnostics || [],
      });
    }
    const directories = [...new Set(listed.map((file) => normalizeRelative(path.dirname(file))).filter((dir) => dir !== "."))].sort();
    const map = {
      projectRoot: root, signature, generatedAt: new Date().toISOString(), cacheHit: false,
      counts: {
        directories: directories.length, files: files.size,
        symbols: [...files.values()].reduce((sum, file) => sum + file.symbols.length, 0),
        imports: [...files.values()].reduce((sum, file) => sum + file.imports.length, 0),
        exports: [...files.values()].reduce((sum, file) => sum + file.exports.length, 0),
      },
      directories,
      files: [...files.values()].map(({ references, ...file }) => file),
    };
    this.projects.set(root, { signature, map, files });
    return map;
  }

  ensure(projectRoot) { this.build(projectRoot); return this.projects.get(path.resolve(projectRoot)); }

  searchSymbols(projectRoot, query, { kinds = [], pathPrefix = "", limit = 30 } = {}) {
    const project = this.ensure(projectRoot);
    const needle = String(query || "").trim().toLowerCase();
    const allowedKinds = new Set((kinds || []).map((kind) => String(kind).toLowerCase()));
    const prefix = normalizeRelative(pathPrefix).toLowerCase();
    const results = [];
    for (const file of project.files.values()) {
      if (prefix && !file.path.toLowerCase().startsWith(prefix)) continue;
      for (const symbol of file.symbols) {
        if (needle && !symbol.name.toLowerCase().includes(needle)) continue;
        if (allowedKinds.size && !allowedKinds.has(symbol.kind.toLowerCase())) continue;
        results.push({ file: file.path, ...symbol });
        if (results.length >= Math.min(100, Math.max(1, Number(limit) || 30))) return results;
      }
    }
    return results;
  }

  searchDependencies(projectRoot, query, { pathPrefix = "", limit = 40 } = {}) {
    const project = this.ensure(projectRoot);
    const needle = String(query || "").trim().toLowerCase();
    const prefix = normalizeRelative(pathPrefix).toLowerCase();
    const results = [];
    for (const file of project.files.values()) {
      if (prefix && !file.path.toLowerCase().startsWith(prefix)) continue;
      for (const item of file.imports) {
        if (!needle || item.specifier.toLowerCase().includes(needle) || item.names.some((name) => name.toLowerCase().includes(needle))) results.push({ type: "import", file: file.path, ...item });
      }
      for (const item of file.exports) {
        if (!needle || item.specifier.toLowerCase().includes(needle) || item.names.some((name) => name.toLowerCase().includes(needle))) results.push({ type: "export", file: file.path, ...item });
      }
      if (needle) {
        const refs = file.references.filter((item) => item.name.toLowerCase().includes(needle)).slice(0, 8);
        results.push(...refs.map((item) => ({ type: "reference", file: file.path, ...item })));
      }
      if (results.length >= Math.min(120, Math.max(1, Number(limit) || 40))) break;
    }
    return results.slice(0, Math.min(120, Math.max(1, Number(limit) || 40)));
  }

  invalidate(projectRoot, relativePath = "") {
    const root = path.resolve(String(projectRoot || ""));
    if (!relativePath) return this.projects.delete(root) ? 1 : 0;
    const project = this.projects.get(root);
    if (!project) return 0;
    const removed = project.files.delete(normalizeRelative(relativePath)) ? 1 : 0;
    project.signature = "invalid";
    return removed;
  }
}

module.exports = { CodebaseMap, PARSE_EXTENSIONS, normalizeRelative };
