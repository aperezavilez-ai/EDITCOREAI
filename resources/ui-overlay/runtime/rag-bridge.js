"use strict";

/**
 * RAG Bridge — Conecta el motor de indexación vectorial con los agentes de EditCoreAI.
 *
 * Fase 3 del Ciclo 13: Integración de RAG Contextual con los Agentes.
 * - Inyecta contexto semántico relevante en las consultas de los agentes.
 * - Funciona como middleware entre el usuario y el modelo de IA.
 * - Soporta filtros por archivo, tipo de chunk y umbral de relevancia.
 */

const { VectorIndexer } = require("./vector-indexer");

class RAGBridge {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.topK = options.topK || 5;
    this.minScore = options.minScore || 0.3;
    this.maxContextTokens = options.maxContextTokens || 4000;
    this.indexer = new VectorIndexer({
      projectRoot: this.projectRoot,
      storePath: options.storePath,
      model: options.model,
    });
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return { ok: true };
    const result = await this.indexer.init();
    if (!result.ok) return result;
    this._initialized = true;
    return { ok: true, model: result.model };
  }

  async ensureIndexed(options = {}) {
    if (!this._initialized) {
      const init = await this.init();
      if (!init.ok) return init;
    }

    const stats = this.indexer.getStats();
    if (stats.totalChunks === 0 || options.force) {
      return this.indexer.indexWorkspace({ progress: options.progress });
    }
    return { ok: true, alreadyIndexed: true, stats };
  }

  /**
   * Enriquece un prompt con contexto semántico del codebase.
   * Retorna el prompt original + bloques de código relevantes.
   */
  async enrichPrompt(prompt, options = {}) {
    if (!this._initialized) {
      const init = await this.init();
      if (!init.ok) return { prompt, error: init.error };
    }

    const searchResult = await this.indexer.search(prompt, {
      topK: options.topK || this.topK,
      filter: options.filter || {},
    });

    if (!searchResult.ok || searchResult.results.length === 0) {
      return { prompt, context: [], stats: { injected: 0, tokens: 0 } };
    }

    // Filter by minimum score
    const relevant = searchResult.results.filter((r) => r.score >= this.minScore);

    // Build context blocks within token budget
    const contextBlocks = [];
    let tokenBudget = this.maxContextTokens;

    for (const result of relevant) {
      if (tokenBudget <= 0) break;
      const block = this._formatContextBlock(result);
      const blockTokens = result.tokens || Math.ceil(block.length / 4);
      if (blockTokens <= tokenBudget) {
        contextBlocks.push(block);
        tokenBudget -= blockTokens;
      }
    }

    if (contextBlocks.length === 0) {
      return { prompt, context: [], stats: { injected: 0, tokens: 0 } };
    }

    const contextSection = [
      "## Contexto relevante del codebase (RAG)",
      "",
      ...contextBlocks,
      "---",
      "",
    ].join("\n");

    const enrichedPrompt = `${contextSection}${prompt}`;
    const totalTokens = this.maxContextTokens - tokenBudget;

    return {
      prompt: enrichedPrompt,
      originalPrompt: prompt,
      context: relevant.slice(0, contextBlocks.length),
      stats: {
        injected: contextBlocks.length,
        tokens: totalTokens,
        originalTokens: Math.ceil(prompt.length / 4),
      },
    };
  }

  _formatContextBlock(result) {
    const lines = result.content.split("\n").slice(0, 30); // Max 30 lines per block
    const truncated = lines.length < result.content.split("\n").length
      ? lines.join("\n") + "\n// ... (truncated)"
      : lines.join("\n");

    return [
      `### 📄 ${result.file} (${result.type}: ${result.name})`,
      `Líneas ${result.startLine}-${result.endLine} · Relevancia: ${(result.score * 100).toFixed(1)}%`,
      "",
      "```" + (this._getLang(result.file)) + "",
      truncated,
      "```",
      "",
    ].join("\n");
  }

  _getLang(filePath) {
    const ext = filePath.split(".").pop().toLowerCase();
    const map = {
      js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
      py: "python", rb: "ruby", java: "java", go: "go", rs: "rust",
      html: "html", css: "css", json: "json", yaml: "yaml", yml: "yaml",
      sql: "sql", md: "markdown", sh: "bash",
    };
    return map[ext] || "";
  }

  /**
   * Búsqueda semántica pura (sin enriquecimiento de prompt).
   * Útil para herramientas de exploración del codebase.
   */
  async search(query, options = {}) {
    if (!this._initialized) {
      const init = await this.init();
      if (!init.ok) return init;
    }
    return this.indexer.search(query, {
      topK: options.topK || this.topK,
      filter: options.filter || {},
    });
  }

  getStats() {
    return this.indexer.getStats();
  }

  async reindex(options = {}) {
    return this.indexer.reindex(options);
  }
}

module.exports = { RAGBridge };
