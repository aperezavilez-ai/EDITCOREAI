"use strict";

const path = require("node:path");
const fs = require("node:fs");

/**
 * Busqueda unificada: codigo local (grep ligero) + cerebro si existe.
 * No reemplaza search_files; lo complementa.
 */
function searchLocalFiles(projectRoot, query, { pathPrefix = "", limit = 40 } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const needle = String(query || "").trim();
  if (!needle) return [];
  const prefix = String(pathPrefix || "").replace(/^[\\/]+/, "");
  const start = prefix ? path.join(root, prefix) : root;
  const hits = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "release-275"]);

  function walk(dir, depth = 0) {
    if (hits.length >= limit || depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx|mjs|cjs|json|md|css|html|py|rs|go)$/i.test(entry.name)) continue;
      let text = "";
      try {
        const stat = fs.statSync(full);
        if (stat.size > 400_000) continue;
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const idx = text.toLowerCase().indexOf(needle.toLowerCase());
      if (idx < 0) continue;
      const line = text.slice(0, idx).split(/\r?\n/).length;
      const snippet = text.slice(Math.max(0, idx - 40), idx + needle.length + 80).replace(/\s+/g, " ");
      hits.push({
        source: "files",
        path: path.relative(root, full).replace(/\\/g, "/"),
        line,
        snippet,
      });
    }
  }

  if (fs.existsSync(start)) walk(start);
  return hits;
}

async function unifiedSearch({
  projectRoot,
  query,
  pathPrefix = "",
  limit = 20,
  brain = null,
} = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("search requiere query.");
  const files = searchLocalFiles(projectRoot, q, { pathPrefix, limit });
  let brainHits = [];
  if (brain?.searchForAgent) {
    try {
      const result = await brain.searchForAgent(q, { scope: "all", limit: Math.min(10, limit) });
      const rows = Array.isArray(result?.results) ? result.results
        : Array.isArray(result) ? result
          : [];
      brainHits = rows.slice(0, 10).map((item) => ({
        source: "brain",
        title: item.title || item.name || item.path || "",
        snippet: String(item.snippet || item.content || item.text || "").slice(0, 240),
        path: item.path || "",
      }));
    } catch {
      brainHits = [];
    }
  }
  return {
    query: q,
    total: files.length + brainHits.length,
    files,
    brain: brainHits,
  };
}

module.exports = { unifiedSearch, searchLocalFiles };
