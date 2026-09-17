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
  // En Windows: cmd /c (evitar shell:true + args, y evitar .cmd → EINVAL).
  try {
    const result = await runCapture(
      process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "supabase",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "supabase db push"]
        : ["db", "push"],
      {
        cwd: projectRoot,
        timeoutMs: 120_000,
        shell: false,
      },
    );
    if (result.code === 0) {
      return { ok: true, skipped: false, message: "supabase db push OK", code: 0 };
    }
    const msg = String(result.stderr || result.stdout || "supabase db push fallo").trim();
    // Publicar no debe truncarse: Supabase self-hosted / sin `supabase link` es normal.
    // GitHub push + Vercel deploy siguen siendo el objetivo de Push + Deploy.
    if (/project ref|supabase link|not linked|Cannot find project|No project linked|failed to (parse|inspect)|EINVAL|ENOENT|not recognized|no se encontr/i.test(msg)) {
      return {
        ok: true,
        skipped: true,
        warning: true,
        message: `Supabase db push omitido (${msg.split(/\r?\n/).find(Boolean)?.slice(0, 140) || "sin link"}). El deploy Vercel continúa.`,
        code: result.code,
      };
    }
    return { ok: false, skipped: false, message: msg, code: result.code };
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (/EINVAL|ENOENT|not recognized|no se encontr|command failed/i.test(msg)) {
      return {
        ok: true,
        skipped: true,
        message: "Supabase CLI no disponible en PATH; se omitió db push (el deploy Vercel continúa).",
      };
    }
    return { ok: false, skipped: false, message: msg };
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
  onProgress = null,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  const report = (step, percent, message = "") => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({ step, percent, message: message || step });
    } catch {
      /* ignore */
    }
  };
  const fail = (step, message, extra = {}) => ({
    ok: false,
    completed: false,
    mode,
    projectRoot: root,
    steps: [...steps, { step, ok: false, message, ...extra }],
    message: `[${step}] ${message}`,
    failedStep: step,
  });

  if (!root || !fs.existsSync(root)) {
    return fail("root", "projectRoot invalido.");
  }

  const gitRoot = findGitRoot(root);
  if (!gitRoot) {
    return fail("git", "No hay repositorio git. Inicializa git o abre la raiz del repo.");
  }

  report("git_status", 8, "Revisando cambios…");
  const status = await git(gitRoot, ["status", "--short"]);
  steps.push({ step: "git_status", ok: status.code === 0, message: status.stdout || "(limpio)", code: status.code });
  if (status.code !== 0) return fail("git_status", status.stderr || "git status fallo");

  if (mode === "editcore") {
    report("asar_pack", 18, "Empaquetando ASAR…");
    const asar = await rebuildEditCoreAsar(root);
    steps.push({ step: "asar_pack", ok: asar.ok, message: asar.message, asarPath: asar.asarPath });
    if (!asar.ok) return fail("asar_pack", asar.message);
    report("git_add", 28, "Preparando archivos…");
    const staged = await stageEditCoreFiles(gitRoot, root);
    steps.push({ step: "git_add", ok: staged.ok, staged: staged.staged, skipped: staged.skipped });
    if (!staged.ok) return fail("git_add", staged.message || "No se pudieron agregar archivos de EDITCOREAI.");
  } else {
    report("git_add", 18, "Preparando archivos…");
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
    report("pre_check", 28, "Validación previa…");
    const validation = await prePublishValidation(root, { runTests: true, runLint: true });
    steps.push({
      step: "pre_check",
      ok: validation.ok !== false,
      warning: validation.ok === false,
      message: validation.ok
        ? validation.message
        : `Pre-check con avisos (no bloquea Publicar): ${validation.message || "revisar lint/tests"}`,
      detail: validation.steps,
    });
    // No abortar Publicar por lint/tests: el deploy Vercel debe continuar.
  }

  report("git_commit", 38, "Creando commit…");
  const commit = await commitIfNeeded(gitRoot, commitMessage || (
    mode === "editcore"
      ? `chore(editcore): publish ${new Date().toISOString().slice(0, 10)}`
      : `chore: publish ${path.basename(root)} ${new Date().toISOString().slice(0, 10)}`
  ));
  steps.push({ step: "git_commit", ok: commit.ok, committed: commit.committed, sha: commit.sha || "", message: commit.message });
  if (!commit.ok) return fail("git_commit", commit.message);

  let pushed = false;
  if (!skipPush) {
    report("git_push", 52, "Push a GitHub…");
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
    report("supabase_db_push", 62, "Supabase db push…");
    const sb = await maybeSupabasePush(root);
    steps.push({
      step: "supabase_db_push",
      ok: sb.ok !== false,
      skipped: sb.skipped === true,
      warning: sb.warning === true,
      message: sb.message,
    });
    // Solo abortar Publicar si es un fallo duro (no "sin link" / CLI ausente).
    if (sb.ok === false && sb.skipped !== true) {
      appendAuditEvent(root, { action: "publish", ok: false, branch, sha: commit.sha, message: sb.message, steps });
      return fail("supabase_db_push", sb.message);
    }
  }

  if (deploy) {
    const { readVercelIds } = require("./deploy-one-click");
    let ids = readVercelIds(root, connections);
    // Antes de deploy: asegurar projectId (crear/linkear) si hay token y aún no hay id.
    if (!ids.projectId && String(connections.vercelToken || "").trim()) {
      report("vercel_ensure_project", 72, "Enlazando proyecto Vercel…");
      try {
        const { ensureVercelProjectId } = require("./vercel-env-sync");
        const ensured = await ensureVercelProjectId(connections, {
          projectRoot: root,
          projectId: connections.vercelProjectId || ids.projectId || "",
          projectName: path.basename(root),
          createIfMissing: true,
        });
        if (ensured?.projectId) {
          ids = { ...ids, projectId: ensured.projectId, orgId: ensured.orgId || ids.orgId || "" };
          steps.push({
            step: "vercel_ensure_project",
            ok: true,
            projectId: ensured.projectId,
            created: ensured.created === true,
            message: ensured.message || "Vercel projectId listo",
          });
        } else {
          steps.push({
            step: "vercel_ensure_project",
            ok: ensured?.ok !== false,
            skipped: ensured?.skipped === true,
            message: ensured?.message || "Sin projectId Vercel",
          });
        }
      } catch (error) {
        steps.push({
          step: "vercel_ensure_project",
          ok: false,
          message: String(error?.message || error),
        });
      }
    }
    const deployConnections = {
      ...connections,
      vercelProjectId: String(connections.vercelProjectId || ids.projectId || "").trim(),
      vercelOrgId: String(connections.vercelOrgId || connections.vercelTeamId || ids.orgId || "").trim(),
      vercelTeamId: String(connections.vercelTeamId || connections.vercelOrgId || ids.orgId || "").trim(),
    };
    report("deploy_one_click", 82, "Deploy en Vercel…");
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
        failedStep: "deploy_one_click",
        message: `[deploy_one_click] ${deployResult.message || "Deploy fallo"}`,
        deploy: deployResult,
      };
    }
    report("deploy_one_click", 96, deployResult.url ? `Deploy OK → ${deployResult.url}` : "Deploy OK");
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