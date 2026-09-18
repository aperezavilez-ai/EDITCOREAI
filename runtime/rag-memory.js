const fs = require('fs');
const path = require('path');
const os = require('os');

const RAG_INDEX_PATH = path.join(os.homedir(), '.editcore', 'rag-index.json');
const DEFAULT_WORKSPACE = process.cwd();

let indexState = {
  workspace: DEFAULT_WORKSPACE,
  lastIndexedAt: null,
  fileCount: 0,
  chunkCount: 0,
  model: 'local-embeddings',
  chunks: [],
};

function ensureIndexDir() {
  const dir = path.dirname(RAG_INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadIndex() {
  try {
    if (fs.existsSync(RAG_INDEX_PATH)) {
      const raw = fs.readFileSync(RAG_INDEX_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      indexState = { ...indexState, ...parsed };
    }
  } catch (e) {
    indexState = {
      workspace: DEFAULT_WORKSPACE,
      lastIndexedAt: null,
      fileCount: 0,
      chunkCount: 0,
      model: 'local-embeddings',
      chunks: [],
    };
  }
}

function saveIndex() {
  ensureIndexDir();
  fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify(indexState, null, 2), 'utf8');
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
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

function buildEmbedding(text, dimensions = 64) {
  const tokens = tokenize(text);
  const embedding = new Array(dimensions).fill(0);
  if (tokens.length === 0) return embedding;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let hash = 0;
    for (let j = 0; j < token.length; j++) {
      hash = (hash * 31 + token.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    embedding[idx] += 1 / (i + 1);
  }

  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
  return embedding.map((v) => v / magnitude);
}

function chunkText(text, maxChunkSize = 800, overlap = 120) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start + maxChunkSize * 0.5) end = lastNewline + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const allowed = ['.js', '.ts', '.json', '.md', '.txt', '.html', '.css', '.yaml', '.yml', '.sh', '.bat', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'];
  if (allowed.includes(ext)) return true;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) return false;
    const buf = fs.readFileSync(filePath);
    const sample = buf.slice(0, 512);
    return !sample.includes(0x00);
  } catch {
    return false;
  }
}

function walkWorkspace(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isTextFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function indexWorkspace(workspace = DEFAULT_WORKSPACE) {
  const files = walkWorkspace(workspace);
  const chunks = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const relative = path.relative(workspace, file);
      const textChunks = chunkText(content);
      for (const chunk of textChunks) {
        chunks.push({
          id: `${relative}::${chunks.length}`,
          file: relative,
          text: chunk,
          embedding: buildEmbedding(chunk),
        });
      }
    } catch {
      // skip unreadable files
    }
  }

  indexState = {
    workspace,
    lastIndexedAt: new Date().toISOString(),
    fileCount: files.length,
    chunkCount: chunks.length,
    model: 'local-embeddings',
    chunks,
  };
  saveIndex();
  return indexState;
}

function querySemantic(query, topK = 5) {
  if (!indexState.chunks || indexState.chunks.length === 0) return [];
  const queryEmbedding = buildEmbedding(query);
  const scored = indexState.chunks.map((chunk) => ({
    id: chunk.id,
    file: chunk.file,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter((item) => item.score > 0.05);
}

function getIndexStatus() {
  return {
    workspace: indexState.workspace,
    lastIndexedAt: indexState.lastIndexedAt,
    fileCount: indexState.fileCount,
    chunkCount: indexState.chunkCount,
    model: indexState.model,
  };
}

function clearCache() {
  indexState.chunks = [];
  indexState.lastIndexedAt = null;
  indexState.fileCount = 0;
  indexState.chunkCount = 0;
  saveIndex();
}

loadIndex();

module.exports = {
  indexWorkspace,
  querySemantic,
  getIndexStatus,
  clearCache,
};
