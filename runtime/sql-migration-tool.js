"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function deriveContainerName(projectRoot) {
  const base = path.basename(String(projectRoot || "")).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!base) throw new Error("No se pudo derivar el nombre del contenedor.");
  return base + "-db";
}

function validateSql(sql) {
  const s = String(sql || "").trim();
  if (!s) throw new Error("SQL vacío.");
  if (s.length > 500000) throw new Error("SQL demasiado grande.");
  return s;
}

async function runRemoteSql({ projectRoot, sql, connections, dryRun = true }) {
  const container = deriveContainerName(projectRoot);
  const sqlClean = validateSql(sql);

  if (dryRun) {
    return { ok: true, dryRun: true, container, sqlBytes: Buffer.byteLength(sqlClean, "utf8"), preview: sqlClean.slice(0, 400) };
  }

  const host = String(connections?.serverHost || "").trim();
  const keyPath = String(connections?.serverKeyPath || "").trim();
  if (!host) throw new Error("Falta serverHost en la bóveda.");
  if (!keyPath || !fs.existsSync(keyPath)) throw new Error("Falta serverKeyPath o el archivo no existe.");

  const sshArgs = ["-i", keyPath, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", host];
  const remoteCmd = `docker exec -i ${container} psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f -`;

  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshArgs, remoteCmd], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Timeout 60s.")); }, 60000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, container, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 2000) });
      else reject(new Error(`ssh exit ${code}. stderr: ${stderr.slice(0, 800)}`));
    });
    child.stdin.write(sqlClean);
    child.stdin.end();
  });
}

module.exports = { runRemoteSql, deriveContainerName, validateSql };
