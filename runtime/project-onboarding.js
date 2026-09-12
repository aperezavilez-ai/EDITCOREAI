"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { provisionProject } = require("./project-provision");
const { createSupabaseProject } = require("./supabase-provision");
const { connectionSummary } = require("../service-harness");
const { appendAuditEvent } = require("./project-audit");

function runCapture(command, args, { cwd, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout: ${command}`));
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

function detectPackageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * Instala dependencias si hay package.json y node_modules falta o esta vacio.
 */
async function installProjectDependencies(projectRoot, { force = false } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { ok: true, skipped: true, message: "Sin package.json; dependencias omitidas." };
  }
  const nodeModules = path.join(root, "node_modules");
  if (!force && fs.existsSync(nodeModules)) {
    try {
      const entries = fs.readdirSync(nodeModules);
      if (entries.length > 0) {
        return { ok: true, skipped: true, message: "node_modules ya existe; install omitido." };
      }
    } catch {
      // continuar con install
    }
  }
  const pm = detectPackageManager(root);
  const commands = {
    npm: ["npm", ["install"]],
    pnpm: ["pnpm", ["install"]],
    yarn: ["yarn", ["install"]],
    bun: ["bun", ["install"]],
  };
  const [bin, args] = commands[pm] || commands.npm;
  const resolved = process.platform === "win32" && !bin.includes(path.sep) ? `${bin}.cmd` : bin;
  try {
    const result = await runCapture(resolved, args, { cwd: root });
    return {
      ok: result.code === 0,
      skipped: false,
      packageManager: pm,
      code: result.code,
      message: result.code === 0 ? `Dependencias instaladas (${pm}).` : (result.stderr || result.stdout || `install fallo (${pm})`),
    };
  } catch (error) {
    return { ok: false, skipped: false, message: error?.message || String(error) };
  }
}

/**
 * Onboarding completo de proyecto nuevo:
 * dependencias → Supabase GafCore → GitHub/Vercel/env → GafCore Gateway → publicar opcional.
 */
async function onboardProject(projectRoot, connections = {}, {
  localProjectId = "",
  projectName = "",
  installDeps = true,
  bootstrapSupabase = true,
  connectServices = true,
  connectGateway = true,
  firstDeploy = false,
  initialBalanceUsd = 0,
  adminToken = "",
  repoName = "",
  connectGatewayProject = null,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  const name = projectName || path.basename(root);
  const summary = connectionSummary(connections);

  const fail = (step, message, extra = {}) => ({
    ok: false,
    completed: false,
    projectRoot: root,
    steps: [...steps, { step, ok: false, message, ...extra }],
    message,
  });

  if (!root || !fs.existsSync(root)) return fail("root", "projectRoot invalido.");

  try {
    const { assertProjectConnectionTarget } = require("./project-connection-isolation");
    assertProjectConnectionTarget(root, {
      supabaseUrl: connections.selfSupabaseUrl || connections.supabaseUrl || "",
      supabaseProjectId: connections.supabaseProjectId || connections.gafcoreProjectId || "",
      gatewayUrl: connections.gafcoreGateway || connections.gatewayUrl || "",
    });
  } catch (error) {
    return fail("connection_isolation", error?.message || String(error), { code: error?.code || "PROJECT_CONNECTION_MISMATCH" });
  }

  if (installDeps) {
    const deps = await installProjectDependencies(root);
    steps.push({ step: "install_dependencies", ...deps });
    if (!deps.ok && !deps.skipped) return fail("install_dependencies", deps.message || "Fallo npm install.");
  }

  if (bootstrapSupabase && summary.selfsupabase.configured) {
    const supabase = await createSupabaseProject(root, connections, {
      projectName: name,
      useCloud: false,
      pushDb: true,
    });
    steps.push({ step: "supabase_bootstrap", ok: supabase.ok, message: supabase.message, detail: supabase.steps?.length || 0 });
    if (!supabase.ok) return fail("supabase_bootstrap", supabase.message || "Supabase bootstrap fallo.");
  } else if (bootstrapSupabase) {
    steps.push({ step: "supabase_bootstrap", ok: true, skipped: true, message: "Supabase propio no configurado en Conexiones." });
  }

  if (connectServices) {
    const provisioned = await provisionProject(root, connections, {
      repoName: repoName || name,
      syncVercel: true,
      manageSupabase: true,
      validateBeforePublish: !firstDeploy,
      firstDeploy,
      sshAfterPublish: false,
      commitMessage: `chore: onboard ${name}`,
    });
    steps.push(...(provisioned.steps || []).map((item) => ({ ...item, phase: "provision" })));
    if (!provisioned.ok) {
      return {
        ok: false,
        completed: false,
        projectRoot: root,
        steps,
        message: provisioned.message || "Aprovisionamiento fallo.",
        provision: provisioned,
      };
    }
  }

  if (connectGateway) {
    if (typeof connectGatewayProject !== "function") {
      steps.push({ step: "gafcore_gateway", ok: true, skipped: true, message: "Gateway no disponible en este contexto." });
    } else {
      try {
        const gateway = await connectGatewayProject({
          localProjectId: String(localProjectId || `root:${name}`),
          projectRoot: root,
          projectName: name,
          initialBalanceUsd: Number(initialBalanceUsd) || 0,
          adminToken: String(adminToken || "").trim(),
        });
        steps.push({
          step: "gafcore_gateway",
          ok: gateway?.connected === true || Boolean(gateway?.projectId),
          reused: gateway?.reused === true,
          projectId: gateway?.projectId || "",
          modelCount: gateway?.modelCount || 0,
          message: gateway?.connected ? "Proyecto conectado a GafCore Gateway." : (gateway?.message || "Gateway sin conectar."),
        });
      } catch (error) {
        const msg = error?.message || String(error);
        const softSkip = /falta el token administrativo|gateway no/i.test(msg);
        steps.push({ step: "gafcore_gateway", ok: softSkip, skipped: softSkip, message: msg });
        if (!softSkip) return fail("gafcore_gateway", msg);
      }
    }
  }

  const checklist = {
    dependencies: steps.some((item) => item.step === "install_dependencies" && (item.ok || item.skipped)),
    supabase: steps.some((item) => item.step === "supabase_bootstrap" && (item.ok || item.skipped)),
    github: summary.github.configured,
    vercel: summary.vercel.configured,
    gateway: steps.some((item) => item.step === "gafcore_gateway" && item.ok),
    published: firstDeploy,
  };

  appendAuditEvent(root, {
    action: "onboard",
    ok: true,
    message: "Proyecto onboarded.",
    steps: steps.map((item) => ({ step: item.step, ok: item.ok !== false })),
  });

  return {
    ok: true,
    completed: true,
    projectRoot: root,
    steps,
    checklist,
    message: firstDeploy
      ? "Proyecto creado, conectado y publicado."
      : "Proyecto onboarded: dependencias, Supabase GafCore, GitHub/Vercel y Gateway.",
  };
}

module.exports = {
  detectPackageManager,
  installProjectDependencies,
  onboardProject,
};
