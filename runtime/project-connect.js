"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { connectionSummary, executeServiceRequest } = require("../service-harness");

const { findGitRoot, git } = require("./git-utils");
const {
  connectionsForProject,
  projectOwnedSupabaseUrl,
  projectOwnedSupabaseSchema,
  gafcoreProjectSlug,
} = require("./operator-connections-context");

function ensureGitignoreHas(projectRoot, entries = []) {
  const file = path.join(projectRoot, ".gitignore");
  let current = "";
  if (fs.existsSync(file)) current = fs.readFileSync(file, "utf8");
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  let changed = false;
  for (const entry of entries) {
    if (!lines.has(entry)) {
      lines.add(entry);
      changed = true;
    }
  }
  if (!changed && fs.existsSync(file)) return { ok: true, changed: false };
  const next = `${[...lines].join("\n").trim()}\n`;
  fs.writeFileSync(file, next, "utf8");
  return { ok: true, changed: true };
}

function writeLocalEnv(projectRoot, values = {}) {
  ensureGitignoreHas(projectRoot, [".env", ".env.local", ".env.*.local"]);
  const file = path.join(projectRoot, ".env.local");
  let existing = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) existing[match[1]] = match[2];
    }
  }
  const merged = { ...existing, ...values };
  const body = Object.entries(merged)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
  fs.writeFileSync(file, `${body}\n`, "utf8");
  return { ok: true, path: ".env.local", keys: Object.keys(values) };
}

function writeProjectLinkManifest(projectRoot, manifest = {}) {
  const dir = path.join(projectRoot, ".editcore");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "connections.json");
  const safe = {
    updatedAt: new Date().toISOString(),
    github: manifest.github || null,
    vercel: manifest.vercel || null,
    supabase: manifest.supabase
      ? { url: manifest.supabase.url || "", linked: true }
      : null,
    server: manifest.server || null,
    notes: manifest.notes || [],
  };
  fs.writeFileSync(file, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return { ok: true, path: ".editcore/connections.json", manifest: safe };
}

async function assessProjectConnections(projectRoot, connections = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const summary = connectionSummary(connections);
  const gitRoot = findGitRoot(root);
  let remoteUrl = "";
  let branch = "";
  if (gitRoot) {
    const remote = await git(gitRoot, ["remote", "get-url", "origin"]).catch(() => ({ code: 1, stdout: "" }));
    remoteUrl = remote.code === 0 ? remote.stdout : "";
    const br = await git(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "" }));
    branch = br.stdout || "";
  }
  const hasVercelJson = fs.existsSync(path.join(root, "vercel.json"));
  const hasNetlify = fs.existsSync(path.join(root, "netlify.toml"));
  const hasSupabase = fs.existsSync(path.join(root, "supabase"));
  const localManifest = path.join(root, ".editcore", "connections.json");
  let linked = null;
  if (fs.existsSync(localManifest)) {
    try { linked = JSON.parse(fs.readFileSync(localManifest, "utf8")); } catch { linked = null; }
  }

  const missing = [];
  if (!summary.github.configured) missing.push("github_token");
  if (!summary.vercel.configured && !summary.netlify.configured) missing.push("vercel_or_netlify_token");
  if (!summary.selfsupabase.configured) missing.push("selfsupabase");
  if (!gitRoot) missing.push("git_repo");
  if (gitRoot && !remoteUrl) missing.push("git_remote");

  return {
    ok: true,
    projectRoot: root,
    gitRoot: gitRoot || "",
    branch,
    remoteUrl,
    hasVercelJson,
    hasNetlify,
    hasSupabase,
    linked,
    connections: summary,
    missing,
    readyToPublish: Boolean(gitRoot && remoteUrl && (summary.vercel.configured || summary.netlify.configured)),
  };
}

async function ensureGitRepo(projectRoot) {
  const existing = findGitRoot(projectRoot);
  if (existing) return { ok: true, created: false, gitRoot: existing };
  const init = await git(projectRoot, ["init"]);
  if (init.code !== 0) return { ok: false, message: init.stderr || "git init fallo" };
  await git(projectRoot, ["add", "-A"]);
  await git(projectRoot, ["commit", "-m", "chore: initial commit from EDITCOREAI"]);
  return { ok: true, created: true, gitRoot: projectRoot };
}

async function createGithubRepo(connections, { name, privateRepo = true, description = "" } = {}) {
  const token = String(connections.githubToken || "").trim();
  if (!token) return { ok: false, message: "GitHub no configurado en Conexiones." };
  const repoName = String(name || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!repoName) return { ok: false, message: "Nombre de repo invalido." };
  const result = await executeServiceRequest({
    service: "github",
    method: "POST",
    path: "/user/repos",
    body: {
      name: repoName,
      private: privateRepo !== false,
      description: description || `Proyecto conectado por EDITCOREAI (${repoName})`,
      auto_init: false,
    },
    connections,
  });
  const data = result?.data || {};
  const htmlUrl = data.html_url || "";
  const cloneUrl = data.clone_url || "";
  const sshUrl = data.ssh_url || "";
  if (!cloneUrl && !htmlUrl) {
    return { ok: false, message: "No se pudo crear el repo en GitHub.", result };
  }
  return {
    ok: true,
    name: repoName,
    htmlUrl,
    cloneUrl,
    sshUrl,
    fullName: data.full_name || repoName,
  };
}

async function ensureGithubRemote(gitRoot, connections, { createIfMissing = true, repoName = "" } = {}) {
  const current = await git(gitRoot, ["remote", "get-url", "origin"]).catch(() => ({ code: 1, stdout: "" }));
  if (current.code === 0 && current.stdout) {
    return { ok: true, created: false, remoteUrl: current.stdout };
  }
  if (!createIfMissing) {
    return { ok: false, message: "Sin remote origin. Activa createIfMissing o agrega el remote manualmente." };
  }
  const name = repoName || path.basename(gitRoot);
  const created = await createGithubRepo(connections, { name, privateRepo: true });
  if (!created.ok) return created;
  const url = created.cloneUrl || created.sshUrl;
  const add = await git(gitRoot, ["remote", "add", "origin", url]);
  if (add.code !== 0) {
    return { ok: false, message: add.stderr || "No se pudo agregar remote origin.", created };
  }
  return { ok: true, created: true, remoteUrl: url, repo: created };
}

async function ensureVercelProject(projectRoot, connections, { name = "" } = {}) {
  if (!connections.vercelToken) {
    return { ok: false, skipped: true, message: "Vercel no configurado." };
  }
  const projectName = String(name || path.basename(projectRoot)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  try {
    const created = await executeServiceRequest({
      service: "vercel",
      method: "POST",
      path: "/v10/projects",
      body: { name: projectName, framework: null },
      connections,
    });
    const id = created?.data?.id || "";
    return {
      ok: true,
      created: Boolean(id),
      projectName,
      projectId: id || connections.vercelProjectId || "",
      message: id ? `Proyecto Vercel listo: ${projectName}` : "Proyecto Vercel ya existia o respuesta parcial; el deploy CLI lo enlazara.",
      raw: created,
    };
  } catch (error) {
    const message = error?.message || String(error);
    if (/already|exist|conflict|409/i.test(message)) {
      return { ok: true, created: false, projectName, message: "Proyecto Vercel ya existe." };
    }
    return { ok: false, message };
  }
}

async function ensureSupabaseEnv(projectRoot, connections) {
  const scoped = connectionsForProject(connections, projectRoot);
  const key = String(scoped.selfSupabaseKey || connections.selfSupabaseKey || "").trim();
  if (!key) {
    return { ok: false, skipped: true, message: "Supabase propio no configurado en Conexiones." };
  }
  // URL siempre del proyecto activo — nunca path de otro (ej. /taxidriv → PAGE).
  const url = projectOwnedSupabaseUrl(projectRoot, scoped.selfSupabaseUrl || connections.selfSupabaseUrl);
  const schema = projectOwnedSupabaseSchema(url);
  const written = writeLocalEnv(projectRoot, {
    SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: url,
    VITE_SUPABASE_URL: url,
    SUPABASE_ANON_KEY: key,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
    VITE_SUPABASE_ANON_KEY: key,
    SUPABASE_SERVICE_ROLE_KEY: key,
    NEXT_PUBLIC_SUPABASE_SCHEMA: schema,
  });
  writeProjectLinkManifest(projectRoot, {
    supabase: {
      url,
      projectId: gafcoreProjectSlug(projectRoot),
      schema,
      linked: true,
    },
    notes: [
      "Supabase GafCore es por proyecto: URL propia, sin heredar de otros.",
      `Slug: ${gafcoreProjectSlug(projectRoot)}`,
    ],
  });
  let health = { ok: false };
  try {
    const result = await executeServiceRequest({
      service: "selfsupabase",
      method: "GET",
      path: "/rest/v1/",
      connections: { ...connections, selfSupabaseUrl: url, selfSupabaseKey: key },
    });
    health = { ok: true, status: result?.status || 200 };
  } catch (error) {
    health = { ok: false, message: error?.message || String(error) };
  }
  return {
    ok: true,
    env: written,
    health,
    url,
    schema,
    message: health.ok
      ? `Supabase propio enlazado (${url}) y API responde.`
      : `Supabase propio escrito (${url}); health: ${health.message || "sin respuesta"}`,
  };
}

/**
 * Conecta un proyecto nuevo/actual a las cuentas globales de EDITCOREAI.
 */
async function connectProject(projectRoot, connections = {}, {
  createGithub = true,
  createVercel = true,
  linkSupabase = true,
  repoName = "",
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  if (!root || !fs.existsSync(root)) {
    return { ok: false, completed: false, message: "projectRoot invalido.", steps };
  }

  const assessment = await assessProjectConnections(root, connections);
  steps.push({ step: "assess", ok: true, assessment });

  const gitEnsure = await ensureGitRepo(root);
  steps.push({ step: "git_init", ok: gitEnsure.ok, created: gitEnsure.created === true, message: gitEnsure.message || "" });
  if (!gitEnsure.ok) {
    return { ok: false, completed: false, message: gitEnsure.message, steps };
  }

  let github = { ok: true, skipped: true };
  if (createGithub) {
    github = await ensureGithubRemote(gitEnsure.gitRoot, connections, {
      createIfMissing: true,
      repoName: repoName || path.basename(root),
    });
    steps.push({ step: "github_remote", ok: github.ok, created: github.created === true, remoteUrl: github.remoteUrl || "", message: github.message || "" });
    if (!github.ok) {
      return { ok: false, completed: false, message: github.message, steps, assessment };
    }
  }

  let vercel = { ok: true, skipped: true };
  if (createVercel) {
    vercel = await ensureVercelProject(root, connections, { name: repoName || path.basename(root) });
    steps.push({
      step: "vercel_project",
      ok: vercel.ok !== false,
      skipped: vercel.skipped === true,
      projectId: vercel.projectId || "",
      message: vercel.message || "",
    });
  }

  let supabase = { ok: true, skipped: true };
  if (linkSupabase) {
    supabase = await ensureSupabaseEnv(root, connections);
    steps.push({
      step: "supabase_env",
      ok: supabase.ok !== false,
      skipped: supabase.skipped === true,
      message: supabase.message || "",
      url: supabase.url || "",
    });
  }

  const server = connectionSummary(connections).server;
  const manifest = writeProjectLinkManifest(root, {
    github: github.remoteUrl ? { remoteUrl: github.remoteUrl, fullName: github.repo?.fullName || "" } : assessment.remoteUrl ? { remoteUrl: assessment.remoteUrl } : null,
    vercel: vercel.projectName ? { projectName: vercel.projectName, projectId: vercel.projectId || "" } : null,
    supabase: supabase.url
      ? { url: supabase.url, projectId: gafcoreProjectSlug(root), schema: supabase.schema || "", linked: true }
      : null,
    server: server.configured ? { host: server.host } : null,
    notes: [
      "Tokens viven en Conexiones de EDITCOREAI (cifrado), no en el repo.",
      ".env.local esta en .gitignore.",
      "Cada proyecto tiene su propia URL Supabase; no se hereda de otros.",
    ],
  });
  steps.push({ step: "manifest", ok: true, path: manifest.path });

  const ok = steps.every((item) => item.ok !== false || item.skipped === true);
  return {
    ok,
    completed: ok,
    projectRoot: root,
    gitRoot: gitEnsure.gitRoot,
    steps,
    assessment: await assessProjectConnections(root, connections),
    message: ok
      ? "Proyecto conectado a GitHub/Vercel/Supabase (segun Conexiones disponibles)."
      : "Conexion parcial: revisa los pasos fallidos.",
  };
}

module.exports = {
  assessProjectConnections,
  connectProject,
  ensureGitRepo,
  createGithubRepo,
  ensureGithubRemote,
  ensureVercelProject,
  ensureSupabaseEnv,
  writeLocalEnv,
  writeProjectLinkManifest,
};
