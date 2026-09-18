"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PROMPT_CACHE_PATH = path.join(os.homedir(), ".editcore", "prompt-cache.json");
const MAX_CACHE_ENTRIES = 2000;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

let cacheState = {
  entries: {},
  stats: {
    hits: 0,
    misses: 0,
    evictions: 0,
    lastEvictionAt: null,
  },
};

function ensureCacheDir() {
  const dir = path.dirname(PROMPT_CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache() {
  try {
    if (fs.existsSync(PROMPT_CACHE_PATH)) {
      const raw = fs.readFileSync(PROMPT_CACHE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      cacheState = { ...cacheState, ...parsed };
    }
  } catch {
    cacheState = { entries: {}, stats: { hits: 0, misses: 0, evictions: 0, lastEvictionAt: null } };
  }
}

function saveCache() {
  try {
    ensureCacheDir();
    fs.writeFileSync(PROMPT_CACHE_PATH, JSON.stringify(cacheState, null, 2), "utf8");
  } catch {
    // Non-blocking save failure
  }
}

function buildCacheKey({ systemBlock = "", projectBlock = "", userMessage = "", model = "default", temperature = 0 } = {}) {
  const payload = JSON.stringify({
    systemBlock,
    projectBlock,
    userMessage,
    model,
    temperature,
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return `prompt::${Math.abs(hash)}`;
}

function evictIfNeeded() {
  const entries = Object.entries(cacheState.entries);
  if (entries.length <= MAX_CACHE_ENTRIES) return;
  entries.sort((a, b) => ((a[1].accessedAt || a[1].createdAt) > (b[1].accessedAt || b[1].createdAt) ? 1 : -1));
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
  for (const [key] of toRemove) delete cacheState.entries[key];
  cacheState.stats.evictions += toRemove.length;
  cacheState.stats.lastEvictionAt = new Date().toISOString();
}

function get(params = {}) {
  const key = buildCacheKey(params);
  const entry = cacheState.entries[key];
  if (!entry) {
    cacheState.stats.misses += 1;
    return null;
  }
  entry.accessedAt = new Date().toISOString();
  entry.hits = (entry.hits || 0) + 1;
  cacheState.stats.hits += 1;
  saveCache();
  return entry.response;
}

function has(params = {}) {
  const key = buildCacheKey(params);
  return Boolean(cacheState.entries[key]);
}

function set(params = {}) {
  const { systemBlock = "", projectBlock = "", userMessage = "", model = "default", temperature = 0, response } = params;
  const key = buildCacheKey({ systemBlock, projectBlock, userMessage, model, temperature });
  const now = new Date().toISOString();
  cacheState.entries[key] = {
    key,
    systemBlock,
    projectBlock,
    userMessage,
    model,
    temperature,
    response,
    createdAt: now,
    accessedAt: now,
    hits: 0,
  };
  evictIfNeeded();
  saveCache();
  return key;
}

async function wrapRequest(providerFn, params = {}) {
  const cached = get(params);
  if (cached !== null && cached !== undefined) {
    return { response: cached, cached: true };
  }
  const response = await providerFn(params);
  set({ ...params, response });
  return { response, cached: false };
}

function clearCache() {
  cacheState.entries = {};
  cacheState.stats = { hits: 0, misses: 0, evictions: 0, lastEvictionAt: null };
  saveCache();
}

function getStats() {
  const entries = Object.values(cacheState.entries);
  const totalBytes = Buffer.byteLength(JSON.stringify(entries), "utf8");
  return {
    entries: entries.length,
    bytes: totalBytes,
    hits: cacheState.stats.hits,
    misses: cacheState.stats.misses,
    evictions: cacheState.stats.evictions,
    lastEvictionAt: cacheState.stats.lastEvictionAt,
  };
}

loadCache();

module.exports = {
  get,
  set,
  has,
  clearCache,
  getStats,
  buildCacheKey,
  evictIfNeeded,
  wrapRequest,
};
