"use strict";

/**
 * Un solo cerebro elige UN modelo. No dispara 20 proveedores.
 * Prioridad: modelo pedido por el usuario > latencia conocida > fallback.
 */

const FAST_HINT = /flash|haiku|mini|lite|nano|small|instant|grok-4-fast|gpt-4o-mini/i;
const HEAVY_HINT = /opus|sonnet|gpt-5|o3|o1|deepseek-v4-pro|qwen3\.6|kimi-k2/i;

function pickModel({ requested, catalog = [], kind = "CHAT", hasTools = false }) {
  const explicit = String(requested || "").trim();
  if (explicit && !/^__auto__/i.test(explicit)) {
    return { model: explicit, reason: "user-selected", parallel: 1 };
  }

  const list = Array.isArray(catalog) ? catalog.map((m) => String(m?.id || m?.model || m || "")).filter(Boolean) : [];
  const wantFast = kind === "CHAT" || kind === "LIST" || kind === "ASK" || !hasTools;
  const pool = list.length ? list : [];

  if (wantFast) {
    const fast = pool.find((m) => FAST_HINT.test(m));
    if (fast) return { model: fast, reason: "latency-chat", parallel: 1 };
  } else {
    const heavy = pool.find((m) => HEAVY_HINT.test(m));
    if (heavy) return { model: heavy, reason: "quality-execute", parallel: 1 };
  }

  if (pool[0]) return { model: pool[0], reason: "catalog-first", parallel: 1 };
  return { model: explicit || "", reason: "passthrough", parallel: 1 };
}

module.exports = { pickModel };
