"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function runCapture(command, args, { cwd, env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
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

async function git(cwd, args, opts = {}) {
  const bin = process.platform === "win32" ? "git.exe" : "git";
  return runCapture(bin, args, { cwd, ...opts });
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
};
