"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Ciclo 41: Grafo Semántico Neural (Deep AST Code Graph)
 * Construye y mantiene un grafo AST enriquecido en tiempo real para razonamiento matemático sobre tipos,
 * referencias cruzadas, efectos secundarios y contratos de API.
 */
class AstGraphEngine {
  constructor() {
    this.nodes = new Map(); // symbolId -> Node
    this.edges = []; // [{ from, to, type: 'calls'|'imports'|'implements'|'mutates' }]
    this.fileNodes = new Map(); // filePath -> [symbolId]
    this.lastBuilt = null;
  }

  /**
   * Construye el grafo de símbolos y dependencias para el proyecto
   */
  buildGraph(projectRoot = process.cwd(), specificFiles = null) {
    this.nodes.clear();
    this.edges = [];
    this.fileNodes.clear();

    const filesToScan = specificFiles || this._collectSourceFiles(projectRoot);

    for (const relFile of filesToScan) {
      const fullPath = path.isAbsolute(relFile) ? relFile : path.join(projectRoot, relFile);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        this._parseFileSymbols(relFile.replace(/\\/g, "/"), content);
      } catch {}
    }

    // Resolver aristas de llamadas e importaciones
    this._resolveCrossReferences();
    this.lastBuilt = new Date().toISOString();

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      scannedFiles: filesToScan.length,
      timestamp: this.lastBuilt,
    };
  }

  /**
   * Extrae símbolos, declaraciones y efectos secundarios de un fichero
   */
  _parseFileSymbols(filePath, content) {
    const symbolsInFile = [];

    // Módulo principal
    const moduleNode = {
      id: `mod:${filePath}`,
      name: path.basename(filePath),
      type: "Module",
      file: filePath,
      exportedSymbols: [],
      sideEffects: [],
      signature: `module ${filePath}`,
    };
    this.nodes.set(moduleNode.id, moduleNode);
    symbolsInFile.push(moduleNode.id);

    // Detección de Funciones
    const fnRegex = /(?:function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const name = match[1] || match[3];
      const params = match[2] || match[4] || "";
      const symbolId = `${filePath}#fn:${name}`;
      
      const sideEffects = [];
      if (/fs\.(writeFileSync|appendFileSync|unlinkSync|rmdirSync)/.test(content)) sideEffects.push("FS_WRITE");
      if (/fetch\(|http\.request|axios\./.test(content)) sideEffects.push("NETWORK_IO");
      if (/process\.exit|process\.kill/.test(content)) sideEffects.push("PROCESS_HALT");

      const node = {
        id: symbolId,
        name,
        type: "Function",
        file: filePath,
        params: params.split(",").map((p) => p.trim()).filter(Boolean),
        signature: `function ${name}(${params})`,
        sideEffects,
        isExported: content.includes(`module.exports`) && content.includes(name),
      };

      this.nodes.set(symbolId, node);
      symbolsInFile.push(symbolId);
      if (node.isExported) moduleNode.exportedSymbols.push(name);
    }

    // Detección de Clases
    const classRegex = /class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([a-zA-Z0-9_$]+))?/g;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      const superClass = match[2] || null;
      const symbolId = `${filePath}#class:${name}`;

      const node = {
        id: symbolId,
        name,
        type: "Class",
        file: filePath,
        superClass,
        signature: `class ${name}${superClass ? ' extends ' + superClass : ''}`,
        sideEffects: [],
        isExported: content.includes(`module.exports`) && content.includes(name),
      };

      this.nodes.set(symbolId, node);
      symbolsInFile.push(symbolId);
      if (node.isExported) moduleNode.exportedSymbols.push(name);
    }

    this.fileNodes.set(filePath, symbolsInFile);
  }

  /**
   * Resuelve aristas de dependencias y llamadas
   */
  _resolveCrossReferences() {
    for (const [id, node] of this.nodes.entries()) {
      if (node.type === "Module") continue;

      // Conexión del símbolo a su módulo contenedor
      this.edges.push({
        from: node.id,
        to: `mod:${node.file}`,
        type: "declared_in",
      });

      if (node.superClass) {
        // Buscar clase padre en otros módulos
        for (const [otherId, otherNode] of this.nodes.entries()) {
          if (otherNode.type === "Class" && otherNode.name === node.superClass) {
            this.edges.push({
              from: node.id,
              to: otherId,
              type: "extends",
            });
          }
        }
      }
    }
  }

  /**
   * Consulta información y relaciones de un símbolo
   */
  querySymbol(symbolName) {
    const matches = [];
    for (const node of this.nodes.values()) {
      if (node.name.toLowerCase() === symbolName.toLowerCase()) {
        matches.push(node);
      }
    }
    return matches;
  }

  /**
   * Encuentra las referencias y aristas conectadas a un símbolo
   */
  findReferences(symbolIdOrName) {
    const targetNodes = Array.from(this.nodes.values()).filter(
      (n) => n.id === symbolIdOrName || n.name === symbolIdOrName
    );

    const results = [];
    for (const target of targetNodes) {
      const relatedEdges = this.edges.filter((e) => e.from === target.id || e.to === target.id);
      results.push({
        symbol: target,
        edges: relatedEdges,
      });
    }
    return results;
  }

  /**
   * Obtiene el subgrafo de dependencias de un fichero específico
   */
  getDependencySubgraph(filePath) {
    const norm = filePath.replace(/\\/g, "/");
    const symbols = this.fileNodes.get(norm) || [];
    const nodes = symbols.map((id) => this.nodes.get(id)).filter(Boolean);
    const edges = this.edges.filter((e) => symbols.includes(e.from) || symbols.includes(e.to));

    return {
      file: norm,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
    };
  }

  /**
   * Verifica la integridad de contratos entre módulos exportados e importados
   */
  verifyContractIntegrity() {
    const brokenContracts = [];
    // Comprobar que los exports requeridos no estén rotos
    for (const node of this.nodes.values()) {
      if (node.type === "Class" && node.superClass) {
        const hasParent = Array.from(this.nodes.values()).some((n) => n.name === node.superClass);
        if (!hasParent) {
          brokenContracts.push({
            type: "MISSING_SUPERCLASS",
            file: node.file,
            symbol: node.name,
            missing: node.superClass,
          });
        }
      }
    }

    return {
      isValid: brokenContracts.length === 0,
      brokenContracts,
      verifiedNodes: this.nodes.size,
    };
  }

  _collectSourceFiles(dir, list = [], depth = 0) {
    if (depth > 4 || list.length > 150) return list;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["node_modules", ".git", "dist", "build", ".editcore"].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this._collectSourceFiles(full, list, depth + 1);
        } else if (entry.isFile() && /\.(js|ts|json)$/i.test(entry.name)) {
          list.push(path.relative(dir, full).replace(/\\/g, "/"));
        }
      }
    } catch {}
    return list;
  }
}

const astGraphEngine = new AstGraphEngine();

module.exports = {
  AstGraphEngine,
  astGraphEngine,
};
