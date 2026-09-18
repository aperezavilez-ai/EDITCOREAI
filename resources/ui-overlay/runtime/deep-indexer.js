"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  ".cache",
  ".editcore",
]);

const ALLOWED_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".html",
  ".css",
  ".json",
  ".sql",
  ".md",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
]);

class DeepIndexer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.workspace = null;
    this.symbolGraph = new Map(); // symbolName -> Array of definitions/references
    this.fileMap = new Map(); // relativePath -> { symbols, imports, exports, lines, hash }
    this.dependencyGraph = new Map(); // file -> Set of imported files
    this.isIndexing = false;
    this.lastIndexedAt = null;
    this.watchers = [];
  }

  /**
   * Indexa recursivamente el workspace completo construyendo el grafo de símbolos y dependencias.
   */
  async indexWorkspace(workspacePath) {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { ok: false, error: "Ruta de workspace inválida o inexistente" };
    }

    this.workspace = path.resolve(workspacePath);
    this.isIndexing = true;
    this.emit("indexing:started", { workspace: this.workspace });

    this.symbolGraph.clear();
    this.fileMap.clear();
    this.dependencyGraph.clear();

    const files = this._walk(this.workspace);

    for (const fullPath of files) {
      this._indexFile(fullPath);
    }

    this.isIndexing = false;
    this.lastIndexedAt = new Date().toISOString();

    const status = this.getGraphStatus();
    this.emit("indexing:completed", status);
    return { ok: true, status };
  }

  /**
   * Extrae símbolos, importaciones y exportaciones de un archivo individual.
   */
  _indexFile(fullPath) {
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const relative = path.relative(this.workspace, fullPath).replace(/\\/g, "/");
      const lines = content.split("\n");
      const symbols = [];
      const imports = [];
      const exportsList = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Detectar funciones: function foo(), const foo = () => {}, async function bar()
        const funcMatch = line.match(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
        if (funcMatch) {
          const name = funcMatch[1];
          const sym = { name, type: "function", file: relative, line: lineNum, text: line.trim() };
          symbols.push(sym);
          this._addSymbolToGraph(name, sym);
        }

        // Detectar clases: class Foo, export class Bar
        const classMatch = line.match(/class\s+([a-zA-Z0-9_$]+)/);
        if (classMatch) {
          const name = classMatch[1];
          const sym = { name, type: "class", file: relative, line: lineNum, text: line.trim() };
          symbols.push(sym);
          this._addSymbolToGraph(name, sym);
        }

        // Detectar constantes/variables declaradas: const API_KEY =, let counter =
        const varMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/);
        if (varMatch && !funcMatch) {
          const name = varMatch[1];
          const sym = { name, type: "variable", file: relative, line: lineNum, text: line.trim() };
          symbols.push(sym);
          this._addSymbolToGraph(name, sym);
        }

        // Detectar imports: require('./foo'), import { x } from './bar'
        const reqMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
        if (reqMatch) {
          imports.push({ target: reqMatch[1], line: lineNum });
        }
        const impMatch = line.match(/from\s+['"]([^'"]+)['"]/);
        if (impMatch) {
          imports.push({ target: impMatch[1], line: lineNum });
        }

        // Detectar exportaciones: module.exports =, export default, export const
        const expMatch = line.match(/module\.exports\s*=\s*(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))/);
        if (expMatch) {
          const expNames = (expMatch[1] || expMatch[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
          exportsList.push(...expNames);
        }
      }

      this.fileMap.set(relative, {
        file: relative,
        fullPath,
        symbols,
        imports,
        exports: exportsList,
        linesCount: lines.length,
      });

      this.dependencyGraph.set(relative, imports.map((imp) => imp.target));
    } catch {
      // Ignorar archivos no parseables
    }
  }

  _addSymbolToGraph(name, sym) {
    if (!this.symbolGraph.has(name)) {
      this.symbolGraph.set(name, []);
    }
    this.symbolGraph.get(name).push(sym);
  }

  /**
   * Busca símbolos por coincidencia exacta o parcial.
   */
  searchSymbols(query = "", limit = 20) {
    const q = String(query).trim().toLowerCase();
    if (!q) return [];

    const results = [];
    for (const [name, list] of this.symbolGraph.entries()) {
      if (name.toLowerCase().includes(q)) {
        for (const item of list) {
          results.push(item);
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  /**
   * Encuentra todas las definiciones y referencias de un símbolo.
   */
  findReferences(symbolName) {
    const name = String(symbolName).trim();
    if (!name) return [];
    return this.symbolGraph.get(name) || [];
  }

  /**
   * Consulta semántica rápida del repositorio para inyectar en el contexto de agentes.
   */
  queryCodebase(prompt = "", topK = 5) {
    const tokens = String(prompt)
      .toLowerCase()
      .replace(/[^a-z0-9_$]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (!tokens.length) return [];

    const scoredFiles = [];
    for (const [file, info] of this.fileMap.entries()) {
      let score = 0;
      for (const sym of info.symbols) {
        for (const token of tokens) {
          if (sym.name.toLowerCase().includes(token)) score += 3;
        }
      }
      for (const exp of info.exports) {
        for (const token of tokens) {
          if (exp.toLowerCase().includes(token)) score += 2;
        }
      }
      for (const token of tokens) {
        if (file.toLowerCase().includes(token)) score += 1;
      }
      if (score > 0) {
        scoredFiles.push({ file, score, symbols: info.symbols.slice(0, 5) });
      }
    }

    scoredFiles.sort((a, b) => b.score - a.score);
    return scoredFiles.slice(0, topK);
  }

  /**
   * Obtiene el mapa de dependencias estructurado.
   */
  getDependencyGraph() {
    const obj = {};
    for (const [file, deps] of this.dependencyGraph.entries()) {
      obj[file] = deps;
    }
    return obj;
  }

  /**
   * Estado y métricas del grafo.
   */
  getGraphStatus() {
    let totalSymbols = 0;
    for (const list of this.symbolGraph.values()) {
      totalSymbols += list.length;
    }

    return {
      workspace: this.workspace,
      filesIndexed: this.fileMap.size,
      uniqueSymbols: this.symbolGraph.size,
      totalSymbols,
      isIndexing: this.isIndexing,
      lastIndexedAt: this.lastIndexedAt,
    };
  }

  _walk(dir) {
    const files = [];
    if (!fs.existsSync(dir)) return files;
    const stack = [dir];

    while (stack.length) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ALLOWED_EXTS.has(ext)) {
            files.push(full);
          }
        }
      }
    }
    return files;
  }
}

const deepIndexerInstance = new DeepIndexer();

module.exports = {
  DeepIndexer,
  deepIndexer: deepIndexerInstance,
};
