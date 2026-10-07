"use strict";

/**
 * TOKEN HARNESS V2 — Optimización extrema de tokens + Prompt Caching
 * EditCoreAI Fase 3
 *
 * Objetivos:
 *  1. Maximizar cache hit rate de proveedores (Anthropic/OpenAI/etc.)
 *     → bloques estáticos primero, estado dinámico al final
 *  2. Condensar historiales y tool results sin perder señal
 *  3. Presupuesto de tokens por corrida con degradación graceful
 *  4. Cache local de lecturas de archivos / tool outputs
 *  5. Compatible con a2a-bridge (Fase 1+2) y agent-token-harness legacy
 *
 * Sin dependencias nuevas.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HARNESS_VERSION = 2;

// Estimación rápida: ~4 chars ≈ 1 token (inglés/código); español un poco más
function estimateTokens(text = "") {
  const s = String(text || "");
  if (!s) return 0;
  // Heurística híbrida: palabras + chars
  const words = s.split(/\s+/).filter(Boolean).length;
  const byChars = Math.ceil(s.length / 3.8);
  return Math.max(words, byChars);
}

function sha256(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 24);
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ─────────────────────────────────────────────
// Perfiles de estrategia
// ─────────────────────────────────────────────

const STRATEGIES = {
  full: {
    name: "full",
    maxToolResultChars: 14_000,
    maxHistoryMessages: 24,
    maxHistoryChars: 48_000,
    maxFileCacheChars: 20_000,
    maxParallelReads: 6,
    summarizeAfterMessages: 16,
    preferCache: false,
  },
  moderate: {
    name: "moderate",
    maxToolResultChars: 7_000,
    maxHistoryMessages: 14,
    maxHistoryChars: 28_000,
    maxFileCacheChars: 12_000,
    maxParallelReads: 4,
    summarizeAfterMessages: 10,
    preferCache: true,
  },
  minimal: {
    name: "minimal",
    maxToolResultChars: 2_800,
    maxHistoryMessages: 8,
    maxHistoryChars: 12_000,
    maxFileCacheChars: 6_000,
    maxParallelReads: 2,
    summarizeAfterMessages: 6,
    preferCache: true,
  },
  emergency: {
    name: "emergency",
    maxToolResultChars: 1_200,
    maxHistoryMessages: 4,
    maxHistoryChars: 5_000,
    maxFileCacheChars: 2_500,
    maxParallelReads: 1,
    summarizeAfterMessages: 3,
    preferCache: true,
  },
};

function resolveStrategy(budgetRemainingRatio = 1, options = {}) {
  if (options.forceStrategy && STRATEGIES[options.forceStrategy]) {
    return { ...STRATEGIES[options.forceStrategy] };
  }
  if (options.analysisMode) return { ...STRATEGIES.moderate };
  if (budgetRemainingRatio < 0.08) return { ...STRATEGIES.emergency };
  if (budgetRemainingRatio < 0.22) return { ...STRATEGIES.minimal };
  if (budgetRemainingRatio < 0.45) return { ...STRATEGIES.moderate };
  return { ...STRATEGIES.full };
}

// ─────────────────────────────────────────────
// Cache local de tool/file reads (por proyecto)
// ─────────────────────────────────────────────

class LocalToolCache {
  constructor(projectRoot, options = {}) {
    this.filePath = path.join(
      path.resolve(projectRoot || "."),
      ".editcore",
      "token-harness",
      "tool-cache.json"
    );
    this.ttlMs = options.ttlMs || 2 * 60 * 60 * 1000; // 2h
    this.maxEntries = options.maxEntries || 1500;
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      }
    } catch (_) {}
    return { version: HARNESS_VERSION, entries: {}, stats: { hits: 0, misses: 0, saves: 0 } };
  }

  _save() {
    try {
      atomicWrite(this.filePath, JSON.stringify(this.data));
      this.data.stats.saves = (this.data.stats.saves || 0) + 1;
    } catch (_) {}
  }

  key(kind, args) {
    return sha256({ kind, args });
  }

  get(kind, args) {
    const k = this.key(kind, args);
    const e = this.data.entries[k];
    if (!e || e.expiresAt < Date.now()) {
      if (e) delete this.data.entries[k];
      this.data.stats.misses = (this.data.stats.misses || 0) + 1;
      return null;
    }
    e.lastAccess = Date.now();
    this.data.stats.hits = (this.data.stats.hits || 0) + 1;
    return e.value;
  }

  set(kind, args, value, ttlMs) {
    const k = this.key(kind, args);
    this.data.entries[k] = {
      value,
      expiresAt: Date.now() + (ttlMs || this.ttlMs),
      lastAccess: Date.now(),
      kind,
    };
    // Eviction simple LRU por lastAccess
    const keys = Object.keys(this.data.entries);
    if (keys.length > this.maxEntries) {
      keys
        .map((id) => ({ id, t: this.data.entries[id].lastAccess || 0 }))
        .sort((a, b) => a.t - b.t)
        .slice(0, keys.length - this.maxEntries)
        .forEach(({ id }) => delete this.data.entries[id]);
    }
    this._save();
  }

  stats() {
    return { ...this.data.stats, entries: Object.keys(this.data.entries).length };
  }
}

// ─────────────────────────────────────────────
// Presupuesto de tokens
// ─────────────────────────────────────────────

class TokenBudget {
  constructor(maxTokens = 120_000) {
    this.maxTokens = Math.max(4_000, Number(maxTokens) || 120_000);
    this.used = 0;
    this.byCategory = { system: 0, history: 0, tools: 0, output: 0, other: 0 };
  }

  consume(n, category = "other") {
    const v = Math.max(0, Number(n) || 0);
    this.used += v;
    this.byCategory[category] = (this.byCategory[category] || 0) + v;
    return this.remaining();
  }

  remaining() {
    return Math.max(0, this.maxTokens - this.used);
  }

  remainingRatio() {
    return this.maxTokens > 0 ? this.remaining() / this.maxTokens : 0;
  }

  snapshot() {
    return {
      max: this.maxTokens,
      used: this.used,
      remaining: this.remaining(),
      ratio: Number(this.remainingRatio().toFixed(3)),
      byCategory: { ...this.byCategory },
    };
  }
}

// ─────────────────────────────────────────────
// Prompt Builder orientado a cache
// ─────────────────────────────────────────────

/**
 * Construye el array de mensajes / system prompt optimizado para cache de proveedores.
 *
 * Orden canónico (estático → dinámico):
 *  1. System core (instrucciones fijas, roles, reglas)     ← CACHEABLE
 *  2. Self-awareness + patrones de memoria (semi-estático) ← CACHEABLE si no cambia
 *  3. Herramientas / schemas                              ← CACHEABLE
 *  4. Historial condensado
 *  5. Hallazgos A2A / checkpoint resume
 *  6. Mensaje de usuario actual                           ← siempre dinámico
 */
function buildCacheOptimizedMessages(parts, options = {}) {
  const {
    systemCore = "",
    memoryStable = "",
    toolsSchema = "",
    history = [],
    dynamicContext = "",
    userMessage = "",
    strategy = STRATEGIES.full,
  } = parts;

  // Bloque estático concatenado (mejor hit rate si el proveedor cachea por prefijo)
  const staticBlocks = [systemCore, memoryStable, toolsSchema].filter(Boolean);
  const staticText = staticBlocks.join("\n\n");

  const messages = [];

  if (staticText) {
    messages.push({
      role: "system",
      content: staticText,
      _cacheHint: "static_prefix",
    });
  }

  // Historial ya condensado
  const hist = Array.isArray(history) ? history : [];
  for (const m of hist) {
    if (!m || !m.content) continue;
    messages.push({
      role: m.role === "assistant" || m.role === "tool" ? m.role : m.role === "system" ? "system" : "user",
      content: String(m.content),
    });
  }

  // Contexto dinámico (A2A role, checkpoint, search results)
  if (dynamicContext) {
    messages.push({
      role: "system",
      content: dynamicContext,
      _cacheHint: "dynamic",
    });
  }

  if (userMessage) {
    messages.push({ role: "user", content: String(userMessage) });
  }

  return {
    messages,
    strategy: strategy.name,
    estimatedTokens: estimateTokens(
      staticText + hist.map((m) => m.content).join("") + (dynamicContext || "") + (userMessage || "")
    ),
    staticPrefixChars: staticText.length,
  };
}

// ─────────────────────────────────────────────
// Condensación de historial y tool results
// ─────────────────────────────────────────────

function clipText(text, maxChars, label = "recortado") {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  const head = Math.floor(maxChars * 0.72);
  const tail = Math.floor(maxChars * 0.18);
  return `${s.slice(0, head)}\n…[${label}: ${s.length - maxChars} chars omitidos]…\n${s.slice(-tail)}`;
}

function condenseToolResult(result, maxChars = 8_000) {
  if (result == null) return result;
  if (typeof result === "string") return clipText(result, maxChars, "tool");
  if (typeof result !== "object") return result;

  try {
    const clone = JSON.parse(JSON.stringify(result));
    const limit = Math.max(600, maxChars);

    const clipStr = (v) => (typeof v === "string" && v.length > limit ? clipText(v, limit, "tool") : v);

    if (typeof clone.content === "string") clone.content = clipStr(clone.content);
    if (typeof clone.text === "string") clone.text = clipStr(clone.text);
    if (typeof clone.snippet === "string") clone.snippet = clipStr(clone.snippet);
    if (typeof clone.stdout === "string") clone.stdout = clipStr(clone.stdout);
    if (typeof clone.stderr === "string") clone.stderr = clipStr(clone.stderr);

    if (Array.isArray(clone.entries) && clone.entries.length > 60) {
      clone.entries = clone.entries.slice(0, 60);
      clone._truncated = true;
    }
    if (Array.isArray(clone.matches) && clone.matches.length > 30) {
      clone.matches = clone.matches.slice(0, 30);
      clone._truncated = true;
    }
    if (Array.isArray(clone.files) && clone.files.length > 40) {
      clone.files = clone.files.slice(0, 40);
      clone._truncated = true;
    }

    const encoded = JSON.stringify(clone);
    if (encoded.length > limit * 2.2) {
      return {
        ok: clone.ok !== false,
        path: clone.path || null,
        summary: clipText(encoded, limit, "tool-json"),
        _truncated: true,
      };
    }
    return clone;
  } catch {
    return clipText(String(result), maxChars, "tool");
  }
}

/**
 * Condensa un historial de mensajes largo:
 *  - Mantiene los N más recientes intactos
 *  - Resume el resto en un único mensaje system
 */
function condenseHistory(messages = [], strategy = STRATEGIES.full) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const maxMsg = strategy.maxHistoryMessages || 14;
  const maxChars = strategy.maxHistoryChars || 28_000;

  if (list.length <= maxMsg) {
    // Aún así respetar chars
    let total = 0;
    const out = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const c = String(m.content || "");
      if (total + c.length > maxChars && out.length > 2) break;
      out.unshift({ role: m.role, content: c.length > 6000 ? clipText(c, 6000, "hist") : c });
      total += Math.min(c.length, 6000);
    }
    return out;
  }

  const keep = list.slice(-Math.max(4, Math.floor(maxMsg * 0.65)));
  const older = list.slice(0, list.length - keep.length);

  const summaryLines = ["[RESUMEN DE TURNOS ANTERIORES]"];
  for (const m of older.slice(-12)) {
    const role = m.role || "user";
    const snippet = String(m.content || "")
      .replace(/\s+/g, " ")
      .slice(0, 180);
    summaryLines.push(`• ${role}: ${snippet}`);
  }
  let summary = summaryLines.join("\n");
  if (summary.length > 3500) summary = clipText(summary, 3500, "resumen");

  const condensed = [{ role: "system", content: summary }, ...keep.map((m) => ({
    role: m.role,
    content: String(m.content || "").length > 5000
      ? clipText(m.content, 5000, "hist")
      : String(m.content || ""),
  }))];

  // Ajuste final por chars
  let total = 0;
  const final = [];
  for (let i = condensed.length - 1; i >= 0; i--) {
    const c = condensed[i].content || "";
    if (total + c.length > maxChars && final.length > 2) break;
    final.unshift(condensed[i]);
    total += c.length;
  }
  return final;
}

// ─────────────────────────────────────────────
// Harness principal
// ─────────────────────────────────────────────

class TokenHarnessV2 {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   * @param {number} [options.maxTokens]
   * @param {object} [options.a2aBridge] - instancia getA2ABridge (opcional)
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot || ".");
    this.budget = new TokenBudget(options.maxTokens || 120_000);
    this.cache = new LocalToolCache(this.projectRoot, options.cache || {});
    this.a2aBridge = options.a2aBridge || null;
    this.stats = {
      promptsBuilt: 0,
      toolsClipped: 0,
      historyCondensed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      tokensSavedEst: 0,
    };
    this._runId = null;
  }

  startRun(runId, maxTokens) {
    this._runId = runId || `harness_${Date.now().toString(36)}`;
    if (maxTokens) this.budget = new TokenBudget(maxTokens);
    return this._runId;
  }

  getStrategy(options = {}) {
    return resolveStrategy(this.budget.remainingRatio(), options);
  }

  /**
   * Construye mensajes optimizados para el LLM.
   * @param {object} input
   * @param {string} input.systemCore - instrucciones fijas del sistema
   * @param {string} [input.toolsSchema]
   * @param {Array}  [input.history]
   * @param {string} [input.userMessage]
   * @param {string} [input.role] - rol A2A activo
   * @param {object} [options]
   */
  buildPrompt(input = {}, options = {}) {
    const strategy = this.getStrategy(options);
    this.stats.promptsBuilt += 1;

    // Memoria estable + dinámica desde A2A bridge si existe
    let memoryStable = input.memoryStable || "";
    let dynamicContext = input.dynamicContext || "";

    if (this.a2aBridge) {
      try {
        const full = this.a2aBridge.getFullPrompt(input.role || "supervisor", input.userMessage || "");
        // Separar: self-awareness / patrones ≈ estable; rol A2A + checkpoint ≈ dinámico
        const parts = full.split(/\n\n===\s*ROL/i);
        if (parts.length >= 2) {
          memoryStable = (memoryStable + "\n\n" + parts[0]).trim();
          dynamicContext = ("=== ROL" + parts.slice(1).join("\n\n===")).trim();
        } else {
          dynamicContext = (dynamicContext + "\n\n" + full).trim();
        }
      } catch (_) {}
    }

    const history = condenseHistory(input.history || [], strategy);
    if ((input.history || []).length > history.length) {
      this.stats.historyCondensed += 1;
    }

    const built = buildCacheOptimizedMessages(
      {
        systemCore: input.systemCore || "",
        memoryStable,
        toolsSchema: input.toolsSchema || "",
        history,
        dynamicContext,
        userMessage: input.userMessage || "",
        strategy,
      },
      options
    );

    // Contabilizar presupuesto (system + history + user)
    const sysTokens = estimateTokens(built.messages.filter((m) => m.role === "system").map((m) => m.content).join(""));
    const histTokens = estimateTokens(history.map((m) => m.content).join(""));
    this.budget.consume(sysTokens, "system");
    this.budget.consume(histTokens, "history");
    this.budget.consume(estimateTokens(input.userMessage || ""), "other");

    return {
      ...built,
      budget: this.budget.snapshot(),
      strategy: strategy.name,
      runId: this._runId,
    };
  }

  /**
   * Recorta un tool result según la estrategia actual.
   */
  clipToolResult(result, options = {}) {
    const strategy = this.getStrategy(options);
    const clipped = condenseToolResult(result, strategy.maxToolResultChars);
    this.stats.toolsClipped += 1;
    const before = estimateTokens(typeof result === "string" ? result : JSON.stringify(result || ""));
    const after = estimateTokens(typeof clipped === "string" ? clipped : JSON.stringify(clipped || ""));
    this.stats.tokensSavedEst += Math.max(0, before - after);
    this.budget.consume(after, "tools");
    return clipped;
  }

  /**
   * Cache get/set para lecturas de archivos u otros tools idempotentes.
   */
  cacheGet(kind, args) {
    const v = this.cache.get(kind, args);
    if (v != null) this.stats.cacheHits += 1;
    else this.stats.cacheMisses += 1;
    return v;
  }

  cacheSet(kind, args, value, ttlMs) {
    this.cache.set(kind, args, value, ttlMs);
  }

  /**
   * Registra tokens de salida del modelo.
   */
  recordOutputTokens(n) {
    this.budget.consume(n, "output");
  }

  /**
   * ¿Debemos forzar un reporte / parar herramientas?
   */
  shouldForceReport() {
    return this.budget.remainingRatio() < 0.10;
  }

  shouldPreferCache() {
    return this.getStrategy().preferCache === true;
  }

  getMaxParallelReads() {
    return this.getStrategy().maxParallelReads;
  }

  snapshot() {
    return {
      version: HARNESS_VERSION,
      runId: this._runId,
      budget: this.budget.snapshot(),
      strategy: this.getStrategy().name,
      stats: { ...this.stats },
      cache: this.cache.stats(),
    };
  }
}

// ─────────────────────────────────────────────
// Factory + compat con harness legacy
// ─────────────────────────────────────────────

function createTokenHarness(projectRoot, options) {
  return new TokenHarnessV2(projectRoot, options);
}

/** Adapter que expone la API del harness legacy para drop-in parcial */
function resolveHarnessProfile(depthProfile, budget, options = {}) {
  const ratio =
    budget && typeof budget.remainingRatio === "function"
      ? budget.remainingRatio()
      : budget && typeof budget.ratio === "number"
        ? budget.ratio
        : 1;
  const s = resolveStrategy(ratio, options);
  return {
    strategy: s.name,
    forceReport: ratio < 0.12,
    maxToolResultChars: s.maxToolResultChars,
    maxParallelReads: s.maxParallelReads,
    preferCache: s.preferCache,
  };
}

module.exports = {
  TokenHarnessV2,
  TokenBudget,
  LocalToolCache,
  createTokenHarness,
  resolveHarnessProfile,
  resolveStrategy,
  estimateTokens,
  condenseToolResult,
  condenseHistory,
  buildCacheOptimizedMessages,
  clipText,
  STRATEGIES,
  HARNESS_VERSION,
};
