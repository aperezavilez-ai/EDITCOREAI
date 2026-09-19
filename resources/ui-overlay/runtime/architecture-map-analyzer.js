"use strict";

const path = require("path");
const fs = require("fs");

class ArchitectureMapAnalyzer {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Analiza las importaciones y exportaciones de todos los archivos del código fuente
   */
  buildDependencyGraph(srcDir = "src") {
    const targetDir = path.join(this.projectRoot, srcDir);
    if (!fs.existsSync(targetDir)) {
      return { nodes: [], edges: [], deadFiles: [] };
    }

    const files = this._scanFiles(targetDir);
    const nodes = [];
    const edges = [];
    const importedSet = new Set();

    for (const file of files) {
      const relPath = path.relative(this.projectRoot, file).replace(/\\/g, "/");
      const content = fs.readFileSync(file, "utf8");
      const imports = this._extractImports(content, path.dirname(file));

      nodes.push({
        id: relPath,
        label: path.basename(relPath),
        lines: content.split("\n").length,
        importsCount: imports.length,
      });

      for (const imp of imports) {
        const targetRel = path.relative(this.projectRoot, imp).replace(/\\/g, "/");
        importedSet.add(targetRel);
        edges.push({
          from: relPath,
          to: targetRel,
        });
      }
    }

    // Identificar archivos no importados por nadie (excepto entrypoints como App, main, index)
    const deadFiles = nodes
      .filter((n) => !importedSet.has(n.id) && !/(main|index|App|site-header|routes)/i.test(n.label))
      .map((n) => n.id);

    return {
      nodesCount: nodes.length,
      edgesCount: edges.length,
      nodes,
      edges,
      deadFiles,
    };
  }

  _scanFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/(node_modules|\.git|dist|build|\.next)/i.test(entry.name)) {
          results = results.concat(this._scanFiles(full));
        }
      } else if (/\.(tsx|ts|jsx|js|vue|svelte)$/i.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  _extractImports(content, currentDir) {
    const imports = [];
    const importRegex = /(?:import|from|require\()\s*['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const rawPath = match[1];
      if (rawPath.startsWith(".")) {
        const resolved = path.resolve(currentDir, rawPath);
        // Intentar extensiones comunes
        const candidates = [
          resolved,
          `${resolved}.ts`,
          `${resolved}.tsx`,
          `${resolved}.js`,
          `${resolved}.jsx`,
          path.join(resolved, "index.ts"),
          path.join(resolved, "index.tsx"),
          path.join(resolved, "index.js"),
        ];
        const found = candidates.find((c) => fs.existsSync(c) && !fs.statSync(c).isDirectory());
        if (found) imports.push(found);
      }
    }

    return imports;
  }
}

module.exports = {
  ArchitectureMapAnalyzer,
};
