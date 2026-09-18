"use strict";

/**
 * Memory Profiler — Monitor de heap en tiempo real para EditCoreAI
 * Detecta fugas de memoria, genera heap snapshots y analiza retención
 * en subprocesos de agentes autónomos y motor RAG.
 */

const v8 = require("node:v8");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

class MemoryProfiler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.snapshotsDir = options.snapshotsDir || path.join(__dirname, "../../.editcore/memory-snapshots");
    this.thresholdMB = options.thresholdMB || 1500;
    this.leakThresholdMB = options.leakThresholdMB || 50;
    this.monitoringInterval = options.monitoringInterval || 30000;
    this.history = [];
    this.maxHistory = options.maxHistory || 100;
    this._monitorTimer = null;
    this._isMonitoring = false;

    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }

  /**
   * Inicia el monitoreo continuo de memoria
   */
  startMonitoring() {
    if (this._isMonitoring) return;
    this._isMonitoring = true;
    this.emit("monitoring:start");

    this._monitorTimer = setInterval(() => {
      const stats = this.getMemoryStats();
      this.history.push(stats);

      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      this.emit("memory:stats", stats);

      if (stats.heapUsedMB > this.thresholdMB) {
        this.emit("memory:threshold-exceeded", stats);
        this.captureSnapshot("threshold-exceeded");
      }

      const leak = this.detectLeak();
      if (leak) {
        this.emit("memory:leak-detected", leak);
      }
    }, this.monitoringInterval);

    if (this._monitorTimer.unref) {
      this._monitorTimer.unref();
    }
  }

  /**
   * Detiene el monitoreo
   */
  stopMonitoring() {
    if (this._monitorTimer) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }
    this._isMonitoring = false;
    this.emit("monitoring:stop");
  }

  /**
   * Obtiene estadísticas actuales de memoria
   */
  getMemoryStats() {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const heapSpaceStats = v8.getHeapSpaceStatistics();

    return {
      timestamp: Date.now(),
      isoTimestamp: new Date().toISOString(),
      rssMB: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
      externalMB: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      arrayBuffersMB: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024 * 100) / 100,
      heapUtilization: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 10000) / 100,
      totalHeapSizeMB: Math.round(heapStats.total_heap_size / 1024 / 1024 * 100) / 100,
      usedHeapSizeMB: Math.round(heapStats.used_heap_size / 1024 / 1024 * 100) / 100,
      heapSizeLimitMB: Math.round(heapStats.heap_size_limit / 1024 / 1024 * 100) / 100,
      spaces: heapSpaceStats.map(s => ({
        name: s.space_name,
        usedMB: Math.round(s.space_used_size / 1024 / 1024 * 100) / 100,
        availableMB: Math.round(s.space_available_size / 1024 / 1024 * 100) / 100,
        capacityMB: Math.round(s.space_size / 1024 / 1024 * 100) / 100,
      })),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Captura un heap snapshot y lo guarda en disco
   */
  captureSnapshot(label = "manual") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `heap-${label}-${timestamp}.heapsnapshot`;
    const filepath = path.join(this.snapshotsDir, filename);

    const snapshotStream = v8.getHeapSnapshot();
    const writeStream = fs.createWriteStream(filepath);

    return new Promise((resolve, reject) => {
      snapshotStream.pipe(writeStream);
      writeStream.on("finish", () => {
        const stats = fs.statSync(filepath);
        this.emit("snapshot:captured", { filepath, sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100, label });
        resolve({ filepath, filename, size: stats.size });
      });
      writeStream.on("error", reject);
      snapshotStream.on("error", reject);
    });
  }

  /**
   * Detecta fugas de memoria analizando la tendencia del historial
   */
  detectLeak() {
    if (this.history.length < 10) return null;

    const recent = this.history.slice(-10);
    const heapValues = recent.map(s => s.heapUsedMB);

    const firstHalf = heapValues.slice(0, 5);
    const secondHalf = heapValues.slice(5);
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const growth = avgSecond - avgFirst;

    if (growth > this.leakThresholdMB) {
      const growthRate = (growth / avgFirst) * 100;
      return {
        type: "heap-growth",
        growthMB: Math.round(growth * 100) / 100,
        growthRatePercent: Math.round(growthRate * 100) / 100,
        periodMinutes: Math.round((recent[recent.length - 1].timestamp - recent[0].timestamp) / 60000),
        avgHeapStartMB: Math.round(avgFirst * 100) / 100,
        avgHeapEndMB: Math.round(avgSecond * 100) / 100,
        severity: growthRate > 20 ? "critical" : growthRate > 10 ? "warning" : "info",
      };
    }

    return null;
  }

  /**
   * Analiza retención de objetos comparando dos snapshots
   */
  async compareSnapshots(snapshotA, snapshotB) {
    if (!fs.existsSync(snapshotA) || !fs.existsSync(snapshotB)) {
      throw new Error("Uno o ambos snapshots no existen");
    }

    const statsA = fs.statSync(snapshotA);
    const statsB = fs.statSync(snapshotB);

    return {
      snapshotA: { path: snapshotA, sizeMB: Math.round(statsA.size / 1024 / 1024 * 100) / 100 },
      snapshotB: { path: snapshotB, sizeMB: Math.round(statsB.size / 1024 / 1024 * 100) / 100 },
      deltaMB: Math.round((statsB.size - statsA.size) / 1024 / 1024 * 100) / 100,
      growthPercent: statsA.size > 0 ? Math.round(((statsB.size - statsA.size) / statsA.size) * 10000) / 100 : 0,
      recommendation: statsB.size > statsA.size * 1.5
        ? "Crecimiento significativo detectado. Revisar retención de objetos en Chrome DevTools."
        : "Crecimiento dentro de rangos normales.",
    };
  }

  /**
   * Genera reporte de salud de memoria
   */
  generateHealthReport() {
    const current = this.getMemoryStats();
    const leak = this.detectLeak();
    const heapLimitMB = current.heapSizeLimitMB;
    const utilizationPercent = (current.heapUsedMB / heapLimitMB) * 100;

    let health = "healthy";
    if (utilizationPercent > 85 || (leak && leak.severity === "critical")) {
      health = "critical";
    } else if (utilizationPercent > 70 || (leak && leak.severity === "warning")) {
      health = "warning";
    }

    return {
      health,
      current,
      leakDetected: leak,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      historyLength: this.history.length,
      snapshotsDir: this.snapshotsDir,
      snapshotCount: fs.existsSync(this.snapshotsDir)
        ? fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith(".heapsnapshot")).length
        : 0,
      recommendations: this._generateRecommendations(current, leak, utilizationPercent),
    };
  }

  _generateRecommendations(stats, leak, utilization) {
    const recs = [];

    if (utilization > 80) {
      recs.push("URGENTE: Uso de heap > 80%. Ejecutar GC forzado o reiniciar procesos de agente.");
    }
    if (leak && leak.severity === "critical") {
      recs.push(`Fuga crítica detectada: +${leak.growthMB}MB en ${leak.periodMinutes}min. Capturar snapshot y analizar en DevTools.`);
    }
    if (stats.externalMB > 200) {
      recs.push(`Memoria externa alta (${stats.externalMB}MB). Revisar buffers nativos y handles de archivos.`);
    }
    if (stats.arrayBuffersMB > 100) {
      recs.push(`ArrayBuffers elevados (${stats.arrayBuffersMB}MB). Verificar streams no cerrados.`);
    }

    const oldSpace = stats.spaces.find(s => s.name === "old_space");
    if (oldSpace && oldSpace.usedMB > oldSpace.capacityMB * 0.8) {
      recs.push("Old space casi lleno. Posible retención de objetos de larga vida.");
    }

    if (recs.length === 0) {
      recs.push("Memoria dentro de parámetros saludables.");
    }

    return recs;
  }

  /**
   * Limpia snapshots antiguos (mantiene los últimos N)
   */
  cleanupSnapshots(keepLast = 10) {
    if (!fs.existsSync(this.snapshotsDir)) return { cleaned: 0 };

    const files = fs.readdirSync(this.snapshotsDir)
      .filter(f => f.endsWith(".heapsnapshot"))
      .map(f => ({
        name: f,
        path: path.join(this.snapshotsDir, f),
        mtime: fs.statSync(path.join(this.snapshotsDir, f)).mtimeMs,
      }))
      .sort((a, b) => a.mtime - b.mtime);

    const toRemove = files.slice(0, Math.max(0, files.length - keepLast));
    let cleanedBytes = 0;

    for (const file of toRemove) {
      const stat = fs.statSync(file.path);
      cleanedBytes += stat.size;
      fs.unlinkSync(file.path);
    }

    return {
      cleaned: toRemove.length,
      cleanedMB: Math.round(cleanedBytes / 1024 / 1024 * 100) / 100,
      remaining: files.length - toRemove.length,
    };
  }
}

module.exports = { MemoryProfiler };
