"use strict";

/**
 * IDE REVIEW QUEUE — MVP tipo Cursor (accept / reject de cambios del agente)
 * Fase IDE-A
 *
 * - Cada write_file del agente puede registrarse como cambio revisable
 * - before/after + diff unificado simple
 * - accept (confirmar) / reject (restaurar backup)
 * - acceptAll / rejectAll
 *
 * Persistencia: .editcore/review-queue/queue.json
 * Compatible con backups de tools (snapshot) y disk-tools.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const QUEUE_VERSION = 1;

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function safeRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function relPath(projectRoot, absOrRel) {
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(absOrRel)
    ? path.normalize(absOrRel)
    : path.normalize(path.join(root, absOrRel));
  return path.relative(root, abs).replace(/\\/g, "/");
}

function simpleUnifiedDiff(rel, before, after) {
  const a = String(before ?? "").replace(/\r\n/g, "\n").split("\n");
  const b = String(after ?? "").replace(/\r\n/g, "\n").split("\n");
  const lines = [`--- a/${rel}`, `+++ b/${rel}`, "@@"];
  const max = Math.max(a.length, b.length);
  const limit = Math.min(max, 400);
  for (let i = 0; i < limit; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`-${a[i]}`);
    if (b[i] !== undefined) lines.push(`+${b[i]}`);
  }
  if (max > limit) lines.push(`… (${max - limit} líneas más omitidas en preview)`);
  return lines.join("\n");
}

class IdeReviewQueue {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot || ".");
    this.dir = path.join(this.projectRoot, ".editcore", "review-queue");
    this.file = path.join(this.dir, "queue.json");
    this.data = this._load();
  }

  _load() {
    const d = safeRead(this.file, null);
    if (d && d.version === QUEUE_VERSION) return d;
    return { version: QUEUE_VERSION, items: [], updatedAt: null };
  }

  _save() {
    this.data.updatedAt = new Date().toISOString();
    // no guardar contenidos enormes en listados: ya están en before/after truncados
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
  }

  /**
   * Registra un cambio tras write del agente.
   * @param {object} opts
   * @param {string} opts.path - relativa al proyecto
   * @param {string} [opts.before]
   * @param {string} opts.after
   * @param {string} [opts.backupPath]
   * @param {string} [opts.source] - agent | user
   */
  enqueue(opts = {}) {
    const rel = relPath(this.projectRoot, opts.path || "");
    if (!rel || rel.startsWith("..")) throw new Error("path inválido");

    const before = String(opts.before ?? "");
    const after = String(opts.after ?? "");
    const id = `chg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`;

    // Reemplazar pending previo del mismo path
    this.data.items = this.data.items.filter(
      (it) => !(it.path === rel && it.status === "pending")
    );

    const item = {
      id,
      path: rel,
      status: "pending", // pending | accepted | rejected
      source: opts.source || "agent",
      at: new Date().toISOString(),
      backupPath: opts.backupPath || null,
      before: before.length > 200_000 ? before.slice(0, 200_000) : before,
      after: after.length > 200_000 ? after.slice(0, 200_000) : after,
      diffPreview: simpleUnifiedDiff(rel, before, after).slice(0, 12_000),
      created: !before,
    };

    this.data.items.unshift(item);
    if (this.data.items.length > 100) {
      this.data.items = this.data.items.slice(0, 100);
    }
    this._save();
    return { ok: true, id, path: rel, status: "pending" };
  }

  list(status = "pending") {
    this.data = this._load();
    const items = this.data.items.filter((it) =>
      status === "all" ? true : it.status === status
    );
    return {
      ok: true,
      count: items.length,
      items: items.map((it) => ({
        id: it.id,
        path: it.path,
        status: it.status,
        at: it.at,
        created: it.created,
        source: it.source,
        diffPreview: it.diffPreview,
        hasBackup: Boolean(it.backupPath),
      })),
    };
  }

  get(id) {
    this.data = this._load();
    return this.data.items.find((it) => it.id === id) || null;
  }

  /**
   * Accept = dejar el archivo como está (after ya está en disco si el agent escribió).
   */
  accept(id) {
    const item = this.get(id);
    if (!item) return { ok: false, error: "cambio no encontrado" };
    if (item.status !== "pending") return { ok: true, path: item.path, status: item.status };

    item.status = "accepted";
    item.decidedAt = new Date().toISOString();
    this._save();
    return { ok: true, path: item.path, status: "accepted" };
  }

  /**
   * Reject = restaurar before (o borrar si era archivo nuevo).
   */
  reject(id) {
    const item = this.get(id);
    if (!item) return { ok: false, error: "cambio no encontrado" };
    if (item.status !== "pending") return { ok: true, path: item.path, status: item.status };

    const abs = path.join(this.projectRoot, item.path);
    try {
      if (item.created) {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.unlinkSync(abs);
      } else if (item.backupPath && fs.existsSync(item.backupPath)) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(item.backupPath, abs);
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, item.before || "", "utf8");
      }
    } catch (err) {
      return { ok: false, error: err.message, path: item.path };
    }

    item.status = "rejected";
    item.decidedAt = new Date().toISOString();
    this._save();
    return { ok: true, path: item.path, status: "rejected" };
  }

  acceptAll() {
    this.data = this._load();
    let n = 0;
    for (const it of this.data.items) {
      if (it.status === "pending") {
        it.status = "accepted";
        it.decidedAt = new Date().toISOString();
        n += 1;
      }
    }
    this._save();
    return { ok: true, accepted: n };
  }

  rejectAll() {
    this.data = this._load();
    const pending = this.data.items.filter((it) => it.status === "pending");
    let n = 0;
    const errors = [];
    for (const it of pending) {
      const r = this.reject(it.id);
      if (r.ok) n += 1;
      else errors.push(r.error);
    }
    return { ok: errors.length === 0, rejected: n, errors };
  }

  /**
   * Resumen para inyectar en el prompt del agente.
   */
  getPendingPrompt() {
    const { items } = this.list("pending");
    if (!items.length) return "";
    const lines = [
      "[CAMBIOS PENDIENTES DE REVISIÓN — estilo Cursor]",
      `Hay ${items.length} cambio(s) pending. El usuario puede accept/reject.`,
      ...items.slice(0, 15).map((it) => `• ${it.path} (${it.created ? "nuevo" : "editado"})`),
      "No reviertas estos archivos salvo que el usuario rechace o lo pida.",
    ];
    return lines.join("\n");
  }
}

const queues = new Map();

function getReviewQueue(projectRoot) {
  const key = path.resolve(projectRoot || ".");
  if (!queues.has(key)) queues.set(key, new IdeReviewQueue(key));
  return queues.get(key);
}

module.exports = {
  IdeReviewQueue,
  getReviewQueue,
  simpleUnifiedDiff,
  QUEUE_VERSION,
};
