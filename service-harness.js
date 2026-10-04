"use strict";

const crypto = require("node:crypto");

const READ_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function cleanMethod(value) {
  const method = String(value || "GET").toUpperCase();
  if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) throw new Error("Metodo HTTP no permitido.");
  return method;
}

function cleanPath(value) {
  const pathname = String(value || "/").trim();
  if (!pathname.startsWith("/") || pathname.startsWith("//") || /[\r\n]/.test(pathname)) {
    throw new Error("Ruta remota no valida.");
  }
  return pathname;
}

function safeJson(value, maxBytes = 120000) {
  if (value == null || value === "") return undefined;
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Payload remoto demasiado grande.");
  return payload;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /token|secret|password|api[-_]?key|authorization/i.test(key) ? "[REDACTED]" : redact(item);
  }
  return output;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Quita SOLO rutas de Gateway/API pegadas por error. Conserva /proyecto (ej. /taxidriv). */
function normalizeSelfSupabaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  url = url
    .replace(/\/gafcore-gateway(?:\/api(?:\/openai(?:\/v1)?)?)?$/i, "")
    .replace(/\/api\/openai\/v1$/i, "")
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
  return url;
}

function serviceSpec(service, connections) {
  if (service === "github") {
    if (!connections.githubToken) throw new Error("GitHub no esta configurado.");
    return { baseUrl: "https://api.github.com", headers: { Authorization: `Bearer ${connections.githubToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } };
  }
  if (service === "vercel") {
    if (!connections.vercelToken) throw new Error("Vercel no esta configurado.");
    const teamId = String(connections.vercelTeamId || "").trim();
    const headers = { Authorization: `Bearer ${connections.vercelToken}` };
    if (teamId) headers["x-vercel-team-id"] = teamId;
    return { baseUrl: "https://api.vercel.com", headers, teamId };
  }
  if (service === "netlify") {
    throw new Error("Netlify ya no forma parte de las conexiones de EDITCOREAI. Usa Vercel.");
  }
  if (service === "selfsupabase") {
    const raw = String(connections.selfSupabaseUrl || "").trim();
    const baseUrl = normalizeSelfSupabaseUrl(raw);
    const apiKey = connections.selfSupabaseKey;
    if (!baseUrl || !apiKey) throw new Error("Supabase propio no esta configurado.");
    if (!/^https:\/\//i.test(baseUrl)) throw new Error("La URL de Supabase debe usar HTTPS.");
    if (/gafcore-gateway/i.test(baseUrl)) {
      throw new Error(
        "URL invalida: no uses un endpoint de modelos como URL de Supabase. Usa la URL de tu proyecto de Supabase (ej. https://tu-servidor/tu-proyecto).",
      );
    }
    return { baseUrl, headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } };
  }
  throw new Error(`Servicio desconocido: ${service}`);
}

function connectionSummary(connections = {}) {
  const supabaseUrl = normalizeSelfSupabaseUrl(connections.selfSupabaseUrl || "");
  return {
    github: { configured: Boolean(connections.githubToken) },
    vercel: { configured: Boolean(connections.vercelToken) },
    selfsupabase: { configured: Boolean(supabaseUrl && connections.selfSupabaseKey), url: supabaseUrl },
    server: { configured: Boolean(connections.serverHost && connections.serverKeyPath), host: connections.serverHost || "" },
    gafcoreGateway: { configured: false },
  };
}

async function executeServiceRequest({ service, method, path, body, connections, signal }) {
  const verb = cleanMethod(method);
  const pathname = cleanPath(path);
  const spec = serviceSpec(String(service || "").toLowerCase(), connections || {});
  const payload = safeJson(body);
  const response = await fetch(`${spec.baseUrl}${pathname}`, {
    method: verb,
    headers: { ...spec.headers, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 120000); }
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.error || `HTTP ${response.status}`;
    const invalidToken = data?.error?.invalidToken || data?.error?.code === "forbidden" || response.status === 401 || response.status === 403;
    const hint = invalidToken && service === "vercel" ? " — token invalido o expirado, genera uno nuevo en vercel.com/account/tokens" : "";
    throw new Error(`${service}: ${String(message).slice(0, 300)}${hint}`);
  }
  return { service, method: verb, path: pathname, status: response.status, data: redact(data) };
}

module.exports = {
  READ_METHODS,
  WRITE_METHODS,
  cleanMethod,
  cleanPath,
  connectionSummary,
  digest,
  executeServiceRequest,
  redact,
  normalizeSelfSupabaseUrl,
};
