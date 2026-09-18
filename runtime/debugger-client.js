"use strict";

const { EventEmitter } = require("node:events");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

/**
 * Cliente para Debug Adapter Protocol (DAP) en EditCoreAI.
 * Gestiona ciclo de vida de sesiones, puntos de interrupción,
 * control de flujo de ejecución e inspección de memoria/stack.
 */
class DebuggerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.sessions = new Map();
    this.seq = 1;
  }

  /**
   * Crea una nueva sesión de depuración.
   */
  createSession(sessionId = null, options = {}) {
    const id = sessionId || randomUUID();
    if (this.sessions.has(id)) {
      return this.sessions.get(id);
    }

    const session = {
      id,
      name: options.name || `debug-${id.slice(0, 8)}`,
      type: options.type || "node",
      request: options.request || "launch",
      program: options.program || null,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      port: options.port || 4711,
      host: options.host || "127.0.0.1",
      status: "initializing", // initializing | running | paused | stopped | error
      seq: 1,
      socket: null,
      breakpoints: new Map(), // sourcePath -> Array of breakpoints
      callFrames: [],
      variables: new Map(), // scopeName -> variables
      scopes: [],
      currentThreadId: 1,
      currentFrameId: 0,
      startedAt: null,
      stoppedAt: null,
      stopReason: null,
      outputLog: [],
      mockMode: options.mockMode ?? (!options.port && !options.connectSocket),
    };

    this.sessions.set(id, session);
    this.emit("session:created", { sessionId: id, session: this._sanitizeSession(session) });
    return session;
  }

  /**
   * Inicia la sesión de depuración conectando al adaptador DAP o activando mock runner.
   */
  async startSession(sessionId, options = {}) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.createSession(sessionId, options);
    }

    if (session.status === "running" || session.status === "paused") {
      return this._sanitizeSession(session);
    }

    session.status = "starting";
    this.emit("session:starting", { sessionId: session.id });

    if (session.mockMode) {
      session.status = "running";
      session.startedAt = Date.now();
      this.emit("session:started", { sessionId: session.id, session: this._sanitizeSession(session) });
      return this._sanitizeSession(session);
    }

    try {
      await this._connectToAdapter(session);
      session.status = "running";
      session.startedAt = Date.now();
      this.emit("session:started", { sessionId: session.id, session: this._sanitizeSession(session) });
      return this._sanitizeSession(session);
    } catch (error) {
      session.status = "error";
      this.emit("session:error", { sessionId: session.id, error: error.message });
      throw error;
    }
  }

  /**
   * Detiene una sesión activa de depuración.
   */
  async stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Sesión ${sessionId} no encontrada` };
    }

    try {
      if (!session.mockMode && session.socket) {
        await this._send(session, "disconnect", {});
      }
    } catch {
      // Ignorar fallos de desconexión en socket cerrado
    }

    if (session.socket) {
      session.socket.end();
      session.socket = null;
    }

    session.status = "stopped";
    session.stoppedAt = Date.now();
    this.emit("session:stopped", { sessionId: session.id });
    return { ok: true, sessionId: session.id };
  }

  /**
   * Configura puntos de interrupción en un archivo específico.
   */
  async setBreakpoints(sessionId, sourcePath, breakpoints = []) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sesión ${sessionId} no encontrada`);
    }

    const verifiedBreakpoints = breakpoints.map((bp, index) => ({
      id: `${sourcePath}:${bp.line || index + 1}`,
      sourcePath,
      line: Number(bp.line || 1),
      column: Number(bp.column || 0),
      condition: bp.condition || null,
      hitCondition: bp.hitCondition || null,
      verified: true,
    }));

    session.breakpoints.set(sourcePath, verifiedBreakpoints);

    if (!session.mockMode && session.socket) {
      await this._send(session, "setBreakpoints", {
        source: { path: sourcePath },
        breakpoints: verifiedBreakpoints.map((bp) => ({ line: bp.line, column: bp.column })),
      });
    }

    this.emit("breakpoint:changed", {
      sessionId: session.id,
      sourcePath,
      breakpoints: verifiedBreakpoints,
    });

    return verifiedBreakpoints;
  }

  /**
   * Agrega un punto de interrupción individual.
   */
  async addBreakpoint(sessionId, sourcePath, line, column = 0, condition = null) {
    const existing = this.getBreakpoints(sessionId, sourcePath);
    const updated = [...existing.filter((bp) => bp.line !== line), { line, column, condition }];
    const result = await this.setBreakpoints(sessionId, sourcePath, updated);
    return result.find((bp) => bp.line === line) || null;
  }

  /**
   * Elimina un punto de interrupción por línea.
   */
  async removeBreakpoint(sessionId, sourcePath, line) {
    const existing = this.getBreakpoints(sessionId, sourcePath);
    const filtered = existing.filter((bp) => bp.line !== line);
    return this.setBreakpoints(sessionId, sourcePath, filtered);
  }

  /**
   * Obtiene todos los breakpoints configurados para una ruta o sesión.
   */
  getBreakpoints(sessionId, sourcePath = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (sourcePath) {
      return session.breakpoints.get(sourcePath) || [];
    }
    const all = [];
    for (const [path, list] of session.breakpoints.entries()) {
      all.push({ sourcePath: path, breakpoints: list });
    }
    return all;
  }

  /**
   * Reanuda la ejecución del programa.
   */
  async continue(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    session.status = "running";
    session.stopReason = null;

    if (!session.mockMode && session.socket) {
      await this._send(session, "continue", { threadId });
    }

    this.emit("session:continued", { sessionId: session.id, threadId });
    return { ok: true, status: "running" };
  }

  /**
   * Avanza una instrucción sin entrar en funciones (Step Over).
   */
  async stepOver(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    session.status = "paused";
    session.stopReason = "step";

    if (!session.mockMode && session.socket) {
      await this._send(session, "next", { threadId });
    }

    this.emit("session:paused", { sessionId: session.id, reason: "step", threadId });
    return { ok: true, status: "paused", reason: "step" };
  }

  /**
   * Entra en la función de la línea actual (Step Into).
   */
  async stepInto(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    session.status = "paused";
    session.stopReason = "step";

    if (!session.mockMode && session.socket) {
      await this._send(session, "stepIn", { threadId });
    }

    this.emit("session:paused", { sessionId: session.id, reason: "step", threadId });
    return { ok: true, status: "paused", reason: "step" };
  }

  /**
   * Sale de la función actual (Step Out).
   */
  async stepOut(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    session.status = "paused";
    session.stopReason = "step";

    if (!session.mockMode && session.socket) {
      await this._send(session, "stepOut", { threadId });
    }

    this.emit("session:paused", { sessionId: session.id, reason: "step", threadId });
    return { ok: true, status: "paused", reason: "step" };
  }

  /**
   * Pausa la ejecución del programa.
   */
  async pause(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    session.status = "paused";
    session.stopReason = "pause";

    if (!session.mockMode && session.socket) {
      await this._send(session, "pause", { threadId });
    }

    this.emit("session:paused", { sessionId: session.id, reason: "pause", threadId });
    return { ok: true, status: "paused", reason: "pause" };
  }

  /**
   * Reinicia la sesión actual.
   */
  async restart(sessionId) {
    const session = this._requireSession(sessionId);
    await this.stopSession(sessionId);
    return this.startSession(sessionId, {
      name: session.name,
      program: session.program,
      cwd: session.cwd,
      mockMode: session.mockMode,
    });
  }

  /**
   * Obtiene la pila de llamadas (Call Stack).
   */
  async getCallStack(sessionId, threadId = 1) {
    const session = this._requireSession(sessionId);
    if (session.mockMode) {
      const frames = [
        { id: 1, name: "main", line: 12, column: 4, source: { path: session.program || "index.js", name: "index.js" } },
        { id: 2, name: "processTick", line: 45, column: 8, source: { path: "node:internal/process/task_queues", name: "task_queues.js" } },
      ];
      session.callFrames = frames;
      return frames;
    }

    const response = await this._send(session, "stackTrace", { threadId, startFrame: 0, levels: 50 });
    const frames = response.body?.stackFrames || [];
    session.callFrames = frames;
    this.emit("callStack:updated", { sessionId: session.id, frames });
    return frames;
  }

  /**
   * Obtiene las variables locales y de ámbito.
   */
  async getVariables(sessionId, variablesReference = 1) {
    const session = this._requireSession(sessionId);
    if (session.mockMode) {
      return [
        { name: "state", value: '{"status":"active"}', type: "Object", evaluateName: "state" },
        { name: "counter", value: "42", type: "number", evaluateName: "counter" },
        { name: "isReady", value: "true", type: "boolean", evaluateName: "isReady" },
      ];
    }

    const response = await this._send(session, "variables", { variablesReference });
    return response.body?.variables || [];
  }

  /**
   * Evalúa una expresión en el contexto de depuración.
   */
  async evaluate(sessionId, expression, frameId = null, context = "watch") {
    const session = this._requireSession(sessionId);
    if (session.mockMode) {
      return {
        result: `[Evaluated: ${expression}] -> OK`,
        type: "string",
        variablesReference: 0,
      };
    }

    const response = await this._send(session, "evaluate", { expression, frameId, context });
    return response.body || { result: null };
  }

  /**
   * Obtiene la lista de sesiones activas.
   */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => this._sanitizeSession(s));
  }

  /**
   * Obtiene una sesión por su identificador.
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? this._sanitizeSession(session) : null;
  }

  // --- Helpers Privados ---

  _requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sesión de depuración ${sessionId} no encontrada`);
    }
    return session;
  }

  _sanitizeSession(session) {
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      program: session.program,
      cwd: session.cwd,
      stopReason: session.stopReason,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      mockMode: session.mockMode,
      breakpointsCount: Array.from(session.breakpoints.values()).reduce((acc, bps) => acc + bps.length, 0),
    };
  }

  async _send(session, command, args = {}) {
    if (!session.socket) {
      throw new Error(`Socket no conectado en sesión ${session.id}`);
    }
    const message = {
      seq: session.seq++,
      type: "request",
      command,
      arguments: args,
    };
    session.socket.write(JSON.stringify(message) + "\r\n");
    return message;
  }

  async _connectToAdapter(session) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let buffer = "";

      socket.connect(session.port, session.host, () => {
        session.socket = socket;
        socket.write(
          JSON.stringify({
            seq: session.seq++,
            type: "initialize",
            command: "initialize",
            arguments: {
              adapterID: "editcore-dap",
              pathFormat: "path",
              linesStartAt1: true,
              columnsStartAt1: true,
              supportsVariableType: true,
            },
          }) + "\r\n"
        );
        resolve();
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\r\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this._handleAdapterMessage(session, msg);
          } catch {
            // Ignorar frames incompletos
          }
        }
      });

      socket.on("error", (err) => reject(err));
      socket.on("close", () => {
        session.status = "stopped";
        this.emit("session:stopped", { sessionId: session.id });
      });
    });
  }

  _handleAdapterMessage(session, message) {
    if (message.type === "event") {
      if (message.event === "stopped") {
        session.status = "paused";
        session.stopReason = message.body?.reason || "pause";
        this.emit("session:paused", {
          sessionId: session.id,
          reason: session.stopReason,
          threadId: message.body?.threadId || 1,
        });
      } else if (message.event === "output") {
        const out = message.body?.output || "";
        session.outputLog.push(out);
        this.emit("adapter:output", { sessionId: session.id, category: message.body?.category, output: out });
      }
    }
  }
}

module.exports = {
  DebuggerClient,
};
