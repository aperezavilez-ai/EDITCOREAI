"use strict";

/**
 * Puente EDITCOREAI IDE ↔ editcore-agent-core.
 *
 * POR DEFECTO: Agent Core OFF. El camino fiable es el adaptador legado.
 * Solo se activa con EDITCORE_USE_AGENT_CORE=1 (opt-in explicito).
 *
 * IMPORTANTE: nunca preferir rutas dentro de app.asar — Node falla con
 * "Invalid package config \\?\...\app.asar\agent-core\package.json".
 */

const path = require("node:path");
const fs = require("node:fs");

function isInsideAsar(candidate) {
  const n = String(candidate || "").replace(/\\/g, "/").toLowerCase();
  return n.includes(".asar/") || n.endsWith(".asar");
}

function looksLikeCoreRoot(candidate) {
  try {
    if (!fs.existsSync(path.join(candidate, "index.js"))) return false;
    const pkgPath = path.join(candidate, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    if (isInsideAsar(candidate)) return false;
    JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function resolveCoreRoot() {
  const candidates = [];
  const push = (p) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  if (process.resourcesPath) {
    push(path.join(process.resourcesPath, "editcore-agent-core"));
    push(path.join(process.resourcesPath, "app.asar.unpacked", "agent-core"));
    push(path.join(process.resourcesPath, "app", "agent-core"));
  }
  push(path.join(process.cwd(), "resources", "editcore-agent-core"));
  push(path.join(process.cwd(), "resources", "app", "agent-core"));

  const envRoot = String(process.env.EDITCORE_AGENT_CORE_ROOT || "").trim();
  if (envRoot) push(envRoot);

  for (const candidate of candidates) {
    if (looksLikeCoreRoot(candidate)) return candidate;
  }
  return null;
}

/**
 * true solo con opt-in explicito. options.enabled=true NO basta solo:
 * tambien hace falta EDITCORE_USE_AGENT_CORE=1 (salvo tests que pasen force=true).
 */
function isAgentCoreEnabled(options = {}) {
  if (options.enabled === false) return false;
  if (String(process.env.EDITCORE_USE_LEGACY_AGENT || "").trim() === "1") return false;
  if (options.config?.["editcore-agent-core"]?.enabled === false) return false;
  if (options.config?.agentCoreEnabled === false) return false;
  if (options.force === true) return true;
  // Default OFF — Agent Core no es el camino de analisis/ejecucion hasta estabilizar.
  return String(process.env.EDITCORE_USE_AGENT_CORE || "").trim() === "1";
}

function isLegacyAgentForced(options = {}) {
  return isAgentCoreEnabled(options) === false;
}

function loadAgentCore() {
  const root = resolveCoreRoot();
  if (!root) {
    throw new Error(
      "Agent Core no encontrado en disco (resources/editcore-agent-core). "
      + "Reaplica hotfix o reinstala EDITCOREAI. No se carga desde app.asar.",
    );
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(root);
}

async function tryRunAgentCore(input = {}, options = {}) {
  if (!isAgentCoreEnabled(options)) return null;
  const core = loadAgentCore();
  return core.runAgent(input);
}

module.exports = {
  isAgentCoreEnabled,
  isLegacyAgentForced,
  resolveCoreRoot,
  loadAgentCore,
  tryRunAgentCore,
  isInsideAsar,
};
