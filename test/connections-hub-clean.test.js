"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { connectionSummary } = require("../service-harness");
const { buildSafeConnectionsSnapshot, formatOperatorConnectionsMemory } = require("../runtime/operator-connections-context");
const { scanProject } = require("../runtime/ecosystem-scanner");

test("connectionSummary: Soporta Supabase oficial y Docker, SSH retirado", () => {
  const summary = connectionSummary({
    githubToken: "ghp_123",
    vercelToken: "vcl_123",
    supabaseUrl: "https://myproject.supabase.co",
    supabaseAnonKey: "eyJ_anon",
    dockerEnabled: true,
  });

  assert.strictEqual(summary.github.configured, true);
  assert.strictEqual(summary.vercel.configured, true);
  assert.strictEqual(summary.supabase.configured, true);
  assert.strictEqual(summary.supabase.url, "https://myproject.supabase.co");
  assert.strictEqual(summary.docker.configured, true);
  assert.strictEqual(summary.server.configured, false);
});

test("connectionSummary: Soporta Supabase en Docker local (http://127.0.0.1:54321)", () => {
  const summary = connectionSummary({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseAnonKey: "eyJ_local",
  });

  assert.strictEqual(summary.supabase.configured, true);
  assert.strictEqual(summary.supabase.url, "http://127.0.0.1:54321");
});

test("ecosystem-scanner & operator-context: Detección inteligente de Docker y Supabase oficial", async () => {
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
  assert.strictEqual(snapshot.docker.activeInProject, true);
  assert.strictEqual(snapshot.supabase.mode, "Cloud Oficial");

  const formattedMemory = formatOperatorConnectionsMemory(snapshot);
  assert.ok(formattedMemory.includes("Supabase Oficial (DB & Auth)"));
  assert.ok(formattedMemory.includes("Docker & Contenedores: ACTIVO en proyecto"));
  assert.ok(!formattedMemory.includes("Servidor SSH: CONECTADO"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
