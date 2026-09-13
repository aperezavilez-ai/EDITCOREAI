"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function parseSshHost(hostSpec = "") {
  const raw = String(hostSpec || "").trim();
  if (!raw) return null;
  let user = "";
  let host = raw;
  let port = "22";
  if (raw.includes("@")) {
    [user, host] = raw.split("@", 2);
  }
  if (host.includes(":")) {
    const parts = host.split(":");
    host = parts[0];
    port = parts[1] || "22";
  }
  return { user: user || "root", host, port };
}

function runSsh(connections, remoteCommand, { timeoutMs = 300_000 } = {}) {
  const host = parseSshHost(connections.serverHost);
  const keyPath = String(connections.serverKeyPath || "").trim();
  if (!host || !keyPath || !fs.existsSync(keyPath)) {
    return Promise.resolve({ ok: false, message: "SSH no configurado o clave inexistente." });
  }
  const args = [
    "-i", keyPath,
    "-p", host.port,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    `${host.user}@${host.host}`,
    remoteCommand,
  ];
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, message: "SSH timeout", stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: error?.message || String(error), stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: Number(code) || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        message: code === 0 ? "SSH OK" : (stderr || stdout || `SSH exit ${code}`),
      });
    });
  });
}

async function sshDeploy(projectRoot, connections, {
  remotePath = "",
  restartCommand = "sudo systemctl restart app || pm2 restart all || true",
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const name = path.basename(root);
  const target = String(remotePath || connections.serverDeployPath || `/var/www/${name}`).trim();
  const syncCmd = [
    `mkdir -p ${target}`,
    `cd ${target} && git pull origin HEAD || true`,
    restartCommand,
  ].join(" && ");
  const result = await runSsh(connections, syncCmd);
  return {
    ...result,
    remotePath: target,
    host: connections.serverHost || "",
  };
}

module.exports = {
  parseSshHost,
  runSsh,
  sshDeploy,
};
