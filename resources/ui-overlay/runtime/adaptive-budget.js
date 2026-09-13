"use strict";

/**
 * ADAPTIVE BUDGET - Control dinámico del presupuesto de tokens
 * Ajusta estrategia según tokens restantes
 */

class AdaptiveBudget {
  constructor(totalBudget, options = {}) {
    this.totalBudget = totalBudget || 200000;
    this.spent = 0;
    this.logger = options.logger || console;

    // Thresholds de advertencia (antes = quemaba tokens hasta 90%)
    this.warnThreshold = options.warnThreshold || 0.55;
    this.criticalThreshold = options.criticalThreshold || 0.78;

    // Flags de advertencias ya mostradas
    this.warnShown = false;
    this.criticalShown = false;
  }

  /**
   * Registra gasto de tokens
   */
  spend(amount) {
    this.spent += amount;
    this.checkThresholds();
  }

  /**
   * Tokens restantes
   */
  remaining() {
    return Math.max(0, this.totalBudget - this.spent);
  }

  /**
   * Porcentaje usado
   */
  percentUsed() {
    return (this.spent / this.totalBudget) * 100;
  }

  /**
   * Verifica umbrales y muestra advertencias
   */
  checkThresholds() {
    const percent = this.percentUsed();

    if (percent >= this.criticalThreshold * 100 && !this.criticalShown) {
      this.logger.warn(`🔴 [Budget] CRÍTICO: ${Math.round(percent)}% usado (${this.remaining().toLocaleString()} tokens restantes)`);
      this.criticalShown = true;
    } else if (percent >= this.warnThreshold * 100 && !this.warnShown) {
      this.logger.warn(`⚠️ [Budget] Advertencia: ${Math.round(percent)}% usado (${this.remaining().toLocaleString()} tokens restantes)`);
      this.warnShown = true;
    }
  }

  /**
   * Obtiene estrategia según presupuesto restante
   */
  getStrategy() {
    const percent = this.percentUsed();

    if (percent < 45) return "full";
    if (percent < 65) return "moderate";
    if (percent < 82) return "minimal";
    return "emergency";
  }

  shouldForceReport() {
    return this.getStrategy() === "emergency" || this.percentUsed() >= this.criticalThreshold * 100;
  }

  shouldAllowNewSearch() {
    const strategy = this.getStrategy();
    return strategy === "full" || strategy === "moderate";
  }

  maxToolResultChars() {
    const strategy = this.getStrategy();
    if (strategy === "full") return 10_000;
    if (strategy === "moderate") return 5_000;
    if (strategy === "minimal") return 2_500;
    return 1_200;
  }

  /**
   * Decide si se debe leer un archivo basado en tamaño y estrategia
   */
  shouldReadFile(fileSize, priority = "normal") {
    const strategy = this.getStrategy();

    if (priority === "high") {
      return true;
    }

    if (strategy === "full") {
      return true;
    }

    if (strategy === "moderate") {
      return fileSize < 50000;
    }

    if (strategy === "minimal") {
      return fileSize < 10000;
    }

    if (strategy === "emergency") {
      return fileSize < 5000 && priority === "high";
    }

    return false;
  }

  /**
   * Decide si se debe hacer búsqueda exhaustiva
   */
  shouldSearchDeep() {
    const strategy = this.getStrategy();
    return strategy === 'full' || strategy === 'moderate';
  }

  /**
   * Decide cuántos archivos listar como máximo
   */
  getMaxFilesList() {
    const strategy = this.getStrategy();

    if (strategy === 'full') return 1000;
    if (strategy === 'moderate') return 500;
    if (strategy === 'minimal') return 100;
    return 50; // emergency
  }

  /**
   * Decide cuánto contexto incluir en mensajes
   */
  getContextSize() {
    const strategy = this.getStrategy();

    if (strategy === 'full') return 5000;      // Contexto completo
    if (strategy === 'moderate') return 3000;  // Contexto moderado
    if (strategy === 'minimal') return 1000;   // Contexto mínimo
    return 500;                                // Emergency: muy poco contexto
  }

  /**
   * Obtiene resumen del presupuesto
   */
  getSummary() {
    return {
      total: this.totalBudget,
      spent: this.spent,
      remaining: this.remaining(),
      percentUsed: Math.round(this.percentUsed()),
      strategy: this.getStrategy(),
    };
  }

  /**
   * Reinicia el presupuesto
   */
  reset(newBudget) {
    this.totalBudget = newBudget || this.totalBudget;
    this.spent = 0;
    this.warnShown = false;
    this.criticalShown = false;
  }
}

module.exports = { AdaptiveBudget };
