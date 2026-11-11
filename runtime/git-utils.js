"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Ejecuta un comando capturando stdout/stderr.
 * shell=false por defecto: en Windows shell:true rompe `git commit -m "msg con espacios"`
 * (cmd re-parsea y cada palabra vira pathspec).
 */
function runCapture(command, args, { cwd, env, timeoutMs = 120_000, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: shell === true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout: ${command} ${args.join(" ")}`));
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

// [EDITCORE-DESBLOQUEOS] Contención de index.lock: git se niega a arrancar
// si otro proceso tiene .git/index.lock («Unable to create '…/index.lock':
// File exists» / «Another git process seems to be running»). Ese fallo
// significa que el comando NO se ejecutó, así que reintentarlo tras una
// espera corta es seguro. JAMÁS se borra el lock: si un proceso vivo lo
// tiene, borrarlo corrompe el índice.
const GIT_INDEX_LOCK_RE = /index\.lock/i;

function isGitIndexLockError(result) {
  if (!result || result.code === 0) return false;
  return GIT_INDEX_LOCK_RE.test(`${result.stderr || ""}\n${result.stdout || ""}`);
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withGitLockRetry(run, { retries = 0, delayMs = 1500, sleepFn = sleepMs } = {}) {
  let result = await run();
  for (let attempt = 0; attempt < retries && isGitIndexLockError(result); attempt += 1) {
    await sleepFn(delayMs);
    result = await run();
  }
  return result;
}

async function git(cwd, args, opts = {}) {
  // Nunca shell:true con git en Windows — destroza -m / pathspecs.
  const bin = process.platform === "win32" ? "git.exe" : "git";
  // [EDITCORE-DESBLOQUEOS] lockRetries es opt-in (defecto 0 = comportamiento
  // histórico intacto para todos los consumidores de git()); solo la ruta
  // de publicación lo activa.
  const { lockRetries = 0, lockRetryDelayMs = 1500, ...captureOpts } = opts || {};
  const run = () => runCapture(bin, args, { cwd, shell: false, ...captureOpts, shell: false });
  if (lockRetries > 0) return withGitLockRetry(run, { retries: lockRetries, delayMs: lockRetryDelayMs });
  return run();
}

function findGitRoot(startPath) {
  let current = path.resolve(String(startPath || ""));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return "";
}

async function detectBranch(gitRoot) {
  const symbolic = await git(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (symbolic.code === 0 && symbolic.stdout && symbolic.stdout !== "HEAD") {
    return symbolic.stdout;
  }
  const branch = await git(gitRoot, ["branch", "--show-current"]);
  if (branch.code === 0 && branch.stdout) return branch.stdout;
  return "HEAD";
}

async function hasUpstream(gitRoot, branch) {
  const result = await git(gitRoot, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
  return result.code === 0 && Boolean(result.stdout);
}

module.exports = {
  runCapture,
  git,
  findGitRoot,
  detectBranch,
  hasUpstream,
  // [EDITCORE-DESBLOQUEOS]
  isGitIndexLockError,
  withGitLockRetry,
};
