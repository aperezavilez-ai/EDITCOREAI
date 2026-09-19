"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RULE_FILES = [
  ".cursorrules",
  ".codexrules",
  ".rules",
  "AGENTS.md",
  path.join(".editcore", "rules.md"),
];
const CONTEXT_RELATIVE_PATH = path.join(".editcore", "context.md");
const ROADMAP_FILES = ["ROADMAP.md", path.join("ROADMAP", "ROADMAP.md")];

function loadRulesFromDir(projectRoot, relativeDir, { maxFiles = 12, maxChars = 4_000 } = {}) {
  const dir = path.join(path.resolve(String(projectRoot || "")), ...String(relativeDir).split(/[/\\]+/).filter(Boolean));
  const out = [];
  const walk = (abs, relBase) => {
    if (out.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const rel = relBase ? `${relBase}/${entry.name}` : `${relativeDir.replace(/\\/g, "/")}/${entry.name}`;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile() || !/\.(md|mdc|txt)$/i.test(entry.name)) continue;
      const content = readLimited(full, maxChars);
      if (content) out.push({ name: rel.replace(/\\/g, "/"), content });
    }
  };
  try {
    if (!fs.statSync(dir).isDirectory()) return [];
    walk(dir, relativeDir.replace(/\\/g, "/"));
  } catch {
    return [];
  }
  return out;
}

function loadEditcoreRulesDir(projectRoot) {
  return loadRulesFromDir(projectRoot, path.join(".editcore", "rules"));
}

function loadCursorRulesDir(projectRoot) {
  return loadRulesFromDir(projectRoot, path.join(".cursor", "rules"), { maxFiles: 16, maxChars: 5_000 });
}

function readLimited(filePath, maxChars = 8_000) {
  try {
    if (!fs.statSync(filePath).isFile()) return "";
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars).trim();
  } catch {
    return "";
  }
}

const { loadProjectMemory, formatMemoryForPrompt } = require("./project-memory");

function loadProjectContext(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const rules = [
    ...RULE_FILES
      .map((name) => ({ name, content: readLimited(path.join(root, name), 6_000) }))
      .filter((item) => item.content),
    ...loadEditcoreRulesDir(root),
    ...loadCursorRulesDir(root),
  ];
  const context = readLimited(path.join(root, CONTEXT_RELATIVE_PATH), 8_000);
  const roadmap = ROADMAP_FILES
    .map((name) => ({ name, content: readLimited(path.join(root, name), 6_000) }))
    .find((item) => item.content) || { name: "", content: "" };
  const memory = loadProjectMemory(root);
  const memoryPrompt = formatMemoryForPrompt(memory);
  return {
    context,
    roadmap: roadmap.content,
    roadmapPath: roadmap.name,
    contextPath: path.join(root, CONTEXT_RELATIVE_PATH),
    memory,
    rules,
    prompt: [
      ...rules.map((item) => `REGLAS ${item.name}:\n${item.content}`),
      roadmap.content ? `ROADMAP (${roadmap.name}) — indice compacto, no reexplorar el repo:\n${roadmap.content}` : "",
      context ? `MEMORIA PERSISTENTE:\n${context}` : "",
      memoryPrompt,
    ].filter(Boolean).join("\n\n"),
  };
}

function listText(values) {
  const rows = [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
  return rows.length ? rows.map((value) => `- ${value}`).join("\n") : "- Ninguno todavia";
}

function writeProjectContext(projectRoot, input = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const target = path.join(root, CONTEXT_RELATIVE_PATH);
  const directory = path.dirname(target);
  const content = [
    "[TAREA ACTIVA]",
    String(input.task || "Sin tarea activa").trim(),
    "",
    "[ARCHIVOS AFECTADOS]",
    listText(input.files),
    "",
    "[ESTADO]",
    String(input.status || "En progreso").trim(),
    "",
    "[SIGUIENTE ACCION]",
    String(input.nextAction || "Continuar desde el ultimo checkpoint verificado.").trim(),
    "",
  ].join("\n");
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, target);
  return { path: target, content };
}

class ContentHashCache {
  constructor() {
    this.entries = new Map();
  }

  hash(value) {
    return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || null)).digest("hex");
  }

  set(namespace, key, value, source = value) {
    const cacheKey = `${String(namespace || "default")}:${String(key || "")}`;
    const sourceHash = this.hash(source);
    const valueHash = this.hash(value);
    this.entries.set(cacheKey, { sourceHash, valueHash, value });
    return { key: cacheKey, sourceHash, valueHash, value };
  }

  get(namespace, key, source) {
    const cacheKey = `${String(namespace || "default")}:${String(key || "")}`;
    const entry = this.entries.get(cacheKey);
    if (!entry) return null;
    if (this.hash(source) !== entry.sourceHash) {
      this.entries.delete(cacheKey);
      return null;
    }
    return entry.value;
  }

  getOrCreate(namespace, key, source, create) {
    const cached = this.get(namespace, key, source);
    if (cached !== null) return cached;
    const value = create(source);
    this.set(namespace, key, value, source);
    return value;
  }

  invalidate(namespace, key = "") {
    const prefix = `${String(namespace || "default")}:${String(key || "")}`;
    let removed = 0;
    for (const cacheKey of [...this.entries.keys()]) {
      if (cacheKey === prefix || (!key && cacheKey.startsWith(prefix))) {
        this.entries.delete(cacheKey);
        removed += 1;
      }
    }
    return removed;
  }
}

class ReversibleContextStore {
  constructor({ root, maxEntries = 500 } = {}) {
    this.root = path.resolve(String(root || ""));
    this.maxEntries = Math.max(50, Number(maxEntries) || 500);
  }

  store(value, metadata = {}) {
    const content = typeof value === "string" ? value : JSON.stringify(value);
    const id = crypto.createHash("sha256").update(content).digest("hex");
    const target = path.join(this.root, `${id}.json`);
    fs.mkdirSync(this.root, { recursive: true });
    if (!fs.existsSync(target)) {
      const payload = { id, hash: id, createdAt: new Date().toISOString(), metadata, size: content.length, content };
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload), "utf8");
      fs.renameSync(temporary, target);
      this.prune();
    }
    return { id, chars: content.length, metadata };
  }

  retrieve(id, { start = 0, maxChars = 16_000 } = {}) {
    const safeId = String(id || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(safeId)) throw new Error("Referencia de contexto invalida.");
    const payload = JSON.parse(fs.readFileSync(path.join(this.root, `${safeId}.json`), "utf8"));
    const actualHash = crypto.createHash("sha256").update(String(payload.content || "")).digest("hex");
    if (actualHash !== safeId) throw new Error("La referencia de contexto fue invalidada porque su contenido cambio.");
    const offset = Math.max(0, Number(start) || 0);
    const limit = Math.min(50_000, Math.max(500, Number(maxChars) || 16_000));
    const content = String(payload.content || "");
    return {
      id: safeId,
      content: content.slice(offset, offset + limit),
      start: offset,
      end: Math.min(content.length, offset + limit),
      totalChars: content.length,
      hasMore: offset + limit < content.length,
      metadata: payload.metadata || {},
    };
  }

  has(id) {
    const safeId = String(id || "").trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(safeId) && fs.existsSync(path.join(this.root, `${safeId}.json`));
  }

  describe(id) {
    const safeId = String(id || "").trim().toLowerCase();
    if (!this.has(safeId)) return null;
    const payload = JSON.parse(fs.readFileSync(path.join(this.root, `${safeId}.json`), "utf8"));
    return { id: safeId, hash: safeId, size: Number(payload.size) || String(payload.content || "").length, createdAt: payload.createdAt, metadata: payload.metadata || {} };
  }

  invalidate(id) {
    const safeId = String(id || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(safeId)) return false;
    const target = path.join(this.root, `${safeId}.json`);
    const existed = fs.existsSync(target);
    if (existed) fs.rmSync(target, { force: true });
    return existed;
  }

  summarize(value, metadata = {}, maxChars = 2_400) {
    const content = typeof value === "string" ? value : JSON.stringify(value);
    if (content.length <= maxChars) return value;
    const stored = this.store(content, metadata);
    const headChars = Math.max(400, Math.floor(maxChars * 0.64));
    const tailChars = Math.max(240, maxChars - headChars - 240);
    return `${content.slice(0, headChars)}\n[EDITCOREAI: ${content.length - headChars - tailChars} caracteres archivados. Usa retrieve_context con id ${stored.id}]\n${content.slice(-tailChars)}`;
  }

  prune() {
    const entries = fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
      .map((entry) => ({ name: entry.name, mtimeMs: fs.statSync(path.join(this.root, entry.name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(this.maxEntries)) fs.rmSync(path.join(this.root, entry.name), { force: true });
  }
}

module.exports = {
  CONTEXT_RELATIVE_PATH,
  RULE_FILES,
  ROADMAP_FILES,
  ContentHashCache,
  ReversibleContextStore,
  loadProjectContext,
  writeProjectContext,
  loadCursorRulesDir,
  loadEditcoreRulesDir,
};
