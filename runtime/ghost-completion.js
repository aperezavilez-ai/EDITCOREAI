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
    const currentLineIdx = (typeof position.lineNumber === "number" && position.lineNumber <= lines.length)
      ? position.lineNumber - 1
      : lines.length - 1;
    const fullLine = lines[currentLineIdx] || "";
    // If column is provided, inspect up to the cursor
    const currentLine = typeof position.column === "number" ? fullLine.slice(0, position.column - 1) : fullLine;
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

    // Pattern 6: React useEffect pattern
    if (/^useEffect\s*\(\s*\(\s*\)\s*=>\s*\{?$/.test(trimmed)) {
      if (!trimmed.endsWith("{")) return " {\n  \n}, []);";
      return "\n  \n}, []);";
    }

    // Pattern 7: Export default
    if (trimmed === "export default") {
      return " function () {\n  \n};";
    }

    // Pattern 8: Test suites (describe, it, test)
    const testMatch = trimmed.match(/^(?:it|test)\s*\(\s*(["'`])([^"'`]*)(["'`])?\s*,?\s*$/i);
    if (testMatch) {
      const quote = testMatch[1];
      const hasClosingQuote = Boolean(testMatch[3]);
      return hasClosingQuote ? ", async () => {\n  \n});" : `${quote}, async () => {\n  \n});`;
    }
    const describeMatch = trimmed.match(/^describe\s*\(\s*(["'`])([^"'`]*)(["'`])?\s*,?\s*$/i);
    if (describeMatch) {
      const quote = describeMatch[1];
      const hasClosingQuote = Boolean(describeMatch[3]);
      return hasClosingQuote ? ", () => {\n  \n});" : `${quote}, () => {\n  \n});`;
    }

    // Pattern 9: Console logging
    if (trimmed === "console.log(") {
      return ");";
    }
    if (trimmed === "console.error(") {
      return ");";
    }
    if (trimmed === "console.") {
      return "log();";
    }

    // Pattern 10: Import statement
    if (/^import\s*\{\s*([a-zA-Z0-9_$,\s]*)$/.test(trimmed) && !trimmed.includes("from")) {
      return ' } from "";';
    }

    // Pattern 11: Destructuring assignment
    if (/^(?:const|let)\s*\{\s*([a-zA-Z0-9_$,\s]*)$/.test(trimmed) && !trimmed.includes("=")) {
      return " } = ";
    }

    // Pattern 12: Loop for..of / for..in
    if (/^for\s*\(\s*const\s+([a-zA-Z0-9_$]+)\s+of$/.test(trimmed)) {
      return " items) {\n  \n}";
    }

    return null;
  }

  async provideInlineCompletion(documentContext = "", position = {}, options = {}) {
    this.stats.requests += 1;
    if (!this.enabled) return null;

    const lines = String(documentContext || "").split("\n");
    const currentLineIdx = (typeof position.lineNumber === "number" && position.lineNumber <= lines.length)
      ? position.lineNumber - 1
      : lines.length - 1;
    const fullLine = lines[currentLineIdx] || "";
    const activeText = typeof position.column === "number" ? fullLine.slice(0, position.column - 1) : fullLine;
    const cacheKey = activeText.trim() || fullLine.trim().slice(-100);
    
    // 1. Cache lookup
    const cached = this.getCached(cacheKey);
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
      this.cacheCompletion(cacheKey, heuristic);
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
          this.cacheCompletion(cacheKey, llmResult);
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
