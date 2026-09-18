"use strict";

/**
 * LSP Client nativo para EditCoreAI.
 * - Se conecta a servidores de lenguaje (tsserver, pyright, gopls, etc.)
 * - Expone: textDocument/didOpen, didChange, completion, hover, diagnostics
 * - Integración con Monaco via ghost-text y markers.
 */

const { spawn, ChildProcess } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const LSP_METHODS = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  SHUTDOWN: "shutdown",
  EXIT: "exit",
  TEXT_DOCUMENT_DID_OPEN: "textDocument/didOpen",
  TEXT_DOCUMENT_DID_CHANGE: "textDocument/didChange",
  TEXT_DOCUMENT_COMPLETION: "textDocument/completion",
  TEXT_DOCUMENT_HOVER: "textDocument/hover",
  TEXT_DOCUMENT_DIAGNOSTICS: "textDocument/diagnostic",
  WORKSPACE_DID_CHANGE_CONFIGURATION: "workspace/didChangeConfiguration",
};

const SERVER_BINARIES = {
  typescript: "tsserver",
  javascript: "tsserver",
  python: "pyright-langserver",
  go: "gopls",
  rust: "rust-analyzer",
};

class LSPClient extends EventEmitter {
  constructor(rootPath, languageId) {
    super();
    this.rootPath = String(rootPath || process.cwd()).replace(/\\/g, "/");
    this.languageId = String(languageId || "typescript").toLowerCase();
    this.serverProcess = null;
    this.initialized = false;
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.documents = new Map();
    this.diagnostics = new Map();
    this.messageBuffer = "";
    this.ready = false;
  }

  start() {
    const binary = this._resolveBinary();
    if (!binary) {
      this.emit("error", new Error(`No se encontró binario LSP para ${this.languageId}`));
      return;
    }

    this.serverProcess = spawn(binary, [], {
      cwd: this.rootPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.serverProcess.stdout.on("data", (chunk) => {
      this.messageBuffer += chunk.toString();
      this._drainBuffer();
    });

    this.serverProcess.stderr.on("data", (chunk) => {
      this.emit("server-log", { level: "stderr", data: chunk.toString() });
    });

    this.serverProcess.on("exit", (code) => {
      this.ready = false;
      this.emit("exit", { code });
    });

    this._sendRequest(LSP_METHODS.INITIALIZE, {
      processId: process.pid,
      rootUri: this._toUri(this.rootPath),
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          diagnostic: { relatedDocumentSupport: true },
        },
        workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
      },
    }).then((result) => {
      this.initialized = true;
      this.ready = true;
      this._sendNotification(LSP_METHODS.INITIALIZED, {});
      this.emit("ready", { capabilities: result?.capabilities });
    }).catch((err) => {
      this.emit("error", err);
    });
  }

  stop() {
    if (!this.serverProcess) return;
    try {
      this._sendRequest(LSP_METHODS.SHUTDOWN, {}).finally(() => {
        this._sendNotification(LSP_METHODS.EXIT, {});
        this.serverProcess.kill("SIGTERM");
        this.serverProcess = null;
        this.ready = false;
      });
    } catch {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
      this.ready = false;
    }
  }

  openDocument(uri, languageId, text) {
    this.documents.set(uri, { uri, languageId, version: 1, text });
    return this._sendNotification(LSP_METHODS.TEXT_DOCUMENT_DID_OPEN, {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  changeDocument(uri, text) {
    const doc = this.documents.get(uri);
    if (!doc) return this.openDocument(uri, this.languageId, text);
    doc.text = text;
    doc.version += 1;
    return this._sendNotification(LSP_METHODS.TEXT_DOCUMENT_DID_CHANGE, {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    });
  }

  requestCompletion(uri, line, character) {
    return this._sendRequest(LSP_METHODS.TEXT_DOCUMENT_COMPLETION, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  requestHover(uri, line, character) {
    return this._sendRequest(LSP_METHODS.TEXT_DOCUMENT_HOVER, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  _resolveBinary() {
    const candidates = [SERVER_BINARIES[this.languageId]];
    const local = path.join(this.rootPath, "node_modules", ".bin", SERVER_BINARIES[this.languageId] || "");
    if (fs.existsSync(local)) return local;
    for (const c of candidates) {
      if (!c) continue;
      const p = path.join(this.rootPath, "node_modules", ".bin", c);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  _toUri(p) {
    return `file:///${p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, v) => `${v.toLowerCase()}`)}`;
  }

  _sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess || !this.serverProcess.writable) {
        return reject(new Error("LSP server no está corriendo"));
      }
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\r\n";
      this.serverProcess.stdin.write(payload);
    });
  }

  _sendNotification(method, params) {
    if (!this.serverProcess || !this.serverProcess.writable) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\r\n";
    this.serverProcess.stdin.write(payload);
  }

  _drainBuffer() {
    const lines = this.messageBuffer.split("\r\n");
    this.messageBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if ("error" in msg && msg.error) reject(new Error(msg.error.message || "LSP error"));
          else resolve(msg.result);
        } else if (msg.method) {
          this.emit("notification", msg);
          if (msg.method === "textDocument/publishDiagnostics") {
            this.diagnostics.set(msg.params?.uri, msg.params?.diagnostics || []);
            this.emit("diagnostics", { uri: msg.params?.uri, diagnostics: msg.params?.diagnostics || [] });
          }
        }
      } catch {
        this.emit("server-log", { level: "parse-error", data: line });
      }
    }
  }
}

module.exports = { LSPClient, LSP_METHODS };
