"use strict";

/**
 * Stub + contexto estable del agente (ROADMAP-FIRST, manifiesto, hermanos).
 */

const fs = require("node:fs");
const path = require("node:path");

const JARVIS_BOTS = [];

const ROADMAP_FIRST_RULE = [
  "ROADMAP-FIRST (OBLIGATORIO — Step 0 antes de cualquier tool de descubrimiento):",
  "1) EDITCORE-MANIFEST.md (autoconocimiento de esta app).",
  "2) ROADMAP.md (o ROADMAP/ROADMAP.md) del proyecto activo.",
  "3) .editcore/session-state.json (árbol/mods cacheados).",
  "4) Solo DESPUÉS: list_files/search_files/glob puntuales si el índice no cubre la pregunta.",
  "PROHIBIDO reescaneo completo del repo cuando ROADMAP/session-state/manifiesto ya aportan mapa.",
  "Hermanos del workspace: lectura con ../NombreHermano/... o NombreHermano/... (escritura fuera del activo requiere Acceso completo).",
].join("\n");

const OPERATE_SEQUENCE_RULE = [
  "SECUENCIA OPERAR (OBLIGATORIA — no saltes pasos; no narres sin tool_calls):",
  "1) ESTADO: read_file de ROADMAP.md + .editcore/session-state.json (y EDITCORE-MANIFEST.md si hablas de esta app).",
  "2) BÓVEDA: las tools deploy_*/provision_* leen safeStorage/Conexiones. Si falta token, di exactamente qué falta en Conexiones — NUNCA pidas pegar el secreto en el chat.",
  "3) ACCIÓN: ejecuta la tool concreta (deploy_github | deploy_vercel | provision_supabase | provision_gafcore_ai | provision_fullstack_project | onboard_project | fullstack_deploy).",
  "4) MANIFIESTO: confirma que project-infra.json / .env.local quedaron escritos; resume el resultado (URL, repo, gateway).",
  "PROHIBIDO: tutoriales genéricos de GitHub/Vercel/Supabase; inventar que ya publicó sin tool result; saltar el Step 0.",
].join("\n");

const CLOUD_TOOLS_POLICY = [
  "POLÍTICA NUBE (bóveda safeStorage — nunca pidas tokens al usuario si ya están en Conexiones):",
  "- Publicar/actualizar → fullstack_deploy / provision_fullstack_project / publish_project.",
  "- Solo GitHub → deploy_github.",
  "- Solo Vercel → deploy_vercel.",
  "- Solo Supabase → provision_supabase.",
  "- AI GafCore Gateway → provision_gafcore_ai (escribe GAFCORE_GATEWAY_URL + GAFCORE_API_KEY en .env.local).",
  "- Health local → probe_endpoint / test_local_api.",
].join("\n");

function resolveJarvisRoot() {
  return "";
}

function loadJarvisPlugins() {
  return [];
}

function jarvisAgentCatalog() {
  return { agents: [], plugins: [], jarvisRoot: "" };
}

function enrichAgentInventory(inventory = {}) {
  return {
    skills: inventory.skills || [],
    installed: inventory.installed || [],
    catalog: inventory.catalog || [],
  };
}

function loadEditcoreManifest(maxChars = 4_500) {
  const candidates = [
    path.join(__dirname, "..", "EDITCORE-MANIFEST.md"),
    path.join(process.cwd(), "EDITCORE-MANIFEST.md"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return fs.readFileSync(file, "utf8").slice(0, maxChars).trim();
    } catch { /* ignore */ }
  }
  return "";
}

function formatJarvisContextForPrompt(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  const parts = [];
  if (root) {
    parts.push([
      "ACTIVE WORKSPACE (ligado en cada turno — NO pidas Abrir ni re-declares la ruta):",
      `projectRoot=${root}`,
      `projectName=${path.basename(root)}`,
      "Si el usuario analiza EDITCOREAI y este root ya es EDITCOREAI, trabaja aquí sin pedir confirmación de proyecto.",
      "Si el usuario escribe una ruta distinta o mal tipada (ej. PROYECTOS vs PROGRAMAS), ignórala y usa projectRoot anterior salvo pedido explícito de cambiar de proyecto.",
    ].join("\n"));
  }
  parts.push(ROADMAP_FIRST_RULE, OPERATE_SEQUENCE_RULE, CLOUD_TOOLS_POLICY);
  const manifest = loadEditcoreManifest();
  if (manifest) {
    parts.push("EDITCORE-MANIFEST (autoconocimiento — no reescanees la app):\n" + manifest);
  }
  try {
    const { formatWorkspaceSiblingMap } = require("./workspace-siblings");
    if (root) parts.push(formatWorkspaceSiblingMap(root));
  } catch { /* ignore */ }
  try {
    if (root) {
      const { readProjectInfra } = require("./project-connection-isolation");
      const infra = readProjectInfra(root);
      if (infra?.data) {
        const d = infra.data;
        parts.push([
          "PROJECT-INFRA ligado:",
          d.githubFullName || d.githubRemoteUrl || "",
          d.vercelUrl || d.vercelProjectName || "",
          d.supabaseUrl || "",
          d.gafcoreGateway || d.gafcoreProjectId || "",
        ].filter(Boolean).join(" | "));
      }
    }
  } catch { /* ignore */ }
  return parts.filter(Boolean).join("\n\n");
}

module.exports = {
  JARVIS_BOTS,
  ROADMAP_FIRST_RULE,
  OPERATE_SEQUENCE_RULE,
  CLOUD_TOOLS_POLICY,
  resolveJarvisRoot,
  loadJarvisPlugins,
  jarvisAgentCatalog,
  enrichAgentInventory,
  loadEditcoreManifest,
  formatJarvisContextForPrompt,
};
