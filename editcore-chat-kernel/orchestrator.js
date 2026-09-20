"use strict";

const path = require("path");
const {
  classify,
  extractListTarget,
  isFullAccess,
  resolveExecutionMode,
  resolveUnifiedAgentPlan,
  MODES,
  TOOL_ALLOWLIST,
  SUB_AGENTS,
} = require("./classify");
const { ChatSession } = require("./session");
const { PersistentMemory } = require("./memory");
const { skillsPrompt, SKILL_IDS } = require("./skills-catalog");
const { runExplorer } = require("./subagents/explorer");
const { runAnalyst } = require("./subagents/analyst");
const { runImplementer } = require("./subagents/implementer");
const { runVerifier } = require("./subagents/verifier");

let dispatchSpecialist = () => null;
try {
  const _dispatcher = require("./subagents/dispatcher");
  if (_dispatcher && typeof _dispatcher.dispatchSpecialist === "function") {
    dispatchSpecialist = _dispatcher.dispatchSpecialist;
  }
} catch (_) {
  dispatchSpecialist = () => null;
}

const { parseTextToolCalls, stripTextToolMarkup, toRelativePath, visibleNarrationText } = require("./parse-text-tools");
const tools = require("./tools");
const { callChat } = require("./provider");
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
const globalMemory = require("./global-memory");
const taskQueue = require("./task-queue");
const threadCore = require("./thread-core");
const { pickModel } = require("./model-router");
const agentBus = require("./agent-bus");

let projectMapApi = null;
try {
  projectMapApi = require("../runtime/project-map");
} catch (_) {
  projectMapApi = null;
}

let atMentionsResolver = null;
try {
  atMentionsResolver = require("../runtime/at-mentions-resolver");
} catch (_) {
  atMentionsResolver = null;
}

const DEFAULT_MAX_STEPS = 28;
const AUTHORIZED_MAX_STEPS = 32;
const DEFAULT_TOTAL_TIMEOUT_MS = 600_000;
const MAX_INCOMPLETE_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 5_000;

const LEADERSHIP_PROMPT = [
  "Sos guía líder del proyecto, pero te mantenés dentro del alcance de lo pedido.",
  "Antes de cada tool: 1 frase de qué vas a hacer y por qué. Después: el hallazgo concreto.",
  "Si falla algo leve (oldText, git auxiliar, ruta ausente), releé contexto y reintentá. No detengas la sesión por eso.",
  "Con Acceso completo, no pidas PROCEDE durante la tarea pedida.",
].join("\n");

const LIVE_NARRATION_PROMPT = [
  "Voz EditCoreAI. Primera frase = hallazgo o decisión.",
  "Si el hilo basta, no llames tools. Si llamás una, contá el porqué en el mismo mensaje.",
].join("\n");

let eliteCommunication = null;
try {
  eliteCommunication = require("../runtime/elite-communication-policy");
} catch (_) {
  eliteCommunication = null;
}

let autoRouterProtocol = null;
try {
  autoRouterProtocol = require("../runtime/auto-router-transparent-protocol");
} catch (_) {
  autoRouterProtocol = null;
}

let requestScopePolicy = null;
try {
  requestScopePolicy = require("../runtime/request-scope-policy");
} catch (_) {
  requestScopePolicy = null;
}

function formatAgentVisibleText(text = "") {
  let value = String(text || "");
  if (!value.trim()) return value;
  try {
    if (eliteCommunication?.stripEliteFiller) value = eliteCommunication.stripEliteFiller(value);
    else if (eliteCommunication?.normalizeSpanishProse) {
      value = eliteCommunication.normalizeSpanishProse(value);
      if (eliteCommunication?.ensureChatParagraphs) {
        value = eliteCommunication.ensureChatParagraphs(value);
      }
    }
  } catch { /* keep */ }
  return String(value || "").replace(/\n{3,}/g, "\n\n").trim();
}

function userWantsDiskMutation(message = "") {
  return /\b(?:crea(?:r|ción)?|genera(?:r)?|implementa(?:r)?|escrib[ie]|haz|arma|scaffold|nuevo\s+proyecto|app\b|muev\w*|copiar?|guarda(?:r)?|fix|corrige|añad[ie]|agrega)\b/i.test(String(message || ""));
}

function textClaimsDiskMutation(text = "") {
  const raw = String(text || "");
  if (/<!DOCTYPE\s+html>/i.test(raw)) return true;
  return /\b(he\s+(?:creado|escrito|generado|movido|implementado|guardado)|cre[eé]\s+(?:la\s+)?(?:carpeta|archivo|proyecto)|escrib[ií]|mov[ií]|gener[eé]|implement[eé]|guard[eé]|finalic[eé]\s+(?:la\s+)?(?:creaci[oó]n|implementaci[oó]n))\b/i.test(raw);
}

function successfulWritePaths(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .filter((s) => (s.name === "write_file" || s.name === "replace_in_file" || s.name === "scaffold_project") && s.ok !== false && s.result?.ok !== false)
    .map((s) => s.input?.path || s.result?.path || s.result?.projectRoot)
    .filter(Boolean);
}

function repairDanglingOutput(text, steps = [], userMessage = "", decision = {}) {
  const value = String(text || "").trim();
  const isTrulyBroken = !value || /[a-záéíóúñ]{1,3}$/i.test(value);
  if (!isTrulyBroken) {
    return formatAgentVisibleText(value);
  }

  const written = successfulWritePaths(steps);
  if (written.length > 0) {
    const lista = written.map((p) => `- \`${p}\``).join("\n");
    return formatAgentVisibleText(
      `Cambios aplicados:\n\n${lista}\n\nDecime la próxima tarea concreta.`
    );
  }

  const cmdSteps = steps.filter((s) => s.name === "run_command" || s.name === "run_diagnostic");
  if (cmdSteps.length > 0) {
    const last = cmdSteps[cmdSteps.length - 1];
    const out = String(last.result?.stdout || last.result?.output || last.result?.stderr || "").trim();
    if (out) {
      return formatAgentVisibleText(`Último comando:\n\`\`\`\n${out.slice(0, 1200)}\n\`\`\``);
    }
  }

  const readFiles = steps.filter((s) => s.name === "read_file" || s.name === "list_files")
    .map((s) => s.input?.path).filter(Boolean);
  if (readFiles.length > 0) {
    const filesStr = readFiles.slice(0, 5).map((f) => `\`${f}\``).join(", ");
    return formatAgentVisibleText(`Leí: ${filesStr}. Decime qué hacer con esta evidencia.`);
  }

  return formatAgentVisibleText("No completé la instrucción en este turno. Reformulá o indicá el archivo puntual.");
}

function groundUngroundedClaims(text, steps = [], userMessage = "", decision = {}) {
  if (
    decision?.kind === "ANALYZE" ||
    decision?.kind === "ASK" ||
    decision?.kind === "LIST" ||
    decision?.kind === "CHAT" ||
    decision?.allowWrite === false ||
    /\b(?:sin\s+modificar|solo\s+(?:analiza|reporte|diagn[oó]stico)|reporte|an[aá]lisis|auditor[ií]a|explica|resumen)\b/i.test(userMessage)
  ) {
    return repairDanglingOutput(text, steps, userMessage, decision);
  }
  const written = successfulWritePaths(steps);
  if (written.length > 0) return repairDanglingOutput(text, steps, userMessage, decision);
  const claims = textClaimsDiskMutation(text);
  if (claims && userWantsDiskMutation(userMessage)) {
    return formatAgentVisibleText(
      "No pude comprobar creación ni escritura real en disco en este turno (no hubo `write_file` / `replace_in_file` / `scaffold_project` exitoso).\n\n" +
      "Indica la carpeta de destino y pedime de nuevo que lo cree con tools."
    );
  }
  return repairDanglingOutput(text, steps, userMessage, decision);
}

function wrapSystemPrompt(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return text;
  let next = text;
  if (requestScopePolicy?.withRequestScopePolicy) {
    try { next = requestScopePolicy.withRequestScopePolicy(next); } catch { /* ignore */ }
  }
  if (autoRouterProtocol?.withAutoRouterTransparentProtocol) {
    try { next = autoRouterProtocol.withAutoRouterTransparentProtocol(next); } catch { /* ignore */ }
  } else {
    next = `${LIVE_NARRATION_PROMPT}\n\n${next}`;
  }
  if (eliteCommunication?.withEliteCommunicationPolicy) {
    try { return eliteCommunication.withEliteCommunicationPolicy(next); } catch { /* fall through */ }
  }
  return `${LIVE_NARRATION_PROMPT}\n\n${next}`;
}

function scopeUserMessage(message = "", evidence = "") {
  if (requestScopePolicy?.buildScopedUserDirective) {
    try { return requestScopePolicy.buildScopedUserDirective(message, evidence); } catch { /* fall through */ }
  }
  return String(message || "");
}

let operatorConnectionsApi = null;
try {
  operatorConnectionsApi = require("../runtime/operator-connections-context");
} catch {
  operatorConnectionsApi = null;
}

function buildConnectionsBlock(projectRoot) {
  if (!projectRoot || !operatorConnectionsApi) return "";
  try {
    const snap = operatorConnectionsApi.connectionsForProject
      ? operatorConnectionsApi.connectionsForProject({}, projectRoot)
      : null;
    if (operatorConnectionsApi.formatOperatorConnectionsMemory) {
      return operatorConnectionsApi.formatOperatorConnectionsMemory(snap);
    }
  } catch { /* ignore */ }
  return "";
}

function nextStepsClosingText(projectRoot, writtenFiles = [], steps = []) {
  if (writtenFiles.length > 0) {
    return "Cambios aplicados. Decime la próxima tarea concreta.";
  }
  if (steps.length > 0) {
    const toolNames = [...new Set(steps.map((s) => s.name).filter(Boolean))].slice(0, 5).join(", ");
    return `Ejecuté: ${toolNames}. Decime el siguiente paso concreto.`;
  }
  return "Sin acciones ejecutadas en este turno. Reformulá la instrucción o indicá el archivo puntual.";
}

function ensureCognitiveMap(projectRoot) {
  if (!projectRoot || !projectMapApi?.ensureProjectMap) return null;
  try {
    return projectMapApi.ensureProjectMap(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null;
  } catch {
    return projectMapApi.loadProjectMap?.(projectRoot) || null;
  }
}

function formatCognitiveBlock(projectRoot) {
  const map = ensureCognitiveMap(projectRoot);
  if (projectMapApi?.formatMapForPrompt) return projectMapApi.formatMapForPrompt(map);
  return "MAPA COGNITIVO: usa list_files('.') — no asumas src/ ni app/.";
}

function buildRoadmapFirstBlock(projectRoot) {
  if (!projectRoot) return "";
  const parts = [];
  try {
    const {
      ensureProjectRoadmap,
      formatRoadmapForPrompt,
      readRoadmap,
      isStubRoadmap,
    } = require("../runtime/project-roadmap");
    const loaded = readRoadmap(projectRoot);
    if (!loaded.exists || isStubRoadmap(loaded.content || "")) {
      try { ensureProjectRoadmap(projectRoot, { reason: "kernel-bootstrap" }); } catch { /* ignore */ }
    }
    parts.push(formatRoadmapForPrompt(projectRoot));
  } catch {
    parts.push("ROADMAP: no disponible en este turno; lee solo archivos puntuales del pedido.");
  }
  try {
    const { formatSessionStateForPrompt, ensureSessionState } = require("../runtime/session-state");
    ensureSessionState(projectRoot);
    parts.push(formatSessionStateForPrompt(projectRoot, 2_000));
  } catch { /* ignore */ }
    parts.push([
    "ROADMAP-FIRST (obligatorio, ahorro de tokens):",
    "1) El ROADMAP y session-state YA están arriba. NO ejecutes list_files('.') del repo entero si el mapa ya cubre la tarea.",
    "2) Lee primero ## Proceso y ## Bloqueos.",
    "3) Prohibido re-listar o re-leer archivos que ya aparezcan en ## Mapa.",
    "4) Para modificar: read_file SOLO de los archivos concretos que vas a tocar.",
    "5) Tras write_file/replace_in_file, EditCore actualiza ROADMAP.md solo.",
  ].join("\n"));
  return parts.filter(Boolean).join("\n\n").slice(0, 7_500);
}

function recoverSoftToolFailure(name, args, result, projectRoot) {
  const soft = tools.isSoftToolFailure?.(name, result, args) || result?.soft === true;
  if (!soft) return { recovered: false, payload: result };

  const enriched = {
    ...(result || {}),
    soft: true,
    ooda: "continue",
    guidance: "Fallo leve: NO detengas la sesión. Relee contexto y reintenta.",
  };

  if (name === "replace_in_file" && args?.path) {
    try {
      const read = tools.readFile(projectRoot, args.path, 4000);
      if (read?.ok) {
        enriched.autoRead = {
          path: args.path,
          content: String(read.content || "").slice(0, 3500),
        };
        enriched.guidance = "oldText no coincidió. Usa el contenido de autoRead para construir oldText EXACTO y vuelve a llamar replace_in_file.";
      }
    } catch { /* ignore */ }
  }

  return { recovered: false, payload: enriched };
}

function isVisualUiPath(rel) {
  return /\.(tsx|jsx|css|scss|sass|module\.css)$/i.test(String(rel || ""))
    || /(?:components|ui|app|pages|styles)\//i.test(String(rel || "").replace(/\\/g, "/"));
}

function formatToolActionNarration(name, args = {}) {
  const rel = String(args.path || "").replace(/\\/g, "/");
  const file = rel.split("/").filter(Boolean).pop() || rel;
  if (name === "write_file") return file ? `Creo \`${file}\`.` : "Creo archivo.";
  if (name === "replace_in_file") return file ? `Edito \`${file}\`.` : "Edito archivo.";
  if (name === "read_file") return file ? `Leo \`${file}\`.` : "Leo archivo.";
  if (name === "run_command") {
    const cmd = String(args.command || "").slice(0, 60);
    return cmd ? `Ejecuto \`${cmd}\`.` : "Ejecuto comando.";
  }
  if (name === "list_files") return "Listo la carpeta.";
  if (name === "search_files") {
    const q = String(args.query || "").slice(0, 40);
    return q ? `Busco \`${q}\`.` : "Busco.";
  }
  return "";
}

function wantsBackground(message, decision, input) {
  if (input?.background === true) return true;
  if (decision?.background === true) return true;
  return /\b(?:segundo\s+plano|en\s+background|background|sin\s+esperar)\b/i.test(String(message || ""));
}

function backgroundWorkerType(decisionKind) {
  const kind = String(decisionKind || "").toUpperCase();
  if (kind === "ANALYZE") return "ANALYZE";
  if (kind === "LIST" || kind === "ASK") return "LIST";
  if (kind === "VERIFY") return "VERIFY";
  if (kind === "VISION") return "VISION";
  return kind || "ANALYZE";
}

const APPROVAL_WORDS = new Set([
  "procede", "procedo", "adelante", "hazlo", "autorizado",
  "continua", "continúa", "ejecuta", "si", "sí", "ok", "dale", "va",
]);

function persistKernelRoadmap(projectRoot, { task, steps, kind, text, completed } = {}) {
  if (!projectRoot) return false;
  try {
    const {
      syncProjectRoadmap,
      buildRoadmapSyncFromRun,
    } = require("../runtime/project-roadmap");

    const analysisMode = String(kind || "").toUpperCase() === "ANALYZE";
    const payload = buildRoadmapSyncFromRun({
      steps: Array.isArray(steps) ? steps : [],
      task: String(task || "").slice(0, 220),
      analysisMode,
      completed: completed === true,
      reportText: String(text || "").slice(0, 1800),
      status: completed
        ? (analysisMode
            ? "Análisis completado. Fase lista para avanzar."
            : "Ciclo finalizado. Listo para la siguiente tarea.")
        : `En proceso: ${String(text || "").slice(0, 140)}`,
      nextAction: completed
        ? "Proponer optimización, analítica o nueva funcionalidad complementaria."
        : "Continuar desde el estado actual.",
      phase: analysisMode ? "analisis" : "implementacion",
    });

    const changed = (Array.isArray(steps) ? steps : [])
      .filter((s) => s && s.ok !== false && [
        "write_file", "replace_in_file", "delete_file", "apply_diff", "create_project",
      ].includes(String(s?.name || "")))
      .map((s) => String(s?.input?.path || s?.result?.path || "").replace(/\\/g, "/"))
      .filter(Boolean);
    if (changed.length) {
      payload.files = [...new Set([...(payload.files || []), ...changed])];
    }
    syncProjectRoadmap(projectRoot, payload);
    return true;
  } catch {
    return false;
  }
}

function detachLongRunningStreams(steps) {
  if (!Array.isArray(steps)) return;
  for (const s of steps) {
    const detach = s?.result?.detach;
    if (typeof detach === "function") {
      try { detach(); } catch { /* ignore */ }
    }
  }
}

class ChatOrchestrator {
  constructor() {
    this.session = new ChatSession();
    this.abort = null;
    this.turnAbort = null;
    this.steering = [];
    this.running = false;
    this.pendingTask = null;
  }

  stop() {
    const reason = Object.assign(new Error("Detenido por el usuario."), { code: "AGENT_STEER" });
    if (this.turnAbort) {
      try { this.turnAbort.abort(reason); } catch (_) { /* ignore */ }
      this.turnAbort = null;
    }
    if (this.abort) {
      try { this.abort.abort(reason); } catch (_) { /* ignore */ }
    }
    this.session.kill();
    this.pendingTask = null;
    this.steering = [];
    this.running = false;
    try { taskQueue.cancelAll(); } catch (_) { /* ignore */ }
    return { kind: "STOP", text: "Frené lo que estaba haciendo. ¿Qué querés que haga ahora?" };
  }

  steer(instruction = "") {
    const text = String(instruction || "").trim();
    if (!text) return { accepted: false };
    if (!this.running && !this.abort) return { accepted: false };
    this.steering.push({ instruction: text, at: Date.now() });
    let interrupted = false;
    if (this.turnAbort) {
      const steerError = Object.assign(new Error("Nueva instruccion del usuario."), { code: "AGENT_STEER" });
      try {
        this.turnAbort.abort(steerError);
        interrupted = true;
      } catch (_) { /* ignore */ }
    }
    return { accepted: true, pendingDirections: this.steering.length, interrupted };
  }

  isRunning() {
    return this.running === true;
  }

  enqueueBackgroundTask({ decision, message, projectRoot, onProgress, extra = {} }) {
    const taskType = backgroundWorkerType(decision.kind);
    const taskId = taskQueue.runInBackground(
      taskType,
      {
        projectRoot,
        message,
        target: extra.target,
        command: extra.command,
        url: extra.url,
        maxReads: extra.maxReads,
        ...extra,
      },
      {
        onProgress: (data) => {
          if (data.status === "completed" || data.status === "failed") return;
          onProgress?.({
            phase: "background",
            name: taskType.toLowerCase(),
            text: data.text || `Tarea ${data.taskId} en curso…`,
            taskId: data.taskId,
            ok: data.ok,
          });
        },
      },
    );

    const onComplete = (data) => {
      if (data.taskId !== taskId) return;
      taskQueue.off("task_complete", onComplete);
      taskQueue.off("task_error", onError);
      onProgress?.({
        phase: "background_complete",
        name: taskType.toLowerCase(),
        text: `[Segundo plano] Tarea ${taskId} completada.\n${String(data.text || "").slice(0, 4000)}`,
        taskId,
        result: data.result,
        ok: true,
      });
    };
    const onError = (data) => {
      if (data.taskId !== taskId) return;
      taskQueue.off("task_complete", onComplete);
      taskQueue.off("task_error", onError);
      onProgress?.({
        phase: "background_error",
        name: taskType.toLowerCase(),
        text: `[Segundo plano] Tarea ${taskId} falló: ${data.error || "error"}`,
        taskId,
        ok: false,
      });
    };
    taskQueue.on("task_complete", onComplete);
    taskQueue.on("task_error", onError);

    onProgress?.({
      phase: "background_start",
      name: taskType.toLowerCase(),
      text: `Tarea ${taskId} iniciada en segundo plano…`,
      taskId,
    });

    return {
      kind: "CHAT",
      background: true,
      taskId,
      text: [
        `Lancé la tarea [${taskId}] en segundo plano (${decision.label || decision.kind}).`,
        `Podés seguir dándome instrucciones mientras trabaja.`,
      ].join(" "),
    };
  }

  async handle(input = {}) {
    const {
      message,
      projectRoot,
      apiBaseUrl,
      apiKey,
      model,
      images,
      onProgress,
      helpers,
      autoHeal,
      background,
      runModelTaskFn,
      allowWrite: inputAllowWrite,
      permissionMode,
      permissionFull,
      fullAccess: inputFullAccess,
      planAuthorizedExecution: inputPlanAuth,
      history,
      messages: inputMessages,
      threadId: inputThreadId,
      chatId,
    } = input;

    const rawText = typeof message === "object" && message?.text ? message.text : String(message || "");
    const taskImages = Array.isArray(images) ? images.filter(Boolean) : [];
    const hasImages = taskImages.length > 0;
    const text = rawText.trim() || (hasImages ? "Analiza la imagen adjunta." : "");
    const textLower = text.toLowerCase();
    const isApprovalText = APPROVAL_WORDS.has(textLower);
    const visionAsk = hasImages && /\b(?:imagen|foto|captura|screenshot|adjunt|overlay|error\s+visible|analiza\s+(?:esto|la|el))\b/i.test(text);

    let effectiveText = text;
    if (isApprovalText) {
      const hist = Array.isArray(history) ? history : Array.isArray(inputMessages) ? inputMessages : [];
      const prevUserMsgs = hist.filter((m) => m && (m.role === "user" || m.sender === "user" || m.from === "user"));
      for (let i = prevUserMsgs.length - 1; i >= 0; i--) {
        const item = prevUserMsgs[i];
        const prevText = typeof item.content === "string" ? item.content : item.text || (Array.isArray(item.content) ? item.content.map((c) => c.text || "").join(" ") : "");
        const cleanPrev = String(prevText || "").trim();
        if (cleanPrev && !APPROVAL_WORDS.has(cleanPrev.toLowerCase()) && cleanPrev.length > 5) {
          effectiveText = `INSTRUCCIÓN AUTORIZADA DEL USUARIO: "${cleanPrev}". Procede de inmediato a aplicar las modificaciones de código con replace_in_file o write_file y verificar.`;
          break;
        }
      }
    }

    const fullAccess = isFullAccess({
      allowWrite: inputAllowWrite,
      permissionMode,
      permissionFull,
      fullAccess: inputFullAccess,
      planAuthorizedExecution: inputPlanAuth,
      mode: permissionMode,
    }) || String(permissionMode || "").toLowerCase() === "full";

    if (fullAccess) {
      this.pendingTask = null;
    }

    let decision = classify(effectiveText, {
      allowWrite: fullAccess || inputAllowWrite === true,
      permissionMode: fullAccess ? "full" : permissionMode,
      fullAccess,
    });

    if (fullAccess) {
      decision.allowWrite = true;
      if (decision.kind === "CONFIRM" || isApprovalText) {
        decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      }
      if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) {
        decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      }
    }

    if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) {
      decision = {
        kind: "EXECUTE",
        label: fullAccess ? "Ejecución (Acceso completo)" : "Construcción / Ejecución",
        allowTools: true,
        allowWrite: true,
        background: false,
      };
    }

    if (decision.kind === "CHAT" && /(?:^|[^\w])(?:analiz[aáá]|analizar|diagnostica|revis[aá]|inspecciona|explora(?:r)?\s+el\s+proyecto)(?=\s|$|[.!,?¿¡:])/i.test(effectiveText)) {
      decision = { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background: false };
    }

    if (hasImages && (decision.kind === "ANALYZE" || decision.kind === "ASK" || visionAsk)) {
      decision = fullAccess
        ? { kind: "EXECUTE", label: "Análisis visual + acción", allowTools: true, allowWrite: true, background: false }
        : { kind: "ASK", label: "Análisis visual", allowTools: true, allowWrite: false, background: false };
    }

    if (background === true) decision.background = true;

    if (decision.kind === "STOP") return this.stop();

    if (!projectRoot && decision.kind !== "CHAT") {
      return { kind: "CHAT", text: "Abrí un proyecto primero y después te ayudo con eso." };
    }

    const memory = projectRoot ? new PersistentMemory(projectRoot) : null;
    if (memory) memory.load();

    const threadId = threadCore.resolveThreadId({
      threadId: inputThreadId,
      chatId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
    });
    const historyInput = Array.isArray(history) && history.length
      ? history
      : (Array.isArray(inputMessages) ? inputMessages : []);
    if (projectRoot) {
      threadCore.seedThreadFromInput(projectRoot, threadId, { history: historyInput }, text);
    }
    input._threadId = threadId;
    input._historyInput = historyInput;
    this._threadId = threadId;
    this._historyInput = historyInput;
    this._currentUserText = text;

    if (decision.kind === "CHAT") {
      this.pendingTask = null;
      if (!apiKey) {
        return {
          kind: "CHAT",
          text: "EditCoreAI es un IDE con agente autónomo. Abrí un proyecto y pedime un cambio concreto.",
        };
      }
      return this.runModelTask({
        decision, message: text, projectRoot: projectRoot || ".", apiBaseUrl, apiKey, model, memory, onProgress,
        allowWrite: false, maxSteps: 1, helpers, chatOnly: true,
        images: taskImages,
      });
    }

    if (decision.kind === "LIST" || decision.kind === "ASK") {
      ensureCognitiveMap(projectRoot);
      if (hasImages) {
        onProgress?.({ phase: "start", text: "Analizando la imagen que adjuntaste…" });
        return this.runModelTask({
          decision,
          message: text,
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false, maxSteps: 8, helpers,
          images: taskImages,
          fullAccess: false,
          permissionMode,
        });
      }
      const target = extractListTarget(text, projectRoot) || ".";
      this.session.start(decision.kind, projectRoot);
      const out = agentBus.wrapSubagentResult(
        projectRoot,
        this._threadId,
        "explorer",
        await runExplorer({ projectRoot, target, onProgress, threadId: this._threadId }),
      );
      this.session.kill();
      if (memory) memory.note(`listó ${out.target || target}`);

      if (apiKey) {
        return this.runModelTask({
          decision,
          message: scopeUserMessage(text, out.summary),
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false, maxSteps: 4, helpers,
          images: taskImages,
        });
      }

      return { kind: decision.kind, text: out.summary, steps: out.steps };
    }

    if (decision.kind === "ANALYZE") {
      if (hasImages) {
        onProgress?.({ phase: "start", text: "Analizando la imagen que adjuntaste…" });
        return this.runModelTask({
          decision: fullAccess
            ? { kind: "EXECUTE", label: "Análisis visual", allowTools: true, allowWrite: true }
            : decision,
          message: text,
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: fullAccess,
          planAuthorizedExecution: fullAccess,
          maxSteps: fullAccess ? AUTHORIZED_MAX_STEPS : 8,
          helpers,
          fullAccess,
          permissionMode,
          images: taskImages,
          authorizedFromPending: fullAccess,
        });
      }
      this.session.start("ANALYZE", projectRoot);
      const scope = requestScopePolicy?.classifyRequestScope?.(text) || "focused";
      const maxReads = scope === "broad" ? 16 : scope === "action" ? 10 : 6;
      onProgress?.({ phase: "start", text: "Revisando lo necesario para tu pregunta…" });
      const out = agentBus.wrapSubagentResult(
        projectRoot,
        this._threadId,
        "analyst",
        await runAnalyst({ projectRoot, onProgress, maxReads, userMessage: text, threadId: this._threadId }),
      );
      if (memory) {
        memory.setReport(out.report);
        memory.note("análisis completado");
      }
      this.session.kill();

      if (apiKey) {
        return this.runModelTask({
          decision,
          message: scopeUserMessage(text, out.report),
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false, maxSteps: 2, helpers,
          images: taskImages,
        });
      }

      return { kind: "ANALYZE", text: out.report, steps: out.steps };
    }

    if (decision.kind === "VERIFY") {
      this.session.start("VERIFY", projectRoot);
      const out = agentBus.wrapSubagentResult(
        projectRoot,
        this._threadId,
        "verifier",
        await runVerifier({ projectRoot, onProgress, timeoutMs: 60_000, threadId: this._threadId }),
      );
      this.session.kill();
      return {
        kind: "VERIFY",
        text: out?.ok
          ? "Verificación OK."
          : `Falló la verificación: ${String(out?.result?.error || out?.result?.stderr || "").slice(0, 600)}`,
        steps: out?.steps || [],
      };
    }

    const wantsWrite = fullAccess || decision.allowWrite;

    if (wantsWrite) {
      if (!apiKey) return { kind: "CHAT", text: "Me falta la API key para ejecutar cambios." };

      onProgress?.({
        phase: "start",
        text: "Ejecutando los cambios de forma autónoma…",
      });
      this.pendingTask = null;

      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision,
        message: text,
        projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        memory,
        onProgress,
        allowWrite: true,
        planAuthorizedExecution: true,
        maxSteps: AUTHORIZED_MAX_STEPS,
        helpers,
        authorizedFromPending: true,
        fullAccess,
        permissionMode: fullAccess ? "full" : permissionMode,
        images: taskImages,
      });
    }

    return { kind: "CHAT", text: "No terminé de entender el pedido. ¿Me lo reformulás?" };
  }

  async runModelTask(opts) {
    const {
      decision, message, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
      allowWrite, maxSteps, helpers, chatOnly, authorizedFromPending,
      fullAccess, permissionMode, images: taskImages = [],
      history: taskHistory,
      threadId: taskThreadId,
    } = opts;
    const threadId = threadCore.resolveThreadId({
      threadId: taskThreadId || this._threadId,
      chatId: this._threadId,
    });
    const historyInput = Array.isArray(taskHistory) && taskHistory.length
      ? taskHistory
      : (Array.isArray(this._historyInput) ? this._historyInput : []);

    const accessFull = fullAccess === true
      || isFullAccess({ allowWrite, permissionMode, fullAccess, planAuthorizedExecution: authorizedFromPending });

    this.session.start(decision?.kind || "EXECUTE", projectRoot);
    this.abort = new AbortController();
    this.running = true;
    this.turnAbort = null;
    if (!Array.isArray(this.steering)) this.steering = [];

    const deadline = Date.now() + Math.max(30_000, Number(opts.totalTimeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS);
    let incompleteRetries = 0;

    const toolHistory = new Map();
    const softRetryCounts = new Map();
    let lastVerifyError = null;
    const cognitiveBlock = (!chatOnly && decision?.kind !== "CHAT")
      ? formatCognitiveBlock(projectRoot)
      : "";
    const roadmapFirstBlock = (!chatOnly && decision?.kind !== "CHAT")
      ? buildRoadmapFirstBlock(projectRoot)
      : "";
    const connectionsBlock = (!chatOnly && decision?.kind !== "CHAT")
      ? buildConnectionsBlock(projectRoot)
      : "";

    const previewUrl = String(helpers?.previewUrl || "").trim();
    const previewBlock = previewUrl
      ? `PREVIEW ACTIVO DEL IDE: ${previewUrl}`
      : "";

    const visionHardRule = (Array.isArray(taskImages) && taskImages.length)
      ? "VISION: Hay imágenes adjuntas. Analizalas directamente en este turno."
      : "";

    const noConfirmBlock = (accessFull || authorizedFromPending)
      ? "ACCESO COMPLETO: Ejecutá herramientas de inmediato sin pedir confirmación previa."
      : "";

    let system = wrapSystemPrompt(chatOnly || decision?.kind === "CHAT"
      ? [
        "Sos EditCoreAI: asistente del IDE. Respondé siempre en español, claro y directo.",
        `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
        previewBlock,
        visionHardRule,
      ].filter(Boolean).join("\n\n")
      : [
        "Sos EditCoreAI. Hablá como un ingeniero senior al lado del usuario.",
        LEADERSHIP_PROMPT,
        LIVE_NARRATION_PROMPT,
        noConfirmBlock,
        "Ejecutá YA la instrucción con tools y explicá cada fase completada.",
        "Respondé siempre en español al usuario.",
        previewBlock,
        visionHardRule,
        roadmapFirstBlock,
        cognitiveBlock,
        connectionsBlock,
      ].filter(Boolean).join("\n\n"));

    const userText = `Proyecto: ${projectRoot}\n${scopeUserMessage(message)}`;
    const messages = threadCore.buildMessageList({
      system,
      userText,
      projectRoot,
      threadId,
      historyInput,
      query: String(this._currentUserText || message || ""),
    });

    const steps = [];
    const runMutations = [];
    const stepsLimit = Math.max(1, Number(maxSteps) || DEFAULT_MAX_STEPS);
    const totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cachedInputTokens: 0,
    };

    const routed = pickModel({
      requested: model,
      kind: decision?.kind || "CHAT",
      hasTools: !(chatOnly || decision?.kind === "CHAT"),
    });
    const routedModel = String(routed.model || model || "").trim();
    const rememberOut = (textOut) => {
      try {
        threadCore.rememberExchange(projectRoot, threadId, this._currentUserText || message, textOut);
      } catch { /* persist best-effort */ }
    };

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (Date.now() > deadline) {
          this.session.kill();
          const partial = formatAgentVisibleText("Se agotó el tiempo límite para completar la tarea. Avance parcial registrado.");
          rememberOut(partial);
          detachLongRunningStreams(steps);
          return { kind: decision?.kind || "CHAT", text: partial, steps, incomplete: true, threadId, usage: totalUsage };
        }

        if (!this.session.alive) {
          rememberOut("Detenido.");
          detachLongRunningStreams(steps);
          return { kind: "STOP", text: "Detenido.", steps, threadId, usage: totalUsage };
        }

        const availableTools = (chatOnly || decision?.kind === "CHAT")
          ? []
          : tools.getToolDefinitions({
              allowWrite: accessFull,
              isFullAccess: accessFull,
              isAnalysis: false,
            }).filter((t) => ![
              "preview_browser_interaction",
              "browser_page_action",
              "capture_preview_screenshot",
              "auto_scaffold_project",
              "clone_web_page", "images_to_code",
              "rollback_last_change",
            ].includes(t.function?.name || t.name));

        let streamAccum = "";
        let lastVisible = "";
        let toolStreamNotified = false;
        this.turnAbort = new AbortController();
        const turnSignal = (typeof AbortSignal.any === "function" && this.abort?.signal)
          ? AbortSignal.any([this.abort.signal, this.turnAbort.signal])
          : (this.turnAbort.signal || this.abort?.signal);

        const hb = setInterval(() => {
          try { onProgress?.({ phase: "heartbeat", text: "Procesando…" }); } catch { /* ignore */ }
        }, HEARTBEAT_INTERVAL_MS);

        let turn;
        try {
          turn = await callChat({
            apiBaseUrl, apiKey, model: routedModel, messages,
            tools: (chatOnly || decision?.kind === "CHAT") ? [] : availableTools,
            signal: turnSignal,
            stream: true,
            onTextDelta: (delta) => {
              const chunk = String(delta || "");
              if (!chunk) return;
              try {
                streamAccum += chunk;
                const visible = visibleNarrationText(streamAccum);
                let piece = "";
                if (visible.startsWith(lastVisible)) {
                  piece = visible.slice(lastVisible.length);
                } else if (visible !== lastVisible) {
                  piece = visible;
                }
                lastVisible = visible;
                if (!piece) return;
                onProgress?.({
                  phase: "narration_delta",
                  text: piece,
                  index: steps.length,
                  streaming: true,
                });
              } catch { /* ignore */ }
            },
          });
        } finally {
          clearInterval(hb);
          this.turnAbort = null;
        }

        let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        if (chatOnly || decision?.kind === "CHAT") {
          toolCalls = [];
        } else if (!toolCalls.length && turn.text) {
          toolCalls = parseTextToolCalls(turn.text, { projectRoot });
        }
        const cleanText = stripTextToolMarkup(turn.text || "");

        if (!toolCalls.length) {
          this.session.kill();

          const written = successfulWritePaths(steps);
          let textOut = cleanText;

          if (written.length > 0) {
            // Si el modelo ya escribió un cierre >= 60 chars con contenido real,
            // respetarlo tal cual para no duplicar mensajes ni agregar texto canned.
            if (cleanText && cleanText.trim().length >= 60) {
              textOut = cleanText;
            } else {
              const head = cleanText && cleanText.length > 20 ? cleanText + "\n\n" : "";
              const lista = written.map((p) => `- \`${p}\``).join("\n");
              const sugerencia = nextStepsClosingText(projectRoot, written, steps);
              textOut = `${head}Archivos actualizados:\n\n${lista}\n\n${sugerencia}`;
            }
          } else {
            textOut = groundUngroundedClaims(cleanText, steps, message, decision);
          }

          textOut = formatAgentVisibleText(textOut);

          persistKernelRoadmap(projectRoot, {
            task: message, steps, kind: decision?.kind, text: textOut, completed: true,
          });
          rememberOut(textOut);
          detachLongRunningStreams(steps);
          return {
            kind: decision?.kind || "CHAT",
            text: textOut,
            steps,
            mutations: runMutations,
            incomplete: false,
            report: { completed: true },
            threadId,
            usage: totalUsage,
          };
        }

        messages.push({
          role: "assistant",
          content: cleanText || null,
          tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: c.function })),
        });

        for (const call of toolCalls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
          if (args.path) args.path = toRelativePath(projectRoot, args.path);

          const actionLine = formatToolActionNarration(name, args);
          if (actionLine) onProgress?.({ phase: "narration", text: actionLine });

          const callKey = `${name}:${JSON.stringify(args)}`;
          const execCount = toolHistory.get(callKey) || 0;
          if (execCount >= 1) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: tools.truncatePayload({ ok: false, error: "Límite alcanzado para esta acción repetida." }),
            });
            continue;
          }
          toolHistory.set(callKey, execCount + 1);

          onProgress?.({ phase: "tool", stage: "running", name, input: args });

          let result;
          if (name === "write_file" || name === "replace_in_file") {
            const impl = await runImplementer({
              projectRoot,
              path: args.path,
              content: args.content,
              oldText: args.oldText,
              newText: args.newText,
              onProgress,
              threadId,
            });
            result = impl.result || impl;
          } else {
            result = await tools.execute(name, args, projectRoot, allowWrite, helpers || {});
          }

          const softRecover = recoverSoftToolFailure(name, args, result, projectRoot);
          result = softRecover.payload;

          const stepData = {
            name,
            input: args,
            result,
            ok: result?.ok !== false,
          };
          steps.push(stepData);
          this.session.addStep(stepData);
          onProgress?.({
            phase: "tool",
            stage: "done",
            name,
            input: args,
            result,
            ok: stepData.ok,
          });

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: tools.truncatePayload(result || {}, 2000),
          });
        }
      }

      this.session.kill();
      const written = successfulWritePaths(steps);
      let textOut = written.length > 0
        ? `Archivos actualizados:\n${written.map(p => `- \`${p}\``).join("\n")}\n\n${nextStepsClosingText(projectRoot, written, steps)}`
        : `${nextStepsClosingText(projectRoot, [], steps)}`;

      textOut = formatAgentVisibleText(textOut);
      persistKernelRoadmap(projectRoot, { task: message, steps, kind: decision?.kind, text: textOut, completed: true });
      rememberOut(textOut);
      detachLongRunningStreams(steps);
      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, incomplete: false, threadId, usage: totalUsage };
    } catch (err) {
      this.session.kill();
      let safeMsg = String(err?.message || err || "Error desconocido");
      const errText = formatAgentVisibleText("Algo falló durante la ejecución: " + safeMsg);
      persistKernelRoadmap(projectRoot, { task: message, steps, kind: decision?.kind, text: errText, completed: false });
      rememberOut(errText);
      detachLongRunningStreams(steps);
      return { kind: "CHAT", text: errText, steps, threadId, usage: totalUsage };
    } finally {
      this.running = false;
      this.turnAbort = null;
      try { onProgress?.({ phase: "done", text: "" }); } catch { /* ignore */ }
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue };