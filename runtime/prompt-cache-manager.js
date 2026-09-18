const fs = require('fs');
const path = require('path');
const os = require('os');

const PROMPT_CACHE_PATH = path.join(os.homedir(), '.editcore', 'prompt-cache.json');
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
      const raw = fs.readFileSync(PROMPT_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      cacheState = { ...cacheState, ...parsed };
    }
  } catch {
    cacheState = { entries: {}, stats: { hits: 0, misses: 0, evictions: 0, lastEvictionAt: null } };
  }
}

function saveCache() {
  ensureCacheDir();
  fs.writeFileSync(PROMPT_CACHE_PATH, JSON.stringify(cacheState, null, 2), 'utf8');
}

function buildCacheKey({ systemBlock, projectBlock, userMessage, model, temperature }) {
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
  entries.sort((a, b) => (a[1].accessedAt || a[1].createdAt) > (b[1].accessedAt || b[1].createdAt) ? 1 : -1);
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
  for (const [key] of toRemove) delete cacheState.entries[key];
  cacheState.stats.evictions += toRemove.length;
  cacheState.stats.lastEvictionAt = new Date().toISOString();
}

function get({ systemBlock, projectBlock, userMessage, model, temperature }) {
  const key = buildCacheKey({ systemBlock, projectBlock, userMessage, model, temperature });
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

function set({ systemBlock, projectBlock, userMessage, model, temperature, response }) {
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
}

function clearCache() {
  cacheState.entries = {};
  cacheState.stats = { hits: 0, misses: 0, evictions: 0, lastEvictionAt: null };
  saveCache();
}

function getStats() {
  const entries = Object.values(cacheState.entries);
  const totalBytes = Buffer.byteLength(JSON.stringify(entries), 'utf8');
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
  clearCache,
  getStats,
};
