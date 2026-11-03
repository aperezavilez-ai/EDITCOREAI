"use strict";

/**
 * EDITCORE BRAIN - Dynamic Agent Coordinator
 * 
 * Gestiona el ciclo de vida de los agentes especialistas bajo demanda:
 * - Determina qué rol se necesita según la complejidad de la tarea.
 * - Evita invocar agentes innecesarios para tareas directas.
 * - Garantiza que un solo agente mantenga el foco de escritura a la vez.
 */

const { AgentRole } = require("./types");

class DynamicAgentCoordinator {
  constructor() {
    this.activeAgents = new Map();
  }

  /**
   * Analiza la tarea para seleccionar el rol más eficiente.
   * @param {string} prompt
   * @returns {string} AgentRole
   */
  determineRequiredRole(prompt = "") {
    const text = String(prompt || "").toLowerCase();

    if (/\b(?:error|bug|stacktrace|falla|crash|roto|exception|traceback|undefined|nullpointer)\b/i.test(text)) {
      return AgentRole.DEBUGGER;
    }
    if (/\b(?:test|prueba|unit test|e2e|coverage|verificar|validar|qa)\b/i.test(text)) {
      return AgentRole.QA_VERIFIER;
    }
    if (/\b(?:tabla|esquema|database|sql|postgres|supabase|migraci[oó]n|columna|query)\b/i.test(text)) {
      return AgentRole.DATABASE;
    }
    if (/\b(?:css|diseño|ui|componente|estilo|bot[oó]n|layout|tailwind|html|responsive)\b/i.test(text)) {
      return AgentRole.FRONTEND;
    }
    if (/\b(?:api|endpoint|backend|servidor|express|ruta|middleware|controlador)\b/i.test(text)) {
      return AgentRole.BACKEND;
    }
    if (/\b(?:donde|qu[eé]\s+archivo|busca|investiga|explora|analiza\s+el\s+proyecto)\b/i.test(text)) {
      return AgentRole.INSPECTOR;
    }

    // Por defecto para tareas directas de codificación
    return AgentRole.DEVELOPER;
  }

  /**
   * Genera las directivas especializadas para el rol activo.
   * @param {string} role 
   * @returns {string}
   */
  getSpecialistDirectives(role) {
    switch (role) {
      case AgentRole.DEBUGGER:
        return `[ROL ACTIVO: DEBUGGER ESPECIALISTA]
- Tu prioridad absoluta es aislar la causa raíz del error o stacktrace.
- Lee los archivos donde se origina la falla antes de proponer cambios.
- No realices cambios cosméticos ni refactorizaciones no solicitadas; arregla el bug puntual.`;

      case AgentRole.QA_VERIFIER:
        return `[ROL ACTIVO: QA & VERIFIER]
- Diseña o ejecuta pruebas automáticas y comandos de verificación.
- Si las pruebas fallan, reporta con precisión qué aserción no pasó.
- No des por terminada una tarea sin evidencia empírica de éxito.`;

      case AgentRole.DATABASE:
        return `[ROL ACTIVO: DATABASE SPECIALIST]
- Diseña esquemas relacionales limpios, asegurando claves primarias, índices y restricciones de integridad.
- Aplica migraciones incrementales y consistentes.`;

      case AgentRole.FRONTEND:
        return `[ROL ACTIVO: FRONTEND & UI ENGINEER]
- Construye interfaces atractivas, funcionales, accesibles y consistentes.
- Respeta la paleta y componentes existentes en el repositorio.`;

      case AgentRole.INSPECTOR:
        return `[ROL ACTIVO: INSPECTOR & ANALYST]
- Tu misión es inspeccionar y orientar. No modifiques archivos a menos que se te indique explícitamente.`;

      default:
        return `[ROL ACTIVO: SOFTWARE ENGINEER]
- Implementa la solución de forma limpia, modular y quirúrgica.`;
    }
  }
}

module.exports = {
  DynamicAgentCoordinator,
};
