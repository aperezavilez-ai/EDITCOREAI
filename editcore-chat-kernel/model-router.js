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

// =====================================================================
// [EDITCORE-ADD] Tracking de rendimiento por modelo (100% opcional).
// No modifica pickModel. No rompe nada si no se usa.
//
// Uso:
//   const { recordModelOutcome, getModelStats } = require("./model-router");
//   recordModelOutcome(routedModel, { success: true, latencyMs: 1234 });
//   console.log(getModelStats());
//
// Persistencia: .editcore/model-router-stats.json
// =====================================================================
const _ecFs = require("fs");
const _ecPath = require("path");

const _ecStatsPath = _ecPath.join(process.cwd(), ".editcore", "model-router-stats.json");
const _ecStats = { models: {}, updatedAt: 0 };

function _ecLoadStats() {
  try {
    if (!_ecFs.existsSync(_ecStatsPath)) return;
    const raw = JSON.parse(_ecFs.readFileSync(_ecStatsPath, "utf8"));
    if (raw && raw.models && typeof raw.models === "object") {
      _ecStats.models = raw.models;
      _ecStats.updatedAt = raw.updatedAt || 0;
    }
  } catch (_) { /* no-op */ }
}

function _ecSaveStats() {
  try {
    _ecFs.mkdirSync(_ecPath.dirname(_ecStatsPath), { recursive: true });
    _ecStats.updatedAt = Date.now();
    _ecFs.writeFileSync(_ecStatsPath, JSON.stringify(_ecStats, null, 2), "utf8");
  } catch (_) { /* no-op */ }
}

_ecLoadStats();

/**
 * Igual que pickModel pero además guarda la decisión (modelo + razón + timestamp).
 */
function pickModelWithStats(args = {}) {
  const decision = pickModel(args);
  try {
    const key = String(decision && decision.model || "").trim();
    if (key) {
      const m = _ecStats.models[key] || { calls: 0, ok: 0, fail: 0, totalLatency: 0, lastReason: null };
      m.lastReason = decision.reason || null;
      m.lastUsedAt = Date.now();
      _ecStats.models[key] = m;
      _ecSaveStats();
    }
  } catch (_) { /* no-op */ }
  return decision;
}

/**
 * Registra el resultado real de una llamada a un modelo.
 * @param {string} modelId
 * @param {{ success?: boolean, latencyMs?: number }} outcome
 */
function recordModelOutcome(modelId, outcome = {}) {
  try {
    const key = String(modelId || "").trim();
    if (!key) return;
    const m = _ecStats.models[key] || { calls: 0, ok: 0, fail: 0, totalLatency: 0, lastReason: null };
    m.calls = (m.calls || 0) + 1;
    if (outcome.success) m.ok = (m.ok || 0) + 1;
    else m.fail = (m.fail || 0) + 1;
    m.totalLatency = (m.totalLatency || 0) + (Number(outcome.latencyMs) || 0);
    m.lastUsedAt = Date.now();
    _ecStats.models[key] = m;
    _ecSaveStats();
  } catch (_) { /* no-op */ }
}

/** Snapshot legible de estadísticas por modelo. */
function getModelStats() {
  const out = {};
  for (const [k, v] of Object.entries(_ecStats.models)) {
    const calls = v.calls || 0;
    out[k] = {
      calls,
      ok: v.ok || 0,
      fail: v.fail || 0,
      successRate: calls > 0 ? (v.ok || 0) / calls : null,
      avgLatencyMs: calls > 0 ? Math.round((v.totalLatency || 0) / calls) : null,
      lastReason: v.lastReason || null,
      lastUsedAt: v.lastUsedAt || null,
    };
  }
  return out;
}

/** Reset de stats. */
function resetModelStats() {
  _ecStats.models = {};
  _ecStats.updatedAt = 0;
  _ecSaveStats();
}
// [/EDITCORE-ADD]

module.exports = { pickModel };

// [EDITCORE-ADD] Exports adicionales (la línea de arriba queda intacta).
module.exports.pickModelWithStats = pickModelWithStats;
module.exports.recordModelOutcome = recordModelOutcome;
module.exports.getModelStats = getModelStats;
module.exports.resetModelStats = resetModelStats;