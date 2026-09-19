/**
 * runtime/enterprise-memory.js
 * EditCoreAI - Enterprise Memory Mesh & Architectural Decision Ledger (Ciclo 39)
 */

const fs = require("fs");
const path = require("path");
const { vectorStore } = require("./vector-store");

class EnterpriseMemoryMesh {
  constructor(options = {}) {
    this.options = options;
    this.meshPath = options.meshPath || ".editcore/memory-mesh.json";
    this.adrs = new Map(); // adrId -> ADR Record
    this.branches = new Map(); // branchName -> { memorySnapshot, updatedAt }
  }

  /**
   * Registra una Decisión Arquitectónica Inmutable (ADR)
   */
  recordAdr({ title = "", context = "", decision = "", consequences = "", author = "EditCoreAI Architect", projectRoot = "" } = {}) {
    const adrId = `ADR-${String(this.adrs.size + 1).padStart(3, "0")}`;
    const record = {
      adrId,
      title: title || "Decisión Arquitectónica",
      status: "ACCEPTED",
      context: context || "Contexto del sistema analizado",
      decision: decision || "Decisión técnica adoptada",
      consequences: consequences || "Impacto y consecuencias evaluadas",
      author: author || "EditCoreAI Architect",
      createdAt: new Date().toISOString(),
    };

    this.adrs.set(adrId, record);

    if (projectRoot) {
      this.saveMesh(projectRoot);
    }

    return record;
  }

  /**
   * Obtiene un ADR por ID
   */
  getAdr(adrId) {
    return this.adrs.get(adrId) || null;
  }

  /**
   * Lista todos los ADRs registrados
   */
  listAdrs(projectRoot = "") {
    if (projectRoot && this.adrs.size === 0) {
      this.loadMesh(projectRoot);
    }
    return Array.from(this.adrs.values());
  }

  /**
   * Sincroniza la memoria semántica y reglas de una rama específica
   */
  syncBranchMemory(projectRoot, branchName = "main") {
    if (!projectRoot) return { synced: false };

    const stats = vectorStore.getStats(projectRoot);
    const snapshot = {
      branchName,
      fileCount: stats.fileCount || 0,
      totalChunks: stats.totalChunks || 0,
      adrCount: this.adrs.size,
      syncedAt: new Date().toISOString(),
    };

    this.branches.set(branchName, snapshot);
    this.saveMesh(projectRoot);

    return {
      synced: true,
      branch: branchName,
      snapshot,
    };
  }

  /**
   * Guarda el estado del Memory Mesh en disco
   */
  saveMesh(projectRoot) {
    if (!projectRoot) return false;
    try {
      const targetDir = path.join(projectRoot, ".editcore");
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const data = {
        adrs: Array.from(this.adrs.values()),
        branches: Object.fromEntries(this.branches),
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(path.join(projectRoot, this.meshPath), JSON.stringify(data, null, 2), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Carga el estado del Memory Mesh desde el disco
   */
  loadMesh(projectRoot) {
    if (!projectRoot) return null;
    const filePath = path.join(projectRoot, this.meshPath);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.adrs)) {
          for (const a of parsed.adrs) this.adrs.set(a.adrId, a);
        }
        if (parsed.branches) {
          for (const [b, snap] of Object.entries(parsed.branches)) this.branches.set(b, snap);
        }
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const enterpriseMemoryMeshInstance = new EnterpriseMemoryMesh();

module.exports = {
  EnterpriseMemoryMesh,
  enterpriseMemory: enterpriseMemoryMeshInstance,
};
