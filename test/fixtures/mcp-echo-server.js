"use strict";

/**
 * Servidor MCP minimo de prueba (JSON-RPC + Content-Length).
 * Uso: node test/fixtures/mcp-echo-server.js
 */
function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return;
    const body = buffer.slice(headerEnd + 4, total).toString("utf8");
    buffer = buffer.slice(total);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "editcore-echo", version: "1.0.0" },
        },
      });
      continue;
    }
    if (msg.method === "notifications/initialized") continue;
    if (msg.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [{
            name: "echo",
            description: "Devuelve el texto recibido",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          }],
        },
      });
      continue;
    }
    if (msg.method === "tools/call") {
      const text = String(msg.params?.arguments?.text || "");
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: `echo:${text}` }],
        },
      });
    }
  }
});
