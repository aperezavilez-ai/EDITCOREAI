"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ProjectBootstrap } = require("../runtime/project-bootstrap");

test("ProjectBootstrap: Modo Managed aprovisiona automáticamente con estado managed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-managed-test-"));
  const projDir = path.join(tmpDir, "mi-app-managed");

  const execCommands = [];
  const bootstrap = new ProjectBootstrap({
    getVaultCredentials: (svc) => {
      if (svc === "github") return { githubToken: "gh_test_token" };
      if (svc === "vercel") return { vercelToken: "vcl_test_token", vercelTeamId: "team_test" };
      if (svc === "supabase") return { supabaseUrl: "https://abcdefgh.supabase.co", supabaseAnonKey: "anon_test_key" };
      return null;
    },
    execCmd: (cmd, opts) => {
      execCommands.push(cmd);
      return "";
    },
    fetchImpl: async (url, opts) => {
      if (url.includes("api.github.com/user")) {
        return { ok: true, json: async () => ({ login: "master-org" }) };
      }
      if (url.includes("api.vercel.com/v9/projects")) {
        return { ok: true, json: async () => ({ id: "prj_test_123" }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  const result = await bootstrap.bootstrap(projDir, { mode: "managed", stack: "vite-react" });
  assert.equal(result.success, true);
  assert.equal(result.provisioning, "managed");

  // Verificar package.json y archivos base
  assert.ok(fs.existsSync(path.join(projDir, "package.json")));
  assert.ok(fs.existsSync(path.join(projDir, "index.html")));
  assert.ok(fs.existsSync(path.join(projDir, "src", "main.js")));

  // Verificar .vercel/project.json
  const vclJson = JSON.parse(fs.readFileSync(path.join(projDir, ".vercel", "project.json"), "utf8"));
  assert.equal(vclJson.projectId, "prj_test_123");

  // Verificar .env.local
  const envLocal = fs.readFileSync(path.join(projDir, ".env.local"), "utf8");
  assert.match(envLocal, /https:\/\/abcdefgh\.supabase\.co/);
  assert.match(envLocal, /anon_test_key/);

  // Verificar project-infra.json
  const infra = JSON.parse(fs.readFileSync(path.join(projDir, "project-infra.json"), "utf8"));
  assert.equal(infra.provisioningMode, "managed");
  assert.equal(infra.vercelProjectId, "prj_test_123");

  // Verificar roadmap
  const roadmap = JSON.parse(fs.readFileSync(path.join(projDir, ".editcore", "roadmap.json"), "utf8"));
  assert.equal(roadmap.project.provisioning, "managed");
  assert.equal(roadmap.connections.vercel.projectId, "prj_test_123");

  // Verificar status
  const status = bootstrap.getProvisioningStatus(projDir);
  assert.equal(status.mode, "managed");
  assert.equal(status.isManaged, true);
  assert.equal(status.isIndependent, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("ProjectBootstrap: Eject independiza el proyecto hacia las cuentas del cliente", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-eject-test-"));
  const projDir = path.join(tmpDir, "mi-app-eject");

  const execCommands = [];
  const bootstrap = new ProjectBootstrap({
    execCmd: (cmd, opts) => {
      execCommands.push(cmd);
      return "";
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });

  // Primero crear en modo managed
  await bootstrap.bootstrap(projDir, { mode: "managed" });

  // Ahora independizar hacia cuentas del cliente
  const ejectResult = await bootstrap.eject(projDir, {
    github: {
      remoteUrl: "https://github.com/cliente-real/mi-app.git",
      token: "ghp_cliente_personal_token",
    },
    vercel: {
      projectId: "prj_cliente_999",
      teamId: "team_cliente_org",
    },
    supabase: {
      url: "https://cliente-db.supabase.co",
      anonKey: "cliente_anon_key_999",
      serviceRoleKey: "cliente_service_role_999",
      projectRef: "cliente-db",
    },
  });

  assert.equal(ejectResult.ok, true);
  assert.equal(ejectResult.provisioning, "independent");

  // Verificar comando git ejecutado para apuntar al nuevo origin
  assert.ok(execCommands.some((c) => c.includes("git remote add origin https://github.com/cliente-real/mi-app.git")));

  // Verificar .vercel/project.json actualizado con datos del cliente
  const vclJson = JSON.parse(fs.readFileSync(path.join(projDir, ".vercel", "project.json"), "utf8"));
  assert.equal(vclJson.projectId, "prj_cliente_999");
  assert.equal(vclJson.orgId, "team_cliente_org");

  // Verificar .env.local actualizado con datos de supabase del cliente
  const envLocal = fs.readFileSync(path.join(projDir, ".env.local"), "utf8");
  assert.match(envLocal, /https:\/\/cliente-db\.supabase\.co/);
  assert.match(envLocal, /cliente_anon_key_999/);
  assert.match(envLocal, /cliente_service_role_999/);

  // Verificar project-infra.json actualizado
  const infra = JSON.parse(fs.readFileSync(path.join(projDir, "project-infra.json"), "utf8"));
  assert.equal(infra.provisioningMode, "independent");
  assert.equal(infra.supabaseUrl, "https://cliente-db.supabase.co");
  assert.equal(infra.vercelProjectId, "prj_cliente_999");
  assert.ok(infra.ejectedAt);

  // Verificar roadmap actualizado
  const roadmap = JSON.parse(fs.readFileSync(path.join(projDir, ".editcore", "roadmap.json"), "utf8"));
  assert.equal(roadmap.project.provisioning, "independent");
  assert.equal(roadmap.connections.github.remoteUrl, "https://github.com/cliente-real/mi-app.git");
  assert.equal(roadmap.connections.vercel.projectId, "prj_cliente_999");
  assert.equal(roadmap.connections.supabase.url, "https://cliente-db.supabase.co");

  // Verificar auditoría
  const audit = fs.readFileSync(path.join(projDir, ".editcore", "audit.jsonl"), "utf8");
  assert.match(audit, /project_ejected_to_independent/);

  // Verificar getProvisioningStatus
  const status = bootstrap.getProvisioningStatus(projDir);
  assert.equal(status.mode, "independent");
  assert.equal(status.isIndependent, true);
  assert.equal(status.isManaged, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
