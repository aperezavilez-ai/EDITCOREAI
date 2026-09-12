"use strict";

/**
 * TOKEN LEDGER - Monitoreo detallado de tokens
 * Registra cada operación con tokens in/out y cache hits
 */

class TokenLedger {
  constructor() {
    this.operations = [];
    this.totalIn = 0;
    this.totalOut = 0;
    this.cacheHits = 0;
    this.cacheWrites = 0;
    this.startTime = Date.now();
  }

  /**
   * Registra una operación con su consumo de tokens
   */
  record(operation, tokensIn, tokensOut, metadata = {}) {
    const entry = {
      operation,
      tokensIn: tokensIn || 0,
      tokensOut: tokensOut || 0,
      cached: metadata.cached || false,
      cacheCreated: metadata.cacheCreated || 0,
      timestamp: Date.now(),
      elapsed: Date.now() - this.startTime,
    };

    this.operations.push(entry);
    this.totalIn += entry.tokensIn;
    this.totalOut += entry.tokensOut;

    if (metadata.cached) {
      this.cacheHits += entry.tokensIn;
    }

    if (metadata.cacheCreated) {
      this.cacheWrites += metadata.cacheCreated;
    }
  }

  /**
   * Obtiene resumen del uso de tokens
   */
  getSummary() {
    const total = this.totalIn + this.totalOut;
    const savingsPercent = this.totalIn > 0
      ? Math.round((this.cacheHits / this.totalIn) * 100)
      : 0;

    return {
      totalIn: this.totalIn,
      totalOut: this.totalOut,
      totalTokens: total,
      cacheHits: this.cacheHits,
      cacheWrites: this.cacheWrites,
      savingsPercent,
      operations: this.operations.length,
      avgPerOperation: this.operations.length > 0
        ? Math.round(total / this.operations.length)
        : 0,
      elapsed: Date.now() - this.startTime,
    };
  }

  /**
   * Obtiene desglose por tipo de operación
   */
  getBreakdown() {
    const breakdown = {};

    for (const op of this.operations) {
      if (!breakdown[op.operation]) {
        breakdown[op.operation] = {
          count: 0,
          tokensIn: 0,
          tokensOut: 0,
          cached: 0,
        };
      }

      breakdown[op.operation].count++;
      breakdown[op.operation].tokensIn += op.tokensIn;
      breakdown[op.operation].tokensOut += op.tokensOut;
      if (op.cached) breakdown[op.operation].cached++;
    }

    return breakdown;
  }

  /**
   * Genera reporte legible
   */
  getReport() {
    const summary = this.getSummary();
    const breakdown = this.getBreakdown();

    let report = `\n📊 TOKEN LEDGER REPORT\n`;
    report += `═══════════════════════════════════\n`;
    report += `Total Tokens: ${summary.totalTokens.toLocaleString()}\n`;
    report += `  Input: ${summary.totalIn.toLocaleString()}\n`;
    report += `  Output: ${summary.totalOut.toLocaleString()}\n`;
    report += `Cache Hits: ${summary.cacheHits.toLocaleString()} (${summary.savingsPercent}% ahorro)\n`;
    report += `Operations: ${summary.operations}\n`;
    report += `Avg/Op: ${summary.avgPerOperation} tokens\n`;
    report += `Elapsed: ${Math.round(summary.elapsed / 1000)}s\n`;
    report += `\n📋 BREAKDOWN:\n`;

    for (const [op, data] of Object.entries(breakdown)) {
      const total = data.tokensIn + data.tokensOut;
      const cacheRate = data.count > 0 ? Math.round((data.cached / data.count) * 100) : 0;
      report += `  ${op}: ${total} tokens (${data.count}x, ${cacheRate}% cached)\n`;
    }

    return report;
  }

  /**
   * Limpia el ledger
   */
  clear() {
    this.operations = [];
    this.totalIn = 0;
    this.totalOut = 0;
    this.cacheHits = 0;
    this.cacheWrites = 0;
    this.startTime = Date.now();
  }
}

module.exports = { TokenLedger };
