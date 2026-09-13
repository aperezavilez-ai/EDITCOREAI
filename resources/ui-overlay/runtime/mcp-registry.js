"use strict";

/**
 * Registro MCP orientado a UI/chat: escribe .editcore/mcp.json
 * Soporta multi-servidor stdio + http/sse.
 */

const fs = require("node:fs");
const path = require("node:path");
const { listConfiguredServers, listTools } = require("./mcp-bridge");

function projectMcpPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "mcp.json");
}

function readProjectMcp(projectRoot) {
  const file = projectMcpPath(projectRoot);
  if (!fs.existsSync(file)) {
    return { enabled: true, servers: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return { enabled: true, servers: [] };
    return {
      enabled: parsed.enabled !== false,
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      note: parsed.note || "",
    };
  } catch {
    return { enabled: true, servers: [] };
  }
}

function writeProjectMcp(projectRoot, config) {
  const file = projectMcpPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    enabled: config.enabled !== false,
    updatedAt: new Date().toISOString(),
    note: config.note || "MCP del proyecto (EditCore). Multi-servidor stdio/http.",
    servers: Array.isArray(config.servers) ? config.servers : [],
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { file, config: next };
}

function registerMcpServer(projectRoot, input = {}) {
  const root = String(projectRoot || "").trim();
  if (!root) throw new Error("projectRoot requerido.");
  const name = String(input.name || input.id || "").trim().slice(0, 64);
  const transport = String(input.transport || "stdio").toLowerCase();
  if (!name) throw new Error("MCP requiere name.");
  if (!["stdio", "http", "sse"].includes(transport)) {
    throw new Error("transport debe ser stdio|http|sse.");
  }

  const id = String(input.id || name).trim().replace(/\s+/g, "-").toLowerCase();
  let entry;
  if (transport === "stdio") {
    const command = String(input.command || "").trim();
    if (!command) throw new Error("stdio requiere command (node/npx/npm o binario del proyecto).");
    entry = {
      id,
      name,
      transport: "stdio",
      command,
      args: Array.isArray(input.args) ? input.args.map(String) : [],
      cwd: String(input.cwd || ".").trim() || ".",
      allowedTools: Array.isArray(input.allowedTools) && input.allowedTools.length
        ? input.allowedTools.map(String)
        : ["*"],
    };
  } else {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("http/sse requiere url http(s).");
    entry = {
      id,
      name,
      transport,
      url,
      headers: input.headers && typeof input.headers === "object" ? input.headers : {},
      allowedTools: Array.isArray(input.allowedTools) && input.allowedTools.length
        ? input.allowedTools.map(String)
        : ["*"],
    };
  }

  const current = readProjectMcp(root);
  const servers = current.servers.filter(
    (s) => String(s.id || "").toLowerCase() !== id && String(s.name || "").toLowerCase() !== name.toLowerCase(),
  );
  servers.push(entry);
  const written = writeProjectMcp(root, {
    enabled: true,
    servers: servers.slice(0, 12),
    note: "Registrado desde EditCore (multi-servidor).",
  });
  return { ...entry, configPath: written.file, serverCount: servers.length };
}

function removeMcpServer(projectRoot, idOrName = "") {
  const root = String(projectRoot || "").trim();
  const key = String(idOrName || "").trim().toLowerCase();
  const current = readProjectMcp(root);
  if (!key) {
    writeProjectMcp(root, { ...current, servers: [] });
    return { ok: true, remaining: 0 };
  }
  const next = current.servers.filter(
    (s) => String(s.id || "").toLowerCase() !== key && String(s.name || "").toLowerCase() !== key,
  );
  if (next.length === current.servers.length) throw new Error("Servidor MCP no encontrado.");
  writeProjectMcp(root, { ...current, servers: next });
  return { ok: true, remaining: next.length };
}

function mcpHealth(projectRoot, { userDataPath = "" } = {}) {
  const listed = listConfiguredServers(projectRoot, { userDataPath });
  return {
    ok: true,
    ready: listed.available === true,
    executionEnabled: listed.available === true,
    idle: listed.idle === true,
    message: listed.message,
    configPath: listed.configPath,
    scope: listed.scope,
    serverCount: (listed.servers || []).length,
    servers: (listed.servers || []).map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      url: s.url || "",
      runnable: s.runnable === true,
      allowedTools: s.allowedTools,
    })),
  };
}

async function mcpStatusWithTools(projectRoot, options = {}) {
  const health = mcpHealth(projectRoot, options);
  if (!health.ready) return { ...health, tools: [] };
  const tools = await listTools(projectRoot, options);
  return {
    ...health,
    tools: Array.isArray(tools.tools) ? tools.tools.slice(0, 80) : [],
  };
}

module.exports = {
  projectMcpPath,
  readProjectMcp,
  writeProjectMcp,
  registerMcpServer,
  removeMcpServer,
  mcpHealth,
  mcpStatusWithTools,
};
