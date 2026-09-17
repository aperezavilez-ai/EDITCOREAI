"use strict";

const EventEmitter = require("events");
const path = require("path");

const SWARM_ROLES = {
  UI_ENGINEER: {
    id: "ui_engineer",
    name: "UI Specialist",
    icon: "palette",
    description: "Diseña componentes interactivos, CSS/Tailwind y vistas frontend",
    filePatterns: [/\.(tsx|jsx|vue|svelte|css|scss|html)$/i],
  },
  BACKEND_ENGINEER: {
    id: "backend_engineer",
    name: "Backend Specialist",
    icon: "database",
    description: "Desarrolla endpoints de API, lógica de servidor, autenticación y base de datos",
    filePatterns: [/\.(ts|js|py|go|rs|php|sql)$/i, /(api|routes|controllers|services|db)/i],
  },
  QA_ENGINEER: {
    id: "qa_engineer",
    name: "QA & Test Specialist",
    icon: "shield-check",
    description: "Crea y ejecuta suites de pruebas unitarias, mocking y cobertura",
    filePatterns: [/\.(test|spec)\.(ts|js|py)$/i, /(tests|__tests__|mocks)/i],
  },
};

class SwarmOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.activeSwarmSessions = new Map();
  }

  /**
   * Desglosa un requerimiento complejo y crea un enjambre de subagentes paralelos
   */
  createSwarmPlan(goal = "", subtasks = []) {
    const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const formattedAgents = subtasks.map((task, idx) => {
      const roleId = task.role || (idx === 0 ? "ui_engineer" : idx === 1 ? "backend_engineer" : "qa_engineer");
      const roleDef = SWARM_ROLES[roleId.toUpperCase()] || SWARM_ROLES.UI_ENGINEER;

      return {
        id: `agent_${idx + 1}_${roleDef.id}`,
        role: roleDef.id,
        roleName: roleDef.name,
        task: typeof task === "string" ? task : task.task || `Subtarea ${idx + 1}`,
        targetFiles: Array.isArray(task.targetFiles) ? task.targetFiles : [],
        status: "queued", // queued | running | completed | failed
        result: null,
        logs: [],
      };
    });

    const session = {
      id: swarmId,
      goal,
      status: "ready", // ready | running | merging | completed | conflict
      createdAt: Date.now(),
      agents: formattedAgents,
      mutations: new Map(), // filePath -> { agentId, proposedContent }
    };

    this.activeSwarmSessions.set(swarmId, session);
    return session;
  }

  /**
   * Ejecuta el enjambre de subagentes en paralelo
   */
  async executeSwarm(swarmId, executorFn) {
    const session = this.activeSwarmSessions.get(swarmId);
    if (!session) throw new Error(`Sesión Swarm no encontrada: ${swarmId}`);

    session.status = "running";
    this.emit("swarm-started", { swarmId, agentsCount: session.agents.length });

    // Ejecución paralela
    const agentPromises = session.agents.map(async (agent) => {
      agent.status = "running";
      this.emit("agent-status", { swarmId, agentId: agent.id, status: "running" });

      try {
        let result;
        if (typeof executorFn === "function") {
          result = await executorFn(agent);
        } else {
          result = {
            ok: true,
            summary: `Completado por ${agent.roleName}`,
            generatedFiles: agent.targetFiles,
          };
        }

        agent.status = "completed";
        agent.result = result;
        this.emit("agent-status", { swarmId, agentId: agent.id, status: "completed", result });
        return { ok: true, agentId: agent.id, result };
      } catch (err) {
        agent.status = "failed";
        agent.result = { ok: false, error: err.message };
        this.emit("agent-status", { swarmId, agentId: agent.id, status: "failed", error: err.message });
        return { ok: false, agentId: agent.id, error: err.message };
      }
    });

    const results = await Promise.all(agentPromises);
    const hasFailures = results.some((r) => !r.ok);

    session.status = hasFailures ? "partial_failure" : "completed";
    this.emit("swarm-finished", { swarmId, status: session.status, results });

    return {
      ok: !hasFailures,
      swarmId,
      status: session.status,
      results,
    };
  }

  /**
   * Detecta si múltiples subagentes intentan modificar el mismo archivo simultáneamente
   */
  detectFileCollisions(session) {
    const fileToAgents = new Map();
    const collisions = [];

    for (const agent of session.agents) {
      for (const file of agent.targetFiles) {
        const cleanPath = file.replace(/\\/g, "/");
        if (!fileToAgents.has(cleanPath)) {
          fileToAgents.set(cleanPath, []);
        }
        fileToAgents.get(cleanPath).push(agent.id);
      }
    }

    for (const [filePath, agents] of fileToAgents.entries()) {
      if (agents.length > 1) {
        collisions.push({ filePath, agents });
      }
    }

    return {
      hasCollisions: collisions.length > 0,
      collisions,
    };
  }
}

module.exports = {
  SwarmOrchestrator,
  SWARM_ROLES,
};
