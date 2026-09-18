const { describe, it: test, after: afterAll } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DbManager } = require("../runtime/db-manager");

const TEST_DB_FOLDER = path.join(os.tmpdir(), ".editcore-db-manager-tests");

function cleanup() {
  if (fs.existsSync(TEST_DB_FOLDER)) {
    fs.rmSync(TEST_DB_FOLDER, { recursive: true, force: true });
  }
}

function createManager() {
  cleanup();
  return new DbManager({ dataFolder: TEST_DB_FOLDER });
}

function writeSqlite(dbName, sql) {
  const dbPath = path.join(TEST_DB_FOLDER, dbName);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, "");
  const { execSync } = require("node:child_process");
  try {
    execSync(`sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, { stdio: "pipe" });
  } catch {
    // sqlite3 CLI may be unavailable in test env; skip CLI seeding.
  }
}

describe("DbManager", () => {
  afterAll(() => cleanup());

  test("listLocalDatabases returns sqlite files from the data folder", () => {
    const manager = createManager();
    writeSqlite("sample.db", "CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY);");
    const databases = manager.listLocalDatabases();
    assert.equal(Array.isArray(databases), true);
    const found = databases.find((item) => item.name === "sample.db");
    assert.ok(found);
    assert.equal(found.type, "sqlite");
  });

  test("querySqlite throws when database does not exist", async () => {
    const manager = createManager();
    await assert.rejects(async () => {
      await manager.querySqlite("missing.db", "SELECT 1");
    });
  });

  test("getSchema returns table metadata for a valid sqlite database", async () => {
    const manager = createManager();
    writeSqlite("schema.db", "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT);");
    if (!manager.getStatus().sqliteAvailable) {
      await assert.rejects(async () => {
        await manager.getSchema("schema.db");
      });
      return;
    }
    const schema = await manager.getSchema("schema.db");
    assert.equal(schema.database, "schema.db");
    assert.ok(Array.isArray(schema.tables));
  });

  test("listLocalDatabases ignores non-database files", () => {
    const manager = createManager();
    fs.mkdirSync(TEST_DB_FOLDER, { recursive: true });
    fs.writeFileSync(path.join(TEST_DB_FOLDER, "readme.txt"), "ignore me");
    const databases = manager.listLocalDatabases();
    assert.equal(databases.some((item) => item.name === "readme.txt"), false);
  });
});
