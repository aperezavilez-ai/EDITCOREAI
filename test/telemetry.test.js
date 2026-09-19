const { test } = require('node:test');
const assert = require('node:assert');
const { TelemetryMonitor } = require('../runtime/telemetry-monitor');

test('emite métricas iniciales sin listeners', () => {
  const monitor = new TelemetryMonitor({ intervalMs: 50 });
  const payload = monitor._sample();
  assert.ok(payload.timestamp);
  assert.ok(typeof payload.cpuUsage === 'number');
  assert.ok(typeof payload.memoryUsage === 'number');
  assert.ok(typeof payload.lspLatency === 'number');
  assert.ok(typeof payload.agentResponseMs === 'number');
  monitor.stop();
});

test('notifica a los listeners con cada muestra', () => {
  const monitor = new TelemetryMonitor({ intervalMs: 50 });
  let received = null;
  monitor.onMetrics((m) => { received = m; });
  monitor._sample();
  assert.ok(received, 'debería haber recibido métricas');
  assert.ok(received.timestamp > 0);
  monitor.stop();
});

test('permite desuscribirse', () => {
  const monitor = new TelemetryMonitor({ intervalMs: 50 });
  let count = 0;
  const off = monitor.onMetrics(() => { count++; });
  monitor._sample();
  off();
  monitor._sample();
  assert.strictEqual(count, 1);
  monitor.stop();
});

test('promedia muestras de respuesta de agente', () => {
  const monitor = new TelemetryMonitor({ intervalMs: 50 });
  monitor.recordAgentResponse(100);
  monitor.recordAgentResponse(200);
  const payload = monitor._sample();
  assert.strictEqual(payload.agentResponseMs, 150);
  monitor.stop();
});

test('limita el buffer de muestras', () => {
  const monitor = new TelemetryMonitor({ intervalMs: 50 });
  for (let i = 0; i < 500; i++) monitor.recordLspLatency(i);
  const payload = monitor._sample();
  assert.ok(typeof payload.lspLatency === 'number');
  monitor.stop();
});

test('Cycle 31: tracks tokens, cost, RAG cache hits and router latency', () => {
  const monitor = new TelemetryMonitor();

  monitor.recordTokenUsage(1200, 300, 0.0045);
  monitor.recordTokenUsage(800, 200, 0.0030);
  monitor.recordRagCacheHit(true);
  monitor.recordRagCacheHit(false);
  monitor.recordRouterLatency(120);
  monitor.recordRouterLatency(80);

  const snapshot = monitor.getSnapshot();

  assert.strictEqual(snapshot.tokens.totalPromptTokens, 2000);
  assert.strictEqual(snapshot.tokens.totalCompletionTokens, 500);
  assert.strictEqual(snapshot.tokens.totalTokens, 2500);
  assert.strictEqual(snapshot.tokens.totalEstimatedCostUsd, 0.0075);

  assert.strictEqual(snapshot.rag.hits, 1);
  assert.strictEqual(snapshot.rag.total, 2);
  assert.strictEqual(snapshot.rag.hitRatePercent, 50);

  assert.strictEqual(snapshot.routerLatencyMs, 100);
  assert.ok(typeof snapshot.heapUsedMb === 'number');

  const history = monitor.getHistory('tokens', 10);
  assert.strictEqual(history.length, 2);
});

