"use strict";

/**
 * DeployBridge: git/push/deploy con args array + shell:false.
 * Nunca `git commit -m "..."` vía shell (Windows pathspec).
 */

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function redact(value) {
  const text = String(value || "");
  return text
    .replace(/(ghp_|github_pat_|glpat-)[A-Za-z0-9_]+/g, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***");
}

function runArgs(command, args, { cwd, env, timeoutMs = 180_000 } = {}) {
  const spawned = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 4_000_000,
  });
  return {
    ok: spawned.status === 0,
    code: spawned.status,
    stdout: redact(spawned.stdout || "").slice(0, 12_000),
    stderr: redact(spawned.stderr || "").slice(0, 8_000),
    message: spawned.status === 0
      ? "OK"
      : redact(spawned.stderr || spawned.stdout || `exit ${spawned.status}`),
  };
}

function gitBin() {
  return process.platform === "win32" ? "git.exe" : "git";
}

function commitWithMessageFile(cwd, message) {
  const msg = String(message || "").trim() || `EDITCOREAI update ${new Date().toISOString().slice(0, 19)}`;
  const msgFile = path.join(cwd, ".git", "EDITCOREAI_COMMIT_MSG.tmp");
  fs.mkdirSync(path.dirname(msgFile), { recursive: true });
  fs.writeFileSync(msgFile, `${msg}\n`, "utf8");
  try {
    return runArgs(gitBin(), ["commit", "-F", msgFile], { cwd });
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
}

class DeployBridge {
  /**
   * @param {string} projectRoot
   * @param {{ githubToken?: string, vercelToken?: string, ssh?: string, serverHost?: string, serverKeyPath?: string }} [credentials]
   */
  constructor(projectRoot, credentials = {}) {
    this.projectRoot = path.resolve(String(projectRoot || ""));
    this.credentials = credentials && typeof credentials === "object" ? { ...credentials } : {};
  }

  pushToGitHub(commitMessage = "Actualización autónoma desde EDITCOREAI") {
    const env = { ...process.env };
    if (this.credentials.githubToken) {
      env.GIT_ASKPASS = "echo";
      env.GITHUB_TOKEN = String(this.credentials.githubToken);
    }
    const add = runArgs(gitBin(), ["add", "-A"], { cwd: this.projectRoot });
    if (!add.ok) return { success: false, error: add.message };
    const commit = commitWithMessageFile(this.projectRoot, commitMessage);
    if (!commit.ok && !/nothing to commit/i.test(commit.message)) {
      return { success: false, error: commit.message };
    }
    const push = runArgs(gitBin(), ["push"], { cwd: this.projectRoot, env });
    return push.ok
      ? { success: true, message: "Código sincronizado con GitHub." }
      : { success: false, error: push.message };
  }

  deployToVercel() {
    if (!this.credentials.vercelToken) {
      return { success: false, error: "Falta vercelToken en bóveda (safeStorage)." };
    }
    const env = {
      ...process.env,
      VERCEL_TOKEN: String(this.credentials.vercelToken),
    };
    const result = runArgs(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vercel", "--prod", "--yes"],
      { cwd: this.projectRoot, env },
    );
    return result.ok
      ? { success: true, output: result.stdout, message: "Despliegue Vercel completado." }
      : { success: false, error: result.message };
  }

  deployToRemoteServer(remoteCommand) {
    const sshTarget = String(this.credentials.ssh || this.credentials.serverHost || "").trim();
    const keyPath = String(this.credentials.serverKeyPath || "").trim();
    if (!sshTarget) return { success: false, error: "Credenciales SSH no configuradas en bóveda." };
    const args = ["-o", "BatchMode=yes"];
    if (keyPath) args.push("-i", keyPath);
    args.push(sshTarget, String(remoteCommand || ""));
    const result = runArgs("ssh", args, { cwd: this.projectRoot });
    return result.ok
      ? { success: true, output: result.stdout, message: "Comando SSH ejecutado." }
      : { success: false, error: result.message };
  }
}

function createDeployBridgeFromConnections(projectRoot, connections = {}) {
  return new DeployBridge(projectRoot, {
    githubToken: connections.githubToken || "",
    vercelToken: connections.vercelToken || "",
    ssh: connections.serverHost || "",
    serverHost: connections.serverHost || "",
    serverKeyPath: connections.serverKeyPath || "",
  });
}

module.exports = DeployBridge;
module.exports.DeployBridge = DeployBridge;
module.exports.createDeployBridgeFromConnections = createDeployBridgeFromConnections;
module.exports.commitWithMessageFile = commitWithMessageFile;
