"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { execSync } = require("node:child_process");

class TerminalHealer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.healingHistory = [];
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Analiza la salida de error de una terminal o proceso para extraer la causa raíz.
   */
  analyzeError(output = "", cwd = process.cwd()) {
    const raw = String(output || "");
    if (!raw.trim()) {
      return { hasError: false, message: "Sin errores detectados" };
    }

    const result = {
      hasError: true,
      errorType: "UnknownError",
      message: "",
      file: null,
      line: null,
      column: null,
      snippet: "",
      raw,
    };

    // 1. Error de Módulo no encontrado: Cannot find module 'X' o Module not found
    const modMatch = raw.match(/Cannot find module ['"]([^'"]+)['"]|Module not found: Error: Can't resolve ['"]([^'"]+)['"]/i);
    if (modMatch) {
      result.errorType = "ModuleNotFound";
      result.missingModule = modMatch[1] || modMatch[2];
      result.message = `Módulo faltante: ${result.missingModule}`;
      result.suggestedFix = `npm install ${result.missingModule}`;
    }

    // 2. Extraer archivo, línea y columna con soporte para letras de unidad Windows (C:\... o C:/...)
    const stackMatch = raw.match(/(?:at\s+(?:[a-zA-Z0-9_$.<>]+\s+)?\(?|\s+)?((?:[a-zA-Z]:)?[^():\n]+?):(\d+):(\d+)\)?/);
    if (stackMatch) {
      const detectedFile = stackMatch[1].trim();
      const relative = path.isAbsolute(detectedFile) ? path.relative(cwd, detectedFile).replace(/\\/g, "/") : detectedFile.replace(/\\/g, "/");
      result.file = relative;
      result.line = parseInt(stackMatch[2], 10);
      result.column = parseInt(stackMatch[3], 10);
    }

    // 3. Extraer tipo de error estándar
    const errTypeMatch = raw.match(/(SyntaxError|TypeError|ReferenceError|AssertionError|RangeError|URIError):\s*(.+)/);
    if (errTypeMatch) {
      result.errorType = errTypeMatch[1];
      result.message = errTypeMatch[2].trim();
    } else if (!result.message) {
      const firstErrorLine = raw.split("\n").find((l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed"));
      result.message = firstErrorLine ? firstErrorLine.trim() : raw.slice(0, 200).trim();
    }

    return result;
  }

  /**
   * Genera un plan de auto-reparación basado en el análisis de error.
   */
  createHealingPlan(analysis, cwd = process.cwd()) {
    if (!analysis.hasError) return null;

    const planId = `heal_${Date.now()}`;
    const actions = [];

    if (analysis.errorType === "ModuleNotFound" && analysis.missingModule) {
      actions.push({
        type: "command",
        command: `npm install ${analysis.missingModule}`,
        description: `Instalar dependencia faltante ${analysis.missingModule}`,
      });
    } else if (analysis.file && analysis.line) {
      actions.push({
        type: "patch_code",
        file: analysis.file,
        line: analysis.line,
        description: `Revisar y corregir ${analysis.errorType} en ${analysis.file}:${analysis.line}`,
      });
    } else {
      actions.push({
        type: "inspect",
        description: "Revisión general de salida de terminal",
      });
    }

    const plan = {
      planId,
      analysis,
      actions,
      cwd,
      status: "ready",
      createdAt: new Date().toISOString(),
    };

    return plan;
  }

  /**
   * Ejecuta el ciclo de auto-reparación automático.
   */
  async executeAutoHeal(testOrRunCommand, cwd = process.cwd(), patchFn = null) {
    this.emit("healing:started", { command: testOrRunCommand, cwd });

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let output = "";
      let success = false;

      try {
        output = execSync(testOrRunCommand, { cwd, stdio: "pipe", encoding: "utf8" });
        success = true;
      } catch (err) {
        output = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || "");
        success = false;
      }

      if (success) {
        const result = { ok: true, attempt, output: output.slice(0, 500) };
        this.emit("healing:success", result);
        return result;
      }

      const analysis = this.analyzeError(output, cwd);
      this.emit("healing:analyzed", { attempt, analysis });

      const plan = this.createHealingPlan(analysis, cwd);

      if (patchFn) {
        try {
          await patchFn(analysis, plan);
          this.emit("healing:patched", { attempt, plan });
        } catch {
          // Si el parche falla, continuar al siguiente intento
        }
      }
    }

    const failureResult = { ok: false, message: `Auto-healing no pudo resolver el error tras ${this.maxRetries} intentos.` };
    this.emit("healing:failed", failureResult);
    return failureResult;
  }

  getHistory() {
    return this.healingHistory;
  }
}

const terminalHealerInstance = new TerminalHealer();

module.exports = {
  TerminalHealer,
  terminalHealer: terminalHealerInstance,
};
