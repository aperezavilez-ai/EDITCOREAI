"use strict";

/**
 * Interactive terminal sessions with real stdin/stdout pipes.
 * Prefers node-pty when available; falls back to PowerShell/cmd spawn pipes.
 */

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const os = require("node:os");

let nodePty = null;
try {
  nodePty = require("node-pty");
} catch {
  nodePty = null;
}

const sessions = new Map();
let seq = 0;

function resolveShell() {
  if (process.platform === "win32") {
    return { file: process.env.ComSpec || "cmd.exe", args: [] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

class PtySession extends EventEmitter {
  constructor({ cwd, cols = 120, rows = 30 } = {}) {
    super();
    this.id = `pty_${Date.now().toString(36)}_${++seq}`;
    this.cwd = cwd && path.isAbsolute(cwd) ? cwd : process.cwd();
    this.cols = cols;
    this.rows = rows;
    this.backend = "spawn-pipe";
    this.alive = true;
    this._buf = [];
    this._start();
  }

  _start() {
    if (nodePty) {
      try {
        const shell = process.platform === "win32" ? (process.env.ComSpec || "powershell.exe") : (process.env.SHELL || "bash");
        this._pty = nodePty.spawn(shell, [], {
          name: "xterm-color",
          cols: this.cols,
          rows: this.rows,
          cwd: this.cwd,
          env: process.env,
        });
        this.backend = "node-pty";
        this._pty.onData((data) => {
          this._buf.push(data);
          if (this._buf.length > 200) this._buf.shift();
          this.emit("data", data);
        });
        this._pty.onExit(({ exitCode }) => {
          this.alive = false;
          this.emit("exit", exitCode);
        });
        return;
      } catch {
        this._pty = null;
      }
    }

    const { file, args } = resolveShell();
    this._child = spawn(file, args, {
      cwd: this.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.backend = "spawn-pipe";
    const onChunk = (chunk) => {
      const text = chunk.toString("utf8");
      this._buf.push(text);
      if (this._buf.length > 200) this._buf.shift();
      this.emit("data", text);
    };
    this._child.stdout.on("data", onChunk);
    this._child.stderr.on("data", onChunk);
    this._child.on("exit", (code) => {
      this.alive = false;
      this.emit("exit", code);
    });
    this._child.on("error", (err) => this.emit("error", err));
  }

  write(data) {
    if (!this.alive) return false;
    const text = String(data ?? "");
    if (this._pty) {
      this._pty.write(text);
      return true;
    }
    if (this._child?.stdin?.writable) {
      this._child.stdin.write(text);
      return true;
    }
    return false;
  }

  resize(cols, rows) {
    this.cols = Number(cols) || this.cols;
    this.rows = Number(rows) || this.rows;
    if (this._pty?.resize) this._pty.resize(this.cols, this.rows);
  }

  kill() {
    this.alive = false;
    try {
      if (this._pty) this._pty.kill();
      else if (this._child) this._child.kill();
    } catch {}
  }

  snapshot() {
    return {
      id: this.id,
      cwd: this.cwd,
      backend: this.backend,
      alive: this.alive,
      cols: this.cols,
      rows: this.rows,
      recent: this._buf.slice(-40).join(""),
      host: os.hostname(),
      nodePtyAvailable: Boolean(nodePty),
      ownerId: this.ownerId || null,
    };
  }
}

function createSession(input = {}) {
  const session = new PtySession(input);
  session.ownerId = input.ownerId != null ? Number(input.ownerId) : null;
  sessions.set(session.id, session);
  return session.snapshot();
}

function getSession(id) {
  return sessions.get(String(id || "")) || null;
}

function writeSession(id, data) {
  const session = getSession(id);
  if (!session) throw new Error("Sesión PTY desconocida.");
  return { ok: session.write(data), id };
}

function resizeSession(id, cols, rows) {
  const session = getSession(id);
  if (!session) throw new Error("Sesión PTY desconocida.");
  session.resize(cols, rows);
  return session.snapshot();
}

function killSession(id) {
  const session = getSession(id);
  if (!session) return { ok: false };
  session.kill();
  sessions.delete(String(id));
  return { ok: true };
}

function listSessions() {
  return [...sessions.values()].map((s) => s.snapshot());
}

function killAllSessions() {
  for (const id of [...sessions.keys()]) {
    try { killSession(id); } catch { /* ignore */ }
  }
  return { ok: true };
}

function attachDataListener(id, handler) {
  const session = getSession(id);
  if (!session) throw new Error("Sesión PTY desconocida.");
  session.on("data", handler);
  return () => session.off("data", handler);
}

module.exports = {
  createSession,
  getSession,
  writeSession,
  resizeSession,
  killSession,
  killAllSessions,
  listSessions,
  attachDataListener,
  nodePtyAvailable: () => Boolean(nodePty),
};
