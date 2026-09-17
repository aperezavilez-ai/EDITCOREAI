"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { MCPClientManager } = require("../runtime/mcp-client-manager");
const { RulesEngine } = require("../runtime/rules-engine");

test("MCPClientManager loads configuration, registers servers and lists tools", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mcp-test-"));
  
  // Crear config MCP dummy
  const mcpConfigFile = path.join(tmpDir, "mcp.json");
  const configData = {
    mcpServers: {
      "postgres-db": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        tools: [
          { name: "query_database", description: "Ejecuta una consulta SQL" },
          { name: "list_tables", description: "Lista tablas de la base de datos" },
        ],
      },
      "github-tools": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        tools: [
          { name: "create_pull_request", description: "Crea un PR en GitHub" },
        ],
      },
    },
  };
  fs.writeFileSync(mcpConfigFile, JSON.stringify(configData), "utf8");

  const manager = new MCPClientManager({ projectRoot: tmpDir });
  const loadRes = manager.loadConfiguration();
  assert.equal(loadRes.ok, true);
  assert.equal(loadRes.count, 2);

  const tools = manager.listTools();
  assert.equal(tools.length, 3);
  assert.ok(tools.some((t) => t.name === "query_database" && t.server === "postgres-db"));
  assert.ok(tools.some((t) => t.name === "create_pull_request" && t.server === "github-tools"));

  // Invocar herramienta MCP
  const invokeRes = await manager.invokeTool("postgres-db", "list_tables");
  assert.equal(invokeRes.ok, true);
  assert.equal(invokeRes.tool, "list_tables");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("RulesEngine reads .editcorerules, .cursorrules and formats system prompt directives", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rules-test-"));
  
  const rulesEngine = new RulesEngine({ projectRoot: tmpDir });
  
  // Guardar reglas por defecto
  const saveRes = rulesEngine.saveDefaultRules();
  assert.equal(saveRes.ok, true);
  assert.equal(fs.existsSync(path.join(tmpDir, ".editcorerules")), true);

  // Cargar directivas
  const prompt = rulesEngine.getSystemPromptDirectives();
  assert.ok(prompt.includes("REGLAS Y ESTÁNDARES DEL PROYECTO"));
  assert.ok(prompt.includes("Mantener código limpio, modular y completamente tipado"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
