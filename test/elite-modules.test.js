"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { AIDatabaseStudio } = require("../runtime/ai-database-studio");

test("AIDatabaseStudio creates SQL migrations and TypeScript types", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-db-test-"));
  const studio = new AIDatabaseStudio({ projectRoot: tmpDir });

  // 1. Generar migración
  const migrationRes = studio.generateMigration({
    name: "create_orders_table",
    description: "Tabla de pedidos y compras de usuarios",
    tables: [
      {
        name: "orders",
        columns: [
          { name: "user_id", type: "UUID", nullable: false },
          { name: "total_amount", type: "NUMERIC(10,2)", nullable: false },
          { name: "status", type: "TEXT", nullable: false },
        ],
      },
    ],
  });

  assert.equal(migrationRes.ok, true);
  assert.ok(fs.existsSync(migrationRes.filePath));
  assert.ok(migrationRes.sql.includes("CREATE TABLE IF NOT EXISTS public.orders"));
  assert.ok(migrationRes.sql.includes("ENABLE ROW LEVEL SECURITY"));

  // 2. Generar tipos TypeScript
  const tsTypes = studio.generateTypeScriptTypes([
    {
      name: "orders",
      columns: [
        { name: "user_id", type: "UUID" },
        { name: "total_amount", type: "NUMERIC" },
        { name: "status", type: "TEXT" },
      ],
    },
  ]);

  assert.ok(tsTypes.includes("export interface Database"));
  assert.ok(tsTypes.includes("total_amount: number"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
