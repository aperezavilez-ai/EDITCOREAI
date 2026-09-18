"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const { McpClient } = require("../runtime/mcp-client");

describe("McpClient", () => {
  it("crea una instancia con valores por defecto", () => {
    const client = new McpClient();
    assert.ok(client.id);
    assert.strictEqual(client.transport, "stdio");
    assert.strictEqual(client.connected, false);
    assert.strictEqual(client.initialized, false);
  });

  it("crea una instancia con configuración personalizada", () => {
    const client = new McpClient({
      id: "test-client",
      name: "Test MCP",
      transport: "stdio",
      command: "node",
      args: ["fake-server.js"],
      timeoutMs: 5000,
    });

    assert.strictEqual(client.id, "test-client");
    assert.strictEqual(client.name, "Test MCP");
    assert.strictEqual(client.transport, "stdio");
    assert.strictEqual(client.command, "node");
    assert.deepStrictEqual(client.args, ["fake-server.js"]);
    assert.strictEqual(client.timeoutMs, 5000);
  });

  it("falla al conectar por stdio sin comando", async () => {
    const client = new McpClient({ transport: "stdio", command: null });
    let error;
    try {
      await client.connect();
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.ok(error.message.includes("Transporte MCP no soportado"));
  });

  it("falla al conectar por sse sin URL", async () => {
    const client = new McpClient({ transport: "sse" });
    let error;
    try {
      await client.connect();
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.ok(error.message.includes("Transporte MCP no soportado"));
  });

  it("falla al listar tools sin inicializar", async () => {
    const client = new McpClient();
    let error;
    try {
      await client.listTools();
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.ok(error.message.includes("no inicializado"));
  });

  it("falla al llamar una tool sin inicializar", async () => {
    const client = new McpClient();
    let error;
    try {
      await client.callTool("tool-name", { foo: "bar" });
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.ok(error.message.includes("no inicializado"));
  });

  it("cierra la conexión limpiamente", async () => {
    const client = new McpClient({ transport: "stdio", command: null });
    const result = await client.shutdown();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(client.connected, false);
    assert.strictEqual(client.initialized, false);
  });
});
