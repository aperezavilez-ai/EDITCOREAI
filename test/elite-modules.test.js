"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { CloudSandboxInstant } = require("../runtime/cloud-sandbox-instant");
const { AIDatabaseStudio } = require("../runtime/ai-database-studio");
const { ArchitectureMapAnalyzer } = require("../runtime/architecture-map-analyzer");
const { ExtensionsMarketplace, BUILT_IN_THEMES } = require("../runtime/extensions-marketplace");

test("CloudSandboxInstant syncs .env variables correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sandbox-test-"));
  const envContent = "PORT=3000\nDATABASE_URL=\"postgres://user:pass@localhost:5432/db\"\n# Comentario\nAPI_KEY=secret_123";
  fs.writeFileSync(path.join(tmpDir, ".env"), envContent, "utf8");

  const sandbox = new CloudSandboxInstant({ projectRoot: tmpDir });
  const syncRes = sandbox.syncEnvVariables();

  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.syncedCount, 3);
  assert.ok(syncRes.keys.includes("DATABASE_URL"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

test("ArchitectureMapAnalyzer builds dependency graph and detects dead files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-arch-test-"));
  const src = path.join(tmpDir, "src");
  fs.mkdirSync(src, { recursive: true });

  // Crear App.tsx que importa Button.tsx
  fs.writeFileSync(path.join(src, "App.tsx"), "import { Button } from './Button';\nexport function App() { return <Button />; }", "utf8");
  fs.writeFileSync(path.join(src, "Button.tsx"), "export function Button() { return <button>OK</button>; }", "utf8");
  // Crear UnusedComponent.tsx no importado
  fs.writeFileSync(path.join(src, "UnusedComponent.tsx"), "export function Unused() { return <div>Dead</div>; }", "utf8");

  const analyzer = new ArchitectureMapAnalyzer({ projectRoot: tmpDir });
  const graph = analyzer.buildDependencyGraph("src");

  assert.equal(graph.nodesCount, 3);
  assert.equal(graph.edgesCount, 1);
  assert.ok(graph.deadFiles.includes("src/UnusedComponent.tsx"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("ExtensionsMarketplace provides themes and palette variables", () => {
  const market = new ExtensionsMarketplace();
  const themes = market.listThemes();

  assert.equal(themes.length, 5);
  assert.ok(themes.some((t) => t.id === "tokyo-night"));
  assert.ok(themes.some((t) => t.id === "dracula"));

  const change = market.setTheme("tokyo-night");
  assert.equal(change.ok, true);
  assert.equal(change.activeTheme.id, "tokyo-night");
  assert.equal(change.cssVariables["--ec-bg"], "#1a1b26");
});
