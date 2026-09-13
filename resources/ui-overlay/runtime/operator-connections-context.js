"use strict";

/**
 * Memoria operativa de Conexiones (sin secretos).
 * Todos los proyectos del operador dependen de estas cuentas:
 * GitHub, Vercel, Supabase GafCore, Servidor SSH, GafCore Gateway.
 */

const fs = require("node:fs");
const path = require("node:path");

const GLOBAL_MEMORY_ID = "operator-connections-global";
const PROJECT_MEMORY_PREFIX = "operator-connections:";

function stripSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^(sk-|ghp_|gho_|github_pat_|vercel_|eyJ)/i.test(value)) return "[redacted]";
    if (value.length > 40 && /^[A-Za-z0-9_\-./+=]+$/.test(value) && !/^https?:\/\//i.test(value)) {
      return "[redacted]";
    }
    return value.slice(0, 500);
  }
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/token|secret|password|key|authorization|credential|apiKey|adminToken|projectKey/i.test(key)) {
        out[key] = val ? "configured" : "";
        continue;
      }
      out[key] = stripSecrets(val);
    }
    return out;
  }
  return value;
}

function readProjectLinkManifest(projectRoot) {
  const root = String(projectRoot || "").trim();
  if (!root) return null;
  const file = path.join(root, ".editcore", "connections.json");
  try {
    if (!fs.existsSync(file)) return null;
    return stripSecrets(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function readEnvFileValues(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = String(match[2] || "").trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value.replace(/^=+/, "").trim();
  }
  return out;
}

/**
 * Supabase GafCore es POR PROYECTO (/taxidriv, /track-pro-gps, ...).
 * La boveda global no debe fijar la URL de un solo proyecto.
 */
function resolveProjectSupabase(projectRoot = "", globalConnections = {}) {
  const root = String(projectRoot || "").trim();
  const globalUrl = String(globalConnections.selfSupabaseUrl || "").trim();
  const globalKey = String(globalConnections.selfSupabaseKey || "").trim();
  if (!root) {
    return {
      url: globalUrl,
      key: globalKey,
      source: globalUrl || globalKey ? "boveda-global" : "",
      projectScoped: false,
    };
  }
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, ".env"),
  ];
  for (const filePath of candidates) {
    const values = readEnvFileValues(filePath);
    const url = String(
      values.SUPABASE_URL
      || values.VITE_SUPABASE_URL
      || values.NEXT_PUBLIC_SUPABASE_URL
      || values.EXPO_PUBLIC_SUPABASE_URL
      || "",
    ).replace(/\/+$/, "");
    const key = String(
      values.SUPABASE_SERVICE_ROLE_KEY
      || values.SUPABASE_ANON_KEY
      || values.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || values.SUPABASE_PUBLISHABLE_KEY
      || values.VITE_SUPABASE_PUBLISHABLE_KEY
      || "",
    ).trim();
    if (/supabase\.gafcore\.com/i.test(url) && key) {
      return {
        url,
        key,
        source: path.basename(filePath),
        projectScoped: true,
        projectName: path.basename(root),
      };
    }
  }
  const manifest = readProjectLinkManifest(root);
  if (manifest?.supabase?.url) {
    return {
      url: String(manifest.supabase.url).replace(/\/+$/, ""),
      key: globalKey,
      source: ".editcore/connections.json",
      projectScoped: true,
      projectName: path.basename(root),
    };
  }
  // No heredar URL de otro proyecto (ej. /taxidriv) solo porque esta en la boveda global.
  let globalLooksProjectSpecific = false;
  try {
    const parsed = new URL(globalUrl);
    globalLooksProjectSpecific = /supabase\.gafcore\.com$/i.test(parsed.hostname)
      && Boolean(String(parsed.pathname || "").replace(/\/+$/, ""));
  } catch {
    globalLooksProjectSpecific = /supabase\.gafcore\.com\/.+/i.test(globalUrl);
  }
  if (globalLooksProjectSpecific) {
    return {
      url: "",
      key: "",
      source: "",
      projectScoped: false,
      projectName: path.basename(root),
      note: "Este proyecto no tiene SUPABASE_URL en .env; la boveda global apunta a otro proyecto y no se reutiliza.",
    };
  }
  return {
    url: globalUrl,
    key: globalKey,
    source: globalUrl || globalKey ? "boveda-global-fallback" : "",
    projectScoped: false,
    projectName: path.basename(root),
  };
}

function connectionsForProject(globalConnections = {}, projectRoot = "") {
  const resolved = resolveProjectSupabase(projectRoot, globalConnections);
  if (!resolved.url && !resolved.key) return { ...globalConnections, _supabaseResolved: resolved };
  return {
    ...globalConnections,
    selfSupabaseUrl: resolved.url || globalConnections.selfSupabaseUrl,
    selfSupabaseKey: resolved.key || globalConnections.selfSupabaseKey,
    _supabaseResolved: resolved,
  };
}

function buildSafeConnectionsSnapshot(options = {}) {
  const globalConnections = options.connections && typeof options.connections === "object"
    ? options.connections
    : {};
  const projectRoot = String(options.projectRoot || "").trim();
  const resolved = resolveProjectSupabase(projectRoot, globalConnections);
  const connections = connectionsForProject(globalConnections, projectRoot);
  const summary = typeof options.connectionSummary === "function"
    ? options.connectionSummary(connections)
    : {
      github: { configured: Boolean(connections.githubToken) },
      vercel: { configured: Boolean(connections.vercelToken) },
      netlify: { configured: Boolean(connections.netlifyToken) },
      selfsupabase: {
        configured: Boolean(connections.selfSupabaseUrl && connections.selfSupabaseKey),
        url: connections.selfSupabaseUrl || "",
      },
      server: {
        configured: Boolean(connections.serverHost && connections.serverKeyPath),
        host: connections.serverHost || "",
      },
    };

  const gatewayLink = options.gatewayLink && typeof options.gatewayLink === "object"
    ? options.gatewayLink
    : null;
  const projectManifest = options.projectManifest !== undefined
    ? options.projectManifest
    : readProjectLinkManifest(options.projectRoot);

  const gatewayConfigured = Boolean(
    gatewayLink?.projectId
    || gatewayLink?.projectName
    || gatewayLink?.connectedAt
    || options.gatewayAdminConfigured === true,
  );

  const snapshot = {
    updatedAt: new Date().toISOString(),
    operatorNote:
      "Boveda GLOBAL del operador: GitHub, Vercel, SSH, Gateway. "
      + "Supabase GafCore es POR PROYECTO (URL distinta: /taxidriv, /track-pro-gps, ...). "
      + "Con un proyecto abierto, el agente usa el .env de ESE proyecto, no la URL de otro. "
      + "No pidas tokens si ya estan en boveda o en el .env del proyecto activo.",
    github: {
      configured: Boolean(summary.github?.configured),
      account: String(options.accounts?.github || "").trim() || undefined,
    },
    vercel: {
      configured: Boolean(summary.vercel?.configured),
      account: String(options.accounts?.vercel || "").trim() || undefined,
      teamId: connections.vercelTeamId ? String(connections.vercelTeamId) : undefined,
      orgId: connections.vercelOrgId ? String(connections.vercelOrgId) : undefined,
      defaultProjectId: connections.vercelProjectId ? String(connections.vercelProjectId) : undefined,
    },
    netlify: {
      configured: Boolean(summary.netlify?.configured),
    },
    selfsupabase: {
      configured: Boolean(summary.selfsupabase?.configured),
      label: "Supabase GafCore",
      url: String(summary.selfsupabase?.url || connections.selfSupabaseUrl || "").replace(/\/+$/, ""),
      scope: resolved.projectScoped ? "proyecto-activo" : "boveda-global",
      source: resolved.source || undefined,
      projectName: resolved.projectName || undefined,
    },
    server: {
      configured: Boolean(summary.server?.configured),
      host: String(summary.server?.host || connections.serverHost || "").trim(),
      deployPath: connections.serverDeployPath
        ? String(connections.serverDeployPath).trim()
        : undefined,
      keyConfigured: Boolean(connections.serverKeyPath),
    },
    gafcoreGateway: {
      configured: gatewayConfigured,
      adminConfigured: options.gatewayAdminConfigured === true,
      projectId: gatewayLink?.projectId ? String(gatewayLink.projectId) : undefined,
      projectName: gatewayLink?.projectName ? String(gatewayLink.projectName) : undefined,
      projectRoot: gatewayLink?.projectRoot ? String(gatewayLink.projectRoot) : undefined,
      connectedAt: gatewayLink?.connectedAt ? String(gatewayLink.connectedAt) : undefined,
      models: Array.isArray(gatewayLink?.models)
        ? gatewayLink.models.map((m) => String(m)).slice(0, 12)
        : undefined,
      balanceUsd: Number.isFinite(Number(gatewayLink?.balanceUsd))
        ? Number(gatewayLink.balanceUsd)
        : undefined,
    },
    projectLinks: projectManifest || null,
  };

  return stripSecrets(snapshot);
}

function statusLabel(configured) {
  return configured ? "CONECTADO" : "sin configurar";
}

function formatOperatorConnectionsMemory(snapshot = {}) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const lines = [
    "MEMORIA DE CONEXIONES DEL OPERADOR (fuente de verdad — sin secretos):",
    String(s.operatorNote || "").trim(),
    `- GitHub: ${statusLabel(s.github?.configured)}${s.github?.account ? ` (cuenta: ${s.github.account})` : ""} — git commit/push y herramientas github_*`,
    `- Vercel: ${statusLabel(s.vercel?.configured)}${s.vercel?.account ? ` (cuenta: ${s.vercel.account})` : ""}${s.vercel?.defaultProjectId ? ` project=${s.vercel.defaultProjectId}` : ""} — deploy vercel --prod --yes / publicar`,
    `- Supabase GafCore: ${statusLabel(s.selfsupabase?.configured)}${s.selfsupabase?.url ? ` (${s.selfsupabase.url})` : ""}${
      s.selfsupabase?.scope === "proyecto-activo"
        ? ` [proyecto activo${s.selfsupabase.projectName ? `: ${s.selfsupabase.projectName}` : ""}${s.selfsupabase.source ? ` via ${s.selfsupabase.source}` : ""}]`
        : " [boveda global — mejor usar .env del proyecto abierto]"
    } — service_read/service_write, supabase db push`,
    `- Servidor SSH: ${statusLabel(s.server?.configured)}${s.server?.host ? ` (${s.server.host})` : ""}${s.server?.deployPath ? ` deploy=${s.server.deployPath}` : ""}`,
    `- GafCore Gateway: ${statusLabel(s.gafcoreGateway?.configured)}${
      s.gafcoreGateway?.projectName || s.gafcoreGateway?.projectId
        ? ` (proyecto: ${s.gafcoreGateway.projectName || s.gafcoreGateway.projectId})`
        : s.gafcoreGateway?.adminConfigured
          ? " (admin listo; vincula el proyecto activo)"
          : ""
    } — modelos/balance del Gateway del operador`,
  ];

  const links = s.projectLinks;
  if (links && typeof links === "object") {
    lines.push("Enlaces de ESTE proyecto (.editcore/connections.json):");
    if (links.github) lines.push(`  - GitHub proyecto: ${JSON.stringify(stripSecrets(links.github)).slice(0, 240)}`);
    if (links.vercel) lines.push(`  - Vercel proyecto: ${JSON.stringify(stripSecrets(links.vercel)).slice(0, 240)}`);
    if (links.supabase) lines.push(`  - Supabase proyecto: ${JSON.stringify(stripSecrets(links.supabase)).slice(0, 240)}`);
    if (links.server) lines.push(`  - Servidor proyecto: ${JSON.stringify(stripSecrets(links.server)).slice(0, 240)}`);
  }

  lines.push(
        "Regla: si esta CONECTADO, asume que EditCore ya tiene las credenciales del operador. "
      + "No pidas pegar tokens. Para mutaciones externas (push/deploy/DB) pide confirmacion del usuario. "
      + "Al cambiar de proyecto estas cuentas GLOBALES siguen vigentes; solo cambian los enlaces del proyecto activo "
      + "(.editcore/connections.json y GafCore Gateway del proyecto). "
      + "Puedes usar connection_status / service_read / Detectar desde herramientas; no dependas del badge de la UI.",
  );
  return lines.filter(Boolean).join("\n");
}

async function persistOperatorConnectionsMemory(brainService, snapshot, options = {}) {
  if (!brainService?.memoryStore?.upsertMemory && !brainService?.remember) return null;
  const text = formatOperatorConnectionsMemory(snapshot);
  const title = "Conexiones del operador (GitHub / Vercel / GafCore / Servidor / Gateway)";
  const projectRoot = String(options.projectRoot || "").trim();
  const projectId = String(options.projectId || "").trim();
  const results = [];

  if (brainService.memoryStore?.upsertMemory) {
    results.push(brainService.memoryStore.upsertMemory({
      id: GLOBAL_MEMORY_ID,
      scope: "global",
      type: "infrastructure",
      title,
      content: text,
      source: "operator-connections",
      importance: 0.95,
    }));
    if (projectId) {
      results.push(brainService.memoryStore.upsertMemory({
        id: `${PROJECT_MEMORY_PREFIX}${projectId}`,
        scope: "project",
        projectId,
        type: "infrastructure",
        title: `Conexiones operador + proyecto`,
        content: text,
        source: "operator-connections",
        importance: 0.9,
      }));
    }
    return results;
  }

  await brainService.remember(null, {
    scope: "global",
    type: "infrastructure",
    title,
    content: text,
    importance: 0.95,
  });
  return results;
}

module.exports = {
  GLOBAL_MEMORY_ID,
  PROJECT_MEMORY_PREFIX,
  stripSecrets,
  readProjectLinkManifest,
  resolveProjectSupabase,
  connectionsForProject,
  buildSafeConnectionsSnapshot,
  formatOperatorConnectionsMemory,
  persistOperatorConnectionsMemory,
};
