"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");

class MCPClientManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.servers = new Map(); // serverName -> { config, process, tools, resources, status }
  }

  /**
   * Carga la configuración de servidores MCP desde el proyecto o configuración global
   */
  loadConfiguration() {
    const candidateFiles = [
      path.join(this.projectRoot, ".editcore", "mcp.json"),
      path.join(this.projectRoot, "editcore.mcp.json"),
      path.join(this.projectRoot, ".cursor", "mcp.json"),
      path.join(this.projectRoot, "mcp.json"),
    ];

    for (const filePath of candidateFiles) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(content);
          const mcpServers = parsed.mcpServers || parsed.servers || parsed;
          this.registerServersFromConfig(mcpServers);
          return { ok: true, source: filePath, count: this.servers.size };
        } catch (err) {
          return { ok: false, error: `Error al parsear ${filePath}: ${err.message}` };
        }
      }
    }

    return { ok: true, source: null, count: 0 };
  }

  /**
   * Registra un mapa de configuraciones de servidores MCP
   */
  registerServersFromConfig(serversConfig = {}) {
    for (const [name, cfg] of Object.entries(serversConfig)) {
      if (!cfg || typeof cfg !== "object") continue;
      this.servers.set(name, {
        name,
        command: cfg.command || "npx",
        args: Array.isArray(cfg.args) ? cfg.args : [],
        env: { ...process.env, ...(cfg.env || {}) },
        status: "configured", // configured | connected | stopped | error
        tools: Array.isArray(cfg.tools) ? cfg.tools : [],
        resources: Array.isArray(cfg.resources) ? cfg.resources : [],
      });
    }
  }

  /**
   * Registra manualmente un servidor MCP (ej. Postgres, GitHub, Supabase)
   */
  registerServer(name, config) {
    this.servers.set(name, {
      name,
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) },
      status: "configured",
      tools: config.tools || [],
      resources: config.resources || [],
    });
    return this.servers.get(name);
  }

  /**
   * Lista todas las herramientas registradas en los servidores MCP activos
   */
  listTools() {
    const allTools = [];
    for (const [serverName, server] of this.servers.entries()) {
      for (const tool of server.tools) {
        allTools.push({
          server: serverName,
          name: tool.name || tool,
          description: tool.description || `Herramienta provista por el servidor MCP ${serverName}`,
          inputSchema: tool.inputSchema || tool.parameters || {},
        });
      }
    }
    return allTools;
  }

  /**
   * Invoca una herramienta MCP
   */
  async invokeTool(serverName, toolName, params = {}) {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Servidor MCP no encontrado: ${serverName}`);
    }

    // Retorno estándar simulado/resuelto para herramientas locales / integradas
    return {
      ok: true,
      server: serverName,
      tool: toolName,
      result: {
        status: "success",
        executedAt: new Date().toISOString(),
        params,
      },
    };
  }

  getServerStatus(name) {
    return this.servers.get(name) || null;
  }

  listServers() {
    return Array.from(this.servers.values()).map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      status: s.status,
      toolsCount: s.tools.length,
    }));
  }
}

module.exports = {
  MCPClientManager,
};
