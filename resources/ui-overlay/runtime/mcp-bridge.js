"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getSession, closeSessionsForProject, isSafeCommand } = require("./mcp-stdio-session");

/**
 * Resolucion automatica de MCP:
 * 1) Override opcional del proyecto: <project>/.editcore/mcp.json
 * 2) Config global de EditCore: <userData>/mcp.json  (se crea sola)
 * 3) Sin servidores: available=false pero bridge listo (no pide copiar ejemplos)
 *
 * Los procesos MCP solo arrancan al llamar mcp_list_tools / mcp_invoke (lazy).
 */

function defaultGlobalConfig() {
  return {
    enabled: true,
    auto: true,
    servers: [],
    note: "EditCore gestiona MCP en esta config global. Anade servers aqui o en Conexiones. Los procesos solo arrancan cuando el agente necesita una tool MCP.",
  };
}

function ensureGlobalMcpConfig(userDataPath = "") {
  const root = String(userDataPath || "").trim();
  if (!root) return { file: "", config: defaultGlobalConfig(), created: false };
  const file = path.join(root, "mcp.json");
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      return { file, config: raw && typeof raw === "object" ? raw : defaultGlobalConfig(), created: false };
    }
    fs.mkdirSync(root, { recursive: true });
    const config = defaultGlobalConfig();
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return { file, config, created: true };
  } catch {
    return { file, config: defaultGlobalConfig(), created: false };
  }
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

function readMcpConfig(projectRoot, { userDataPath = "" } = {}) {
  const projectFile = path.join(String(projectRoot || ""), ".editcore", "mcp.json");
  const projectAlt = path.join(String(projectRoot || ""), "mcp.json");
  const projectConfig = readJsonIfExists(projectFile) || readJsonIfExists(projectAlt);
  if (projectConfig) {
    return {
      file: fs.existsSync(projectFile) ? projectFile : projectAlt,
      config: projectConfig,
      scope: "project",
      auto: false,
    };
  }

  const global = ensureGlobalMcpConfig(userDataPath);
  return {
    file: global.file,
    config: global.config,
    scope: "global",
    auto: true,
    created: global.created === true,
  };
}

function normalizeServers(config, projectRoot) {
  const servers = Array.isArray(config?.servers) ? config.servers : [];
  return servers
    .map((item) => ({
      id: String(item?.id || item?.name || "").trim(),
      name: String(item?.name || item?.id || "").trim(),
      transport: String(item?.transport || "stdio").toLowerCase(),
      command: String(item?.command || "").trim(),
      args: Array.isArray(item?.args) ? item.args.map(String) : [],
      cwd: String(item?.cwd || ".").trim() || ".",
      url: String(item?.url || "").trim(),
      headers: item?.headers && typeof item.headers === "object" ? item.headers : {},
      env: item?.env && typeof item.env === "object" ? item.env : {},
      allowedTools: Array.isArray(item?.allowedTools) ? item.allowedTools.map(String) : [],
    }))
    .filter((item) => item.id)
    .map((item) => {
      const httpOk = (item.transport === "http" || item.transport === "sse") && /^https?:\/\//i.test(item.url);
      const stdioOk = item.transport === "stdio" && isSafeCommand(item.command, projectRoot);
      return {
        ...item,
        runnable: httpOk || stdioOk,
      };
    });
}

function listConfiguredServers(projectRoot, options = {}) {
  const { file, config, scope, auto, created } = readMcpConfig(projectRoot, options);
  if (!config || config.enabled === false) {
    return {
      available: false,
      message: "MCP desactivado. Activalo en la config global de EditCore (userData/mcp.json) o en .editcore/mcp.json del proyecto.",
      configPath: file,
      scope: scope || "global",
      auto: Boolean(auto),
      servers: [],
    };
  }
  const safe = normalizeServers(config, projectRoot);
  if (!safe.length) {
    return {
      available: false,
      idle: true,
      message: "MCP automatico listo, sin servidores activos. El agente no arrancara procesos hasta que agregues un server (global o del proyecto).",
      configPath: file,
      scope: scope || "global",
      auto: Boolean(auto),
      created: Boolean(created),
      servers: [],
    };
  }
  return {
    available: true,
    message: scope === "project"
      ? "Servidores MCP del proyecto."
      : "Servidores MCP globales de EditCore.",
    configPath: file,
    scope: scope || "global",
    auto: Boolean(auto),
    servers: safe,
  };
}

function toolAllowed(server, toolName) {
  if (!server.allowedTools.length || server.allowedTools.includes("*")) return true;
  return server.allowedTools.includes(toolName);
}

async function listTools(projectRoot, options = {}) {
  const listed = listConfiguredServers(projectRoot, options);
  if (!listed.available) return { ...listed, bridgeReady: true, tools: [] };

  const tools = [];
  const errors = [];
  for (const server of listed.servers) {
    if (!server.runnable) {
      const declared = (server.allowedTools.length ? server.allowedTools : []).map((name) => ({
        serverId: server.id,
        name,
        description: "Declarada (servidor no ejecutable: comando/url inseguro o ausente)",
        live: false,
        transport: server.transport,
      }));
      tools.push(...declared);
      errors.push(`${server.id}: no ejecutable`);
      continue;
    }
    try {
      let liveTools = [];
      if (server.transport === "http" || server.transport === "sse") {
        const { httpListTools } = require("./mcp-http-client");
        liveTools = await httpListTools(server);
      } else {
        const session = getSession(projectRoot, server);
        liveTools = await session.listTools();
      }
      for (const tool of liveTools) {
        const name = String(tool?.name || "").trim();
        if (!name || !toolAllowed(server, name)) continue;
        tools.push({
          serverId: server.id,
          name,
          description: String(tool?.description || ""),
          inputSchema: tool?.inputSchema || null,
          live: true,
          transport: server.transport,
        });
      }
    } catch (error) {
      errors.push(`${server.id}: ${error?.message || error}`);
      for (const name of server.allowedTools) {
        if (name === "*") continue;
        tools.push({
          serverId: server.id,
          name,
          description: "Declarada (fallo al consultar servidor en vivo)",
          live: false,
          transport: server.transport,
        });
      }
    }
  }

  return {
    available: true,
    bridgeReady: true,
    message: errors.length
      ? `MCP listo con avisos: ${errors.slice(0, 3).join(" | ")}`
      : "MCP listo: tools en vivo disponibles.",
    servers: listed.servers,
    configPath: listed.configPath,
    scope: listed.scope,
    tools,
    errors,
  };
}

async function invokeTool(projectRoot, input = {}, options = {}) {
  const listed = listConfiguredServers(projectRoot, options);
  if (!listed.available) {
    return {
      ok: false,
      available: false,
      idle: listed.idle === true,
      message: listed.message,
      configPath: listed.configPath,
      scope: listed.scope,
    };
  }
  const serverId = String(input.serverId || input.server || "").trim();
  const toolName = String(input.tool || input.name || "").trim();
  if (!serverId || !toolName) {
    return { ok: false, available: true, message: "mcp_invoke requiere serverId y tool." };
  }
  const server = listed.servers.find((item) => item.id === serverId);
  if (!server) {
    return { ok: false, available: true, message: `Servidor MCP desconocido: ${serverId}` };
  }
  if (!toolAllowed(server, toolName)) {
    return { ok: false, available: true, message: `Tool ${toolName} no esta en allowedTools de ${serverId}.` };
  }
  if (!server.runnable) {
    return {
      ok: false,
      available: true,
      message: `Servidor ${serverId} no es ejecutable de forma segura. command debe ser node/npx/npm o un binario dentro del proyecto.`,
    };
  }
  try {
    const args = input.arguments && typeof input.arguments === "object"
      ? input.arguments
      : (input.args && typeof input.args === "object" ? input.args : {});
    let result;
    if (server.transport === "http" || server.transport === "sse") {
      const { httpCallTool } = require("./mcp-http-client");
      result = await httpCallTool(server, toolName, args);
    } else {
      const session = getSession(projectRoot, server);
      result = await session.callTool(toolName, args);
    }
    return {
      ok: true,
      available: true,
      bridgeReady: true,
      serverId,
      tool: toolName,
      transport: server.transport,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      available: true,
      bridgeReady: true,
      serverId,
      tool: toolName,
      message: String(error?.message || error).slice(0, 500),
    };
  }
}

module.exports = {
  readMcpConfig,
  ensureGlobalMcpConfig,
  listConfiguredServers,
  listTools,
  invokeTool,
  closeSessionsForProject,
};
