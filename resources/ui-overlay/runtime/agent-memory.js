"use strict";

/**
 * AGENT MEMORY - Memoria persistente entre sesiones
 * Guarda contexto en .editcore/agent-memory/
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class AgentMemory {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.memoryDir = path.join(projectRoot, ".editcore", "agent-memory");
    this.contextFile = path.join(this.memoryDir, "context.json");
    this.maxConversations = options.maxConversations || 10;
    this.maxFiles = options.maxFiles || 50;
    this.maxDecisions = options.maxDecisions || 20;

    this.context = {
      conversations: [],
      files: [],
      decisions: [],
      lastAccess: Date.now(),
    };
  }

  /**
   * Carga la memoria desde disco
   */
  async load() {
    try {
      if (fs.existsSync(this.contextFile)) {
        const data = await fs.promises.readFile(this.contextFile, "utf8");
        this.context = JSON.parse(data);
        this.context.lastAccess = Date.now();
        return this.context;
      }
    } catch (error) {
      console.warn(`⚠️ [Memory] No se pudo cargar memoria: ${error.message}`);
    }

    return this.context;
  }

  /**
   * Guarda la memoria en disco
   */
  async save() {
    try {
      await fs.promises.mkdir(this.memoryDir, { recursive: true });
      await fs.promises.writeFile(
        this.contextFile,
        JSON.stringify(this.context, null, 2),
        "utf8"
      );
      return true;
    } catch (error) {
      console.error(`❌ [Memory] Error al guardar: ${error.message}`);
      return false;
    }
  }

  /**
   * Agrega resumen de conversación
   */
  addConversation(summary, metadata = {}) {
    const entry = {
      id: this._generateId(),
      summary,
      timestamp: Date.now(),
      tokensUsed: metadata.tokensUsed || 0,
      stepsExecuted: metadata.stepsExecuted || 0,
      completed: metadata.completed || false,
    };

    this.context.conversations.push(entry);

    // Mantener solo las últimas N conversaciones
    if (this.context.conversations.length > this.maxConversations) {
      this.context.conversations.shift();
    }
  }

  /**
   * Registra archivo leído/modificado
   */
  addFile(filePath, action = "read", metadata = {}) {
    const entry = {
      path: filePath,
      action, // read, write, delete
      timestamp: Date.now(),
      size: metadata.size || 0,
      summary: metadata.summary || "",
    };

    // Buscar si el archivo ya existe
    const existingIndex = this.context.files.findIndex(f => f.path === filePath);

    if (existingIndex >= 0) {
      // Actualizar entrada existente
      this.context.files[existingIndex] = entry;
    } else {
      // Agregar nueva entrada
      this.context.files.push(entry);

      // Mantener solo los últimos N archivos
      if (this.context.files.length > this.maxFiles) {
        this.context.files.shift();
      }
    }
  }

  /**
   * Registra decisión importante
   */
  addDecision(decision, reasoning = "", metadata = {}) {
    const entry = {
      id: this._generateId(),
      decision,
      reasoning,
      timestamp: Date.now(),
      tags: metadata.tags || [],
    };

    this.context.decisions.push(entry);

    // Mantener solo las últimas N decisiones
    if (this.context.decisions.length > this.maxDecisions) {
      this.context.decisions.shift();
    }
  }

  /**
   * Obtiene conversaciones recientes
   */
  getRecentConversations(limit = 5) {
    return this.context.conversations.slice(-limit);
  }

  /**
   * Obtiene archivos recientes
   */
  getRecentFiles(limit = 10) {
    return this.context.files.slice(-limit);
  }

  /**
   * Obtiene decisiones recientes
   */
  getRecentDecisions(limit = 5) {
    return this.context.decisions.slice(-limit);
  }

  /**
   * Busca en memoria por palabra clave
   */
  search(query) {
    const results = {
      conversations: [],
      files: [],
      decisions: [],
    };

    const queryLower = query.toLowerCase();

    // Buscar en conversaciones
    for (const conv of this.context.conversations) {
      if (conv.summary.toLowerCase().includes(queryLower)) {
        results.conversations.push(conv);
      }
    }

    // Buscar en archivos
    for (const file of this.context.files) {
      if (file.path.toLowerCase().includes(queryLower) ||
          (file.summary && file.summary.toLowerCase().includes(queryLower))) {
        results.files.push(file);
      }
    }

    // Buscar en decisiones
    for (const dec of this.context.decisions) {
      if (dec.decision.toLowerCase().includes(queryLower) ||
          dec.reasoning.toLowerCase().includes(queryLower)) {
        results.decisions.push(dec);
      }
    }

    return results;
  }

  /**
   * Genera resumen de la memoria actual
   */
  getSummary() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSinceAccess = Math.round((now - this.context.lastAccess) / dayMs);

    return {
      conversations: this.context.conversations.length,
      files: this.context.files.length,
      decisions: this.context.decisions.length,
      lastAccess: this.context.lastAccess,
      daysSinceAccess,
      exists: fs.existsSync(this.contextFile),
    };
  }

  /**
   * Construye contexto para el agente
   */
  buildContextForAgent() {
    const recent = {
      conversations: this.getRecentConversations(8),
      files: this.getRecentFiles(12),
      decisions: this.getRecentDecisions(6),
    };

    let context = "";

    // Conversaciones recientes
    if (recent.conversations.length > 0) {
      context += "📝 CONVERSACIONES RECIENTES:\n";
      for (const conv of recent.conversations) {
        const date = new Date(conv.timestamp).toLocaleDateString();
        context += `- [${date}] ${conv.summary}\n`;
      }
      context += "\n";
    }

    // Archivos recientes
    if (recent.files.length > 0) {
      context += "📂 ARCHIVOS RECIENTES:\n";
      for (const file of recent.files) {
        context += `- ${file.action}: ${file.path}\n`;
      }
      context += "\n";
    }

    // Decisiones recientes
    if (recent.decisions.length > 0) {
      context += "🎯 DECISIONES RECIENTES:\n";
      for (const dec of recent.decisions) {
        context += `- ${dec.decision}\n  Razón: ${dec.reasoning}\n`;
      }
      context += "\n";
    }

    return context;
  }

  /**
   * Limpia memoria antigua
   */
  cleanup(daysOld = 30) {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

    this.context.conversations = this.context.conversations.filter(
      c => c.timestamp > cutoff
    );
    this.context.files = this.context.files.filter(
      f => f.timestamp > cutoff
    );
    this.context.decisions = this.context.decisions.filter(
      d => d.timestamp > cutoff
    );
  }

  /**
   * Genera ID único
   */
  _generateId() {
    return crypto.randomBytes(8).toString("hex");
  }
}

module.exports = { AgentMemory };
