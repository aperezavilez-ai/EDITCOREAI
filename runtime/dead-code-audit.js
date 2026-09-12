"use strict";

/**
 * Auditoria de imports huérfanos / exports sin uso (heuristica local).
 */

const fs = require("node:fs");
const path = require("node:path");
const { CodebaseMap } = require("./codebase-map");

const SQL_N1_RE = /(?:for\s*\([^)]+\)\s*\{[\s\S]{0,400}?(?:await\s+)?(?:supabase|prisma|knex|db|query|sql)[\s\S]{0,120}?(?:select|from|findMany|findUnique|\.from\())/gi;

function auditDeadCode(projectRoot, { limit = 40 } = {}) {
  const map = new CodebaseMap({ maxFiles: 1500 }).build(projectRoot, { refresh: false });
  const exported = new Map();
  const imported = new Set();

  for (const file of map.files || []) {
    for (const exp of file.exports || []) {
      for (const name of exp.names || []) {
        if (!name || name === "*" || name === "default") continue;
        if (!exported.has(name)) exported.set(name, []);
        exported.get(name).push(file.path);
      }
    }
    for (const imp of file.imports || []) {
      for (const name of imp.names || []) {
        if (name) imported.add(name);
      }
    }
  }

  const orphanExports = [];
  for (const [name, files] of exported.entries()) {
    if (imported.has(name)) continue;
    orphanExports.push({ name, files: files.slice(0, 5) });
    if (orphanExports.length >= limit) break;
  }

  const unusedFiles = [];
  for (const file of map.files || []) {
    const base = path.basename(file.path);
    if (!/\.(js|ts|tsx|jsx|mjs|cjs)$/i.test(base)) continue;
    if (/^(index|main|app|server)\./i.test(base)) continue;
    const stem = base.replace(/\.[^.]+$/, "");
    const referenced = (map.files || []).some((other) => {
      if (other.path === file.path) return false;
      return (other.imports || []).some((imp) => {
        const spec = String(imp.specifier || "");
        return spec.includes(stem) || spec.endsWith(`/${stem}`) || spec.endsWith(`/${base}`);
      });
    });
    if (!referenced && (file.exports || []).length) {
      unusedFiles.push({ path: file.path, exportCount: (file.exports || []).length });
    }
    if (unusedFiles.length >= limit) break;
  }

  return {
    ok: true,
    projectRoot,
    counts: map.counts,
    orphanExports: orphanExports.slice(0, limit),
    possiblyUnusedFiles: unusedFiles.slice(0, limit),
    note: "Heuristica estatica; confirmar antes de borrar.",
  };
}

function auditSqlPerformance(projectRoot, { limit = 20 } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const hits = [];
  const stack = [""];
  while (stack.length && hits.length < limit) {
    const rel = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!/\.(js|ts|tsx|jsx|mjs|cjs)$/i.test(entry.name)) continue;
      let text = "";
      try {
        text = fs.readFileSync(path.join(root, child), "utf8").slice(0, 80_000);
      } catch { continue; }
      const m = text.match(SQL_N1_RE);
      if (m) {
        hits.push({
          path: child.replace(/\\/g, "/"),
          pattern: "possible-n+1-query-in-loop",
          excerpt: String(m[0]).slice(0, 240),
        });
      }
    }
  }
  return { ok: true, hits, note: "Heuristica N+1; revisar cada hit." };
}

module.exports = {
  auditDeadCode,
  auditSqlPerformance,
};
