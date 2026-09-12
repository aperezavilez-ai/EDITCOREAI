"use strict";

const { classify } = require("./classify");

class Orchestrator {
  constructor() {
    this.pendingTask = null;
  }

  async processUserMessage({
    userMessage,
    projectRoot,
    apiBaseUrl,
    apiKey,
    model,
    memory,
    onProgress,
    runModelTaskFn
  }) {
    // 1. Extraer y sanitizar texto plano del usuario
    const rawText = typeof userMessage === "object" && userMessage?.text ? userMessage.text : String(userMessage || "");
    const text = rawText.trim();
    const textLower = text.toLowerCase();

    // Palabras clave de autorización rápida
    const isApprovalText = ["procede", "procedo", "adelante", "hazlo", "autorizado", "continua", "continúa", "ejecuta", "si", "sí", "ok", "dale", "va"].includes(textLower);

    // 2. CORRECCIÓN CLAVE: Si hay tarea pendiente y el texto es una confirmación, FORZAR ejecución directa sin pasar por el clasificador
    if (this.pendingTask && isApprovalText) {
      const taskToRun = this.pendingTask;
      this.pendingTask = null; // Vaciar inmediatamente para prevenir bucles de reentrada

      onProgress?.({ phase: "start", text: "Autorización confirmada. Ejecutando cambios en disco..." });

      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision: taskToRun.decision,
        message: taskToRun.message, // Instrucción original intacta
        projectRoot: taskToRun.projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        memory: taskToRun.memory,
        onProgress,
        allowWrite: true,
        maxSteps: 32
      });
    }

    // Clasificar si no entró por forzado de confirmación
    const decision = classify(text);

    // 3. COMANDO DE CANCELACIÓN / PARADA
    if (decision.kind === "STOP") {
      this.pendingTask = null;
      return {
        kind: "CHAT",
        text: "Ejecución cancelada. Tareas pendientes limpiadas. ¿Qué hacemos ahora?"
      };
    }

    // 4. MANEJO DE CONFIRMACIÓN CLASIFICADA POR CLASSIFY.JS
    if (decision.kind === "CONFIRM") {
      if (!this.pendingTask || !this.pendingTask.message) {
        return {
          kind: "CHAT",
          text: "No hay ninguna acción pendiente por autorizar. Dime qué archivo o cambio necesitas realizar."
        };
      }

      const taskToRun = this.pendingTask;
      this.pendingTask = null;

      onProgress?.({ phase: "start", text: "Autorización confirmada. Procesando modificaciones..." });

      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision: taskToRun.decision,
        message: taskToRun.message,
        projectRoot: taskToRun.projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        memory: taskToRun.memory,
        onProgress,
        allowWrite: true,
        maxSteps: 32
      });
    }

    // 5. RESPUESTAS CONVERSACIONALES SIMPLES
    if (decision.kind === "CHAT") {
      return {
        kind: "CHAT",
        text: text
      };
    }

    // 6. RETENCIÓN DE SOLICITUDES DE CONSTRUCCIÓN / ESCRITURA (EXECUTE, GIT, DEPLOY)
    if (decision.allowWrite) {
      // Guardar SOLAMENTE la instrucción real que envió el usuario
      this.pendingTask = {
        decision,
        message: text,
        projectRoot,
        memory
      };

      return {
        kind: "CHAT",
        text: `De acuerdo, tengo lista la estructura para ejecutar esta tarea. ¿Procedemos? Dime "Procede" o "Adelante" cuando quieras.`
      };
    }

    // 7. MODO SÓLO LECTURA Y ANÁLISIS (ANALYZE, LIST, ASK)
    const runner = runModelTaskFn || this.runModelTask.bind(this);
    return runner({
      decision,
      message: text,
      projectRoot,
      apiBaseUrl,
      apiKey,
      model,
      memory,
      onProgress,
      allowWrite: false,
      maxSteps: 16
    });
  }

  async runModelTask(params) {
    return {
      kind: "EXECUTION_STARTED",
      params
    };
  }
}

module.exports = { Orchestrator };