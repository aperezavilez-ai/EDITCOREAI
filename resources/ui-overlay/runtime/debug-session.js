const { EventEmitter } = require("node:events");
const { DebugAdapterClient } = require("./debug-adapter-client");

class DebugSession extends EventEmitter {
  constructor(client, sessionId) {
    super();
    this.client = client;
    this.sessionId = sessionId;
    this.breakpoints = new Map();
    this.variables = new Map();
    this.callFrames = [];
    this.watchExpressions = new Map();
    this.currentThreadId = 1;
    this.currentFrameId = null;
    this.isStepping = false;

    this._bindClientEvents();
  }

  _bindClientEvents() {
    this.client.on("session:stopped", ({ sessionId, reason, threadId }) => {
      if (sessionId !== this.sessionId) return;
      this.currentThreadId = threadId || this.currentThreadId;
      this.emit("stopped", { reason: reason || "pause", threadId: this.currentThreadId });
    });

    this.client.on("adapter:output", ({ sessionId, category, output }) => {
      if (sessionId !== this.sessionId) return;
      this.emit("output", { category, output });
    });

    this.client.on("adapter:breakpoint", ({ sessionId, breakpoint }) => {
      if (sessionId !== this.sessionId) return;
      this.emit("breakpoint:changed", breakpoint);
    });

    this.client.on("adapter:response", ({ sessionId, command, body }) => {
      if (sessionId !== this.sessionId) return;
      this._handleResponse(command, body);
    });
  }

  _handleResponse(command, body) {
    switch (command) {
      case "stackTrace":
        this.callFrames = body.stackFrames || [];
        this.emit("callStack:updated", this.callFrames);
        break;
      case "scopes":
        this._handleScopesResponse(body);
        break;
      case "variables":
        this._handleVariablesResponse(body);
        break;
      case "evaluate":
        this.emit("evaluate:result", body.result || body.body?.result);
        break;
      default:
        break;
    }
  }

  _handleScopesResponse(body) {
    const scopes = body.scopes || [];
    for (const scope of scopes) {
      if (scope.variablesReference > 0) {
        this.client.getVariables(this.sessionId, scope.variablesReference).then((res) => {
          this.variables.set(scope.name, res.body?.variables || []);
          this.emit("variables:updated", { scope: scope.name, variables: this.variables.get(scope.name) });
        });
      }
    }
  }

  _handleVariablesResponse(body) {
    const variables = body.variables || [];
    this.emit("variables:updated", { scope: "locals", variables });
  }

  async setBreakpoint(sourcePath, line, column = 0, condition = null) {
    const key = `${sourcePath}:${line}`;
    const breakpoint = { id: key, sourcePath, line, column, condition, verified: false };
    this.breakpoints.set(key, breakpoint);

    const result = await this.client.setBreakpoints(this.sessionId, sourcePath, [{ line, column, condition }]);
    breakpoint.verified = true;
    this.emit("breakpoint:added", breakpoint);
    return breakpoint;
  }

  async removeBreakpoint(sourcePath, line) {
    const key = `${sourcePath}:${line}`;
    const breakpoint = this.breakpoints.get(key);
    if (!breakpoint) return null;

    this.breakpoints.delete(key);
    await this.client.setBreakpoints(this.sessionId, sourcePath, []);
    this.emit("breakpoint:removed", breakpoint);
    return breakpoint;
  }

  async getCallStack() {
    const response = await this.client.getCallStack(this.sessionId, this.currentThreadId);
    this.callFrames = response.body?.stackFrames || [];
    this.emit("callStack:updated", this.callFrames);
    return this.callFrames;
  }

  async getScopes(frameId) {
    const response = await this.client.getScopes(this.sessionId, frameId);
    const scopes = response.body?.scopes || [];
    for (const scope of scopes) {
      if (scope.variablesReference > 0) {
        const variablesResponse = await this.client.getVariables(this.sessionId, scope.variablesReference);
        this.variables.set(scope.name, variablesResponse.body?.variables || []);
      }
    }
    return scopes;
  }

  async getVariables(scopeName = "locals") {
    return this.variables.get(scopeName) || [];
  }

  async evaluateExpression(expression, frameId = null) {
    const response = await this.client.evaluate(this.sessionId, expression, frameId);
    const result = response.body?.result || response.body?.body?.result;
    this.emit("evaluate:result", result);
    return result;
  }

  async continue() {
    this.isStepping = false;
    await this.client.continue_(this.sessionId, this.currentThreadId);
    this.emit("continued");
  }

  async stepOver() {
    this.isStepping = true;
    await this.client.next(this.sessionId, this.currentThreadId);
    this.emit("stepped", { type: "over" });
  }

  async stepInto() {
    this.isStepping = true;
    await this.client.stepIn(this.sessionId, this.currentThreadId);
    this.emit("stepped", { type: "into" });
  }

  async stepOut() {
    this.isStepping = true;
    await this.client.stepOut(this.sessionId, this.currentThreadId);
    this.emit("stepped", { type: "out" });
  }

  async pause() {
    await this.client.pause(this.sessionId, this.currentThreadId);
    this.emit("paused");
  }

  async stop() {
    await this.client.stop(this.sessionId);
    this.breakpoints.clear();
    this.variables.clear();
    this.callFrames = [];
    this.watchExpressions.clear();
    this.emit("stopped", { reason: "exit" });
  }

  addWatchExpression(id, expression) {
    this.watchExpressions.set(id, expression);
    this.emit("watch:added", { id, expression });
    return id;
  }

  removeWatchExpression(id) {
    const expression = this.watchExpressions.get(id);
    this.watchExpressions.delete(id);
    this.emit("watch:removed", { id });
    return expression;
  }

  getBreakpoints() {
    return Array.from(this.breakpoints.values());
  }

  getWatchExpressions() {
    return Array.from(this.watchExpressions.entries()).map(([id, expression]) => ({ id, expression }));
  }
}

module.exports = { DebugSession };
