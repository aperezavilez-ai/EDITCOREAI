const os = require('os');
const { performance } = require('perf_hooks');

const TELEMETRY_CHANNEL = 'editcore:telemetry';
const DEFAULT_INTERVAL_MS = 1000;

class TelemetryMonitor {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.timer = null;
    this.listeners = new Set();
    this.latencySamples = [];
    this.agentResponseSamples = [];
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

  _sample() {
    const cpus = os.cpus();
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

    const avgLspLatency = this._avg(this.latencySamples);
    const avgAgentResponse = this._avg(this.agentResponseSamples);

    const payload = {
      timestamp: Date.now(),
      cpuUsage: Number(cpuUsage.toFixed(2)),
      memoryUsage: Number(memoryUsage.toFixed(2)),
      freeMemMb,
      totalMemMb,
      lspLatency: avgLspLatency,
      agentResponseMs: avgAgentResponse,
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
    if (!samples.length) return 0;
    const sum = samples.reduce((a, b) => a + b, 0);
    return Number((sum / samples.length).toFixed(2));
  }
}

module.exports = { TelemetryMonitor };
