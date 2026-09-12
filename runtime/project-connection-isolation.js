"use strict";

/**
 * Aislamiento de conexiones externas por proyecto.
 * Un proyecto no debe reutilizar instancia Supabase/Gateway de otro.
 */

const fs = require("node:fs");
const path = require("node:path");

function readProjectInfra(projectRoot = "") {
  const root = String(projectRoot || "").trim();
  if (!root) return null;
  const candidates = [
    path.join(root, "project-infra.json"),
    path.join(root, ".editcore", "project-infra.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return { path: file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function readProjectConnections(projectRoot = "") {
  const file = path.join(String(projectRoot || ""), ".editcore", "connections.json");
  try {
    if (!fs.existsSync(file)) return null;
    return { path: file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return null;
  }
}

/**
 * Valida que el destino externo coincida con el manifiesto del proyecto.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function validateProjectConnectionTarget(projectRoot = {}, intended = {}) {
  const root = typeof projectRoot === "string" ? projectRoot : String(projectRoot?.root || "");
  const infra = readProjectInfra(root);
  const links = readProjectConnections(root);
  const reasons = [];
  const intendedUrl = String(intended.supabaseUrl || intended.url || "").trim().toLowerCase();
  const intendedProjectId = String(intended.supabaseProjectId || intended.projectId || intended.gafcoreProjectId || "").trim();
  const intendedGateway = String(intended.gatewayUrl || intended.gafcoreGateway || "").trim().toLowerCase();

  if (infra?.data) {
    const expectedUrl = String(infra.data.supabaseUrl || infra.data.supabase?.url || "").trim().toLowerCase();
    const expectedId = String(infra.data.supabaseProjectId || infra.data.supabase?.projectId || "").trim();
    const expectedGw = String(infra.data.gafcoreGateway || infra.data.gatewayUrl || "").trim().toLowerCase();
    if (intendedUrl && expectedUrl && intendedUrl !== expectedUrl) {
      reasons.push(`Supabase URL no coincide con project-infra.json del proyecto (${expectedUrl}).`);
    }
    if (intendedProjectId && expectedId && intendedProjectId !== expectedId) {
      reasons.push(`supabaseProjectId no coincide con project-infra.json (${expectedId}).`);
    }
    if (intendedGateway && expectedGw && intendedGateway !== expectedGw) {
      reasons.push(`GafCore Gateway no coincide con project-infra.json (${expectedGw}).`);
    }
  }

  if (links?.data) {
    const linkedId = String(links.data.supabaseProjectId || links.data.gafcoreProjectId || "").trim();
    if (intendedProjectId && linkedId && intendedProjectId !== linkedId) {
      reasons.push(`Destino distinto al link local .editcore/connections.json (${linkedId}).`);
    }
  }

  // Sin manifiesto: rechazar URL GafCore de otro slug distinto al de esta carpeta.
  if (intendedUrl && /supabase\.gafcore\.com\//i.test(intendedUrl)) {
    const slug = String(path.basename(root || ""))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    try {
      const intendedSlug = new URL(intendedUrl).pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
      if (slug && intendedSlug && intendedSlug !== slug) {
        reasons.push(`URL Supabase /${intendedSlug} no pertenece a este proyecto (/${slug}). Cada proyecto tiene URL propia.`);
      }
    } catch { /* ignore */ }
  }

  return { ok: reasons.length === 0, reasons, infraPath: infra?.path || "", connectionsPath: links?.path || "" };
}

function assertProjectConnectionTarget(projectRoot, intended = {}) {
  const result = validateProjectConnectionTarget(projectRoot, intended);
  if (!result.ok) {
    const error = new Error(result.reasons.join(" "));
    error.code = "PROJECT_CONNECTION_MISMATCH";
    throw error;
  }
  return result;
}

module.exports = {
  readProjectInfra,
  readProjectConnections,
  validateProjectConnectionTarget,
  assertProjectConnectionTarget,
};
