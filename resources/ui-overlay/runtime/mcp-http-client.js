"use strict";

/**
 * Cliente MCP HTTP/SSE minimo (JSON-RPC tools/list + tools/call).
 */

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

function requestJson(url, { method = "POST", headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (error) {
      reject(new Error(`URL MCP invalida: ${url}`));
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname || "/"}${parsed.search || ""}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(payload ? { "Content-Length": String(payload.length) } : {}),
        ...headers,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
          return;
        }
        // SSE: tomar ultimo data JSON
        if (/text\/event-stream/i.test(String(res.headers["content-type"] || "")) || raw.includes("data:")) {
          const lines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
          const last = lines.length ? lines[lines.length - 1].replace(/^data:\s*/, "") : raw;
          try {
            resolve(JSON.parse(last));
          } catch {
            resolve({ raw: last });
          }
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout MCP HTTP"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function httpListTools(server = {}) {
  const url = String(server.url || "").trim();
  if (!url) throw new Error("Servidor HTTP MCP requiere url.");
  const headers = server.headers && typeof server.headers === "object" ? server.headers : {};
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };
  const data = await requestJson(url, { method: "POST", headers, body });
  const tools = data?.result?.tools || data?.tools || [];
  return Array.isArray(tools) ? tools : [];
}

async function httpCallTool(server = {}, toolName = "", args = {}) {
  const url = String(server.url || "").trim();
  if (!url) throw new Error("Servidor HTTP MCP requiere url.");
  const headers = server.headers && typeof server.headers === "object" ? server.headers : {};
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: toolName, arguments: args || {} },
  };
  return requestJson(url, { method: "POST", headers, body });
}

module.exports = {
  requestJson,
  httpListTools,
  httpCallTool,
};
