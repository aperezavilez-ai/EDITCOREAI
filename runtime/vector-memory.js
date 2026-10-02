"use strict";
/**
 * runtime/vector-memory.js
 * Vector store persistente en JSONL con búsqueda por similitud coseno.
 */

const fs = require("fs");
const path = require("path");
const { getEmbedding, cosineSimilarity } = require("./embeddings");

const DEFAULT_NS = "default";
const MAX_ENTRIES_PER_NS = 20000;

class VectorMemory {
  constructor(baseDir) {
    this.baseDir = baseDir || path.join(process.cwd(), ".editcore", "vector-memory");
    this.mem = new Map();
    this.loaded = new Set();
    this._ensureDir();
  }

  _ensureDir() {
    try { fs.mkdirSync(this.baseDir, { recursive: true }); } catch (_) {}
  }

  _fileFor(ns) { return path.join(this.baseDir, `${ns}.jsonl`); }

  _ensureLoaded(ns) {
    if (this.loaded.has(ns)) return;
    this.loaded.add(ns);
    const file = this._fileFor(ns);
    const entries = [];
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj.text === "string" && Array.isArray(obj.vec)) entries.push(obj);
        } catch (_) {}
      }
    }
    this.mem.set(ns, { entries });
  }

  _appendToDisk(ns, entry) {
    try {
      fs.appendFileSync(this._fileFor(ns), JSON.stringify(entry) + "\n", "utf8");
    } catch (_) {}
  }

  _rewriteDisk(ns) {
    const bucket = this.mem.get(ns);
    if (!bucket) return;
    const file = this._fileFor(ns);
    const tmp = file + ".tmp";
    const data = bucket.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    try {
      fs.writeFileSync(tmp, data, "utf8");
      fs.renameSync(tmp, file);
    } catch (_) {}
  }

  async add(text, meta = {}, ns = DEFAULT_NS) {
    if (!text) return null;
    this._ensureLoaded(ns);
    const vec = await getEmbedding(text);
    const entry = {
      id: meta.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: String(text).slice(0, 8000),
      vec,
      meta: meta || {},
      ts: Date.now(),
    };
    const bucket = this.mem.get(ns);
    bucket.entries.push(entry);
    if (bucket.entries.length > MAX_ENTRIES_PER_NS) {
      bucket.entries = bucket.entries.slice(-MAX_ENTRIES_PER_NS);
      this._rewriteDisk(ns);
    } else {
      this._appendToDisk(ns, entry);
    }
    return entry.id;
  }

  async addMany(items, ns = DEFAULT_NS) {
    const ids = [];
    for (const it of items) {
      const id = await this.add(it.text, it.meta, ns);
      if (id) ids.push(id);
    }
    return ids;
  }

  async search(query, { topK = 8, ns = DEFAULT_NS, minScore = 0.12, filter } = {}) {
    if (!query) return [];
    this._ensureLoaded(ns);
    const bucket = this.mem.get(ns);
    if (!bucket || bucket.entries.length === 0) return [];
    const qvec = await getEmbedding(query);
    const scored = [];
    for (const e of bucket.entries) {
      if (filter && !filter(e)) continue;
      const score = cosineSimilarity(qvec, e.vec);
      if (score >= minScore) scored.push({ ...e, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  remove(id, ns = DEFAULT_NS) {
    this._ensureLoaded(ns);
    const bucket = this.mem.get(ns);
    if (!bucket) return false;
    const before = bucket.entries.length;
    bucket.entries = bucket.entries.filter((e) => e.id !== id);
    if (bucket.entries.length !== before) { this._rewriteDisk(ns); return true; }
    return false;
  }

  clear(ns = DEFAULT_NS) {
    this.mem.set(ns, { entries: [] });
    this._rewriteDisk(ns);
  }

  stats(ns = DEFAULT_NS) {
    this._ensureLoaded(ns);
    const bucket = this.mem.get(ns);
    return { namespace: ns, entries: bucket ? bucket.entries.length : 0 };
  }
}

module.exports = { VectorMemory, DEFAULT_NS };