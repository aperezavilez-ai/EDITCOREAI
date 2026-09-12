"use strict";

(function exposeIntentOrchestrator(root, factory) {
  const nodeProjectAnalysis = typeof require !== "undefined"
    ? (() => { try { return require("../project-analysis"); } catch { return null; } })()
    : null;
  const browserProjectAnalysis = root?.EditCoreProjectAnalysis || null;
  const api = factory(browserProjectAnalysis || nodeProjectAnalysis);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && browserProjectAnalysis) root.EditCoreAgentOrchestrator = api;
})(typeof window !== "undefined" ? window : globalThis, function createIntentOrchestrator(ProjectAnalysis) {
  if (!ProjectAnalysis) {
    throw new Error("EditCoreProjectAnalysis requerido para el orquestador unificado.");
  }

  const browserRoot = typeof window !== "undefined" ? window : globalThis;
  const EliteComm = (() => {
    if (typeof require !== "undefined") {
      try { return require("./elite-communication-policy"); } catch { /* fallthrough */ }
    }
    return browserRoot?.EditCoreEliteCommunication || null;
  })();
  const withElite = (text) => (EliteComm?.withEliteCommunicationPolicy
    ? EliteComm.withEliteCommunicationPolicy(text)
    : String(text || ""));

  const CursorParity = (() => {
    if (typeof require !== "undefined") {
      try { return require("./cursor-parity"); } catch { /* fallthrough */ }
    }
    return browserRoot?.EditCoreCursorParity || null;
  })();

  const LovableOneShot = (() => {
    if (typeof require !== "undefined") {
      try { return require("./lovable-oneshot"); } catch { /* fallthrough */ }
    }
    return {
      isLovableOneShotRequest(prompt = "", { greenfieldCreate = false } = {}) {
        if (!greenfieldCreate) return false;
        return /\b(lovable|ui\s+pulida|app\s+web\s+profesional|landing|one[- ]?shot|moderna|premium)\b/i.test(String(prompt || ""));
      },
      buildLovableOneShotBlock({ permissionFull = false } = {}) {
        return [
          "PIPELINE LOVABLE ONE-SHOT (obligatorio en este turno):",
          "- create_project template=lovable-web o react + brain_skill frontend-design.",
          "- Personaliza UI, npm install, npm run dev, inspect_preview/inspect_browser.",
          permissionFull ? "- Acceso completo permitido." : "- Respeta limites de run_command.",
          "- PROHIBIDO solo narrar.",
        ].join("\n");
      },
    };
  })();

  /** CONTINUA a mitad de analisis sin plan autorizado = terminar reporte, no "Verificacion completada". */
  function isResumeIncompleteAnalysisRequest(prompt = "", options = {}) {
    const text = String(prompt || "").trim();
    if (!text) return false;
    if (options.planAuthorizedExecution === true) return false;
    const phase = String(options.workflowPhase || "");
    if (phase === "awaiting_authorization") return false;
    const phaseOk = ["interrupted", "executing"].includes(phase);
    if (!options.resumableTask && !phaseOk) return false;
    // Pedido explicito de correccion/escritura: no forzar analisis.
    if (/\b(corrige|repara|arregla|fix|implementa|crea|escribe|modifica|write_file|replace_in_file)\b/i.test(text)
      && !/\b(reporte|diagn[oó]stico|an[aá]lisis|auditor[ií]a)\b/i.test(text)) {
      return false;
    }
    return isAuthorization(text)
      || /\bcontin[uú]a\b/i.test(text)
      || /\b(termina|completa|cierra)\b.*\b(reporte|an[aá]lisis|auditor[ií]a)\b/i.test(text)
      || /\b(por\s+qu[eé]|porque)\b.*\b(detienes|paras|cortas)\b/i.test(text)
      || /\bhaz\s+lo\s+que\s+te\s+pido\b/i.test(text)
      || /\bno\s+te\s+estoy\s+pidiendo\s+(?:eso|esto)\b/i.test(text)
      || /\bhaz(?:me)?\s+caso\b/i.test(text);
  }

  const AgentRuntime = (() => {
    if (typeof require !== "undefined") {
      try { return require("../agent-runtime"); } catch { /* fallthrough */ }
    }
    return browserRoot?.EditCoreAgentRuntime || null;
  })();

  const {
  shouldAnalyzePromptFirst,
  isFreshAnalysisRequest,
  isPromptAnalysisRequest,
  isPromptOnlySteering,
  isScopedDiskFileRequest,
  isGreenfieldSpecPrompt,
  isGreenfieldCreateRequest,
  isVagueGreenfieldRequest,
  isProjectBrainstormRequest,
  isGreenfieldContinuationRequest,
  isProjectOnboardingRequest,
  isProjectIntentComment,
  isConversationalFollowUp,
  isUserDirectiveOrComplaint,
  hasConcreteProductHint,
  isAuthorization,
  isChangeRequest,
  isRecoveryInstruction,
  isAgentTaskFeedback,
  classifyPromptIntent,
  resolveExecutionMode,
} = ProjectAnalysis;

  /** "Analiza X y dame un reporte" = solo lectura, aunque Acceso completo / Cursor parity. */
  function isAnalysisOnlyRequest(prompt = "", allowWrite = true) {
    const text = String(prompt || "").trim();
    if (!text) return false;
    // Releer/analizar SOLO un archivo en disco: siempre DISCOVER con tools.
    if (isScopedDiskFileRequest?.(text)) return true;
    // Spec pegada / brainstorm / steering de entendimiento: chat, no disco.
    if (shouldAnalyzePromptFirst?.(text)) return false;
    if (isPromptAnalysisRequest?.(text)) return false;
    if (isPromptOnlySteering?.(text)) return false;
    if (isConversationalFollowUp?.(text)) return false;
    if (isGreenfieldSpecPrompt?.(text)) return false;
    if (isAuthorization?.(text)) return false;
    // Candado: diagnostico forense / NO MODIFICAR siempre es analysis-only.
    if (/\bNO\s+MODIFIQUES?\b|\bNO\s+MODIFICAR\b|\bMODO:\s*DIAGN|\bDIAGN[OÓ]STICO\b.*\bNO\s+MODIFIC/i.test(text)) {
      return true;
    }
    if (/\b(?:crear?|crees?|corregir?|corrijas?|modifica|modifiques|escribir?|escribas?|arreglar?|arregles?|implementar?|implementes?)\b/i.test(text)
      && !/\bNO\s+MODIFIQUES?\b|\bNO\s+MODIFICAR\b/i.test(text)) {
      return false;
    }
    // Candado P0: analisis fresco + reporte/hallazgos = readonly (aunque diga "a corregir").
    if (isFreshAnalysisRequest?.(text)
      && /\b(?:reporte|hallazgos|diagn[oó]stico|an[aá]lisis|audita|diagnostica)\b/i.test(text)
      && !/\b(?:crear?|crees?|corregir?|corrijas?|modifica|modifiques|escribir?|escribas?|arreglar?|arregles?|implementar?|implementes?)\b/i.test(text)) {
      return true;
    }
    if (/\b(?:hallazgos?\s+a\s+corregir|(?:a|para)\s+corregir)\b/i.test(text)
      && /\b(?:analiza|reporte|hallazgos|diagn[oó]stico|an[aá]lisis)\b/i.test(text)) {
      return true;
    }
    if (AgentRuntime?.agentTaskRequirements) {
      return AgentRuntime.agentTaskRequirements(text, allowWrite !== false).analysisOnly === true;
    }
    if (isChangeRequest?.(text)) return false;
    return isFreshAnalysisRequest?.(text)
      || (/\b(analiza|audita|diagnostica|revisa|explora|inspecciona)\b/i.test(text)
        && /\b(reporte|hallazgos|diagn[oó]stico|an[aá]lisis)\b/i.test(text));
  }

const SUB_AGENTS = {
  INTENT: "intent-analyst",
  EXPLORER: "project-explorer",
  IMPLEMENTER: "implementer",
  RESUMER: "task-resumer",
};

const MODES = {
  CHAT: "chat",
  UNDERSTAND: "understand",
  DISCOVER: "discover",
  EXECUTE: "execute",
};

const PHASES = {
  UNDERSTAND: "understand",
  DISCOVER: "discover",
  EXECUTE: "execute",
};

const RESEARCH_TOOLS = [
  "fetch_url",
  "github_repo_info",
  "github_list_files",
  "github_read_file",
  "github_search_repos",
];

const CODE_INTEL_TOOLS = [
  "project_discovery",
  "codebase_map",
  "symbol_search",
  "dependency_search",
  "search",
  "semantic_search",
  "run_diagnostics",
  "mcp_list_tools",
  "mcp_invoke",
  "inspect_browser",
  "browser_interact",
  "run_parallel_explore",
  "run_subagent",
];

const BRAIN_TOOL_NAMES = [
  "brain_search",
  "brain_skill",
  "brain_tools",
  "brain_install_repo",
];

const TOOL_ALLOWLIST = {
  [MODES.CHAT]: [],
  [MODES.UNDERSTAND]: [],
  [MODES.DISCOVER]: [
    "list_files", "read_file", "search_files",
    ...CODE_INTEL_TOOLS,
    "inspect_preview",
    ...RESEARCH_TOOLS,
    "brain_search", "brain_skill", "brain_tools",
  ],
  [MODES.EXECUTE]: [
    "write_file", "replace_in_file", "create_project",
    "list_files", "read_file", "search_files", "run_command",
    "create_pdf", "create_word", "create_excel", "create_csv",
    ...CODE_INTEL_TOOLS,
    "inspect_preview",
    ...RESEARCH_TOOLS,
    ...BRAIN_TOOL_NAMES,
    "generate_image",
    "propose_diff",
    "apply_diff",
    "deploy_one_click",
    "publish_project",
    "connect_project",
    "assess_project_connections",
    "provision_project",
    "project_health",
    "sync_vercel_env",
    "supabase_manage",
    "ssh_deploy",
    "create_supabase_project",
    "onboard_project",
  ],
};

const GREENFIELD_TOOL_ALLOWLIST = [
  "write_file", "replace_in_file", "create_project",
  "list_files", "read_file", "run_command",
  "create_pdf", "create_word", "create_excel", "create_csv",
  "inspect_preview", "inspect_browser", "browser_interact",
  "brain_skill", "brain_search",
  "run_diagnostics", "generate_image", "propose_diff", "apply_diff", "deploy_one_click",
  "publish_project", "connect_project", "assess_project_connections",
  "provision_project", "project_health", "sync_vercel_env", "supabase_manage", "ssh_deploy",
  "create_supabase_project", "onboard_project",
];

const LOVABLE_ONESHOT_TOOL_ALLOWLIST = [
  ...GREENFIELD_TOOL_ALLOWLIST,
  "search", "semantic_search", "run_parallel_explore",
  "mcp_list_tools", "mcp_invoke",
];

const FILESYSTEM_EXPLORATION_TOOLS = new Set([
  "list_files", "read_file", "search_files", "project_discovery", "codebase_map",
  "symbol_search", "dependency_search", "inspect_preview",
]);

const BRAIN_TOOLS = new Set(BRAIN_TOOL_NAMES);

function wantsExplicitFilesystemWork(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return false;
  if (shouldAnalyzePromptFirst(text)) return false;
  if (isFreshAnalysisRequest(text)) return true;
  // Ruta absoluta Windows/Unix o listado explicito de carpeta.
  if (/(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+|[\\/](?:Users|home|mnt|Volumes|PROGRAMAS)\b)/.test(text)) return true;
  if (/\b(listar?|enlista(?:r|me)?|enumerar|muestra(?:me)?|dame)\b/i.test(text)
    && /\b(archivos?|carpetas?|directorio|contenido|todo|raiz|ra[ií]z)\b/i.test(text)) return true;
  return /\b(analiza|audita|diagnostica|revisa|explora|investiga|lista|listar|enlista|abre|lee)\b.*\b(proyecto|carpeta|archivos?|c[oó]digo|repo|workspace)\b/i.test(text)
    || /\b(proyecto|carpeta|archivos?)\b.*\b(existente|actual|abierto)\b/i.test(text);
}

/** Solo listar/enlistar una carpeta: sin analizar ni modificar. */
function isListOnlyRequest(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return false;
  // Solo "dame/muestra" + sustantivo de archivo/carpeta SIN contexto de creación.
  // "dame una propuesta" o "crea todas sus carpetas" NO son listados.
  const hasListVerb = /\b(enlista(?:r|me)?|listar?|enumerar)\b/i.test(text)
    || /^\s*(?:ls|dir)\b/i.test(text)
    || (/\b(muestra(?:me)?|dame)\b/i.test(text) && /\b(archivos?|carpetas?|contenido|listado|directorio)\b/i.test(text));
  if (!hasListVerb) return false;
  // Lista + explica/describe profundo = NO es list-only (necesita read_file).
  if (/\b(explica|explicar|describ[eéa]|resumen|resumir|qu[eé]\s+hace|para\s+qu[eé]|c[oó]mo\s+funciona|detalle|detalla)\b/i.test(text)
    && !/\b(?:qu[eé]|que)\s+(?:contiene|hay|incluye)\b/i.test(text)
    && !/\bdime\s+qu[eé]\s+contiene\b/i.test(text)) {
    return false;
  }
  // Verbos de creación, modificación, propuesta o sugerencia = NUNCA list-only.
  if (/\b(analiza|audita|diagnostica|investiga|corrige|crear?|implementa(?:r)?|modifica(?:r)?|arregla(?:r)?|repara(?:r)?|onboard|publica(?:r)?|deploy|refactor|propuesta|propon(?:e|er)|sugiere|sugerir|recomienda(?:r)?|genera(?:r)?|dise[nñ]a(?:r)?|constru(?:ye|ir)|scaffoldea(?:r)?|inicializa(?:r)?|configura(?:r)?)\b/i.test(text)) {
    return false;
  }
  // "explora" / "revisa el proyecto" no es list-only.
  if (/\b(explora|explorar)\b/i.test(text) && !/\b(enlista|listar?)\b/i.test(text)) return false;
  if (/\brevisa\b/i.test(text) && /\b(proyecto|codigo|c[oó]digo|app)\b/i.test(text)) return false;
  return true;
}


/** Pedido hibrido: listar carpeta + explicar archivo(s). */
function isListAndExplainRequest(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return false;
  const wantsList = /\b(enlista(?:r|me)?|listar?|enumerar|muestra(?:me)?\s+(?:los\s+)?archivos|dame\s+(?:los\s+)?archivos)\b/i.test(text);
  const wantsExplain = /\b(explica|explicar|describ[eéa]|qu[eé]\s+hace|para\s+qu[eé]|c[oó]mo\s+funciona)\b/i.test(text);
  return wantsList && wantsExplain;
}

/** Explicar/leer/describir un archivo concreto del disco. */
function isExplainOrReadFileRequest(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return false;
  if (isListAndExplainRequest(text)) return false;
  const verb = /\b(explica|explicar|lee|leer|describe|describ[eéa]|resume|resumir|revisa|revisar|qu[eé]\s+hace|c[oó]mo\s+funciona|para\s+qu[eé]\s+sirve)\b/i.test(text);
  if (!verb) return false;
  if (/\b(corrige|arregla|implementa|crea|modifica|refactoriza|actualiza)\b/i.test(text)) return false;
  return /(?:[\\/]|\b[a-z0-9_.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|css|html|py)\b)/i.test(text)
    || /\b(?:main\.js|package\.json|readme(?:\.md)?)\b/i.test(text);
}

function isCasualChat(prompt = "", options = {}) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  if (isListAndExplainRequest(text) || isExplainOrReadFileRequest(text) || isListOnlyRequest(text)) return false;
  if (isProjectIntentComment(text)) return true;
  if (isGreenfieldCreateRequest(text) || isChangeRequest(text)) return false;
  const intent = classifyPromptIntent(text, options.hasAnalysisMemory === true);
  if (intent !== "conversation") return false;
  return !/\b(analiza|revisa|verifica|investiga|diagnostica|audita|archivo|archivos?|c[oó]digo|workspace|repositorio|tarea|medias|terminas|dejas|agente|avance|completar|explica|lee|describe)\b/i.test(text);
}

function formatOrchestrationBlock(profile = {}) {
  if (profile.listOnly) {
    return [
      "ORQUESTACION EDITCORE (LISTADO — AGENTE):",
      "- Usa list_files (o el listado ya precargado) y responde al usuario con carpetas y archivos.",
      "- PROHIBIDO analizar cada proyecto, pedir PowerShell, explorar subcarpetas o decir que esperas otra instruccion.",
      "- Entrega la lista clara en espanol y cierra.",
      profile.reason ? `- Motivo: ${profile.reason}.` : "",
    ].filter(Boolean).join("\n");
  }
  if (profile.subAgent === SUB_AGENTS.INTENT) {
    if (profile.conversationOnly) {
      return [
        "ORQUESTACION EDITCORE (CONVERSACION):",
        "- El usuario solo comentó una intención; responde en español, breve y natural.",
        "- NO uses herramientas. NO menciones skills, Cerebro ni exploración de archivos.",
        "- Confirma que entendiste y pregunta qué quiere construir o pide la especificación.",
        profile.reason ? `- Motivo: ${profile.reason}.` : "",
      ].filter(Boolean).join("\n");
    }
    return [
      "ORQUESTACION EDITCORE (SUB-AGENTE: ANALISTA DE INTENCION):",
      "- Parte SIEMPRE de las indicaciones del usuario. Tu trabajo AHORA es entender el pedido antes de tocar carpetas.",
      "- PROHIBIDO list_files, read_file, search_files, project_discovery en esta fase.",
      "- Responde en espanol con markdown:",
      "  ## Entendimiento del pedido",
      "  ## Alcance y entregables",
      "  ## Supuestos y preguntas",
      "  ## Plan de ejecucion (siguiente fase)",
      "- Si el proyecto esta vacio o por crear, NO inventes archivos existentes.",
      profile.reason ? `- Motivo: ${profile.reason}.` : "",
    ].filter(Boolean).join("\n");
  }
  if (profile.subAgent === SUB_AGENTS.EXPLORER) {
    let depthLine = "";
    try {
      const { resolveAnalysisDepth, buildDepthReportGuide } = require("./analysis-depth");
      if (profile.analysisMode) {
        const depth = resolveAnalysisDepth(profile.prompt || "");
        depthLine = `- ${buildDepthReportGuide(depth).split("\n")[0]}`;
        profile.statusLabel = `${depth.label}...`;
      }
    } catch { /* ignore */ }
    let obedienceLine = "";
    try {
      const { resolveInstructionConstraints, formatConstraintsForModel } = require("./instruction-obedience");
      const c = resolveInstructionConstraints(profile.prompt || "");
      if (c.active && c.mode === "deny") obedienceLine = formatConstraintsForModel(c);
    } catch { /* ignore */ }
    return [
      "ORQUESTACION EDITCORE (SUB-AGENTE: EXPLORADOR):",
      obedienceLine,
      "- El usuario pidio analizar el proyecto en disco. Usa list_files/read_file/search_files con evidencia real.",
      "- Puedes usar codebase_map, symbol_search, semantic_search, run_parallel_explore, inspect_preview, fetch_url y github_* si aportan evidencia.",
      depthLine,
      profile.analysisMode
        ? "- MODO ANALISIS: PROHIBIDO write_file/replace_in_file de codigo (espera PROCEDE). ROADMAP.md lo actualiza EditCore solo (indice/tokens); TU no lo reescribas. PROHIBIDO npm run lint/test/build y npx eslint/tsc. SERIAL: 1 tool → narra avance → siguiente. Con evidencia suficiente CIERRA el reporte YA."
        : "- Si no hay ROADMAP.md: analiza el disco y CREALO con el mapa real. PROHIBIDO pedirlo al usuario. Si ya existe: leelo primero y no reexplores el repo entero. Actualizalo al terminar.",
      "- Cerebro: opcional brain_skill deep-project-analysis o brain_search UNA vez; si la skill no existe, continua con disco sin repetir brain_*.",
      "- No inventes stack ni archivos. Cierra con reporte anclado a herramientas.",
      profile.permissionFull && !profile.analysisMode
        ? "- Acceso completo: run_command permitido para verificaciones reales."
        : "- Sin mutaciones ni run_command de entorno salvo que el pedido lo exija.",
    ].filter(Boolean).join("\n");
  }
  if (profile.subAgent === SUB_AGENTS.IMPLEMENTER) {
    if (profile.cursorParityMode) {
      const cursorBlock = CursorParity?.buildCursorParityOrchestrationBlock?.() || "Agente EditCore: investiga, corrige y verifica con herramientas.";
      if (profile.greenfieldCreate) {
        const oneShotExtra = profile.lovableOneShot
          ? LovableOneShot.buildLovableOneShotBlock({
            permissionFull: profile.permissionFull === true,
            prompt: profile.prompt || "",
          })
          : "";
        let templateLine = "- create_project template=lovable-web o react; brain_skill frontend-design para UI pulida.";
        try {
          const { resolveTemplateIntent, describeTemplateChoice } = require("./template-intent");
          const choice = resolveTemplateIntent(profile.prompt || "");
          if (choice.id && choice.id !== "blank") {
            templateLine = `- create_project template=${choice.id} (${describeTemplateChoice(choice)}); brain_skill frontend-design / project-templates.`;
          }
        } catch {
          // ignore
        }
        const greenfieldBlock = [
          "CREACION GREENFIELD:",
          templateLine,
          "- write_file/replace_in_file en la raiz del proyecto; run_command para npm install/dev.",
          "- Tras montar preview: inspect_preview, inspect_browser, browser_interact.",
          "- Escribe ROADMAP.md compacto (estado, mapa, siguiente) para no releer el repo en el siguiente turno. Actualizalo al terminar cambios.",
          oneShotExtra,
        ].filter(Boolean).join("\n");
        return [
          cursorBlock,
          greenfieldBlock,
          profile.reason ? `- Motivo: ${profile.reason}.` : "",
        ].filter(Boolean).join("\n");
      }
      return [
        cursorBlock,
        profile.reason ? `- Motivo: ${profile.reason}.` : "",
      ].filter(Boolean).join("\n");
    }
    if (profile.projectOnboarding) {
      return [
        "ORQUESTACION EDITCORE (ONBOARD PROYECTO NUEVO):",
        "- El usuario pidio aplicar dependencias y conectar servicios del operador.",
        "- Ejecuta onboard_project (una llamada) para: npm install, Supabase GafCore (self-hosted), GitHub, Vercel, sync envs y GafCore Gateway.",
        "- Las conexiones globales ya estan en EditCore (github, vercel, supabase.gafcore, gateway). NO pidas tokens ni uses Supabase Cloud.",
        "- Si aun no hay codigo/plantilla: create_project primero; luego onboard_project.",
        "- Informa el checklist devuelto (dependencias, supabase, github, vercel, gateway).",
        profile.reason ? `- Motivo: ${profile.reason}.` : "",
      ].filter(Boolean).join("\n");
    }
    if (profile.greenfieldCreate) {
      const oneShotExtra = profile.lovableOneShot
        ? LovableOneShot.buildLovableOneShotBlock({ permissionFull: profile.permissionFull === true })
        : "";
      if (profile.permissionFull) {
        return [
          "ORQUESTACION EDITCORE (CREACION GREENFIELD · ACCESO COMPLETO):",
          "- El usuario pidio CREAR un proyecto nuevo. Ejecuta AHORA con herramientas de escritura.",
          "- Escribe en la RAIZ visible del proyecto abierto (README.md, package.json, src/, public/).",
          "- Si pide app web profesional/UI pulida: prefer create_project template=lovable-web o react; luego personaliza.",
          "- Carga brain_skill frontend-design antes de inventar UI.",
          "- Usa write_file para cada archivo nuevo. run_command libre para npm install, npm run dev, git, etc.",
          "- Tras montar preview: inspect_preview, inspect_browser o browser_interact (dom/click/type) y corrige overflow/a11y evidentes.",
          "- Si lint/typecheck falla, EditCore inyecta AUTO-FIX: corrige con replace_in_file y reintenta (max 3 ciclos).",
          "- MCP: mcp_list_tools / mcp_invoke bajo demanda (config global automatica; override opcional por proyecto).",
          "- Puedes usar semantic_search y run_parallel_explore para evidencia rapida sin bloquear la escritura.",
          "- generate_image solo si el usuario pide assets y hay config; si no, SVG/CSS.",
          "- Si el usuario pide clonar un repo al Cerebro, usa brain_install_repo.",
          "- Si un comando tiene riesgo (push, deploy, rm -rf), EditCore pedira confirmacion al usuario.",
          "- PROHIBIDO solo narrar; sin write_file/create_project no hay progreso.",
          "- Si el usuario solo pidio README/package.json o esqueleto minimo: crea SOLO archivos base. NO inventes producto, dashboards ni datos ficticios.",
          "- Si el usuario pide conectar GitHub/Vercel/Supabase/GafCore: tras crear, ejecuta onboard_project.",
          "- Escribe ROADMAP.md compacto al crear: estado, mapa de archivos clave, siguiente accion. En siguientes turnos: LEERLO primero y ACTUALIZARLO al cerrar cambios.",
          oneShotExtra,
          profile.reason ? `- Motivo: ${profile.reason}.` : "",
        ].filter(Boolean).join("\n");
      }
      return [
        "ORQUESTACION EDITCORE (CREACION GREENFIELD):",
        "- El usuario pidio CREAR un proyecto nuevo. Ejecuta AHORA con herramientas de escritura.",
        "- Escribe en la RAIZ visible del proyecto abierto (README.md, package.json, src/, public/). NO metas el producto en .editcore salvo memoria interna.",
        "- Si pide UI profesional: create_project template=react o lovable-web; aplica brain_skill frontend-design.",
        "- Usa write_file para cada archivo nuevo. create_project solo si necesitas plantilla base.",
        "- Tras package.json con script dev o start: run_command npm install y luego npm run dev (un comando por llamada, sin &&).",
        "- Luego inspect_preview/inspect_browser/browser_interact y corrige problemas visuales basicos.",
        "- PROHIBIDO comprobar versiones del entorno (node --version, npx --version, git, python, docker, psql, redis). Escribe codigo directamente.",
        "- PROHIBIDO run_command con cmd, powershell, mkdir, type, cat, pwd o uname.",
        "- PROHIBIDO solo narrar; sin write_file/create_project no hay progreso.",
        "- Si el usuario solo pidio README/package.json o esqueleto minimo: crea SOLO archivos base. NO inventes producto, dashboards ni datos ficticios.",
        "- Si el usuario pide conectar GitHub/Vercel/Supabase/GafCore: tras crear, ejecuta onboard_project.",
        oneShotExtra,
        profile.reason ? `- Motivo: ${profile.reason}.` : "",
      ].filter(Boolean).join("\n");
    }
    return [
      "ORQUESTACION EDITCORE (SUB-AGENTE: IMPLEMENTADOR):",
      "- Ejecuta el plan autorizado con herramientas. Lee antes de escribir. Verifica al final.",
      "- Crea o modifica archivos en carpetas visibles del proyecto; evita .editcore salvo memoria interna.",
      "- Si hay interfaz web, tras package.json ejecuta npm install y npm run dev; luego inspect_preview/inspect_browser/browser_interact.",
      "- Usa fetch_url / github_* para investigar referencias externas cuando el usuario lo pida o haga falta.",
      "- Usa brain_search / brain_skill / brain_install_repo para skills y repos del Cerebro cuando aporten calidad.",
      "- MCP: mcp_list_tools y mcp_invoke bajo demanda (config global automatica).",
      "- Para explorar rapido: semantic_search o run_parallel_explore (solo lectura).",
      "- Para UI de alta calidad: aplica frontend-design y verifica con inspect_preview (desktop y mobile).",
      "- Tras escrituras relevantes: run_diagnostics si hay lint/typecheck; si AUTO-FIX llega, corrige de inmediato.",
      "- Si pide conectar servicios (GitHub, Vercel, supabase.gafcore, GafCore Gateway): usa onboard_project.",
      "- generate_image solo con config y pedido explicito de assets.",
    ].join("\n");
  }
  return "";
}

function buildProfile(fields = {}) {
  const allowedTools = Array.isArray(fields.allowedTools)
    ? fields.allowedTools
    : (TOOL_ALLOWLIST[fields.mode] || []);
  let orchestrationBlock = formatOrchestrationBlock(fields);
  const leadership = fields.mode !== MODES.CHAT
    && fields.mode !== MODES.UNDERSTAND
    && fields.conversationOnly !== true
    ? [
      "ROL: GUÍA LÍDER (inversión del control).",
      "Ante objetivos de alto nivel: genera hoja de ruta de 3-5 pasos, informa al usuario qué harás y ejecuta autónomamente con tools.",
      "Usa el mapa cognitivo real del proyecto; no inventes carpetas src/ o app/ inexistentes.",
      "OODA: ante fallos leves (oldText, git auxiliar), relee y reintenta sin detener la sesión.",
    ].join(" ")
    : "";
  if (leadership) {
    orchestrationBlock = [orchestrationBlock, leadership].filter(Boolean).join("\n\n");
  }
  return {
    ...fields,
    allowedTools,
    orchestrationBlock,
  };
}

/**
 * UNICO orquestador: decide modo, herramientas, flags de UI y perfil de corrida.
 * Renderer, main y adapter deben usar SOLO esta funcion (no competir con flags sueltos).
 */
function resolveUnifiedAgentPlan(options = {}) {
  const prompt = String(options.prompt || "").trim();
  const steeringInstruction = String(options.steeringInstruction || "").trim();
  const effectivePrompt = steeringInstruction || prompt;
  const requestedAgent = options.requestedAgent === true;
  const projectOpen = options.projectOpen === true;
  const allowWrite = options.allowWrite !== false;
  const permissionReadonly = options.permissionMode === "readonly";
  const permissionFull = options.permissionMode === "full";
  const cursorParityEnabled = options.cursorParityEnabled !== false;
  const resumableTask = options.resumableTask === true;
  const workflowPhase = String(options.workflowPhase || "");
  const planAuthorizedExecution = options.planAuthorizedExecution === true;
  const authorizedContinuation = options.authorizedContinuation === true;
  const scaffoldIncomplete = options.scaffoldIncomplete === true;
  const hasAttachments = options.hasAttachments === true;
  const hasAnalysisMemory = options.hasAnalysisMemory === true;

  const modeDecision = resolveExecutionMode(effectivePrompt, {
    requestedAgent,
    projectOpen,
    resumableTask,
    workflowPhase,
  });

  if (modeDecision.missingProject) {
    return {
      mode: MODES.CHAT,
      missingProject: true,
      usesProjectTools: false,
      isAgent: false,
      promptOnlyMode: false,
      analysisMode: false,
      directReadOnly: false,
      needsAnalysisFirst: false,
      planAuthorizedExecution: false,
      authorizedContinuation: false,
      skipBrain: true,
      skipBootstrap: true,
      allowedTools: [],
      greenfieldCreate: false,
      conversationOnly: false,
      statusLabel: "Abre un proyecto",
      chatConversationHint: "",
      autoEscalatedAgent: false,
      runProfile: {},
      reason: "proyecto requerido",
    };
  }

  const isAgent = modeDecision.isAgent;
  const cursorParityMode = CursorParity?.isCursorParityActive?.({
    isAgent,
    permissionFull,
    permissionReadonly,
    prompt: effectivePrompt,
    cursorParityEnabled,
  }) === true;
  const userAuth = isAuthorization(effectivePrompt);
  const resumableExecutable = resumableTask && ["interrupted", "executing", "awaiting_authorization"].includes(workflowPhase);

  let mode = MODES.CHAT;
  let reason = "";
  let greenfieldCreate = false;
  let projectOnboarding = false;
  let conversationOnly = false;
  let listOnly = false;

  const isConceptualOrPromptFirst = shouldAnalyzePromptFirst(effectivePrompt)
    || isPromptAnalysisRequest(effectivePrompt)
    || isPromptOnlySteering(effectivePrompt)
    || isProjectBrainstormRequest(effectivePrompt)
    || isVagueGreenfieldRequest(effectivePrompt)
    || isGreenfieldSpecPrompt(effectivePrompt);

  if (planAuthorizedExecution) {
    // Solo PROCEDE/plan aprobado escribe. CONTINUA solo no autoriza mutacion.
    mode = MODES.EXECUTE;
    reason = "plan autorizado";
  } else if (isAgent && isListAndExplainRequest(effectivePrompt) && !userAuth) {
    mode = MODES.DISCOVER;
    reason = "listar y explicar con tools";
  } else if (isAgent && isExplainOrReadFileRequest(effectivePrompt) && !userAuth) {
    mode = MODES.DISCOVER;
    reason = "leer/explicar archivo";
  } else if (isConceptualOrPromptFirst && !userAuth
    && !isListAndExplainRequest(effectivePrompt)
    && !isExplainOrReadFileRequest(effectivePrompt)
    && !isListOnlyRequest(effectivePrompt)) {
    // Spec pegada / arquitectura / requerimiento: entender pedido en conversacion primero.
    mode = MODES.CHAT;
    reason = "entender pedido en conversacion";
  } else if (isAgent && isResumeIncompleteAnalysisRequest(effectivePrompt, {
    resumableTask,
    workflowPhase,
    planAuthorizedExecution,
  })) {
    // CONTINUA tras corte/timeout: terminar reporte en DISCOVER (sin lint/write).
    mode = MODES.DISCOVER;
    reason = "reanudar analisis incompleto → reporte";
  } else if (authorizedContinuation && allowWrite) {
    mode = MODES.EXECUTE;
    reason = "continuacion autorizada";
  } else if (permissionFull && userAuth && isAgent && allowWrite && !permissionReadonly) {
    // Acceso total + ADELANTE/PROCEDE: ejecutar de verdad (no re-analizar a medias).
    mode = MODES.EXECUTE;
    reason = "acceso completo + autorizacion del usuario";
  } else if ((isConversationalFollowUp(effectivePrompt) || isUserDirectiveOrComplaint?.(effectivePrompt)) && !hasAttachments
    && !isListAndExplainRequest(effectivePrompt)
    && !isExplainOrReadFileRequest(effectivePrompt)
    && !isListOnlyRequest(effectivePrompt)
    && !isResumeIncompleteAnalysisRequest(effectivePrompt, {
      resumableTask,
      workflowPhase,
      planAuthorizedExecution,
    })
    && !isChangeRequest(effectivePrompt)
    && !isGreenfieldCreateRequest(effectivePrompt)
    && !/\b(?:crear?|crees?|corregir?|corrijas?|corrijelo|modifica|modifiques|escribir?|escribas?|arreglar?|arregles?|implementar?|implementes?|haz|hacer|funcionar|ejecutar?|ejecuta|explica|lee|describe|lista)\b/i.test(effectivePrompt)) {
    mode = MODES.CHAT;
    reason = isUserDirectiveOrComplaint?.(effectivePrompt)
      ? "directiva del usuario (sin re-analisis)"
      : "seguimiento conversacional";
  } else if (isCasualChat(effectivePrompt, { hasAnalysisMemory }) && !hasAttachments) {
    mode = MODES.CHAT;
    conversationOnly = true;
    reason = "conversacion sin herramientas";
  } else if (!isAgent && !hasAttachments && !cursorParityMode) {
    mode = MODES.CHAT;
    reason = "chat directo";
  } else if (isAgent && isListOnlyRequest(effectivePrompt) && !userAuth) {
    // Listar/enlistar: 1 list_files local, sin bucle de modelo ni 18 llamadas.
    mode = MODES.EXECUTE;
    listOnly = true;
    reason = "listado de carpeta";
  } else if (isAgent && isAnalysisOnlyRequest(effectivePrompt, allowWrite && !permissionReadonly) && !userAuth) {
    // Reporte/analisis: DISCOVER aunque Acceso completo. Evita lint/write y gasto de tokens.
    mode = MODES.DISCOVER;
    reason = "analisis/reporte readonly";
  } else if (cursorParityMode && CursorParity?.isDeepAgentTaskRequest?.(effectivePrompt)
    && !isAnalysisOnlyRequest(effectivePrompt, allowWrite && !permissionReadonly)
    && !isGreenfieldCreateRequest(effectivePrompt)
    && !isGreenfieldContinuationRequest(effectivePrompt, { scaffoldIncomplete })
    && !isProjectOnboardingRequest(effectivePrompt)) {
    mode = MODES.EXECUTE;
    reason = "investigacion y correccion";
  } else if (isAgent && wantsExplicitFilesystemWork(effectivePrompt) && !userAuth) {
    const reportOnly = isAnalysisOnlyRequest(effectivePrompt, allowWrite && !permissionReadonly);
    mode = (cursorParityMode && !reportOnly) ? MODES.EXECUTE : MODES.DISCOVER;
    reason = reportOnly ? "analisis/reporte readonly" : "analisis explicito del disco";
  } else if (allowWrite && !permissionReadonly && (
    isProjectOnboardingRequest(effectivePrompt)
    || isGreenfieldCreateRequest(effectivePrompt)
    || isGreenfieldContinuationRequest(effectivePrompt, { scaffoldIncomplete })
  )) {
    const wantsOnboard = isProjectOnboardingRequest(effectivePrompt);
    const wantsGreenfield = isGreenfieldCreateRequest(effectivePrompt)
      || isGreenfieldContinuationRequest(effectivePrompt, { scaffoldIncomplete });
    mode = MODES.EXECUTE;
    if (wantsGreenfield && wantsOnboard) {
      greenfieldCreate = true;
      projectOnboarding = false;
      reason = "creacion en disco + conexion de servicios (onboard tras crear)";
    } else if (wantsOnboard) {
      projectOnboarding = true;
      reason = "onboard proyecto: dependencias y conexiones";
    } else {
      greenfieldCreate = true;
      reason = scaffoldIncomplete && !isGreenfieldCreateRequest(effectivePrompt)
        ? "continuacion de scaffold incompleto"
        : "creacion explicita en disco";
    }
  } else if (isAgent && isChangeRequest(effectivePrompt) && !shouldAnalyzePromptFirst(effectivePrompt) && allowWrite && !permissionReadonly) {
    mode = MODES.EXECUTE;
    reason = "cambio explicito solicitado";
  } else if (isAgent && resumableExecutable && (userAuth || isRecoveryInstruction(effectivePrompt) || isAgentTaskFeedback(effectivePrompt))) {
    // Si solo pide continuar sin plan autorizado y sin pedido de fix, ya se resolvio arriba como analisis.
    mode = MODES.EXECUTE;
    reason = "reanudacion de tarea";
  } else if (isAgent && isFreshAnalysisRequest(effectivePrompt)) {
    mode = MODES.DISCOVER;
    reason = "analisis fresco del proyecto";
  } else if (isAgent && !resumableTask && !userAuth) {
    mode = permissionFull ? MODES.EXECUTE : MODES.DISCOVER;
    reason = permissionFull ? "ejecucion directa (acceso completo)" : "primera pasada de analisis en proyecto";
  } else if (isAgent) {
    mode = MODES.EXECUTE;
    reason = "tarea de agente";
  }

  if (cursorParityMode && isAgent && mode === MODES.DISCOVER
    && !wantsExplicitFilesystemWork(effectivePrompt)
    && !isAnalysisOnlyRequest(effectivePrompt, allowWrite && !permissionReadonly)
    && !isResumeIncompleteAnalysisRequest(effectivePrompt, {
      resumableTask,
      workflowPhase,
      planAuthorizedExecution,
    })) {
    mode = MODES.EXECUTE;
    reason = "herramientas completas";
  }

  const resumeIncompleteAnalysis = isResumeIncompleteAnalysisRequest(effectivePrompt, {
    resumableTask,
    workflowPhase,
    planAuthorizedExecution,
  });
  // "investiga y corrige" NO es reporte readonly: el cambio explicito gana sobre isFreshAnalysisRequest.
  // listOnly GANA sobre "lista carpeta" marcado como fresh analysis (evita plantilla forense).
  if (listOnly || isListOnlyRequest(effectivePrompt)) {
    listOnly = true;
    mode = MODES.EXECUTE;
    reason = "listado de carpeta";
  }
  const explicitChangeWork = Boolean(
    isChangeRequest(effectivePrompt)
    && allowWrite
    && !permissionReadonly
    && !/\bNO\s+MODIFI/i.test(effectivePrompt)
    && !isScopedDiskFileRequest?.(effectivePrompt),
  );
  const reportOnly = !listOnly && !isConceptualOrPromptFirst && (
    isAnalysisOnlyRequest(effectivePrompt, allowWrite && !permissionReadonly)
    || resumeIncompleteAnalysis
    || (!explicitChangeWork && isFreshAnalysisRequest?.(effectivePrompt) === true)
    || (!explicitChangeWork && (
      reason.includes("analisis incompleto")
      || reason.includes("analisis/reporte")
      || reason.includes("analisis explicito")
      || reason.includes("analisis fresco")
      || reason.includes("reanudar analisis")
    ))
  ) && !planAuthorizedExecution && !authorizedContinuation
    && !(permissionFull && userAuth && allowWrite && !permissionReadonly);
  if (listOnly) {
    // Candado final: nunca reabrir DISCOVER/forense tras un listado.
    mode = MODES.EXECUTE;
    reason = "listado de carpeta";
  } else if (reportOnly) {
    mode = MODES.DISCOVER;
    if (!/analisis|reporte/i.test(reason)) reason = "analisis/reporte readonly";
  } else if (explicitChangeWork && mode === MODES.DISCOVER && cursorParityMode) {
    mode = MODES.EXECUTE;
    reason = reason.includes("investigacion") ? reason : "investigacion y correccion";
  }

  const usesProjectTools = mode !== MODES.CHAT;
  const promptOnlyMode = mode === MODES.UNDERSTAND;
  // listOnly nunca es analysisMode (cero plantilla Qué sí funcionó / FORENSIC).
  const analysisMode = listOnly ? false : (reportOnly || mode === MODES.DISCOVER);
  const directReadOnly = analysisMode
    || permissionReadonly
    || (mode === MODES.DISCOVER);
  const needsAnalysisFirst = mode === MODES.DISCOVER;
  const skipBrain = (cursorParityMode && !analysisMode) ? false : (mode === MODES.CHAT || mode === MODES.UNDERSTAND || conversationOnly);
  const skipBootstrap = mode !== MODES.DISCOVER;

  let subAgent = SUB_AGENTS.INTENT;
  let phase = PHASES.UNDERSTAND;
  if (mode === MODES.DISCOVER) {
    subAgent = SUB_AGENTS.EXPLORER;
    phase = PHASES.DISCOVER;
  } else if (mode === MODES.EXECUTE) {
    subAgent = SUB_AGENTS.IMPLEMENTER;
    phase = PHASES.EXECUTE;
  }

  const lovableOneShot = LovableOneShot.isLovableOneShotRequest(effectivePrompt, { greenfieldCreate });
  // FOCO retirado: nunca acotar tools ni bootstrap por "solo archivo/carpeta".
  const scopedDiskFocus = false;
  const scopedFolderFocus = false;
  const scopedFolderAllowlist = [];

  const statusLabels = {
    [MODES.CHAT]: "Pensando...",
    [MODES.UNDERSTAND]: "Entendiendo tu solicitud...",
    [MODES.DISCOVER]: analysisMode ? "Analizando y redactando reporte..." : "Explorando proyecto...",
    [MODES.EXECUTE]: listOnly
      ? "Listando carpeta..."
      : greenfieldCreate
      ? (lovableOneShot ? "Creando app (one-shot)..." : "Creando proyecto...")
      : projectOnboarding
        ? "Conectando servicios..."
        : "Ejecutando con herramientas...",
  };

  const allowedTools = listOnly
    ? ["list_files"]
    : (mode === MODES.EXECUTE)
    ? (cursorParityMode
      ? (CursorParity?.CURSOR_PARITY_ALLOWLIST || TOOL_ALLOWLIST[MODES.EXECUTE])
      : (greenfieldCreate && !permissionFull
        ? (lovableOneShot ? LOVABLE_ONESHOT_TOOL_ALLOWLIST : GREENFIELD_TOOL_ALLOWLIST)
        : TOOL_ALLOWLIST[MODES.EXECUTE]))
    : analysisMode
    ? TOOL_ALLOWLIST[MODES.DISCOVER]
    : (TOOL_ALLOWLIST[mode] || []);

  const runProfile = buildProfile({
    mode,
    phase,
    subAgent,
    promptOnlyMode,
    allowFilesystem: mode === MODES.DISCOVER || mode === MODES.EXECUTE,
    greenfieldCreate,
    projectOnboarding,
    analysisMode,
    cursorParityMode: listOnly || analysisMode ? false : cursorParityMode,
    lovableOneShot,
    conversationOnly,
    listOnly,
    skipBootstrap: listOnly ? true : skipBootstrap,
    skipBrain: listOnly ? true : (analysisMode ? false : (permissionFull ? false : skipBrain)),
    scopedDiskFocus: false,
    scopedFolderFocus: false,
    scopedFolderAllowlist: [],
    allowedTools,
    permissionFull,
    statusLabel: statusLabels[mode] || "Procesando...",
    reason: listOnly
      ? reason
      : (lovableOneShot && greenfieldCreate ? `${reason} · lovable one-shot` : reason),
    prompt: effectivePrompt,
  });

  const chatConversationHint = (() => {
    if (conversationOnly) {
      return withElite([
        "Eres EditCore — GUÍA LÍDER. Responde en español, breve, directo y técnico.",
        "El usuario solo comentó una intención vaga: resume lo entendido, propone una hoja de ruta corta (3 pasos) y pregunta cuál camino seguir.",
        "NO menciones skills del Cerebro, brain_tools, list_files ni run_command.",
      ].join(" "));
    }
    if (mode === MODES.CHAT && isConversationalFollowUp(effectivePrompt)) {
      return withElite([
        "Eres EditCore — GUÍA LÍDER. Responde en español, breve, directo y técnico.",
        "El usuario pregunta qué sigue. Propón EL siguiente paso concreto de tu hoja de ruta y ejecútalo mentalmente (sin disco si es solo conversación).",
        "NO explores el disco ni menciones herramientas de agente, skills del Cerebro ni tokens.",
      ].join(" "));
    }
    if (mode === MODES.CHAT && isProjectBrainstormRequest(effectivePrompt)) {
      return withElite([
        "Eres EditCore — socio de producto y GUÍA LÍDER: técnico, curioso y concreto.",
        "El usuario quiere pensar y definir el proyecto. NO escribas archivos ni explores el disco.",
        "Ofrece una hoja de ruta de 3-5 pasos para clarificar, luego 2-3 caminos de producto.",
        "PROHIBIDO inventar dashboards, datos ficticios o UI hasta que pida implementar.",
      ].join(" "));
    }
    if (mode === MODES.CHAT && isVagueGreenfieldRequest(effectivePrompt)) {
      return withElite([
        "Eres EditCore — GUÍA LÍDER. Responde en español, claro y técnico.",
        "Pidió crear algo sin especificar el producto. NO escribas archivos ni inventes una app.",
        "Presenta una mini hoja de ruta (3 pasos) para definir tipo de app, audiencia y stack; ofrece opciones concretas.",
        "PROHIBIDO construir dashboards o UI elaborada hasta confirmación.",
        "NO explores carpetas ni menciones list_files, skills del Cerebro ni tokens.",
      ].join(" "));
    }
    if (mode === MODES.CHAT && isConceptualOrPromptFirst) {
      return withElite([
        "Eres EditCore AI — arquitecto GUÍA LÍDER del desarrollo.",
        "El usuario describe un producto o idea nueva o una especificacion tecnica.",
        "Sigue este flujo de liderazgo cognitivo:",
        "1. Analiza a fondo el requerimiento, arquitectura, necesidades y vision.",
        "2. Presenta tu propuesta tecnica y una hoja de ruta de 3 a 5 pasos ejecutables.",
        "3. Informa qué harás primero y solicita autorizacion clara:",
        "   '¿Deseas que proceda con este plan? Responde **PROCEDE** para iniciar la implementación.'",
        "NO ejecutes herramientas de disco ni busquedas externas hasta que el usuario autorice con PROCEDE.",
      ].join(" "));
    }
    return "";
  })();

  const isFinalAgent = mode === MODES.CHAT ? false : isAgent;
  const agentLeadershipHint = mode === MODES.CHAT || mode === MODES.UNDERSTAND
    ? ""
    : withElite([
      "ROL: GUÍA LÍDER (inversión del control).",
      "Ante objetivos de alto nivel: genera hoja de ruta de 3-5 pasos, informa al usuario qué harás y ejecuta autónomamente con tools.",
      "Usa el mapa cognitivo real del proyecto; no inventes carpetas src/ o app/ inexistentes.",
      "OODA: ante fallos leves (oldText, git auxiliar), relee y reintenta sin detener la sesión.",
    ].join(" "));

  return {
    mode,
    missingProject: false,
    usesProjectTools: mode !== MODES.CHAT,
    isAgent: isFinalAgent,
    promptOnlyMode: mode === MODES.UNDERSTAND,
    analysisMode: mode === MODES.CHAT ? false : analysisMode,
    directReadOnly: mode === MODES.CHAT ? false : directReadOnly,
    needsAnalysisFirst: mode === MODES.CHAT ? false : needsAnalysisFirst,
    planAuthorizedExecution,
    authorizedContinuation,
    skipBrain: mode === MODES.CHAT ? true : runProfile.skipBrain,
    skipBootstrap: mode === MODES.CHAT ? true : (listOnly ? true : skipBootstrap),
    scopedDiskFocus: false,
    scopedFolderFocus: false,
    scopedFolderAllowlist: [],
    allowedTools: mode === MODES.CHAT ? [] : allowedTools,
    greenfieldCreate: mode === MODES.CHAT ? false : greenfieldCreate,
    projectOnboarding: mode === MODES.CHAT ? false : projectOnboarding,
    cursorParityMode: (mode === MODES.CHAT || listOnly) ? false : cursorParityMode,
    lovableOneShot,
    conversationOnly,
    listOnly,
    statusLabel: runProfile.statusLabel,
    chatConversationHint,
    agentLeadershipHint,
    autoEscalatedAgent: mode === MODES.CHAT ? false : modeDecision.autoEscalatedAgent,
    runProfile: mode === MODES.CHAT ? { ...runProfile, mode: "chat", skipBrain: true, allowedTools: [] } : runProfile,
    reason,
  };
}

/** @deprecated Usar resolveUnifiedAgentPlan. Mantenido para compatibilidad interna. */
function resolveAgentRunProfile(options = {}) {
  const plan = resolveUnifiedAgentPlan({
    prompt: options.prompt,
    steeringInstruction: options.steeringInstruction,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: options.allowWrite === true,
    planAuthorizedExecution: options.planAuthorized === true,
    hasAttachments: false,
  });
  if (options.promptOnlyMode === true && plan.mode === MODES.UNDERSTAND) {
    return plan.runProfile;
  }
  if (options.analysisMode === true && plan.mode === MODES.DISCOVER) {
    return plan.runProfile;
  }
  return plan.runProfile;
}

function applyRunProfile(input = {}, profile = {}) {
  if (!input || !profile) return input;
  input.runProfile = profile;
  input.orchestratorPlan = input.orchestratorPlan || {};
  input.orchestratorPlan.runProfile = profile;
  input.orchestratorPlan.allowedTools = profile.allowedTools || input.orchestratorPlan.allowedTools;
  input.promptOnlyMode = profile.promptOnlyMode === true;
  input.allowFilesystem = profile.allowFilesystem !== false;
  if (profile.mode === MODES.EXECUTE || profile.phase === PHASES.EXECUTE) {
    input.analysisMode = false;
    input.promptOnlyMode = false;
  } else if (profile.mode === MODES.DISCOVER) {
    input.analysisMode = true;
    input.promptOnlyMode = false;
  } else if (profile.mode === MODES.UNDERSTAND) {
    input.analysisMode = false;
    input.promptOnlyMode = true;
  }
  if (profile.prompt && profile.prompt !== input.prompt) {
    input.activeInstruction = profile.prompt;
  }
  return input;
}

function isFilesystemTool(name = "") {
  return FILESYSTEM_EXPLORATION_TOOLS.has(String(name || "").trim());
}

function isBrainTool(name = "") {
  return BRAIN_TOOLS.has(String(name || "").trim());
}

function filterToolsByPlan(tools = [], plan = {}) {
  const allowlist = plan.allowedTools || plan.runProfile?.allowedTools;
  if (!Array.isArray(allowlist) || !allowlist.length) {
    if (plan.mode === MODES.CHAT || plan.mode === MODES.UNDERSTAND || plan.promptOnlyMode) {
      return [];
    }
    if (plan.skipBrain) {
      return tools.filter((item) => !isBrainTool(item?.function?.name));
    }
    return tools;
  }
  const allowed = new Set(allowlist);
  return tools.filter((item) => allowed.has(item?.function?.name));
}

return {
  SUB_AGENTS,
  MODES,
  PHASES,
  TOOL_ALLOWLIST,
  RESEARCH_TOOLS,
  CODE_INTEL_TOOLS,
  FILESYSTEM_EXPLORATION_TOOLS,
  resolveUnifiedAgentPlan,
  resolveAgentRunProfile,
  applyRunProfile,
  wantsExplicitFilesystemWork,
  isListOnlyRequest,
  isListAndExplainRequest,
  isExplainOrReadFileRequest,
  isCasualChat,
  isAnalysisOnlyRequest,
  isResumeIncompleteAnalysisRequest,
  formatOrchestrationBlock,
  isFilesystemTool,
  isBrainTool,
  filterToolsByPlan,
};
});
