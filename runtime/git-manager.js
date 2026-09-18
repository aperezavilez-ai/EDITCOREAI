const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(args, cwd) {
  try {
    const out = execSync(`git ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || "").toString().trim(),
      stderr: (error.stderr || "").toString().trim(),
      message: error.message,
    };
  }
}

function ensureRepo(cwd) {
  const repo = cwd || process.cwd();
  const gitDir = path.join(repo, ".git");
  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: `No es un repositorio Git: ${repo}` };
  }
  return { ok: true, repo };
}

function getStatus(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const raw = git("status --porcelain=v1 -b", repo.repo);
  if (!raw.ok) return raw;
  const lines = raw.stdout.split("\n").filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const branch = branchLine ? branchLine.replace("## ", "").trim() : null;
  const changes = lines
    .filter((line) => !line.startsWith("## "))
    .map((line) => {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      return { status, file };
    });
  return { ok: true, repo: repo.repo, branch, changes };
}

function stageFiles(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, message: "No se indicaron archivos para stage." };
  }
  const escaped = files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" ");
  return git(`add ${escaped}`, repo.repo);
}

function unstageFiles(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, message: "No se indicaron archivos para unstage." };
  }
  const escaped = files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" ");
  return git(`restore --staged ${escaped}`, repo.repo);
}

function commit(message, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!message || typeof message !== "string") {
    return { ok: false, message: "El mensaje de commit es obligatorio." };
  }
  const escaped = `"${message.replace(/"/g, '\\"')}"`;
  return git(`commit -m ${escaped}`, repo.repo);
}

function getBranches(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const raw = git("branch --list --all", repo.repo);
  if (!raw.ok) return raw;
  const branches = raw.stdout
    .split("\n")
    .map((line) => line.replace(/^\*\s+/, "").trim())
    .filter(Boolean);
  return { ok: true, repo: repo.repo, branches };
}

function createBranch(name, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!name || typeof name !== "string") {
    return { ok: false, message: "El nombre de rama es obligatorio." };
  }
  const escaped = `"${name.replace(/"/g, '\\"')}"`;
  return git(`branch ${escaped}`, repo.repo);
}

function checkoutBranch(name, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!name || typeof name !== "string") {
    return { ok: false, message: "El nombre de rama es obligatorio." };
  }
  const escaped = `"${name.replace(/"/g, '\\"')}"`;
  return git(`checkout ${escaped}`, repo.repo);
}

function getDiff(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const target = Array.isArray(files) && files.length > 0
    ? ` -- ${files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" ")}`
    : "";
  const staged = git(`diff --cached${target}`, repo.repo);
  const unstaged = git(`diff${target}`, repo.repo);
  return {
    ok: staged.ok && unstaged.ok,
    repo: repo.repo,
    staged: staged.stdout,
    unstaged: unstaged.stdout,
    stagedError: staged.stderr,
    unstagedError: unstaged.stderr,
  };
}

function getCommitHistory(limit, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const count = typeof limit === "number" && Number.isFinite(limit) ? limit : 20;
  const raw = git(`log --oneline -n ${count}`, repo.repo);
  if (!raw.ok) return raw;
  const commits = raw.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split(" ");
      return { hash, message: rest.join(" ") };
    });
  return { ok: true, repo: repo.repo, commits };
}

function push(remote, branch, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const remoteName = typeof remote === "string" && remote.trim() ? remote : "origin";
  const branchName = typeof branch === "string" && branch.trim() ? branch : "";
  const target = branchName ? `"${branchName.replace(/"/g, '\\"')}"` : "";
  const args = branchName ? `push "${remoteName}" ${target}` : `push "${remoteName}"`;
  return git(args, repo.repo);
}

function pull(remote, branch, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const remoteName = typeof remote === "string" && remote.trim() ? remote : "origin";
  const branchName = typeof branch === "string" && branch.trim() ? branch : "";
  const target = branchName ? `"${branchName.replace(/"/g, '\\"')}"` : "";
  const args = branchName ? `pull "${remoteName}" ${target}` : `pull "${remoteName}"`;
  return git(args, repo.repo);
}

function detectLocalChanges(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const status = getStatus(repo.repo);
  if (!status.ok) return status;
  const hasChanges = status.changes.length > 0;
  return {
    ok: true,
    repo: repo.repo,
    hasChanges,
    changes: status.changes,
    branch: status.branch,
  };
}

module.exports = {
  getStatus,
  stageFiles,
  unstageFiles,
  commit,
  getBranches,
  createBranch,
  checkoutBranch,
  getDiff,
  getCommitHistory,
  push,
  pull,
  detectLocalChanges,
};
