"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function runGit(projectRoot, args = []) {
  const root = String(projectRoot || "").trim();
  if (!root) throw new Error("Proyecto invalido.");
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2_000_000,
  });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  if (result.error) throw new Error(result.error.message || String(result.error));
  if (result.status !== 0) {
    const detail = stderr || stdout || `git ${args.join(" ")} fallo`;
    const err = new Error(detail);
    err.code = result.status;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { ok: true, stdout, stderr };
}

function gitStatus(projectRoot) {
  const short = runGit(projectRoot, ["status", "--short"]);
  let branch = "HEAD";
  try {
    branch = runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "HEAD";
  } catch {
    try {
      branch = runGit(projectRoot, ["symbolic-ref", "--short", "HEAD"]).stdout || "HEAD";
    } catch {
      branch = "(sin commits)";
    }
  }
  return {
    ok: true,
    branch,
    short: short.stdout || "(limpio)",
    dirty: Boolean(short.stdout),
  };
}

function gitDiffStat(projectRoot) {
  try {
    const staged = runGit(projectRoot, ["diff", "--cached", "--stat"]);
    const unstaged = runGit(projectRoot, ["diff", "--stat"]);
    return {
      ok: true,
      staged: staged.stdout || "",
      unstaged: unstaged.stdout || "",
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * Propone mensaje de commit a partir de archivos de la ultima corrida / review.
 */
function suggestCommitMessage({ files = [], runId = "", task = "" } = {}) {
  const paths = (Array.isArray(files) ? files : [])
    .map((f) => String(f.path || f || "").replace(/\\/g, "/"))
    .filter(Boolean);
  const unique = [...new Set(paths)];
  const bases = unique.map((p) => path.posix.basename(p));
  const taskLine = String(task || "").trim().replace(/\s+/g, " ").slice(0, 72);

  let summary;
  if (taskLine) summary = taskLine;
  else if (unique.length === 1) summary = `update ${unique[0]}`;
  else if (unique.length <= 3) summary = `update ${bases.join(", ")}`;
  else summary = `update ${unique.length} files`;

  const body = unique.length
    ? unique.map((p) => `- ${p}`).join("\n")
    : "- (sin archivos listados)";

  const message = [
    summary.slice(0, 72),
    "",
    body,
    runId ? `\nRun: ${runId}` : "",
  ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === "")).join("\n").trim();

  return { ok: true, message, files: unique };
}

function gitCommit(projectRoot, message, { addPaths = [] } = {}) {
  const msg = String(message || "").trim();
  if (!msg) throw new Error("Mensaje de commit vacio.");
  if (!msg.includes("\n") && msg.length > 100) {
    throw new Error("Mensaje de commit demasiado largo (usa resumen corto).");
  }

  const status = gitStatus(projectRoot);
  if (!status.dirty && !(addPaths || []).length) {
    return { ok: false, skipped: true, message: "No hay cambios para commitear." };
  }

  let isSecretPath = (rel) => /(^|[\\/])(\.env([.\\].*)?|.*\.(pem|key|p12|pfx)|credentials\.json|secrets?\.json|id_rsa|id_ed25519)([\\/]|$)/i.test(String(rel || ""));
  try {
    ({ isSecretPath } = require("./publish-pipeline"));
  } catch { /* fallback regex arriba */ }

  const paths = (Array.isArray(addPaths) ? addPaths : []).map((p) => String(p || "").replace(/\\/g, "/")).filter(Boolean);
  let candidates = paths;
  if (!candidates.length) {
    const short = runGit(projectRoot, ["status", "--short"]).stdout || "";
    candidates = short.split(/\r?\n/).map((line) => line.slice(3).trim().replace(/^"+|"+$/g, "")).filter(Boolean);
  }
  if (!candidates.length) {
    return { ok: false, skipped: true, message: "No hay cambios para commitear." };
  }
  const blocked = candidates.filter((p) => isSecretPath(p));
  const safe = candidates.filter((p) => !isSecretPath(p));
  if (!safe.length) {
    return {
      ok: false,
      skipped: true,
      message: `Commit bloqueado: solo hay rutas sensibles (${blocked.slice(0, 4).join(", ")}).`,
      blocked,
    };
  }
  runGit(projectRoot, ["add", "--", ...safe]);
  // Por si quedaron staged secretos de antes.
  for (const file of blocked) {
    try { runGit(projectRoot, ["reset", "HEAD", "--", file]); } catch { /* ignore */ }
  }

  runGit(projectRoot, ["commit", "-m", msg]);
  let head = "";
  try {
    head = runGit(projectRoot, ["rev-parse", "--short", "HEAD"]).stdout;
  } catch {
    head = "";
  }
  return { ok: true, message: msg, head, files: safe, blockedSecrets: blocked };
}

function gitCreateBranch(projectRoot, branchName, { checkout = true } = {}) {
  const name = String(branchName || "").trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(name) || name.length > 80) {
    throw new Error("Nombre de rama invalido.");
  }
  runGit(projectRoot, ["branch", name]);
  if (checkout) runGit(projectRoot, ["checkout", name]);
  return { ok: true, branch: name, checkedOut: checkout === true };
}

function gitCheckout(projectRoot, branchName) {
  const name = String(branchName || "").trim();
  if (!name) throw new Error("Rama requerida.");
  runGit(projectRoot, ["checkout", name]);
  return { ok: true, branch: name };
}

function gitPull(projectRoot, { remote = "origin", branch = "" } = {}) {
  const args = ["pull", String(remote || "origin")];
  if (branch) args.push(String(branch));
  const out = runGit(projectRoot, args);
  return { ok: true, remote, branch: branch || "", stdout: out.stdout };
}

function gitPush(projectRoot, { remote = "origin", branch = "", setUpstream = false } = {}) {
  const args = ["push"];
  if (setUpstream) args.push("-u");
  args.push(String(remote || "origin"));
  if (branch) args.push(String(branch));
  const out = runGit(projectRoot, args);
  return { ok: true, remote, branch: branch || "", stdout: out.stdout };
}

module.exports = {
  runGit,
  gitStatus,
  gitDiffStat,
  suggestCommitMessage,
  gitCommit,
  gitCreateBranch,
  gitCheckout,
  gitPull,
  gitPush,
};
