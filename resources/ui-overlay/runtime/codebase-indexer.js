"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Motor de Indexación Semántica y RAG Híbrido Local para Codebases Grandes tipo Cursor AI.
 * Trocea archivos en fragmentos por función/clase y genera un índice invertido TF-IDF + BM25 ligero.
 */

const INDEX_FILE = "codebase-index.json";
const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".vercel", ".cache"]);
const ALLOWED_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".html", ".css", ".json", ".sql", ".md", ".php", ".go", ".rs", ".java"]);

/**
 * Divide un archivo en chunks semánticos basados en funciones/clases o bloques de líneas.
 */
function chunkCodeFile(filePath = "", content = "", maxLinesPerChunk = 35) {
  const lines = String(content || "").split("\n");
  if (!lines.length) return [];

  const chunks = [];
  let currentChunkLines = [];
  let chunkStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBoundary = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|def|struct|enum)\s+[a-zA-Z0-9_$]+/i.test(line.trim());

    if (isBoundary && currentChunkLines.length >= 10) {
      chunks.push({
        file: filePath,
        startLine: chunkStartLine,
        endLine: i,
        content: currentChunkLines.join("\n"),
        tokens: tokenize(currentChunkLines.join(" ")),
      });
      currentChunkLines = [];
      chunkStartLine = i + 1;
    }

    currentChunkLines.push(line);

    if (currentChunkLines.length >= maxLinesPerChunk) {
      chunks.push({
        file: filePath,
        startLine: chunkStartLine,
        endLine: i + 1,
        content: currentChunkLines.join("\n"),
        tokens: tokenize(currentChunkLines.join(" ")),
      });
      currentChunkLines = [];
      chunkStartLine = i + 2;
    }
  }

  if (currentChunkLines.length) {
    chunks.push({
      file: filePath,
      startLine: chunkStartLine,
      endLine: lines.length,
      content: currentChunkLines.join("\n"),
      tokens: tokenize(currentChunkLines.join(" ")),
    });
  }

  return chunks;
}

/**
 * Tokeniza texto normalizando identificadores camelCase, snake_case y palabras clave.
 */
function tokenize(text = "") {
  const clean = String(text || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/[_\-./\\:;(){}[\]'",`<>!=+*&|?#]/g, " ")
    .toLowerCase();

  return clean
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 40);
}

/**
 * Construye el índice de un proyecto completo.
 */
function buildCodebaseIndex(projectRoot = "", maxFiles = 250) {
  const root = String(projectRoot || "").trim();
  if (!root || !fs.existsSync(root)) return { chunks: [], termDocs: {}, totalFiles: 0 };

  const files = [];
  scanFiles(root, files, maxFiles, root);

  const chunks = [];
  const termDocs = {}; // term -> array of chunk indices

  for (const rel of files) {
    try {
      const full = path.join(root, rel);
      const content = fs.readFileSync(full, "utf8");
      const fileChunks = chunkCodeFile(rel, content);

      for (const chunk of fileChunks) {
        const chunkIndex = chunks.length;
        chunks.push(chunk);

        const uniqueTerms = new Set(chunk.tokens);
        for (const term of uniqueTerms) {
          if (!termDocs[term]) termDocs[term] = [];
          termDocs[term].push(chunkIndex);
        }
      }
    } catch { /* ignore read errors */ }
  }

  const indexData = {
    updatedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalChunks: chunks.length,
    chunks,
    termDocs,
  };

  // Guardar en .editcore
  try {
    const editcoreDir = path.join(root, ".editcore");
    if (!fs.existsSync(editcoreDir)) fs.mkdirSync(editcoreDir, { recursive: true });
    fs.writeFileSync(path.join(editcoreDir, INDEX_FILE), JSON.stringify(indexData), "utf8");
  } catch { /* ignore persist errors */ }

  return indexData;
}

function scanFiles(dir, list, max, baseDir) {
  if (list.length >= max) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (list.length >= max) break;
      if (IGNORED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        scanFiles(full, list, max, baseDir);
      } else if (ent.isFile() && ALLOWED_EXTS.has(path.extname(ent.name).toLowerCase())) {
        list.push(rel);
      }
    }
  } catch { /* ignore */ }
}

/**
 * Consulta el índice semántico usando puntuación híbrida TF-IDF / BM25.
 */
function querySemanticCodebase(projectRoot = "", query = "", topK = 6) {
  const root = String(projectRoot || "").trim();
  let indexData = null;

  try {
    const indexPath = path.join(root, ".editcore", INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      indexData = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch { /* ignore */ }

  if (!indexData || !Array.isArray(indexData.chunks) || !indexData.chunks.length) {
    indexData = buildCodebaseIndex(root);
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const scores = new Map(); // chunkIndex -> score
  const totalChunks = Math.max(1, indexData.chunks.length);

  for (const token of queryTokens) {
    const matchedChunks = indexData.termDocs[token] || [];
    const idf = Math.log(1 + (totalChunks - matchedChunks.length + 0.5) / (matchedChunks.length + 0.5));

    for (const cIdx of matchedChunks) {
      const chunk = indexData.chunks[cIdx];
      if (!chunk) continue;
      const tf = chunk.tokens.filter((t) => t === token).length / Math.max(1, chunk.tokens.length);
      const score = (scores.get(cIdx) || 0) + tf * idf;
      scores.set(cIdx, score);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, topK))
    .map(([cIdx, score]) => {
      const chunk = indexData.chunks[cIdx];
      return {
        file: chunk.file,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        score: Number(score.toFixed(4)),
      };
    });

  return ranked;
}

/**
 * Actualiza incrementalmente un archivo individual en el índice.
 */
function updateFileInIndex(projectRoot = "", relativePath = "", content = "") {
  const root = String(projectRoot || "").trim();
  const rel = String(relativePath || "").replace(/\\/g, "/");
  const indexPath = path.join(root, ".editcore", INDEX_FILE);

  let indexData = null;
  try {
    if (fs.existsSync(indexPath)) {
      indexData = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch { /* ignore */ }

  if (!indexData) {
    return buildCodebaseIndex(root);
  }

  // Filtrar chunks antiguos de este archivo
  const remainingChunks = indexData.chunks.filter((c) => c.file !== rel);
  const newChunks = chunkCodeFile(rel, content);
  const combinedChunks = [...remainingChunks, ...newChunks];

  // Reconstruir termDocs
  const termDocs = {};
  for (let i = 0; i < combinedChunks.length; i++) {
    const chunk = combinedChunks[i];
    const uniqueTerms = new Set(chunk.tokens);
    for (const term of uniqueTerms) {
      if (!termDocs[term]) termDocs[term] = [];
      termDocs[term].push(i);
    }
  }

  indexData.chunks = combinedChunks;
  indexData.termDocs = termDocs;
  indexData.totalChunks = combinedChunks.length;
  indexData.updatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(indexPath, JSON.stringify(indexData), "utf8");
  } catch { /* ignore */ }

  return indexData;
}

/**
 * Extrae símbolos (exports, imports, funciones, clases, componentes) de código fuente.
 */
function extractSymbolsFromCode(filePath = "", content = "") {
  const lines = String(content || "").split("\n");
  const exports = [];
  const imports = [];
  const symbols = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Imports: import { Foo } from './Foo' or import Foo from './Foo'
    const importMatch = line.match(/^import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const importedNames = (importMatch[1] || importMatch[2] || "")
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
      imports.push({
        names: importedNames,
        source: importMatch[3],
        line: i + 1,
      });
    }

    // Exports: export function / const / class / type / interface / default
    const exportMatch = line.match(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([a-zA-Z0-9_$]+)/);
    if (exportMatch) {
      exports.push({
        name: exportMatch[1],
        line: i + 1,
        type: line.includes("function") ? "function" : (line.includes("class") ? "class" : (line.includes("interface") || line.includes("type") ? "type" : "const")),
      });
      symbols.push(exportMatch[1]);
    }
  }

  return { file: filePath, exports, imports, symbols };
}

/**
 * Construye el grafo de símbolos y dependencias del proyecto.
 */
function buildSymbolGraph(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  if (!root || !fs.existsSync(root)) return { fileMap: {}, symbolToFiles: {} };

  const files = [];
  scanFiles(root, files, 300, root);

  const fileMap = {}; // file -> { exports, imports, symbols }
  const symbolToFiles = {}; // symbol -> array of files that export it

  for (const rel of files) {
    try {
      const full = path.join(root, rel);
      const content = fs.readFileSync(full, "utf8");
      const data = extractSymbolsFromCode(rel, content);
      fileMap[rel] = data;

      for (const sym of data.symbols) {
        if (!symbolToFiles[sym]) symbolToFiles[sym] = [];
        symbolToFiles[sym].push(rel);
      }
    } catch { /* ignore */ }
  }

  return { fileMap, symbolToFiles };
}

/**
 * Encuentra símbolos y archivos estrechamente relacionados con una consulta o archivo.
 */
function findRelatedSymbolsAndFiles(projectRoot = "", queryOrFile = "", graph = null) {
  const activeGraph = graph || buildSymbolGraph(projectRoot);
  const target = String(queryOrFile || "").replace(/\\/g, "/").toLowerCase();
  const relatedFiles = new Set();
  const relatedSymbols = new Set();

  for (const [file, data] of Object.entries(activeGraph.fileMap || {})) {
    const fileLower = file.toLowerCase();
    const isTargetFile = fileLower.includes(target) || target.includes(fileLower);

    if (isTargetFile) {
      // Agregar todas sus importaciones
      for (const imp of data.imports) {
        for (const name of imp.names) {
          relatedSymbols.add(name);
          const sourceFiles = activeGraph.symbolToFiles[name] || [];
          for (const sf of sourceFiles) relatedFiles.add(sf);
        }
      }
    }

    // Coincidencias por nombre de símbolo
    for (const exp of data.exports) {
      if (target.includes(exp.name.toLowerCase())) {
        relatedSymbols.add(exp.name);
        relatedFiles.add(file);
      }
    }
  }

  return {
    relatedFiles: [...relatedFiles].slice(0, 10),
    relatedSymbols: [...relatedSymbols].slice(0, 15),
  };
}

module.exports = {
  chunkCodeFile,
  tokenize,
  buildCodebaseIndex,
  querySemanticCodebase,
  updateFileInIndex,
  extractSymbolsFromCode,
  buildSymbolGraph,
  findRelatedSymbolsAndFiles,
};

