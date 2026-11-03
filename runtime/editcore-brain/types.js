"use strict";

/**
 * EDITCORE BRAIN - Core Types and Enumerations
 * 
 * Contratos fundamentales del cerebro de EditCoreAI.
 */

const BrainState = {
  IDLE: "IDLE",
  ANALYZING: "ANALYZING",
  PLANNING: "PLANNING",
  THINKING: "THINKING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  DONE: "DONE",
  ERROR: "ERROR",
};

const AgentRole = {
  DIRECTOR: "director",       // Coordinador maestro de la tarea
  DEVELOPER: "developer",     // Implementador de código general
  FRONTEND: "frontend",       // Especialista UI/UX, React, Monaco, CSS
  BACKEND: "backend",         // APIs, Node.js, lógica de negocio
  DATABASE: "database",       // Postgres, schemas, consultas
  DEBUGGER: "debugger",       // Análisis de stacktraces y fallos
  QA_VERIFIER: "qa_verifier", // Ejecutor de pruebas y validaciones
  INSPECTOR: "inspector",     // Exploración y mapeo de dependencias
};

const PermissionMode = {
  STEP: "step",       // Requiere aprobación explícita en la UI para mutaciones
  FULL: "full",       // Ejecución autónoma continua dentro del proyecto
  READONLY: "readonly"// Solo lectura, bloquea escrituras y comandos de cambio
};

module.exports = {
  BrainState,
  AgentRole,
  PermissionMode,
};
