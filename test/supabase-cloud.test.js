"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("Supabase Cloud Sync: project-infra.json points strictly to official Supabase Cloud project", () => {
  const infraPath = path.resolve(__dirname, "../project-infra.json");
  assert.ok(fs.existsSync(infraPath), "project-infra.json debe existir");
  const infra = JSON.parse(fs.readFileSync(infraPath, "utf8"));

  assert.equal(infra.supabase?.url, "https://ycftycizdgbboojfdtkz.supabase.co");
  assert.equal(infra.supabase?.cloudRef, "ycftycizdgbboojfdtkz");
  assert.equal(infra.supabase?.projectId, "ycftycizdgbboojfdtkz");
  assert.doesNotMatch(JSON.stringify(infra), /gafcore\.com/i, "No debe contener referencias a dominios gafcore.com dados de baja");
});

test("Supabase Cloud Sync: editcore-cloud-config default points to official Supabase Cloud accounts", () => {
  const { DEFAULT_PUBLIC_URL, loadCloudConfig } = require("../runtime/editcore-cloud-config");
  assert.equal(DEFAULT_PUBLIC_URL, "https://ycftycizdgbboojfdtkz.supabase.co");
  const cfg = loadCloudConfig({ env: {}, envFile: null, generatedFile: null });
  assert.equal(cfg.url, "https://ycftycizdgbboojfdtkz.supabase.co");
});

test("Supabase Cloud Sync: project-bootstrap prevents any connection to decommissioned gafcore domains", () => {
  const { ProjectBootstrap } = require("../runtime/project-bootstrap");
  const bootstrapper = new ProjectBootstrap({ vault: null });
  assert.ok(typeof bootstrapper.bootstrap === "function");

  const bootstrapCode = fs.readFileSync(path.resolve(__dirname, "../runtime/project-bootstrap.js"), "utf8");
  assert.match(bootstrapCode, /gafcore\.com/i, "Debe tener filtro explícito para excluir *.gafcore.com");
});
