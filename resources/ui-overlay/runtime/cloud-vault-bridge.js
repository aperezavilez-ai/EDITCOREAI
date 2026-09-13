"use strict";

/**
 * Puente bóveda (safeStorage / Conexiones) ↔ herramientas de nube del agente.
 * Nunca expone tokens en resultados destinables al chat; escribe secretos solo en .env.local.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_GAFCORE_ORIGIN = "https://gafcore-gateway.vercel.app";
const SECRET_KEY_RE = /(?:token|secret|password|api[_-]?key|project[_-]?key|authorization|bearer|credential)/i;

function maskSecret(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

function redactDeep(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^(ghp_|gho_|github_pat_|sk-|vk_|eyJ|sbp_)/i.test(value) || value.length > 40 && /[A-Za-z0-9_-]{32,}/.test(value)) {
      return maskSecret(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? (item ? maskSecret(String(item)) : "") : redactDeep(item, depth + 1);
    }
    return out;
  }
  return value;
}

function createCloudVaultBridge(deps = {}) {
  const getConnections = typeof deps.getConnections === "function"
    ? deps.getConnections
    : () => ({});
  const getGatewayAdminToken = typeof deps.getGatewayAdminToken === "function"
    ? deps.getGatewayAdminToken
    : () => "";
  const connectGatewayProject = typeof deps.connectGatewayProject === "function"
    ? deps.connectGatewayProject
    : null;
  const gatewayOrigin = String(deps.gatewayOrigin || process.env.GAFCORE_GATEWAY_URL || DEFAULT_GAFCORE_ORIGIN).replace(/\/+$/, "");

  function vaultStatus() {
    const c = getConnections() || {};
    return {
      ok: true,
      github: Boolean(String(c.githubToken || "").trim()),
      vercel: Boolean(String(c.vercelToken || "").trim()),
      supabase: Boolean(String(c.selfSupabaseUrl || "").trim() && String(c.selfSupabaseKey || "").trim()),
      gafcoreAdmin: Boolean(String(getGatewayAdminToken() || "").trim()),
      gatewayOrigin,
      note: "Tokens viven en safeStorage; no se listan en claro.",
    };
  }

  /** Credenciales internas (solo para runtime). No pasar al chat. */
  function getVaultCredentials(service = "") {
    const c = getConnections() || {};
    const name = String(service || "").toLowerCase();
    if (name === "github") {
      const token = String(c.githubToken || "").trim();
      if (!token) throw new Error("GitHub no configurado en Conexiones (bóveda).");
      return { service: "github", token };
    }
    if (name === "vercel") {
      const token = String(c.vercelToken || "").trim();
      if (!token) throw new Error("Vercel no configurado en Conexiones (bóveda).");
      return { service: "vercel", token };
    }
    if (name === "supabase" || name === "selfsupabase") {
      const url = String(c.selfSupabaseUrl || "").trim();
      const key = String(c.selfSupabaseKey || "").trim();
      if (!url || !key) throw new Error("Supabase GafCore no configurado en Conexiones (bóveda).");
      return { service: "supabase", url, key };
    }
    if (name === "gafcore" || name === "gateway") {
      const token = String(getGatewayAdminToken() || "").trim();
      if (!token) throw new Error("Falta admin token de GafCore Gateway en la bóveda.");
      return { service: "gafcore", adminToken: token, origin: gatewayOrigin };
    }
    throw new Error(`Servicio de bóveda desconocido: ${service}`);
  }

  function readProjectInfra(projectRoot = "") {
    const { readProjectInfra: readInfra } = require("./project-connection-isolation");
    return readInfra(projectRoot);
  }

  function writeProjectInfra(projectRoot, infra = {}) {
    const { writeProjectInfra: writeInfra } = require("./fullstack-deploy");
    return writeInfra(projectRoot, infra);
  }

  function mergeProjectInfra(projectRoot, patch = {}) {
    const prev = readProjectInfra(projectRoot)?.data || {};
    return writeProjectInfra(projectRoot, { ...prev, ...patch });
  }

  function formatInfraForPrompt(projectRoot = "") {
    const loaded = readProjectInfra(projectRoot);
    if (!loaded?.data) {
      return "project-infra.json ausente. Tras conectar GitHub/Vercel/Supabase/GafCore, el runtime lo escribe automáticamente.";
    }
    const d = loaded.data;
    return [
      "PROJECT-INFRA (servicios ligados a este proyecto — no reconfigures a ciegas):",
      d.githubFullName || d.githubRemoteUrl ? `- GitHub: ${d.githubFullName || d.githubRemoteUrl}` : "- GitHub: (sin ligar)",
      d.vercelProjectName || d.vercelUrl ? `- Vercel: ${d.vercelProjectName || d.vercelUrl}` : "- Vercel: (sin ligar)",
      d.supabaseUrl ? `- Supabase: ${d.supabaseUrl}` : "- Supabase: (sin ligar)",
      d.gafcoreGateway || d.gafcoreProjectId
        ? `- GafCore AI: ${d.gafcoreGateway || gatewayOrigin}${d.gafcoreProjectId ? ` · project=${d.gafcoreProjectId}` : ""}`
        : "- GafCore AI: (sin ligar)",
      d.liveUrl ? `- Live: ${d.liveUrl}` : "",
    ].filter(Boolean).join("\n");
  }

  async function deployGithub(projectRoot, repoOptions = {}) {
    const root = path.resolve(String(projectRoot || ""));
    if (!root || !fs.existsSync(root)) throw new Error("projectRoot invalido para deploy_github.");
    getVaultCredentials("github");
    const connections = getConnections();
    const { connectProject } = require("./project-connect");
    const { publishProject } = require("./publish-pipeline");
    const linked = await connectProject(root, connections, {
      createGithub: true,
      createVercel: false,
      linkSupabase: false,
      repoName: String(repoOptions.repoName || repoOptions.name || path.basename(root)),
    });
    let publish = null;
    if (repoOptions.push !== false) {
      publish = await publishProject(root, {
        mode: "project",
        connections,
        deploy: false,
        supabasePush: false,
        commitMessage: String(repoOptions.commitMessage || "chore: sync from EDITCOREAI"),
        skipPush: repoOptions.skipPush === true,
      });
    }
    const githubRemoteUrl = linked?.github?.remoteUrl || linked?.remoteUrl || publish?.remoteUrl || "";
    const githubFullName = linked?.github?.fullName || linked?.repo?.fullName || "";
    mergeProjectInfra(root, {
      githubRemoteUrl,
      githubFullName,
      notes: [`GitHub sync ${new Date().toISOString().slice(0, 19)}`],
    });
    return redactDeep({
      ok: true,
      tool: "deploy_github",
      githubRemoteUrl,
      githubFullName,
      linked: Boolean(githubRemoteUrl),
      pushed: publish?.ok === true,
      vault: { github: true },
    });
  }

  async function deployVercel(projectRoot, envOptions = {}) {
    const root = path.resolve(String(projectRoot || ""));
    if (!root || !fs.existsSync(root)) throw new Error("projectRoot invalido para deploy_vercel.");
    getVaultCredentials("vercel");
    const connections = getConnections();
    const { connectProject } = require("./project-connect");
    const { syncEnvToVercel } = require("./vercel-env-sync");
    const { deployOneClick } = require("./deploy-one-click");
    const linked = await connectProject(root, connections, {
      createGithub: false,
      createVercel: true,
      linkSupabase: false,
      repoName: String(envOptions.repoName || path.basename(root)),
    });
    let envSync = null;
    if (envOptions.syncEnv !== false) {
      envSync = await syncEnvToVercel(root, connections, {
        environment: String(envOptions.environment || "production"),
      });
    }
    let deploy = null;
    if (envOptions.deploy !== false) {
      deploy = await deployOneClick(root, {
        target: "vercel",
        production: envOptions.production !== false,
      }, { connections });
    }
    const vercelUrl = deploy?.url || deploy?.deploymentUrl || linked?.vercel?.url || "";
    mergeProjectInfra(root, {
      vercelProjectId: linked?.vercel?.projectId || envSync?.projectId || "",
      vercelProjectName: linked?.vercel?.name || path.basename(root),
      vercelUrl,
      liveUrl: vercelUrl,
      notes: [`Vercel sync ${new Date().toISOString().slice(0, 19)}`],
    });
    return redactDeep({
      ok: true,
      tool: "deploy_vercel",
      vercelUrl,
      envSynced: envSync?.ok === true,
      deployed: deploy?.ok === true,
      vault: { vercel: true },
    });
  }

  async function provisionSupabase(projectRoot, dbOptions = {}) {
    const root = path.resolve(String(projectRoot || ""));
    if (!root || !fs.existsSync(root)) throw new Error("projectRoot invalido para provision_supabase.");
    getVaultCredentials("supabase");
    const connections = getConnections();
    const { createSupabaseProject } = require("./supabase-provision");
    const result = await createSupabaseProject(root, connections, {
      projectName: String(dbOptions.projectName || path.basename(root)),
      useCloud: dbOptions.useCloud === true,
      bucketName: String(dbOptions.bucketName || "uploads"),
      pushDb: dbOptions.pushDb !== false,
    });
    const supabaseUrl = result?.url || result?.supabaseUrl || result?.env?.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseProjectId = result?.projectId || result?.supabaseProjectId || path.basename(root);
    mergeProjectInfra(root, {
      supabaseUrl,
      supabaseProjectId,
      notes: [`Supabase provision ${new Date().toISOString().slice(0, 19)}`],
    });
    return redactDeep({
      ok: result?.ok !== false,
      tool: "provision_supabase",
      supabaseUrl,
      supabaseProjectId,
      vault: { supabase: true },
      details: result,
    });
  }

  /**
   * Crea/reutiliza proyecto AI en GafCore Gateway y escribe URL + key en .env.local.
   * @returns {{ ok: boolean, GAFCORE_GATEWAY_URL: string, GAFCORE_API_KEY: string, ... }}
   *   GAFCORE_API_KEY en el return va enmascarado; el valor real solo en .env.local.
   */
  async function provisionGafcoreAI(projectName, aiOptions = {}) {
    const name = String(projectName || aiOptions.projectName || "").trim();
    const projectRoot = path.resolve(String(aiOptions.projectRoot || "").trim());
    if (!name) throw new Error("provisionGafcoreAI requiere projectName.");
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      throw new Error("provisionGafcoreAI requiere projectRoot existente.");
    }
    if (!connectGatewayProject) {
      throw new Error("connectGatewayProject no inyectado en cloud-vault-bridge.");
    }
    getVaultCredentials("gafcore");
    const link = await connectGatewayProject({
      projectRoot,
      projectName: name,
      localProjectId: String(aiOptions.localProjectId || ""),
      initialBalanceUsd: Number(aiOptions.initialBalanceUsd) || 0,
      adminToken: String(aiOptions.adminToken || getGatewayAdminToken() || ""),
    });
    const projectKey = String(link?.projectKey || "").trim();
    if (!projectKey) throw new Error("GafCore Gateway no devolvió project key.");
    const { writeLocalEnv } = require("./project-connect");
    writeLocalEnv(projectRoot, {
      GAFCORE_GATEWAY_URL: gatewayOrigin,
      GAFCORE_API_KEY: projectKey,
      GAFCORE_PROJECT_ID: String(link.projectId || ""),
      GAFCORE_PROJECT_NAME: String(link.projectName || name),
    });
    mergeProjectInfra(projectRoot, {
      gafcoreGateway: gatewayOrigin,
      gafcoreProjectId: String(link.projectId || ""),
      gafcoreProjectName: String(link.projectName || name),
      notes: [`GafCore AI provision ${new Date().toISOString().slice(0, 19)}`],
    });
    return {
      ok: true,
      tool: "provision_gafcore_ai",
      reused: link.reused === true,
      GAFCORE_GATEWAY_URL: gatewayOrigin,
      GAFCORE_API_KEY: maskSecret(projectKey),
      GAFCORE_API_KEY_CONFIGURED: true,
      writtenTo: [".env.local", "project-infra.json"],
      projectId: String(link.projectId || ""),
      projectName: String(link.projectName || name),
      selectedModel: link.selectedModel || "",
      vault: { gafcore: true },
    };
  }

  async function provisionFullStackProject(projectRoot, options = {}) {
    const root = path.resolve(String(projectRoot || options.projectRoot || ""));
    if (!root || !fs.existsSync(root)) throw new Error("provisionFullStackProject requiere projectRoot.");
    const projectName = String(options.projectName || path.basename(root)).trim();
    const connections = getConnections();
    const { executeFullStackDeploy } = require("./fullstack-deploy");
    const deploy = await executeFullStackDeploy(root, connections, {
      repoName: String(options.repoName || projectName),
      commitMessage: String(options.commitMessage || `chore: provision fullstack ${projectName}`),
      skipDeploy: options.skipDeploy === true,
      skipPreCheck: options.skipPreCheck === true,
      rollbackOnFail: options.rollbackOnFail !== false,
      mode: options.mode === "update" ? "update" : "full",
    });
    let gafcore = null;
    if (options.provisionAi !== false && connectGatewayProject) {
      try {
        gafcore = await provisionGafcoreAI(projectName, {
          projectRoot: root,
          localProjectId: String(options.localProjectId || ""),
          initialBalanceUsd: Number(options.initialBalanceUsd) || 0,
          adminToken: String(options.adminToken || ""),
        });
      } catch (error) {
        gafcore = { ok: false, error: String(error?.message || error).slice(0, 240) };
      }
    }
    return redactDeep({
      ok: deploy?.ok !== false,
      tool: "provision_fullstack_project",
      deploy,
      gafcore,
      infra: readProjectInfra(root)?.data || null,
      vault: vaultStatus(),
    });
  }

  return {
    vaultStatus,
    getVaultCredentials,
    readProjectInfra,
    writeProjectInfra,
    mergeProjectInfra,
    formatInfraForPrompt,
    deployGithub,
    deployVercel,
    provisionSupabase,
    provisionGafcoreAI,
    provisionFullStackProject,
    redactDeep,
    maskSecret,
    gatewayOrigin,
  };
}

module.exports = {
  DEFAULT_GAFCORE_ORIGIN,
  createCloudVaultBridge,
  maskSecret,
  redactDeep,
};
