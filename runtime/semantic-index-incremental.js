"use strict";

/**
 * Incremental semantic index persistence for RAG.
 * Stores compact doc vectors under .editcore/semantic-index.json
 * and rebuilds only changed files (mtime + size).
 */

const fs = require("node:fs");
const path = require("node:path");
const { embedText, DEFAULT_DIM } = require("./local-embeddings");

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/i)
    .filter((token) => token.length > 2);
}

function walkFilesLocal(root, limit = 1200) {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "release", "win-unpacked"]);
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
        files.push({ full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {}
    }
  }
  if (fs.existsSync(root)) walk(root);
  return files;
}

function indexPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "semantic-index.json");
}

function serializeDoc(doc) {
  return {
    path: doc.path,
    size: doc.size,
    snippet: doc.snippet,
    mtimeMs: doc.mtimeMs,
    byteSize: doc.byteSize,
    tf: [...doc.tf.entries()],
    embedding: Array.from(doc.embedding || []),
  };
}

function deserializeDoc(raw) {
  return {
    path: raw.path,
    size: raw.size,
    snippet: raw.snippet,
    mtimeMs: raw.mtimeMs,
    byteSize: raw.byteSize,
    tf: new Map(raw.tf || []),
    embedding: Float32Array.from(raw.embedding || []),
  };
}

function buildDoc(root, fileMeta) {
  let text = "";
  try {
    text = fs.readFileSync(fileMeta.full, "utf8");
  } catch {
    return null;
  }
  const tokens = tokenize(text);
  if (!tokens.length) return null;
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  return {
    path: path.relative(root, fileMeta.full).replace(/\\/g, "/"),
    tf,
    size: tokens.length,
    snippet: text.slice(0, 220).replace(/\s+/g, " "),
    embedding: embedText(`${path.basename(fileMeta.full)} ${text.slice(0, 4000)}`, DEFAULT_DIM),
    mtimeMs: fileMeta.mtimeMs,
    byteSize: fileMeta.size,
  };
}

function loadPersisted(projectRoot) {
  const file = indexPath(projectRoot);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || !Array.isArray(raw.docs)) return null;
    const docs = raw.docs.map(deserializeDoc);
    const df = new Map();
    for (const doc of docs) {
      for (const token of doc.tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    }
    return {
      root: path.resolve(String(projectRoot || "")),
      docs,
      df,
      builtAt: Number(raw.builtAt) || Date.now(),
      engine: "tfidf+hash-embed+incremental",
      persisted: true,
    };
  } catch {
    return null;
  }
}

function savePersisted(projectRoot, index) {
  const file = indexPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    version: 1,
    builtAt: index.builtAt,
    engine: index.engine,
    docs: index.docs.map(serializeDoc),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, file);
  return file;
}

function buildIncrementalIndex(projectRoot, { force = false } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const prev = force ? null : loadPersisted(root);
  const byPath = new Map((prev?.docs || []).map((d) => [d.path, d]));
  const files = walkFilesLocal(root);
  const docs = [];
  let rebuilt = 0;
  let reused = 0;

  for (const meta of files) {
    const rel = path.relative(root, meta.full).replace(/\\/g, "/");
    const existing = byPath.get(rel);
    if (
      existing &&
      existing.mtimeMs === meta.mtimeMs &&
      existing.byteSize === meta.size &&
      existing.embedding?.length
    ) {
      docs.push(existing);
      reused += 1;
      continue;
    }
    const doc = buildDoc(root, meta);
    if (!doc) continue;
    docs.push(doc);
    rebuilt += 1;
  }

  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.tf.keys()) df.set(token, (df.get(token) || 0) + 1);
  }
  const index = {
    root,
    docs,
    df,
    builtAt: Date.now(),
    engine: "tfidf+hash-embed+incremental",
    stats: { total: docs.length, rebuilt, reused },
  };
  try {
    savePersisted(root, index);
  } catch {
    /* persist best-effort */
  }
  return index;
}

module.exports = {
  indexPath,
  loadPersisted,
  savePersisted,
  buildIncrementalIndex,
  walkFilesLocal,
};
