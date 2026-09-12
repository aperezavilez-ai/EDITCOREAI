const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_STATS = Object.freeze({
  requests: 0,
  hits: 0,
  misses: 0,
  writes: 0,
  savedInputTokens: 0,
  savedOutputTokens: 0,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value || "").length / 4));
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return null;
  if (Buffer.isBuffer(value)) return { type: "Buffer", sha256: crypto.createHash("sha256").update(value).digest("hex") };
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("El contexto de cache contiene una referencia circular.");
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (/^(api[-_]?key|authorization|token|secret|password)$/i.test(key)) continue;
      result[key] = canonicalize(value[key], seen);
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

function usageTokens(usage, names) {
  for (const name of names) {
    const value = finiteNumber(usage?.[name], 0);
    if (value > 0) return Math.ceil(value);
  }
  return 0;
}

class ResponseCache {
  constructor(options = {}) {
    if (!options.filePath) throw new Error("ResponseCache requiere filePath.");
    this.filePath = path.resolve(String(options.filePath));
    this.ttlMs = Math.max(1, finiteNumber(options.ttlMs, 7 * 24 * 60 * 60 * 1000));
    this.maxEntries = Math.max(1, Math.floor(finiteNumber(options.maxEntries, 500)));
    this.maxBytes = Math.max(1024, Math.floor(finiteNumber(options.maxBytes, 25 * 1024 * 1024)));
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.data = this.#load();
    if (this.#prune()) this.#persist();
  }

  makeKey(context = {}) {
    const identity = {
      version: 1,
      namespace: String(context.namespace || "chat"),
      provider: String(context.provider || context.mode || ""),
      baseUrl: String(context.baseUrl || "").trim().replace(/\/+$/, "").toLowerCase(),
      model: String(context.model || "").trim(),
      projectId: String(context.projectId || ""),
      projectRoot: String(context.projectRoot || ""),
      agentId: String(context.agentId || ""),
      temperature: finiteNumber(context.temperature, 0),
      messages: context.messages || [],
      images: context.images || [],
      extra: context.extra || null,
    };
    return crypto.createHash("sha256").update(JSON.stringify(canonicalize(identity))).digest("hex");
  }

  get(context, fallbackInputTokens = 0) {
    const key = this.makeKey(context);
    const now = this.now();
    this.data.stats.requests += 1;
    const entry = this.data.entries[key];
    if (!entry || !entry.text || finiteNumber(entry.expiresAt, 0) <= now) {
      if (entry) delete this.data.entries[key];
      this.data.stats.misses += 1;
      this.#persist();
      return null;
    }

    entry.lastAccessedAt = now;
    const inputTokens = Math.max(0, Math.ceil(finiteNumber(entry.inputTokens, fallbackInputTokens)));
    const outputTokens = Math.max(0, Math.ceil(finiteNumber(entry.outputTokens, estimateTokens(entry.text))));
    this.data.stats.hits += 1;
    this.data.stats.savedInputTokens += inputTokens;
    this.data.stats.savedOutputTokens += outputTokens;
    this.#persist();
    return {
      text: entry.text,
      usage: entry.usage && typeof entry.usage === "object" ? { ...entry.usage } : {},
      inputTokens,
      outputTokens,
      createdAt: entry.createdAt,
    };
  }

  set(context, response = {}) {
    const text = String(response.text || "");
    if (!text) return false;
    const usage = response.usage && typeof response.usage === "object" ? canonicalize(response.usage) : {};
    const inputTokens = usageTokens(usage, ["prompt_tokens", "input_tokens"]) || Math.max(0, Math.ceil(finiteNumber(response.inputTokens, 0)));
    const outputTokens = usageTokens(usage, ["completion_tokens", "output_tokens"]) || Math.max(1, Math.ceil(finiteNumber(response.outputTokens, estimateTokens(text))));
    const now = this.now();
    const entry = {
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastAccessedAt: now,
      text,
      usage,
      inputTokens,
      outputTokens,
      sizeBytes: 0,
    };
    entry.sizeBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    if (entry.sizeBytes > this.maxBytes) return false;
    this.data.entries[this.makeKey(context)] = entry;
    this.data.stats.writes += 1;
    this.#prune();
    this.#persist();
    return true;
  }

  getStats() {
    const entries = Object.values(this.data.entries);
    return {
      ...this.data.stats,
      entries: entries.length,
      bytes: entries.reduce((total, entry) => total + finiteNumber(entry.sizeBytes, 0), 0),
      hitRate: this.data.stats.requests ? this.data.stats.hits / this.data.stats.requests : 0,
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify({ version: this.data.version, stats: this.getStats(), entries: this.data.entries }));
  }

  clear() {
    this.data = this.#empty();
    this.#persist();
  }

  #empty() {
    return { version: 1, stats: { ...DEFAULT_STATS }, entries: {} };
  }

  #load() {
    if (!fs.existsSync(this.filePath)) return this.#empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) throw new Error("Formato invalido");
      return {
        version: 1,
        stats: Object.fromEntries(Object.keys(DEFAULT_STATS).map((key) => [key, Math.max(0, finiteNumber(parsed.stats?.[key], 0))])),
        entries: parsed.entries,
      };
    } catch {
      const corruptPath = `${this.filePath}.corrupt-${this.now()}`;
      try { fs.renameSync(this.filePath, corruptPath); } catch {}
      return this.#empty();
    }
  }

  #prune() {
    const now = this.now();
    const before = Object.keys(this.data.entries).length;
    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (!entry || typeof entry !== "object" || !entry.text || finiteNumber(entry.expiresAt, 0) <= now) delete this.data.entries[key];
    }
    const ordered = Object.entries(this.data.entries).sort((a, b) => finiteNumber(b[1].lastAccessedAt, 0) - finiteNumber(a[1].lastAccessedAt, 0));
    let totalBytes = 0;
    const kept = {};
    for (const [key, entry] of ordered) {
      const bytes = Math.max(1, finiteNumber(entry.sizeBytes, Buffer.byteLength(JSON.stringify(entry), "utf8")));
      if (Object.keys(kept).length >= this.maxEntries || totalBytes + bytes > this.maxBytes) continue;
      entry.sizeBytes = bytes;
      kept[key] = entry;
      totalBytes += bytes;
    }
    this.data.entries = kept;
    return before !== Object.keys(kept).length;
  }

  #persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    const payload = JSON.stringify(this.data, null, 2);
    try {
      fs.writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch (error) {
        if (!fs.existsSync(this.filePath)) throw error;
        const oldPath = `${this.filePath}.old-${process.pid}`;
        try { fs.renameSync(this.filePath, oldPath); } catch { throw error; }
        try {
          fs.renameSync(tempPath, this.filePath);
          try { fs.unlinkSync(oldPath); } catch {}
        } catch (replaceError) {
          try { fs.renameSync(oldPath, this.filePath); } catch {}
          throw replaceError;
        }
      }
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    }
  }
}

module.exports = { ResponseCache, canonicalize, estimateTokens };
