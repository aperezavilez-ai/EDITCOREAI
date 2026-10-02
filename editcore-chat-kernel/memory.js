"use strict";

const fs = require("fs");
const path = require("path");

class PersistentMemory {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dir = path.join(projectRoot, ".editcore", "chat-memory");
    this.file = path.join(this.dir, "memory.json");
    this.data = { notes: [], files: [], lastReport: "" };

    // [EDITCORE-ADD] Vector store opcional. Si falla el import, todo sigue igual.
    this._vector = null;
    try {
      const { VectorMemory } = require("../runtime/vector-memory");
      this._vector = new VectorMemory(path.join(this.dir, "vectors"));
    } catch (_) { this._vector = null; }
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      }
    } catch (_) {}
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (this.data.notes.length > 40) this.data.notes = this.data.notes.slice(-40);
      if (this.data.files.length > 60) this.data.files = this.data.files.slice(-60);
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
    } catch (_) {}
  }

  note(text) {
    this.data.notes.push({ t: Date.now(), text: String(text).slice(0, 400) });
    this.save();
    // [EDITCORE-ADD] Indexar en el vector store en background (no bloquea).
    if (this._vector) {
      const _v = String(text || "").slice(0, 400);
      if (_v.trim()) {
        Promise.resolve()
          .then(() => this._vector.add(_v, { type: "note", t: Date.now() }, "notes"))
          .catch(() => {});
      }
    }
  }

  touchFile(rel, action) {
    this.data.files.push({ t: Date.now(), rel, action });
    this.save();
    // [EDITCORE-ADD] Indexar el archivo tocado también.
    if (this._vector && rel) {
      Promise.resolve()
        .then(() => this._vector.add(`${action || "touch"} ${rel}`, { type: "file", rel, action }, "files"))
        .catch(() => {});
    }
    try {
      const tm = require("./thread-memory");
      const state = tm.loadProjectState(this.projectRoot);
      state.files = [...(state.files || []), { t: Date.now(), rel, action }].slice(-80);
      tm.saveProjectState(this.projectRoot, state);
    } catch (_) {}
  }

  setReport(md) {
    this.data.lastReport = String(md || "").slice(0, 12000);
    this.save();
  }

  promptBlock() {
    const notes = this.data.notes.slice(-6).map((n) => `- ${n.text}`).join("\n");
    const files = this.data.files.slice(-8).map((f) => `- ${f.action} ${f.rel}`).join("\n");
    const parts = [];
    if (notes) parts.push("MEMORIA NOTAS:\n" + notes);
    if (files) parts.push("ARCHIVOS TOCADOS:\n" + files);
    if (this.data.lastReport) parts.push("ULTIMO REPORTE (recorte):\n" + this.data.lastReport.slice(0, 1200));
    return parts.join("\n\n").slice(0, 2500);
  }

  // =====================================================================
  // [EDITCORE-ADD] Búsqueda semántica en notas y archivos.
  // No modifica nada existente. Si el vector store no cargó, devuelve [].
  // =====================================================================
  async searchSemantic(query, { topK = 6, ns = null } = {}) {
    if (!this._vector || !query) return [];
    try {
      const q = String(query || "").trim();
      if (!q) return [];
      const buckets = ns ? [ns] : ["notes", "files"];
      const all = [];
      for (const b of buckets) {
        const hits = await this._vector.search(q, { topK, ns: b, minScore: 0.10 });
        for (const h of hits) all.push(h);
      }
      all.sort((a, b) => b.score - a.score);
      return all.slice(0, topK);
    } catch (_) {
      return [];
    }
  }

  // [EDITCORE-ADD] promptBlock enriquecido con búsqueda semántica (opcional).
  // Si no hay hits semánticos, cae al promptBlock() original exactamente igual.
  async promptBlockSemantic(query) {
    try {
      const hits = await this.searchSemantic(query, { topK: 6 });
      if (!hits.length) return this.promptBlock();
      const lines = hits.map((h) => {
        const tag = h.meta && h.meta.type === "file" ? "📄" : "📝";
        return `- ${tag} ${String(h.text || "").slice(0, 300)}`;
      });
      const base = this.promptBlock();
      return (base ? base + "\n\n" : "") +
        "MEMORIA SEMÁNTICA (más relevante al pedido actual):\n" + lines.join("\n");
    } catch (_) {
      return this.promptBlock();
    }
  }
  // [/EDITCORE-ADD]
}

module.exports = { PersistentMemory };