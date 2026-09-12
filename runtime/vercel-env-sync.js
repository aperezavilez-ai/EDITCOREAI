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

async function findVercelProjectId(connections, projectName) {
  const name = String(projectName || "").toLowerCase().trim();
  if (!name || !connections.vercelToken) return "";
  try {
    const listed = await executeServiceRequest({
      service: "vercel",
      method: "GET",
      path: "/v9/projects",
      connections,
    });
    const projects = Array.isArray(listed?.data?.projects) ? listed.data.projects : (Array.isArray(listed?.data) ? listed.data : []);
    const hit = projects.find((item) => String(item?.name || "").toLowerCase() === name);
    return hit?.id || "";
  } catch {
    return connections.vercelProjectId || "";
  }
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
  if (!keys.length) {
    return { ok: true, skipped: true, synced: 0, message: "Sin variables en .env/.env.local para sincronizar." };
  }

  let id = String(projectId || connections.vercelProjectId || "").trim();
  if (!id) {
    id = await findVercelProjectId(connections, projectName || path.basename(root));
  }
  if (!id) {
    return { ok: false, message: "No se encontro projectId de Vercel. Conecta o crea el proyecto primero." };
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
};
