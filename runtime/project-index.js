"use strict";

/**
 * Indice del proyecto + @mentions (@Files/@Folders/@Docs/@Git/@Web) para inyectar contexto.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "coverage",
  "app.asar", ".cache", "out", "tmp", "temp", "win-unpacked",
  "JarvisAI", "brain-seed", "release", "release-275", "packaged",
  ".editcore", ".claude",
]);
const TEXT_EXT = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt",
  ".css", ".html", ".yml", ".yaml", ".toml", ".py", ".rs", ".go", ".sql",
  ".prisma", ".mdc",
]);
const CODE_EXT = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
const SCHEMA_RE = /(^|\/)(supabase\/migrations|prisma\/schema\.prisma|.*\.sql)$/i;
const PRIORITY_DIRS = [
  "resources/app",
  "resources/editcore-agent-core",
  "ROADMAP",
  "src",
  "supabase",
  "docs",
];

let _symbolIntel = null;
function getSymbolIntel() {
  if (_symbolIntel) return _symbolIntel;
  try {
    const { SymbolIntelligence } = require("./symbol-intelligence");
    _symbolIntel = new SymbolIntelligence();
  } catch {
    _symbolIntel = { parseFile: () => ({ symbols: [] }) };
  }
  return _symbolIntel;
}

function tokenize(text = "") {
  const raw = String(text || "").toLowerCase();
  const parts = raw
    .split(/[^a-z0-9_@./-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 64);
  const out = new Set(parts);
  for (const part of parts) {
    const stem = part.replace(/\.[a-z0-9]+$/i, "");
    if (stem && stem !== part) out.add(stem);
    for (const piece of stem.split(/[-_/]+/)) {
      if (piece.length >= 2) out.add(piece);
    }
  }
  return [...out];
}

function walkFiles(root, relative = "", maxFiles = 4000, out = []) {
  if (out.length >= maxFiles) return out;
  const abs = relative ? path.join(root, relative) : root;
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => {
    const score = (e) => {
      if (!e.isDirectory()) return 1;
      if (/^(runtime|src|app|agent-core|test|scripts|supabase|docs)$/i.test(e.name)) return 0;
      return 2;
    };
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".cursor") continue;
    const rel = relative ? `${relative}/${entry.name}`.replace(/\\/g, "/") : entry.name;
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, rel, maxFiles, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.size > 400_000) continue;
    out.push({ path: rel.replace(/\\/g, "/"), bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out;
}

function collectIndexFiles(root, maxFiles = 4000) {
  const seen = new Set();
  const out = [];
  const pushWalk = (relPrefix) => {
    if (out.length >= maxFiles) return;
    const start = relPrefix || "";
    const abs = start ? path.join(root, ...start.split("/")) : root;
    if (!fs.existsSync(abs)) return;
    const batch = [];
    walkFiles(root, start, maxFiles - out.length, batch);
    for (const file of batch) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      out.push(file);
      if (out.length >= maxFiles) break;
    }
  };
  for (const dir of PRIORITY_DIRS) pushWalk(dir);
  pushWalk("");
  return out.slice(0, maxFiles);
}

function extractLightSymbols(content = "", filePath = "") {
  const symbols = [];
  const lines = String(content || "").split(/\r?\n/).slice(0, 400);
  const patterns = [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "function" },
    { re: /^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/, kind: "type" },
    { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  ];
  for (let i = 0; i < lines.length; i += 1) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re);
      if (m) symbols.push({ name: m[1], kind, line: i + 1, path: filePath });
    }
  }
  return symbols.slice(0, 80);
}

function collectSchemaFiles(root, files) {
  const schemas = [];
  for (const file of files) {
    const p = String(file.path || "").replace(/\\/g, "/");
    if (SCHEMA_RE.test(p) || /\.prisma$/i.test(p) || /migrations\/.+\.sql$/i.test(p)) {
      schemas.push({ path: p, bytes: file.bytes, mtimeMs: file.mtimeMs });
    }
  }
  // Also scan common schema roots even if walk skipped dots incorrectly
  const extras = [
    "prisma/schema.prisma",
    "supabase/migrations",
    "cloud/supabase/migrations",
  ];
  for (const rel of extras) {
    const abs = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isFile() && !schemas.some((s) => s.path === rel)) {
      schemas.push({ path: rel, bytes: st.size, mtimeMs: st.mtimeMs });
    } else if (st.isDirectory()) {
      try {
        for (const name of fs.readdirSync(abs).slice(0, 40)) {
          if (!/\.sql$/i.test(name)) continue;
          const child = `${rel}/${name}`.replace(/\\/g, "/");
          if (schemas.some((s) => s.path === child)) continue;
          const cst = fs.statSync(path.join(abs, name));
          schemas.push({ path: child, bytes: cst.size, mtimeMs: cst.mtimeMs });
        }
      } catch { /* ignore */ }
    }
  }
  return schemas.slice(0, 120);
}

function buildProjectIndex(projectRoot, { maxFiles = 4000, withSymbols = true } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("Proyecto invalido para indice.");
  const files = collectIndexFiles(root, maxFiles);
  const inverted = new Map();
  const fileMeta = [];
  const symbols = [];
  const intel = withSymbols ? getSymbolIntel() : null;

  for (const file of files) {
    const abs = path.join(root, file.path);
    let content = "";
    try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const tokens = new Set([
      ...tokenize(file.path),
      ...tokenize(path.basename(file.path)),
      ...tokenize(content.slice(0, 80_000)),
    ]);
    for (const token of tokens) {
      if (!inverted.has(token)) inverted.set(token, new Set());
      inverted.get(token).add(file.path);
    }

    const ext = path.extname(file.path).toLowerCase();
    let fileSymbols = [];
    if (withSymbols && CODE_EXT.has(ext) && content.length < 200_000) {
      try {
        const parsed = intel.parseFile(abs, content);
        fileSymbols = (parsed.symbols || []).slice(0, 60).map((s) => ({
          name: s.name,
          kind: s.kind,
          line: s.line,
          path: file.path,
        }));
      } catch {
        fileSymbols = extractLightSymbols(content, file.path);
      }
      for (const sym of fileSymbols) {
        symbols.push(sym);
        const nameTok = String(sym.name || "").toLowerCase();
        if (nameTok.length >= 2) {
          if (!inverted.has(nameTok)) inverted.set(nameTok, new Set());
          inverted.get(nameTok).add(file.path);
        }
      }
    }

    fileMeta.push({
      path: file.path,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      hash: crypto.createHash("sha1").update(content.slice(0, 20_000)).digest("hex").slice(0, 12),
      symbolCount: fileSymbols.length,
    });
  }

  const postings = {};
  for (const [token, set] of inverted.entries()) {
    if (set.size > 800) continue;
    postings[token] = [...set].slice(0, 80);
  }

  const schemas = collectSchemaFiles(root, files);

  return {
    version: 3,
    root,
    builtAt: new Date().toISOString(),
    fileCount: fileMeta.length,
    tokenCount: Object.keys(postings).length,
    symbolCount: symbols.length,
    schemaCount: schemas.length,
    files: fileMeta,
    symbols: symbols.slice(0, 5000),
    schemas,
    postings,
  };
}

function searchProjectIndex(index, query = "", { limit = 20 } = {}) {
  const q = String(query || "").toLowerCase().trim();
  const tokens = tokenize(q);
  if (!index || (!tokens.length && !q)) return [];
  const scores = new Map();
  const kindByPath = new Map();

  for (const token of tokens) {
    const hits = index.postings?.[token] || [];
    for (const filePath of hits) {
      scores.set(filePath, (scores.get(filePath) || 0) + 1);
    }
  }
  for (const file of index.files || []) {
    const p = String(file.path || "").toLowerCase();
    const base = path.basename(p);
    if (p.includes(q) || base.includes(q)) {
      scores.set(file.path, (scores.get(file.path) || 0) + 5);
    } else {
      for (const token of tokens) {
        if (token.length >= 3 && (p.includes(token) || base.includes(token))) {
          scores.set(file.path, (scores.get(file.path) || 0) + 2);
        }
      }
    }
  }
  for (const sym of index.symbols || []) {
    const name = String(sym.name || "").toLowerCase();
    if (!name) continue;
    if (name === q || name.includes(q) || tokens.includes(name)) {
      scores.set(sym.path, (scores.get(sym.path) || 0) + 8);
      kindByPath.set(sym.path, sym.kind || "symbol");
    }
  }
  for (const schema of index.schemas || []) {
    const p = String(schema.path || "").toLowerCase();
    if (p.includes(q) || /schema|migration|sql|prisma/.test(q)) {
      scores.set(schema.path, (scores.get(schema.path) || 0) + 6);
      kindByPath.set(schema.path, "schema");
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([filePath, score]) => ({
      path: filePath,
      score,
      kind: kindByPath.get(filePath) || "file",
    }));
}

function extractAtMentions(prompt = "") {
  const text = String(prompt || "");
  const files = [];
  const folders = [];
  const urls = [];
  for (const m of text.matchAll(/@((?:[\w.-]+\/)*[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|mdc|txt|css|html|sql|prisma|yml|yaml))/gi)) {
    files.push(String(m[1] || "").replace(/\\/g, "/"));
  }
  for (const m of text.matchAll(/@((?:resources|src|app|runtime|lib|components|docs|supabase|cloud|api|test|tests|\.editcore|\.cursor)(?:\/[\w.-]+)*)(?!\.\w)/gi)) {
    const p = String(m[1] || "").replace(/\\/g, "/");
    if (!/\.\w+$/.test(p)) folders.push(p);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)) {
    urls.push(m[0].replace(/[.,;]+$/, ""));
  }
  const tags = [];
  if (/(?:^|[\s,;:(])@Files?\b/i.test(text) || /^@Files?\b/i.test(text)) tags.push("Files");
  if (/(?:^|[\s,;:(])@Folders?\b/i.test(text) || /^@Folders?\b/i.test(text)) tags.push("Folders");
  if (/(?:^|[\s,;:(])@Docs?\b/i.test(text) || /^@Docs?\b/i.test(text)) tags.push("Docs");
  if (/(?:^|[\s,;:(])@Git\b/i.test(text) || /^@Git\b/i.test(text)) tags.push("Git");
  if (/(?:^|[\s,;:(])@Web\b/i.test(text) || /^@Web\b/i.test(text)) tags.push("Web");
  return {
    files: [...new Set(files)],
    folders: [...new Set(folders)],
    urls: [...new Set(urls)].slice(0, 5),
    tags: [...new Set(tags)],
  };
}

function readSnippet(projectRoot, rel, maxChars = 6000) {
  const abs = path.join(projectRoot, ...String(rel).split("/").filter(Boolean));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const content = fs.readFileSync(abs, "utf8");
  return content.length > maxChars ? `${content.slice(0, maxChars)}\n/* ...truncado... */` : content;
}

function listFolderSummary(projectRoot, rel, { maxEntries = 40 } = {}) {
  const abs = path.join(projectRoot, ...String(rel || ".").split("/").filter(Boolean));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return null;
  }
  const lines = entries.slice(0, maxEntries).map((e) => `${e.isDirectory() ? "dir" : "file"} ${e.name}`);
  return `### @Folders ${rel || "."}\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

function collectDocsPaths(projectRoot) {
  const candidates = [
    "README.md", "docs", "ROADMAP", "ROADMAP.md", "CHANGELOG.md",
    "AGENTS.md", "CLAUDE.md", "docs/AUTO_README.md", "docs/AUTO_API.md",
  ];
  const found = [];
  for (const rel of candidates) {
    const abs = path.join(projectRoot, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isFile()) found.push(rel);
    else if (st.isDirectory()) {
      try {
        for (const name of fs.readdirSync(abs).slice(0, 20)) {
          if (/\.(md|mdc|txt)$/i.test(name)) found.push(`${rel}/${name}`.replace(/\\/g, "/"));
        }
      } catch { /* ignore */ }
    }
  }
  return found.slice(0, 12);
}

function readGitContext(projectRoot) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 256_000,
      }).trim();
    } catch (err) {
      return String(err?.stdout || err?.message || err).slice(0, 800);
    }
  };
  const status = run(["status", "-sb"]);
  const log = run(["log", "-5", "--oneline"]);
  const diff = run(["diff", "--stat", "HEAD"]);
  return [
    "### @Git",
    "```",
    `status:\n${status || "(vacio)"}`,
    "",
    `log:\n${log || "(vacio)"}`,
    "",
    `diff --stat:\n${diff || "(sin cambios)"}`,
    "```",
  ].join("\n");
}

/**
 * Inyecta snippets de @path / tags y hits de indice al prompt.
 */
function enrichPromptWithMentions(projectRoot, prompt = "", {
  index = null,
  maxFiles = 4,
  allowAutoIndex = false,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const text = String(prompt || "");
  const mentions = extractAtMentions(text);
  const blocks = [];
  const seen = new Set();
  const injected = [];

  for (const rel of mentions.files.slice(0, maxFiles)) {
    if (seen.has(rel)) continue;
    const snippet = readSnippet(root, rel);
    if (!snippet) continue;
    seen.add(rel);
    injected.push(rel);
    blocks.push(`### @${rel}\n\`\`\`\n${snippet}\n\`\`\``);
  }

  for (const folder of mentions.folders.slice(0, 4)) {
    const summary = listFolderSummary(root, folder);
    if (summary) {
      blocks.push(summary);
      injected.push(`folder:${folder}`);
    }
    // also inject 1-2 key files from the folder
    try {
      const abs = path.join(root, ...folder.split("/"));
      const names = fs.readdirSync(abs).filter((n) => TEXT_EXT.has(path.extname(n).toLowerCase())).slice(0, 2);
      for (const name of names) {
        const rel = `${folder}/${name}`.replace(/\\/g, "/");
        if (seen.has(rel) || seen.size >= maxFiles) continue;
        const snippet = readSnippet(root, rel, 2500);
        if (!snippet) continue;
        seen.add(rel);
        injected.push(rel);
        blocks.push(`### @${rel}\n\`\`\`\n${snippet}\n\`\`\``);
      }
    } catch { /* ignore */ }
  }

  if (mentions.tags.includes("Docs") || /@Docs?\b/i.test(text)) {
    for (const rel of collectDocsPaths(root).slice(0, 4)) {
      if (seen.has(rel)) continue;
      const snippet = readSnippet(root, rel, 3500);
      if (!snippet) continue;
      seen.add(rel);
      injected.push(rel);
      blocks.push(`### @Docs ${rel}\n\`\`\`\n${snippet}\n\`\`\``);
    }
  }

  if (mentions.tags.includes("Folders") && !mentions.folders.length) {
    const summary = listFolderSummary(root, ".");
    if (summary) {
      blocks.push(summary);
      injected.push("folder:.");
    }
  }

  if (mentions.tags.includes("Git")) {
    blocks.push(readGitContext(root));
    injected.push("git");
  }

  if (mentions.tags.includes("Web") || mentions.urls.length) {
    const urlList = mentions.urls.length
      ? mentions.urls
      : [];
    blocks.push([
      "### @Web",
      "```",
      urlList.length
        ? `URLs detectadas (usar tool fetch_url):\n${urlList.map((u) => `- ${u}`).join("\n")}`
        : "Tag @Web: usa la tool fetch_url con la URL objetivo.",
      "```",
    ].join("\n"));
    injected.push("web");
  }

  // Auto-index ONLY when explicitly requested. Blind search polluted every prompt
  // with unrelated files (e.g. adapter source) and corrupted kickoff/intent.
  if (index && allowAutoIndex === true && seen.size < maxFiles) {
    const query = text.replace(/@[\w./-]+/g, " ").slice(0, 200);
    for (const hit of searchProjectIndex(index, query, { limit: maxFiles })) {
      if (seen.has(hit.path) || seen.size >= maxFiles) break;
      const snippet = readSnippet(root, hit.path, 3500);
      if (!snippet) continue;
      seen.add(hit.path);
      injected.push(hit.path);
      blocks.push(`### index:${hit.path} (score ${hit.score}${hit.kind ? `, ${hit.kind}` : ""})\n\`\`\`\n${snippet}\n\`\`\``);
    }
  }

  // No @mentions and no explicit tags → leave the user prompt untouched.
  if (!blocks.length) {
    return { prompt: text, mentions, injected: [] };
  }

  const tagNote = mentions.tags.length
    ? `\n[contexto tags: ${mentions.tags.map((t) => `@${t}`).join(", ")}]`
    : "";
  const enriched = `${text}${tagNote}\n\n---\nContexto inyectado por @mentions / indice:\n\n${blocks.join("\n\n")}`;
  return { prompt: enriched, mentions, injected };
}

const indexCache = new Map();

function getCachedProjectIndex(projectRoot, { rebuild = false, maxFiles = 2500 } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const cached = indexCache.get(root);
  if (!rebuild && cached && Date.now() - cached.at < 10 * 60_000) return cached.index;
  const index = buildProjectIndex(root, { maxFiles });
  indexCache.set(root, { at: Date.now(), index });
  // Persist lightweight snapshot for reopen
  try {
    const dir = path.join(root, ".editcore");
    fs.mkdirSync(dir, { recursive: true });
    const slim = {
      version: index.version,
      builtAt: index.builtAt,
      fileCount: index.fileCount,
      symbolCount: index.symbolCount,
      schemaCount: index.schemaCount,
      symbols: (index.symbols || []).slice(0, 800),
      schemas: index.schemas || [],
    };
    fs.writeFileSync(path.join(dir, "project-index-meta.json"), JSON.stringify(slim, null, 2), "utf8");
  } catch { /* ignore */ }
  return index;
}

module.exports = {
  buildProjectIndex,
  searchProjectIndex,
  extractAtMentions,
  enrichPromptWithMentions,
  getCachedProjectIndex,
  tokenize,
  walkFiles,
  collectIndexFiles,
  collectDocsPaths,
  readGitContext,
  PRIORITY_DIRS,
};
