"use strict";

const fs = require("node:fs");
const path = require("node:path");

class SemanticIndexer {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.symbolIndex = new Map();
    this.ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
  }

  /**
   * Escanea el workspace de manera recursiva buscando archivos de código fuente
   */
  indexWorkspace() {
    this.symbolIndex.clear();
    this._scanDirectory(this.projectRoot);
    return {
      totalFilesIndexed: this.symbolIndex.size,
      symbolsFound: Array.from(this.symbolIndex.keys())
    };
  }

  _scanDirectory(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (!this.ignoreDirs.has(entry.name)) {
            this._scanDirectory(fullPath);
          }
        } else if (entry.isFile() && /\.(js|ts|jsx|tsx|json)$/.test(entry.name)) {
          this._extractSymbols(fullPath);
        }
      }
    } catch (err) {
      console.error(`Error escaneando directorio ${dirPath}:`, err.message);
    }
  }

  /**
   * Extrae funciones, clases y exportaciones clave usando patrones limpios
   */
  _extractSymbols(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const relativePath = path.relative(this.projectRoot, filePath).replace(/\\/g, "/");
      const symbols = [];

      // Regex para detectar funciones, clases y constantes exportadas
      const regex = /(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        symbols.push(match[1]);
      }

      if (symbols.length > 0) {
        this.symbolIndex.set(relativePath, {
          path: relativePath,
          symbols: [...new Set(symbols)],
          lastIndexed: Date.now()
        });
      }
    } catch (err) {
      console.error(`Error procesando archivo ${filePath}:`, err.message);
    }
  }

  /**
   * Busca en qué archivo se encuentra un símbolo específico
   */
  findSymbol(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    for (const [filePath, data] of this.symbolIndex.entries()) {
      const matched = data.symbols.filter(s => s.toLowerCase().includes(lowerQuery));
      if (matched.length > 0) {
        results.push({ file: filePath, matches: matched });
      }
    }
    return results;
  }
}

module.exports = SemanticIndexer;
