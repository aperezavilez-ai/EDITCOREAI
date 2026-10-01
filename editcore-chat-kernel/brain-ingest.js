"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Ingesta dinámica al Cerebro RAG del proyecto (.editcore/rag/).
 */

function sanitizeTitle(title) {
  const base = String(title || "documento")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base || `doc_${Date.now()}`;
}

function ragDir(projectRoot) {
  return path.join(path.resolve(projectRoot), ".editcore", "rag");
}

/**
 * Guarda conocimiento externo en el Cerebro RAG de EditCore.
 */
function saveToBrain(projectRoot, title, content, meta = {}) {
  if (!projectRoot) return { ok: false, error: "Falta projectRoot" };
  const cleanTitle = String(title || "").trim() || "documento";
  const body = String(content ?? "");
  if (!body.trim()) return { ok: false, error: "content vacío" };

  const dir = ragDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${sanitizeTitle(cleanTitle)}.md`;
  const filePath = path.join(dir, fileName);
  const source = meta.source ? `\nFuente: ${meta.source}` : "";
  const tags = Array.isArray(meta.tags) && meta.tags.length
    ? `\nTags: ${meta.tags.join(", ")}`
    : "";

  const document = [
    `# ${cleanTitle}`,
    "",
    `Fecha de ingesta: ${new Date().toISOString()}${source}${tags}`,
    "",
    body,
    "",
  ].join("\n");

  fs.writeFileSync(filePath, document, "utf8");

  // Índice ligero para listar memorias del cerebro
  const indexPath = path.join(dir, "_index.json");
  let index = { updatedAt: "", documents: [] };
  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8")) || index;
    }
  } catch { /* ignore */ }
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  index.documents = Array.isArray(index.documents) ? index.documents : [];
  index.documents = [
    {
      title: cleanTitle,
      path: rel,
      source: meta.source || "",
      ingestedAt: new Date().toISOString(),
      bytes: document.length,
    },
    ...index.documents.filter((d) => d?.path !== rel),
  ].slice(0, 200);
  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return {
    ok: true,
    path: rel,
    absolutePath: filePath,
    title: cleanTitle,
    bytes: document.length,
  };
}

function listBrainDocs(projectRoot, limit = 40) {
  const dir = ragDir(projectRoot);
  if (!fs.existsSync(dir)) return { ok: true, documents: [], note: "Cerebro RAG vacío" };
  const indexPath = path.join(dir, "_index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      return {
        ok: true,
        documents: (index.documents || []).slice(0, limit),
        updatedAt: index.updatedAt || null,
      };
    } catch { /* fallthrough */ }
  }
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .slice(0, limit)
    .map((f) => ({
      title: f.replace(/\.md$/i, ""),
      path: path.join(".editcore", "rag", f).replace(/\\/g, "/"),
    }));
  return { ok: true, documents: files };
}

const SEARCH_STOPWORDS = new Set([
  "que", "con", "los", "las", "una", "uno", "por", "para", "del", "como", "este", "esta", "esto", "mas",
  "sin", "sus", "hay", "muy", "todo", "pero", "cual", "donde", "cuando", "the", "and", "for", "with", "that", "this",
]);

function searchTokens(text = "") {
  return [...new Set(String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !SEARCH_STOPWORDS.has(t)))];
}

function chunkDocument(text, size = 1200) {
  const chunks = [];
  let current = "";
  for (const para of String(text || "").split(/\n\s*\n/)) {
    if (current && current.length + para.length > size) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${para}` : para;
    while (current.length > size * 1.5) { chunks.push(current.slice(0, size)); current = current.slice(size); }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/**
 * Búsqueda por palabras en los documentos ingeridos (.editcore/rag/*.md).
 */
function searchBrainDocs(projectRoot, query, limit = 5) {
  if (!projectRoot) return [];
  const dir = ragDir(projectRoot);
  const tokens = searchTokens(query);
  if (!tokens.length || !fs.existsSync(dir)) return [];
  const results = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    let text = "";
    try { text = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || file.replace(/\.md$/i, "");
    for (const chunk of chunkDocument(text)) {
      const haystack = ` ${searchTokens(chunk).join(" ")} `;
      let score = 0;
      for (const t of tokens) if (haystack.includes(` ${t}`)) score += 1;
      if (score > 0) results.push({ title, path: path.join(".editcore", "rag", file).replace(/\\/g, "/"), score, text: chunk.trim() });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
}

const INGEST_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".pdf", ".docx", ".xlsx", ".csv", ".json"]);
const INGEST_SKIP_DIRS = new Set([".git", "node_modules", ".editcore", "dist", "build", ".next", "vendor"]);
const INGEST_MAX_FILES = 40;
const INGEST_MAX_CHARS = 60_000;

function collectIngestFiles(dir, depth = 0, out = []) {
  if (depth > 2 || out.length >= INGEST_MAX_FILES) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= INGEST_MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!INGEST_SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) collectIngestFiles(full, depth + 1, out);
    } else if (entry.isFile() && INGEST_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !/^\.env/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function extractFileText(file) {
  const ext = path.extname(file).toLowerCase();
  if ([".pdf", ".docx", ".xlsx"].includes(ext)) {
    const { extractDocumentFromBuffer } = require("../document-attachments");
    const doc = await extractDocumentFromBuffer(path.basename(file), fs.readFileSync(file));
    if (!doc.supported) throw new Error(doc.error || "Formato no compatible");
    return String(doc.text || "");
  }
  return fs.readFileSync(file, "utf8");
}

/**
 * Ingesta un archivo o una carpeta de documentación (md, txt, pdf, docx, xlsx) al Cerebro del proyecto.
 */
async function ingestPathToBrain(projectRoot, absolutePath) {
  const target = path.resolve(String(absolutePath || ""));
  if (!fs.existsSync(target)) return { ok: false, error: `No existe: ${absolutePath}` };
  const files = fs.statSync(target).isDirectory() ? collectIngestFiles(target) : [target];
  if (!files.length) return { ok: false, error: "No hay documentos compatibles (md, txt, pdf, docx, xlsx, csv, json)." };
  const ingested = [];
  const failed = [];
  for (const file of files) {
    try {
      const text = (await extractFileText(file)).slice(0, INGEST_MAX_CHARS);
      if (!text.trim()) { failed.push({ file: path.basename(file), error: "vacío" }); continue; }
      const rel = path.relative(path.dirname(target), file).replace(/\\/g, "/");
      const saved = saveToBrain(projectRoot, rel, text, { source: file, tags: ["documentacion"] });
      if (saved.ok) ingested.push(saved.path); else failed.push({ file: rel, error: saved.error });
    } catch (e) {
      failed.push({ file: path.basename(file), error: String(e?.message || e).slice(0, 160) });
    }
  }
  return { ok: ingested.length > 0, ingested: ingested.length, documents: ingested.slice(0, 40), failed: failed.slice(0, 10), truncated: files.length >= INGEST_MAX_FILES };
}

module.exports = {
  saveToBrain,
  listBrainDocs,
  searchBrainDocs,
  ingestPathToBrain,
  ragDir,
  sanitizeTitle,
};
