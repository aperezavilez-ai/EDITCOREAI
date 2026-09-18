/**
 * EditCoreAI - Ghost Completion Engine (Cycle 29)
 * High-performance predictive inline completion (ghost text) provider
 * tailored for Monaco Editor.
 */

class GhostCompletionEngine {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxCacheEntries = options.maxCacheEntries || 200;
    this.defaultTtlMs = options.defaultTtlMs || 60000;
    this.enabled = options.enabled !== false;
    this.stats = { requests: 0, hits: 0, heuristics: 0, llm: 0 };
    this.llmProvider = options.llmProvider || null;
  }

  configure(options = {}) {
    if (typeof options.enabled === "boolean") this.enabled = options.enabled;
    if (typeof options.maxCacheEntries === "number") this.maxCacheEntries = options.maxCacheEntries;
    if (typeof options.defaultTtlMs === "number") this.defaultTtlMs = options.defaultTtlMs;
    if (typeof options.llmProvider === "function") this.llmProvider = options.llmProvider;
  }

  cacheCompletion(prefix, completion, ttlMs = this.defaultTtlMs) {
    if (!prefix || !completion) return;
    if (this.cache.size >= this.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(prefix, {
      completion,
      expiresAt: Date.now() + ttlMs,
    });
  }

  getCached(prefix) {
    if (!this.cache.has(prefix)) return null;
    const item = this.cache.get(prefix);
    if (Date.now() > item.expiresAt) {
      this.cache.delete(prefix);
      return null;
    }
    return item.completion;
  }

  clearCache() {
    this.cache.clear();
  }

  getStats() {
    return { ...this.stats, cacheSize: this.cache.size, enabled: this.enabled };
  }

  predictHeuristicCompletion(documentContext = "", position = {}) {
    const lines = String(documentContext || "").split("\n");
    const currentLineIdx = typeof position.lineNumber === "number" ? position.lineNumber - 1 : lines.length - 1;
    const currentLine = lines[currentLineIdx] || "";
    const trimmed = currentLine.trim();

    if (!trimmed) return null;

    // Pattern 1: Arrow function declaration
    if (/^(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*\(([^)]*)\)\s*=>\s*\{?$/.test(trimmed)) {
      if (!trimmed.endsWith("{")) return " {\n  \n}";
      return "\n  return null;\n};";
    }

    // Pattern 2: Common try/catch closure
    if (trimmed === "try {") {
      return "\n  \n} catch (error) {\n  console.error(error);\n}";
    }

    // Pattern 3: If statement closure
    if (/^if\s*\([^)]+\)\s*\{?$/.test(trimmed)) {
      if (!trimmed.endsWith("{")) return " {\n  \n}";
      return "\n  \n}";
    }

    // Pattern 4: Async function definition
    if (/^async\s+function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{?$/.test(trimmed)) {
      if (!trimmed.endsWith("{")) return " {\n  try {\n    \n  } catch (error) {\n    \n  }\n}";
      return "\n  try {\n    \n  } catch (error) {\n    \n  }\n}";
    }

    // Pattern 5: React useState pattern
    if (/^const\s+\[([a-zA-Z0-9_$]+),\s*set[A-Z][a-zA-Z0-9_$]*\]\s*=\s*use$/.test(trimmed)) {
      return "State(null);";
    }

    // Pattern 6: Export default
    if (trimmed === "export default") {
      return " function () {\n  \n};";
    }

    return null;
  }

  async provideInlineCompletion(documentContext = "", position = {}, options = {}) {
    this.stats.requests += 1;
    if (!this.enabled) return null;

    const currentLine = typeof documentContext === "string" ? documentContext.slice(-200) : "";
    
    // 1. Cache lookup
    const cached = this.getCached(currentLine);
    if (cached) {
      this.stats.hits += 1;
      return {
        insertText: cached,
        source: "cache",
      };
    }

    // 2. Heuristic prediction
    const heuristic = this.predictHeuristicCompletion(documentContext, position);
    if (heuristic) {
      this.stats.heuristics += 1;
      this.cacheCompletion(currentLine, heuristic);
      return {
        insertText: heuristic,
        source: "heuristic",
      };
    }

    // 3. Fast LLM provider fallback
    if (typeof this.llmProvider === "function" && options.useLlm) {
      try {
        const llmResult = await this.llmProvider(documentContext, position, options);
        if (llmResult && typeof llmResult === "string") {
          this.stats.llm += 1;
          this.cacheCompletion(currentLine, llmResult);
          return {
            insertText: llmResult,
            source: "llm",
          };
        }
      } catch (err) {
        console.warn(`[GhostCompletion] LLM provider error: ${err?.message}`);
      }
    }

    return null;
  }
}

const ghostCompletion = new GhostCompletionEngine();

module.exports = {
  GhostCompletionEngine,
  ghostCompletion,
};
