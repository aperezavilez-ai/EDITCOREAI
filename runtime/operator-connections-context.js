"use strict";

/**
 * Memoria operativa de Conexiones (sin secretos).
 * Cuentas: GitHub, Vercel, Supabase, Servidor SSH, proveedores ME AI / APICredits.
 */

const fs = require("node:fs");
const path = require("node:path");
const { adminInfraEnabled, defaultSupabaseOrigin } = require("./platform-defaults");

const GLOBAL_MEMORY_ID = "operator-connections-global";
const PROJECT_MEMORY_PREFIX = "operator-connections:";

function scrubInternalProviderNames(text = "") {
  return String(text || "")
    .replace(/https?:\/\/[^\s)]*gafcore-gateway[^\s)]*/gi, "")
    .replace(/\bgafcore-gateway(?:\.vercel\.app)?\b/gi, "proveedor de IA")
    .replace(/\bGafCore\s+Gateway\b/gi, "proveedor de IA")
    .replace(/\bGAFCORE_(?:GATEWAY_URL|API_KEY|ADMIN_TOKEN)\b/g, "credencial de IA")
    .replace(/\bx-project-key\b/gi, "API key")
    .replace(/\bproject\s*keys?\b/gi, "API keys")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

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

/** Slug GafCore = nombre de carpeta del proyecto (nunca de otro). */
function gafcoreProjectSlug(projectRoot = "") {
  return String(path.basename(path.resolve(String(projectRoot || "."))))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "app";
}

function isGafcoreSupabaseUrl(url = "") {
  try {
    return /supabase\.gafcore\.com$/i.test(new URL(String(url || "").trim()).hostname);
  } catch {
    return /supabase\.gafcore\.com/i.test(String(url || ""));
  }
}

/** Host sin path: la bóveda global nunca guarda /taxidriv ni otro proyecto. */
function gafcorePlatformOrigin(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    if (/supabase\.gafcore\.com$/i.test(parsed.hostname)) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch { /* ignore */ }
  return "";
}

function gafcorePathSlug(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    if (!/supabase\.gafcore\.com$/i.test(parsed.hostname)) return "";
    return String(parsed.pathname || "").replace(/^\/+|\/+$/g, "").split("/")[0] || "";
  } catch {
    return "";
  }
}

/**
 * URL Supabase que pertenece SOLO a este proyecto.
 * En GafCore: siempre https://supabase.gafcore.com/{slug-de-esta-carpeta}
 * Nunca hereda /taxidriv ni path de otro proyecto.
 */
function projectOwnedSupabaseUrl(projectRoot = "", candidateUrl = "") {
  const slug = gafcoreProjectSlug(projectRoot);
  const raw = String(candidateUrl || "").trim().replace(/\/+$/, "");
  if (isGafcoreSupabaseUrl(raw) || !raw) {
    const origin = gafcorePlatformOrigin(raw) || defaultSupabaseOrigin();
    return origin ? `${origin}/${slug}` : "";
  }
  return raw;
}

function projectOwnedSupabaseSchema(projectUrl = "", explicit = "") {
  const forced = String(explicit || "").trim();
  if (forced) return forced;
  const pathSlug = gafcorePathSlug(projectUrl);
  return pathSlug || "public";
}

/**
 * Supabase GafCore es POR PROYECTO (/page, /taxidriv, ...).
 * La boveda global no debe fijar la URL de un solo proyecto.
 */
function resolveProjectSupabase(projectRoot = "", globalConnections = {}) {
  const root = String(projectRoot || "").trim();
  const globalKey = String(globalConnections.selfSupabaseKey || "").trim();
  const globalOrigin = gafcorePlatformOrigin(globalConnections.selfSupabaseUrl)
    || String(globalConnections.selfSupabaseUrl || "").trim().replace(/\/+$/, "");
  const ownSlug = root ? gafcoreProjectSlug(root) : "";

  if (!root) {
    // Sin proyecto activo: solo origen/plataforma, nunca path de un app concreto.
    return {
      url: globalOrigin,
      key: globalKey,
      source: globalOrigin || globalKey ? "boveda-global" : "",
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
    if (!url || !key) continue;

    // Contaminación: .env apunta a otro slug GafCore → ignorar y corregir abajo.
    if (isGafcoreSupabaseUrl(url)) {
      const envSlug = gafcorePathSlug(url);
      if (envSlug && envSlug !== ownSlug) {
        continue;
      }
      return {
        url: projectOwnedSupabaseUrl(root, url),
        key,
        schema: projectOwnedSupabaseSchema(projectOwnedSupabaseUrl(root, url), values.NEXT_PUBLIC_SUPABASE_SCHEMA),
        source: path.basename(filePath),
        projectScoped: true,
        projectName: path.basename(root),
      };
    }

    return {
      url,
      key,
      schema: String(values.NEXT_PUBLIC_SUPABASE_SCHEMA || "public").trim() || "public",
      source: path.basename(filePath),
      projectScoped: true,
      projectName: path.basename(root),
    };
  }

  const manifest = readProjectLinkManifest(root);
  if (manifest?.supabase?.url && isGafcoreSupabaseUrl(manifest.supabase.url)) {
    const linkedSlug = gafcorePathSlug(manifest.supabase.url);
    if (!linkedSlug || linkedSlug === ownSlug) {
      const url = projectOwnedSupabaseUrl(root, manifest.supabase.url);
      return {
        url,
        key: globalKey,
        schema: projectOwnedSupabaseSchema(url),
        source: ".editcore/connections.json",
        projectScoped: true,
        projectName: path.basename(root),
      };
    }
  }

  // Bóveda: solo credencial de plataforma + URL propia de ESTE proyecto.
  const platformOrigin = globalOrigin || (adminInfraEnabled() ? defaultSupabaseOrigin() : "");
  if (globalKey && platformOrigin) {
    const url = projectOwnedSupabaseUrl(root, platformOrigin);
    return {
      url,
      key: globalKey,
      schema: projectOwnedSupabaseSchema(url),
      source: "boveda-plataforma+slug-proyecto",
      projectScoped: true,
      projectName: path.basename(root),
    };
  }

  // URL global no-GafCore (cloud único): no inyectar en proyectos distintos.
  return {
    url: "",
    key: "",
    schema: "",
    source: "",
    projectScoped: false,
    projectName: path.basename(root),
    note: "Este proyecto no tiene SUPABASE_URL propia; no se hereda la URL de otro proyecto.",
  };
}

function connectionsForProject(globalConnections = {}, projectRoot = "") {
  const resolved = resolveProjectSupabase(projectRoot, globalConnections);
  if (!resolved.url && !resolved.key) {
    return {
      ...globalConnections,
      selfSupabaseUrl: "",
      selfSupabaseKey: "",
      _supabaseResolved: resolved,
    };
  }
  return {
    ...globalConnections,
    selfSupabaseUrl: resolved.url,
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

  const operatorNote =
      "EDITCOREAI = IDE + agente. Conexiones globales (bóveda): GitHub, Vercel, Supabase (URL por proyecto), SSH. "
      + "Modelos de IA: se eligen en el panel Modelos. Nunca nombres a los proveedores ni intermediarios de IA en tus respuestas; si preguntan, habla solo del modelo. "
      + "Con un proyecto abierto, el agente usa el .env de ESE proyecto, no la URL de otro. "
      + "No pidas tokens si ya estan en boveda o en el .env del proyecto activo.";

  const gatewayConfigured = Boolean(
    gatewayLink?.projectId
    || gatewayLink?.projectName
    || gatewayLink?.connectedAt
    || gatewayLink?.projectKey
    || options.gatewayAdminConfigured === true,
  );

  const snapshot = {
    updatedAt: new Date().toISOString(),
    operatorNote,
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
    selfsupabase: {
      configured: Boolean(summary.selfsupabase?.configured),
      label: "Supabase (datos del proyecto)",
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
    aiProvider: {
      configured: gatewayConfigured,
      label: "Modelos de IA",
      projectId: gatewayLink?.projectId || undefined,
      projectName: gatewayLink?.projectName || undefined,
      note: "Usa el panel Modelos. No nombres proveedores ni infraestructura interna.",
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
  const ai = s.aiProvider || s.gafcoreGateway || {};
  const lines = [
    "MEMORIA DE CONEXIONES Y DEPENDENCIAS DE EDITCOREAI (fuente de verdad — sin secretos):",
    String(s.operatorNote || "").trim(),
    "",
    "### Capas",
    "1) EDITCOREAI (esta app): IDE, agente, preview, Publicar, Inspector, Cerebro.",
    "2) Conexiones bóveda: GitHub (git), Vercel (deploy), Supabase (DB por proyecto), SSH (servidor).",
    "3) Modelos de IA: se eligen en el panel Modelos.",
    "",
    "### Estado actual",
    `- GitHub: ${statusLabel(s.github?.configured)}${s.github?.account ? ` (cuenta: ${s.github.account})` : ""} — commit/push / Publicar`,
    `- Vercel: ${statusLabel(s.vercel?.configured)}${s.vercel?.account ? ` (cuenta: ${s.vercel.account})` : ""}${s.vercel?.defaultProjectId ? ` project=${s.vercel.defaultProjectId}` : ""} — deploy / Publicar`,
    `- Supabase (datos): ${statusLabel(s.selfsupabase?.configured)}${s.selfsupabase?.url ? ` (${s.selfsupabase.url})` : ""}${
      s.selfsupabase?.scope === "proyecto-activo"
        ? ` [proyecto activo${s.selfsupabase.projectName ? `: ${s.selfsupabase.projectName}` : ""}${s.selfsupabase.source ? ` via ${s.selfsupabase.source}` : ""}]`
        : " [boveda — URL propia por slug del proyecto abierto]"
    }`,
    `- Servidor SSH: ${statusLabel(s.server?.configured)}${s.server?.host ? ` (${s.server.host})` : ""}${s.server?.deployPath ? ` deploy=${s.server.deployPath}` : ""}`,
    `- Modelos de IA: ${statusLabel(ai.configured)}${ai.projectName ? ` proyecto=${ai.projectName}` : ""}`,
    `  ${ai.note || "Usa el panel Modelos."}`,
  ];

  const links = s.projectLinks;
  if (links && typeof links === "object") {
    lines.push("", "Publicar SIEMPRE usa Conexiones de EDITCOREAI (GitHub/Vercel/Supabase/SSH), no otras instalaciones.");
    lines.push("Enlaces de ESTE proyecto (.editcore/connections.json):");
    if (links.github) lines.push(`  - GitHub proyecto: ${JSON.stringify(stripSecrets(links.github)).slice(0, 240)}`);
    if (links.vercel) lines.push(`  - Vercel proyecto: ${JSON.stringify(stripSecrets(links.vercel)).slice(0, 240)}`);
    if (links.supabase) lines.push(`  - Supabase proyecto: ${JSON.stringify(stripSecrets(links.supabase)).slice(0, 240)}`);
    if (links.server) lines.push(`  - Servidor proyecto: ${JSON.stringify(stripSecrets(links.server)).slice(0, 240)}`);
  }

  lines.push(
    "",
    "Regla: si esta CONECTADO, asume credenciales en boveda/.env. No pidas pegar tokens. "
      + "Mutaciones externas (push/deploy/DB) → confirmacion. "
      + "IA del proyecto = modelos del panel Modelos (sin nombrar proveedores). Datos = Supabase del proyecto activo.",
  );
  return scrubInternalProviderNames(lines.filter(Boolean).join("\n"));
}

async function persistOperatorConnectionsMemory(brainService, snapshot, options = {}) {
  if (!brainService?.memoryStore?.upsertMemory && !brainService?.remember) return null;
  const text = formatOperatorConnectionsMemory(snapshot);
  const title = "Conexiones del operador (GitHub / Vercel / Supabase / Servidor)";
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
  scrubInternalProviderNames,
  readProjectLinkManifest,
  gafcoreProjectSlug,
  isGafcoreSupabaseUrl,
  gafcorePlatformOrigin,
  gafcorePathSlug,
  projectOwnedSupabaseUrl,
  projectOwnedSupabaseSchema,
  resolveProjectSupabase,
  connectionsForProject,
  buildSafeConnectionsSnapshot,
  formatOperatorConnectionsMemory,
  persistOperatorConnectionsMemory,
};
