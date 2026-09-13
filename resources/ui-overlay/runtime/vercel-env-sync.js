"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { executeServiceRequest } = require("../service-harness");

const SKIP_KEYS = new Set([
  "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID",
  "GITHUB_TOKEN", "GH_TOKEN",
]);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (SKIP_KEYS.has(key)) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function vercelProjectSlug(name = "") {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** Candidatos de nombre Vercel: slug, basename, sin espacios, etc. */
function vercelNameCandidates(...names) {
  const out = [];
  const seen = new Set();
  for (const raw of names) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const slug = vercelProjectSlug(text);
    const variants = [
      slug,
      slug.replace(/-/g, ""),
      text.toLowerCase(),
      text.toLowerCase().replace(/\s+/g, "-"),
      text.toLowerCase().replace(/\s+/g, ""),
      text.replace(/\s+/g, "-").toLowerCase(),
    ].filter(Boolean);
    for (const v of variants) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function extractVercelProjects(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.projects)) return payload.projects;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data?.projects)) return payload.data.projects;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

async function listVercelProjects(connections) {
  if (!connections?.vercelToken) return [];
  const listed = await executeServiceRequest({
    service: "vercel",
    method: "GET",
    path: "/v9/projects?limit=100",
    connections,
  });
  return extractVercelProjects(listed?.data);
}

async function findVercelProjectId(connections, projectName, extraNames = []) {
  const candidates = vercelNameCandidates(projectName, ...extraNames);
  if (!candidates.length || !connections.vercelToken) {
    return { id: String(connections.vercelProjectId || "").trim(), name: "", matched: false };
  }
  try {
    const projects = await listVercelProjects(connections);
    for (const candidate of candidates) {
      const hit = projects.find((item) => {
        const n = String(item?.name || "").toLowerCase();
        const nSlug = vercelProjectSlug(n);
        const nCompact = n.replace(/-/g, "");
        return n === candidate
          || nSlug === candidate
          || nCompact === candidate
          || nCompact === String(candidate).replace(/-/g, "");
      });
      if (hit?.id) {
        return { id: hit.id, name: hit.name || candidate, matched: true };
      }
    }
  } catch {
    /* fall through */
  }
  return { id: String(connections.vercelProjectId || "").trim(), name: "", matched: false };
}

/**
 * Resuelve o crea el proyecto Vercel y SIEMPRE intenta devolver projectId.
 */
async function ensureVercelProjectId(connections, {
  projectRoot = "",
  projectName = "",
  projectId = "",
  createIfMissing = true,
} = {}) {
  if (!connections?.vercelToken) {
    return { ok: false, skipped: true, projectId: "", message: "Vercel no configurado." };
  }

  const rootName = projectRoot ? path.basename(projectRoot) : "";
  const preferredName = vercelProjectSlug(projectName || rootName) || "editcore-project";
  let id = String(projectId || connections.vercelProjectId || "").trim();
  let resolvedName = preferredName;
  let created = false;

  if (!id) {
    const found = await findVercelProjectId(connections, preferredName, [projectName, rootName]);
    id = found.id;
    if (found.name) resolvedName = found.name;
  }

  if (!id && createIfMissing) {
    try {
      const createdRes = await executeServiceRequest({
        service: "vercel",
        method: "POST",
        path: "/v10/projects",
        body: { name: preferredName, framework: null },
        connections,
      });
      id = String(createdRes?.data?.id || "").trim();
      resolvedName = String(createdRes?.data?.name || preferredName);
      created = Boolean(id);
    } catch (error) {
      const message = error?.message || String(error);
      if (!/already|exist|conflict|409/i.test(message)) {
        return { ok: false, projectId: "", projectName: preferredName, message };
      }
      const found = await findVercelProjectId(connections, preferredName, [projectName, rootName]);
      id = found.id;
      if (found.name) resolvedName = found.name;
      created = false;
    }
  }

  if (!id) {
    return {
      ok: false,
      projectId: "",
      projectName: preferredName,
      message: "No se pudo resolver projectId de Vercel tras crear/buscar el proyecto.",
    };
  }

  // Persistencia genérica para cualquier proyecto (existente o nuevo).
  try {
    if (projectRoot && fs.existsSync(projectRoot)) {
      const infraPath = path.join(projectRoot, "project-infra.json");
      let infra = {};
      try {
        if (fs.existsSync(infraPath)) infra = JSON.parse(fs.readFileSync(infraPath, "utf8")) || {};
      } catch { infra = {}; }
      infra.vercelProjectId = id;
      infra.vercelProjectName = resolvedName;
      infra.updatedAt = new Date().toISOString();
      fs.writeFileSync(infraPath, `${JSON.stringify(infra, null, 2)}\n`, "utf8");
      const editcoreDir = path.join(projectRoot, ".editcore");
      fs.mkdirSync(editcoreDir, { recursive: true });
      fs.writeFileSync(path.join(editcoreDir, "project-infra.json"), `${JSON.stringify(infra, null, 2)}\n`, "utf8");
    }
  } catch { /* no bloquear publish por fallo de escritura infra */ }

  return {
    ok: true,
    created,
    projectId: id,
    projectName: resolvedName,
    message: created
      ? `Proyecto Vercel creado: ${resolvedName}`
      : `Proyecto Vercel enlazado: ${resolvedName}`,
  };
}

async function syncEnvToVercel(projectRoot, connections, { projectId = "", projectName = "" } = {}) {
  if (!connections.vercelToken) {
    return { ok: false, skipped: true, message: "Vercel no configurado." };
  }
  const root = path.resolve(String(projectRoot || ""));
  const envLocal = path.join(root, ".env.local");
  const envFile = path.join(root, ".env");
  const vars = { ...parseEnvFile(envFile), ...parseEnvFile(envLocal) };
  const keys = Object.keys(vars);

  const ensured = await ensureVercelProjectId(connections, {
    projectRoot: root,
    projectName: projectName || path.basename(root),
    projectId,
    createIfMissing: true,
  });
  if (!ensured.ok) {
    return { ok: false, message: ensured.message, projectId: "", projectName: ensured.projectName || "" };
  }
  const id = ensured.projectId;

  if (!keys.length) {
    return {
      ok: true,
      skipped: true,
      synced: 0,
      projectId: id,
      projectName: ensured.projectName,
      message: `Proyecto Vercel listo (${ensured.projectName}); sin variables en .env/.env.local.`,
    };
  }

  const synced = [];
  const failed = [];
  for (const key of keys) {
    const value = String(vars[key] ?? "");
    if (!value) continue;
    try {
      await executeServiceRequest({
        service: "vercel",
        method: "POST",
        path: `/v10/projects/${id}/env`,
        body: {
          key,
          value,
          type: "encrypted",
          target: ["production", "preview", "development"],
        },
        connections,
      });
      synced.push(key);
    } catch (error) {
      const msg = error?.message || String(error);
      if (/already exists|duplicate|409/i.test(msg)) synced.push(key);
      else failed.push({ key, message: msg.slice(0, 200) });
    }
  }

  return {
    ok: failed.length === 0,
    projectId: id,
    projectName: ensured.projectName,
    synced: synced.length,
    keys: synced,
    failed,
    message: failed.length
      ? `Sincronizadas ${synced.length}; fallaron ${failed.length}.`
      : `Variables sincronizadas a Vercel (${synced.length}).`,
  };
}

module.exports = {
  parseEnvFile,
  syncEnvToVercel,
  findVercelProjectId,
  ensureVercelProjectId,
  vercelProjectSlug,
  vercelNameCandidates,
  extractVercelProjects,
};
