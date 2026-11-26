"use strict";

(function exposeAutoModelSelection(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreAutoModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutoModelSelection() {
  const AUTO_MODEL_SELECTION = "__auto__";
  const CAPABILITY_FAIL_TTL_MS = 20 * 60 * 1000;
  const SLOW_MODEL_MS = 90_000;
  // [GROQ EN AUTO — 2026-11-26, orden de Luis] Groq («EditCore
  // Nube») es el SEGUNDO upstream del Auto: sus modelos de chat
  // trabajan por tarea en los mismos carriles que ME AI. Nexus
  // queda fuera del Auto (es el motor local fijo, sin bucket).
  const UPSTREAM_ORDER = ["meai", "groq"];
  const AUTO_SCOPE_LABELS = { all: "Todos", meai: "ME AI", groq: "EditCore Nube" };

  function normalizeAutoProviderScope(scope) {
    const value = String(scope || "").trim().toLowerCase();
    if (value === "meai" || value === "groq") return value;
    return "all";
  }

  function isScopedAutoProvider(scope) {
    const normalized = normalizeAutoProviderScope(scope);
    return normalized === "meai" || normalized === "groq";
  }

  function autoSelectionValue(scope = "") {
    const normalized = normalizeAutoProviderScope(scope);
    if (normalized === "all") return `${AUTO_MODEL_SELECTION}:all`;
    return `${AUTO_MODEL_SELECTION}:${normalized}`;
  }

  function parseAutoSelectionScope(optionOrValue) {
    if (!optionOrValue) return "all";
    if (typeof optionOrValue === "string") {
      if (optionOrValue === AUTO_MODEL_SELECTION) return "all";
      if (optionOrValue.startsWith(`${AUTO_MODEL_SELECTION}:`)) {
        return normalizeAutoProviderScope(optionOrValue.slice(AUTO_MODEL_SELECTION.length + 1));
      }
      return normalizeAutoProviderScope(optionOrValue);
    }
    if (optionOrValue.dataset?.autoScope) {
      return normalizeAutoProviderScope(optionOrValue.dataset.autoScope);
    }
    return parseAutoSelectionScope(optionOrValue.value);
  }

  function formatAutoLabel(scope = "") {
    const normalized = normalizeAutoProviderScope(scope);
    if (normalized === "all") return "Auto";
    return `Auto · ${AUTO_SCOPE_LABELS[normalized] || normalized}`;
  }

  function entryUpstreamBucket(entry) {
    // La procedencia manda: el proveedor declarado de la entrada
    // decide el bucket antes que adivinar por el nombre (los
    // modelos de Groq no llevan prefijo de proveedor y uno se
    // llama «openai/…» sin ser de OpenAI).
    const group = String(entry?.modelProviderGroup || "").toLowerCase();
    if (group === "meai" || group === "groq") return group;
    const key = String(entry?.providerKey || "").toLowerCase();
    if (key === "meai" || key === "groq") return key;
    const fromModel = autoRotationBucket(entry?.model);
    if (fromModel) return fromModel;
    return "";
  }

  // Modelos estables conocidos (catálogo oficial depurado de 6 modelos de élite).
  const AUTO_SAFE_MODEL_PATTERNS = [
    /claude-sonnet/i,
    /claude-opus/i,
    /claude-haiku/i,
    /deepseek-v4-pro/i,
    /qwen3\.6-plus/i,
    /glm-5\.2/i,
    /llama-3\.3-70b-versatile/i,
    /gpt-oss-120b/i,
    /llama-3\.1-8b-instant/i,
  ];

  const TIER_SCORES = [
    ["claude-opus-4.8", 100],
    ["claude-sonnet-4.6", 96],
    ["openai/gpt-oss-120b", 88],
    ["deepseek-v4-pro", 85],
    ["llama-3.3-70b-versatile", 82],
    ["qwen3.6-plus", 80],
    ["glm-5.2", 75],
    ["claude-haiku-4.5", 70],
    ["llama-3.1-8b-instant", 55],
  ];

  // ---------------------------------------------------------------------------
  // CATALOGO EXPLICITO: los 6 modelos oficiales de élite para EditCoreAI.
  // ---------------------------------------------------------------------------
  const MODEL_DUTY_CATALOG = [
    { id: "meai/claude-sonnet-4.6", family: "claude", duty: "implement+analyze", purpose: "Agente principal de desarrollo: escribir código, editar y ejecutar herramientas con máxima precisión." },
    { id: "meai/claude-opus-4.8", family: "claude", duty: "verify+hard-implement", purpose: "Auditorías críticas, arquitectura compleja y máximo razonamiento lógico." },
    { id: "meai/claude-haiku-4.5", family: "claude", duty: "chat+fast-analyze", purpose: "Chat conversacional rápido, preguntas conceptuales y consultas inmediatas." },
    { id: "meai/deepseek-v4-pro", family: "deepseek", duty: "implement-alt", purpose: "Razonamiento lógico-matemático y desarrollo backend alternativo." },
    { id: "meai/qwen3.6-plus", family: "qwen", duty: "implement-alt", purpose: "Alternativa full-stack potente para desarrollo web y frontend." },
    { id: "meai/glm-5.2", family: "glm", duty: "implement-alt", purpose: "Modelo robusto de soporte y desarrollo general." },
    { id: "groq/llama-3.3-70b-versatile", family: "llama", duty: "implement+analyze", purpose: "Motor de nube rápido para desarrollar y analizar con herramientas." },
    { id: "groq/openai/gpt-oss-120b", family: "gpt-oss", duty: "verify+hard-implement", purpose: "Razonamiento fuerte: auditorías, arquitectura y problemas duros." },
    { id: "groq/llama-3.1-8b-instant", family: "llama", duty: "chat+fast-analyze", purpose: "Respuestas inmediatas y consultas ligeras." },
  ];

  // Modelos que NO son de chat (voz, guardias, moderación): el
  // Auto jamás los elige, en ningún carril. Groq detecta su
  // catálogo entero y estos conviven en la lista de perfiles.
  const NON_CHAT_MODEL_PATTERNS = [/orpheus/, /prompt-guard/, /safeguard/, /whisper/];

  /**
   * Carriles por rol. Orden = prioridad de USO (no score).
   * Auto elige el primer carril con modelos disponibles y rota ahí.
   */
  const ROLE_LANES = {
    build: {
      purpose: "Crear un producto desde cero (greenfield: app/web/SaaS/landing). Solo modelos de máxima capacidad.",
      primary: [/claude-sonnet/, /claude-opus/, /gpt-oss-120b/],
      secondary: [/deepseek-v4/, /qwen3/, /llama-3\.3-70b/],
      reserve: [/glm-5/],
      forbid: [/claude-haiku/, /kimi/, /minimax/, /step/, /mimo/, ...NON_CHAT_MODEL_PATTERNS],
    },
    implement: {
      purpose: "Crear/editar/arreglar codigo con write_file y tools.",
      primary: [/claude-sonnet/, /claude-opus/, /qwen3/, /llama-3\.3-70b/, /gpt-oss-120b/],
      secondary: [/deepseek-v4/, /glm-5/],
      reserve: [],
      forbid: [/claude-haiku/, /kimi/, /minimax/, /step/, /mimo/, ...NON_CHAT_MODEL_PATTERNS],
    },
    analyze: {
      purpose: "Leer, diagnosticar, planear, reportes (sin mutar o antes de PROCEDE).",
      primary: [/claude-sonnet/, /claude-haiku/, /qwen3/, /glm-5/, /llama-3\.3-70b/, /llama-3\.1-8b/],
      secondary: [/deepseek-v4/, /claude-opus/, /gpt-oss-120b/],
      reserve: [],
      forbid: [/kimi/, /minimax/, /step/, /mimo/, ...NON_CHAT_MODEL_PATTERNS],
    },
    chat: {
      purpose: "Mensajes cortos de conversación, dudas o consultas conceptuales.",
      primary: [/claude-haiku/, /qwen3/, /glm-5/, /llama-3\.1-8b/],
      secondary: [/claude-sonnet/, /deepseek-v4/, /llama-3\.3-70b/],
      reserve: [/claude-opus/],
      forbid: [/kimi/, /minimax/, /step/, /mimo/, ...NON_CHAT_MODEL_PATTERNS],
    },
    verify: {
      purpose: "Auditoria, seguridad, produccion, go/no-go.",
      primary: [/claude-opus/, /claude-sonnet/, /deepseek-v4/, /gpt-oss-120b/],
      secondary: [/qwen3/, /glm-5/, /llama-3\.3-70b/],
      reserve: [],
      forbid: [/claude-haiku/, /kimi/, /minimax/, /step/, /mimo/, ...NON_CHAT_MODEL_PATTERNS],
    },
  };

  // Compat: ROLE_FIT derivado del catalogo (tests / scoreModelForAuto legacy).
  const ROLE_FIT = {
    build: [
      [/claude-opus|claude-sonnet/i, 100],
      [/deepseek-v4|qwen3/i, 70],
      [/glm-5/i, 50],
      [/claude-haiku|kimi|minimax|step|mimo/i, 0],
    ],
    implement: [
      [/claude-sonnet|claude-opus|deepseek-v4|qwen3/i, 100],
      [/glm-5/i, 70],
      [/claude-haiku|kimi|minimax|step|mimo/i, 0],
    ],
    analyze: [
      [/claude-sonnet|claude-haiku|qwen3|glm-5/i, 100],
      [/deepseek-v4|claude-opus/i, 70],
      [/kimi|minimax|step|mimo/i, 0],
    ],
    chat: [
      [/claude-haiku|qwen3|glm-5/i, 100],
      [/claude-sonnet|deepseek-v4/i, 70],
      [/claude-opus/i, 30],
      [/kimi|minimax|step|mimo/i, 0],
    ],
    verify: [
      [/claude-opus|claude-sonnet|deepseek-v4/i, 100],
      [/qwen3|glm-5/i, 70],
      [/claude-haiku|kimi|minimax|step|mimo/i, 0],
    ],
  };
  const ROLE_SCORE_BAND = 28;
  // Tope duro: DeepSeek no puede concentrar el Auto (clave ME AI).
  const DEEPSEEK_MAX_SHARE = 0.12;
  const DEEPSEEK_USAGE_WEIGHT = 3;

  function isAutoModelSelection(optionOrValue) {
    if (!optionOrValue) return false;
    if (typeof optionOrValue === "string") {
      return optionOrValue === AUTO_MODEL_SELECTION
        || optionOrValue.startsWith(`${AUTO_MODEL_SELECTION}:`);
    }
    return optionOrValue.dataset?.auto === "1"
      || isAutoModelSelection(String(optionOrValue.value || ""));
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

  /** Buckets de rotacion por upstream: ME AI (prefijo) y Groq (sus modelos de chat curados). */
  function autoRotationBucket(model) {
    const normalized = String(model || "").toLowerCase();
    const upstream = gatewayUpstreamGroup(normalized);
    if (upstream === "meai" || upstream === "groq") return upstream;
    // Los modelos de Groq viajan sin prefijo de proveedor en los
    // perfiles (y gpt-oss trae prefijo «openai/» sin ser OpenAI):
    // se reconocen por su id exacto del catálogo curado.
    if (normalized === "llama-3.3-70b-versatile"
      || normalized === "llama-3.1-8b-instant"
      || normalized === "openai/gpt-oss-120b") return "groq";
    return "";
  }

  function usageMap(context = {}) {
    const raw = context.autoUpstreamUsage && typeof context.autoUpstreamUsage === "object"
      ? context.autoUpstreamUsage
      : {};
    return {
      meai: Math.max(0, Number(raw.meai) || 0),
      groq: Math.max(0, Number(raw.groq) || 0),
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

  function pickHighestTierEntry(list) {
    const source = (Array.isArray(list) ? list : []).filter(Boolean);
    if (!source.length) return null;
    return [...source].sort((a, b) => baseTierScore(b?.model) - baseTierScore(a?.model))[0];
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
    const scoped = normalizeAutoProviderScope(context.autoProviderScope);
    if (isScopedAutoProvider(scoped)) return scoped;

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
        .map((entry) => entryUpstreamBucket(entry))
        .filter(Boolean)
    );
  }

  function entriesForBucket(list, bucket) {
    return (Array.isArray(list) ? list : []).filter((entry) => entryUpstreamBucket(entry) === bucket);
  }

  function isAgentExecutionContext(context = {}) {
    return Boolean(context.isAgent && context.usesProjectTools && !context.directReadOnly
      && (context.planAuthorizedExecution || !context.needsAnalysisFirst));
  }

  function classifyAutoTaskRole(context = {}) {
    const prompt = String(context.prompt || "").toLowerCase();
    // Copia sin acentos para los verbos: "créame"/"continúa" deben clasificar
    // igual que "crea"/"continua" (antes el \b con acento los dejaba fuera y
    // una construcción podía caer al carril de chat/análisis con modelos chicos).
    const promptPlain = prompt.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const agentExecution = isAgentExecutionContext(context);
    const agentAnalysis = Boolean(context.isAgent && context.usesProjectTools
      && (context.directReadOnly || context.needsAnalysisFirst));
    const simpleChat = !context.usesProjectTools;

    if (/verifica|auditor[ií]a|seguridad|producci[oó]n|go\/no-go|root.?cause|incidente/i.test(prompt)) {
      return "verify";
    }
    // Construcción desde cero (greenfield o pedido de producto): es la corrida
    // que define la calidad; va a su propio carril de modelos fuertes. En modo
    // Chat (sin tools) no aplica: ahí manda el carril de chat.
    const productBuild = /(?:crea|creame|crear|construye|construyeme|arma|armame|genera|generame|haz|hazme|desarrolla).{0,40}(?:app|aplicacion|web|saas|plataforma|producto|mvp|landing|dashboard|tienda|portal|pagina|sitio)/i.test(promptPlain);
    if ((agentExecution || (context.isAgent && context.usesProjectTools)) && (context.greenfieldCreate === true || productBuild)) {
      return "build";
    }
    if (agentExecution || /\b(crea|creame|crear|implementa|arregla|fix|escribe|edita|aplica|procede|continua|refactor|construye|genera)\b/i.test(promptPlain)) {
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
   * 1) upstream unico ME AI (o el scope fijado por el usuario)
   * 2) carril explicito del rol (primary → secondary → reserve)
   * 3) least-used / familias dentro del carril elegido
   */
  function pickTaskFitEntry(list, context = {}) {
    const source = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!source.length) return null;
    if (source.length === 1) return source[0];

    const role = classifyAutoTaskRole(context);
    const lanes = ROLE_LANES[role] || ROLE_LANES.analyze;
    const scoped = normalizeAutoProviderScope(context.autoProviderScope);
    const preferred = preferredAutoBucket(context, source);
    const order = isScopedAutoProvider(scoped)
      ? [scoped]
      : [preferred, ...UPSTREAM_ORDER.filter((bucket) => bucket !== preferred)];
    const laneOrder = ["primary", "secondary", "reserve"];
    // Vision / agente: haiku suele fallar en gateways openai-compat ("modelo no permitido").
    const hardForbid = [];
    if (context.hasImages || context.hasAttachments) hardForbid.push(/claude-haiku/i);
    if (needsToolCapableAutoModel(context)) hardForbid.push(/claude-haiku/i, /gpt-5\.6-sol/i);

    for (const bucket of order) {
      let entries = entriesForBucket(source, bucket);
      if (!entries.length) continue;
      entries = entries.filter((entry) =>
        !matchesAnyPattern(entry?.model, lanes.forbid || [])
        && !matchesAnyPattern(entry?.model, hardForbid)
      );
      if (!entries.length) continue;

      for (const laneName of laneOrder) {
        if (laneName === "reserve" && deepseekOverShare(context, source)) continue;
        const lanePool = entriesForLane(entries, lanes[laneName] || []);
        if (!lanePool.length) continue;
        // En "build" no hay rotación por uso: gana el modelo de mayor nivel
        // del carril. Rotar para repartir consumo es justo lo que dejaba
        // construcciones enteras en modelos chicos.
        return role === "build" ? pickHighestTierEntry(lanePool) : pickLeastUsedEntry(lanePool, context);
      }

      // Si el bucket no tiene ningun carril del rol, no inventar pelea: pasa al otro upstream.
      // Con scope fijo no cruzamos de proveedor.
      if (isScopedAutoProvider(scoped)) break;
    }

    // Ultimo recurso: least-used global sin modelos prohibidos del rol / vision.
    const allowed = source.filter((entry) =>
      !matchesAnyPattern(entry?.model, (ROLE_LANES[role] || {}).forbid || [])
      && !matchesAnyPattern(entry?.model, hardForbid)
    );
    if (role === "build") return pickHighestTierEntry(allowed.length ? allowed : source);
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
    // Un solo fallo reciente (ok:false) ya saca al modelo de Auto.
    if (failStreak < 1) return false;
    if (Date.now() - lastFailAt > CAPABILITY_FAIL_TTL_MS) return false;
    return cap.ok === false || failStreak >= 1;
  }

  function isHealthyCapability(cap) {
    if (!cap) return false;
    if (cap.ok !== true) return false;
    if (isRecentlyFailedCapability(cap)) return false;
    return true;
  }

  function isProviderFailureMessage(message) {
    const text = String(message || "");
    return /no est[aá] disponible|tard[oó] demasiado|502|503|401|403|upstream|forbidden|temporarily unavailable|no available accounts|invalid.?token|inv[aá]lid.?token|无效|令牌|上游|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|aborted|proveedor respondio|respuesta vacia|EMPTY_PROVIDER|devolvio una respuesta|no est[aá] permitido|not allowed|permitido en la API|modelo .* no permitido/i.test(text);
  }

  /** Solo auth/billing/modelo prohibido sacan el modelo de Auto. Timeouts NO. */
  function shouldQuarantineModelForAuto(message) {
    const text = String(message || "");
    if (/no est[aá] disponible|tard[oó] demasiado|reintenta en \d+|PROVIDER_TEMPORARILY|circuit.?breaker|502|503|504|524|timeout|timed?\s*out|overloaded|rate.?limit|POOL_EXHAUSTED/i.test(text)
      && !/401|403|402|invalid.?token|forbidden|saldo|balance|no est[aá] permitido|not allowed|permitido en la API/i.test(text)) {
      return false;
    }
    return /401|403|402|invalid.?token|inv[aá]lid.?token|forbidden|api.?key|unauthorized|saldo|balance|PROVIDER_NO_BALANCE|no est[aá] permitido|not allowed|permitido en la API|modelo .* no permitido|EMPTY_PROVIDER|respuesta vacia/i.test(text);
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

    // EDITCOREAI: solo el proveedor directo ME AI.
    if (entry?.providerKey === "custom:gafcore-gateway") score -= 200;
    if (verified) score += 16;
    if (isRecentlyFailedCapability(cap)) score -= 120;

    // Favorece modelos poco usados para que todos operen en create/analyze/chat.
    const usage = modelUsageMap(context);
    score -= Math.min(24, (Number(usage[model]) || 0) * 3);

    return score;
  }

  function needsToolCapableAutoModel(context = {}) {
    if (context.requireAgentTools === true) return true;
    if (isAgentExecutionContext(context)) return true;
    return Boolean(context.isAgent && context.usesProjectTools);
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
    const scope = normalizeAutoProviderScope(context.autoProviderScope);
    if (isScopedAutoProvider(scope)) {
      list = list.filter((entry) => entryUpstreamBucket(entry) === scope);
    }
    if (!list.length) return null;

    // Agente (analisis o ejecucion) NUNCA debe caer en modelos solo-chat (ej. gpt-5.6-sol).
    if (needsToolCapableAutoModel(context)) {
      const agentCapable = list.filter((entry) => entrySupportsAgentTools(entry, context.capabilities || {}));
      if (agentCapable.length) list = agentCapable;
      const toolPreferred = list.filter((entry) => {
        const profiles = Array.isArray(context.profiles) ? context.profiles : [];
        const profile = profiles.find((item) => item.id === entry.profileId)
          || profiles.find((item) => item.providerKey === entry.providerKey && item.model === entry.model);
        if (profile?.agentToolOK === false) return false;
        return !isChatOnlyModel(entry?.model);
      });
      if (toolPreferred.length) list = toolPreferred;
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
    const entry = resolveAutoModelEntry(options, {
      ...context,
      profiles: Array.isArray(profiles) ? profiles : context.profiles,
    });
    if (!entry) return null;
    const list = Array.isArray(profiles) ? profiles : [];
    const active = list.filter((profile) =>
      ["active", "enabled"].includes(String(profile?.status || "").toLowerCase())
      && profile?.apiKey
      && profile?.model
    );
    return active.find((profile) =>
      profile.id === entry.profileId
      && profile.providerKey === entry.providerKey
      && profile.model === entry.model
    ) || active.find((profile) =>
      profile.providerKey === entry.providerKey
      && profile.model === entry.model
    ) || active.find((profile) =>
      profile.id === entry.profileId
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
      groq: Math.max(0, Number(usage?.groq) || 0),
    };
    const bucket = autoRotationBucket(model);
    if (bucket) next[bucket] += 1;
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
    AUTO_SCOPE_LABELS,
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
    normalizeAutoProviderScope,
    isScopedAutoProvider,
    autoSelectionValue,
    parseAutoSelectionScope,
    formatAutoLabel,
    needsToolCapableAutoModel,
    isAgentExecutionContext,
    isAutoModelSelection,
    gatewayUpstreamGroup,
    entryUpstreamBucket,
    modelFamily,
    isDeepseekModel,
    isChatOnlyModel,
    describeModelDuty,
    autoRotationBucket,
    preferredAutoBucket,
    classifyAutoTaskRole,
    roleFitScore,
    findCapabilityForEntry,
    isRecentlyFailedCapability,
    isHealthyCapability,
    isProviderFailureMessage,
    shouldQuarantineModelForAuto,
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
    /** Protocolo de transparencia obligatorio bajo Auto Router (cualquier modelo). */
    getTransparentAgentProtocol() {
      const rootObj = typeof window !== "undefined" ? window : globalThis;
      if (rootObj?.EditCoreAutoRouterProtocol?.AUTO_ROUTER_TRANSPARENT_PROTOCOL) {
        return rootObj.EditCoreAutoRouterProtocol.AUTO_ROUTER_TRANSPARENT_PROTOCOL;
      }
      if (typeof require !== "undefined") {
        try {
          return require("./runtime/auto-router-transparent-protocol").AUTO_ROUTER_TRANSPARENT_PROTOCOL;
        } catch { /* ignore */ }
      }
      return "";
    },
    withTransparentAgentProtocol(systemPrompt = "") {
      const rootObj = typeof window !== "undefined" ? window : globalThis;
      const api = rootObj?.EditCoreAutoRouterProtocol
        || (typeof require !== "undefined"
          ? (() => { try { return require("./runtime/auto-router-transparent-protocol"); } catch { return null; } })()
          : null);
      if (api?.withAutoRouterTransparentProtocol) {
        return api.withAutoRouterTransparentProtocol(systemPrompt);
      }
      return String(systemPrompt || "");
    },
  };
});
