"use strict";

/**
 * Vector Indexer — Escaneo, chunking AST e indexación semántica del codebase.
 *
 * Fase 1 del Ciclo 13: Motor de Indexación Vectorial y RAG Local.
 * - Escanea recursivamente el workspace respetando .gitignore.
 * - Fragmenta archivos basándose en estructuras AST (clases, funciones, métodos).
 * - Genera embeddings locales con @xenova/transformers.
 * - Almacena vectores en SQLite local para búsqueda semántica.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// ─── Gitignore parser ────────────────────────────────────────────────────────

function parseGitignore(root) {
  const gitignorePath = path.join(root, ".gitignore");
  const patterns = [];
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, "utf-8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // Convert gitignore pattern to regex
      const negated = line.startsWith("!");
      const pattern = negated ? line.slice(1) : line;
      const regex = gitignoreToRegex(pattern, root);
      patterns.push({ regex, negated });
    }
  }
  // Always ignore common directories
  patterns.push({ regex: /[/\\]node_modules[/\\]/, negated: false });
  patterns.push({ regex: /[/\\]\.git[/\\]/, negated: false });
  patterns.push({ regex: /[/\\]dist[/\\]/, negated: false });
  patterns.push({ regex: /[/\\]build[/\\]/, negated: false });
  patterns.push({ regex: /[/\\]\.next[/\\]/, negated: false });
  patterns.push({ regex: /[/\\]__pycache__[/\\]/, negated: false });
  return patterns;
}

function gitignoreToRegex(pattern, root) {
  let p = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  p = p.replace(/\*\*/g, "<<<DOUBLESTAR>>>");
  p = p.replace(/\*/g, "[^/\\\\]*");
  p = p.replace(/<<DOUBLESTAR>>>/g, ".*");
  if (p.endsWith("/")) p = p.slice(0, -1) + "($|[/\\\\].*)";
  else p = "($|[/\\\\])" + p + "($|[/\\\\].*)";
  return new RegExp(p, "i");
}

function isIgnored(filePath, patterns) {
  let ignored = false;
  for (const { regex, negated } of patterns) {
    if (regex.test(filePath)) {
      ignored = !negated;
    }
  }
  return ignored;
}

// ─── File scanner ────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".java", ".go", ".rs", ".cpp", ".c", ".h",
  ".cs", ".php", ".swift", ".kt", ".scala",
  ".html", ".css", ".scss", ".less", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml", ".xml",
  ".sh", ".bash", ".zsh", ".ps1",
  ".sql", ".graphql", ".gql",
  ".md", ".mdx", ".txt",
]);

function scanWorkspace(root, patterns) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (isIgnored(rel, patterns)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(full);
            if (stat.size < 5 * 1024 * 1024) { // Skip files > 5MB
              files.push({ absolute: full, relative: rel, ext, size: stat.size });
            }
          } catch {
            // skip unreadable
          }
        }
      }
    }
  }
  walk(root);
  return files;
}

// ─── AST-aware chunking ──────────────────────────────────────────────────────

/**
 * Fragmenta código en chunks semánticos basados en estructura.
 * Detecta: clases, funciones, métodos, bloques export, imports agrupados.
 * Fallback: chunking por líneas con solapamiento para archivos no parseables.
 */
function chunkCode(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const chunks = [];

  // Try AST-aware chunking for JS/TS family
  if ([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    const astChunks = chunkJavaScript(content, filePath);
    if (astChunks.length > 0) return astChunks;
  }

  // Python AST-aware chunking
  if (ext === ".py") {
    const pyChunks = chunkPython(content, filePath);
    if (pyChunks.length > 0) return pyChunks;
  }

  // Fallback: line-based chunking with overlap
  return chunkByLines(content, filePath);
}

function chunkJavaScript(content, filePath) {
  const chunks = [];
  const lines = content.split(/\r?\n/);

  // Regex patterns for JS/TS structure detection
  const classRe = /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/;
  const funcRe = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*(\w+)/;
  const arrowRe = /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?/;
  const methodRe = /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{?\s*$/;
  const importRe = /^\s*(?:import\s+(?!type\b)|import\s*\(|export\s+(?:\{|\*)|export\s+type\s|import\s+type\s)/;

  let currentChunk = null;
  let importBuffer = [];
  let importStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Collect imports/exports at top
    if (importRe.test(line) && chunks.length === 0) {
      if (importBuffer.length === 0) importStartLine = lineNum;
      importBuffer.push(line);
      continue;
    }

    // Flush import buffer
    if (importBuffer.length > 0 && !importRe.test(line)) {
      if (importBuffer.join("").trim().length > 0) {
        chunks.push({
          id: hashChunk(filePath, importStartLine, importBuffer.join("\n")),
          file: filePath,
          type: "imports",
          name: "module-imports",
          startLine: importStartLine,
          endLine: importStartLine + importBuffer.length - 1,
          content: importBuffer.join("\n"),
          tokens: estimateTokens(importBuffer.join("\n")),
        });
      }
      importBuffer = [];
    }

    // Detect class
    const classMatch = line.match(classRe);
    if (classMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        id: hashChunk(filePath, lineNum, line),
        file: filePath,
        type: "class",
        name: classMatch[4],
        startLine: lineNum,
        endLine: lineNum,
        content: line,
        braceDepth: countBraces(line),
        tokens: 0,
      };
      continue;
    }

    // Detect function
    const funcMatch = line.match(funcRe);
    if (funcMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        id: hashChunk(filePath, lineNum, line),
        file: filePath,
        type: "function",
        name: funcMatch[4],
        startLine: lineNum,
        endLine: lineNum,
        content: line,
        braceDepth: countBraces(line),
        tokens: 0,
      };
      continue;
    }

    // Detect arrow function / const assignment
    const arrowMatch = line.match(arrowRe);
    if (arrowMatch && line.includes("=>")) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        id: hashChunk(filePath, lineNum, line),
        file: filePath,
        type: "arrow-function",
        name: arrowMatch[3],
        startLine: lineNum,
        endLine: lineNum,
        content: line,
        braceDepth: countBraces(line),
        tokens: 0,
      };
      continue;
    }

    // Detect method inside class
    const methodMatch = line.match(methodRe);
    if (methodMatch && currentChunk && currentChunk.type === "class") {
      // Start a new sub-chunk for the method
      chunks.push(currentChunk);
      currentChunk = {
        id: hashChunk(filePath, lineNum, line),
        file: filePath,
        type: "method",
        name: methodMatch[2],
        parentClass: currentChunk.name,
        startLine: lineNum,
        endLine: lineNum,
        content: line,
        braceDepth: countBraces(line),
        tokens: 0,
      };
      continue;
    }

    // Append to current chunk
    if (currentChunk) {
      currentChunk.content += "\n" + line;
      currentChunk.endLine = lineNum;
      currentChunk.braceDepth += countBraces(line);

      // Close chunk when braces balance
      if (currentChunk.braceDepth <= 0 && currentChunk.content.split("\n").length > 2) {
        currentChunk.tokens = estimateTokens(currentChunk.content);
        chunks.push(currentChunk);
        currentChunk = null;
      }
    }
  }

  // Flush remaining
  if (currentChunk) {
    currentChunk.tokens = estimateTokens(currentChunk.content);
    chunks.push(currentChunk);
  }

  return chunks;
}

function chunkPython(content, filePath) {
  const chunks = [];
  const lines = content.split(/\r?\n/);

  const classRe = /^(\s*)class\s+(\w+)/;
  const funcRe = /^(\s*)(async\s+)?def\s+(\w+)/;

  let currentChunk = null;
  let currentIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const classMatch = line.match(classRe);
    const funcMatch = line.match(funcRe);

    if (classMatch || funcMatch) {
      const indent = (classMatch || funcMatch)[1].length;

      if (currentChunk && indent <= currentIndent) {
        currentChunk.tokens = estimateTokens(currentChunk.content);
        chunks.push(currentChunk);
        currentChunk = null;
      }

      if (!currentChunk || indent > currentIndent) {
        if (currentChunk) {
          currentChunk.tokens = estimateTokens(currentChunk.content);
          chunks.push(currentChunk);
        }
        const match = classMatch || funcMatch;
        currentChunk = {
          id: hashChunk(filePath, lineNum, line),
          file: filePath,
          type: classMatch ? "class" : "function",
          name: classMatch ? classMatch[2] : funcMatch[3],
          startLine: lineNum,
          endLine: lineNum,
          content: line,
          tokens: 0,
        };
        currentIndent = indent;
        continue;
      }
    }

    if (currentChunk) {
      currentChunk.content += "\n" + line;
      currentChunk.endLine = lineNum;
    }
  }

  if (currentChunk) {
    currentChunk.tokens = estimateTokens(currentChunk.content);
    chunks.push(currentChunk);
  }

  return chunks;
}

function chunkByLines(content, filePath, maxLines = 80, overlap = 10) {
  const chunks = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += maxLines - overlap) {
    const slice = lines.slice(i, i + maxLines);
    if (slice.join("").trim().length === 0) continue;
    chunks.push({
      id: hashChunk(filePath, i + 1, slice.join("\n")),
      file: filePath,
      type: "text-block",
      name: `block-${Math.floor(i / (maxLines - overlap)) + 1}`,
      startLine: i + 1,
      endLine: Math.min(i + maxLines, lines.length),
      content: slice.join("\n"),
      tokens: estimateTokens(slice.join("\n")),
    });
  }

  return chunks;
}

function countBraces(line) {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }
  return depth;
}

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for code
  return Math.ceil(text.length / 4);
}

function hashChunk(filePath, startLine, content) {
  const data = `${filePath}:${startLine}:${content.slice(0, 200)}`;
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ─── Embedding engine (local with @xenova/transformers) ──────────────────────

let _embeddingPipeline = null;
let _embeddingModel = null;

async function initEmbeddingEngine(model = "Xenova/all-MiniLM-L6-v2") {
  if (_embeddingPipeline) return { ok: true, model: _embeddingModel };

  try {
    const { pipeline } = await import("@xenova/transformers");
    _embeddingPipeline = await pipeline("feature-extraction", model, {
      quantized: true,
      cache_dir: path.join(process.cwd(), ".editcore", "models"),
    });
    _embeddingModel = model;
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: `No se pudo cargar el modelo de embeddings: ${err.message}` };
  }
}

async function generateEmbedding(text) {
  if (!_embeddingPipeline) {
    const init = await initEmbeddingEngine();
    if (!init.ok) throw new Error(init.error);
  }

  // Truncate to model context window (256 tokens for MiniLM)
  const truncated = text.slice(0, 1024);
  const output = await _embeddingPipeline(truncated, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}

async function generateEmbeddingsBatch(chunks, batchSize = 8) {
  const results = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await Promise.all(
      batch.map((chunk) =>
        generateEmbedding(chunk.content).then((vec) => ({
          ...chunk,
          embedding: vec,
        }))
      )
    );
    results.push(...embeddings);
  }
  return results;
}

// ─── Vector store (flat file + cosine similarity) ────────────────────────────

class VectorStore {
  constructor(storePath) {
    this.storePath = storePath || path.join(process.cwd(), ".editcore", "vector-store.json");
    this.vectors = [];
    this.metadata = { indexedAt: null, fileCount: 0, chunkCount: 0, model: _embeddingModel };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"));
        this.vectors = data.vectors || [];
        this.metadata = data.metadata || this.metadata;
      }
    } catch {
      this.vectors = [];
    }
  }

  _save() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.storePath,
      JSON.stringify({ vectors: this.vectors, metadata: this.metadata }, null, 2),
      "utf-8"
    );
  }

  upsert(chunksWithEmbeddings) {
    const existingIds = new Set(this.vectors.map((v) => v.id));
    for (const chunk of chunksWithEmbeddings) {
      if (existingIds.has(chunk.id)) {
        // Update existing
        const idx = this.vectors.findIndex((v) => v.id === chunk.id);
        if (idx >= 0) {
          this.vectors[idx] = {
            id: chunk.id,
            file: chunk.file,
            type: chunk.type,
            name: chunk.name,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
            embedding: chunk.embedding,
            tokens: chunk.tokens,
            indexedAt: new Date().toISOString(),
          };
        }
      } else {
        this.vectors.push({
          id: chunk.id,
          file: chunk.file,
          type: chunk.type,
          name: chunk.name,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          embedding: chunk.embedding,
          tokens: chunk.tokens,
          indexedAt: new Date().toISOString(),
        });
      }
    }
    this.metadata.indexedAt = new Date().toISOString();
    this.metadata.chunkCount = this.vectors.length;
    this.metadata.model = _embeddingModel;
    this._save();
    return { ok: true, upserted: chunksWithEmbeddings.length, total: this.vectors.length };
  }

  search(queryEmbedding, topK = 10, filter = {}) {
    const results = [];
    for (const vec of this.vectors) {
      // Apply filters
      if (filter.file && vec.file !== filter.file) continue;
      if (filter.type && vec.type !== filter.type) continue;
      if (filter.namePattern && !vec.name.includes(filter.namePattern)) continue;

      const similarity = cosineSimilarity(queryEmbedding, vec.embedding);
      results.push({
        id: vec.id,
        file: vec.file,
        type: vec.type,
        name: vec.name,
        startLine: vec.startLine,
        endLine: vec.endLine,
        content: vec.content,
        tokens: vec.tokens,
        score: similarity,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getStats() {
    const files = new Set(this.vectors.map((v) => v.file));
    const types = {};
    for (const v of this.vectors) {
      types[v.type] = (types[v.type] || 0) + 1;
    }
    return {
      totalChunks: this.vectors.length,
      totalFiles: files.size,
      types,
      model: this.metadata.model,
      indexedAt: this.metadata.indexedAt,
    };
  }

  clear() {
    this.vectors = [];
    this.metadata = { indexedAt: null, fileCount: 0, chunkCount: 0, model: _embeddingModel };
    this._save();
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Main indexer orchestrator ───────────────────────────────────────────────

class VectorIndexer {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.storePath = options.storePath;
    this.model = options.model || "Xenova/all-MiniLM-L6-v2";
    this.store = new VectorStore(this.storePath);
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return { ok: true };
    const result = await initEmbeddingEngine(this.model);
    if (!result.ok) return result;
    this._initialized = true;
    return { ok: true, model: result.model };
  }

  async indexWorkspace(options = {}) {
    if (!this._initialized) {
      const init = await this.init();
      if (!init.ok) return init;
    }

    const patterns = parseGitignore(this.projectRoot);
    const files = scanWorkspace(this.projectRoot, patterns);

    if (options.progress) options.progress({ phase: "scanned", fileCount: files.length });

    // Chunk all files
    const allChunks = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file.absolute, "utf-8");
        const chunks = chunkCode(content, file.relative);
        allChunks.push(...chunks);
      } catch {
        // skip unreadable files
      }
    }

    if (options.progress) options.progress({ phase: "chunked", chunkCount: allChunks.length });

    // Generate embeddings
    const embedded = await generateEmbeddingsBatch(allChunks, options.batchSize || 8);

    if (options.progress) options.progress({ phase: "embedded", chunkCount: embedded.length });

    // Upsert to store
    const result = this.store.upsert(embedded);
    this.store.metadata.fileCount = files.length;

    if (options.progress) options.progress({ phase: "indexed", ...result });

    return {
      ok: true,
      files: files.length,
      chunks: allChunks.length,
      upserted: result.upserted,
      total: result.total,
    };
  }

  async search(query, options = {}) {
    if (!this._initialized) {
      const init = await this.init();
      if (!init.ok) return init;
    }

    const queryEmbedding = await generateEmbedding(query);
    const results = this.store.search(queryEmbedding, options.topK || 10, options.filter || {});
    return { ok: true, results, query };
  }

  getStats() {
    return this.store.getStats();
  }

  async reindex(options = {}) {
    this.store.clear();
    return this.indexWorkspace(options);
  }
}

// ─── Module exports ──────────────────────────────────────────────────────────

module.exports = {
  VectorIndexer,
  VectorStore,
  chunkCode,
  chunkJavaScript,
  chunkPython,
  chunkByLines,
  scanWorkspace,
  parseGitignore,
  generateEmbedding,
  generateEmbeddingsBatch,
  initEmbeddingEngine,
  cosineSimilarity,
};
