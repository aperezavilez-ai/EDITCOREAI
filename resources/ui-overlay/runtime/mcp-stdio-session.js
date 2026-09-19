"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ALLOWED_COMMANDS = new Set([
  "node", "npx", "npm",
  "node.exe", "npx.cmd", "npm.cmd", "npx.exe", "npm.exe",
]);

function isSafeCommand(command, projectRoot) {
  const raw = String(command || "").trim();
  if (!raw) return false;
  const base = path.basename(raw).toLowerCase();
  if (ALLOWED_COMMANDS.has(base)) return true;
  // Permitir el node actual del proceso EDITCOREAI (tests y servidores locales).
  try {
    if (path.resolve(raw) === path.resolve(process.execPath)) return true;
  } catch {}
  if (!path.isAbsolute(raw)) return false;
  const root = path.resolve(String(projectRoot || ""));
  const resolved = path.resolve(raw);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    return fs.existsSync(resolved);
  }
  return false;
}

function encodeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
}

class McpStdioSession {
  constructor(serverConfig, projectRoot) {
    this.serverConfig = serverConfig;
    this.projectRoot = projectRoot;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.toolsCache = null;
  }

  start() {
    if (this.child) return;
    const command = String(this.serverConfig.command || "").trim();
    if (!isSafeCommand(command, this.projectRoot)) {
      throw new Error(`Comando MCP no permitido: ${command}. Usa node/npx/npm o un binario dentro del proyecto.`);
    }
    const args = Array.isArray(this.serverConfig.args) ? this.serverConfig.args.map(String) : [];
    const cwd = this.serverConfig.cwd
      ? path.resolve(this.projectRoot, String(this.serverConfig.cwd))
      : this.projectRoot;
    if (!cwd.startsWith(path.resolve(this.projectRoot))) {
      throw new Error("cwd MCP fuera del proyecto.");
    }
    const env = { ...process.env };
    if (this.serverConfig.env && typeof this.serverConfig.env === "object") {
      for (const [key, value] of Object.entries(this.serverConfig.env)) {
        if (!/^[A-Z][A-Z0-9_]*$/i.test(key)) continue;
        env[key] = String(value);
      }
    }
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stderr.on("data", () => {});
    this.child.on("exit", () => {
      this.child = null;
      this.initialized = false;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Proceso MCP terminado."));
      }
      this.pending.clear();
    });
  }

  stop() {
    try { this.child?.kill(); } catch {}
    this.child = null;
    this.initialized = false;
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer.slice(headerEnd + 4, total).toString("utf8");
      this.buffer = this.buffer.slice(total);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id != null && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    }
  }

  request(method, params = {}, timeoutMs = 20_000) {
    this.start();
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout MCP ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(encodeMessage(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.start();
    const payload = { jsonrpc: "2.0", method, params };
    this.child.stdin.write(encodeMessage(payload));
  }

  async ensureInitialized() {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "editcoreai", version: "2.2.9" },
    });
    this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async listTools() {
    await this.ensureInitialized();
    if (this.toolsCache) return this.toolsCache;
    const result = await this.request("tools/list", {});
    this.toolsCache = Array.isArray(result?.tools) ? result.tools : [];
    return this.toolsCache;
  }

  async callTool(name, args = {}) {
    await this.ensureInitialized();
    return this.request("tools/call", {
      name: String(name || ""),
      arguments: args && typeof args === "object" ? args : {},
    }, 60_000);
  }
}

const sessions = new Map();

function sessionKey(projectRoot, serverId) {
  return `${path.resolve(String(projectRoot || ""))}::${serverId}`;
}

function getSession(projectRoot, serverConfig) {
  const key = sessionKey(projectRoot, serverConfig.id);
  if (!sessions.has(key)) {
    sessions.set(key, new McpStdioSession(serverConfig, path.resolve(String(projectRoot || ""))));
  }
  return sessions.get(key);
}

function closeSessionsForProject(projectRoot) {
  const prefix = `${path.resolve(String(projectRoot || ""))}::`;
  for (const [key, session] of sessions.entries()) {
    if (!key.startsWith(prefix)) continue;
    session.stop();
    sessions.delete(key);
  }
}

module.exports = {
  McpStdioSession,
  getSession,
  closeSessionsForProject,
  isSafeCommand,
  encodeMessage,
};
