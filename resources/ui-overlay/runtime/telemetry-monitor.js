/**
 * runtime/telemetry-monitor.js
 * EditCoreAI - Monitor de Telemetría, Heap, Tokens y Rendimiento (Ciclo 31)
 */

const os = require("os");
const { performance } = require("perf_hooks");

const DEFAULT_INTERVAL_MS = 1000;

class TelemetryMonitor {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.timer = null;
    this.listeners = new Set();
    this.latencySamples = [];
    this.agentResponseSamples = [];
    this.routerLatencySamples = [];
    this.tokenUsageHistory = [];
    this.ragCacheHits = 0;
    this.ragCacheTotal = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalEstimatedCostUsd = 0;
    this.customMetrics = new Map();
    this.maxSamples = 200;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._sample(), this.intervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  onMetrics(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  recordAgentResponse(durationMs) {
    this.agentResponseSamples.push(durationMs);
    if (this.agentResponseSamples.length > this.maxSamples) {
      this.agentResponseSamples.shift();
    }
  }

  recordLspLatency(durationMs) {
    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > this.maxSamples) {
      this.latencySamples.shift();
    }
  }

  recordRouterLatency(durationMs) {
    this.routerLatencySamples.push(durationMs);
    if (this.routerLatencySamples.length > this.maxSamples) {
      this.routerLatencySamples.shift();
    }
  }

  recordTokenUsage(promptTokens = 0, completionTokens = 0, estimatedCostUsd = 0) {
    this.totalPromptTokens += promptTokens;
    this.totalCompletionTokens += completionTokens;
    this.totalEstimatedCostUsd += estimatedCostUsd;

    this.tokenUsageHistory.push({
      timestamp: Date.now(),
      promptTokens,
      completionTokens,
      estimatedCostUsd,
    });

    if (this.tokenUsageHistory.length > this.maxSamples) {
      this.tokenUsageHistory.shift();
    }
  }

  recordRagCacheHit(isHit = true) {
    this.ragCacheTotal++;
    if (isHit) {
      this.ragCacheHits++;
    }
  }

  recordMetric(category, name, value, meta = {}) {
    if (!this.customMetrics.has(category)) {
      this.customMetrics.set(category, []);
    }
    const list = this.customMetrics.get(category);
    list.push({ timestamp: Date.now(), name, value, meta });
    if (list.length > this.maxSamples) {
      list.shift();
    }
  }

  getSnapshot() {
    return this._sample();
  }

  getHistory(category, limit = 50) {
    if (category === "tokens") {
      return this.tokenUsageHistory.slice(-limit);
    }
    if (category === "latency") {
      return this.latencySamples.slice(-limit);
    }
    if (this.customMetrics.has(category)) {
      return this.customMetrics.get(category).slice(-limit);
    }
    return [];
  }

  _sample() {
    const cpus = os.cpus() || [];
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const cpuUsage = totalTick === 0 ? 0 : ((totalTick - totalIdle) / totalTick) * 100;
    const memoryUsage = (1 - os.freemem() / os.totalmem()) * 100;
    const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);

    // Node process heap metrics
    const mem = process.memoryUsage ? process.memoryUsage() : { heapUsed: 0, heapTotal: 0, rss: 0 };
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMb = Math.round(mem.rss / 1024 / 1024);

    const avgLspLatency = this._avg(this.latencySamples);
    const avgAgentResponse = this._avg(this.agentResponseSamples);
    const avgRouterLatency = this._avg(this.routerLatencySamples);

    const ragHitRate = this.ragCacheTotal > 0
      ? Number(((this.ragCacheHits / this.ragCacheTotal) * 100).toFixed(2))
      : 100;

    const payload = {
      timestamp: Date.now(),
      cpuUsage: Number(cpuUsage.toFixed(2)),
      memoryUsage: Number(memoryUsage.toFixed(2)),
      freeMemMb,
      totalMemMb,
      heapUsedMb,
      heapTotalMb,
      rssMb,
      lspLatency: avgLspLatency,
      agentResponseMs: avgAgentResponse,
      routerLatencyMs: avgRouterLatency,
      tokens: {
        totalPromptTokens: this.totalPromptTokens,
        totalCompletionTokens: this.totalCompletionTokens,
        totalTokens: this.totalPromptTokens + this.totalCompletionTokens,
        totalEstimatedCostUsd: Number(this.totalEstimatedCostUsd.toFixed(6)),
      },
      rag: {
        hits: this.ragCacheHits,
        total: this.ragCacheTotal,
        hitRatePercent: ragHitRate,
      },
      uptime: os.uptime(),
      loadAverage: os.loadavg ? os.loadavg() : null,
    };

    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // noop
      }
    }

    return payload;
  }

  _avg(samples) {
    if (!samples || !samples.length) return 0;
    const sum = samples.reduce((a, b) => a + b, 0);
    return Number((sum / samples.length).toFixed(2));
  }
}

const telemetryMonitorInstance = new TelemetryMonitor();

module.exports = {
  TelemetryMonitor,
  telemetryMonitor: telemetryMonitorInstance,
};
