"use strict";

const fs = require("node:fs");
const path = require("node:path");

let ts = null;
try {
  ts = require("typescript");
} catch {
  ts = null;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage",
  "out", "tmp", "temp", ".cache", "release", "win-unpacked",
]);

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Cache en memoria por archivo y timestamp de modificación
const graphCache = new Map();

/**
 * Extrae símbolos de un único archivo mediante el AST de TypeScript.
 */
function analyzeCodeSymbols(filePath, content) {
  const result = {
    filePath: filePath.replace(/\\/g, "/"),
    exports: [],
    imports: [],
    definitions: [],
  };

  if (!content || typeof content !== "string" || !ts) {
    return result;
  }

  const ext = path.extname(filePath).toLowerCase();
  const scriptKind = ext === ".tsx" ? ts.ScriptKind.TSX
    : ext === ".jsx" ? ts.ScriptKind.JSX
    : ext === ".ts" ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;

  let sf;
  try {
    sf = ts.createSourceFile(path.basename(filePath), content, ts.ScriptTarget.Latest, true, scriptKind);
  } catch {
    return result;
  }

  function getLine(pos) {
    try {
      return ts.getLineAndCharacterOfPosition(sf, pos).line + 1;
    } catch {
      return 1;
    }
  }

  function isExported(node) {
    if (!node.modifiers) return false;
    return node.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  function isDefaultExport(node) {
    if (!node.modifiers) return false;
    return node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  }

  function visit(node) {
    // 1. Declaraciones de funciones
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const exported = isExported(node);
      const isDefault = isDefaultExport(node);
      const line = getLine(node.getStart(sf));
      const sym = { name, kind: "function", line, exported, isDefault };
      result.definitions.push(sym);
      if (exported) result.exports.push(sym);
    }
    // 2. Declaraciones de clases
    else if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const exported = isExported(node);
      const isDefault = isDefaultExport(node);
      const line = getLine(node.getStart(sf));
      const sym = { name, kind: "class", line, exported, isDefault };
      result.definitions.push(sym);
      if (exported) result.exports.push(sym);
    }
    // 3. Declaraciones de interfaces
    else if (ts.isInterfaceDeclaration(node) && node.name) {
      const name = node.name.text;
      const exported = isExported(node);
      const line = getLine(node.getStart(sf));
      const sym = { name, kind: "interface", line, exported };
      result.definitions.push(sym);
      if (exported) result.exports.push(sym);
    }
    // 4. Alias de tipos (type X = ...)
    else if (ts.isTypeAliasDeclaration(node) && node.name) {
      const name = node.name.text;
      const exported = isExported(node);
      const line = getLine(node.getStart(sf));
      const sym = { name, kind: "type", line, exported };
      result.definitions.push(sym);
      if (exported) result.exports.push(sym);
    }
    // 5. Variables exportadas (const X =, export const Y =)
    else if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const line = getLine(decl.getStart(sf));
          const sym = { name, kind: "variable", line, exported };
          result.definitions.push(sym);
          if (exported) result.exports.push(sym);
        }
      }
    }
    // 6. Sentencias de importación (import { a, b } from "x", import x from "x")
    else if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      const line = getLine(node.getStart(sf));
      const importedSymbols = [];
      if (node.importClause) {
        if (node.importClause.name) {
          importedSymbols.push({ name: node.importClause.name.text, isDefault: true });
        }
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const el of node.importClause.namedBindings.elements) {
              importedSymbols.push({
                name: el.name.text,
                propertyName: el.propertyName ? el.propertyName.text : null,
              });
            }
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            importedSymbols.push({
              name: node.importClause.namedBindings.name.text,
              isNamespace: true,
            });
          }
        }
      }
      result.imports.push({
        module: moduleSpecifier,
        line,
        symbols: importedSymbols,
      });
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);
  return result;
}

/**
 * Explora el proyecto y genera el grafo de símbolos y dependencias.
 */
function buildProjectSymbolGraph(projectRoot, { maxFiles = 500 } = {}) {
  const root = path.resolve(projectRoot || ".");
  const filesList = [];

  function walk(currentDir, depth = 0) {
    if (depth > 8 || filesList.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          filesList.push(fullPath);
          if (filesList.length >= maxFiles) break;
        }
      }
    }
  }

  walk(root);

  const fileMap = new Map();
  const symbolIndex = new Map(); // symbol -> [{ filePath, kind, line, exported }]
  const referenceIndex = new Map(); // symbol -> Set(filePaths que lo importan)

  for (const absPath of filesList) {
    const rel = path.relative(root, absPath).replace(/\\/g, "/");
    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      continue;
    }

    const cacheKey = `${rel}:${stat.mtimeMs}`;
    let analysis;
    if (graphCache.has(cacheKey)) {
      analysis = graphCache.get(cacheKey);
    } else {
      try {
        const content = fs.readFileSync(absPath, "utf8");
        analysis = analyzeCodeSymbols(rel, content);
        graphCache.set(cacheKey, analysis);
      } catch {
        continue;
      }
    }

    fileMap.set(rel, analysis);

    // Indexar definiciones
    for (const def of analysis.definitions) {
      if (!symbolIndex.has(def.name)) {
        symbolIndex.set(def.name, []);
      }
      symbolIndex.get(def.name).push({
        filePath: rel,
        kind: def.kind,
        line: def.line,
        exported: def.exported,
      });
    }

    // Indexar referencias cruzadas
    for (const imp of analysis.imports) {
      for (const s of imp.symbols) {
        const symName = s.propertyName || s.name;
        if (!referenceIndex.has(symName)) {
          referenceIndex.set(symName, new Set());
        }
        referenceIndex.get(symName).add(rel);
      }
    }
  }

  return {
    root,
    totalFilesIndexed: fileMap.size,
    findSymbol(symbolName) {
      let defs = symbolIndex.get(symbolName) || [];
      if (!defs.length) {
        const target = String(symbolName || "").toLowerCase();
        for (const [name, list] of symbolIndex.entries()) {
          if (name.toLowerCase() === target) {
            defs = list;
            symbolName = name;
            break;
          }
        }
      }
      const refs = Array.from(referenceIndex.get(symbolName) || []);
      return {
        symbol: symbolName,
        definitions: defs,
        importedBy: refs,
      };
    },
    searchSymbols(query = "", limit = 20) {
      const q = String(query || "").trim().toLowerCase();
      const results = [];
      for (const [name, defs] of symbolIndex.entries()) {
        if (!q || name.toLowerCase().includes(q)) {
          const refs = referenceIndex.get(name);
          results.push({
            name,
            definitions: defs,
            importedByCount: refs ? refs.size : 0,
          });
          if (results.length >= limit) break;
        }
      }
      return results;
    },
    getFileDependencies(relPath) {
      const norm = String(relPath || "").replace(/\\/g, "/");
      const file = fileMap.get(norm);
      if (!file) return null;
      // Archivos que importan este archivo
      const callers = [];
      for (const [otherPath, otherAnalysis] of fileMap.entries()) {
        if (otherPath === norm) continue;
        const importsTarget = otherAnalysis.imports.some((imp) => {
          const mod = imp.module.replace(/^[./\\]+/, "");
          const targetBase = norm.replace(/\.[^/.]+$/, "").replace(/^[./\\]+/, "");
          return mod.includes(targetBase) || targetBase.includes(mod);
        });
        if (importsTarget) {
          callers.push(otherPath);
        }
      }
      return {
        filePath: norm,
        exports: file.exports,
        imports: file.imports,
        importedByFiles: callers,
      };
    },
  };
}

module.exports = {
  analyzeCodeSymbols,
  buildProjectSymbolGraph,
};
