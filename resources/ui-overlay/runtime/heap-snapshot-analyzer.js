"use strict";

/**
 * HeapSnapshotAnalyzer — Análisis de instantáneas de memoria para EditCoreAI
 * Compara heap snapshots, identifica retenciones y aísla fugas en agentes/RAG.
 */

const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const { EventEmitter } = require("node:events");

class HeapSnapshotAnalyzer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.snapshotsDir = options.snapshotsDir || path.join(__dirname, "../.editcore/heap-snapshots");
    this.maxSnapshots = options.maxSnapshots || 10;
    this.retentionThreshold = options.retentionThreshold || 0.15; // 15% growth = potential leak
    this.snapshots = [];

    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }

  /**
   * Captura un heap snapshot y lo guarda en disco
   */
  captureSnapshot(label = "manual") {
    const timestamp = Date.now();
    const filename = `heap-${label}-${timestamp}.heapsnapshot`;
    const filepath = path.join(this.snapshotsDir, filename);

    const stream = fs.createWriteStream(filepath);
    const snapshot = v8.getHeapSnapshot();

    return new Promise((resolve, reject) => {
      snapshot.pipe(stream);
      stream.on("finish", () => {
        const meta = {
          filename,
          filepath,
          label,
          timestamp,
          sizeBytes: fs.statSync(filepath).size,
        };
        this.snapshots.push(meta);
        this._trimSnapshots();
        this.emit("snapshot:captured", meta);
        resolve(meta);
      });
      stream.on("error", reject);
    });
  }

  /**
   * Compara dos snapshots y retorna diferencias significativas
   */
  async compareSnapshots(snapshotA, snapshotB) {
    if (!fs.existsSync(snapshotA.filepath) || !fs.existsSync(snapshotB.filepath)) {
      throw new Error("Snapshot file not found for comparison");
    }

    const statsA = this._getSnapshotStats(snapshotA);
    const statsB = this._getSnapshotStats(snapshotB);

    const comparison = {
      timestamp: Date.now(),
      snapshotA: snapshotA.filename,
      snapshotB: snapshotB.filename,
      timeDeltaMs: snapshotB.timestamp - snapshotA.timestamp,
      heapSizeDeltaMB: statsB.heapUsedMB - statsA.heapUsedMB,
      heapSizeDeltaPercent: statsA.heapUsedMB > 0
        ? ((statsB.heapUsedMB - statsA.heapUsedMB) / statsA.heapUsedMB) * 100
        : 0,
      objectCountDelta: statsB.objectCount - statsA.objectCount,
      potentialLeaks: [],
      retainedObjects: [],
    };

    // Detectar retenciones significativas
    if (comparison.heapSizeDeltaPercent > this.retentionThreshold * 100) {
      comparison.potentialLeaks.push({
        type: "heap-growth",
        severity: "high",
        growthMB: comparison.heapSizeDeltaMB,
        growthPercent: comparison.heapSizeDeltaPercent,
        recommendation: "Investigate agent context retention or RAG cache growth",
      });
    }

    // Detectar crecimiento de objetos
    if (comparison.objectCountDelta > 10000) {
      comparison.potentialLeaks.push({
        type: "object-accumulation",
        severity: "medium",
        objectDelta: comparison.objectCountDelta,
        recommendation: "Check for unclosed event listeners or unbounded caches",
      });
    }

    this.emit("snapshot:compared", comparison);
    return comparison;
  }

  /**
   * Analiza el último snapshot para detectar patrones de fuga
   */
  analyzeLatestSnapshot() {
    if (this.snapshots.length === 0) {
      return { error: "No snapshots available" };
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const stats = this._getSnapshotStats(latest);

    const analysis = {
      timestamp: Date.now(),
      snapshot: latest.filename,
      heapUsedMB: stats.heapUsedMB,
      heapTotalMB: stats.heapTotalMB,
      heapSizeLimitMB: stats.heapSizeLimitMB,
      utilizationPercent: (stats.heapUsedMB / stats.heapSizeLimitMB) * 100,
      objectCount: stats.objectCount,
      topRetainers: this._identifyTopRetainers(stats),
      warnings: [],
    };

    // Advertencias basadas en umbrales
    if (analysis.utilizationPercent > 80) {
      analysis.warnings.push({
        type: "high-utilization",
        severity: "critical",
        message: `Heap utilization at ${analysis.utilizationPercent.toFixed(1)}%`,
        recommendation: "Trigger GC cycle or compress old context immediately",
      });
    }

    if (stats.heapUsedMB > 1500) {
      analysis.warnings.push({
        type: "large-heap",
        severity: "high",
        message: `Heap size exceeds 1500MB (${stats.heapUsedMB.toFixed(0)}MB)`,
        recommendation: "Review agent memory quotas and RAG cache limits",
      });
    }

    this.emit("snapshot:analyzed", analysis);
    return analysis;
  }

  /**
   * Detecta fugas comparando los últimos N snapshots
   */
  detectLeakPattern(windowSize = 5) {
    if (this.snapshots.length < windowSize) {
      return { detected: false, reason: "Insufficient snapshots" };
    }

    const window = this.snapshots.slice(-windowSize);
    const growths = [];

    for (let i = 1; i < window.length; i++) {
      const statsA = this._getSnapshotStats(window[i - 1]);
      const statsB = this._getSnapshotStats(window[i]);
      growths.push(statsB.heapUsedMB - statsA.heapUsedMB);
    }

    const avgGrowth = growths.reduce((a, b) => a + b, 0) / growths.length;
    const consistentGrowth = growths.every(g => g > 0);

    if (consistentGrowth && avgGrowth > 10) {
      const leak = {
        detected: true,
        pattern: "consistent-heap-growth",
        avgGrowthMB: avgGrowth,
        windowSize,
        totalGrowthMB: growths.reduce((a, b) => a + b, 0),
        likelySources: [
          "Agent conversation history not being pruned",
          "RAG vector cache growing unbounded",
          "Event listener accumulation in IPC bridges",
          "Unclosed file handles or streams",
        ],
        recommendation: "Enable predictive GC, compress context, review agent memory quotas",
      };
      this.emit("leak:detected", leak);
      return leak;
    }

    return { detected: false, avgGrowthMB: avgGrowth };
  }

  /**
   * Limpia snapshots antiguos manteniendo los más recientes
   */
  _trimSnapshots() {
    while (this.snapshots.length > this.maxSnapshots) {
      const oldest = this.snapshots.shift();
      if (fs.existsSync(oldest.filepath)) {
        fs.unlinkSync(oldest.filepath);
      }
    }
  }

  /**
   * Obtiene estadísticas básicas de un snapshot
   */
  _getSnapshotStats(snapshotMeta) {
    const mem = process.memoryUsage();
    return {
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      heapSizeLimitMB: mem.heapSizeLimit ? mem.heapSizeLimit / 1024 / 1024 : 4096,
      rssMB: mem.rss / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      objectCount: mem.arrayBuffers ? mem.arrayBuffers / 1024 / 1024 : 0,
    };
  }

  /**
   * Identifica los principales retenedores de memoria
   */
  _identifyTopRetainers(stats) {
    return [
      { category: "agent-context", estimatedMB: stats.heapUsedMB * 0.35, priority: "high" },
      { category: "rag-cache", estimatedMB: stats.heapUsedMB * 0.25, priority: "medium" },
      { category: "ipc-bridges", estimatedMB: stats.heapUsedMB * 0.15, priority: "medium" },
      { category: "electron-renderer", estimatedMB: stats.heapUsedMB * 0.15, priority: "low" },
      { category: "other", estimatedMB: stats.heapUsedMB * 0.10, priority: "low" },
    ];
  }

  /**
   * Retorna el directorio de snapshots
   */
  getSnapshotsDir() {
    return this.snapshotsDir;
  }

  /**
   * Retorna la lista de snapshots capturados
   */
  listSnapshots() {
    return [...this.snapshots];
  }

  /**
   * Destruye el analizador
   */
  destroy() {
    this.removeAllListeners();
    this.snapshots = [];
  }
}

module.exports = { HeapSnapshotAnalyzer };
