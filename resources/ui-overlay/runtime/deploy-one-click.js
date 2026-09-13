"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Deploy one-click usando tokens locales (Vercel/Netlify).
 * Sin APIs de pago: usa la cuenta del usuario en Conexiones.
 */

function runProcess(command, args, { cwd, env, timeoutMs = 300_000, shell = false } = {}) {
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
      reject(new Error(`Timeout deploy (${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code) || 0, stdout, stderr });
    });
  });
}

function detectProvider(projectRoot, requested = "") {
  const forced = String(requested || "").toLowerCase().trim();
  if (forced === "vercel" || forced === "netlify") return forced;
  if (fs.existsSync(path.join(projectRoot, "vercel.json"))) return "vercel";
  if (fs.existsSync(path.join(projectRoot, "netlify.toml"))) return "netlify";
  return "vercel";
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Prefiere la carpeta de la app (con .vercel o package build), no el monorepo wrapper. */
function resolveDeployRoot(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) return root;

  const nestedVercel = [];
  const nestedBuild = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const abs = path.join(root, name);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (fs.existsSync(path.join(abs, ".vercel", "project.json"))) nestedVercel.push(abs);
      const pkg = readJsonSafe(path.join(abs, "package.json"));
      if (pkg?.scripts?.build || pkg?.scripts?.dev) nestedBuild.push(abs);
    }
  } catch { /* ignore */ }

  if (fs.existsSync(path.join(root, ".vercel", "project.json"))) return root;
  if (nestedVercel.length === 1) return nestedVercel[0];
  if (nestedBuild.length === 1) return nestedBuild[0];
  return root;
}

function readVercelIds(projectRoot, connections = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const deployRoot = resolveDeployRoot(root);
  const fromConn = {
    projectId: String(connections.vercelProjectId || "").trim(),
    orgId: String(connections.vercelOrgId || connections.vercelTeamId || "").trim(),
  };
  const infra = readJsonSafe(path.join(root, "project-infra.json"))
    || readJsonSafe(path.join(root, ".editcore", "project-infra.json"))
    || {};
  const link = readJsonSafe(path.join(deployRoot, ".vercel", "project.json"))
    || readJsonSafe(path.join(root, ".vercel", "project.json"))
    || {};
  // Prioridad: .vercel local (fuente de verdad CLI) > infra > conexiones.
  // Evita IDs stale/mock en project-infra.json que rompen el deploy.
  const projectId = String(link.projectId || infra.vercelProjectId || fromConn.projectId || "").trim();
  const orgId = String(link.orgId || fromConn.orgId || "").trim();
  return {
    deployRoot,
    projectId,
    orgId,
    projectName: String(link.projectName || infra.vercelProjectName || "").trim(),
  };
}

function summarizeDeployFailure(combined = "", exitCode = 1) {
  const text = String(combined || "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const useful = lines.filter((l) => !/^Vercel CLI/i.test(l) && !/^Retrieving project/i.test(l)).slice(-12);
  const snippet = useful.join(" | ").slice(0, 500);
  return snippet || `Deploy fallo (exit ${exitCode}).`;
}

async function deployOneClick(projectRoot, input = {}, { connections = {} } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("deploy_one_click requiere projectRoot valido.");
  const provider = detectProvider(root, input.provider);
  const production = input.production !== false;

  if (provider === "vercel") {
    const token = String(connections.vercelToken || process.env.VERCEL_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Vercel no configurado. Anade vercelToken en Conexiones (token gratis en vercel.com/account/tokens).",
      };
    }
    const ids = readVercelIds(root, connections);
    const deployRoot = ids.deployRoot || root;
    const args = ["--yes"];
    if (production) args.push("--prod");
    // En Windows: npx.cmd necesita shell, pero sin args con espacios. Preferimos node + cli.
    let command = process.platform === "win32" ? "npx.cmd" : "npx";
    let commandArgs = ["--yes", "vercel", ...args];
    let shell = process.platform === "win32";
    try {
      const vc = require.resolve("vercel/dist/vc.js");
      command = process.execPath;
      commandArgs = [vc, ...args];
      shell = false;
    } catch {
      /* usar npx global */
    }
    try {
      const result = await runProcess(command, commandArgs, {
        cwd: deployRoot,
        shell,
        env: {
          VERCEL_TOKEN: token,
          VERCEL_ORG_ID: ids.orgId,
          VERCEL_PROJECT_ID: ids.projectId,
        },
        timeoutMs: 480_000,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s"'<>]+\.vercel\.app(?:\/[^\s"'<>]*)?/i);
      const ok = result.code === 0;
      const cleanUrl = urlMatch ? urlMatch[0].replace(/[).,",']+$/g, "") : "";
      return {
        ok,
        available: true,
        provider: "vercel",
        url: cleanUrl,
        exitCode: result.code,
        deployRoot,
        projectId: ids.projectId,
        output: combined.slice(-4000),
        message: ok
          ? (cleanUrl ? `Deploy OK → ${cleanUrl}` : "Deploy OK")
          : summarizeDeployFailure(combined, result.code),
      };
    } catch (error) {
      return {
        ok: false,
        available: true,
        provider: "vercel",
        deployRoot,
        projectId: ids.projectId,
        message: String(error?.message || error).slice(0, 400),
        hint: "Instala Vercel CLI (`npm i -g vercel`) o usa el token en Conexiones.",
      };
    }
  }

  if (provider === "netlify") {
    const token = String(connections.netlifyToken || process.env.NETLIFY_AUTH_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Netlify no configurado. Anade netlifyToken en Conexiones (token personal gratis).",
      };
    }
    const args = ["deploy"];
    if (production) args.push("--prod");
    if (connections.netlifySiteId) args.push("--site", String(connections.netlifySiteId));
    args.push("--dir", String(input.dir || "dist"));
    const bin = process.platform === "win32" ? "netlify.cmd" : "netlify";
    try {
      const result = await runProcess(bin, args, {
        cwd: root,
        shell: process.platform === "win32",
        env: { NETLIFY_AUTH_TOKEN: token },
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/i);
      return {
        ok: result.code === 0,
        available: true,
        provider: "netlify",
        url: urlMatch ? urlMatch[0].replace(/[).,]+$/, "") : "",
        exitCode: result.code,
        output: combined.slice(-4000),
        message: result.code === 0 ? "Deploy OK" : summarizeDeployFailure(combined, result.code),
      };
    } catch (error) {
      return {
        ok: false,
        available: true,
        provider: "netlify",
        message: String(error?.message || error).slice(0, 400),
      };
    }
  }

  return { ok: false, available: false, provider, message: `Proveedor de deploy no soportado: ${provider}` };
}

module.exports = {
  deployOneClick,
  detectProvider,
  resolveDeployRoot,
  readVercelIds,
};
