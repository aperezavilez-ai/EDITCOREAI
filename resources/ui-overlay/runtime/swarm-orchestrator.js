/**
 * runtime/swarm-orchestrator.js
 * EditCoreAI - Orquestador de Enjambres Multi-Agente (Swarm Orchestration) (Ciclo 37)
 */

const { crdtEngine } = require("./crdt-sync");

const SPECIALIZED_AGENT_ROLES = {
  DatabaseAgent: {
    name: "DatabaseAgent",
    expertise: "Esquemas SQL/NoSQL, migraciones, optimización de consultas e índices",
    priority: 1,
  },
  UIFrontendAgent: {
    name: "UIFrontendAgent",
    expertise: "Componentes DOM, Monaco UI, estilos CSS, accesibilidad y eventos",
    priority: 2,
  },
  SecurityAgent: {
    name: "SecurityAgent",
    expertise: "Auditoría de vulnerabilidades, RBAC, sanitización de inputs y criptografía",
    priority: 3,
  },
  ArchitectAgent: {
    name: "ArchitectAgent",
    expertise: "Diseño modular, separación de capas, interfaces y patrones de arquitectura",
    priority: 4,
  },
};

class SwarmOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.swarms = new Map(); // swarmId -> SwarmState
  }

  /**
   * Lanza un enjambre de subagentes especializados coordinados
   */
  spawnSwarm({ goal = "", agentRoles = ["DatabaseAgent", "UIFrontendAgent", "SecurityAgent"], projectRoot = "" } = {}) {
    const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const agents = (agentRoles || []).map((roleName) => {
      const spec = SPECIALIZED_AGENT_ROLES[roleName] || {
        name: roleName,
        expertise: "Especialista general de código",
        priority: 5,
      };

      const agentId = `agent_${roleName.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`;
      return {
        agentId,
        role: spec.name,
        expertise: spec.expertise,
        status: "RUNNING",
        progress: 0,
        result: null,
        logs: [`[${spec.name}] Inicializado para objetivo: ${goal}`],
      };
    });

    const swarmState = {
      swarmId,
      goal,
      projectRoot,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      agents,
      mergedWorkspaceState: null,
    };

    this.swarms.set(swarmId, swarmState);

    // Simular resolución asíncrona de agentes con CRDT sync
    this._executeSwarmAgents(swarmId);

    return swarmState;
  }

  /**
   * Obtiene el estado actual del enjambre
   */
  getSwarmStatus(swarmId) {
    if (!swarmId) return null;
    return this.swarms.get(swarmId) || null;
  }

  /**
   * Lista todos los enjambres registrados
   */
  listSwarms() {
    return Array.from(this.swarms.values());
  }

  /**
   * Cancela la ejecución de un enjambre
   */
  cancelSwarm(swarmId) {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return false;

    swarm.status = "CANCELLED";
    for (const agent of swarm.agents) {
      if (agent.status === "RUNNING") {
        agent.status = "CANCELLED";
        agent.logs.push(`[${agent.role}] Cancelado por el orquestador.`);
      }
    }
    return true;
  }

  /**
   * Consolida y fusiona los resultados de todos los agentes del enjambre mediante CRDT
   */
  aggregateSwarmResults(swarmId) {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return null;

    const completed = swarm.agents.filter((a) => a.status === "COMPLETED");
    const summary = completed.map((a) => `• [${a.role}]: ${a.result?.summary || 'Tarea completada'}`).join("\n");

    const sharedDoc = crdtEngine.getOrCreateDocument(`swarm_shared_${swarmId}`, `## Resultado del Enjambre: ${swarm.goal}\n\n`);

    for (const agent of completed) {
      if (agent.result?.patch) {
        sharedDoc.insertText(sharedDoc.getText().length, `\n// --- Parche de ${agent.role} ---\n${agent.result.patch}\n`);
      }
    }

    swarm.mergedWorkspaceState = sharedDoc.getText();
    return {
      swarmId,
      status: swarm.status,
      completedAgents: completed.length,
      totalAgents: swarm.agents.length,
      summary,
      mergedDocument: swarm.mergedWorkspaceState,
    };
  }

  /**
   * Ejecución interna determinista para simulación de agentes
   */
  _executeSwarmAgents(swarmId) {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    for (const agent of swarm.agents) {
      agent.status = "COMPLETED";
      agent.progress = 100;
      agent.result = {
        summary: `Subtarea completada exitosamente según peritaje en ${agent.expertise}.`,
        patch: `// ${agent.role} verified changes for: ${swarm.goal}`,
      };
      agent.logs.push(`[${agent.role}] Finalizado con éxito.`);
    }

    swarm.status = "COMPLETED";
    this.aggregateSwarmResults(swarmId);
  }
}

const swarmOrchestratorInstance = new SwarmOrchestrator();

module.exports = {
  SwarmOrchestrator,
  swarmOrchestrator: swarmOrchestratorInstance,
  SPECIALIZED_AGENT_ROLES,
};
