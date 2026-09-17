"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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

/** Node real del sistema (nunca el host Electron: eso provoca spawn EINVAL / arranques raros). */
function resolveSystemNode() {
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "nodejs", "node.exe"),
      path.join(os.homedir(), "scoop", "apps", "nodejs", "current", "node.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/node", "/usr/bin/node");
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const exe = String(process.execPath || "");
  if (exe && !/electron|EDITCOREAI-host/i.test(exe)) return exe;
  return process.platform === "win32" ? "node.exe" : "node";
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
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
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
  const orgId = String(
    link.orgId
    || infra.vercelOrgId
    || infra.vercelTeamId
    || fromConn.orgId
    || "",
  ).trim();
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

function sanitizeEnv(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
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
        message: "Vercel no configurado. Añade el token en Conexiones (vercel.com/account/tokens).",
      };
    }
    const ids = readVercelIds(root, connections);
    const deployRoot = ids.deployRoot || root;
    const vercelArgs = ["--yes"];
    if (production) vercelArgs.push("--prod");
    let command;
    let commandArgs;
    let shell = false;
    // Preferir vercel empaquetado en EditCoreAI + Node del sistema (nunca Electron host).
    const nodeBin = resolveSystemNode();
    let vcJs = "";
    try {
      vcJs = require.resolve("vercel/dist/vc.js");
    } catch {
      const localVc = path.join(__dirname, "..", "node_modules", "vercel", "dist", "vc.js");
      if (fs.existsSync(localVc)) vcJs = localVc;
    }
    if (vcJs) {
      command = nodeBin;
      commandArgs = [vcJs, ...vercelArgs];
      shell = false;
    } else if (process.platform === "win32") {
      const comspec = process.env.ComSpec || "cmd.exe";
      command = comspec;
      commandArgs = ["/d", "/s", "/c", ["npx", "--yes", "vercel", ...vercelArgs].join(" ")];
      shell = false;
    } else {
      command = "npx";
      commandArgs = ["--yes", "vercel", ...vercelArgs];
      shell = false;
    }
    try {
      const result = await runProcess(command, commandArgs, {
        cwd: deployRoot,
        shell,
        env: sanitizeEnv((() => {
          const envExtra = { VERCEL_TOKEN: token };
          // Vercel exige ORG_ID + PROJECT_ID juntos; si falta uno, no enviar ninguno
          // y dejar que la CLI use .vercel/project.json del cwd.
          if (ids.projectId && ids.orgId) {
            envExtra.VERCEL_PROJECT_ID = ids.projectId;
            envExtra.VERCEL_ORG_ID = ids.orgId;
          }
          return envExtra;
        })()),
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
      const msg = String(error?.message || error).slice(0, 400);
      return {
        ok: false,
        available: true,
        provider: "vercel",
        deployRoot,
        projectId: ids.projectId,
        message: /EINVAL/i.test(msg)
          ? "No se pudo lanzar Vercel CLI en Windows (spawn EINVAL). Revisa que Node/npx estén en PATH o reinstala Node.js."
          : msg,
        hint: "Instala Node.js + Vercel CLI (`npm i -g vercel`) y verifica el token en Conexiones.",
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
    try {
      const result = await runProcess(
        process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "netlify",
        process.platform === "win32"
          ? ["/d", "/s", "/c", ["netlify", ...args].join(" ")]
          : args,
        {
          cwd: root,
          shell: false,
          env: sanitizeEnv({ NETLIFY_AUTH_TOKEN: token }),
        },
      );
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
  resolveSystemNode,
};
