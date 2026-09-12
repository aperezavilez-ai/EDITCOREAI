"use strict";

const fs = require("fs");
const path = require("path");

class PersistentMemory {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dir = path.join(projectRoot, ".editcore", "chat-memory");
    this.file = path.join(this.dir, "memory.json");
    this.data = { notes: [], files: [], lastReport: "" };
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
  }

  touchFile(rel, action) {
    this.data.files.push({ t: Date.now(), rel, action });
    this.save();
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
}

module.exports = { PersistentMemory };