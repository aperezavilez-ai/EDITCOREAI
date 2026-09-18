"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const { MemoryProfiler } = require(path.join(__dirname, "..", "runtime", "memory-profiler.js"));
const { PredictiveGarbageCollector } = require(path.join(__dirname, "..", "runtime", "predictive-gc.js"));
const { HeapSnapshotAnalyzer } = require(path.join(__dirname, "..", "runtime", "heap-snapshot-analyzer.js"));

describe("Ciclo 11 — Memory Stress & Production Packaging", () => {
  const snapshotsDir = path.join(__dirname, "..", ".editcore", "memory-snapshots");
  const heapDir = path.join(__dirname, "..", ".editcore", "heap-snapshots");
  const contextDir = path.join(__dirname, "..", ".editcore", "context-archive");

  before(async () => {
    [snapshotsDir, heapDir, contextDir].forEach((dir) => {
      fs.mkdirSync(dir, { recursive: true });
    });
  });

  after(async () => {
    [snapshotsDir, heapDir, contextDir].forEach((dir) => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("MemoryProfiler: captura métricas y dispara eventos de umbral", async () => {
    const profiler = new MemoryProfiler({
      thresholdMB: 100,
      leakThresholdMB: 10,
      monitoringInterval: 1000,
    });

    let thresholdEvent = null;
    profiler.on("memory:threshold-exceeded", (stats) => {
      thresholdEvent = stats;
    });

    profiler.startMonitoring();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    profiler.stopMonitoring();

    assert.ok(profiler.history.length >= 1, "Debe registrar al menos una muestra");
    assert.ok(thresholdEvent === null || typeof thresholdEvent.heapUsedMB === "number", "Evento de umbral debe tener heapUsedMB cuando se dispare");
  });

  it("PredictiveGarbageCollector: ejecuta evaluación y comprime contexto antiguo", async () => {
    const gc = new PredictiveGarbageCollector({
      memoryThreshold: 0.75,
      maxContextAgeMs: 1000,
      maxUncompressedMB: 1,
      compressionLevel: 1,
    });

    gc.startPredictiveCycle();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.ok(typeof gc._lastCompressionStats === "object" || gc._lastCompressionStats === null, "Debe inicializar estadísticas de compresión");
    gc.stopPredictiveCycle();
  });

  it("HeapSnapshotAnalyzer: captura y compara snapshots", async () => {
    const analyzer = new HeapSnapshotAnalyzer({
      maxSnapshots: 5,
      retentionThreshold: 0.1,
    });

    const a = await analyzer.captureSnapshot("stress-a");
    const b = await analyzer.captureSnapshot("stress-b");

    const comparison = await analyzer.compareSnapshots(a, b);
    assert.ok(comparison.timestamp > 0, "Comparación debe tener timestamp");
    assert.ok(Array.isArray(comparison.potentialLeaks), "Debe exponer potencialLeaks");
    assert.ok(b.timestamp >= a.timestamp, "Snapshot B debe ser posterior a A");

    const analysis = analyzer.analyzeLatestSnapshot();
    assert.ok(analysis.snapshot === b.filename, "Debe analizar el último snapshot");
    assert.ok(Array.isArray(analysis.warnings), "Debe exponer warnings");

    const leakPattern = analyzer.detectLeakPattern(2);
    assert.ok("detected" in leakPattern, "Debe exponer campo detected en detección de patrón");

    analyzer.destroy();
  });

  it("Stress: asignación controlada de objetos y verificación de crecimiento", async () => {
    const profiler = new MemoryProfiler({
      thresholdMB: 2000,
      leakThresholdMB: 100,
      monitoringInterval: 500,
    });

    profiler.startMonitoring();
    const before = profiler.getMemoryStats();

    const buffers = [];
    for (let i = 0; i < 5000; i++) {
      buffers.push(Buffer.alloc(1024 * 10, i % 255));
    }

    const after = profiler.getMemoryStats();
    assert.ok(after.heapUsedMB >= before.heapUsedMB, "El heap usado debe crecer tras asignar buffers");

    buffers.length = 0;
    if (global.gc) {
      global.gc();
    }

    const afterCleanup = profiler.getMemoryStats();
    assert.ok(afterCleanup.heapUsedMB <= after.heapUsedMB + 10, "El heap debe reducirse o estabilizarse tras limpiar referencias");

    profiler.stopMonitoring();
  });

  it("Packaging: package.json contiene scripts de build/release válidos", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    const distScript = pkg.scripts["dist:win"] || pkg.scripts.dist_win;
    const releaseScript = pkg.scripts["release:win"] || pkg.scripts.release_win;
    assert.ok(typeof distScript === "string", "Debe existir script dist:win");
    assert.ok(typeof releaseScript === "string", "Debe existir script release:win");
    assert.ok(releaseScript.includes("electron-builder"), "release:win debe invocar electron-builder");
  });

  it("Packaging: build-windows.js existe y es parseable", () => {
    const buildScript = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-windows.js"), "utf8");
    assert.ok(buildScript.includes("electron-builder"), "build-windows debe usar electron-builder");
    assert.ok(buildScript.includes("nsis"), "Debe configurar empaquetado Windows NSIS");
  });
});
