// Cálculo de costo por tokens y lectura de uso. Lo usan la función ai-proxy (Deno) y los tests (Node).
// El proveedor publica "ratios": ratio 1 equivale a $2 por millón de tokens de entrada.

export const USD_PER_RATIO_TOKEN = 2 / 1_000_000;

export function normalizeModelName(model) {
  return String(model || "").trim().replace(/^meai\//i, "");
}

export function indexPricing(payload, group = "default") {
  const groupRatio = Number(payload?.group_ratio?.[group] ?? 1) || 1;
  const models = new Map();
  for (const entry of Array.isArray(payload?.data) ? payload.data : []) {
    const name = String(entry?.model_name || "").trim();
    if (!name || Number(entry.quota_type) !== 0) continue;
    const endpoints = Array.isArray(entry.supported_endpoint_types) ? entry.supported_endpoint_types : ["openai"];
    if (!endpoints.includes("openai")) continue;
    const groups = Array.isArray(entry.enable_groups) ? entry.enable_groups : [group];
    if (!groups.includes(group)) continue;
    models.set(name, {
      model: name,
      modelRatio: Number(entry.model_ratio) || 0,
      completionRatio: Number(entry.completion_ratio ?? 1) || 0,
      cacheRatio: entry.cache_ratio == null ? 1 : Number(entry.cache_ratio),
      createCacheRatio: entry.create_cache_ratio == null ? 1 : Number(entry.create_cache_ratio),
    });
  }
  return { groupRatio, models };
}

// La lista de precios incluye modelos a los que la clave del administrador no tiene acceso:
// se dejan solo los que devuelve /v1/models con esa clave (si esa lista no llega, no se filtra).
export function restrictToModels(pricing, names) {
  const available = new Set((Array.isArray(names) ? names : []).map((name) => normalizeModelName(name)).filter(Boolean));
  if (!available.size) return pricing;
  return { ...pricing, models: new Map([...pricing.models].filter(([name]) => available.has(name))) };
}

// El proveedor publica el mismo modelo con varios nombres (claude-opus-4.8 / claude-opus-4-8,
// claude-haiku-4-5-20251001). Clave común para mostrar uno solo.
export function modelKey(name) {
  return normalizeModelName(name).toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");
}

export function dedupeModelNames(names) {
  const best = new Map();
  for (const name of names) {
    const key = modelKey(name);
    const current = best.get(key);
    const better = !current
      || (name.includes(".") && !current.includes("."))
      || (name.includes(".") === current.includes(".") && name.length < current.length);
    if (better) best.set(key, name);
  }
  return names.filter((name) => best.get(modelKey(name)) === name);
}

export function allowedModelNames(pricing, allowed) {
  const names = [...pricing.models.keys()];
  if (!Array.isArray(allowed) || !allowed.length) return dedupeModelNames(names);
  const wanted = new Set(allowed.map((name) => normalizeModelName(name)));
  return dedupeModelNames(names.filter((name) => wanted.has(name)));
}

export function isModelAllowed(pricing, allowed, model) {
  if (!pricing.models.has(model)) return false;
  const keys = new Set(allowedModelNames(pricing, allowed).map(modelKey));
  return keys.has(modelKey(model));
}

export function readUsage(usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  const details = u.prompt_tokens_details || {};
  const promptTokens = Math.max(0, Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0);
  const completionTokens = Math.max(0, Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0);
  const cachedTokens = Math.min(promptTokens, Math.max(0, Number(details.cached_tokens ?? u.cache_read_input_tokens ?? 0) || 0));
  const cacheCreationTokens = Math.min(
    Math.max(0, promptTokens - cachedTokens),
    Math.max(0, Number(details.cached_creation_tokens ?? u.cache_creation_input_tokens ?? 0) || 0),
  );
  return { promptTokens, completionTokens, cachedTokens, cacheCreationTokens };
}

export function providerCostUsd(price, usage, groupRatio = 1) {
  if (!price) return 0;
  const u = readUsage(usage);
  const plainInput = Math.max(0, u.promptTokens - u.cachedTokens - u.cacheCreationTokens);
  const weighted = plainInput
    + u.cachedTokens * price.cacheRatio
    + u.cacheCreationTokens * price.createCacheRatio
    + u.completionTokens * price.completionRatio;
  const cost = weighted * price.modelRatio * groupRatio * USD_PER_RATIO_TOKEN;
  return Math.round(cost * 1e6) / 1e6;
}

/** Precio por millón de tokens en dólares de panel (entrada y salida), un renglón por modelo. */
export function panelPricesPerMillion(pricing) {
  const names = dedupeModelNames([...pricing.models.keys()]);
  return names.map((name) => {
    const price = pricing.models.get(name);
    const input = price.modelRatio * pricing.groupRatio * USD_PER_RATIO_TOKEN * 1_000_000;
    return {
      model: name,
      input: Math.round(input * 1e4) / 1e4,
      output: Math.round(input * price.completionRatio * 1e4) / 1e4,
    };
  }).sort((a, b) => a.input + a.output - (b.input + b.output) || a.model.localeCompare(b.model));
}

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

const PROVIDER_NAME_PATTERN = /(?:https?:\/\/)?(?:api|cn)\.meai\.cloud\S*|\bme\s?ai(?:\s?cloud)?\b|\bmeai\b|\bapicredits\b/gi;

export function sanitizeProviderText(text) {
  return String(text || "").replace(PROVIDER_NAME_PATTERN, "EditCoreAI").slice(0, 500);
}

const PROVIDER_FIELDS = new Set(["provider_metadata", "provider", "providerMetadata", "gateway_cost", "market_cost"]);

/** Quita de la respuesta los datos internos del proveedor (costos, rutas) y deja el modelo pedido. */
export function scrubProviderFields(value, model) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, val] of Object.entries(node)) {
      if (!PROVIDER_FIELDS.has(key)) out[key] = walk(val);
    }
    return out;
  };
  const clean = walk(value);
  if (model && clean && typeof clean === "object" && !Array.isArray(clean) && "model" in clean) clean.model = model;
  return clean;
}

// Reescribe un flujo SSE línea a línea aplicando scrubProviderFields a cada bloque "data:".
export class SseScrubber {
  constructor(model) {
    this.model = model;
    this.pending = "";
  }

  push(text) {
    this.pending += text;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() || "";
    return lines.map((line) => `${this._line(line)}\n`).join("");
  }

  finish() {
    const rest = this.pending ? this._line(this.pending) : "";
    this.pending = "";
    return rest;
  }

  _line(raw) {
    const match = raw.match(/^(\s*data:\s*)(.*?)(\r?)$/);
    if (!match || !match[2] || match[2] === "[DONE]") return raw;
    try {
      return `${match[1]}${JSON.stringify(scrubProviderFields(JSON.parse(match[2]), this.model))}${match[3]}`;
    } catch {
      return raw;
    }
  }
}

// Lee un flujo SSE del proveedor sin modificarlo: guarda el bloque "usage" y cuenta la salida
// por si el proveedor no envía uso (entonces se estima por caracteres).
export class StreamUsageTracker {
  constructor() {
    this.pending = "";
    this.usage = null;
    this.outputChars = 0;
  }

  push(text) {
    this.pending += text;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() || "";
    for (const line of lines) this._line(line);
  }

  finish() {
    if (this.pending) this._line(this.pending);
    this.pending = "";
  }

  _line(raw) {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk?.usage && typeof chunk.usage === "object") this.usage = chunk.usage;
    for (const choice of Array.isArray(chunk?.choices) ? chunk.choices : []) {
      const delta = choice?.delta || {};
      this.outputChars += String(delta.content || "").length + String(delta.reasoning_content || "").length;
      for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        this.outputChars += String(call?.function?.arguments || "").length + String(call?.function?.name || "").length;
      }
    }
  }
}

export function usageOrEstimate(usage, promptText, outputChars) {
  if (usage) {
    const u = readUsage(usage);
    if (u.promptTokens || u.completionTokens) return usage;
  }
  return {
    prompt_tokens: estimateTokens(promptText),
    completion_tokens: Math.ceil(Math.max(0, Number(outputChars) || 0) / 4),
    estimated: true,
  };
}
