"use strict";
/**
 * editcore-chat-kernel/agent-network.js
 * Red neuronal entre agentes: routing por embeddings + feedback de confianza.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getEmbedding, cosineSimilarity } = require("../runtime/embeddings");

// keywords: vocabulario en español con el que el usuario pide ese tipo de trabajo (el ruteo es por palabras).
const DEFAULT_AGENTS = {
  explorer: {
    skills: ["list_files", "search_files", "project-map", "explore", "glob"],
    confidence: 1.0,
    description: "Explora el proyecto, mapea estructura, encuentra archivos",
    keywords: "lista listar muestra carpeta carpetas estructura dónde donde busca buscar encuentra ubica archivos mapa contenido qué hay ver",
    label: "Explorador",
    focus: "Ubica primero los archivos exactos con list_files/search_files y el mapa del proyecto; no leas de más ni edites sin necesidad.",
  },
  analyst: {
    skills: ["read_file", "search_brain", "web_search", "analyze", "inspect"],
    confidence: 1.0,
    description: "Analiza código, investiga, lee documentación, detecta patrones",
    keywords: "analiza análisis revisa explica explícame explicame por qué porque causa investiga diagnostica falla entiende cómo funciona documentación compara",
    label: "Analista",
    focus: "Lee el código real y la documentación antes de opinar; ancla cada hallazgo a archivo:línea y separa hechos de hipótesis.",
  },
  implementer: {
    skills: ["write_file", "replace_in_file", "run_command", "implement", "edit"],
    confidence: 1.0,
    description: "Implementa cambios, escribe código, aplica ediciones",
    keywords: "crea agrega añade cambia corrige arregla soluciona error errores bug implementa escribe modifica construye haz hazme pon quita elimina mejora diseña página app botón conecta publica",
    label: "Implementador",
    focus: "Lee solo lo que vas a tocar, aplica cambios pequeños con replace_in_file/write_file y deja el proyecto funcionando.",
  },
  verifier: {
    skills: ["run_command", "read_file", "git_diff", "verify", "test"],
    confidence: 1.0,
    description: "Verifica cambios, ejecuta tests, valida resultados",
    keywords: "prueba pruebas test tests verifica valida comprueba compila build funciona revisa si quedó confirma corre ejecuta",
    label: "Verificador",
    focus: "Ejecuta pruebas o chequeos reales (tests, build, git_diff) y reporta resultados verificados, no supuestos.",
  },
};

const KEYWORD_WEIGHT = 0.25;

function tokenize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/).filter((w) => w.length > 2);
}

function defaultPersistPath() {
  const custom = String(process.env.EDITCORE_AGENT_NETWORK_PATH || "").trim();
  if (custom) return custom;
  return path.join(os.homedir(), ".editcoreai", "agent-network.json");
}

class AgentNetwork {
  constructor({ persistPath } = {}) {
    this.agents = JSON.parse(JSON.stringify(DEFAULT_AGENTS));
    this.vectors = null;
    this.edges = new Map();
    this.history = [];
    this.lastOutcomeAgent = null;
    this.persistPath = persistPath || defaultPersistPath();
    this._load();
  }

  _load() {
    try {
      // Antes se guardaba junto al directorio de arranque; se adopta ese historial una sola vez.
      const legacy = path.join(process.cwd(), ".editcore", "agent-network.json");
      const source = fs.existsSync(this.persistPath) ? this.persistPath : (fs.existsSync(legacy) ? legacy : "");
      if (!source) return;
      const raw = JSON.parse(fs.readFileSync(source, "utf8"));
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
      const text = `${id} ${agent.skills.join(" ")} ${agent.description} ${agent.keywords || ""}`;
      this.vectors[id] = await getEmbedding(text);
    }
    return this.vectors;
  }

  async route(task, { preferred = null } = {}) {
    if (preferred && this.agents[preferred]) return { agent: preferred, score: 1, reason: "preferred" };
    const vectors = await this._ensureVectors();
    const taskVec = await getEmbedding(task);
    const words = tokenize(task);
    let best = null, bestScore = -Infinity, bestHits = 0;
    for (const [id, vec] of Object.entries(vectors)) {
      const sim = cosineSimilarity(taskVec, vec);
      const vocab = new Set(tokenize(`${this.agents[id].keywords || ""} ${this.agents[id].skills.join(" ")}`));
      const hits = words.filter((w) => vocab.has(w)).length;
      const score = (sim + KEYWORD_WEIGHT * hits) * this.agents[id].confidence;
      if (score > bestScore) { bestScore = score; best = id; bestHits = hits; }
    }
    return { agent: best, score: bestScore, reason: bestHits ? "keywords+embedding" : "embedding" };
  }

  recordOutcome(agentId, success, { nextAgent = null } = {}) {
    const agent = this.agents[agentId];
    if (!agent) return;
    agent.confidence = Math.max(0.1, Math.min(1.0, agent.confidence + (success ? 0.05 : -0.1)));
    // Sin nextAgent explícito, el enlace es el traspaso desde el agente del turno anterior.
    const from = nextAgent ? agentId : this.lastOutcomeAgent;
    const to = nextAgent || agentId;
    if (from && this.agents[from] && this.agents[to]) {
      const key = `${from}->${to}`;
      const edge = this.edges.get(key) || { weight: 1, count: 0 };
      edge.count++;
      edge.weight = Math.max(0.1, edge.weight + (success ? 0.05 : -0.05));
      this.edges.set(key, edge);
    }
    this.lastOutcomeAgent = agentId;
    this.history.push({ ts: Date.now(), agentId, success, nextAgent });
    if (this.history.length > 500) this.history = this.history.slice(-500);
    this._save();
  }

  getConfidence(agentId) { return this.agents[agentId] ? this.agents[agentId].confidence : 0; }

  // Bloque para el prompt: el rol elegido cambia el enfoque del modelo y propone el siguiente traspaso aprendido.
  rolePrompt(agentId) {
    const agent = this.agents[agentId];
    if (!agent) return "";
    let next = null;
    for (const [key, edge] of this.edges) {
      const [from, to] = key.split("->");
      if (from === agentId && to !== agentId && (!next || edge.weight * edge.count > next.w)) next = { to, w: edge.weight * edge.count };
    }
    const lines = [
      `=== ROL ACTIVO (red de agentes de EditCoreAI): ${agent.label || agentId} — confianza ${agent.confidence.toFixed(2)} ===`,
      `Enfoque: ${agent.focus || agent.description}`,
      `Herramientas prioritarias: ${agent.skills.filter((s) => /_/.test(s)).join(", ")}.`,
    ];
    if (next && this.agents[next.to]) lines.push(`Al terminar esta parte, el paso que mejor funcionó después suele ser: ${this.agents[next.to].label || next.to}.`);
    lines.push("El rol orienta el enfoque; si la tarea pide otra cosa, haz lo que pide el usuario.");
    return lines.join("\n");
  }

  snapshot() {
    return { agents: this.agents, edges: Object.fromEntries(this.edges), history: this.history.slice(-20) };
  }
}

const globalNetwork = new AgentNetwork();

module.exports = { AgentNetwork, globalNetwork, DEFAULT_AGENTS };