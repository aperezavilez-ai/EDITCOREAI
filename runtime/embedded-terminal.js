"use strict";

const { spawn } = require("child_process");
const EventEmitter = require("events");
const os = require("os");
const path = require("path");

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-[a-z0-9_-]*(?:r|f)[a-z0-9_-]*\s+(?:\/|\*|[a-z]:[\\\/]|\.\.|\~)/i,
  /\bdel\s+(?:\/[a-z]\s+)*(?:[a-z]:[\\\/]|\*)/i,
  /\brd\s+(?:\/[a-z]\s+)*(?:[a-z]:[\\\/]|\*)/i,
  /\bformat\s+[c-z]:/i,
  /\bdrop\s+(?:database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+reset\s+--hard\s+head~[0-9]{2,}\b/i,
  /\bgit\s+clean\s+-[a-z]*f[a-z]*d[a-z]*\b/i,
  /\bshutdown\b/i,
  /\bdiskpart\b/i,
];

class TerminalSession extends EventEmitter {
  constructor(id, options = {}) {
    super();
    this.id = id;
    this.projectRoot = options.projectRoot || process.cwd();
    this.shell = options.shell || (os.platform() === "win32" ? "powershell.exe" : "bash");
    this.cols = options.cols || 80;
    this.rows = options.rows || 24;
    this.process = null;
    this.history = [];
    this.buffer = "";
    this.maxBufferLength = options.maxBufferLength || 100_000;
    this.isAlive = false;
    this.createdAt = Date.now();
  }

  start() {
    if (this.isAlive) return this;

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      EDITCORE_EMBEDDED_TERM: "1",
      COLUMNS: String(this.cols),
      LINES: String(this.rows),
    };

    let shellArgs = [];
    if (this.shell.includes("powershell")) {
      shellArgs = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];
    } else if (this.shell.includes("cmd.exe")) {
      shellArgs = ["/Q"];
    }

    try {
      this.process = spawn(this.shell, shellArgs, {
        cwd: this.projectRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      this.isAlive = true;

      this.process.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        this._appendBuffer(text);
        this.emit("data", text);
      });

      this.process.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        this._appendBuffer(text);
        this.emit("error-data", text);
        this.emit("data", text);
      });

      this.process.on("close", (code, signal) => {
        this.isAlive = false;
        this.emit("exit", { code, signal, id: this.id });
      });

      this.process.on("error", (err) => {
        this.emit("error", { err, id: this.id });
      });

      return this;
    } catch (err) {
      this.isAlive = false;
      this.emit("error", { err, id: this.id });
      throw err;
    }
  }

  _appendBuffer(text) {
    this.buffer += text;
    if (this.buffer.length > this.maxBufferLength) {
      this.buffer = this.buffer.slice(-this.maxBufferLength);
    }
  }

  checkCommandSafety(cmdString = "") {
    const raw = String(cmdString).trim();
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(raw)) {
        return {
          safe: false,
          pattern: pattern.toString(),
          reason: `Comando potencialmente destructivo detectado: "${raw}"`,
        };
      }
    }
    return { safe: true };
  }

  write(input, { force = false } = {}) {
    if (!this.isAlive || !this.process || !this.process.stdin) {
      return { ok: false, error: "Terminal session no está viva" };
    }

    if (!force) {
      const safety = this.checkCommandSafety(input);
      if (!safety.safe) {
        this.emit("safety-warning", {
          id: this.id,
          input,
          reason: safety.reason,
        });
        return { ok: false, safetyBlocked: true, reason: safety.reason };
      }
    }

    try {
      this.history.push({ input, at: Date.now() });
      if (this.history.length > 500) this.history.shift();
      this.process.stdin.write(input);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  resize(cols, rows) {
    this.cols = Number(cols) || this.cols;
    this.rows = Number(rows) || this.rows;
    this.emit("resize", { cols: this.cols, rows: this.rows });
    return { ok: true, cols: this.cols, rows: this.rows };
  }

  kill(signal = "SIGTERM") {
    if (!this.isAlive || !this.process) return { ok: true };
    try {
      if (os.platform() === "win32") {
        spawn("taskkill", ["/pid", String(this.process.pid), "/T", "/F"], { windowsHide: true });
      } else {
        this.process.kill(signal);
      }
      this.isAlive = false;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  getBuffer() {
    return this.buffer;
  }

  clearBuffer() {
    this.buffer = "";
  }
}

class TerminalManager {
  constructor() {
    this.sessions = new Map();
    this.sessionCounter = 0;
  }

  createSession(options = {}) {
    this.sessionCounter += 1;
    const id = `term-${Date.now()}-${this.sessionCounter}`;
    const session = new TerminalSession(id, options);
    this.sessions.set(id, session);

    session.on("exit", () => {
      setTimeout(() => this.sessions.delete(id), 60_000);
    });

    session.start();
    return session;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      projectRoot: s.projectRoot,
      shell: s.shell,
      isAlive: s.isAlive,
      createdAt: s.createdAt,
      cols: s.cols,
      rows: s.rows,
    }));
  }

  killAll() {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
  }
}

const defaultTerminalManager = new TerminalManager();

module.exports = {
  TerminalSession,
  TerminalManager,
  defaultTerminalManager,
  DESTRUCTIVE_COMMAND_PATTERNS,
};
