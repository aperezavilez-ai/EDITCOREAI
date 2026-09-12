"use strict";

const crypto = require("node:crypto");

/**
 * ActionRegistry: Previene re-ejecución de acciones idénticas
 *
 * Soluciona el error crítico: "La ejecución se interrumpió porque el agente repitió acciones ya resueltas"
 *
 * Funcionamiento:
 * 1. Hashea cada acción basándose en tool + params + contexto
 * 2. Antes de ejecutar, verifica si ya existe en el registro
 * 3. Si existe, devuelve el resultado cacheado
 * 4. Si no existe, ejecuta y guarda el resultado
 */
class ActionRegistry {
  constructor(options = {}) {
    this.executedActions = new Map();
    this.maxEntries = Math.max(100, Number(options.maxEntries) || 1000);
    this.cacheTTL = Math.max(60_000, Number(options.cacheTTL) || 3_600_000); // 1 hora por defecto
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Genera un hash único para una acción
   * @param {Object} action - La acción a hashear
   * @returns {string} Hash único
   */
  hash(action) {
    if (!action || typeof action !== "object") return "";

    const rawParams = this._sortObject(action.input || action.params || {});
    // Normalizar paths para que read_file("a/b") y read_file("a\\b") compartan cache.
    const params = { ...rawParams };
    if (params.path != null) {
      params.path = String(params.path)
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+/g, "/")
        .replace(/\/$/, "")
        .toLowerCase();
    }
    if (params.query != null) {
      params.query = String(params.query).trim().toLowerCase();
    }

    const normalized = {
      tool: String(action.name || action.tool || "").toLowerCase(),
      params,
      projectRoot: String(action.projectRoot || action.context || "").replace(/\\/g, "/").trim().toLowerCase(),
    };

    return this._createHash(JSON.stringify(normalized));
  }

  /**
   * Ordena objeto recursivamente para hashing consistente
   */
  _sortObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this._sortObject(item));

    return Object.keys(obj)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = this._sortObject(obj[key]);
        return sorted;
      }, {});
  }

  /**
   * Crea hash SHA-256 de una cadena
   */
  _createHash(str) {
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /**
   * Verifica si una acción ya fue ejecutada
   * @param {Object} action - La acción a verificar
   * @returns {boolean} true si ya fue ejecutada
   */
  wasExecuted(action) {
    const actionHash = this.hash(action);
    if (!actionHash) return false;

    const entry = this.executedActions.get(actionHash);

    if (!entry) {
      this.cacheMisses += 1;
      return false;
    }

    // Verificar si el resultado no expiró (TTL)
    const isExpired = (Date.now() - entry.timestamp) > this.cacheTTL;
    if (isExpired) {
      this.executedActions.delete(actionHash);
      this.cacheMisses += 1;
      return false;
    }

    // Un fallo registrado NO es un resultado reutilizable: si el modelo repite
    // la accion debe ejecutarse de verdad (o detenerse por fallo repetido),
    // nunca replicarse como exito cacheado.
    if (entry.success !== true) {
      this.cacheMisses += 1;
      return false;
    }

    this.cacheHits += 1;
    return true;
  }

  /**
   * Registra una acción ejecutada con su resultado
   * @param {Object} action - La acción ejecutada
   * @param {*} result - El resultado de la ejecución
   * @param {boolean} success - Si fue exitosa
   */
  record(action, result, success = true) {
    const actionHash = this.hash(action);
    if (!actionHash) return;

    this.executedActions.set(actionHash, {
      action: {
        name: action.name || action.tool,
        input: action.input || action.params,
      },
      result: result,
      success: success,
      timestamp: Date.now(),
      executionTime: Date.now(), // Para métricas
    });

    // Limpiar entradas viejas si se excede el límite
    if (this.executedActions.size > this.maxEntries) {
      this._evictOldest();
    }
  }

  /**
   * Invalida las entradas cacheadas que apuntan a un archivo mutado, para que
   * las lecturas posteriores devuelvan el contenido real y no uno obsoleto.
   */
  invalidatePath(path) {
    const target = String(path || "").replace(/\\/g, "/").toLowerCase();
    if (!target) return 0;
    let removed = 0;
    for (const [hash, entry] of this.executedActions) {
      const entryPath = String(entry?.action?.input?.path || "").replace(/\\/g, "/").toLowerCase();
      if (entryPath && (entryPath === target || entryPath.endsWith(`/${target}`) || target.endsWith(`/${entryPath}`))) {
        this.executedActions.delete(hash);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Obtiene el resultado de una acción previamente ejecutada
   * @param {Object} action - La acción cuyo resultado se busca
   * @returns {*} El resultado guardado o null
   */
  getResult(action) {
    const actionHash = this.hash(action);
    if (!actionHash) return null;

    const entry = this.executedActions.get(actionHash);
    return entry?.result || null;
  }

  /**
   * Limpia las entradas más antiguas para mantener límite de memoria
   */
  _evictOldest() {
    const entries = Array.from(this.executedActions.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Eliminar 10% más viejo
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.executedActions.delete(entries[i][0]);
    }
  }

  /**
   * Obtiene estadísticas del registro
   */
  getStats() {
    const entries = Array.from(this.executedActions.values());
    const totalAttempts = this.cacheHits + this.cacheMisses;

    return {
      totalActions: entries.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: totalAttempts > 0 ? (this.cacheHits / totalAttempts) : 0,
      successRate: entries.length > 0 ? entries.filter((e) => e.success).length / entries.length : 0,
      maxEntries: this.maxEntries,
      cacheTTL: this.cacheTTL,
    };
  }

  /**
   * Limpia todo el registro
   */
  clear() {
    this.executedActions.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Obtiene las últimas N acciones para debugging
   */
  getRecentActions(n = 10) {
    const entries = Array.from(this.executedActions.values());
    return entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, n)
      .map(({ action, success, timestamp }) => ({
        name: action.name,
        input: JSON.stringify(action.input).slice(0, 100),
        success,
        timestamp,
      }));
  }
}

module.exports = { ActionRegistry };
