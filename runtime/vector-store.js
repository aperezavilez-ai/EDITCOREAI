/**
 * runtime/vector-store.js
 * EditCoreAI - Motor de Vectores Locales y Búsqueda Semántica RAG (Ciclo 33)
 */

const fs = require("fs");
const path = require("path");

class VectorStore {
  constructor(options = {}) {
    this.indexes = new Map(); // projectRoot -> { chunks: Array, updatedAt: string }
    this.indexPath = options.indexPath || ".editcore/vector-index.json";
    this.defaultChunkSize = options.chunkSize || 300;
    this.defaultOverlap = options.overlap || 50;
  }

  /**
   * Tokeniza y genera un vector de frecuencias normalizado (TF-IDF ligero / Bag-of-Words)
   */
  generateEmbedding(text = "") {
    if (!text || typeof text !== "string") return {};

    const clean = text
      .toLowerCase()
      .replace(/[^a-z0-9_$#@]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    const freq = {};
    for (const word of clean) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Normalización de magnitud L2
    let magnitudeSq = 0;
    for (const count of Object.values(freq)) {
      magnitudeSq += count * count;
    }
    const magnitude = Math.sqrt(magnitudeSq) || 1;

    const normalized = {};
    for (const [word, count] of Object.entries(freq)) {
      normalized[word] = Number((count / magnitude).toFixed(5));
    }

    return normalized;
  }

  /**
   * Calcula la similitud de coseno entre dos vectores dispersos normalizados
   */
  cosineSimilarity(vecA = {}, vecB = {}) {
    if (!vecA || !vecB) return 0;

    let dotProduct = 0;
    // Como los vectores están normalizados a magnitud 1, el producto punto es el coseno directo
    const keysA = Object.keys(vecA);
    const keysB = Object.keys(vecB);

    const smaller = keysA.length < keysB.length ? vecA : vecB;
    const larger = smaller === vecA ? vecB : vecA;

    for (const [key, val] of Object.entries(smaller)) {
      if (larger[key]) {
        dotProduct += val * larger[key];
      }
    }

    return Number(dotProduct.toFixed(5));
  }

  /**
   * Fragmenta el contenido de un archivo en trozos semánticos (chunking)
   */
  chunkDocument(filePath = "", content = "", options = {}) {
    if (!content) return [];

    const chunkSize = options.chunkSize || this.defaultChunkSize;
    const overlap = options.overlap || this.defaultOverlap;

    const lines = content.split(/\r?\n/);
    const chunks = [];

    let currentChunkLines = [];
    let currentChunkLength = 0;
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunkLines.push(line);
      currentChunkLength += line.length + 1;

      if (currentChunkLength >= chunkSize || i === lines.length - 1) {
        const text = currentChunkLines.join("\n");
        const embedding = this.generateEmbedding(text);

        chunks.push({
          id: `chunk_${chunks.length + 1}`,
          filePath,
          startLine,
          endLine: i + 1,
          content: text,
          embedding,
          length: text.length,
        });

        // Calcular overlap para el siguiente chunk
        const overlapLineCount = Math.max(1, Math.floor(currentChunkLines.length * (overlap / chunkSize)));
        currentChunkLines = currentChunkLines.slice(-overlapLineCount);
        currentChunkLength = currentChunkLines.join("\n").length;
        startLine = i + 2 - currentChunkLines.length;
      }
    }

    return chunks;
  }

  /**
   * Indexa un proyecto completo o una lista de archivos
   */
  indexProject(projectRoot, fileList = []) {
    if (!projectRoot) return { indexedCount: 0, totalChunks: 0 };

    const allChunks = [];
    const filesToIndex = Array.isArray(fileList) && fileList.length > 0
      ? fileList
      : this._scanProjectFiles(projectRoot);

    for (const file of filesToIndex) {
      const fullPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
      const relPath = path.isAbsolute(file) ? path.relative(projectRoot, file).replace(/\\/g, "/") : file;

      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const chunks = this.chunkDocument(relPath, content);
          allChunks.push(...chunks);
        } catch {
          // Ignorar archivo bloqueado
        }
      }
    }

    const indexData = {
      projectRoot,
      updatedAt: new Date().toISOString(),
      fileCount: filesToIndex.length,
      chunks: allChunks,
    };

    this.indexes.set(projectRoot, indexData);
    this.saveIndex(projectRoot);

    return {
      projectRoot,
      fileCount: filesToIndex.length,
      totalChunks: allChunks.length,
      indexedAt: indexData.updatedAt,
    };
  }

  /**
   * Realiza una búsqueda semántica de los chunks más similares
   */
  searchSimilar(projectRoot, query = "", options = {}) {
    if (!query) return [];

    let indexData = this.indexes.get(projectRoot);
    if (!indexData) {
      indexData = this.loadIndex(projectRoot);
    }

    if (!indexData || !Array.isArray(indexData.chunks) || indexData.chunks.length === 0) {
      return [];
    }

    const queryEmbedding = this.generateEmbedding(query);
    const topK = options.topK || 5;
    const threshold = options.threshold !== undefined ? options.threshold : 0.05;

    const scored = indexData.chunks.map((chunk) => {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      return {
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score,
        content: chunk.content,
      };
    });

    return scored
      .filter((item) => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Guarda el índice vectorial en .editcore/vector-index.json
   */
  saveIndex(projectRoot) {
    const data = this.indexes.get(projectRoot);
    if (!data || !projectRoot) return false;

    try {
      const targetDir = path.join(projectRoot, ".editcore");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const targetFile = path.join(projectRoot, this.indexPath);
      fs.writeFileSync(targetFile, JSON.stringify(data, null, 2), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Carga el índice vectorial desde el disco
   */
  loadIndex(projectRoot) {
    if (!projectRoot) return null;

    const targetFile = path.join(projectRoot, this.indexPath);
    if (fs.existsSync(targetFile)) {
      try {
        const raw = fs.readFileSync(targetFile, "utf-8");
        const parsed = JSON.parse(raw);
        this.indexes.set(projectRoot, parsed);
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Devuelve estadísticas del Vector Store para un proyecto
   */
  getStats(projectRoot) {
    let indexData = this.indexes.get(projectRoot) || this.loadIndex(projectRoot);
    if (!indexData) {
      return { indexed: false, totalChunks: 0, fileCount: 0 };
    }

    return {
      indexed: true,
      fileCount: indexData.fileCount || 0,
      totalChunks: indexData.chunks?.length || 0,
      updatedAt: indexData.updatedAt || null,
    };
  }

  /**
   * Escaneo auxiliar de archivos de código del proyecto
   */
  _scanProjectFiles(dir, fileList = [], depth = 0) {
    if (depth > 5) return fileList;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["node_modules", ".git", ".editcore", "dist", "build"].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this._scanProjectFiles(fullPath, fileList, depth + 1);
        } else if (entry.isFile() && /\.(js|ts|json|md|py|html|css)$/i.test(entry.name)) {
          fileList.push(fullPath);
        }
      }
    } catch {
      // Ignorar error de lectura
    }

    return fileList;
  }
}

const vectorStoreInstance = new VectorStore();

module.exports = {
  VectorStore,
  vectorStore: vectorStoreInstance,
};
