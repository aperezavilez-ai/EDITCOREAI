"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { connectionSummary } = require("../service-harness");
const { buildSafeConnectionsSnapshot, formatOperatorConnectionsMemory } = require("../runtime/operator-connections-context");
const { scanProject } = require("../runtime/ecosystem-scanner");

test("connectionSummary: Soporta Supabase oficial, Docker y SSH retirados de Conexiones", () => {
  const summary = connectionSummary({
    githubToken: "ghp_123",
    vercelToken: "vcl_123",
    supabaseUrl: "https://myproject.supabase.co",
    supabaseAnonKey: "eyJ_anon",
  });

  assert.strictEqual(summary.github.configured, true);
  assert.strictEqual(summary.vercel.configured, true);
  assert.strictEqual(summary.supabase.configured, true);
  assert.strictEqual(summary.supabase.url, "https://myproject.supabase.co");
  assert.strictEqual(summary.docker.configured, false);
  assert.strictEqual(summary.server.configured, false);
});

test("connectionSummary: Soporta Supabase oficial (https://<ref>.supabase.co)", () => {
  const summary = connectionSummary({
    supabaseUrl: "https://xyzref.supabase.co",
    supabaseAnonKey: "eyJ_cloud",
  });

  assert.strictEqual(summary.supabase.configured, true);
  assert.strictEqual(summary.supabase.url, "https://xyzref.supabase.co");
});

test("ecosystem-scanner & operator-context: Detección de Supabase oficial y sin Docker en conexiones", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-conn-test-"));
  await fs.writeFile(path.join(tmpDir, "docker-compose.yml"), "version: '3.8'\nservices:\n  db:\n    image: postgres\n", "utf-8");
  await fs.writeFile(path.join(tmpDir, ".env"), "NEXT_PUBLIC_SUPABASE_URL=https://abcxyz.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ_test\n", "utf-8");

  // 1. Ecosystem scanner
  const scanned = scanProject(tmpDir);
  assert.strictEqual(scanned.hasDocker, true);
  assert.strictEqual(scanned.docker.hasCompose, true);
  assert.strictEqual(scanned.supabase.mode, "official-cloud");
  assert.strictEqual(scanned.supabase.url, "https://abcxyz.supabase.co");

  // 2. Operator connections memory
  const snapshot = buildSafeConnectionsSnapshot({
    projectRoot: tmpDir,
    connections: { githubToken: "ghp_abc" },
  });
  assert.strictEqual(snapshot.supabase.mode, "Cloud Oficial");

  const formattedMemory = formatOperatorConnectionsMemory(snapshot);
  assert.ok(formattedMemory.includes("Supabase Oficial (DB & Auth)"));
  assert.ok(!formattedMemory.includes("Docker & Contenedores"));
  assert.ok(!formattedMemory.includes("Servidor SSH: CONECTADO"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
