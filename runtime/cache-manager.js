"use strict";
/**
 * runtime/cache-manager.js
 * Cache read/write con TTL, LRU y métricas de tokens ahorrados.
 */

const crypto = require("crypto");

class CacheManager {
  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
    this.stats = { hits: 0, misses: 0, writes: 0, evictions: 0, tokensSaved: 0 };
  }

  _hash(key) { return crypto.createHash("sha256").update(String(key)).digest("hex"); }

  _isExpired(entry) { return Date.now() - entry.ts > this.ttlMs; }

  _evictIfNeeded() {
    if (this.store.size <= this.maxEntries) return;
    const entries = [...this.store.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, this.store.size - this.maxEntries);
    for (const [k] of toRemove) { this.store.delete(k); this.stats.evictions++; }
  }

  get(key) {
    const h = this._hash(key);
    const entry = this.store.get(h);
    if (!entry) { this.stats.misses++; return null; }
    if (this._isExpired(entry)) { this.store.delete(h); this.stats.misses++; return null; }
    entry.lastAccess = Date.now();
    this.stats.hits++;
    if (entry.tokens) this.stats.tokensSaved += entry.tokens;
    return entry.value;
  }

  set(key, value, { tokens = 0 } = {}) {
    const h = this._hash(key);
    this.store.set(h, { value, tokens, ts: Date.now(), lastAccess: Date.now() });
    this.stats.writes++;
    this._evictIfNeeded();
  }

  invalidate(key) { return this.store.delete(this._hash(key)); }

  clear() { this.store.clear(); }

  getMetrics() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.store.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

const globalCache = new CacheManager();

module.exports = { CacheManager, globalCache };