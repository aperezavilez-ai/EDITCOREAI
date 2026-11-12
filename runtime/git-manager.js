"use strict";

// [EDITCORE-INTEGRAL-B8] UNA SOLA PILA GIT PARA EL AGENTE. Este
// módulo (el que usan el kernel vía tools.js y los IPC git:* de
// main.js) converge al patrón seguro ya probado de agent-git.js /
// publish-pipeline / git-utils.js:
//   - ejecución con argumentos en ARRAY y shell:false (git-utils.git):
//     ningún mensaje, rama o ruta se interpola jamás en un string de
//     shell — en Windows %, $(), backticks y saltos ya no inyectan;
//   - el mensaje de commit viaja por ARCHIVO TEMPORAL con -F, no -m;
//   - filtro de secretos al stagear: UNA sola implementación,
//     isSecretPath de publish-pipeline.js (la misma que usa
//     agent-git.js) — .env/.pem/credentials.json jamás entran en un
//     commit del agente, ni siquiera con files:["."];
//   - retry de index.lock ACTIVADO (lockRetries:2, vía
//     withGitLockRetry de git-utils): el lock NUNCA se borra;
//   - el error que recibe el modelo/usuario es LEGIBLE: qué comando
//     falló, con qué código y la salida relevante — no el message
//     crudo de execSync.
// Todas las funciones son ahora async (git-utils es async); los
// llamadores (tools.js, handlers IPC de main.js) ya son async.

const fs = require("node:fs");
const path = require("node:path");
const { git: gitRun } = require("./git-utils");
const { isSecretPath } = require("./publish-pipeline");

const LOCK_OPTS = { lockRetries: 2, lockRetryDelayMs: 1500 };

function readableGitError(args, result) {
  const cmd = `git ${args.join(" ")}`;
  const detail = String(result?.stderr || result?.stdout || "").trim().slice(-600);
  return `${cmd} falló (código ${result?.code ?? "?"}).${detail ? ` Salida: ${detail}` : ""}`;
}

async function git(args, cwd, opts = {}) {
  const result = await gitRun(cwd, args, { ...LOCK_OPTS, ...opts });
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "", code: 0 };
  }
  const message = readableGitError(args, result);
  return { ok: false, stdout: result.stdout || "", stderr: result.stderr || "", code: result.code, message };
}

function ensureRepo(cwd) {
  const repo = cwd || process.cwd();
  const gitDir = path.join(repo, ".git");
  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: `No es un repositorio Git: ${repo}` };
  }
  return { ok: true, repo };
}

async function getStatus(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const raw = await git(["status", "--porcelain=v1", "-b"], repo.repo);
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

// [EDITCORE-INTEGRAL-B8] Expande "." / directorios a la lista real de
// cambios (porcelain -uall) para poder aplicar el filtro de secretos
// archivo a archivo: `git add .` a ciegas ya no existe en esta pila.
async function expandStageCandidates(files, repo) {
  const wantsAll = files.some((f) => f === "." || f === "./");
  if (!wantsAll) return files.slice();
  const status = await git(["status", "--porcelain", "-uall"], repo);
  if (!status.ok) return null;
  const fromStatus = status.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const raw = line.slice(3).trim().replace(/^"+|"+$/g, "");
    return raw.includes(" -> ") ? raw.split(" -> ").pop().trim() : raw;
  }).filter(Boolean);
  const explicit = files.filter((f) => f !== "." && f !== "./");
  return [...new Set([...fromStatus, ...explicit])];
}

async function stageFiles(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, message: "No se indicaron archivos para stage." };
  }
  const candidates = await expandStageCandidates(files.map((f) => String(f || "")).filter(Boolean), repo.repo);
  if (!candidates) {
    return { ok: false, message: "git status falló al expandir los archivos para stage." };
  }
  // [EDITCORE-INTEGRAL-B8] Filtro de secretos compartido: los
  // bloqueados no se stagean y, si ya estaban staged de antes, se
  // retiran del índice (reset), como hace agent-git.
  const blockedSecrets = candidates.filter((f) => isSecretPath(f));
  const safe = candidates.filter((f) => !isSecretPath(f));
  for (const file of blockedSecrets) {
    await git(["reset", "HEAD", "--", file], repo.repo).catch(() => null);
  }
  if (!safe.length) {
    return {
      ok: false,
      message: blockedSecrets.length
        // [EDITCORE-V491-E] Conducción: este bloqueo es SOLO sobre las
        // rutas sensibles pedidas, no sobre el commit en general. En
        // vivo (v4.9.0, batería B8) el modelo acotó el commit al .env,
        // leyó «Stage bloqueado» como «commit imposible» y revirtió la
        // creación del archivo. El mensaje ahora instruye la salida:
        // commitear el conjunto completo y dejar que el filtro excluya.
        ? `Stage bloqueado para estas rutas sensibles (${blockedSecrets.slice(0, 4).join(", ")}), que nunca se commitean. Esto NO significa que el commit sea imposible: si el pedido era commitear TODOS los cambios, vuelve a llamar git_commit SIN acotar el commit a estas rutas (files: ["."] o sin files): el filtro excluye las sensibles y commitea el resto. No reviertas la creación de estos archivos por este motivo.`
        : "No hay archivos para stage.",
      staged: [],
      blockedSecrets,
    };
  }
  const res = await git(["add", "--", ...safe], repo.repo);
  return { ...res, staged: res.ok ? safe : [], blockedSecrets };
}

async function unstageFiles(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, message: "No se indicaron archivos para unstage." };
  }
  return git(["restore", "--staged", "--", ...files.map((f) => String(f))], repo.repo);
}

async function commit(message, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!message || typeof message !== "string") {
    return { ok: false, message: "El mensaje de commit es obligatorio." };
  }
  // [EDITCORE-INTEGRAL-B8] Mensaje vía -F (archivo temporal): comillas,
  // %, $() y saltos del mensaje son DATOS, nunca shell.
  const msgFile = path.join(repo.repo, ".git", "EDITCOREAI_COMMIT_MSG.tmp");
  fs.writeFileSync(msgFile, `${message}\n`, "utf8");
  try {
    const res = await git(["commit", "-F", msgFile], repo.repo);
    return res.ok ? { ...res, message: res.stdout || "Commit creado." } : res;
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
}

async function getBranches(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const raw = await git(["branch", "--list", "--all"], repo.repo);
  if (!raw.ok) return raw;
  const branches = raw.stdout
    .split("\n")
    .map((line) => line.replace(/^\*\s+/, "").trim())
    .filter(Boolean);
  return { ok: true, repo: repo.repo, branches };
}

async function createBranch(name, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!name || typeof name !== "string") {
    return { ok: false, message: "El nombre de rama es obligatorio." };
  }
  return git(["branch", name], repo.repo);
}

async function checkoutBranch(name, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  if (!name || typeof name !== "string") {
    return { ok: false, message: "El nombre de rama es obligatorio." };
  }
  return git(["checkout", name], repo.repo);
}

async function getDiff(files, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const target = Array.isArray(files) && files.length > 0 ? ["--", ...files.map((f) => String(f))] : [];
  const staged = await git(["diff", "--cached", ...target], repo.repo);
  const unstaged = await git(["diff", ...target], repo.repo);
  return {
    ok: staged.ok && unstaged.ok,
    repo: repo.repo,
    staged: staged.stdout,
    unstaged: unstaged.stdout,
    stagedError: staged.stderr,
    unstagedError: unstaged.stderr,
  };
}

async function getCommitHistory(limit, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const count = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
  const raw = await git(["log", "--oneline", "-n", String(count)], repo.repo);
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

async function push(remote, branch, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const remoteName = typeof remote === "string" && remote.trim() ? remote : "origin";
  let branchName = typeof branch === "string" && branch.trim() ? branch : "";
  if (!branchName) {
    const status = await getStatus(repo.repo);
    if (status.ok && status.branch) {
      branchName = status.branch.split("...")[0].trim();
    }
  }
  const args = branchName ? ["push", remoteName, branchName] : ["push", remoteName];
  return git(args, repo.repo);
}

async function pull(remote, branch, cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const remoteName = typeof remote === "string" && remote.trim() ? remote : "origin";
  const branchName = typeof branch === "string" && branch.trim() ? branch : "";
  const args = branchName ? ["pull", remoteName, branchName] : ["pull", remoteName];
  return git(args, repo.repo);
}

async function detectLocalChanges(cwd) {
  const repo = ensureRepo(cwd);
  if (!repo.ok) return repo;
  const status = await getStatus(repo.repo);
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
  // [EDITCORE-INTEGRAL-B8] Costuras para pruebas de comportamiento.
  isSecretPath,
  readableGitError,
};
