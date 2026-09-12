"use strict";

(function exposeAutoModelSelection(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreAutoModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutoModelSelection() {
  const AUTO_MODEL_SELECTION = "__auto__";
  const CAPABILITY_FAIL_TTL_MS = 20 * 60 * 1000;
  const SLOW_MODEL_MS = 90_000;
  const UPSTREAM_ORDER = ["meai", "apicredits"];

  // Modelos estables conocidos (fallback si no hay catalogo amplio).
  const AUTO_SAFE_MODEL_PATTERNS = [
    /fable-5/i,
    /claude-haiku-4/i,
    /claude-sonnet-4[.-]6/i,
    /meai\/claude-sonnet-4\.6/i,
    /gpt-5\.6-(?:luna|sol|terra)/i,
    /glm-5$/i,
    /qwen3\.6-plus/i,
    /deepseek-v4-pro/i,
    /kimi-k2\.6/i,
    /gemini-2\.5-flash/i,
    /grok-4\.[35]/i,
  ];

  const TIER_SCORES = [
    ["claude-fable-5", 72],
    ["claude-opus-4.8", 100],
    ["claude-opus-4", 98],
    ["claude-opus", 95],
    ["claude-sonnet-4", 88],
    ["claude-sonnet", 85],
    ["gpt-5.6", 82],
    ["gpt-5", 76],
    ["gpt-4o", 70],
    ["grok-4.5", 68],
    ["grok-4.3", 64],
    ["deepseek-v4-pro", 58],
    ["deepseek-v4", 55],
    ["kimi-k2.6", 53],
    ["kimi-k2", 52],
    ["glm-5", 48],
    ["qwen3", 45],
    ["claude-haiku", 42],
    ["gemini-2.5-flash", 40],
    ["mini", 38],
    ["flash", 32],
    ["turbo", 30],
  ];

  // ---------------------------------------------------------------------------
  // CATALOGO EXPLICITO: cada modelo tiene un trabajo. Auto NO pelea por "el mejor".
  // Clasifica la tarea → toma el carril del rol → rota least-used SOLO dentro del carril.
  // ---------------------------------------------------------------------------
  const MODEL_DUTY_CATALOG = [
    // ME AI
    { id: "meai/claude-opus-4.8", family: "claude", duty: "verify+hard-implement", purpose: "Auditorias criticas, refactors dificiles, cierre de plan con tools." },
    { id: "meai/claude-sonnet-4.6", family: "claude", duty: "implement+analyze", purpose: "Agente principal: editar codigo, analizar runtime, reportes con tools." },
    { id: "meai/claude-haiku-4-5", family: "claude", duty: "chat+fast-analyze", purpose: "Chat corto y analisis rapido de bajo costo." },
    { id: "meai/qwen3.6-plus", family: "qwen", duty: "implement-alt", purpose: "Alternativa de implementacion cuando Claude/Grok ya se usaron." },
    { id: "meai/glm-5", family: "glm", duty: "implement-alt", purpose: "Alternativa de implementacion / analisis medio." },
    { id: "meai/kimi-k2.6", family: "kimi", duty: "chat+alt", purpose: "Chat y respaldo ligero; no es el agente principal." },
    { id: "meai/deepseek-v4-pro", family: "deepseek", duty: "reserve", purpose: "RESERVA cara. Solo si fallan los del carril primario/secundario. Nunca dominante." },
    // APICredits
    { id: "apicredits/claude-fable-5", family: "claude", duty: "implement+analyze", purpose: "Agente Claude barato/estable en APICredits." },
    { id: "apicredits/claude-sonnet-5", family: "claude", duty: "implement", purpose: "Implementacion fuerte APICredits." },
    { id: "apicredits/claude-sonnet-4-6", family: "claude", duty: "analyze+implement", purpose: "Analisis e implementacion equilibrada." },
    { id: "apicredits/claude-opus-4-8", family: "claude", duty: "verify", purpose: "Verificacion / alto riesgo." },
    { id: "apicredits/claude-opus-4-7", family: "claude", duty: "verify", purpose: "Verificacion alternativa." },
    { id: "apicredits/claude-haiku-4-5", family: "claude", duty: "chat", purpose: "Chat y lecturas cortas." },
    { id: "apicredits/gpt-5.6-terra", family: "gpt", duty: "implement", purpose: "Implementacion GPT con tools." },
    { id: "apicredits/gpt-5.6-luna", family: "gpt", duty: "chat+analyze", purpose: "Chat y analisis ligero." },
    { id: "apicredits/gpt-5.6-sol", family: "gpt", duty: "chat-only", purpose: "SOLO chat. Prohibido como agente con tools." },
    { id: "apicredits/grok-4.5", family: "grok", duty: "implement+verify", purpose: "Implementacion / verificacion alternativa." },
    { id: "apicredits/grok-4.3", family: "grok", duty: "analyze+chat", purpose: "Analisis y chat medio." },
    { id: "apicredits/gemini-2.5-flash", family: "gemini", duty: "analyze+chat", purpose: "Analisis rapido y chat; no implementacion pesada." },
    { id: "apicredits/deepseek-v4-pro", family: "deepseek", duty: "reserve", purpose: "RESERVA. Key propia cara. Solo fallback, max 12% share." },
  ];

  /**
   * Carriles por rol. Orden = prioridad de USO (no score).
   * Auto elige el primer carril con modelos disponibles y rota ahi.
   * primary pelea entre si por least-used; secondary/reserve NO compiten con primary.
   */
  const ROLE_LANES = {
    implement: {
      purpose: "Crear/editar/arreglar codigo con write_file y tools.",
      primary: [
        /claude-sonnet-4/,
        /claude-sonnet-5/,
        /claude-fable/,
        /claude-opus/,
        /gpt-5\.6-terra/,
        /grok-4\.5/,
        /qwen3\.6-plus/,
      ],
      secondary: [/kimi-k2\.6/, /glm-5/, /grok-4\.3/],
      reserve: [/deepseek-v4-pro/],
      forbid: [/gpt-5\.6-sol/, /gemini-2\.5-flash/],
    },
    analyze: {
      purpose: "Leer, diagnosticar, planear, reportes (sin mutar o antes de PROCEDE).",
      primary: [
        /claude-sonnet/,
        /claude-fable/,
        /claude-haiku/,
        /grok-4\.3/,
        /gemini-2\.5-flash/,
        /gpt-5\.6-luna/,
        /qwen3\.6-plus/,
        /glm-5/,
      ],
      secondary: [/grok-4\.5/, /kimi-k2\.6/, /claude-opus/],
      reserve: [/deepseek-v4/],
      forbid: [/gpt-5\.6-sol/],
    },
    chat: {
      purpose: "Mensajes cortos sin tools de proyecto.",
      primary: [
        /claude-haiku/,
        /gpt-5\.6-luna/,
        /gemini-2\.5-flash/,
        /grok-4\.3/,
        /kimi-k2\.6/,
        /glm-5/,
        /qwen3\.6-plus/,
      ],
      secondary: [/claude-sonnet/, /claude-fable/],
      reserve: [/deepseek-v4/, /gpt-5\.6-sol/],
      forbid: [/claude-opus/, /gpt-5\.6-terra/],
    },
    verify: {
      purpose: "Auditoria, seguridad, produccion, go/no-go.",
      primary: [
        /claude-opus/,
        /claude-fable/,
        /gpt-5\.6-sol/,
        /grok-4\.5/,
        /claude-sonnet/,
        /gpt-5\.6-terra/,
        /qwen3\.6-plus/,
      ],
      secondary: [/grok-4\.3/, /kimi-k2\.6/, /glm-5/],
      reserve: [/deepseek-v4-pro/],
      forbid: [/claude-haiku/, /gemini-2\.5-flash/, /gpt-5\.6-luna/],
    },
  };

  // Compat: ROLE_FIT derivado del catalogo (tests / scoreModelForAuto legacy).
  const ROLE_FIT = {
    implement: [
      [/claude-opus|claude-fable|claude-sonnet-5|claude-sonnet-4|gpt-5\.6-terra|grok-4\.5|qwen3\.6-plus/i, 100],
      [/kimi-k2\.6|glm-5|grok-4\.3/i, 70],
      [/deepseek-v4/i, 40],
      [/claude-haiku|gemini-2\.5-flash|gpt-5\.6-luna/i, 30],
    ],
    analyze: [
      [/claude-sonnet|claude-fable|claude-haiku|grok-4\.3|gemini-2\.5-flash|gpt-5\.6-luna|qwen3\.6-plus/i, 100],
      [/grok-4\.5|kimi-k2\.6|glm-5|claude-opus/i, 70],
      [/deepseek-v4/i, 40],
      [/gpt-5\.6-terra|gpt-5\.6-sol/i, 35],
    ],
    chat: [
      [/claude-haiku|gpt-5\.6-luna|gemini-2\.5-flash|grok-4\.3|kimi-k2\.6/i, 100],
      [/glm-5|qwen3\.6-plus|claude-sonnet|claude-fable|deepseek-v4|gpt-5\.6-sol/i, 70],
      [/claude-opus|gpt-5\.6-terra|grok-4\.5/i, 30],
    ],
    verify: [
      [/claude-opus|claude-fable|gpt-5\.6-sol|grok-4\.5|claude-sonnet|gpt-5\.6-terra/i, 100],
      [/grok-4\.3|qwen3\.6-plus|kimi-k2\.6|glm-5/i, 70],
      [/deepseek-v4/i, 40],
      [/claude-haiku|gemini-2\.5-flash|gpt-5\.6-luna/i, 20],
    ],
  };
  const ROLE_SCORE_BAND = 28;
  // Tope duro: DeepSeek no puede concentrar el Auto (APICredits key + MEAI).
  const DEEPSEEK_MAX_SHARE = 0.12;
  const DEEPSEEK_USAGE_WEIGHT = 3;

  function isAutoModelSelection(optionOrValue) {
    if (!optionOrValue) return false;
    if (typeof optionOrValue === "string") return optionOrValue === AUTO_MODEL_SELECTION;
    return optionOrValue.dataset?.auto === "1" || optionOrValue.value === AUTO_MODEL_SELECTION;
  }

  function baseTierScore(model) {
    const normalized = String(model || "").toLowerCase();
    for (const [key, score] of TIER_SCORES) {
      if (normalized.includes(key)) return score;
    }
    return 40;
  }

  function gatewayUpstreamGroup(model) {
    const parts = String(model || "").split("/");
    return parts.length > 1 ? parts[0].toLowerCase() : "";
  }

  function isDeepseekModel(model) {
    return /deepseek/i.test(String(model || ""));
  }

  function modelFamily(model) {
    const normalized = String(model || "").toLowerCase();
    const bare = normalized.includes("/") ? normalized.split("/").slice(1).join("/") : normalized;
    if (/gpt-5\.6|gpt-4/.test(bare)) return "gpt";
    if (/claude/.test(bare)) return "claude";
    if (/gemini/.test(bare)) return "gemini";
    if (/grok/.test(bare)) return "grok";
    if (/deepseek/.test(bare)) return "deepseek";
    if (/qwen/.test(bare)) return "qwen";
    if (/kimi/.test(bare)) return "kimi";
    if (/glm/.test(bare)) return "glm";
    return bare.split(/[-_.]/)[0] || "other";
  }

  function apicreditsModelFamily(model) {
    const normalized = String(model || "").toLowerCase();
    if (!normalized.startsWith("apicredits/") && gatewayUpstreamGroup(normalized) === "apicredits") {
      return modelFamily(normalized);
    }
    if (!normalized.startsWith("apicredits/")) return "";
    return modelFamily(normalized);
  }

  function deepseekUsageShare(context = {}, list = []) {
    const usage = modelUsageMap(context);
    const models = (Array.isArray(list) ? list : [])
      .map((entry) => String(entry?.model || entry || "").toLowerCase())
      .filter(Boolean);
    const universe = models.length
      ? models
      : Object.keys(usage);
    if (!universe.length) return 0;
    let deep = 0;
    let total = 0;
    for (const model of universe) {
      const count = Math.max(0, Number(usage[model]) || 0);
      total += count;
      if (isDeepseekModel(model)) deep += count;
    }
    if (total <= 0) return 0;
    return deep / total;
  }

  function deepseekOverShare(context = {}, list = []) {
    return deepseekUsageShare(context, list) >= DEEPSEEK_MAX_SHARE;
  }

  /** Buckets de rotacion equitativa: 50% ME AI, 50% APICredits. */
  function autoRotationBucket(model) {
    const upstream = gatewayUpstreamGroup(model);
    if (upstream === "meai" || upstream === "apicredits") return upstream;
    return "";
  }

  function usageMap(context = {}) {
    const raw = context.autoUpstreamUsage && typeof context.autoUpstreamUsage === "object"
      ? context.autoUpstreamUsage
      : {};
    return {
      meai: Math.max(0, Number(raw.meai) || 0),
      apicredits: Math.max(0, Number(raw.apicredits) || 0),
    };
  }

  function modelUsageMap(context = {}) {
    const raw = context.autoModelUsage && typeof context.autoModelUsage === "object"
      ? context.autoModelUsage
      : {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      const model = String(key || "").toLowerCase();
      if (!model) continue;
      out[model] = Math.max(0, Number(value) || 0);
    }
    return out;
  }

  function pickLeastUsedEntry(list, context = {}) {
    const source = (Array.isArray(list) ? list : []).filter(Boolean);
    if (!source.length) return null;
    if (source.length === 1) return source[0];
    const usage = modelUsageMap(context);
    const last = String(context.lastAutoResolvedModel || "").toLowerCase();
    const lastFamily = modelFamily(last);
    const overDeepseek = deepseekOverShare(context, source);
    const prefer = source.filter((entry) => {
      if (!overDeepseek) return true;
      return !isDeepseekModel(entry?.model);
    });
    const pool = prefer.length ? prefer : source;
    const familyCounts = {};
    for (const entry of pool) {
      const family = modelFamily(entry?.model);
      familyCounts[family] = (familyCounts[family] || 0) + (Number(usage[String(entry?.model || "").toLowerCase()]) || 0);
    }
    const ranked = pool.map((entry) => {
      const model = String(entry?.model || "").toLowerCase();
      const family = modelFamily(model);
      const raw = Math.max(0, Number(usage[model]) || 0);
      // DeepSeek pesa más: un pick equivale a varios para no concentrar gasto.
      const count = isDeepseekModel(model) ? raw : raw;
      return {
        entry,
        model,
        family,
        count,
        familyCount: Math.max(0, Number(familyCounts[family]) || 0),
        isLast: model === last,
        isLastFamily: family === lastFamily,
        deepseekPenalty: isDeepseekModel(model) ? 1 : 0,
      };
    }).sort((a, b) => {
      if (a.deepseekPenalty !== b.deepseekPenalty && overDeepseek) return a.deepseekPenalty - b.deepseekPenalty;
      if (a.familyCount !== b.familyCount) return a.familyCount - b.familyCount;
      if (a.count !== b.count) return a.count - b.count;
      if (a.isLastFamily !== b.isLastFamily) return a.isLastFamily ? 1 : -1;
      if (a.isLast !== b.isLast) return a.isLast ? 1 : -1;
      return a.model.localeCompare(b.model, undefined, { sensitivity: "base", numeric: true });
    });
    return ranked[0]?.entry || pool[0];
  }

  function preferredAutoBucket(context = {}, list = []) {
    const available = availableBuckets(list);
    if (!available.size) return "meai";

    const usage = usageMap(context);
    const modelUsage = modelUsageMap(context);
    const lastBucket = autoRotationBucket(String(context.lastAutoResolvedModel || ""));

    // Preferir el upstream con menos llamadas; desempate por uso acumulado de modelos.
    const ranked = UPSTREAM_ORDER
      .filter((bucket) => available.has(bucket))
      .sort((a, b) => {
        const diff = usage[a] - usage[b];
        if (diff !== 0) return diff;
        const modelSum = (bucket) => entriesForBucket(list, bucket)
          .reduce((sum, entry) => sum + (Number(modelUsage[String(entry?.model || "").toLowerCase()]) || 0), 0);
        const sumDiff = modelSum(a) - modelSum(b);
        if (sumDiff !== 0) return sumDiff;
        if (lastBucket === a) return 1;
        if (lastBucket === b) return -1;
        return UPSTREAM_ORDER.indexOf(a) - UPSTREAM_ORDER.indexOf(b);
      });
    return ranked[0] || [...available][0] || "meai";
  }

  function availableBuckets(list) {
    return new Set(
      (Array.isArray(list) ? list : [])
        .map((entry) => autoRotationBucket(entry?.model))
        .filter(Boolean)
    );
  }

  function entriesForBucket(list, bucket) {
    return (Array.isArray(list) ? list : []).filter((entry) => autoRotationBucket(entry?.model) === bucket);
  }

  function isAgentExecutionContext(context = {}) {
    return Boolean(context.isAgent && context.usesProjectTools && !context.directReadOnly
      && (context.planAuthorizedExecution || !context.needsAnalysisFirst));
  }

  function classifyAutoTaskRole(context = {}) {
    const prompt = String(context.prompt || "").toLowerCase();
    const agentExecution = isAgentExecutionContext(context);
    const agentAnalysis = Boolean(context.isAgent && context.usesProjectTools
      && (context.directReadOnly || context.needsAnalysisFirst));
    const simpleChat = !context.usesProjectTools;

    if (/verifica|auditor[ií]a|seguridad|producci[oó]n|go\/no-go|root.?cause|incidente/i.test(prompt)) {
      return "verify";
    }
    if (agentExecution || /\b(crea|crear|implementa|arregla|fix|escribe|edita|aplica|procede|contin[uú]a|refactor)\b/i.test(prompt)) {
      return "implement";
    }
    if (agentAnalysis || /\b(analiza|revisa|explica|lee|inspecciona|diagnostica|resume|plan)\b/i.test(prompt)) {
      return "analyze";
    }
    if (simpleChat || prompt.length < 80) return "chat";
    return agentExecution ? "implement" : "analyze";
  }

  function matchesAnyPattern(model, patterns = []) {
    const normalized = String(model || "").toLowerCase();
    return (patterns || []).some((pattern) => pattern.test(normalized));
  }

  function entriesForLane(list, patterns = []) {
    return (Array.isArray(list) ? list : []).filter((entry) => matchesAnyPattern(entry?.model, patterns));
  }

  function describeModelDuty(model) {
    const normalized = String(model || "").toLowerCase();
    const exact = MODEL_DUTY_CATALOG.find((row) => row.id === normalized);
    if (exact) return exact;
    const bare = normalized.includes("/") ? normalized : normalized;
    return MODEL_DUTY_CATALOG.find((row) => row.id.endsWith(`/${bare.split("/").pop()}`))
      || { id: normalized, family: modelFamily(normalized), duty: "unknown", purpose: "Sin rol catalogado; se usa solo como fallback." };
  }

  function roleFitScore(model, role) {
    const lanes = ROLE_LANES[role] || ROLE_LANES.analyze;
    const normalized = String(model || "").toLowerCase();
    if (matchesAnyPattern(normalized, lanes.forbid || [])) return 0;
    if (matchesAnyPattern(normalized, lanes.primary || [])) return 100;
    if (matchesAnyPattern(normalized, lanes.secondary || [])) return 70;
    if (matchesAnyPattern(normalized, lanes.reserve || [])) return 40;
    const rows = ROLE_FIT[role] || ROLE_FIT.analyze;
    for (const [pattern, score] of rows) {
      if (pattern.test(normalized)) return score;
    }
    return 20;
  }

  /**
   * Elige modelo sin pelea de scores:
   * 1) balance 50/50 ME AI ↔ APICredits
   * 2) carril explicito del rol (primary → secondary → reserve)
   * 3) least-used / familias dentro del carril elegido
   */
  function pickTaskFitEntry(list, context = {}) {
    const source = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!source.length) return null;
    if (source.length === 1) return source[0];

    const role = classifyAutoTaskRole(context);
    const lanes = ROLE_LANES[role] || ROLE_LANES.analyze;
    const preferred = preferredAutoBucket(context, source);
    const order = [preferred, ...UPSTREAM_ORDER.filter((bucket) => bucket !== preferred)];
    const laneOrder = ["primary", "secondary", "reserve"];

    for (const bucket of order) {
      let entries = entriesForBucket(source, bucket);
      if (!entries.length) continue;
      entries = entries.filter((entry) => !matchesAnyPattern(entry?.model, lanes.forbid || []));
      if (!entries.length) continue;

      for (const laneName of laneOrder) {
        if (laneName === "reserve" && deepseekOverShare(context, source)) continue;
        const lanePool = entriesForLane(entries, lanes[laneName] || []);
        if (!lanePool.length) continue;
        return pickLeastUsedEntry(lanePool, context);
      }

      // Si el bucket no tiene ningun carril del rol, no inventar pelea: pasa al otro upstream.
    }

    // Ultimo recurso: least-used global sin modelos prohibidos del rol.
    const allowed = source.filter((entry) => !matchesAnyPattern(entry?.model, (ROLE_LANES[role] || {}).forbid || []));
    return pickLeastUsedEntry(allowed.length ? allowed : source, context);
  }

  function isChatOnlyModel(model) {
    const normalized = String(model || "").toLowerCase();
    return /gpt-5\.6-sol/i.test(normalized) || describeModelDuty(normalized).duty === "chat-only";
  }

  function entrySupportsAgentTools(entry, capabilities = {}) {
    const cap = findCapabilityForEntry(entry, capabilities);
    if (cap?.capability === "agent" || cap?.toolOK === true) return true;
    if (cap?.capability === "chat" || cap?.toolOK === false) return false;
    return !isChatOnlyModel(entry?.model);
  }

  function preferredApicreditsFamily(context = {}) {
    const last = String(context.lastAutoResolvedModel || "").toLowerCase();
    const lastFamily = apicreditsModelFamily(last.includes("/") ? last : `apicredits/${last}`);
    if (lastFamily === "claude") return "gpt";
    if (lastFamily === "gpt") return "gemini";
    if (lastFamily === "gemini") return "grok";
    if (lastFamily === "grok") return "deepseek";
    if (lastFamily === "deepseek") return "claude";
    return isAgentExecutionContext(context) ? "gpt" : "claude";
  }

  function findCapabilityForEntry(entry, capabilities = {}) {
    const model = String(entry?.model || "").toLowerCase();
    if (!model) return null;
    for (const cap of Object.values(capabilities || {})) {
      if (String(cap?.model || "").toLowerCase() === model) return cap;
    }
    return null;
  }

  function isRecentlyFailedCapability(cap) {
    if (!cap) return false;
    const failStreak = Number(cap.failStreak) || 0;
    const lastFailAt = Number(cap.lastFailAt) || 0;
    if (failStreak < 2) return false;
    if (Date.now() - lastFailAt > CAPABILITY_FAIL_TTL_MS) return false;
    return !cap.ok || failStreak >= 2;
  }

  function isProviderFailureMessage(message) {
    const text = String(message || "");
    return /no est[aá] disponible|tard[oó] demasiado|502|503|401|403|upstream|forbidden|temporarily unavailable|no available accounts|invalid.?token|inv[aá]lid.?token|无效|令牌|上游|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|aborted|proveedor respondio|respuesta vacia|EMPTY_PROVIDER|devolvio una respuesta/i.test(text);
  }

  function isSafeDefaultModel(model) {
    const normalized = String(model || "").toLowerCase();
    return AUTO_SAFE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function filterAutoModelOptions(options, capabilities = {}, { excludeModels = [] } = {}) {
    const list = Array.isArray(options) ? options.filter(Boolean) : [];
    if (!list.length) return list;
    const excluded = new Set((excludeModels || []).map((item) => String(item || "").toLowerCase()).filter(Boolean));

    return list.filter((entry) => {
      const model = String(entry?.model || "").toLowerCase();
      if (excluded.has(model)) return false;
      return !isRecentlyFailedCapability(findCapabilityForEntry(entry, capabilities));
    });
  }

  function pickRoundRobinEntry(list, context = {}) {
    const stable = [...(Array.isArray(list) ? list : [])]
      .filter(Boolean)
      .sort((a, b) => String(a?.model || "").localeCompare(String(b?.model || ""), undefined, { sensitivity: "base", numeric: true }));
    if (!stable.length) return null;
    const last = String(context.lastAutoResolvedModel || "").toLowerCase();
    const lastIdx = stable.findIndex((entry) => String(entry?.model || "").toLowerCase() === last);
    const start = lastIdx >= 0 ? (lastIdx + 1) % stable.length : 0;
    return stable[start] || stable[0];
  }

  function pickEquitableEntry(list, context = {}) {
    return pickTaskFitEntry(list, context);
  }

  function pickBalancedAutoEntry(list, context = {}) {
    return pickTaskFitEntry(list, context);
  }

  function pickVerifiedModelEntry(list, capabilities = {}, context = {}) {
    const verified = list
      .map((entry) => ({ entry, cap: findCapabilityForEntry(entry, capabilities) }))
      .filter(({ cap }) => cap?.ok && Number(cap.lastOkAt || 0) > Date.now() - CAPABILITY_FAIL_TTL_MS)
      .map(({ entry }) => entry);
    if (!verified.length) return null;
    return pickTaskFitEntry(verified, context);
  }

  function pickSafeDefaultEntry(list, context = {}) {
    const equitable = pickTaskFitEntry(list, context);
    if (equitable) return equitable;
    for (const pattern of AUTO_SAFE_MODEL_PATTERNS) {
      const match = list.find((entry) => pattern.test(String(entry?.model || "")));
      if (match) return match;
    }
    return null;
  }

  function pickRotatedEntry(list, context = {}) {
    return pickTaskFitEntry(list, context);
  }

  function scoreModelForAuto(entry, context = {}) {
    const model = String(entry?.model || "").toLowerCase();
    const role = classifyAutoTaskRole(context);
    let score = baseTierScore(model) * 0.35 + roleFitScore(model, role);
    const {
      prompt = "",
      hasAttachments = false,
      hasImages = false,
      capabilities = {},
    } = context;

    const cap = findCapabilityForEntry(entry, capabilities);
    const verified = cap?.ok && Number(cap.lastOkAt || 0) > Date.now() - CAPABILITY_FAIL_TTL_MS;

    if (isSafeDefaultModel(model)) score += 8;
    if (isAgentExecutionContext(context) && isChatOnlyModel(model)) score -= 120;
    if (role === "implement" && /mini|flash|turbo|luna/i.test(model)) score -= 8;
    if (role === "chat" && /opus|fable|sol/i.test(model)) score -= 12;

    const promptLen = String(prompt || "").length;
    if (promptLen > 4000 && /opus|fable|sonnet|grok-4\.5|terra|sol/i.test(model)) score += 10;
    else if (promptLen > 1500 && /sonnet|grok|deepseek|terra/i.test(model)) score += 5;

    if (hasAttachments || hasImages) {
      if (/gpt-4o|claude|gemini|vision|grok/i.test(model)) score += 12;
      else score -= 8;
    }

    // EDITCOREAI: solo proveedores directos (meai / apicredits).
    if (entry?.providerKey === "custom:gafcore-gateway") score -= 200;
    if (verified) score += 16;
    if (isRecentlyFailedCapability(cap)) score -= 120;

    // Favorece modelos poco usados para que todos operen en create/analyze/chat.
    const usage = modelUsageMap(context);
    score -= Math.min(24, (Number(usage[model]) || 0) * 3);

    return score;
  }

  function resolveAutoModelEntry(options, context = {}) {
    const source = Array.isArray(options) ? options.filter(Boolean) : [];
    if (!source.length) return null;
    const filtered = filterAutoModelOptions(source, context.capabilities || {}, {
      excludeModels: context.excludeModels || [],
    });
    let list = filtered.length ? filtered : source.filter((entry) => {
      const model = String(entry?.model || "").toLowerCase();
      return !(context.excludeModels || []).map((item) => String(item || "").toLowerCase()).includes(model);
    });
    if (!list.length) return null;

    if (isAgentExecutionContext(context)) {
      const agentCapable = list.filter((entry) => entrySupportsAgentTools(entry, context.capabilities || {}));
      if (agentCapable.length) list = agentCapable;
    }

    // Si DeepSeek ya va disparado, sacarlo del pool Auto (salvo que sea lo unico).
    if (deepseekOverShare(context, list)) {
      const withoutDeepseek = list.filter((entry) => !isDeepseekModel(entry?.model));
      if (withoutDeepseek.length) list = withoutDeepseek;
    }

    // Rol Cursor + rotacion least-used + balance upstream.
    const fitted = pickTaskFitEntry(list, context);
    if (fitted) return fitted;

    const verified = pickVerifiedModelEntry(list, context.capabilities || {}, context);
    if (verified) return verified;

    const safeDefault = pickSafeDefaultEntry(list, context);
    if (safeDefault) return safeDefault;

    let best = list[0];
    let bestScore = -Infinity;
    for (const entry of list) {
      const score = scoreModelForAuto(entry, context);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best;
  }

  function resolveAutoModelProfile(options, profiles, context = {}) {
    const entry = resolveAutoModelEntry(options, context);
    if (!entry) return null;
    return (Array.isArray(profiles) ? profiles : []).find((profile) =>
      profile.id === entry.profileId
      && profile.providerKey === entry.providerKey
      && profile.model === entry.model
      && ["active", "enabled"].includes(profile.status)
      && profile.apiKey
    ) || null;
  }

  function formatChatModelLabel(model, providerKey) {
    if (providerKey === "custom:gafcore-gateway") {
      return String(model || "").split("/").slice(1).join("/") || String(model || "");
    }
    return String(model || "");
  }

  function bumpUpstreamUsage(usage, model) {
    const next = {
      meai: Math.max(0, Number(usage?.meai) || 0),
      apicredits: Math.max(0, Number(usage?.apicredits) || 0),
    };
    const bucket = autoRotationBucket(model);
    if (bucket === "meai" || bucket === "apicredits") next[bucket] += 1;
    return next;
  }

  function bumpModelUsage(usage, model, weight = null) {
    const next = { ...(usage && typeof usage === "object" ? usage : {}) };
    const key = String(model || "").toLowerCase();
    if (!key) return next;
    const bump = weight != null
      ? Math.max(1, Number(weight) || 1)
      : (isDeepseekModel(key) ? DEEPSEEK_USAGE_WEIGHT : 1);
    next[key] = Math.max(0, Number(next[key]) || 0) + bump;
    return next;
  }

  return {
    AUTO_MODEL_SELECTION,
    CAPABILITY_FAIL_TTL_MS,
    SLOW_MODEL_MS,
    AUTO_SAFE_MODEL_PATTERNS,
    UPSTREAM_ORDER,
    MODEL_DUTY_CATALOG,
    ROLE_LANES,
    ROLE_FIT,
    ROLE_SCORE_BAND,
    DEEPSEEK_MAX_SHARE,
    DEEPSEEK_USAGE_WEIGHT,
    isAutoModelSelection,
    gatewayUpstreamGroup,
    apicreditsModelFamily,
    modelFamily,
    isDeepseekModel,
    describeModelDuty,
    autoRotationBucket,
    preferredAutoBucket,
    preferredApicreditsFamily,
    classifyAutoTaskRole,
    roleFitScore,
    findCapabilityForEntry,
    isRecentlyFailedCapability,
    isProviderFailureMessage,
    isSafeDefaultModel,
    filterAutoModelOptions,
    pickBalancedAutoEntry,
    pickEquitableEntry,
    pickTaskFitEntry,
    pickRoundRobinEntry,
    pickLeastUsedEntry,
    pickVerifiedModelEntry,
    pickSafeDefaultEntry,
    pickRotatedEntry,
    bumpUpstreamUsage,
    bumpModelUsage,
    modelUsageMap,
    deepseekUsageShare,
    deepseekOverShare,
    scoreModelForAuto,
    resolveAutoModelEntry,
    resolveAutoModelProfile,
    formatChatModelLabel,
  };
});
