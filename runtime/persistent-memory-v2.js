"use strict";

/**
 * PERSISTENT MEMORY V2 — Memoria multicapa al 100% para EditCoreAI
 *
 * Capas:
 *  1. Short-term  (sesión en RAM + snapshot a disco cada N operaciones)
 *  2. Long-term   (JSON estructurado + índice invertido en .editcore/memory-v2/)
 *  3. Semantic    (búsqueda híbrida keyword + TF-IDF simple; embedding opcional vía transformers)
 *  4. Self-awareness (índice de arquitectura del propio proyecto EditCoreAI)
 *
 * Diseño:
 *  - Escrituras atómicas (tmp + rename)
 *  - Recuperación semántica que inyecta SOLO lo relevante en el prompt
 *  - Compatible IDE + Web (mismo path de proyecto)
 *  - Sin dependencias nuevas obligatorias
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MEMORY_VERSION = 2;
const DEFAULT_LIMITS = {
  shortTermMax: 40,
  conversationsMax: 50,
  filesMax: 200,
  decisionsMax: 80,
  patternsMax: 100,
  knowledgeMax: 300,
  indexTermsMax: 5000,
};

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function generateId(prefix = "m") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function tokenize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && t.length < 64);
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

class PersistentMemoryV2 {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   */
  constructor(projectRoot, options = {}) {
    if (!projectRoot) throw new Error("PersistentMemoryV2 requiere projectRoot");
    this.projectRoot = path.resolve(projectRoot);
    this.memoryRoot = path.join(this.projectRoot, ".editcore", "memory-v2");
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    this.autoSaveEvery = options.autoSaveEvery || 5;
    this._opsSinceSave = 0;
    this._dirty = false;

    // Short-term (sesión)
    this.shortTerm = {
      sessionId: generateId("sess"),
      startedAt: Date.now(),
      messages: [],
      toolResults: [],
      currentTask: null,
      openFiles: [],
    };

    // Long-term
    this.longTerm = {
      version: MEMORY_VERSION,
      conversations: [],
      files: [],
      decisions: [],
      patterns: [],      // patrones aprendidos (convenciones, reglas de proyecto)
      knowledge: [],     // conocimiento acumulado (hechos, APIs, limitaciones)
      selfAwareness: null,
      invertedIndex: {}, // term -> [entryIds]
      lastAccess: Date.now(),
      stats: { loads: 0, saves: 0, searches: 0 },
    };

    this._entryMap = new Map(); // id -> entry (para retrieval rápido)
  }

  // ─────────────────────────────────────────────
  // Persistencia
  // ─────────────────────────────────────────────

  _paths() {
    return {
      longTerm: path.join(this.memoryRoot, "long-term.json"),
      shortTerm: path.join(this.memoryRoot, "short-term.json"),
      selfAwareness: path.join(this.memoryRoot, "self-awareness.json"),
      index: path.join(this.memoryRoot, "inverted-index.json"),
    };
  }

  async load() {
    const p = this._paths();
    try {
      if (fs.existsSync(p.longTerm)) {
        const data = safeJsonParse(fs.readFileSync(p.longTerm, "utf8"), null);
        if (data && data.version === MEMORY_VERSION) {
          this.longTerm = { ...this.longTerm, ...data };
        }
      }
      if (fs.existsSync(p.shortTerm)) {
        const st = safeJsonParse(fs.readFileSync(p.shortTerm, "utf8"), null);
        if (st) this.shortTerm = { ...this.shortTerm, ...st, sessionId: generateId("sess") };
      }
      if (fs.existsSync(p.selfAwareness)) {
        this.longTerm.selfAwareness = safeJsonParse(fs.readFileSync(p.selfAwareness, "utf8"), null);
      }
      if (fs.existsSync(p.index)) {
        this.longTerm.invertedIndex = safeJsonParse(fs.readFileSync(p.index, "utf8"), {}) || {};
      }
      this._rebuildEntryMap();
      this.longTerm.stats.loads = (this.longTerm.stats.loads || 0) + 1;
      this.longTerm.lastAccess = Date.now();
    } catch (err) {
      console.warn(`[MemoryV2] load warning: ${err.message}`);
    }
    return this.snapshot();
  }

  async save(force = false) {
    if (!this._dirty && !force) return false;
    const p = this._paths();
    try {
      fs.mkdirSync(this.memoryRoot, { recursive: true });
      this.longTerm.lastAccess = Date.now();
      this.longTerm.stats.saves = (this.longTerm.stats.saves || 0) + 1;

      atomicWrite(p.longTerm, JSON.stringify(this.longTerm, null, 2));
      atomicWrite(p.shortTerm, JSON.stringify(this.shortTerm, null, 2));
      if (this.longTerm.selfAwareness) {
        atomicWrite(p.selfAwareness, JSON.stringify(this.longTerm.selfAwareness, null, 2));
      }
      atomicWrite(p.index, JSON.stringify(this.longTerm.invertedIndex));
      this._dirty = false;
      this._opsSinceSave = 0;
      return true;
    } catch (err) {
      console.error(`[MemoryV2] save error: ${err.message}`);
      return false;
    }
  }

  _touch() {
    this._dirty = true;
    this._opsSinceSave += 1;
    if (this._opsSinceSave >= this.autoSaveEvery) {
      this.save().catch(() => {});
    }
  }

  _rebuildEntryMap() {
    this._entryMap.clear();
    for (const list of [
      this.longTerm.conversations,
      this.longTerm.files,
      this.longTerm.decisions,
      this.longTerm.patterns,
      this.longTerm.knowledge,
    ]) {
      for (const e of list) {
        if (e && e.id) this._entryMap.set(e.id, e);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Indexación
  // ─────────────────────────────────────────────

  _indexEntry(entry) {
    if (!entry || !entry.id) return;
    const text = [
      entry.summary,
      entry.decision,
      entry.reasoning,
      entry.path,
      entry.content,
      entry.pattern,
      entry.fact,
      ...(entry.tags || []),
    ]
      .filter(Boolean)
      .join(" ");
    const terms = [...new Set(tokenize(text))];
    for (const term of terms) {
      if (!this.longTerm.invertedIndex[term]) this.longTerm.invertedIndex[term] = [];
      const arr = this.longTerm.invertedIndex[term];
      if (!arr.includes(entry.id)) arr.push(entry.id);
      // limitar tamaño por término
      if (arr.length > 80) arr.splice(0, arr.length - 80);
    }
    // limitar términos totales
    const keys = Object.keys(this.longTerm.invertedIndex);
    if (keys.length > this.limits.indexTermsMax) {
      for (const k of keys.slice(0, keys.length - this.limits.indexTermsMax)) {
        delete this.longTerm.invertedIndex[k];
      }
    }
  }

  // ─────────────────────────────────────────────
  // Escritura de memoria
  // ─────────────────────────────────────────────

  addConversation(summary, metadata = {}) {
    const entry = {
      id: generateId("conv"),
      type: "conversation",
      summary: String(summary || "").slice(0, 4000),
      timestamp: Date.now(),
      tokensUsed: metadata.tokensUsed || 0,
      stepsExecuted: metadata.stepsExecuted || 0,
      completed: metadata.completed === true,
      tags: metadata.tags || [],
    };
    this.longTerm.conversations.push(entry);
    if (this.longTerm.conversations.length > this.limits.conversationsMax) {
      this.longTerm.conversations.shift();
    }
    this._entryMap.set(entry.id, entry);
    this._indexEntry(entry);
    this._touch();
    return entry.id;
  }

  addFile(filePath, action = "read", metadata = {}) {
    const rel = path.relative(this.projectRoot, path.resolve(this.projectRoot, filePath)).replace(/\\/g, "/");
    const entry = {
      id: generateId("file"),
      type: "file",
      path: rel,
      action,
      timestamp: Date.now(),
      size: metadata.size || 0,
      summary: String(metadata.summary || "").slice(0, 2000),
      tags: metadata.tags || [],
    };
    const idx = this.longTerm.files.findIndex((f) => f.path === rel);
    if (idx >= 0) {
      this.longTerm.files[idx] = entry;
    } else {
      this.longTerm.files.push(entry);
      if (this.longTerm.files.length > this.limits.filesMax) this.longTerm.files.shift();
    }
    this._entryMap.set(entry.id, entry);
    this._indexEntry(entry);
    this._touch();
    return entry.id;
  }

  addDecision(decision, reasoning = "", metadata = {}) {
    const entry = {
      id: generateId("dec"),
      type: "decision",
      decision: String(decision || "").slice(0, 1500),
      reasoning: String(reasoning || "").slice(0, 3000),
      timestamp: Date.now(),
      tags: metadata.tags || [],
    };
    this.longTerm.decisions.push(entry);
    if (this.longTerm.decisions.length > this.limits.decisionsMax) this.longTerm.decisions.shift();
    this._entryMap.set(entry.id, entry);
    this._indexEntry(entry);
    this._touch();
    return entry.id;
  }

  addPattern(pattern, description = "", metadata = {}) {
    const entry = {
      id: generateId("pat"),
      type: "pattern",
      pattern: String(pattern || "").slice(0, 1000),
      description: String(description || "").slice(0, 2000),
      timestamp: Date.now(),
      confidence: metadata.confidence ?? 0.7,
      tags: metadata.tags || [],
    };
    this.longTerm.patterns.push(entry);
    if (this.longTerm.patterns.length > this.limits.patternsMax) this.longTerm.patterns.shift();
    this._entryMap.set(entry.id, entry);
    this._indexEntry(entry);
    this._touch();
    return entry.id;
  }

  addKnowledge(fact, source = "", metadata = {}) {
    const entry = {
      id: generateId("know"),
      type: "knowledge",
      fact: String(fact || "").slice(0, 2000),
      source: String(source || "").slice(0, 500),
      timestamp: Date.now(),
      tags: metadata.tags || [],
    };
    this.longTerm.knowledge.push(entry);
    if (this.longTerm.knowledge.length > this.limits.knowledgeMax) this.longTerm.knowledge.shift();
    this._entryMap.set(entry.id, entry);
    this._indexEntry(entry);
    this._touch();
    return entry.id;
  }

  // Short-term helpers
  pushShortMessage(role, content) {
    this.shortTerm.messages.push({
      role,
      content: String(content || "").slice(0, 8000),
      at: Date.now(),
    });
    if (this.shortTerm.messages.length > this.limits.shortTermMax) {
      this.shortTerm.messages.shift();
    }
    this._touch();
  }

  setCurrentTask(task) {
    this.shortTerm.currentTask = task ? String(task).slice(0, 2000) : null;
    this._touch();
  }

  // ─────────────────────────────────────────────
  // Self-awareness del propio EditCoreAI
  // ─────────────────────────────────────────────

  /**
   * Indexa la arquitectura del proyecto EditCoreAI (o del proyecto actual).
   * Debe llamarse al inicio de sesión o cuando cambie la estructura.
   */
  async buildSelfAwareness(options = {}) {
    const root = this.projectRoot;
    const awareness = {
      builtAt: Date.now(),
      root,
      structure: {},
      keyModules: [],
      capabilities: [],
      limitations: [],
      agentTopology: [],
    };

    const interesting = [
      "main.js", "preload.js", "renderer.js", "agent-runtime.js",
      "runtime", "editcore-chat-kernel", "ide", "web-portal",
      "brain-seed", "package.json", "AGENTS.md", "ARQUITECTURA-SISTEMA.md",
    ];

    for (const name of interesting) {
      const full = path.join(root, name);
      try {
        if (!fs.existsSync(full)) continue;
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          const children = fs.readdirSync(full).slice(0, 40);
          awareness.structure[name] = { type: "dir", children };
          if (name === "runtime") {
            awareness.keyModules = children
              .filter((c) => c.endsWith(".js"))
              .map((c) => `runtime/${c}`);
          }
        } else {
          awareness.structure[name] = { type: "file", size: st.size };
        }
      } catch {
        // ignore
      }
    }

    // Capacidades conocidas (estáticas + detectadas)
    awareness.capabilities = [
      "lectura/escritura atómica de archivos",
      "checkpoints de corridas de agente",
      "memoria persistente multicapa (v2)",
      "token harness + prompt caching",
      "bus inter-agentes",
      "análisis estático / AST",
      "skills modulares (brain-seed)",
      "deploy Vercel / git / Supabase (según vault)",
    ];

    awareness.limitations = [
      "no inventar APIs inexistentes",
      "no dejar código truncado ni TODOs pendientes de implementación",
      "respetar permission-mode y backups antes de mutaciones",
      "evitar bucles de reexploración (usar ROADMAP / memoria)",
    ];

    awareness.agentTopology = [
      { role: "Supervisor/Router", module: "editcore-chat-kernel/classify.js + runtime/intent-orchestrator" },
      { role: "Lector/Analista", module: "runtime/codebase-indexer + project-analysis" },
      { role: "Programador/Escritor", module: "runtime/agent-tools-suite + patch-engine" },
      { role: "Revisor/QA", module: "runtime/anti-hallucination-policy + tests" },
      { role: "Gestor de Memoria", module: "runtime/persistent-memory-v2" },
    ];

    this.longTerm.selfAwareness = awareness;
    atomicWrite(this._paths().selfAwareness, JSON.stringify(awareness, null, 2));
    this._touch();
    return awareness;
  }

  getSelfAwarenessSummary() {
    const a = this.longTerm.selfAwareness;
    if (!a) return "Self-awareness aún no construida. Llama a buildSelfAwareness().";
    return [
      `Arquitectura EditCoreAI indexada (${new Date(a.builtAt).toISOString()})`,
      `Módulos clave: ${(a.keyModules || []).slice(0, 12).join(", ")}…`,
      `Capacidades: ${(a.capabilities || []).join("; ")}`,
      `Limitaciones: ${(a.limitations || []).join("; ")}`,
      `Topología agentes: ${(a.agentTopology || []).map((t) => t.role).join(" → ")}`,
    ].join("\n");
  }

  // ─────────────────────────────────────────────
  // Recuperación semántica / híbrida
  // ─────────────────────────────────────────────

  /**
   * Búsqueda híbrida: keyword (índice invertido) + ranking simple TF.
   * Devuelve solo las entradas más relevantes para inyectar en el prompt.
   */
  search(query, options = {}) {
    const limit = options.limit || 12;
    const types = options.types || null; // array de tipos o null = todos
    this.longTerm.stats.searches = (this.longTerm.stats.searches || 0) + 1;

    const terms = tokenize(query);
    if (!terms.length) {
      return { query, results: [], injectedText: "" };
    }

    const scores = new Map(); // id -> score

    for (const term of terms) {
      const ids = this.longTerm.invertedIndex[term] || [];
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    // Boost por coincidencia exacta en campos cortos
    for (const [id, entry] of this._entryMap) {
      if (types && !types.includes(entry.type)) continue;
      const blob = `${entry.summary || ""} ${entry.decision || ""} ${entry.path || ""} ${entry.fact || ""} ${entry.pattern || ""}`.toLowerCase();
      if (blob.includes(query.toLowerCase())) {
        scores.set(id, (scores.get(id) || 0) + 3);
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => {
        const entry = this._entryMap.get(id);
        return entry ? { score, ...entry } : null;
      })
      .filter(Boolean);

    const injectedText = this._formatForPrompt(ranked, options.maxChars || 3500);

    return { query, results: ranked, injectedText };
  }

  _formatForPrompt(entries, maxChars) {
    if (!entries.length) return "";
    const lines = ["[MEMORIA RELEVANTE]"];
    let used = lines[0].length;
    for (const e of entries) {
      let line = "";
      if (e.type === "conversation") line = `• Conv: ${e.summary}`;
      else if (e.type === "file") line = `• File(${e.action}): ${e.path} — ${e.summary || ""}`;
      else if (e.type === "decision") line = `• Decisión: ${e.decision} | ${e.reasoning || ""}`;
      else if (e.type === "pattern") line = `• Patrón: ${e.pattern} — ${e.description || ""}`;
      else if (e.type === "knowledge") line = `• Hecho: ${e.fact} (src: ${e.source || "—"})`;
      else line = `• ${JSON.stringify(e).slice(0, 200)}`;
      line = line.slice(0, 400);
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join("\n");
  }

  /**
   * Contexto listo para inyectar al inicio del system/prompt (cache-friendly).
   * Bloque estático + estado dinámico al final.
   */
  getPromptContext(query = "", options = {}) {
    const parts = [];

    // Bloque estático (bueno para cache del proveedor)
    const self = this.getSelfAwarenessSummary();
    if (self) parts.push(self);

    // Patrones y conocimiento de largo plazo (más estables)
    const patterns = this.longTerm.patterns.slice(-8);
    if (patterns.length) {
      parts.push(
        "[PATRONES APRENDIDOS]\n" +
          patterns.map((p) => `• ${p.pattern}: ${p.description || ""}`).join("\n")
      );
    }

    // Recuperación semántica dinámica (va al final → menos impacto en cache)
    if (query) {
      const { injectedText } = this.search(query, { limit: options.limit || 10, maxChars: options.maxChars || 3000 });
      if (injectedText) parts.push(injectedText);
    }

    // Short-term task
    if (this.shortTerm.currentTask) {
      parts.push(`[TAREA ACTUAL]\n${this.shortTerm.currentTask}`);
    }

    return parts.filter(Boolean).join("\n\n");
  }

  // ─────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────

  snapshot() {
    return {
      sessionId: this.shortTerm.sessionId,
      shortTermCount: this.shortTerm.messages.length,
      conversations: this.longTerm.conversations.length,
      files: this.longTerm.files.length,
      decisions: this.longTerm.decisions.length,
      patterns: this.longTerm.patterns.length,
      knowledge: this.longTerm.knowledge.length,
      indexTerms: Object.keys(this.longTerm.invertedIndex).length,
      hasSelfAwareness: Boolean(this.longTerm.selfAwareness),
      stats: { ...this.longTerm.stats },
    };
  }

  async clearShortTerm() {
    this.shortTerm.messages = [];
    this.shortTerm.toolResults = [];
    this.shortTerm.currentTask = null;
    this._touch();
    await this.save(true);
  }

  async clearAll(confirm = false) {
    if (!confirm) throw new Error("clearAll requiere confirm=true");
    this.longTerm = {
      version: MEMORY_VERSION,
      conversations: [],
      files: [],
      decisions: [],
      patterns: [],
      knowledge: [],
      selfAwareness: null,
      invertedIndex: {},
      lastAccess: Date.now(),
      stats: { loads: 0, saves: 0, searches: 0 },
    };
    this._entryMap.clear();
    await this.clearShortTerm();
    await this.save(true);
  }
}

module.exports = {
  PersistentMemoryV2,
  createPersistentMemory: (projectRoot, options) => new PersistentMemoryV2(projectRoot, options),
};
