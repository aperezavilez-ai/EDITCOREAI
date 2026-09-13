"use strict";

/**
 * Embeddings locales por feature hashing (sin APIs de pago ni modelos remotos).
 * Suficiente para ranking semantico premium ligero sobre TF-IDF.
 */

const DEFAULT_DIM = 256;

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/i)
    .filter((token) => token.length > 2);
}

function hashToken(token = "") {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedText(text = "", dim = DEFAULT_DIM) {
  const size = Math.max(32, Math.min(1024, Number(dim) || DEFAULT_DIM));
  const vec = new Float32Array(size);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;
  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % size;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
    // bigrams suaves
    if (token.length > 4) {
      const h2 = hashToken(token.slice(0, 4));
      vec[h2 % size] += sign * 0.35;
    }
  }
  let norm = 0;
  for (let i = 0; i < size; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < size; i++) vec[i] /= norm;
  return vec;
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

module.exports = {
  DEFAULT_DIM,
  tokenize,
  embedText,
  cosineSimilarity,
  hashToken,
};
