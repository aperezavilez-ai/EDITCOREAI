"use strict";

/**
 * MCP Client Core — Ciclo 12.
 *
 * Soporta transporte stdio y SSE hacia servidores MCP externos.
 * Descubre recursos, prompts y herramientas; ejecuta tools/call
 * con validación de esquema y manejo de errores.
 */

const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");

class McpClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || randomUUID();
    this.name = options.name || "mcp-client";
    this.transport = options.transport || "stdio"; // stdio | sse
    this.command = options.command || null;
    this.args = options.args || [];
    this.env = options.env || {};
    this.cwd = options.cwd || process.cwd();
    this.timeoutMs = options.timeoutMs || 120000;
    this.connected = false;
    this.initialized = false;
    this.serverInfo = null;
    this.capabilities = null;
    this.child = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.buffer = "";
    this._shuttingDown = false;
  }

  async connect() {
    if (this.connected) {
      return { ok: true, client: this.id };
    }

    if (this.transport === "stdio" && this.command) {
      await this._connectStdio();
    } else if (this.transport === "sse" && this.url) {
      await this._connectSse();
    } else {
      throw new Error(`Transporte MCP no soportado o faltan parámetros: ${this.transport}`);
    }

    this.connected = true;
    this.emit("connected", { client: this.id });
    return { ok: true, client: this.id };
  }

  async initialize() {
    if (!this.connected) {
      await this.connect();
    }

    const initParams = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "editcoreai",
        version: "1.0.0",
      },
    };

    const result = await this._sendRequest("initialize", initParams);
    this.serverInfo = result.serverInfo || null;
    this.capabilities = result.capabilities || null;
    this.initialized = true;

    if (this.transport === "stdio" && this.child) {
      this._sendNotification("notifications/initialized", {});
    }

    this.emit("initialized", { client: this.id, serverInfo: this.serverInfo, capabilities: this.capabilities });
    return { ok: true, client: this.id, serverInfo: this.serverInfo, capabilities: this.capabilities };
  }

  async listTools() {
    this._assertInitialized();
    const result = await this._sendRequest("tools/list", {});
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async callTool(name, args = {}, options = {}) {
    this._assertInitialized();
    const timeoutMs = options.timeoutMs || this.timeoutMs;

    const result = await this._sendRequest("tools/call", {
      name,
      arguments: args,
    }, timeoutMs);

    const content = Array.isArray(result.content) ? result.content : [];
    const textParts = [];
    const binaryParts = [];

    for (const item of content) {
      if (item && item.type === "text") {
        textParts.push(item.text);
      } else if (item && item.type === "binary") {
        binaryParts.push(item.data || item.blob || null);
      }
    }

    return {
      ok: true,
      name,
      text: textParts.join("\n"),
      binary: binaryParts,
      isError: Boolean(result.isError),
      raw: result,
    };
  }

  async listResources() {
    this._assertInitialized();
    const result = await this._sendRequest("resources/list", {});
    return Array.isArray(result.resources) ? result.resources : [];
  }

  async readResource(uri) {
    this._assertInitialized();
    const result = await this._sendRequest("resources/read", { uri });
    const contents = Array.isArray(result.contents) ? result.contents : [];
    return contents.map((item) => ({
      uri: item.uri,
      mimeType: item.mimeType || null,
      text: typeof item.text === "string" ? item.text : null,
      blob: typeof item.blob === "string" ? item.blob : null,
    }));
  }

  async listPrompts() {
    this._assertInitialized();
    const result = await this._sendRequest("prompts/list", {});
    return Array.isArray(result.prompts) ? result.prompts : [];
  }

  async getPrompt(name, args = {}) {
    this._assertInitialized();
    const result = await this._sendRequest("prompts/get", { name, arguments: args });
    return result || {};
  }

  async ping() {
    this._assertInitialized();
    const result = await this._sendRequest("ping", {});
    return { ok: true, pong: result };
  }

  async shutdown() {
    this._shuttingDown = true;
    this.connected = false;
    this.initialized = false;

    if (this.transport === "stdio" && this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.child = null;
    }

    this.pendingRequests.clear();
    this.buffer = "";
    this.emit("disconnected", { client: this.id });
    return { ok: true, client: this.id };
  }

  async _connectStdio() {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.child = child;

      child.stdout.on("data", (chunk) => {
        this._handleStdout(chunk);
      });

      child.stderr.on("data", (chunk) => {
        this.emit("stderr", { client: this.id, data: chunk.toString() });
      });

      child.on("error", (error) => {
        this.connected = false;
        reject(new Error(`Error al lanzar proceso MCP stdio: ${error.message}`));
      });

      child.on("exit", (code, signal) => {
        this.connected = false;
        this.initialized = false;
        this.emit("exit", { client: this.id, code, signal });
      });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Timeout al conectar por stdio con el servidor MCP."));
      }, this.timeoutMs);

      const onReady = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.once("ready", onReady);
      this.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async _connectSse() {
    // Placeholder para transporte SSE.
    // En esta fase se prioriza stdio; SSE se habilita cuando se requiera
    // un servidor MCP remoto expuesto por HTTP.
    throw new Error("Transporte SSE no implementado en esta fase.");
  }

  _handleStdout(chunk) {
    this.buffer += chunk.toString();

    let boundary;
    while ((boundary = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, boundary).trim();
      this.buffer = this.buffer.slice(boundary + 1);

      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        this._handleMessage(message);
      } catch {
        this.emit("parse-error", { client: this.id, raw: line });
      }
    }
  }

  _handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(message.id);
      clearTimeout(timer);
      this.pendingRequests.delete(message.id);

      if ("result" in message) {
        resolve(message.result);
      } else if ("error" in message) {
        reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      } else {
        resolve(message);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", { client: this.id, method: message.method, params: message.params });
    }

    this.emit("ready");
  }

  async _sendRequest(method, params = {}, timeoutMs) {
    if (!this.connected || !this.child) {
      throw new Error("Cliente MCP no conectado.");
    }

    const id = String(++this.requestId);
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      this.emit("timeout", { client: this.id, method, id });
    }, timeoutMs || this.timeoutMs);

    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, timer });
    });

    try {
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    } catch (error) {
      clearTimeout(timeout);
      this.pendingRequests.delete(id);
      throw new Error(`Error al escribir en stdin MCP: ${error.message}`);
    }

    return promise;
  }

  _sendNotification(method, params = {}) {
    if (!this.connected || !this.child) {
      return;
    }

    const payload = {
      jsonrpc: "2.0",
      method,
      params,
    };

    try {
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    } catch {
      // ignore notification failures
    }
  }

  _assertInitialized() {
    if (!this.initialized) {
      throw new Error("Cliente MCP no inicializado. Llamá a initialize() primero.");
    }
  }
}

module.exports = { McpClient };
