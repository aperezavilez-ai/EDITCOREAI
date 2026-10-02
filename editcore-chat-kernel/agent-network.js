"use strict";
/**
 * editcore-chat-kernel/agent-network.js
 * Red neuronal entre agentes: routing por embeddings + feedback de confianza.
 */

const fs = require("fs");
const path = require("path");
const { getEmbedding, cosineSimilarity } = require("../runtime/embeddings");

const DEFAULT_AGENTS = {
  explorer: {
    skills: ["list_files", "search_files", "project-map", "explore", "glob"],
    confidence: 1.0,
    description: "Explora el proyecto, mapea estructura, encuentra archivos",
  },
  analyst: {
    skills: ["read_file", "search_brain", "web_search", "analyze", "inspect"],
    confidence: 1.0,
    description: "Analiza código, investiga, lee documentación, detecta patrones",
  },
  implementer: {
    skills: ["write_file", "replace_in_file", "run_command", "implement", "edit"],
    confidence: 1.0,
    description: "Implementa cambios, escribe código, aplica ediciones",
  },
  verifier: {
    skills: ["run_command", "read_file", "git_diff", "verify", "test"],
    confidence: 1.0,
    description: "Verifica cambios, ejecuta tests, valida resultados",
  },
};

class AgentNetwork {
  constructor({ persistPath } = {}) {
    this.agents = JSON.parse(JSON.stringify(DEFAULT_AGENTS));
    this.vectors = null;
    this.edges = new Map();
    this.history = [];
    this.persistPath = persistPath || path.join(process.cwd(), ".editcore", "agent-network.json");
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.persistPath, "utf8"));
      if (raw && raw.agents) {
        for (const [id, data] of Object.entries(raw.agents)) {
          if (this.agents[id]) this.agents[id].confidence = data.confidence ?? this.agents[id].confidence;
        }
      }
      if (raw && raw.edges) for (const [k, v] of Object.entries(raw.edges)) this.edges.set(k, v);
      if (raw && Array.isArray(raw.history)) this.history = raw.history.slice(-500);
    } catch (_) {}
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify({ agents: this.agents, edges: Object.fromEntries(this.edges), history: this.history.slice(-200), updatedAt: Date.now() }, null, 2),
        "utf8"
      );
    } catch (_) {}
  }

  async _ensureVectors() {
    if (this.vectors) return this.vectors;
    this.vectors = {};
    for (const [id, agent] of Object.entries(this.agents)) {
      const text = `${id} ${agent.skills.join(" ")} ${agent.description}`;
      this.vectors[id] = await getEmbedding(text);
    }
    return this.vectors;
  }

  async route(task, { preferred = null } = {}) {
    if (preferred && this.agents[preferred]) return { agent: preferred, score: 1, reason: "preferred" };
    const vectors = await this._ensureVectors();
    const taskVec = await getEmbedding(task);
    let best = null, bestScore = -Infinity;
    for (const [id, vec] of Object.entries(vectors)) {
      const sim = cosineSimilarity(taskVec, vec);
      const score = sim * this.agents[id].confidence;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return { agent: best, score: bestScore, reason: "embedding" };
  }

  recordOutcome(agentId, success, { nextAgent = null } = {}) {
    const agent = this.agents[agentId];
    if (!agent) return;
    agent.confidence = Math.max(0.1, Math.min(1.0, agent.confidence + (success ? 0.05 : -0.1)));
    if (nextAgent) {
      const key = `${agentId}->${nextAgent}`;
      const edge = this.edges.get(key) || { weight: 1, count: 0 };
      edge.count++;
      edge.weight = Math.max(0.1, edge.weight + (success ? 0.05 : -0.05));
      this.edges.set(key, edge);
    }
    this.history.push({ ts: Date.now(), agentId, success, nextAgent });
    if (this.history.length > 500) this.history = this.history.slice(-500);
    this._save();
  }

  getConfidence(agentId) { return this.agents[agentId] ? this.agents[agentId].confidence : 0; }

  snapshot() {
    return { agents: this.agents, edges: Object.fromEntries(this.edges), history: this.history.slice(-20) };
  }
}

const globalNetwork = new AgentNetwork();

module.exports = { AgentNetwork, globalNetwork, DEFAULT_AGENTS };