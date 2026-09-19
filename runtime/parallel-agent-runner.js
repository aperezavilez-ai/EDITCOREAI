/**
 * runtime/parallel-agent-runner.js
 * EditCoreAI - Gestor de Agentes Paralelos y Aislamiento de Estado (Ciclo 30)
 */

const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const os = require("os");

const AGENT_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

class ParallelAgentRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = Number.isInteger(options.maxConcurrency) ? options.maxConcurrency : 4;
    this.agents = new Map();
    this.activeWorkers = 0;
    this.queue = [];
    this.baseScratchDir = options.baseScratchDir || path.join(os.tmpdir(), "editcore-parallel-agents");

    try {
      if (!fs.existsSync(this.baseScratchDir)) {
        fs.mkdirSync(this.baseScratchDir, { recursive: true });
      }
    } catch {
      // Ignorar fallo si ya existe
    }
  }

  /**
   * Genera un ID único para el agente
   */
  _generateAgentId() {
    return `agent_p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Inicializa el entorno aislado para un agente (scratchpad y contexto)
   */
  _setupAgentWorkspace(agentId) {
    const scratchDir = path.join(this.baseScratchDir, agentId);
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    return scratchDir;
  }

  /**
   * Lanza o encola un nuevo agente paralelo
   * @param {Object} spec - { name, goal, payload, projectRoot, executor }
   * @returns {Object} Agent record
   */
  spawnAgent(spec = {}) {
    const { name = "Parallel Agent", goal = "", payload = {}, projectRoot = "", executor = null } = spec;

    const agentId = this._generateAgentId();
    const scratchDir = this._setupAgentWorkspace(agentId);

    const agentRecord = {
      agentId,
      name,
      goal,
      payload,
      projectRoot,
      status: AGENT_STATUS.PENDING,
      scratchDir,
      contextLog: [
        {
          timestamp: new Date().toISOString(),
          type: "INITIALIZE",
          message: `Agente ${name} inicializado con objetivo: ${goal || "Sin objetivo específico"}`,
        },
      ],
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      executor: typeof executor === "function" ? executor : null,
    };

    this.agents.set(agentId, agentRecord);
    this.queue.push(agentId);

    this.emit("agent:spawned", { agentId, name, status: agentRecord.status });

    this._processQueue();

    return {
      agentId,
      name,
      goal,
      status: agentRecord.status,
      scratchDir,
      createdAt: agentRecord.contextLog[0].timestamp,
    };
  }

  /**
   * Ejecuta múltiples tareas de forma paralela y espera a que todas concluyan
   * @param {Array<Object>} tasks - Lista de especificaciones de agentes
   * @returns {Promise<Array<Object>>} Resultados consolidados
   */
  async runParallel(tasks = []) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return [];
    }

    const agentIds = tasks.map((task) => this.spawnAgent(task).agentId);

    const promises = agentIds.map((agentId) => {
      return new Promise((resolve) => {
        const check = () => {
          const agent = this.agents.get(agentId);
          if (!agent) {
            resolve({ agentId, status: "unknown", error: "Agent not found" });
            return;
          }
          if (
            agent.status === AGENT_STATUS.COMPLETED ||
            agent.status === AGENT_STATUS.FAILED ||
            agent.status === AGENT_STATUS.CANCELLED
          ) {
            resolve({
              agentId,
              name: agent.name,
              status: agent.status,
              result: agent.result,
              error: agent.error,
              contextLog: agent.contextLog,
              scratchDir: agent.scratchDir,
            });
          } else {
            setTimeout(check, 25);
          }
        };
        check();
      });
    });

    return Promise.all(promises);
  }

  /**
   * Procesa la cola respetando la concurrencia máxima
   */
  async _processQueue() {
    while (this.activeWorkers < this.maxConcurrency && this.queue.length > 0) {
      const agentId = this.queue.shift();
      const agent = this.agents.get(agentId);

      if (!agent || agent.status === AGENT_STATUS.CANCELLED) {
        continue;
      }

      this.activeWorkers++;
      this._runAgent(agent).finally(() => {
        this.activeWorkers--;
        this._processQueue();
      });
    }
  }

  /**
   * Ejecuta la lógica del agente en su entorno aislado
   */
  async _runAgent(agent) {
    agent.status = AGENT_STATUS.RUNNING;
    agent.startedAt = new Date().toISOString();
    this._logAgent(agent.agentId, "STARTED", `Ejecución iniciada`);
    this.emit("agent:started", { agentId: agent.agentId, name: agent.name });

    try {
      let result;
      if (agent.executor) {
        result = await agent.executor({
          agentId: agent.agentId,
          scratchDir: agent.scratchDir,
          payload: agent.payload,
          log: (type, msg) => this._logAgent(agent.agentId, type, msg),
        });
      } else {
        // Ejecutor mock/heurístico por defecto
        result = {
          processed: true,
          goal: agent.goal,
          summary: `Subtarea completada satisfactoriamente por ${agent.name}`,
        };
      }

      if (agent.status === AGENT_STATUS.CANCELLED) {
        return;
      }

      agent.status = AGENT_STATUS.COMPLETED;
      agent.result = result;
      agent.finishedAt = new Date().toISOString();
      this._logAgent(agent.agentId, "COMPLETED", `Ejecución finalizada con éxito`);
      this.emit("agent:completed", { agentId: agent.agentId, result });
    } catch (err) {
      if (agent.status === AGENT_STATUS.CANCELLED) {
        return;
      }

      agent.status = AGENT_STATUS.FAILED;
      agent.error = err.message || String(err);
      agent.finishedAt = new Date().toISOString();
      this._logAgent(agent.agentId, "ERROR", `Fallo en la ejecución: ${agent.error}`);
      this.emit("agent:failed", { agentId: agent.agentId, error: agent.error });
    }
  }

  /**
   * Agrega una entrada al registro de contexto del agente
   */
  _logAgent(agentId, type, message) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message,
    };
    agent.contextLog.push(entry);
    this.emit("agent:log", { agentId, entry });
  }

  /**
   * Cancela un agente activo o en cola
   */
  cancelAgent(agentId, reason = "Cancelado por el usuario o sistema") {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    if (
      agent.status === AGENT_STATUS.COMPLETED ||
      agent.status === AGENT_STATUS.FAILED ||
      agent.status === AGENT_STATUS.CANCELLED
    ) {
      return false;
    }

    agent.status = AGENT_STATUS.CANCELLED;
    agent.finishedAt = new Date().toISOString();
    this._logAgent(agentId, "CANCELLED", reason);
    this.emit("agent:cancelled", { agentId, reason });
    return true;
  }

  /**
   * Obtiene la información detallada de un agente
   */
  getAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    return {
      agentId: agent.agentId,
      name: agent.name,
      goal: agent.goal,
      status: agent.status,
      projectRoot: agent.projectRoot,
      scratchDir: agent.scratchDir,
      startedAt: agent.startedAt,
      finishedAt: agent.finishedAt,
      contextLog: [...agent.contextLog],
      result: agent.result,
      error: agent.error,
    };
  }

  /**
   * Lista todos los agentes, opcionalmente filtrados por proyecto o estado
   */
  listAgents(filters = {}) {
    const { projectRoot, status } = filters;
    let list = Array.from(this.agents.values());

    if (projectRoot) {
      list = list.filter((a) => a.projectRoot === projectRoot);
    }
    if (status) {
      list = list.filter((a) => a.status === status);
    }

    return list.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      goal: a.goal,
      status: a.status,
      projectRoot: a.projectRoot,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      logCount: a.contextLog.length,
    }));
  }

  /**
   * Limpia el directorio temporal de un agente y libera recursos
   */
  cleanupAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    try {
      if (fs.existsSync(agent.scratchDir)) {
        fs.rmSync(agent.scratchDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorar errores de borrado de archivos bloqueados
    }

    this.agents.delete(agentId);
    return true;
  }
}

const parallelAgentRunnerInstance = new ParallelAgentRunner();

module.exports = {
  ParallelAgentRunner,
  parallelAgentRunner: parallelAgentRunnerInstance,
  AGENT_STATUS,
};
