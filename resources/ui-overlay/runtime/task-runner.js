"use strict";

/**
 * Runner de tareas desacoplado para EditCore.
 * Ejecuta el bucle de razonamiento y llamadas a herramientas (tools/LLM)
 * sin depender directamente del orquestador principal.
 */
async function runModelTask(opts) {
  const {
    decision,
    message,
    projectRoot,
    apiBaseUrl,
    apiKey,
    model,
    memory,
    onProgress,
    allowWrite,
    maxSteps,
    helpers,
    chatOnly,
    authorizedFromPending,
    orchestratorInstance,
  } = opts;

  if (orchestratorInstance && typeof orchestratorInstance.runModelTask === "function") {
    return orchestratorInstance.runModelTask(opts);
  }

  throw new Error(
    "task-runner: No se proporcionó una instancia de orquestador o función de ejecución válida."
  );
}

module.exports = { runModelTask };