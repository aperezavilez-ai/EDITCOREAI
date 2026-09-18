"use strict";

/**
 * PredictiveGarbageCollector — GC predictivo y compresión de estado
 * Ejecuta recolección de basura selectiva cuando el consumo supera el 75%
 * y comprime el historial de contexto antiguo en segundo plano.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { MemoryProfiler } = require("./memory-profiler.js");

class PredictiveGarbageCollector {
  constructor(options = {}) {
    this.memoryThreshold = options.memoryThreshold || 0.75;
    this.contextDir = options.contextDir || path.join(__dirname, "../.editcore/context-archive");
    this.compressionLevel = options.compressionLevel || 6;
    this.maxContextAgeMs = options.maxContextAgeMs || 24 * 60 * 60 * 1000;
    this.maxUncompressedMB = options.maxUncompressedMB || 50;
    this.profiler = new MemoryProfiler({
      thresholdMB: options.thresholdMB || 1500,
      leakThresholdMB: options.leakThresholdMB || 50,
    });

    this._gcTimer = null;
    this._compressionTimer = null;
    this._gcCount = 0;
    this._compressionCount = 0;
    this._lastGcStats = null;
    this._lastCompressionStats = null;

    fs.mkdirSync(this.contextDir, { recursive: true });
  }

  /**
   * Inicia el ciclo predictivo de GC y compresión
   */
  startPredictiveCycle() {
    this.profiler.startMonitoring();

    this.profiler.on("memory:threshold-exceeded", (stats) => {
      this.evaluateAndCollect(stats);
    });

    this._compressionTimer = setInterval(() => {
      this.compressOldContext();
    }, 5 * 60 * 1000);

    if (this._compressionTimer.unref) {
      this._compressionTimer.unref();
    }
  }

  /**
   * Evalúa si debe ejecutar GC selectivo
   */
  evaluateAndCollect(stats) {
    const heapLimitMB = stats.heapSizeLimitMB;
    const utilization = stats.heapUsedMB / heapLimitMB;

    if (utilization >= this.memoryThreshold) {
      const result = this.runSelectiveGC(stats);
      this._lastGcStats = result;
      this._gcCount++;
      return result;
    }

    return { action: "skipped", reason: `Utilización ${(utilization * 100).toFixed(1)}% < umbral ${(this.memoryThreshold * 100).toFixed(1)}%` };
  }

  /**
   * Ejecuta GC selectivo con métricas
   */
  runSelectiveGC(statsBefore) {
    const before = {
      heapUsedMB: statsBefore.heapUsedMB,
      rssMB: statsBefore.rssMB,
      externalMB: statsBefore.externalMB,
    };

    const gcStart = Date.now();
    if (global.gc) {
      global.gc();
    } else {
      if (globalThis.gc) globalThis.gc();
    }
    const gcDurationMs = Date.now() - gcStart;

    const statsAfter = this.profiler.getMemoryStats();
    const after = {
      heapUsedMB: statsAfter.heapUsedMB,
      rssMB: statsAfter.rssMB,
      externalMB: statsAfter.externalMB,
    };

    const freedMB = Math.round((before.heapUsedMB - after.heapUsedMB) * 100) / 100;
    const freedPercent = before.heapUsedMB > 0 ? Math.round((freedMB / before.heapUsedMB) * 10000) / 100 : 0;

    const result = {
      action: "gc-executed",
      gcNumber: this._gcCount,
      before,
      after,
      freedMB,
      freedPercent,
      gcDurationMs,
      timestamp: new Date().toISOString(),
      utilizationBefore: Math.round((before.heapUsedMB / statsBefore.heapSizeLimitMB) * 10000) / 100,
      utilizationAfter: Math.round((after.heapUsedMB / statsAfter.heapSizeLimitMB) * 10000) / 100,
    };

    if (freedMB < 1 && utilizationBefore > 80) {
      result.warning = "GC liberó menos de 1MB con alta utilización. Posible retención de objetos.";
    }

    return result;
  }

  /**
   * Comprime el historial de contexto antiguo
   */
  compressOldContext() {
    const files = fs.readdirSync(this.contextDir).filter(f => f.endsWith(".json"));
    const now = Date.now();
    let compressed = 0;
    let skipped = 0;

    for (const file of files) {
      const filepath = path.join(this.contextDir, file);
      const stat = fs.statSync(filepath);
      const ageMs = now - stat.mtimeMs;

      if (ageMs < this.maxContextAgeMs) {
        skipped++;
        continue;
      }

      if (stat.size > this.maxUncompressedMB * 1024 * 1024) {
        const compressedPath = `${filepath}.gz`;
        const content = fs.readFileSync(filepath);
        const compressed = zlib.gzipSync(content, { level: this.compressionLevel });
        fs.writeFileSync(compressedPath, compressed);

        const ratio = ((content.length - compressed.length) / content.length) * 100;
        fs.unlinkSync(filepath);

        this._compressionCount++;
        this._lastCompressionStats = {
          file,
          originalMB: Math.round(content.length / 1024 / 1024 * 100) / 100,
          compressedMB: Math.round(compressed.length / 1024 / 1024 * 100) / 100,
          ratioPercent: Math.round(ratio * 100) / 100,
          ageHours: Math.round(ageMs / 3600000),
        };
      }
    }

    return {
      action: "compression-completed",
      compressedFiles: this._compressionCount,
      skippedFiles: skipped,
      lastCompression: this._lastCompressionStats,
    };
  }

  /**
   * Obtiene estadísticas del sistema de GC predictivo
   */
  getStats() {
    const current = this.profiler.getMemoryStats();
    const leak = this.profiler.detectLeak();

    return {
      gcRuns: this._gcCount,
      compressionRuns: this._compressionCount,
      lastGc: this._lastGcStats,
      lastCompression: this._lastCompressionStats,
      currentMemory: current,
      leakDetected: leak,
      health: this._calculateHealth(current, leak),
    };
  }

  _calculateHealth(stats, leak) {
    const utilization = stats.heapUsedMB / stats.heapSizeLimitMB;

    if (utilization > 0.9 || (leak && leak.severity === "critical")) {
      return "critical";
    }
    if (utilization > 0.75 || (leak && leak.severity === "warning")) {
      return "warning";
    }
    return "healthy";
  }

  /**
   * Detiene todos los ciclos
   */
  stop() {
    this.profiler.stopMonitoring();
    if (this._compressionTimer) {
      clearInterval(this._compressionTimer);
      this._compressionTimer = null;
    }
  }

  stopPredictiveCycle() {
    this.stop();
  }
}

module.exports = { PredictiveGarbageCollector };
