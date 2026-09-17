"use strict";

/**
 * Stub + contexto estable del agente (ROADMAP-FIRST, manifiesto, hermanos).
 */

const fs = require("node:fs");
const path = require("node:path");

const JARVIS_BOTS = [
  {
    id: "jarvis-code-health",
    name: "Jarvis Code Health",
    agentType: "quality",
    subAgent: "Security Auditor",
    description: "Escanea deuda técnica, TODOs y tamaño de archivos.",
    skills: ["code-health", "lint-audit"],
    wakeConditions: ["code.inspect", "health.check"],
    source: "jarvis-port",
  },
  {
    id: "jarvis-memory-gardener",
    name: "Jarvis Memory Gardener",
    agentType: "optimization",
    subAgent: "DevOps",
    description: "Monitorea presión de memoria y optimiza caché del agente.",
    skills: ["memory-profile", "cache-prune"],
    wakeConditions: ["memory.pressure", "cache.overflow"],
    source: "jarvis-port",
  },
  {
    id: "jarvis-api-guardian",
    name: "Jarvis API Guardian",
    agentType: "security",
    subAgent: "DBA",
    description: "Valida endpoints locales, contratos de datos y bóveda.",
    skills: ["api-guard", "schema-audit"],
    wakeConditions: ["api.probe", "schema.migrate"],
    source: "jarvis-port",
  },
  {
    id: "jarvis-ui-polisher",
    name: "Jarvis UI Polisher",
    agentType: "frontend",
    subAgent: "UI/UX Architect",
    description: "Verifica responsividad, contraste y accesibilidad visual.",
    skills: ["ui-review", "responsive-audit"],
    wakeConditions: ["ui.render", "style.inspect"],
    source: "jarvis-port",
  },
  {
    id: "jarvis-build-sentinel",
    name: "Jarvis Build Sentinel",
    agentType: "devops",
    subAgent: "DevOps",
    description: "Supervisa builds, packaging y dependencias del proyecto.",
    skills: ["build-verify", "dep-audit"],
    wakeConditions: ["build.package", "dep.install"],
    source: "jarvis-port",
  },
];

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
  "3) ACCIÓN: ejecuta la tool concreta (deploy_github | deploy_vercel | provision_supabase | provision_fullstack_project | onboard_project | fullstack_deploy).",
  "4) MANIFIESTO: confirma que project-infra.json / .env.local quedaron escritos; resume el resultado (URL, repo, proveedor).",
  "PROHIBIDO: tutoriales genéricos de GitHub/Vercel/Supabase; inventar que ya publicó sin tool result; saltar el Step 0.",
].join("\n");

const CLOUD_TOOLS_POLICY = [
  "POLÍTICA NUBE (bóveda safeStorage — nunca pidas tokens al usuario si ya están en Conexiones):",
  "- Publicar/actualizar → fullstack_deploy / provision_fullstack_project / publish_project.",
  "- Solo GitHub → deploy_github.",
  "- Solo Vercel → deploy_vercel.",
  "- Solo Supabase → provision_supabase.",
  "- Proveedor de IA (ME AI / APICredits) → configúralo en el panel Modelos del IDE (no hay tool de aprovisionamiento automático).",
  "- Health local → probe_endpoint / test_local_api.",
].join("\n");

function resolveJarvisRoot() {
  return "";
}

function loadJarvisPlugins() {
  return [];
}

function jarvisAgentCatalog() {
  return {
    agents: JARVIS_BOTS.map((bot) => ({
      id: bot.id,
      name: bot.name,
      subAgent: bot.subAgent,
      description: bot.description,
      skills: bot.skills,
    })),
    plugins: [],
    jarvisRoot: "",
    native: true,
    requiresSidecar: false,
  };
}

function enrichAgentInventory(inventory = {}) {
  return {
    skills: inventory.skills || [],
    installed: inventory.installed || [],
    catalog: inventory.catalog || [],
    jarvis: {
      native: true,
      agents: JARVIS_BOTS,
    },
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
      const raw = fs.readFileSync(file, "utf8").slice(0, maxChars).trim();
      return String(raw || "")
        .replace(/https?:\/\/[^\s)]*gafcore-gateway[^\s)]*/gi, "")
        .replace(/\bgafcore-gateway(?:\.vercel\.app)?\b/gi, "proveedor de modelos")
        .replace(/\bGafCore\s+Gateway\b/gi, "proveedor de modelos")
        .replace(/\bGafCore\b/gi, "el proveedor")
        .replace(/\bGAFCORE GATEWAY\b/gi, "proyecto hermano");
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
