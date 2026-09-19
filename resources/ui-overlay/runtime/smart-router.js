/**
 * EditCoreAI - Smart Model & Cost Router (runtime/smart-router.js)
 * Intelligent LLM Gateway with dynamic task routing, automatic failover/fallback,
 * latency health tracking, and token cost estimations.
 */

"use strict";

const TASK_CATEGORIES = {
  GHOST_COMPLETION: "ghost_completion",
  EXPLANATION: "explanation",
  CHAT: "chat",
  REFACTOR: "refactor",
  ARCHITECTURE: "architecture",
  CODE_AUDIT: "code_audit",
};

const DEFAULT_TIER_MODELS = {
  // Ultra-fast lightweight models (sub-second latency)
  lightweight: [
    { provider: "gemini", model: "gemini-1.5-flash", priority: 1, costPer1kInput: 0.000075, costPer1kOutput: 0.0003 },
    { provider: "anthropic", model: "claude-3-haiku-20240307", priority: 2, costPer1kInput: 0.00025, costPer1kOutput: 0.00125 },
    { provider: "openai", model: "gpt-4o-mini", priority: 3, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 },
    { provider: "apicredits", model: "deepseek-coder", priority: 4, costPer1kInput: 0.00014, costPer1kOutput: 0.00028 },
    { provider: "ollama", model: "qwen2.5-coder:7b", priority: 5, costPer1kInput: 0, costPer1kOutput: 0, isLocal: true },
  ],
  // Balanced models for conversation, explanation and quick debug
  balanced: [
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022", priority: 1, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
    { provider: "gemini", model: "gemini-1.5-pro", priority: 2, costPer1kInput: 0.00125, costPer1kOutput: 0.005 },
    { provider: "openai", model: "gpt-4o", priority: 3, costPer1kInput: 0.0025, costPer1kOutput: 0.01 },
    { provider: "apicredits", model: "claude-3-5-sonnet", priority: 4, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
    { provider: "ollama", model: "llama3.1:8b", priority: 5, costPer1kInput: 0, costPer1kOutput: 0, isLocal: true },
  ],
  // High-reasoning heavy models for multi-file architecture, planning and deep audits
  reasoning: [
    { provider: "anthropic", model: "claude-3-7-sonnet", priority: 1, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
    { provider: "openai", model: "o3-mini", priority: 2, costPer1kInput: 0.0011, costPer1kOutput: 0.0044 },
    { provider: "apicredits", model: "deepseek-r1", priority: 3, costPer1kInput: 0.00055, costPer1kOutput: 0.00219 },
    { provider: "gemini", model: "gemini-2.0-flash-thinking-exp", priority: 4, costPer1kInput: 0, costPer1kOutput: 0 },
    { provider: "ollama", model: "deepseek-r1:14b", priority: 5, costPer1kInput: 0, costPer1kOutput: 0, isLocal: true },
  ],
};

class SmartRouter {
  constructor(options = {}) {
    this.localOllamaUrl = options.localOllamaUrl || "http://127.0.0.1:11434/v1";
    this.timeoutMs = options.timeoutMs || 25000;
    this.providerHealth = new Map();
    this.routingHistory = [];
    this.totalCostEstimated = 0;
  }

  /**
   * Determina el tier requerido según el tipo de tarea
   */
  classifyTaskTier(taskType, prompt = "") {
    const type = String(taskType || "").toLowerCase();
    if (type === TASK_CATEGORIES.GHOST_COMPLETION || type === "completion" || type === "inline") {
      return "lightweight";
    }
    if (type === TASK_CATEGORIES.ARCHITECTURE || type === "planning" || type === "swarm" || type === "deep_audit") {
      return "reasoning";
    }
    if (type === TASK_CATEGORIES.REFACTOR || type === "composer") {
      const isComplex = prompt && (prompt.length > 800 || prompt.includes("refactor") || prompt.includes("arquitectura"));
      return isComplex ? "reasoning" : "balanced";
    }
    return "balanced";
  }

  /**
   * Resuelve el mejor candidato de modelo para una tarea dada
   */
  resolveCandidate(taskType, options = {}) {
    const tier = options.tier || this.classifyTaskTier(taskType, options.prompt);
    const pool = [...(DEFAULT_TIER_MODELS[tier] || DEFAULT_TIER_MODELS.balanced)];

    // Filtrar proveedores marcados como degradados / caídos
    const healthyPool = pool.filter((cand) => {
      const health = this.providerHealth.get(cand.provider);
      if (!health) return true;
      return health.status !== "unhealthy" || Date.now() - health.lastFailure > 60000;
    });

    const candidate = (healthyPool.length ? healthyPool : pool)[0];
    return {
      tier,
      candidate,
      fallbackChain: pool.filter((c) => c.provider !== candidate.provider),
    };
  }

  /**
   * Registra resultado de ejecución para actualizar métricas de salud
   */
  recordExecution(provider, { success, latencyMs, inputTokens = 0, outputTokens = 0, model = "" } = {}) {
    const prev = this.providerHealth.get(provider) || {
      provider,
      totalRequests: 0,
      failures: 0,
      avgLatencyMs: 0,
      status: "healthy",
      lastFailure: 0,
    };

    prev.totalRequests++;
    if (!success) {
      prev.failures++;
      prev.lastFailure = Date.now();
      if (prev.failures >= 3 && prev.failures / prev.totalRequests > 0.4) {
        prev.status = "unhealthy";
      }
    } else {
      prev.status = "healthy";
      prev.avgLatencyMs = prev.avgLatencyMs ? Math.round((prev.avgLatencyMs * 0.7) + (latencyMs * 0.3)) : latencyMs;
    }

    this.providerHealth.set(provider, prev);

    // Estimación de coste
    const candidateMeta = Object.values(DEFAULT_TIER_MODELS)
      .flat()
      .find((m) => m.provider === provider && (!model || m.model === model));

    let cost = 0;
    if (candidateMeta && !candidateMeta.isLocal) {
      cost = ((inputTokens / 1000) * (candidateMeta.costPer1kInput || 0)) +
             ((outputTokens / 1000) * (candidateMeta.costPer1kOutput || 0));
      this.totalCostEstimated += cost;
    }

    const logEntry = {
      timestamp: Date.now(),
      provider,
      model: model || candidateMeta?.model || "unknown",
      success,
      latencyMs,
      inputTokens,
      outputTokens,
      costEstimated: cost,
    };

    this.routingHistory.push(logEntry);
    if (this.routingHistory.length > 200) {
      this.routingHistory.shift();
    }

    return logEntry;
  }

  /**
   * Devuelve estadísticas de enrutador y salud de proveedores
   */
  getStats() {
    return {
      totalCostEstimated: Number(this.totalCostEstimated.toFixed(6)),
      historyCount: this.routingHistory.length,
      providerHealth: Object.fromEntries(this.providerHealth.entries()),
      recentRoutes: this.routingHistory.slice(-10),
    };
  }

  /**
   * Determina la cadena de fallback en caso de error
   */
  getFallbackFor(failedProvider, taskType) {
    const tier = this.classifyTaskTier(taskType);
    const pool = DEFAULT_TIER_MODELS[tier] || DEFAULT_TIER_MODELS.balanced;
    const fallbacks = pool.filter((c) => c.provider !== failedProvider);
    return fallbacks[0] || { provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true };
  }
}

const smartRouterInstance = new SmartRouter();

module.exports = {
  SmartRouter,
  smartRouter: smartRouterInstance,
  TASK_CATEGORIES,
  DEFAULT_TIER_MODELS,
};
