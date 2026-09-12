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

module.exports = {
  saveToBrain,
  listBrainDocs,
  ragDir,
  sanitizeTitle,
};
