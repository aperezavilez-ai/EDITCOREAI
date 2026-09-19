const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");

const DEFAULT_DB_FOLDER = path.join(os.homedir(), ".editcore", "databases");
const SQLITE_BIN = "sqlite3";
const PG_BIN = "psql";

class DbManager {
  constructor(options = {}) {
    this.dataFolder = options.dataFolder || DEFAULT_DB_FOLDER;
    this.connections = new Map();
    this.stateFile = path.join(this.dataFolder, ".editcore-db-state.json");
  }

  _ensureDir() {
    fs.mkdirSync(this.dataFolder, { recursive: true });
  }

  _readState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      }
    } catch {
      return {};
    }
    return {};
  }

  _writeState(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  listLocalDatabases() {
    this._ensureDir();
    const entries = fs.readdirSync(this.dataFolder, { withFileTypes: true });
    const databases = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(this.dataFolder, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") {
        databases.push({
          name: entry.name,
          path: fullPath,
          type: "sqlite",
          size: fs.statSync(fullPath).size,
        });
      }
    }

    return databases;
  }

  async querySqlite(databaseName, sql) {
    const dbPath = path.join(this.dataFolder, databaseName);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found: ${databaseName}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(SQLITE_BIN, [dbPath, "-json", sql], {
        cwd: this.dataFolder,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `sqlite3 exited with code ${code}`));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve({ rows: [] });
          return;
        }

        try {
          const parsed = JSON.parse(trimmed);
          resolve({ rows: Array.isArray(parsed) ? parsed : [parsed] });
        } catch {
          resolve({ rows: [], raw: trimmed });
        }
      });
    });
  }

  async getSchema(databaseName) {
    const sql = `
      SELECT 
        type,
        name,
        tbl_name AS tableName,
        sql
      FROM sqlite_master
      WHERE type IN ('table','index','view')
      ORDER BY type, tbl_name, name;
    `;

    const result = await this.querySqlite(databaseName, sql);
    const tables = [];
    const indexes = [];
    const views = [];

    for (const row of result.rows) {
      const item = {
        name: row.name,
        tableName: row.tableName,
        sql: row.sql || null,
      };

      if (row.type === "table") tables.push(item);
      else if (row.type === "index") indexes.push(item);
      else if (row.type === "view") views.push(item);
    }

    return {
      database: databaseName,
      tables,
      indexes,
      views,
    };
  }

  registerConnection(connection) {
    this.connections.set(connection.id, {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      config: connection.config || {},
      createdAt: Date.now(),
    });

    const state = this._readState();
    state.connections = state.connections || {};
    state.connections[connection.id] = this.connections.get(connection.id);
    this._writeState(state);

    return this.connections.get(connection.id);
  }

  listConnections() {
    const state = this._readState();
    return Object.values(state.connections || {});
  }

  removeConnection(connectionId) {
    this.connections.delete(connectionId);
    const state = this._readState();
    if (state.connections && state.connections[connectionId]) {
      delete state.connections[connectionId];
      this._writeState(state);
    }
  }

  getStatus() {
    const localDatabases = this.listLocalDatabases();
    const connections = this.listConnections();

    return {
      localDatabases,
      connections,
      dataFolder: this.dataFolder,
      sqliteAvailable: this._isBinaryAvailable(SQLITE_BIN),
      pgAvailable: this._isBinaryAvailable(PG_BIN),
    };
  }

  _isBinaryAvailable(binary) {
    try {
      const result = spawnSync("where", [binary], { stdio: "pipe" });
      return result.status === 0;
    } catch {
      return false;
    }
  }
}

module.exports = { DbManager };
