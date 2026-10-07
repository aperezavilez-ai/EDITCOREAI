"use strict";

/**
 * AGENT COORDINATION — Fase 7
 * Evita que agentes se pisen la cola:
 *  - Lock por archivo (write/replace)
 *  - Registro de actividad en bus compartido
 *  - Un solo "active agent" por thread
 *  - Cola simple de espera de locks
 *
 * Persistencia: .editcore/coordination/
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COORD_VERSION = 1;
const DEFAULT_LOCK_TTL_MS = 120_000; // 2 min
const DEFAULT_STALE_MS = 180_000;

function now() {
  return Date.now();
}

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

function normalizeRel(projectRoot, relOrAbs) {
  const root = path.resolve(projectRoot);
  let abs = path.isAbsolute(relOrAbs)
    ? path.normalize(relOrAbs)
    : path.normalize(path.join(root, String(relOrAbs || "")));
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (rel.startsWith("..")) throw new Error(`Path fuera del proyecto: ${relOrAbs}`);
  return rel || ".";
}

class AgentCoordination {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot || ".");
    this.dir = path.join(this.projectRoot, ".editcore", "coordination");
    this.stateFile = path.join(this.dir, "state.json");
    this.lockTtlMs = options.lockTtlMs || DEFAULT_LOCK_TTL_MS;
    this.state = this._load();
  }

  _load() {
    const data = safeRead(this.stateFile, null);
    if (data && data.version === COORD_VERSION) {
      this._purgeStale(data);
      return data;
    }
    return {
      version: COORD_VERSION,
      threads: {}, // threadId -> { activeAgent, updatedAt, activity[] }
      locks: {}, // relPath -> { owner, threadId, at, expiresAt, op }
      updatedAt: new Date().toISOString(),
    };
  }

  _purgeStale(data) {
    const t = now();
    for (const [file, lock] of Object.entries(data.locks || {})) {
      if (!lock.expiresAt || lock.expiresAt < t) delete data.locks[file];
    }
    for (const [tid, th] of Object.entries(data.threads || {})) {
      if (th.updatedAt && t - new Date(th.updatedAt).getTime() > DEFAULT_STALE_MS * 5) {
        // keep thread meta but trim activity
        if (Array.isArray(th.activity) && th.activity.length > 40) {
          th.activity = th.activity.slice(-40);
        }
      }
    }
  }

  _save() {
    this.state.updatedAt = new Date().toISOString();
    atomicWrite(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  /**
   * Declara el agente activo del thread (solo uno "en foco").
   */
  setActiveAgent(threadId, agentRole, meta = {}) {
    const id = String(threadId || "default");
    if (!this.state.threads[id]) {
      this.state.threads[id] = { activeAgent: null, activity: [], updatedAt: null };
    }
    const prev = this.state.threads[id].activeAgent;
    this.state.threads[id].activeAgent = String(agentRole || "supervisor");
    this.state.threads[id].updatedAt = new Date().toISOString();
    this.state.threads[id].lastMeta = {
      task: String(meta.task || "").slice(0, 300),
      phase: meta.phase || null,
    };
    this._pushActivity(id, {
      type: "active_agent",
      agent: agentRole,
      prev,
      note: meta.note || "",
    });
    this._save();
    return { ok: true, threadId: id, activeAgent: this.state.threads[id].activeAgent, previous: prev };
  }

  getActiveAgent(threadId) {
    const id = String(threadId || "default");
    return this.state.threads[id]?.activeAgent || null;
  }

  /**
   * Registra actividad visible para otros agentes.
   */
  recordActivity(threadId, entry = {}) {
    const id = String(threadId || "default");
    this._pushActivity(id, entry);
    this._save();
    return { ok: true };
  }

  _pushActivity(threadId, entry) {
    if (!this.state.threads[threadId]) {
      this.state.threads[threadId] = { activeAgent: null, activity: [], updatedAt: null };
    }
    const row = {
      at: new Date().toISOString(),
      type: entry.type || "info",
      agent: entry.agent || this.state.threads[threadId].activeAgent || "unknown",
      path: entry.path || null,
      op: entry.op || null,
      note: String(entry.note || entry.text || "").slice(0, 400),
      prev: entry.prev || null,
    };
    this.state.threads[threadId].activity.push(row);
    if (this.state.threads[threadId].activity.length > 80) {
      this.state.threads[threadId].activity = this.state.threads[threadId].activity.slice(-80);
    }
    this.state.threads[threadId].updatedAt = row.at;
  }

  /**
   * Intenta adquirir lock de archivo para escritura.
   * @returns {{ ok: boolean, error?: string, lock?: object }}
   */
  acquireLock(threadId, agentRole, relPath, op = "write") {
    const rel = normalizeRel(this.projectRoot, relPath);
    const t = now();
    this._purgeStale(this.state);

    const existing = this.state.locks[rel];
    if (existing && existing.expiresAt > t) {
      // mismo dueño puede refrescar
      if (existing.owner === agentRole && existing.threadId === String(threadId || "default")) {
        existing.expiresAt = t + this.lockTtlMs;
        existing.op = op;
        existing.at = new Date().toISOString();
        this._save();
        return { ok: true, lock: existing, refreshed: true };
      }
      return {
        ok: false,
        error: `Archivo bloqueado por agente "${existing.owner}" (thread ${existing.threadId}) hasta ${new Date(existing.expiresAt).toISOString()}. Op: ${existing.op}. No pises su trabajo.`,
        lock: existing,
      };
    }

    const lock = {
      owner: String(agentRole || "implementer"),
      threadId: String(threadId || "default"),
      path: rel,
      op,
      at: new Date().toISOString(),
      expiresAt: t + this.lockTtlMs,
    };
    this.state.locks[rel] = lock;
    this._pushActivity(lock.threadId, {
      type: "lock_acquire",
      agent: lock.owner,
      path: rel,
      op,
    });
    this._save();
    return { ok: true, lock };
  }

  releaseLock(threadId, agentRole, relPath) {
    const rel = normalizeRel(this.projectRoot, relPath);
    const existing = this.state.locks[rel];
    if (!existing) return { ok: true, released: false };
    if (existing.owner !== agentRole && existing.threadId !== String(threadId || "default")) {
      return { ok: false, error: "No eres el dueño del lock" };
    }
    delete this.state.locks[rel];
    this._pushActivity(String(threadId || "default"), {
      type: "lock_release",
      agent: agentRole,
      path: rel,
    });
    this._save();
    return { ok: true, released: true };
  }

  releaseAllForThread(threadId) {
    const id = String(threadId || "default");
    let n = 0;
    for (const [rel, lock] of Object.entries(this.state.locks)) {
      if (lock.threadId === id) {
        delete this.state.locks[rel];
        n += 1;
      }
    }
    if (n) this._save();
    return { ok: true, released: n };
  }

  /**
   * Contexto para inyectar en el prompt: qué hace quién y locks activos.
   */
  getCoordinationPrompt(threadId) {
    this.state = this._load();
    const id = String(threadId || "default");
    const th = this.state.threads[id] || { activeAgent: null, activity: [] };
    const locks = Object.values(this.state.locks || {});
    const lines = [
      "[COORDINACIÓN MULTIAGENTE]",
      `Agente activo del thread: ${th.activeAgent || "(ninguno)"}`,
      `Locks de archivo activos: ${locks.length}`,
    ];
    for (const l of locks.slice(0, 12)) {
      lines.push(`  • ${l.path} → ${l.owner} (${l.op})`);
    }
    const recent = (th.activity || []).slice(-8);
    if (recent.length) {
      lines.push("Actividad reciente:");
      for (const a of recent) {
        lines.push(`  • [${a.agent}] ${a.type}${a.path ? " " + a.path : ""}${a.note ? " — " + a.note : ""}`);
      }
    }
    lines.push("REGLA: No escribas un archivo listado en locks de otro agente. Espera o elige otro path.");
    lines.push("REGLA: Un solo agente en foco; usa handoff formal antes de cambiar de rol de escritura.");
    return lines.join("\n");
  }

  snapshot() {
    this.state = this._load();
    return {
      version: COORD_VERSION,
      locks: Object.keys(this.state.locks || {}).length,
      threads: Object.keys(this.state.threads || {}).length,
      updatedAt: this.state.updatedAt,
    };
  }
}

const instances = new Map();

function getCoordination(projectRoot, options) {
  const key = path.resolve(projectRoot || ".");
  if (!instances.has(key)) {
    instances.set(key, new AgentCoordination(key, options));
  }
  return instances.get(key);
}

module.exports = {
  AgentCoordination,
  getCoordination,
  COORD_VERSION,
};
