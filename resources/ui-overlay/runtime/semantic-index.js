"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { embedText, cosineSimilarity, DEFAULT_DIM } = require("./local-embeddings");

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "release-275", "win-unpacked"]);

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/i)
    .filter((token) => token.length > 2);
}

function walkFiles(root, limit = 1200) {
  const files = [];
  function walk(dir, depth = 0) {
    if (files.length >= limit || depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx|mjs|cjs|md|json|css|html|py)$/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 250_000) continue;
        files.push(full);
      } catch {}
    }
  }
  if (fs.existsSync(root)) walk(root);
  return files;
}

function buildLocalIndex(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const docs = [];
  const df = new Map();
  for (const file of walkFiles(root)) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const tokens = tokenize(text);
    if (!tokens.length) continue;
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    docs.push({
      path: path.relative(root, file).replace(/\\/g, "/"),
      tf,
      size: tokens.length,
      snippet: text.slice(0, 220).replace(/\s+/g, " "),
      embedding: embedText(`${path.basename(file)} ${text.slice(0, 4000)}`, DEFAULT_DIM),
    });
  }
  return { root, docs, df, builtAt: Date.now(), engine: "tfidf+hash-embed" };
}

function scoreQuery(index, query, limit = 12) {
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length || !index?.docs?.length) return [];
  const qEmbed = embedText(query, DEFAULT_DIM);
  const n = index.docs.length;
  const scored = [];
  for (const doc of index.docs) {
    let tfidf = 0;
    for (const token of qTokens) {
      const tf = doc.tf.get(token) || 0;
      if (!tf) continue;
      const idf = Math.log(1 + n / (1 + (index.df.get(token) || 0)));
      tfidf += (tf / Math.max(1, doc.size)) * idf * 1000;
    }
    const semantic = cosineSimilarity(qEmbed, doc.embedding) * 100;
    const score = tfidf * 0.65 + semantic * 0.35;
    if (score > 0.01) {
      scored.push({
        path: doc.path,
        score: Number(score.toFixed(3)),
        tfidf: Number(tfidf.toFixed(3)),
        semantic: Number(semantic.toFixed(3)),
        snippet: doc.snippet,
        source: "local-semantic",
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

const cache = new Map();

function getLocalIndex(projectRoot, { refresh = false } = {}) {
  const key = path.resolve(String(projectRoot || "")).toLowerCase();
  const existing = cache.get(key);
  if (!refresh && existing && Date.now() - existing.builtAt < 5 * 60_000) return existing;
  let index;
  try {
    const { buildIncrementalIndex } = require("./semantic-index-incremental");
    index = buildIncrementalIndex(projectRoot, { force: refresh === true });
  } catch {
    index = buildLocalIndex(projectRoot);
  }
  cache.set(key, index);
  return index;
}

function readQdrantConfig(projectRoot) {
  const file = path.join(String(projectRoot || ""), ".editcore", "qdrant.json");
  try {
    if (!fs.existsSync(file)) {
      if (process.env.QDRANT_URL) {
        return { url: String(process.env.QDRANT_URL), collection: process.env.QDRANT_COLLECTION || "editcore", apiKey: process.env.QDRANT_API_KEY || "" };
      }
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw?.url) return null;
    return {
      url: String(raw.url).replace(/\/$/, ""),
      collection: String(raw.collection || "editcore"),
      apiKey: String(raw.apiKey || ""),
    };
  } catch {
    return null;
  }
}

function httpJson(url, { method = "GET", headers = {}, body = null, timeoutMs = 8_000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(parsed, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode || 0, json: text ? JSON.parse(text) : null, text });
        } catch {
          resolve({ status: res.statusCode || 0, json: null, text });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout Qdrant"));
    });
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function searchQdrant(projectRoot, query, limit = 8) {
  const config = readQdrantConfig(projectRoot);
  if (!config) return { available: false, hits: [] };
  try {
    // Scroll/search por payload text (sin embeddings externos): filtro match text si la collection lo soporta.
    const response = await httpJson(`${config.url}/collections/${encodeURIComponent(config.collection)}/points/scroll`, {
      method: "POST",
      headers: config.apiKey ? { "api-key": config.apiKey } : {},
      body: {
        limit,
        with_payload: true,
        filter: {
          must: [{
            key: "text",
            match: { text: String(query || "") },
          }],
        },
      },
    });
    if (response.status >= 400) {
      return { available: true, hits: [], message: `Qdrant HTTP ${response.status}` };
    }
    const points = response.json?.result?.points || [];
    return {
      available: true,
      hits: points.map((point) => ({
        source: "qdrant",
        id: point.id,
        path: point.payload?.path || "",
        snippet: String(point.payload?.text || point.payload?.snippet || "").slice(0, 240),
        score: point.score || 0,
      })),
    };
  } catch (error) {
    return { available: true, hits: [], message: String(error?.message || error).slice(0, 200) };
  }
}

async function semanticSearch(projectRoot, query, { limit = 12, refresh = false } = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("semantic_search requiere query.");
  const index = getLocalIndex(projectRoot, { refresh });
  const local = scoreQuery(index, q, limit);
  const remote = await searchQdrant(projectRoot, q, Math.min(8, limit));
  return {
    query: q,
    engine: "local-tfidf+hash-embed" + (remote.available ? "+qdrant-optional" : ""),
    total: local.length + remote.hits.length,
    local,
    qdrant: remote,
  };
}

module.exports = {
  tokenize,
  buildLocalIndex,
  getLocalIndex,
  scoreQuery,
  semanticSearch,
  readQdrantConfig,
};
