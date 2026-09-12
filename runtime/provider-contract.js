"use strict";

const PROVIDER_KINDS = new Set(["openai-compatible", "anthropic", "gemini", "ollama"]);

function normalizeProviderDefinition(input = {}) {
  const id = String(input.id || input.providerKey || "").trim().toLowerCase();
  const kind = String(input.kind || "openai-compatible").trim().toLowerCase();
  const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  if (!id) throw new Error("El proveedor requiere un id.");
  if (!PROVIDER_KINDS.has(kind)) throw new Error(`Tipo de proveedor no soportado: ${kind}`);
  if (!/^https:\/\//i.test(baseUrl) && !(kind === "ollama" && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl))) throw new Error(`El endpoint de ${id} debe usar HTTPS o ser un servicio local.`);
  return {
    id,
    kind,
    baseUrl,
    models: Array.isArray(input.models) ? [...new Set(input.models.map(String).map((v) => v.trim()).filter(Boolean))] : [],
    capabilities: { chat: true, tools: false, vision: false, streaming: false, ...(input.capabilities || {}) },
    limits: { contextTokens: 128000, maxOutputTokens: 8192, ...(input.limits || {}) },
    pricing: input.pricing || {},
  };
}

module.exports = { PROVIDER_KINDS, normalizeProviderDefinition };
