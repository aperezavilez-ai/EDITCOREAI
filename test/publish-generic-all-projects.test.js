"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveDeployRoot, readVercelIds } = require("../runtime/deploy-one-click");
const { vercelNameCandidates } = require("../runtime/vercel-env-sync");

test("resolveDeployRoot elige app anidada con .vercel (genérico, cualquier proyecto)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-deploy-root-"));
  const nested = path.join(root, "Mi App");
  fs.mkdirSync(path.join(nested, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(nested, ".vercel", "project.json"), JSON.stringify({
    projectId: "prj_any",
    orgId: "team_any",
    projectName: "mi-app",
  }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "wrapper", scripts: { dev: "echo" } }));
  fs.writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "app", scripts: { build: "vite build" } }));
  assert.equal(resolveDeployRoot(root), nested);
  fs.rmSync(root, { recursive: true, force: true });
});

test("readVercelIds lee project-infra de cualquier root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ids-"));
  fs.writeFileSync(path.join(root, "project-infra.json"), JSON.stringify({
    vercelProjectId: "prj_generic_123",
    vercelProjectName: "generic-app",
  }));
  const ids = readVercelIds(root, {});
  assert.equal(ids.projectId, "prj_generic_123");
  assert.equal(ids.projectName, "generic-app");
  fs.rmSync(root, { recursive: true, force: true });
});

test("vercelNameCandidates cubre espacios y sin guiones (todos los proyectos)", () => {
  const names = vercelNameCandidates("TAXIDRIV APP", "My Cool App");
  assert.ok(names.includes("taxidriv-app"));
  assert.ok(names.includes("taxidrivapp"));
  assert.ok(names.includes("my-cool-app"));
  assert.ok(names.includes("mycoolapp"));
});
