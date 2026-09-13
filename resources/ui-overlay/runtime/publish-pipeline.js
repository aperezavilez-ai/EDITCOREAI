"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { deployOneClick } = require("./deploy-one-click");
const { appendAuditEvent } = require("./project-audit");
const { prePublishValidation } = require("./project-maintainer");
const { git, findGitRoot, detectBranch, hasUpstream, runCapture } = require("./git-utils");

const SECRET_NAME_RE = /(^|[\\/])(\.env([.\\].*)?|.*\.(pem|key|p12|pfx)|credentials\.json|secrets?\.json|id_rsa|id_ed25519)([\\/]|$)/i;
const ALWAYS_EXCLUDE = [
  "node_modules",
  ".git",
  "release-275",
  "win-unpacked",
];

function isSecretPath(relPath) {
  return SECRET_NAME_RE.test(String(relPath || "").replace(/\\/g, "/"));
}

function resolveEditCoreAsarPaths(runtimeRoot) {
  const root = path.resolve(String(runtimeRoot || ""));
  const base = path.basename(root).toLowerCase();
  const parent = path.dirname(root);
  const parentBase = path.basename(parent).toLowerCase();
  if (base === "app" && parentBase === "resources") {
    return {
      packCwd: parent,
      packArgs: ["asar", "pack", "app", "app.asar"],
      asarPath: path.join(parent, "app.asar"),
      appDir: root,
    };
  }
  return {
    packCwd: root,
    packArgs: ["asar", "pack", ".", path.join("..", "app.asar")],
    asarPath: path.join(path.dirname(root), "app.asar"),
    appDir: root,
  };
}

async function stageProjectFiles(gitRoot) {
  const status = await git(gitRoot, ["status", "--porcelain", "-uall"]);
  if (status.code !== 0) {
    return { ok: false, message: status.stderr || "git status fallo", staged: [] };
  }
  const lines = status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const staged = [];
  const skipped = [];
  for (const line of lines) {
    const raw = line.slice(3).trim();
    const rel = raw.includes(" -> ") ? raw.split(" -> ").pop().trim() : raw;
    if (!rel) continue;
    const parts = rel.split(/[\\/]/);
    const excluded = ALWAYS_EXCLUDE.some((pattern) => parts.includes(pattern) || rel === pattern)
      || isSecretPath(rel)
      || /\.(exe|blockmap|asar\.backup-.*)$/i.test(rel);
    if (excluded) {
      skipped.push(rel);
      continue;
    }
    const add = await git(gitRoot, ["add", "--", rel]);
    if (add.code === 0) staged.push(rel);
    else skipped.push(rel);
  }
  return { ok: true, staged, skipped, porcelain: status.stdout };
}

async function stageEditCoreFiles(gitRoot, runtimeRoot) {
  const relApp = path.relative(gitRoot, runtimeRoot).replace(/\\/g, "/");
  const asarInfo = resolveEditCoreAsarPaths(runtimeRoot);
  const asarRel = path.relative(gitRoot, asarInfo.asarPath).replace(/\\/g, "/");
  const candidates = [
    relApp && !relApp.startsWith("..") ? `${relApp}/` : "",
    asarRel && !asarRel.startsWith("..") ? asarRel : "",
  ].filter(Boolean);
  if (!candidates.length) {
    const addAll = await git(gitRoot, ["add", "-A", "--", "."]);
    return { ok: addAll.code === 0, staged: ["."], skipped: [], message: addAll.stderr || "" };
  }
  const staged = [];
  for (const item of candidates) {
    const add = await git(gitRoot, ["add", "-A", "--", item]);
    if (add.code === 0) staged.push(item);
  }
  const status = await git(gitRoot, ["diff", "--cached", "--name-only"]);
  const cached = status.stdout.split(/\r?\n/).filter(Boolean);
  for (const file of cached) {
    if (isSecretPath(file)) await git(gitRoot, ["reset", "HEAD", "--", file]);
  }
  return { ok: staged.length > 0 || cached.length > 0, staged, skipped: [], asarRel };
}

async function commitIfNeeded(gitRoot, message) {
  const cached = await git(gitRoot, ["diff", "--cached", "--name-only"]);
  if (!cached.stdout.trim()) {
    return { ok: true, committed: false, message: "Sin cambios para commit." };
  }
  const msg = String(message || "").trim() || `EDITCOREAI publish ${new Date().toISOString().slice(0, 19)}`;
  // -F evita pathspec en Windows aunque alguien reactive shell:true.
  const msgFile = path.join(gitRoot, ".git", "EDITCOREAI_COMMIT_MSG.tmp");
  fs.writeFileSync(msgFile, `${msg}\n`, "utf8");
  let result;
  try {
    result = await git(gitRoot, ["commit", "-F", msgFile]);
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
  if (result.code !== 0) {
    return { ok: false, committed: false, message: result.stderr || result.stdout || "git commit fallo" };
  }
  const sha = await git(gitRoot, ["rev-parse", "HEAD"]);
  return { ok: true, committed: true, sha: sha.stdout, message: msg };
}

async function pushCurrentBranch(gitRoot, branch, { connections = {} } = {}) {
  const remote = await git(gitRoot, ["remote"]);
  if (!remote.stdout.trim()) {
    return { ok: false, message: "No hay remote git configurado." };
  }
  const token = String(connections.githubToken || "").trim();
  const env = { ...process.env };
  if (token) {
    env.GITHUB_TOKEN = token;
    env.GH_TOKEN = token;
  }
  const upstream = await hasUpstream(gitRoot, branch);
  const args = upstream
    ? ["push", "origin", "HEAD"]
    : ["push", "-u", "origin", "HEAD"];
  if (token) {
    const withHeader = await git(gitRoot, [
      "-c", `http.extraHeader=Authorization: Bearer ${token}`,
      ...args,
    ], { timeoutMs: 300_000, env });
    if (withHeader.code === 0) {
      return { ok: true, branch, message: `Push OK → origin/${branch} (Conexiones GitHub)` };
    }
    const result = await git(gitRoot, args, { timeoutMs: 300_000, env });
    if (result.code !== 0) {
      return {
        ok: false,
        message: withHeader.stderr || result.stderr || result.stdout || "git push fallo",
        branch,
      };
    }
    return { ok: true, branch, message: `Push OK → origin/${branch}` };
  }
  const result = await git(gitRoot, args, { timeoutMs: 300_000, env });
  if (result.code !== 0) {
    return { ok: false, message: result.stderr || result.stdout || "git push fallo", branch };
  }
  return { ok: true, branch, message: `Push OK → origin/${branch}` };
}

async function rollbackLastCommit(gitRoot, { pushed = false } = {}) {
  const head = await git(gitRoot, ["rev-parse", "HEAD"]);
  const parent = await git(gitRoot, ["rev-parse", "HEAD~1"]);
  if (parent.code !== 0) {
    return { ok: false, message: "No hay commit anterior para revertir." };
  }
  const revert = await git(gitRoot, ["revert", "HEAD", "--no-edit"]);
  if (revert.code !== 0) {
    return { ok: false, message: revert.stderr || "git revert fallo" };
  }
  if (pushed) {
    const push = await git(gitRoot, ["push", "origin", "HEAD"], { timeoutMs: 300_000 });
    if (push.code !== 0) {
      return { ok: false, message: push.stderr || "revert local OK pero push fallo" };
    }
  }
  return {
    ok: true,
    revertedSha: head.stdout,
    message: pushed ? "Revert publicado en remote." : "Revert local aplicado.",
  };
}

async function maybeSupabasePush(projectRoot) {
  const migrations = path.join(projectRoot, "supabase", "migrations");
  if (!fs.existsSync(migrations)) {
    return { ok: true, skipped: true, message: "Sin carpeta supabase/migrations." };
  }
  const bin = process.platform === "win32" ? "supabase.cmd" : "supabase";
  try {
    const result = await runCapture(bin, ["db", "push"], { cwd: projectRoot, timeoutMs: 300_000 });
    return {
      ok: result.code === 0,
      skipped: false,
      message: result.code === 0 ? "supabase db push OK" : (result.stderr || result.stdout || "supabase db push fallo"),
      code: result.code,
    };
  } catch (error) {
    return { ok: false, skipped: false, message: error?.message || String(error) };
  }
}

async function rebuildEditCoreAsar(runtimeRoot) {
  const info = resolveEditCoreAsarPaths(runtimeRoot);
  if (!fs.existsSync(info.appDir) || !fs.statSync(info.appDir).isDirectory()) {
    return { ok: false, message: `Runtime no escribible o inexistente: ${info.appDir}` };
  }
  const result = await runCapture("npx", info.packArgs, { cwd: info.packCwd, timeoutMs: 300_000 });
  return {
    ok: result.code === 0 && fs.existsSync(info.asarPath),
    message: result.code === 0 ? `ASAR regenerado: ${info.asarPath}` : (result.stderr || result.stdout || "asar pack fallo"),
    asarPath: info.asarPath,
  };
}

async function publishProject(projectRoot, {
  mode = "project",
  connections = {},
  deploy = true,
  supabasePush = true,
  commitMessage = "",
  skipPush = false,
  preCheck = true,
  rollbackOnDeployFail = true,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  const fail = (step, message, extra = {}) => ({
    ok: false,
    completed: false,
    mode,
    projectRoot: root,
    steps: [...steps, { step, ok: false, message, ...extra }],
    message,
  });

  if (!root || !fs.existsSync(root)) {
    return fail("root", "projectRoot invalido.");
  }

  const gitRoot = findGitRoot(root);
  if (!gitRoot) {
    return fail("git", "No hay repositorio git. Inicializa git o abre la raiz del repo.");
  }

  const status = await git(gitRoot, ["status", "--short"]);
  steps.push({ step: "git_status", ok: status.code === 0, message: status.stdout || "(limpio)", code: status.code });
  if (status.code !== 0) return fail("git_status", status.stderr || "git status fallo");

  if (mode === "editcore") {
    const asar = await rebuildEditCoreAsar(root);
    steps.push({ step: "asar_pack", ok: asar.ok, message: asar.message, asarPath: asar.asarPath });
    if (!asar.ok) return fail("asar_pack", asar.message);
    const staged = await stageEditCoreFiles(gitRoot, root);
    steps.push({ step: "git_add", ok: staged.ok, staged: staged.staged, skipped: staged.skipped });
    if (!staged.ok) return fail("git_add", staged.message || "No se pudieron agregar archivos de EDITCOREAI.");
  } else {
    const staged = await stageProjectFiles(gitRoot);
    steps.push({
      step: "git_add",
      ok: staged.ok,
      staged: staged.staged,
      skipped: staged.skipped,
      message: staged.skipped?.length ? `Omitidos (secretos/ruido): ${staged.skipped.slice(0, 8).join(", ")}` : "",
    });
    if (!staged.ok) return fail("git_add", staged.message || "git add fallo");
  }

  const branch = await detectBranch(gitRoot);
  steps.push({ step: "branch", ok: true, branch });

  if (mode === "project" && preCheck) {
    const validation = await prePublishValidation(root, { runTests: true, runLint: true });
    steps.push({ step: "pre_check", ok: validation.ok, message: validation.message, detail: validation.steps });
    if (!validation.ok) {
      appendAuditEvent(root, { action: "publish", ok: false, branch, message: validation.message });
      return fail("pre_check", validation.message);
    }
  }

  const commit = await commitIfNeeded(gitRoot, commitMessage || (
    mode === "editcore"
      ? `chore(editcore): publish ${new Date().toISOString().slice(0, 10)}`
      : `chore: publish ${path.basename(root)} ${new Date().toISOString().slice(0, 10)}`
  ));
  steps.push({ step: "git_commit", ok: commit.ok, committed: commit.committed, sha: commit.sha || "", message: commit.message });
  if (!commit.ok) return fail("git_commit", commit.message);

  let pushed = false;
  if (!skipPush) {
    const push = await pushCurrentBranch(gitRoot, branch, { connections });
    steps.push({ step: "git_push", ok: push.ok, branch: push.branch || branch, message: push.message });
    if (!push.ok) {
      appendAuditEvent(root, { action: "publish", ok: false, branch, message: push.message, steps });
      return fail("git_push", push.message);
    }
    pushed = true;
  } else {
    steps.push({ step: "git_push", ok: true, skipped: true, message: "Push omitido." });
  }

  if (mode === "project" && supabasePush) {
    const sb = await maybeSupabasePush(root);
    steps.push({ step: "supabase_db_push", ok: sb.ok, skipped: sb.skipped === true, message: sb.message });
    if (!sb.ok && !sb.skipped) {
      appendAuditEvent(root, { action: "publish", ok: false, branch, sha: commit.sha, message: sb.message, steps });
      return fail("supabase_db_push", sb.message);
    }
  }

  if (deploy) {
    const { readVercelIds } = require("./deploy-one-click");
    const ids = readVercelIds(root, connections);
    const deployConnections = {
      ...connections,
      vercelProjectId: String(connections.vercelProjectId || ids.projectId || "").trim(),
      vercelOrgId: String(connections.vercelOrgId || connections.vercelTeamId || ids.orgId || "").trim(),
      vercelTeamId: String(connections.vercelTeamId || connections.vercelOrgId || ids.orgId || "").trim(),
    };
    const deployResult = await deployOneClick(root, { provider: "auto", production: true }, { connections: deployConnections });
    steps.push({
      step: "deploy_one_click",
      ok: deployResult.ok === true,
      available: deployResult.available !== false,
      provider: deployResult.provider || "",
      url: deployResult.url || "",
      deployRoot: deployResult.deployRoot || "",
      projectId: deployResult.projectId || deployConnections.vercelProjectId || "",
      message: deployResult.message || (deployResult.ok ? "Deploy OK" : "Deploy fallo"),
      detail: deployResult.output ? String(deployResult.output).slice(-800) : "",
    });
    if (deployResult.ok !== true) {
      let rollback = { ok: false, skipped: true };
      if (rollbackOnDeployFail && commit.committed) {
        rollback = await rollbackLastCommit(gitRoot, { pushed });
        steps.push({ step: "rollback", ...rollback });
      }
      appendAuditEvent(root, {
        action: "publish",
        ok: false,
        branch,
        sha: commit.sha || "",
        message: deployResult.message || "Deploy fallo",
        steps,
      });
      return {
        ok: false,
        completed: false,
        mode,
        projectRoot: root,
        gitRoot,
        branch,
        steps,
        rollback,
        message: deployResult.message || "Deploy fallo",
        deploy: deployResult,
      };
    }
  } else {
    steps.push({ step: "deploy_one_click", ok: true, skipped: true, message: "Deploy omitido." });
  }

  const shaStep = steps.find((item) => item.step === "git_commit");
  const deployStep = steps.find((item) => item.step === "deploy_one_click");
  appendAuditEvent(root, {
    action: "publish",
    ok: true,
    branch,
    sha: shaStep?.sha || "",
    url: deployStep?.url || "",
    message: "Publicacion completada",
    steps: steps.map((item) => ({ step: item.step, ok: item.ok !== false })),
  });
  return {
    ok: true,
    completed: true,
    mode,
    projectRoot: root,
    gitRoot,
    branch,
    sha: shaStep?.sha || "",
    steps,
    message: mode === "editcore"
      ? `EDITCOREAI publicado en origin/${branch}${shaStep?.sha ? ` (${String(shaStep.sha).slice(0, 7)})` : ""}`
      : `Proyecto publicado en origin/${branch}${shaStep?.sha ? ` (${String(shaStep.sha).slice(0, 7)})` : ""}`,
  };
}

module.exports = {
  publishProject,
  commitIfNeeded,
  findGitRoot,
  detectBranch,
  isSecretPath,
  resolveEditCoreAsarPaths,
  rollbackLastCommit,
  SECRET_NAME_RE,
};