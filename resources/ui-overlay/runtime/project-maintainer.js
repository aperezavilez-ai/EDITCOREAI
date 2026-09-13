"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assessProjectConnections } = require("./project-connect");
const { supabaseHealth, checkMigrationDrift } = require("./supabase-manager");
const { readAuditEvents } = require("./project-audit");
const { findGitRoot, detectBranch, git } = require("./git-utils");

function runCapture(command, args, { cwd, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout: ${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code) || 0, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() });
    });
  });
}

function readPackageScripts(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    return pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function summarizeCapture(result = {}, max = 900) {
  const raw = String(result.stderr || result.stdout || "").trim();
  if (!raw) return "sin salida";
  const compact = raw.replace(/\r\n/g, "\n").split("\n").slice(-40).join("\n").trim();
  return compact.length > max ? `${compact.slice(0, max)}\n…` : compact;
}

async function prePublishValidation(projectRoot, { runTests = true, runLint = true } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const scripts = readPackageScripts(root);
  const steps = [];

  if (runLint && scripts.lint) {
    const result = await runCapture("npm", ["run", "lint"], { cwd: root }).catch((error) => ({
      code: 1,
      stderr: error?.message || String(error),
    }));
    const detail = summarizeCapture(result);
    steps.push({
      step: "lint",
      ok: result.code === 0,
      message: result.code === 0 ? "lint OK" : detail,
    });
    if (result.code !== 0) {
      return {
        ok: false,
        steps,
        message: `Pre-publicacion bloqueada: lint fallo.\n\n${detail}`,
      };
    }
  }

  if (runTests && scripts.test && !/no test specified/i.test(scripts.test)) {
    const result = await runCapture("npm", ["test", "--", "--passWithNoTests"], { cwd: root }).catch((error) => ({
      code: 1,
      stderr: error?.message || String(error),
    }));
    const detail = summarizeCapture(result);
    steps.push({
      step: "test",
      ok: result.code === 0,
      message: result.code === 0 ? "tests OK" : detail,
    });
    if (result.code !== 0) {
      return {
        ok: false,
        steps,
        message: `Pre-publicacion bloqueada: tests fallaron.\n\n${detail}`,
      };
    }
  }

  if (scripts.build) {
    const result = await runCapture("npm", ["run", "build"], { cwd: root }).catch((error) => ({
      code: 1,
      stderr: error?.message || String(error),
    }));
    const detail = summarizeCapture(result);
    steps.push({
      step: "build",
      ok: result.code === 0,
      message: result.code === 0 ? "build OK" : detail,
    });
    if (result.code !== 0) {
      return {
        ok: false,
        steps,
        message: `Pre-publicacion bloqueada: build fallo.\n\n${detail}`,
      };
    }
  }

  return { ok: true, steps, message: steps.length ? "Validacion pre-publicacion OK." : "Sin scripts de validacion; continua." };
}

async function checkProjectHealth(projectRoot, connections = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const assessment = await assessProjectConnections(root, connections);
  const gitRoot = assessment.gitRoot || findGitRoot(root);
  let dirty = false;
  let branch = assessment.branch || "";
  if (gitRoot) {
    const status = await git(gitRoot, ["status", "--porcelain"]);
    dirty = Boolean(status.stdout.trim());
    if (!branch) branch = await detectBranch(gitRoot);
  }
  const sbHealth = await supabaseHealth(connections);
  const drift = assessment.hasSupabase ? await checkMigrationDrift(root) : { skipped: true };
  const audit = readAuditEvents(root, { limit: 5 });
  const lastPublish = audit.find((item) => item.action === "publish" && item.ok);

  const issues = [];
  if (!assessment.gitRoot) issues.push("sin_git");
  if (!assessment.remoteUrl) issues.push("sin_remote");
  if (dirty) issues.push("cambios_sin_commit");
  if (assessment.missing?.includes("vercel_or_netlify_token")) issues.push("sin_deploy_token");
  if (drift.pendingEstimate > 0) issues.push("migraciones_pendientes");
  if (!sbHealth.ok && assessment.hasSupabase) issues.push("supabase_offline");

  return {
    ok: issues.length === 0,
    projectRoot: root,
    name: path.basename(root),
    branch,
    dirty,
    issues,
    assessment,
    supabase: sbHealth,
    migrations: drift,
    lastPublish: lastPublish || null,
    readyToPublish: assessment.readyToPublish && !dirty && issues.length === 0,
  };
}

async function checkAllProjects(projects = [], connections = {}) {
  const list = Array.isArray(projects) ? projects : [];
  const results = [];
  for (const project of list) {
    const root = String(project?.projectRoot || project?.root || "").trim();
    if (!root || !fs.existsSync(root)) continue;
    const health = await checkProjectHealth(root, connections);
    results.push({
      id: project.id || root,
      name: project.name || health.name,
      ...health,
    });
  }
  return {
    ok: true,
    count: results.length,
    healthy: results.filter((item) => item.ok).length,
    projects: results,
  };
}

module.exports = {
  prePublishValidation,
  checkProjectHealth,
  checkAllProjects,
  readPackageScripts,
};
