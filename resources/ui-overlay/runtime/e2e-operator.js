"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assessProjectConnections } = require("./project-connect");
const { checkProjectHealth } = require("./project-maintainer");
const { appendAuditEvent } = require("./project-audit");

function e2eEnabled() {
  return Boolean(
    String(process.env.E2E_OPERATOR || "").trim() === "1"
    || String(process.env.E2E_GITHUB_TOKEN || "").trim(),
  );
}

function loadConnectionsFromEnv() {
  return {
    githubToken: String(process.env.E2E_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim(),
    vercelToken: String(process.env.E2E_VERCEL_TOKEN || process.env.VERCEL_TOKEN || "").trim(),
    netlifyToken: String(process.env.E2E_NETLIFY_TOKEN || "").trim(),
    selfSupabaseUrl: String(process.env.E2E_SUPABASE_URL || "").trim(),
    selfSupabaseKey: String(process.env.E2E_SUPABASE_KEY || "").trim(),
    supabaseCloudToken: String(process.env.E2E_SUPABASE_CLOUD_TOKEN || "").trim(),
    supabaseOrgId: String(process.env.E2E_SUPABASE_ORG_ID || "").trim(),
  };
}

async function runE2EOperatorSuite() {
  if (!e2eEnabled()) {
    return {
      ok: true,
      skipped: true,
      message: "E2E idle: define E2E_OPERATOR=1 y tokens (E2E_GITHUB_TOKEN, etc.).",
    };
  }

  const connections = loadConnectionsFromEnv();
  const steps = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-"));
  const readme = path.join(tmp, "README.md");
  fs.writeFileSync(readme, `# E2E ${Date.now()}\n`, "utf8");

  const assess = await assessProjectConnections(tmp, connections);
  steps.push({ step: "assess_empty", ok: assess.ok === true, missing: assess.missing });
  if (!assess.missing.includes("git_repo")) {
    return { ok: false, message: "Se esperaba git_repo faltante en carpeta vacia.", steps, tmp };
  }

  const { ensureGitRepo } = require("./project-connect");
  const gitInit = await ensureGitRepo(tmp);
  steps.push({ step: "git_init", ok: gitInit.ok, created: gitInit.created });
  if (!gitInit.ok) {
    return { ok: false, message: gitInit.message, steps, tmp };
  }

  const health = await checkProjectHealth(tmp, connections);
  steps.push({ step: "health", ok: health.ok === false, issues: health.issues });
  appendAuditEvent(tmp, { action: "e2e", ok: true, message: "E2E operator smoke" });
  const auditPath = path.join(tmp, ".editcore", "audit.jsonl");
  const auditOk = fs.existsSync(auditPath);
  steps.push({ step: "audit", ok: auditOk });

  if (connections.githubToken && process.env.E2E_CONNECT_GITHUB === "1") {
    const { connectProject } = require("./project-connect");
    const connected = await connectProject(tmp, connections, {
      createGithub: true,
      createVercel: false,
      linkSupabase: false,
      repoName: `editcore-e2e-${Date.now()}`,
    });
    steps.push({ step: "connect_github", ok: connected.ok, message: connected.message });
    if (!connected.ok) {
      return { ok: false, message: connected.message || "connect github fallo", steps, tmp };
    }
  }

  if (connections.vercelToken && process.env.E2E_DEPLOY === "1") {
    const { deployOneClick } = require("./deploy-one-click");
    const deploy = await deployOneClick(tmp, { provider: "vercel", production: false }, { connections });
    steps.push({ step: "deploy_vercel", ok: deploy.ok === true, message: deploy.message });
  }

  return {
    ok: steps.every((item) => item.ok !== false),
    skipped: false,
    tmp,
    steps,
    message: "E2E operator completado.",
  };
}

module.exports = {
  e2eEnabled,
  loadConnectionsFromEnv,
  runE2EOperatorSuite,
};
