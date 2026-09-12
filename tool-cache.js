"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * ToolCache reforzado:
 * - TTL por tipo (lecturas de disco viven mas)
 * - Persistencia diferida (no escribe disco en cada hit)
 * - Stats de ahorro para harness
 */
class ToolCache {
  constructor({
    filePath,
    ttlMs = 30 * 60 * 1000,
    now = Date.now,
    maxEntries = 2_000,
    persistEveryMs = 2_500,
  } = {}) {
    if (!filePath) throw new Error("ToolCache requiere filePath.");
    this.filePath = path.resolve(filePath);
    this.ttlMs = ttlMs;
    this.now = now;
    this.maxEntries = Math.max(100, Number(maxEntries) || 2_000);
    this.persistEveryMs = Math.max(500, Number(persistEveryMs) || 2_500);
    this.data = this.#load();
    this._dirty = false;
    this._persistTimer = null;
  }

  key(context) {
    return crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex");
  }

  ttlFor(context = {}) {
    const kind = String(context.kind || context.tool || context.service || "").toLowerCase();
    if (["read_file", "list_files", "search_files", "project_discovery"].includes(kind)) {
      return Math.max(this.ttlMs, 2 * 60 * 60 * 1000); // 2h lecturas locales
    }
    if (["github", "vercel", "netlify", "selfsupabase"].includes(kind) || context.service) {
      return Math.max(this.ttlMs, 15 * 60 * 1000);
    }
    return this.ttlMs;
  }

  get(context) {
    this.data.stats.requests += 1;
    const hash = this.key(context);
    const entry = this.data.entries[hash];
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) {
        delete this.data.entries[hash];
        this._dirty = true;
      }
      this.data.stats.misses += 1;
      this.#schedulePersist();
      return null;
    }
    entry.lastAccessedAt = this.now();
    this.data.stats.hits += 1;
    this.data.stats.externalCallsAvoided += 1;
    this.data.stats.savedApproxTokens = Number(this.data.stats.savedApproxTokens || 0)
      + Math.max(1, Math.ceil(JSON.stringify(entry.value || {}).length / 4));
    this._dirty = true;
    this.#schedulePersist();
    return JSON.parse(JSON.stringify(entry.value));
  }

  set(context, value) {
    const hash = this.key(context);
    this.data.entries[hash] = {
      value,
      service: context.service || context.kind || "",
      kind: context.kind || context.tool || "",
      expiresAt: this.now() + this.ttlFor(context),
      lastAccessedAt: this.now(),
    };
    this.data.stats.writes += 1;
    this._dirty = true;
    this.#evictIfNeeded();
    this.#schedulePersist();
    return true;
  }

  invalidateService(service) {
    const target = String(service || "").toLowerCase();
    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (String(entry.service || "").toLowerCase() === target) delete this.data.entries[key];
    }
    this._dirty = true;
    this.#schedulePersist();
  }

  invalidatePath(filePath = "") {
    const target = String(filePath || "").replace(/\\/g, "/").toLowerCase();
    if (!target) return 0;
    let removed = 0;
    for (const [key, entry] of Object.entries(this.data.entries)) {
      const raw = JSON.stringify(entry?.value || {});
      if (raw.toLowerCase().includes(target)) {
        delete this.data.entries[key];
        removed += 1;
      }
    }
    if (removed) {
      this._dirty = true;
      this.#schedulePersist();
    }
    return removed;
  }

  stats() {
    const requests = Number(this.data.stats.requests || 0);
    const hits = Number(this.data.stats.hits || 0);
    return {
      ...this.data.stats,
      entries: Object.keys(this.data.entries).length,
      hitRate: requests > 0 ? hits / requests : 0,
    };
  }

  flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._dirty) this.#save();
  }

  #evictIfNeeded() {
    const keys = Object.keys(this.data.entries);
    if (keys.length <= this.maxEntries) return;
    const ranked = keys
      .map((key) => ({ key, at: Number(this.data.entries[key]?.lastAccessedAt || 0) }))
      .sort((a, b) => a.at - b.at);
    const removeCount = Math.max(1, Math.floor(keys.length * 0.15));
    for (let i = 0; i < removeCount; i += 1) delete this.data.entries[ranked[i].key];
  }

  #schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      if (this._dirty) this.#save();
    }, this.persistEveryMs);
    if (typeof this._persistTimer.unref === "function") this._persistTimer.unref();
  }

  #empty() {
    return {
      version: 2,
      stats: {
        requests: 0,
        hits: 0,
        misses: 0,
        writes: 0,
        externalCallsAvoided: 0,
        savedApproxTokens: 0,
      },
      entries: {},
    };
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!parsed?.entries) return this.#empty();
      const stats = { ...this.#empty().stats, ...(parsed.stats || {}) };
      return { version: 2, stats, entries: parsed.entries };
    } catch {
      return this.#empty();
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    this._dirty = false;
  }
}

module.exports = { ToolCache };
