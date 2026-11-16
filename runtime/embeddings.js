"use strict";
/**
 * runtime/embeddings.js
 * Embeddings con red neuronal (Transformers / Xenova all-MiniLM-L6-v2),
 * proveedor opcional por API y fallback local determinista.
 *
 * Uso:
 *   const { getEmbedding, cosineSimilarity, setProvider } = require("./embeddings");
 */

const crypto = require("crypto");

const DEFAULT_DIM = 384;
const MAX_CACHE = 8000;
const cache = new Map();

let providerFn = null;
let providerDim = DEFAULT_DIM;
let transformerExtractor = null;
let transformerAttempted = false;

function setProvider(fn, dim = DEFAULT_DIM) {
  if (typeof fn !== "function") throw new Error("embeddings.setProvider: fn inválida");
  providerFn = fn;
  providerDim = dim;
  cache.clear();
}

async function getTransformerExtractor() {
  if (transformerExtractor) return transformerExtractor;
  if (transformerAttempted) return null;
  transformerAttempted = true;
  try {
    const { pipeline } = require("@xenova/transformers");
    transformerExtractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true,
    });
    return transformerExtractor;
  } catch (_) {
    return null;
  }
}

function normalizeText(text) {
  if (text === null || text === undefined) return "";
  return String(text).trim().toLowerCase().slice(0, 8000);
}

function tokenPositions(token, dim) {
  const h = crypto.createHash("sha1").update(token).digest();
  const i1 = ((h[0] << 8) | h[1]) % dim;
  const i2 = ((h[2] << 8) | h[3]) % dim;
  const s1 = h[4] % 2 === 0 ? 1 : -1;
  const s2 = h[5] % 2 === 0 ? 1 : -1;
  return [[i1, s1], [i2, s2]];
}

function localEmbedding(text, dim = DEFAULT_DIM) {
  const vec = new Float64Array(dim);
  const normalized = normalizeText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return Array.from(vec);

  for (const tok of tokens) {
    const positions = tokenPositions(tok, dim);
    for (const [pos, sign] of positions) vec[pos] += sign;
  }
  // bigramas (contexto ligero)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = tokens[i] + "_" + tokens[i + 1];
    for (const [pos, sign] of tokenPositions(bg, dim)) vec[pos] += sign * 0.5;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return Array.from(vec);
}

async function getEmbedding(text) {
  const key = normalizeText(text);
  if (!key) return Array.from(new Float64Array(DEFAULT_DIM));
  if (cache.has(key)) return cache.get(key);

  let vec = null;
  if (providerFn) {
    try {
      vec = await providerFn(text);
    } catch (_) {
      vec = null;
    }
  }

  // Red neuronal local si no hay proveedor externo
  if (!vec) {
    try {
      const extractor = await getTransformerExtractor();
      if (extractor) {
        const output = await extractor(key, { pooling: "mean", normalize: true });
        if (output && output.data) {
          vec = Array.from(output.data);
        }
      }
    } catch (_) {
      vec = null;
    }
  }

  if (!Array.isArray(vec) || vec.length === 0) {
    vec = localEmbedding(text, DEFAULT_DIM);
  }

  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(key, vec);
  return vec;
}

async function getEmbeddings(texts) {
  if (!Array.isArray(texts)) return [];
  return Promise.all(texts.map(getEmbedding));
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  setProvider,
  localEmbedding,
  DEFAULT_DIM,
};