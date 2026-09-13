"use strict";

/**
 * CLAUDE-CORE: Sistema de ejecución de agentes basado en Claude Code
 *
 * Este módulo implementa la lógica completa de Claude Code para:
 * - Deduplicación de acciones
 * - Estrategias de fallback
 * - Validación preventiva
 * - Control de tokens
 * - Detección de loops
 * - Recovery robusto
 *
 * Reemplaza el sistema actual que causaba los 7 errores críticos.
 */

const crypto = require("node:crypto");
const { ActionRegistry } = require("./action-registry");
const { SmartRetry, createCommonStrategies } = require("./smart-retry");

// ============================================
// CONFIGURACIÓN GLOBAL
// ============================================

const CLAUDE_CONFIG = {
  // Límites de seguridad
  MAX_LOOP_WINDOW: 5, // Ventana para detectar loops
  MAX_IDENTICAL_ACTIONS: 2, // Máximo de acciones idénticas antes de detener
  MAX_FAILED_RETRIES: 3, // Máximo de reintentos fallidos

  // Presupuesto de tokens
  TOKEN_WARNING_THRESHOLD: 0.7, // 70%
  TOKEN_CRITICAL_THRESHOLD: 0.9, // 90%

  // Timeouts
  DEFAULT_ACTION_TIMEOUT: 30000, // 30 segundos
  CHECKPOINT_TIMEOUT: 5000, // 5 segundos

  // Cache
  ACTION_CACHE_TTL: 3600000, // 1 hora
  MAX_CACHE_ENTRIES: 1000,
};

// ============================================
// CLASE PRINCIPAL: ClaudeAgentCore
// ============================================

class ClaudeAgentCore {
  constructor(options = {}) {
    // Componentes del sistema
    this.actionRegistry = new ActionRegistry({
      maxEntries: CLAUDE_CONFIG.MAX_CACHE_ENTRIES,
      cacheTTL: CLAUDE_CONFIG.ACTION_CACHE_TTL,
    });

    this.smartRetry = new SmartRetry({
      maxAttempts: CLAUDE_CONFIG.MAX_FAILED_RETRIES,
      timeout: CLAUDE_CONFIG.DEFAULT_ACTION_TIMEOUT,
      logger: options.logger || console,
    });

    // Estado del agente
    this.context = {
      task: null,
      history: [],
      tokenBudget: null,
      checkpoints: [],
      failedActions: new Map(),
      loopDetectionWindow: [],
    };

    // Configuración
    this.logger = options.logger || console;
    this.taskManager = options.taskManager || null;
    this.contextStore = options.contextStore || null;
  }

  // ============================================
  // LOOP PRINCIPAL DE EJECUCIÓN
  // ============================================

  /**
   * Ejecuta una tarea del agente con toda la lógica de Claude Code
   */
  async executeTask(input) {
    const startTime = Date.now();

    try {
      // 1. Inicializar contexto
      this.context.task = {
        taskId: input.taskId || `task_${crypto.randomUUID()}`,
        goal: input.prompt || input.goal,
        projectRoot: input.projectRoot,
        projectId: input.projectId,
        allowWrite: input.allowWrite !== false,
        analysisMode: Boolean(input.analysisMode),
      };

      // 2. Inicializar presupuesto de tokens
      this.context.tokenBudget = new TokenBudget(
        input.maxTokens || 100000,
        {
          warningThreshold: CLAUDE_CONFIG.TOKEN_WARNING_THRESHOLD,
          criticalThreshold: CLAUDE_CONFIG.TOKEN_CRITICAL_THRESHOLD,
        }
      );

      // 3. Verificar si hay checkpoint para resumir
      let resumeContext = null;
      if (input.resume && this.taskManager) {
        resumeContext = await this.recoverFromCheckpoint(this.context.task.taskId);
      }

      // 4. Ejecutar loop principal
      const result = await this.agentExecutionLoop(input, resumeContext);

      // 5. Retornar resultado
      return {
        success: true,
        taskId: this.context.task.taskId,
        text: result.text,
        steps: result.steps,
        report: result.report,
        usage: this.context.tokenBudget.getReport(),
        elapsedMs: Date.now() - startTime,
      };

    } catch (error) {
      this.logger.error(`❌ Error en ejecución de tarea: ${error.message}`);

      // Guardar checkpoint de error
      if (this.taskManager) {
        await this.createErrorCheckpoint(error);
      }

      throw error;
    }
  }

  /**
   * Loop principal de ejecución del agente
   * Implementa la lógica completa de Claude Code
   */
  async agentExecutionLoop(input, resumeContext) {
    const steps = resumeContext?.steps || [];
    let iterationCount = 0;
    const maxIterations = 100;

    while (iterationCount < maxIterations) {
      iterationCount++;

      // 1. Verificar presupuesto de tokens
      if (this.context.tokenBudget.remaining() < 1000) {
        this.logger.warn("⚠ Presupuesto de tokens agotado, finalizando tarea");
        return this.finalizeTask(steps, "budget_exceeded");
      }

      // 2. Detectar loops ANTES de pedir acción al modelo
      if (this.detectLoop(steps)) {
        this.logger.error("🔄 Loop infinito detectado, deteniendo ejecución");
        return this.finalizeTask(steps, "infinite_loop_detected");
      }

      // 3. Obtener siguiente acción del modelo
      const nextAction = await this.getNextAction(input, steps);

      // 4. Validar que la acción sea válida
      if (!this.validateAction(nextAction)) {
        this.logger.warn("⚠ Acción inválida del modelo, reformulando prompt...");
        steps.push({
          type: "error",
          message: "Por favor responde con una tool call válida",
          timestamp: Date.now(),
        });
        continue;
      }

      // 5. Si el modelo dice que terminó, finalizar
      if (nextAction.type === "final_answer") {
        this.logger.log("✓ Agente completó la tarea");
        return this.finalizeTask(steps, "completed", nextAction.text);
      }

      // 6. Verificar si ya ejecutamos esta acción
      if (this.actionRegistry.wasExecuted(nextAction)) {
        const cachedResult = this.actionRegistry.getResult(nextAction);
        this.logger.log(`⚡ Acción ya ejecutada, usando resultado cacheado: ${nextAction.name}`);

        steps.push({
          name: nextAction.name,
          input: nextAction.input,
          result: cachedResult,
          cached: true,
          timestamp: Date.now(),
        });

        continue;
      }

      // 7. Ejecutar acción con estrategias de fallback
      try {
        const result = await this.executeActionWithFallback(nextAction);

        // 8. Registrar resultado exitoso
        this.actionRegistry.record(nextAction, result, true);

        steps.push({
          name: nextAction.name,
          input: nextAction.input,
          result: result,
          success: true,
          timestamp: Date.now(),
        });

        // 9. Actualizar ventana de detección de loops
        this.updateLoopDetectionWindow(nextAction);

        // 10. Crear checkpoint cada N pasos
        if (steps.length % 5 === 0 && this.taskManager) {
          await this.createCheckpoint(steps);
        }

      } catch (error) {
        this.logger.error(`✗ Error ejecutando ${nextAction.name}: ${error.message}`);

        // Registrar fallo
        this.actionRegistry.record(nextAction, error, false);

        steps.push({
          name: nextAction.name,
          input: nextAction.input,
          error: error.message,
          success: false,
          timestamp: Date.now(),
        });

        // Verificar si hemos fallado demasiadas veces
        const failureCount = this.incrementFailureCount(nextAction.name);
        if (failureCount >= CLAUDE_CONFIG.MAX_FAILED_RETRIES) {
          this.logger.error(`❌ Demasiados fallos consecutivos en ${nextAction.name}`);
          return this.finalizeTask(steps, "max_failures_exceeded");
        }
      }
    }

    // Si llegamos aquí, excedimos max iterations
    this.logger.warn("⚠ Se alcanzó el límite de iteraciones");
    return this.finalizeTask(steps, "max_iterations_exceeded");
  }

  // ============================================
  // VALIDACIÓN PREVENTIVA
  // ============================================

  /**
   * Valida una acción ANTES de ejecutarla
   */
  validateAction(action) {
    if (!action || typeof action !== "object") {
      return false;
    }

    if (!action.type || !action.name) {
      return false;
    }

    // Validar que tenga los campos necesarios
    if (action.type === "tool") {
      return Boolean(action.name && action.input !== undefined);
    }

    if (action.type === "final_answer") {
      return Boolean(action.text);
    }

    return true;
  }

  // ============================================
  // EJECUCIÓN CON FALLBACK
  // ============================================

  /**
   * Ejecuta una acción con estrategias de fallback automáticas
   */
  async executeActionWithFallback(action) {
    // Validación preventiva específica por tipo de acción
    if (action.name === "read_file") {
      return await this.safeReadFile(action.input);
    }

    if (action.name === "list_files") {
      return await this.safeListFiles(action.input);
    }

    // Para otras acciones, ejecutar normalmente
    return await this.executeToolDirect(action);
  }

  /**
   * Lee un archivo con validación preventiva y búsqueda de alternativas
   */
  async safeReadFile(input) {
    const filepath = String(input?.path || "");

    // 1. Verificar que el archivo existe
    const fs = require("fs").promises;

    try {
      await fs.access(filepath);
    } catch (error) {
      // 2. Buscar alternativas
      this.logger.warn(`⚠ Archivo no encontrado: ${filepath}`);
      this.logger.log(`  Buscando alternativas...`);

      const alternative = await this.findAlternativeFile(filepath);

      if (alternative) {
        this.logger.log(`  ✓ Usando archivo alternativo: ${alternative}`);
        return await fs.readFile(alternative, "utf-8");
      }

      throw new Error(`Archivo no encontrado: ${filepath} (sin alternativas)`);
    }

    // 3. Leer archivo
    const content = await fs.readFile(filepath, "utf-8");

    // 4. Verificar presupuesto de tokens
    const estimatedTokens = this.estimateTokens(content);

    if (!this.context.tokenBudget.canAfford(estimatedTokens).allowed) {
      this.logger.warn(`⚠ Archivo muy grande (${estimatedTokens} tokens), resumiendo...`);
      return this.summarizeContent(content);
    }

    // 5. Consumir tokens
    this.context.tokenBudget.consume(estimatedTokens, `read:${filepath}`);

    return content;
  }

  /**
   * Lista archivos con estrategias de fallback
   */
  async safeListFiles(input) {
    const path = String(input?.path || "");

    // Crear estrategias de fallback
    const strategies = createCommonStrategies("list_files", { path });

    // Ejecutar con SmartRetry
    const result = await this.smartRetry.executeWithFallback(strategies);

    return result.result;
  }

  /**
   * Busca archivos alternativos si el solicitado no existe
   */
  async findAlternativeFile(filepath) {
    const path = require("path");
    const fs = require("fs").promises;

    const dir = path.dirname(filepath);
    const basename = path.basename(filepath, path.extname(filepath));
    const ext = path.extname(filepath);

    // Extensiones alternativas
    const alternativeExts = {
      ".tsx": [".ts", ".jsx", ".js"],
      ".ts": [".tsx", ".js"],
      ".jsx": [".js", ".tsx", ".ts"],
      ".js": [".ts", ".jsx", ".tsx"],
    };

    const extsToTry = alternativeExts[ext] || [];

    for (const altExt of extsToTry) {
      const altPath = path.join(dir, basename + altExt);
      try {
        await fs.access(altPath);
        return altPath;
      } catch {}
    }

    return null;
  }

  // ============================================
  // DETECCIÓN DE LOOPS
  // ============================================

  /**
   * Detecta loops comparando ventanas de acciones
   * Implementación de Claude Code
   */
  detectLoop(steps) {
    if (steps.length < CLAUDE_CONFIG.MAX_LOOP_WINDOW * 2) {
      return false;
    }

    const recentActions = steps.slice(-CLAUDE_CONFIG.MAX_LOOP_WINDOW);
    const previousActions = steps.slice(-CLAUDE_CONFIG.MAX_LOOP_WINDOW * 2, -CLAUDE_CONFIG.MAX_LOOP_WINDOW);

    // Comparar secuencias de nombres de acciones
    const recentSignature = recentActions.map(s => s.name).join(",");
    const previousSignature = previousActions.map(s => s.name).join(",");

    if (recentSignature === previousSignature) {
      this.logger.warn("🔄 Loop detectado: misma secuencia de acciones");
      return true;
    }

    return false;
  }

  /**
   * Actualiza ventana de detección de loops
   */
  updateLoopDetectionWindow(action) {
    this.context.loopDetectionWindow.push({
      name: action.name,
      timestamp: Date.now(),
    });

    // Mantener solo últimas N acciones
    if (this.context.loopDetectionWindow.length > CLAUDE_CONFIG.MAX_LOOP_WINDOW * 2) {
      this.context.loopDetectionWindow.shift();
    }
  }

  // ============================================
  // GESTIÓN DE CHECKPOINTS
  // ============================================

  /**
   * Crea un checkpoint del estado actual
   */
  async createCheckpoint(steps) {
    if (!this.taskManager) return;

    const checkpoint = {
      taskId: this.context.task.taskId,
      timestamp: Date.now(),
      steps: steps.map(s => ({
        name: s.name,
        input: s.input,
        success: s.success,
      })),
      tokenUsage: this.context.tokenBudget.getReport(),
      cacheStats: this.actionRegistry.getStats(),
    };

    try {
      await this.taskManager.checkpoint(this.context.task.taskId, checkpoint);
      this.logger.log(`✓ Checkpoint creado (${steps.length} pasos)`);
    } catch (error) {
      this.logger.warn(`⚠ Error creando checkpoint: ${error.message}`);
    }
  }

  /**
   * Recupera desde un checkpoint
   */
  async recoverFromCheckpoint(taskId) {
    if (!this.taskManager) return null;

    try {
      const recovery = this.taskManager.getCheckpoint ?await this.taskManager.getCheckpoint(taskId) : null;

      if (recovery) {
        this.logger.log(`✓ Recuperando desde checkpoint (${recovery.steps?.length || 0} pasos previos)`);
        return recovery;
      }
    } catch (error) {
      this.logger.warn(`⚠ Error recuperando checkpoint: ${error.message}`);
    }

    return null;
  }

  /**
   * Crea checkpoint de error para recovery
   */
  async createErrorCheckpoint(error) {
    if (!this.taskManager) return;

    const errorCheckpoint = {
      taskId: this.context.task.taskId,
      timestamp: Date.now(),
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
      steps: this.context.history,
      tokenUsage: this.context.tokenBudget?.getReport(),
    };

    try {
      await this.taskManager.checkpoint(this.context.task.taskId, errorCheckpoint);
    } catch {}
  }

  // ============================================
  // UTILIDADES
  // ============================================

  /**
   * Incrementa contador de fallos para una acción
   */
  incrementFailureCount(actionName) {
    const current = this.context.failedActions.get(actionName) || 0;
    const updated = current + 1;
    this.context.failedActions.set(actionName, updated);
    return updated;
  }

  /**
   * Estima tokens de un texto
   */
  estimateTokens(text) {
    // Aproximación: 1 token ≈ 3 caracteres para español/inglés mixto
    return Math.ceil(String(text || "").length / 3);
  }

  /**
   * Resume contenido cuando es demasiado grande
   */
  summarizeContent(content) {
    const lines = String(content).split("\n");

    if (lines.length <= 50) {
      return content;
    }

    // Extraer partes importantes
    const imports = lines.filter(l => /^import |^from /.test(l.trim())).slice(0, 10);
    const exports = lines.filter(l => /export /.test(l)).slice(0, 10);
    const functions = lines.filter(l => /function |const .* = |class /.test(l)).slice(0, 15);

    const summary = [
      "// RESUMEN DEL ARCHIVO (contenido truncado para conservar tokens)",
      "",
      "// Imports:",
      ...imports,
      "",
      "// Exports:",
      ...exports,
      "",
      "// Funciones/Clases:",
      ...functions,
      "",
      `// Total líneas: ${lines.length}`,
      `// (Archivo resumido automáticamente)`,
    ].join("\n");

    return summary;
  }

  /**
   * Finaliza tarea y genera reporte
   */
  finalizeTask(steps, status, finalText = "") {
    return {
      text: finalText || this.generateFinalReport(steps, status),
      steps: steps,
      report: {
        completed: status === "completed",
        status: status,
        toolCount: steps.length,
        tokenUsage: this.context.tokenBudget?.getReport(),
        cacheStats: this.actionRegistry.getStats(),
      },
    };
  }

  /**
   * Genera reporte final basado en los pasos ejecutados
   */
  generateFinalReport(steps, status) {
    const successfulSteps = steps.filter(s => s.success !== false);
    const failedSteps = steps.filter(s => s.success === false);

    return [
      `# Reporte de Ejecución`,
      ``,
      `**Estado:** ${status}`,
      `**Pasos ejecutados:** ${steps.length}`,
      `**Exitosos:** ${successfulSteps.length}`,
      `**Fallidos:** ${failedSteps.length}`,
      ``,
      `## Acciones Realizadas`,
      ...successfulSteps.slice(-10).map(s => `- ${s.name}: OK`),
      ``,
      status === "completed" ? "✓ Tarea completada exitosamente" : `⚠ Tarea interrumpida: ${status}`,
    ].join("\n");
  }

  /**
   * Ejecuta tool directamente (sin fallback especial)
   */
  async executeToolDirect(action) {
    // Esta función debe ser sobreescrita por la integración real
    throw new Error("executeToolDirect debe ser implementado por la integración");
  }

  /**
   * Obtiene siguiente acción del modelo
   */
  async getNextAction(input, steps) {
    // Esta función debe ser sobreescrita por la integración real
    throw new Error("getNextAction debe ser implementado por la integración");
  }
}

// ============================================
// TOKEN BUDGET (del código de referencia)
// ============================================

class TokenBudget {
  constructor(maxTokens, options = {}) {
    this.maxTokens = maxTokens;
    this.used = 0;
    this.operations = [];
    this.warningThreshold = options.warningThreshold || 0.7;
    this.criticalThreshold = options.criticalThreshold || 0.9;
    this._warnings = new Set();
  }

  canAfford(estimatedTokens) {
    const projected = this.used + estimatedTokens;
    const maxAllowed = this.maxTokens * 0.9; // 10% buffer

    return {
      allowed: projected < maxAllowed,
      projected: projected,
      percentage: ((projected / this.maxTokens) * 100).toFixed(1),
      remaining: this.remaining(),
    };
  }

  consume(tokens, operation = "unknown") {
    this.used += tokens;

    this.operations.push({
      operation: operation,
      tokens: tokens,
      timestamp: Date.now(),
    });

    this._checkThresholds();
  }

  _checkThresholds() {
    const ratio = this.used / this.maxTokens;

    if (ratio >= this.criticalThreshold && !this._warnings.has("critical")) {
      console.warn(`\n⚠️  CRÍTICO: Presupuesto de tokens al ${(ratio * 100).toFixed(1)}%`);
      this._warnings.add("critical");
    } else if (ratio >= this.warningThreshold && !this._warnings.has("warning")) {
      console.warn(`\n⚠️  WARNING: Presupuesto de tokens al ${(ratio * 100).toFixed(1)}%`);
      this._warnings.add("warning");
    }
  }

  remaining() {
    return Math.max(0, this.maxTokens - this.used);
  }

  getReport() {
    return {
      maxTokens: this.maxTokens,
      used: this.used,
      remaining: this.remaining(),
      percentage: ((this.used / this.maxTokens) * 100).toFixed(1) + "%",
      operations: this.operations.length,
    };
  }
}

module.exports = { ClaudeAgentCore, TokenBudget };
