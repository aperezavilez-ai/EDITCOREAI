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
