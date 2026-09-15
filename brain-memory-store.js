"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function searchExpression(query) {
  const words = [...new Set(String(query || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_.-]+/)
    .filter((word) => word.length > 2))]
    .slice(0, 16);
  return words.map((word) => `"${word.replace(/"/g, '""')}"*`).join(" OR ");
}

class BrainMemoryStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        recall_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        UNIQUE(scope, project_id, content_hash)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED, title, content, tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        line INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        project_id UNINDEXED, id UNINDEXED, path, text, tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        evidence TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chunks_project_path ON knowledge_chunks(project_id, path);
      CREATE INDEX IF NOT EXISTS idx_relations_project_from ON relations(project_id, from_id);
    `);
  }

  upsertMemory(input = {}) {
    const now = input.updatedAt || new Date().toISOString();
    const scope = input.scope === "global" ? "global" : "project";
    const projectId = scope === "global" ? "" : String(input.projectId || "");
    const title = String(input.title || "Memoria EDITCOREAI").slice(0, 300);
    const content = String(input.content || "").slice(0, 24_000);
    const contentHash = hash(`${input.type || "memory"}\n${title}\n${content}`);
    const existing = this.db.prepare("SELECT id, created_at, recall_count FROM memories WHERE scope = ? AND project_id = ? AND content_hash = ?").get(scope, projectId, contentHash);
    const id = existing?.id || String(input.id || `memory-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
    const createdAt = existing?.created_at || input.createdAt || now;
    this.db.prepare(`INSERT INTO memories (id, scope, project_id, type, title, content, source, content_hash, importance, recall_count, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title, content=excluded.content, source=excluded.source,
        content_hash=excluded.content_hash, importance=MAX(memories.importance, excluded.importance), updated_at=excluded.updated_at, expires_at=excluded.expires_at`)
      .run(id, scope, projectId, String(input.type || "memory"), title, content, String(input.source || "editcore"), contentHash,
        Math.max(0, Math.min(1, Number(input.importance) || 0.5)), Number(existing?.recall_count || 0), createdAt, now, String(input.expiresAt || ""));
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
    this.db.prepare("INSERT INTO memories_fts (id, title, content) VALUES (?, ?, ?)").run(id, title, content);
    return { id, scope, projectId, type: String(input.type || "memory"), title, content, source: String(input.source || "editcore"), timestamp: now, deduplicated: Boolean(existing) };
  }

  removeMemory(id) {
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(String(id || ""));
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(String(id || ""));
    return Number(result.changes || 0) > 0;
  }

  searchMemories(projectId, query, limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const expression = searchExpression(query);
    const rows = expression
      ? this.db.prepare(`SELECT m.*, bm25(memories_fts, 2.0, 1.0) AS rank
          FROM memories_fts JOIN memories m ON m.id = memories_fts.id
          WHERE memories_fts MATCH ? AND (m.scope = 'global' OR m.project_id = ?)
            AND (m.expires_at = '' OR m.expires_at > ?)
          ORDER BY rank ASC, m.importance DESC, m.updated_at DESC LIMIT ?`).all(expression, String(projectId || ""), new Date().toISOString(), safeLimit)
      : this.db.prepare(`SELECT m.*, 0 AS rank FROM memories m
          WHERE (m.scope = 'global' OR m.project_id = ?) AND (m.expires_at = '' OR m.expires_at > ?)
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`).all(String(projectId || ""), new Date().toISOString(), safeLimit);
    const updateRecall = this.db.prepare("UPDATE memories SET recall_count = recall_count + 1 WHERE id = ?");
    for (const row of rows) updateRecall.run(row.id);
    return rows.map((row) => ({
      id: row.id, type: row.type, title: row.title, content: row.content, source: row.source,
      timestamp: row.updated_at, importance: row.importance, recallCount: row.recall_count + 1,
      score: expression ? Math.max(1, Math.round(100 / (1 + Math.abs(Number(row.rank) || 0)))) : 1,
    }));
  }

  replaceKnowledge(projectId, chunks = [], relations = []) {
    const pid = String(projectId || "");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ?").run(pid);
      this.db.prepare("DELETE FROM knowledge_fts WHERE project_id = ?").run(pid);
      this.db.prepare("DELETE FROM relations WHERE project_id = ?").run(pid);
      const insertChunk = this.db.prepare("INSERT INTO knowledge_chunks (id, project_id, path, line, text, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertFts = this.db.prepare("INSERT INTO knowledge_fts (project_id, id, path, text) VALUES (?, ?, ?, ?)");
      for (const chunk of chunks) {
        insertChunk.run(String(chunk.id), pid, String(chunk.path), Number(chunk.line) || 1, String(chunk.text), hash(chunk.text), now);
        insertFts.run(pid, String(chunk.id), String(chunk.path), String(chunk.text));
      }
      const insertRelation = this.db.prepare("INSERT OR REPLACE INTO relations (id, project_id, from_id, to_id, relation_type, weight, evidence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const relation of relations) {
        const id = relation.id || hash(`${pid}:${relation.fromId}:${relation.toId}:${relation.type}`).slice(0, 32);
        insertRelation.run(id, pid, String(relation.fromId), String(relation.toId), String(relation.type || "references"), Number(relation.weight) || 1, String(relation.evidence || "").slice(0, 1000), now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { chunks: chunks.length, relations: relations.length };
  }

  searchKnowledge(projectId, query, limit = 12) {
    const expression = searchExpression(query);
    if (!expression) return [];
    return this.db.prepare(`SELECT k.id, k.path, k.line, k.text, bm25(knowledge_fts, 2.0, 1.0) AS rank
      FROM knowledge_fts JOIN knowledge_chunks k ON k.project_id = knowledge_fts.project_id AND k.id = knowledge_fts.id
      WHERE knowledge_fts MATCH ? AND k.project_id = ? ORDER BY rank ASC LIMIT ?`)
      .all(expression, String(projectId || ""), Math.max(1, Math.min(50, Number(limit) || 12)))
      .map((row) => ({ id: row.id, path: row.path, line: row.line, text: row.text, source: "sqlite_fts", score: Math.max(1, Math.round(100 / (1 + Math.abs(Number(row.rank) || 0)))) }));
  }

  /** Incremental upsert for web/RAG snippets without wiping the project index. */
  upsertKnowledgeChunk(projectId, chunk = {}) {
    const pid = String(projectId || "");
    const text = String(chunk.text || "").slice(0, 12_000);
    if (!pid || !text.trim()) return null;
    const now = new Date().toISOString();
    const pathName = String(chunk.path || `external/${Date.now()}.md`).slice(0, 500);
    const line = Math.max(1, Number(chunk.line) || 1);
    const contentHash = hash(text);
    const id = String(chunk.id || `chunk-${contentHash.slice(0, 24)}`);
    this.db.prepare(`INSERT INTO knowledge_chunks (id, project_id, path, line, text, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, id) DO UPDATE SET path=excluded.path, line=excluded.line, text=excluded.text,
        content_hash=excluded.content_hash, updated_at=excluded.updated_at`)
      .run(id, pid, pathName, line, text, contentHash, now);
    this.db.prepare("DELETE FROM knowledge_fts WHERE project_id = ? AND id = ?").run(pid, id);
    this.db.prepare("INSERT INTO knowledge_fts (project_id, id, path, text) VALUES (?, ?, ?, ?)").run(pid, id, pathName, text);
    return { id, projectId: pid, path: pathName, line, text, updatedAt: now };
  }

  related(projectId, nodeId, limit = 20) {
    return this.db.prepare("SELECT from_id AS fromId, to_id AS toId, relation_type AS type, weight, evidence FROM relations WHERE project_id = ? AND (from_id = ? OR to_id = ?) ORDER BY weight DESC LIMIT ?")
      .all(String(projectId || ""), String(nodeId || ""), String(nodeId || ""), Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  consolidate(projectId = "", maxProjectMemories = 10_000) {
    const pid = String(projectId || "");
    const expired = this.db.prepare("SELECT id FROM memories WHERE expires_at <> '' AND expires_at <= ?").all(new Date().toISOString());
    for (const row of expired) this.removeMemory(row.id);
    const excess = this.db.prepare(`SELECT id FROM memories WHERE project_id = ? ORDER BY importance DESC, recall_count DESC, updated_at DESC LIMIT -1 OFFSET ?`)
      .all(pid, Math.max(100, Number(maxProjectMemories) || 10_000));
    for (const row of excess) this.removeMemory(row.id);
    this.db.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize'); INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize');");
    return { expiredRemoved: expired.length, excessRemoved: excess.length };
  }

  stats(projectId = "") {
    const memory = this.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(recall_count), 0) AS recalls FROM memories WHERE scope = 'global' OR project_id = ?").get(String(projectId || ""));
    const knowledge = this.db.prepare("SELECT COUNT(*) AS count FROM knowledge_chunks WHERE project_id = ?").get(String(projectId || ""));
    const relations = this.db.prepare("SELECT COUNT(*) AS count FROM relations WHERE project_id = ?").get(String(projectId || ""));
    return { backend: "sqlite-fts5", memories: Number(memory.count), recalls: Number(memory.recalls), knowledgeChunks: Number(knowledge.count), relations: Number(relations.count), databasePath: this.databasePath };
  }

  close() {
    this.db.close();
  }
}

module.exports = { BrainMemoryStore, searchExpression };
