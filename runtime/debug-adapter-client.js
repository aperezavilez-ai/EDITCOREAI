const { EventEmitter } = require("node:events");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

class DebugAdapterClient extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.adapters = new Map();
  }

  createSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    const session = {
      id: sessionId,
      type: options.type || "launch",
      name: options.name || `debug-${sessionId}`,
      program: options.program || null,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      runtime: options.runtime || "node",
      runtimeExecutable: options.runtimeExecutable || "node",
      request: options.request || "launch",
      status: "initializing",
      adapterProcess: null,
      socket: null,
      seq: 1,
      breakpoints: new Map(),
      variables: new Map(),
      callFrames: [],
      startedAt: null,
      stoppedAt: null,
    };

    this.sessions.set(sessionId, session);
    this.emit("session:created", { sessionId, session });
    return session;
  }

  async startAdapter(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Debug session ${sessionId} not found`);
    }

    if (session.status === "running") {
      return session;
    }

    session.status = "starting";
    this.emit("session:starting", { sessionId });

    try {
      await this._connectToAdapter(session);
      session.status = "running";
      session.startedAt = Date.now();
      this.emit("session:started", { sessionId, session });
      return session;
    } catch (error) {
      session.status = "error";
      this.emit("session:error", { sessionId, error: error.message });
      throw error;
    }
  }

  async _connectToAdapter(session) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let buffer = "";

      socket.connect(4711, "127.0.0.1", () => {
        session.socket = socket;
        socket.write(JSON.stringify({ seq: session.seq++, type: "initialize", command: "initialize", arguments: { adapterID: "editcore-dap", pathFormat: "path", linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsVariablePaging: true, supportsRunInTerminalRequest: true } }) + "\r\n");
        resolve();
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\r\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            this._handleAdapterMessage(session, message);
          } catch {
            // ignore malformed frames
          }
        }
      });

      socket.on("error", (error) => reject(error));
      socket.on("close", () => {
        session.status = "stopped";
        this.emit("session:stopped", { sessionId: session.id });
      });
    });
  }

  _handleAdapterMessage(session, message) {
    if (message.type === "event") {
      this._handleEvent(session, message);
    } else if (message.type === "response") {
      this._handleResponse(session, message);
    }
  }

  _handleEvent(session, message) {
    switch (message.event) {
      case "initialized":
        this.emit("adapter:initialized", { sessionId: session.id });
        break;
      case "stopped":
        session.status = "stopped";
        session.stoppedAt = Date.now();
        this.emit("session:stopped", { sessionId: session.id, reason: message.body.reason, threadId: message.body.threadId });
        break;
      case "output":
        this.emit("adapter:output", { sessionId: session.id, category: message.body.category, output: message.body.output });
        break;
      case "breakpoint":
        this.emit("adapter:breakpoint", { sessionId: session.id, breakpoint: message.body.breakpoint });
        break;
      default:
        this.emit("adapter:event", { sessionId: session.id, event: message });
    }
  }

  _handleResponse(session, message) {
    if (message.success) {
      this.emit("adapter:response", { sessionId: session.id, command: message.command, body: message.body });
    } else {
      this.emit("adapter:error", { sessionId: session.id, command: message.command, message: message.message });
    }
  }

  async send(sessionId, command, arguments_) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.socket) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    const message = {
      seq: session.seq++,
      type: "request",
      command,
      arguments: arguments_ || {},
    };

    session.socket.write(JSON.stringify(message) + "\r\n");
    return message;
  }

  async setBreakpoints(sessionId, sourcePath, breakpoints = []) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const bpMap = new Map();
    for (const bp of breakpoints) {
      bpMap.set(`${sourcePath}:${bp.line}`, { ...bp, verified: false });
    }
    session.breakpoints.set(sourcePath, bpMap);

    await this.send(sessionId, "setBreakpoints", {
      source: { path: sourcePath },
      breakpoints: breakpoints.map((bp) => ({ line: bp.line, column: bp.column || 0 })),
    });

    return Array.from(bpMap.values());
  }

  async getCallStack(sessionId, threadId = 1) {
    return this.send(sessionId, "stackTrace", { threadId, startFrame: 0, levels: 50 });
  }

  async getScopes(sessionId, frameId) {
    return this.send(sessionId, "scopes", { frameId });
  }

  async getVariables(sessionId, variablesReference) {
    return this.send(sessionId, "variables", { variablesReference });
  }

  async evaluate(sessionId, expression, frameId = null) {
    return this.send(sessionId, "evaluate", { expression, frameId, context: "watch" });
  }

  async continue_(sessionId, threadId = 1) {
    return this.send(sessionId, "continue", { threadId });
  }

  async next(sessionId, threadId = 1) {
    return this.send(sessionId, "next", { threadId });
  }

  async stepIn(sessionId, threadId = 1) {
    return this.send(sessionId, "stepIn", { threadId });
  }

  async stepOut(sessionId, threadId = 1) {
    return this.send(sessionId, "stepOut", { threadId });
  }

  async pause(sessionId, threadId = 1) {
    return this.send(sessionId, "pause", { threadId });
  }

  async stop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await this.send(sessionId, "disconnect", {});
    } catch {
      // ignore
    }

    if (session.socket) {
      session.socket.end();
      session.socket = null;
    }

    session.status = "stopped";
    session.stoppedAt = Date.now();
    this.emit("session:stopped", { sessionId });
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      name: session.name,
      status: session.status,
      runtime: session.runtime,
      program: session.program,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
    }));
  }
}

module.exports = { DebugAdapterClient };
