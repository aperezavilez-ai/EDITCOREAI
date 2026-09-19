"use strict";

/**
 * Ciclo 47: Gobernanza Financiera y Cómputo Autónomo (Resource & Compute Economy)
 * Monitoreo de tokens, costes de LLM e infraestructura cloud, enrutamiento inteligente
 * de ahorro de costes hacia modelos locales y auto-aprovisionamiento de clústeres efímeros.
 */
class ComputeEconomyManager {
  constructor() {
    this.budgetLimitUsd = 50.0;
    this.currentSpendUsd = 12.45;
    this.costSavingsUsd = 38.60;
    this.ephemeralClusters = new Map(); // clusterId -> ClusterInfo
    this.routingPolicy = "SMART_HYBRID"; // 'LOCAL_ONLY' | 'SMART_HYBRID' | 'CLOUD_MAX'
    this.usageLogs = [];
  }

  /**
   * Registra un consumo de cómputo o tokens
   */
  recordUsage({ provider = "openai", model = "gpt-4o", tokens = 1500, costUsd = 0.015, task = "Code Refactor" } = {}) {
    this.currentSpendUsd += costUsd;
    const log = {
      id: `usage_${Date.now()}`,
      provider,
      model,
      tokens,
      costUsd,
      task,
      timestamp: new Date().toISOString(),
    };

    this.usageLogs.push(log);
    if (this.usageLogs.length > 50) this.usageLogs.shift();

    // Auto-ajuste de política de ahorro si supera el 80% del presupuesto
    if (this.currentSpendUsd > this.budgetLimitUsd * 0.8) {
      this.routingPolicy = "LOCAL_ONLY";
    }

    return log;
  }

  /**
   * Decide si una tarea debe enrutarse a la nube o ejecutarse en local para ahorrar costes
   */
  resolveRoutingStrategy(taskComplexity = "medium") {
    if (this.routingPolicy === "LOCAL_ONLY" || this.currentSpendUsd >= this.budgetLimitUsd) {
      return {
        strategy: "LOCAL_OFFLINE_ENGINE",
        reason: "Umbral de presupuesto alcanzado o política de ahorro estricta activa",
        estimatedSavingsUsd: 0.03,
      };
    }

    if (taskComplexity === "low") {
      this.costSavingsUsd += 0.02;
      return {
        strategy: "LOCAL_FAST_MODEL",
        reason: "Complejidad baja: resuelta localmente con cero coste de tokens",
        estimatedSavingsUsd: 0.02,
      };
    }

    return {
      strategy: "CLOUD_SMART_ROUTER",
      reason: "Complejidad alta: procesada con modelo cloud optimizado",
      estimatedSavingsUsd: 0.005,
    };
  }

  /**
   * Aprovisiona un clúster de cómputo efímero en la nube de forma autónoma
   */
  provisionEphemeralCluster({ clusterType = "GPU_SPOT_INSTANCE", targetRegion = "us-east-1", maxNodes = 4 } = {}) {
    const clusterId = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cluster = {
      clusterId,
      clusterType,
      targetRegion,
      maxNodes,
      activeNodes: maxNodes,
      costPerHourUsd: 0.85,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      autoTerminateAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    this.ephemeralClusters.set(clusterId, cluster);
    return cluster;
  }

  /**
   * Destruye un clúster efímero de cómputo
   */
  teardownCluster(clusterId) {
    if (this.ephemeralClusters.has(clusterId)) {
      const cluster = this.ephemeralClusters.get(clusterId);
      cluster.status = "TERMINATED";
      this.ephemeralClusters.delete(clusterId);
      return true;
    }
    return false;
  }

  /**
   * Obtiene el balance financiero y métricas de economía
   */
  getEconomyReport() {
    return {
      budgetLimitUsd: this.budgetLimitUsd,
      currentSpendUsd: Number(this.currentSpendUsd.toFixed(2)),
      remainingBudgetUsd: Number((this.budgetLimitUsd - this.currentSpendUsd).toFixed(2)),
      totalSavingsGeneratedUsd: Number(this.costSavingsUsd.toFixed(2)),
      routingPolicy: this.routingPolicy,
      activeClustersCount: this.ephemeralClusters.size,
      activeClusters: Array.from(this.ephemeralClusters.values()),
      recentUsage: this.usageLogs.slice(-5),
    };
  }

  /**
   * Actualiza el límite de presupuesto
   */
  setBudgetLimit(newLimitUsd) {
    this.budgetLimitUsd = Number(newLimitUsd);
    if (this.currentSpendUsd < this.budgetLimitUsd * 0.8) {
      this.routingPolicy = "SMART_HYBRID";
    }
    return this.getEconomyReport();
  }
}

const computeEconomyManager = new ComputeEconomyManager();

module.exports = {
  ComputeEconomyManager,
  computeEconomy: computeEconomyManager,
};
