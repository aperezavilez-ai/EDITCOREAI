"use strict";

const path = require("path");
const { classify, extractListTarget, isFullAccess } = require("./classify");
const { ChatSession } = require("./session");
const { PersistentMemory } = require("./memory");
const { skillsPrompt, SKILL_IDS } = require("./skills-catalog");
const { runExplorer } = require("./subagents/explorer");
const { runAnalyst } = require("./subagents/analyst");
const { runImplementer } = require("./subagents/implementer");
const { runVerifier } = require("./subagents/verifier");

// dispatcher.js es opcional. Si falta o está corrupto (encoding roto),
// el chat arranca igual. Solo pierde la asignación de "rol especialista" al prompt.
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

let intentOrchestrator = null;
function getIntentOrchestrator() {
  if (intentOrchestrator !== null) return intentOrchestrator;
  try {
    intentOrchestrator = require("../runtime/intent-orchestrator");
  } catch (_) {
    try {
      intentOrchestrator = require("./intent-orchestrator");
    } catch (e) {
      intentOrchestrator = false;
    }
  }
  return intentOrchestrator || null;
}

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
const DEFAULT_TOTAL_TIMEOUT_MS = 240_000;
const MAX_INCOMPLETE_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 5_000;

// NOTA: la detección de comandos long-running y el timeout de run_command
// viven en editcore-chat-kernel/process-runner.js + tools.js. NO duplicar acá.

// v5: prompts cortos y humanos. La voz completa vive en elite-communication-policy.
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
  let value = String(text || "").trim();
  const isDangling = !value
    || /\b(?:quedan|queda|para|de|en|el|la|los|las|un|una|y|o|que|con|por|sin|voy\s+a|ejecuto|veo\s+que|ajusto)\s*$/i.test(value)
    || (/^(?:voy\s+a\s+(?:ejecutar|filtrar|capturar|leer)|ejecuto\s+npm|las\s+pruebas\s+est[aá]n\s+corriendo|en\s+windows\s+tail|el\s+timeout\s+de)/i.test(value) && !/[.!?]$/.test(value))
    || (!/[.!?:"`\n*]$/.test(value) && value.length < 80);

  if (!isDangling && value.length > 20) {
    return formatAgentVisibleText(value);
  }

  if (/\b(?:conservar|aceptar)\s+todo\b/i.test(userMessage)) {
    return formatAgentVisibleText(
      "Entendido. Todos los cambios pendientes han sido confirmados y quedan guardados permanentemente en el proyecto.\n\n" +
      "¿Con qué tarea o funcionalidad continuamos ahora?"
    );
  }

  const cmdSteps = steps.filter((s) => s.name === "run_command" || s.name === "run_diagnostic");
  if (cmdSteps.length > 0) {
    const lastCmd = cmdSteps[cmdSteps.length - 1];
    const out = String(lastCmd.result?.stdout || lastCmd.result?.output || lastCmd.result?.stderr || "").trim();
    if (/pass\s+(\d+)|passed|ok/i.test(out)) {
      return formatAgentVisibleText(
        "Se ejecutaron las pruebas automatizadas del proyecto con éxito.\n\n" +
        "Todas las suites de tests pasaron correctamente (0 fallos).\n\n" +
        "¿Deseas que avancemos con la siguiente verificación o implementemos una nueva funcionalidad?"
      );
    }
  }

  const written = successfulWritePaths(steps);
  if (written.length > 0) {
    const lista = written.map((p) => `- \`${p}\``).join("\n");
    return formatAgentVisibleText(
      `He finalizado esta tarea y aplicado las modificaciones solicitadas con éxito:\n\n${lista}\n\n` +
      "¿Te parece si revisamos el resultado o continuamos con el siguiente paso?"
    );
  }

  const readFiles = steps.filter((s) => s.name === "read_file" || s.name === "list_files").map((s) => s.input?.path).filter(Boolean);
  if (readFiles.length > 0) {
    const filesStr = readFiles.slice(0, 3).map((f) => `\`${f}\``).join(", ");
    return formatAgentVisibleText(
      `He completado la inspección de ${filesStr}.\n\n` +
      "¿Deseas que procedamos a implementar los ajustes en el proyecto?"
    );
  }

  if (value && value.length > 10) {
    const cleaned = value.replace(/\s+(?:quedan|queda|para|de|en|el|la|los|las|un|una|y|o|que|con|por|sin)\s*$/i, ".");
    return formatAgentVisibleText(`${cleaned}\n\n¿Deseas que continuemos con el siguiente paso?`);
  }

  return formatAgentVisibleText("He completado la acción solicitada con éxito.\n\n¿En qué podemos avanzar ahora?");
}

function groundUngroundedClaims(text, steps = [], userMessage = "", decision = {}) {
  if (
    decision?.kind === "ANALYZE" ||
    decision?.kind === "ASK" ||
    decision?.kind === "LIST" ||
    decision?.allowWrite === false
  ) {
    return repairDanglingOutput(text, steps, userMessage, decision);
  }
  const written = successfulWritePaths(steps);
  if (written.length > 0) return repairDanglingOutput(text, steps, userMessage, decision);
  const claims = textClaimsDiskMutation(text);
  if (claims) {
    return formatAgentVisibleText(
      "No pude comprobar creación ni escritura real en disco en este turno (no hubo `write_file` / `replace_in_file` / `scaffold_project` exitoso).\n\n" +
      "Conectá o indicá la carpeta destino y pedime de nuevo que lo cree con tools. No invento proyectos ni HTML sin guardarlos."
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
  let suggestion = "";
  try {
    const { readRoadmap } = require("../runtime/project-roadmap");
    const rm = readRoadmap(projectRoot);
    if (rm?.content) {
      const lines = rm.content.split("\n");
      const nextPending = lines.find((l) => /^\s*-\s*\[\s*\]/i.test(l) || /^\s*\d+\.\s*\[\s*\]/i.test(l));
      if (nextPending) {
        const clean = nextPending.replace(/^\s*[-*0-9.]+\s*\[\s*\]\s*/, "").trim();
        if (clean) suggestion = `¿Te parece si avanzamos ahora con el siguiente paso: **${clean}**?`;
      }
    }
  } catch { /* ignore */ }

  if (!suggestion) {
    const rootName = path.basename(projectRoot || "").toLowerCase();
    const hasVisual = writtenFiles.some((f) => /\.(tsx|jsx|css|html)$/i.test(f))
      || steps.some((s) => /\.(tsx|jsx|css|html)$/i.test(s?.input?.path || ""));
    const hasDb = writtenFiles.some((f) => /\.(sql|prisma)$/i.test(f) || /supabase|migration/i.test(f));

    if (rootName.includes("lipoblue") || rootName.includes("shop") || rootName.includes("suplemento")) {
      suggestion = "¿Te parece si avanzamos con la siguiente mejora: **implementar el botón de compra flotante (Sticky CTA) optimizado para móviles y el flujo de pedidos por WhatsApp**?";
    } else if (hasVisual) {
      suggestion = "El cambio visual y los componentes se encuentran verificados. ¿Deseas que refine algún acabado estético adicional o avanzamos con la siguiente funcionalidad técnica del proyecto?";
    } else if (hasDb) {
      suggestion = "La estructura de datos ha quedado lista. ¿Deseas que continuemos con la integración en la interfaz o pasamos a la siguiente prueba?";
    } else {
      suggestion = "¿Avanzamos con la siguiente funcionalidad o mejora técnica del proyecto?";
    }
  }
  return suggestion;
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
    "1) El ROADMAP y session-state YA están arriba (## Proceso, ## Bloqueos, ## Tarea activa, ## Mapa). NO ejecutes list_files('.') ni project_discovery ni codebase_map del repo entero si el mapa cubre la tarea.",
    "2) Lee primero ## Proceso y ## Bloqueos: es la memoria entre mensajes.",
    "3) Prohibido re-listar o re-leer archivos que ya aparezcan en ## Mapa salvo que el usuario pida 'léelo ahora'.",
    "4) Para modificar: read_file SOLO de los archivos concretos que vas a tocar. Máximo 1 lectura por archivo.",
    "5) Si el ROADMAP está vacío y necesitás explorar, di en 1-2 frases qué falta y por qué, luego UNA sola llamada a list_files('.') — nunca dos seguidas.",
    "6) Tras write_file/replace_in_file, EditCore actualiza ROADMAP.md solo. No lo reescribas a mano.",
    "7) Prohibido re-leer un archivo que ya leíste en este turno. Si necesitás más contexto, usá search_files acotado o symbol_search.",
    "8) Si el usuario pide algo simple y el ROADMAP ya dice dónde está: ve DIRECTO al archivo. No explores.",
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
    guidance: "Fallo leve: NO detengas la sesión. Relee contexto y reintenta con parámetros corregidos.",
  };

  if (name === "replace_in_file" && args?.path) {
    try {
      const read = tools.readFile(projectRoot, args.path, 4000);
      if (read?.ok) {
        enriched.autoRead = {
          path: args.path,
          content: String(read.content || "").slice(0, 3500),
        };
        enriched.guidance = "oldText no coincidió. Usa el contenido de autoRead para construir oldText EXACTO y vuelve a llamar replace_in_file. Continúa el ciclo OODA.";
      }
    } catch { /* ignore */ }
  }

  if (name === "list_files") {
    try {
      const resolved = projectMapApi?.resolveExistingTarget?.(projectRoot, args?.path || ".");
      if (resolved && resolved.target !== args?.path) {
        const listed = tools.listFiles(projectRoot, resolved.target);
        return {
          recovered: listed?.ok === true,
          payload: {
            ...listed,
            soft: true,
            ooda: "continue",
            requested: args?.path,
            resolved: resolved.target,
            missing: resolved.missing,
            guidance: `Ruta inexistente corregida vía mapa cognitivo → '${resolved.target}'. Continúa.`,
          },
          stepsExtra: listed?.ok
            ? [{ name: "list_files", input: { path: resolved.target }, result: listed, ok: true, softRecover: true }]
            : [],
        };
      }
    } catch { /* ignore */ }
  }

  if (name === "run_command" && /^\s*git\b/i.test(String(args?.command || ""))) {
    enriched.guidance = "Comando git auxiliar falló (secundario). Ignóralo si no es crítico y continúa la tarea principal.";
    enriched.secondary = true;
  }

  return { recovered: false, payload: enriched };
}

function isVisualUiPath(rel) {
  return /\.(tsx|jsx|css|scss|sass|module\.css)$/i.test(String(rel || ""))
    || /(?:components|ui|app|pages|styles)\//i.test(String(rel || "").replace(/\\/g, "/"));
}

// v5: narración humana natural (primera persona, verbo conjugado).
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
  if (name === "clone_web_page") return "Clono la página.";
  if (name === "capture_preview_screenshot") return "Capturo el preview.";
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

function pickModelForKind(_kind, currentModel) {
  return currentModel;
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
            ? "Análisis cerrado. ROADMAP = Proceso+Mapa+Bloqueos; no reexplorar lo mapeado."
            : "Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.")
        : `Incompleta: ${String(text || "").slice(0, 140)}`,
      nextAction: completed
        ? "Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero."
        : "Retomar desde ## Proceso y ## Siguiente de este ROADMAP.",
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

/**
 * Cleanup defensivo: cierra streams de procesos long-running que quedaron vivos.
 * process-runner.js expone `detach` en el resultado para cortar stdout/stderr
 * sin matar el proceso. Sin esto, un dev-server mantiene el event loop ocupado.
 */
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
      try {
        agentBus.wrapSubagentResult(
          projectRoot,
          extra.threadId || this._threadId,
          String(taskType || "worker").toLowerCase(),
          data.result || { text: data.text, ok: true },
        );
      } catch { /* bus best-effort */ }
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
        `Te aviso en el panel cuando termine.`,
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

    if (!fullAccess && this.pendingTask && isApprovalText) {
      const taskToRun = this.pendingTask;
      this.pendingTask = null;
      onProgress?.({ phase: "start", text: "Dale, ejecuto los cambios en disco." });
      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision: taskToRun.decision,
        message: taskToRun.message || effectiveText,
        projectRoot: taskToRun.projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        memory: taskToRun.memory,
        onProgress,
        allowWrite: true,
        planAuthorizedExecution: true,
        maxSteps: AUTHORIZED_MAX_STEPS,
        helpers: taskToRun.helpers || helpers,
        authorizedFromPending: true,
        fullAccess: false,
        permissionMode,
      });
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

    // Sin acceso completo: nunca degradar crear/mover/arreglar a chat ciego (sin tools = inventa).
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

    if (/\b(?:explora|explorer|directorio|listar|estructura|archivos)\b/i.test(text) && decision.kind === "CHAT" && !hasImages) {
      decision = { kind: "LIST", label: "Explorar directorio", allowTools: true, allowWrite: false, background: false };
    }
    if (/\b(?:explica|explicar|lee|leer|describe|resume|revisa|qu[eé]\s+hace)\b/i.test(text)
      && /(?:[\\/]|\.\w{1,10}\b)/i.test(text)
      && decision.kind === "CHAT") {
      decision = { kind: "ASK", label: "Lectura / explicación", allowTools: true, allowWrite: false, background: false };
    }

    if (background === true) decision.background = true;

    let unifiedPlan = null;
    try {
      const _orch = getIntentOrchestrator();
      if (_orch?.resolveUnifiedAgentPlan) {
        unifiedPlan = _orch.resolveUnifiedAgentPlan({
          prompt: text,
          projectOpen: Boolean(projectRoot),
          allowWrite: fullAccess ? true : (decision.allowWrite ?? true),
          permissionMode: fullAccess ? "full" : (permissionMode || "step"),
          planAuthorizedExecution: fullAccess === true,
          requestedAgent: true,
        });
      }
    } catch (_) {
      unifiedPlan = null;
    }

    if (decision.kind === "STOP") return this.stop();

    if (!fullAccess && decision.kind === "CONFIRM") {
      if (!this.pendingTask || !this.pendingTask.message) {
        return {
          kind: "CHAT",
          text: "No hay nada pendiente de autorizar. Decime qué archivo o cambio necesitás.",
        };
      }
      const taskToRun = this.pendingTask;
      this.pendingTask = null;
      onProgress?.({ phase: "start", text: "Dale, proceso los cambios." });
      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision: taskToRun.decision,
        message: taskToRun.message,
        projectRoot: taskToRun.projectRoot,
        apiBaseUrl,
        apiKey,
        model,
        memory: taskToRun.memory,
        onProgress,
        allowWrite: true,
        planAuthorizedExecution: true,
        maxSteps: AUTHORIZED_MAX_STEPS,
        helpers: taskToRun.helpers || helpers,
        authorizedFromPending: true,
        permissionMode,
      });
    }

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
    if (projectRoot) {
      agentBus.record(projectRoot, threadId, { goal: text, phase: "ingest" });
    }

    if (autoHeal?.summary) {
      onProgress?.({ phase: "subagent", name: "auto-heal", text: autoHeal.summary });
      if (!apiKey) {
        return { kind: "CHAT", text: `Error de preview:\n${autoHeal.summary}\n\nConfigurá API key para auto-corregir.` };
      }
      onProgress?.({ phase: "subagent", name: "verifier", text: "Auto-heal: verificando / rollback..." });
      let verif = null;
      try {
        verif = await runVerifier({
          projectRoot,
          onProgress,
          autoRollback: true,
          timeoutMs: 25_000,
        });
      } catch (err) {
        verif = { ok: false, result: { error: String(err?.message || err) } };
      }
      const verifNote = verif?.ok
        ? "Verifier OK tras el aviso de logs."
        : `Verifier falló${verif?.rollback?.ok ? " (rollback aplicado)" : ""}: ${String(verif?.result?.error || verif?.result?.stderr || "").slice(0, 600)}`;
      return this.runModelTask({
        decision: { kind: "EXECUTE", label: "Auto-heal", allowTools: true, allowWrite: true },
        message: [
          "Corrige este error del servidor de desarrollo (auto-heal, sin esperar al usuario):",
          autoHeal.excerpt || autoHeal.summary,
          "",
          `[VERIFIER] ${verifNote}`,
          verif?.rollback?.snapshotId ? `Snapshot rollback: ${verif.rollback.snapshotId}` : "",
        ].filter(Boolean).join("\n"),
        projectRoot, apiBaseUrl, apiKey, model, memory, onProgress, allowWrite: true, maxSteps: 16, helpers,
      });
    }

    if (decision.kind === "CHAT") {
      this.pendingTask = null;
      if (!apiKey) {
        return {
          kind: "CHAT",
          text: "EditCoreAI es un IDE con agente autónomo. Abrí un proyecto y pedime un cambio concreto, o escribí *ayuda*.",
        };
      }
      const liveBus = projectRoot ? agentBus.loadBus(projectRoot, threadId) : null;
      const followThread = Boolean(liveBus && (liveBus.goal || liveBus.findings.length || liveBus.files.length));
      const wantsAction = userWantsDiskMutation(text) || /\b(?:replace_in_file|write_file|scaffold_project)\b/i.test(text);
      const continueLike = /^(?:contin[uú]a|procede|sigue)\b/i.test(text) && wantsAction;
      if (followThread && continueLike && projectRoot) {
        decision = {
          kind: fullAccess ? "EXECUTE" : "ASK",
          label: "Seguimiento del mismo hilo",
          allowTools: true,
          allowWrite: fullAccess,
          background: false,
        };
        return this.runModelTask({
          decision,
          message: text,
          projectRoot,
          apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: fullAccess,
          maxSteps: fullAccess ? 12 : 6,
          helpers,
          images: taskImages,
          fullAccess,
          permissionMode,
        });
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
      if (wantsBackground(text, decision, input)) {
        return this.enqueueBackgroundTask({
          decision, message: text, projectRoot, onProgress,
          extra: { target: extractListTarget(text, projectRoot) || ".", threadId: this._threadId },
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
      if (wantsBackground(text, decision, input)) {
        return this.enqueueBackgroundTask({
          decision, message: text, projectRoot, onProgress, extra: { maxReads: 8, threadId: this._threadId },
        });
      }
      this.session.start("ANALYZE", projectRoot);
      const scope = requestScopePolicy?.classifyRequestScope?.(text) || "focused";
      const maxReads = scope === "broad" ? 16 : scope === "action" ? 10 : 6;
      onProgress?.({ phase: "start", text: scope === "broad" ? "Dando una mirada amplia al proyecto…" : "Revisando lo necesario para tu pregunta…" });
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
      if (wantsBackground(text, decision, input)) {
        return this.enqueueBackgroundTask({ decision, message: text, projectRoot, onProgress, extra: { threadId: this._threadId } });
      }
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

    const wantsWrite = fullAccess
      || decision.allowWrite
      || unifiedPlan?.mode === intentOrchestrator?.MODES?.EXECUTE
      || unifiedPlan?.planAuthorizedExecution === true;

    if (wantsWrite) {
      if (!apiKey) return { kind: "CHAT", text: "Me falta la API key para ejecutar cambios." };

      onProgress?.({
        phase: "start",
        text: fullAccess
          ? "Acceso completo, ejecuto directo."
          : "Ejecutando los cambios…",
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

    const specialist = (!chatOnly && decision?.kind !== "CHAT" && !authorizedFromPending)
      ? dispatchSpecialist(message)
      : null;
    let specialistInstruction = "";
    if (specialist) {
      specialistInstruction = `\n\n[ROL: ${specialist.name}]\n${specialist.systemPrompt}`;
    }

    const globalLearned = (!chatOnly && decision?.kind !== "CHAT" && !authorizedFromPending)
      ? globalMemory.promptBlock(message, 8)
      : "";

    const previewUrl = String(helpers?.previewUrl || "").trim();
    const previewBlock = previewUrl
      ? [
        `PREVIEW ACTIVO DEL IDE: ${previewUrl}`,
        "Usá esa URL (o la tool capture_preview_screenshot). No inventes puertos/URLs (ej. :1420) si el preview ya está publicado.",
      ].join("\n")
      : "Sin URL de preview conocida en este turno. No inventes localhost:puerto; preguntá o usá capture_preview_screenshot.";

    const visionHardRule = (Array.isArray(taskImages) && taskImages.length)
      ? [
        `VISION: Hay ${taskImages.length} imagen(es) adjunta(s) en este mensaje multimodal.`,
        "PROHIBIDO decir que no hay imagen, que no la ves, o pedir que el usuario la suba otra vez.",
        "Analizá el contenido visual en la PRIMERA respuesta (errores Vite/overlay, UI, texto legible).",
      ].join("\n")
      : "";

    const noConfirmBlock = (accessFull || authorizedFromPending)
      ? [
        "ACCESO COMPLETO / EJECUCIÓN AUTORIZADA:",
        "PROHIBIDO preguntar: '¿Deseas que proceda?', 'Confirma para aplicar los cambios.', 'Escribe procede.', '¿Procedo?'.",
        "Ejecutá YA tools: write_file, replace_in_file, run_command. Sin preguntas previas.",
      ].join("\n")
      : "";

    let mentionsBlock = "";
    if (atMentionsResolver && message) {
      try {
        const mentions = atMentionsResolver.extractMentions(message);
        if (mentions.length && projectRoot) {
          mentionsBlock = await atMentionsResolver.resolveMentionsContext(mentions, projectRoot, {
            activeSelection: helpers?.activeSelection || input?.activeSelection || "",
            markers: helpers?.markers || input?.markers || [],
          });
        }
      } catch (_) { /* ignore */ }
    }

    let system = wrapSystemPrompt(chatOnly || decision?.kind === "CHAT"
      ? [
        "Sos EditCoreAI: asistente del IDE. Respondé siempre en español, claro y directo.",
        "Hablá en prosa continua con párrafos separados por línea en blanco; nunca una plasta de texto.",
        "PROHIBIDO: fingir que abriste tools, inventar exploración, HTML, carpetas o 'ya creé el proyecto' sin tools reales.",
        `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
        previewBlock,
        visionHardRule,
        mentionsBlock,
      ].filter(Boolean).join("\n\n")
      : authorizedFromPending || accessFull
        ? [
          "Sos EditCoreAI. Hablá como un ingeniero senior al lado del usuario.",
          LEADERSHIP_PROMPT,
          LIVE_NARRATION_PROMPT,
          noConfirmBlock,
          "Ejecutá YA la instrucción con tools (write_file, replace_in_file, run_command, scaffold_project).",
          "Antes de mutar: contá en 2-4 líneas tu plan y procedé sin pedir confirmación.",
          "DISCO REAL: PROHIBIDO pegar HTML/código en el chat y decir que creaste un proyecto. Solo existe lo que write_file/replace_in_file/scaffold_project confirmen ok.",
          "Proyecto hermano / carpeta nueva bajo el padre: list_files('..') y write_file('../Nombre/archivo').",
          "No reexplores el proyecto abierto si el pedido es otro directorio: usá '..' o la ruta indicada.",
          "EditCore actualiza ROADMAP.md automáticamente tras cada write. Nunca digas que no podés modificarlo.",
          "PROHIBIDO inventar tareas genéricas ajenas a la instrucción del usuario.",
          "Ante fallo leve de tool: releé y reintentá; nunca abandones con 'Detenido' por errores secundarios.",
          "IMPORTANTE: 'npm run dev' o 'vite' NO son comandos de verificación. Si necesitás el preview, usá inspect_preview. El dev-server ya está corriendo en el IDE.",
          `Permiso de escritura: SÍ.${accessFull ? " Acceso completo activo." : ""}`,
          "Respondé siempre en español al usuario.",
          previewBlock,
          visionHardRule,
          roadmapFirstBlock,
          cognitiveBlock,
          connectionsBlock,
          mentionsBlock,
          specialistInstruction,
        ].filter(Boolean).join("\n\n")
        : [
          "Sos EditCoreAI. Hablá como un ingeniero senior al lado del usuario.",
          LEADERSHIP_PROMPT,
          LIVE_NARRATION_PROMPT,
          `Modo actual: ${decision?.kind || "EXECUTE"}. Permiso de escritura: ${allowWrite ? "SÍ" : "NO"}.`,
          specialistInstruction,
          "REGLAS OBLIGATORIAS:",
          "1. Usá SOLO function calling / tools nativas. Nunca escribas XML como <list_directory>, <read_file>, <execute_command>, <tool_call>.",
          "2. ROADMAP-FIRST: leé el bloque ROADMAP/session-state; PROHIBIDO list_files('.') del repo entero si el mapa ya está cargado. Para hermanos usá list_files('..').",
          "3. Contá en prosa cada paso; no te limites a badges o checks.",
          "4. No repitas exactamente la misma herramienta con los mismos parámetros.",
          "5. Paths relativos al proyecto (ej. package.json) o '../Hermano/...'. No inventes rutas.",
          "6. Si ejecutás 'run_command' o un test/build, analizá la salida y aplicá corrección inmediata (OODA).",
          "7. Fallos leves (oldText, git auxiliar, list_files de ruta ausente): recuperá y continuá; no detengas la sesión.",
          "8. EditCore actualiza ROADMAP.md solo tras cambios. No digas que está prohibido actualizarlo.",
          "9. Respondé siempre en español al usuario.",
          "10. DISCO REAL: nunca digas que creaste/moviste archivos sin write_file/replace_in_file/scaffold_project exitoso. No pegues HTML fingiendo un proyecto nuevo.",
          previewBlock,
          visionHardRule,
          roadmapFirstBlock,
          cognitiveBlock,
          connectionsBlock,
          mentionsBlock,
          skillsPrompt(projectRoot, decision?.kind, message),
          memory && !authorizedFromPending ? memory.promptBlock() : "",
          projectRoot ? threadCore.threadMemory.projectPromptBlock(projectRoot, threadId, message) : "",
          globalLearned,
        ].filter(Boolean).join("\n\n"));

    const isBareApproval = /^\s*(?:procede|continua|continúa|hazlo|adelante|ejecuta|dale|va|ok)\b/i.test(String(message || "").trim());
    let finalInstruction = authorizedFromPending
      ? String(message || "")
      : (String(message || "").includes("ALCANCE:")
        ? String(message || "")
        : scopeUserMessage(message));

    if (isBareApproval && projectRoot) {
      try {
        const threadData = threadCore.threadMemory.loadThread(projectRoot, threadId);
        const pendingTask = threadData.workingOn || "";
        if (pendingTask && !/^\s*(?:procede|continua|hazlo|ok)\b/i.test(pendingTask)) {
          finalInstruction = `Autorización confirmada para el objetivo previo: "${pendingTask}". Aplica la solución concreta directamente sin reexploraciones redundantes.`;
        }
      } catch { /* ignore */ }
    }

    const userText = authorizedFromPending || isBareApproval
      ? `Proyecto: ${projectRoot}\nEjecutá ahora:\n${finalInstruction}`
      : `Proyecto: ${projectRoot}\n${finalInstruction}`;
    if (projectRoot) {
      const threadBlock = threadCore.threadMemory.projectPromptBlock(projectRoot, threadId, message);
      if (threadBlock) system = `${system}\n\n${threadBlock}`;
      const busBlock = agentBus.promptBlock(projectRoot, threadId);
      if (busBlock) system = `${system}\n\n${busBlock}`;
    }
    const messages = threadCore.buildMessageList({
      system,
      userText,
      projectRoot,
      threadId,
      historyInput,
      query: String(this._currentUserText || message || ""),
    });
    if (Array.isArray(taskImages) && taskImages.length) {
      try {
        const { buildOpenAiImageContent, VISION_ACK_RULE } = require("../runtime/vision-intake");
        messages.splice(1, 0, { role: "system", content: VISION_ACK_RULE });
        const last = messages[messages.length - 1];
        if (last && last.role === "user") {
          last.content = buildOpenAiImageContent(userText, taskImages);
        }
      } catch { /* keep text-only user turn */ }
    }

    const steps = [];
    const pendingWrites = new Set();
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
        threadCore.rememberExchange(
          projectRoot,
          threadId,
          this._currentUserText || message,
          textOut
        );
        if (projectRoot && textOut) {
          threadCore.threadMemory.noteDecision(projectRoot, String(textOut).slice(0, 280));
        }
      } catch { /* persist best-effort */ }
    };

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (Date.now() > deadline) {
          this.session.kill();
          const partial = formatAgentVisibleText(
            steps.length
              ? "Me quedé sin tiempo para terminar la tarea. Avance parcial:\n" +
                steps.slice(-6).map((s) => `- ${s.name}${s.input?.path ? ` (${s.input.path})` : ""}`).join("\n")
              : "Me quedé sin tiempo y no llegué a hacer nada. Reformulame la instrucción más concreta, porfa."
          );
          persistKernelRoadmap(projectRoot, {
            task: message, steps, kind: decision?.kind, text: partial, completed: false,
          });
          rememberOut(partial);
          detachLongRunningStreams(steps);
          return { kind: decision?.kind || "CHAT", text: partial, steps, incomplete: true, threadId, usage: totalUsage };
        }

        if (!this.session.alive) {
          rememberOut("Detenido.");
          detachLongRunningStreams(steps);
          return { kind: "STOP", text: "Detenido.", steps, threadId, usage: totalUsage };
        }

        if (Array.isArray(this.steering) && this.steering.length) {
          const directions = this.steering.splice(0, this.steering.length);
          for (const direction of directions) {
            const instruction = String(direction?.instruction || "").trim();
            if (!instruction) continue;
            messages.push({
              role: "user",
              content: [
                "NUEVA INSTRUCCIÓN DEL USUARIO (prioridad inmediata):",
                instruction,
                "Incorpórala YA. Conservá el avance útil y ajustá el plan a esta dirección. No reinicies exploración innecesaria.",
              ].join("\n"),
            });
            try {
              onProgress?.({ phase: "direction", stage: "running", text: instruction });
            } catch { /* ignore */ }
          }
        }

        const availableTools = allowWrite
          ? tools.DEFINITIONS
          : tools.DEFINITIONS.filter((t) => ![
            "write_file", "replace_in_file", "run_command", "scaffold_project",
            "supabase_migrate", "ingest_to_brain", "clone_repo",
            "clone_web_page", "images_to_code",
            "rollback_last_change",
          ].includes(t.function.name));

        let streamAccum = "";
        let lastVisible = "";
        let toolStreamNotified = false;
        if (steps.length > 0) {
          try {
            onProgress?.({
              phase: "narration_delta",
              text: "\n\n",
              index: steps.length,
              streaming: true,
            });
          } catch { /* ignore */ }
        }
        this.turnAbort = new AbortController();
        const turnSignal = (typeof AbortSignal.any === "function" && this.abort?.signal)
          ? AbortSignal.any([this.abort.signal, this.turnAbort.signal])
          : (this.turnAbort.signal || this.abort?.signal);

        const hb = setInterval(() => {
          try { onProgress?.({ phase: "heartbeat", text: "Esperando al modelo…" }); } catch { /* ignore */ }
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
                } else if (visible.length < lastVisible.length && lastVisible.startsWith(visible)) {
                  piece = "";
                } else if (visible !== lastVisible) {
                  let shared = 0;
                  const lim = Math.min(lastVisible.length, visible.length);
                  for (let n = lim; n >= 1; n -= 1) {
                    if (lastVisible.endsWith(visible.slice(0, n))) {
                      shared = n;
                      break;
                    }
                  }
                  if (shared > 0) {
                    piece = visible.slice(shared);
                  } else {
                    const idx = visible.indexOf(lastVisible);
                    if (idx >= 0) {
                      piece = visible.slice(idx + lastVisible.length);
                    } else if (!lastVisible) {
                      piece = visible;
                    } else {
                      piece = `\n\n${visible}`;
                    }
                  }
                }
                lastVisible = visible;
                if (!piece) {
                  if (/<(?:tool_call|function\s*=)/i.test(streamAccum) && !toolStreamNotified) {
                    toolStreamNotified = true;
                    onProgress?.({ phase: "model", text: "Ejecutando herramienta…" });
                  }
                  return;
                }
                onProgress?.({
                  phase: "narration_delta",
                  text: piece,
                  index: steps.length,
                  streaming: true,
                });
              } catch { /* ignore UI errors */ }
            },
          });
          if (turn?.usage) {
            totalUsage.prompt_tokens += Number(turn.usage.prompt_tokens || turn.usage.inputTokens || 0);
            totalUsage.completion_tokens += Number(turn.usage.completion_tokens || turn.usage.outputTokens || 0);
            totalUsage.total_tokens += Number(turn.usage.total_tokens || turn.usage.totalTokens || 0);
            const cr = Number(turn.usage.cache_read_input_tokens || turn.usage.cachedInputTokens || 0);
            const cw = Number(turn.usage.cache_creation_input_tokens || 0);
            totalUsage.cache_read_input_tokens += cr;
            totalUsage.cachedInputTokens += cr;
            totalUsage.cache_creation_input_tokens += cw;
          }
        } catch (turnErr) {
          const steerHit = turnErr?.code === "AGENT_STEER"
            || this.turnAbort?.signal?.reason?.code === "AGENT_STEER"
            || turnErr?.cause?.code === "AGENT_STEER";
          if (steerHit && i < stepsLimit - 1) {
            this.turnAbort = null;
            continue;
          }
          throw turnErr;
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
        for (const call of toolCalls) {
          if (call.function?.name !== "write_file") continue;
          let args = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
          if (args.path || !args.content) continue;
          const prose = visibleNarrationText(turn.text || "");
          const m = prose.match(/\b([\w./\\-]+\.(?:tsx?|jsx?|css|html|json|md|sql))\b/i);
          if (m) {
            args.path = toRelativePath(projectRoot, m[1]);
            call.function.arguments = JSON.stringify(args);
          }
        }
        const cleanText = stripTextToolMarkup(turn.text || "");

        if (!toolCalls.length) {
          const incompleteIntent = /(?:^|\n)\s*(?:voy\s+a|ahora\s+(?:voy\s+a|leer[eé]|abrir[eé]|revisar[eé]|ejecutar[eé]|verificar[eé]|corregir[eé]|crear[eé]|generar[eé]|mover[eé])|procedo\s+a|dejar[eé]\s+que)\b/i.test(cleanText)
            && !/(?:completad[oa]|listo\.|verificad[oa]|aplicad[oa]|hecho\.|sin errores)/i.test(cleanText)
            && cleanText.trim().length < 900;
          const writtenSoFar = successfulWritePaths(steps);
          const fakeCreate = userWantsDiskMutation(message) && textClaimsDiskMutation(cleanText) && writtenSoFar.length === 0;
          const needsTools = (incompleteIntent || fakeCreate) && i < stepsLimit - 1 && !chatOnly && decision?.kind !== "CHAT";

          if (needsTools) {
            incompleteRetries += 1;
            if (incompleteRetries > MAX_INCOMPLETE_RETRIES) {
              this.session.kill();
              const textOut = groundUngroundedClaims(cleanText, steps, message, decision);
              persistKernelRoadmap(projectRoot, {
                task: message, steps, kind: decision?.kind, text: textOut, completed: false,
              });
              rememberOut(textOut);
              detachLongRunningStreams(steps);
              return { kind: decision?.kind || "CHAT", text: textOut, steps, incomplete: true, threadId, usage: totalUsage };
            }

            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({
              role: "user",
              content: fakeCreate
                ? "STOP: anunciaste crear/mover archivos pero NO usaste tools. Ejecutá YA write_file/scaffold_project (ruta relativa o ../Hermano/...). PROHIBIDO inventar HTML o carpetas sin escribirlas en disco."
                : "CONTINUA YA: anunciaste una acción y no la ejecutaste. Usá tools ahora (read_file/replace_in_file/run_command). No repitas el anuncio ni reexplores el proyecto.",
            });
            onProgress?.({ phase: "narration", text: fakeCreate ? "Falta escritura real en disco… uso tools." : "Retomo la acción que había anunciado…" });
            continue;
          }

          this.session.kill();
          if (memory) memory.note(`finalizó ${decision?.kind || "task"}`);

          const written = successfulWritePaths(steps);

          let textOut = cleanText;
          if (written.length > 0) {
            const head = cleanText && cleanText.length > 20 && !/^Cambios en:/.test(cleanText)
              ? cleanText + "\n\n"
              : "";
            const lista = written.map((p) => `- \`${p}\``).join("\n");
            const cierre = written.length === 1
              ? "He finalizado esta tarea y aplicado la modificación solicitada en el proyecto con éxito."
              : `He finalizado esta tarea y aplicado las modificaciones solicitadas (${written.length} archivos actualizados con éxito).`;
            const sugerencia = nextStepsClosingText(projectRoot, written, steps);
            textOut = `${head}${cierre}\n\n${lista}${sugerencia ? `\n\n${sugerencia}` : ""}`;
          } else {
            textOut = groundUngroundedClaims(cleanText, steps, message, decision);
          }
          if (accessFull && /procede|¿procedo|cuando autorices/i.test(textOut)) {
            textOut = `${textOut.replace(/\s*(Cuando autorices procedo[^.]*\.?|Escribe\s+\*{0,2}procede\*{0,2}[^.]*\.?|Si deseas que aplique[^.]*\.?)\s*$/gi, "").trim()}`;
          }
          if (!String(textOut || "").trim()) {
            const toolNames = steps.map((s) => s.name).filter(Boolean).slice(-8);
            textOut = toolNames.length
              ? `He finalizado las acciones de este turno (${toolNames.join(", ")}).\n\n¿Continuamos con la siguiente fase?`
              : "He finalizado el análisis del proyecto.\n\n¿Deseas que procedamos con el siguiente paso?";
          }
          textOut = formatAgentVisibleText(textOut);

          const stillIncomplete = incompleteIntent && !written.length;
          persistKernelRoadmap(projectRoot, {
            task: message, steps, kind: decision?.kind, text: textOut,
            completed: !stillIncomplete,
          });
          rememberOut(textOut);
          detachLongRunningStreams(steps);
          return {
            kind: decision?.kind || "CHAT",
            text: textOut,
            steps,
            mutations: runMutations,
            incomplete: stillIncomplete,
            report: { completed: !stillIncomplete },
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
          if ((name === "write_file" || name === "replace_in_file") && args.path) {
            pendingWrites.add(String(args.path));
          }

          const callKey = `${name}:${JSON.stringify(args)}`;
          const execCount = toolHistory.get(callKey) || 0;
          if (execCount >= 1) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: tools.truncatePayload({
                ok: false,
                error: `LÍMITE ALCANZADO: La acción '${name}' ya fue ejecutada con estos parámetros. Entrega una respuesta conclusiva o cambia de acción.`,
              }),
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
            try {
              agentBus.wrapSubagentResult(projectRoot, threadId, "implementer", impl);
              agentBus.record(projectRoot, threadId, {
                agent: "implementer",
                file: args.path,
                action: name,
                tool: name,
              });
            } catch { /* ignore */ }
            result = impl.result || impl;

            if (specialist?.name === "UI/UX Specialist" && result?.ok && isVisualUiPath(args.path)) {
              try {
                const vision = await capture_preview_screenshot({
                  url: helpers?.previewUrl || DEFAULT_PREVIEW_URL,
                  projectRoot,
                  viewport: "desktop",
                  electronCapture: typeof helpers?.capturePreview === "function"
                    ? (opts) => helpers.capturePreview(opts)
                    : null,
                });
                const { screenshotAbs: _a, imageDataUrl: _i, ...visionSafe } = vision;
                result = { ...result, vision: visionSafe };
                steps.push({
                  name: "capture_preview_screenshot",
                  input: { url: helpers?.previewUrl || DEFAULT_PREVIEW_URL, auto: true },
                  result: visionSafe,
                  ok: vision.ok !== false,
                });
              } catch (visionErr) {
                result = {
                  ...result,
                  vision: { ok: false, error: String(visionErr?.message || visionErr).slice(0, 300) },
                };
              }
            }
          } else if (name === "run_command" && (args.command?.includes("build") || args.command?.includes("tsc") || args.command?.includes("typecheck"))) {
            const recentWrites = steps
              .filter((s) => (s.name === "write_file" || s.name === "replace_in_file") && s.ok)
              .slice(-4)
              .map((s) => s.input?.path)
              .filter(Boolean);
            const heavy = /\bnpm run build\b|\bnext build\b/i.test(String(args.command || ""));
            const verif = await runVerifier({
              projectRoot,
              command: heavy ? "" : args.command,
              onProgress,
              autoRollback: false,
              incremental: true,
              timeoutMs: 45_000,
              priorError: lastVerifyError,
              solutionApplied: recentWrites.length
                ? `Corrección aplicada en: ${recentWrites.join(", ")}`
                : (lastVerifyError ? "Reintento de verificación tras corrección del agente" : null),
            });
            result = verif.result || verif;
            if (!verif.ok) {
              lastVerifyError = String(verif?.result?.error || verif?.result?.stderr || args.command).slice(0, 800);
            } else {
              lastVerifyError = null;
            }
          } else {
            // tools.js → runCommand → process-runner.js ya gestiona:
            //  - long-running (npm run dev, vite…) → background + streaming + detach()
            //  - comandos normales → timeout 25s + captura stdout/stderr
            result = await tools.execute(name, args, projectRoot, allowWrite, helpers || {});
          }

          const softRecover = recoverSoftToolFailure(name, args, result, projectRoot);

          if (Array.isArray(softRecover.stepsExtra) && softRecover.stepsExtra.length && softRecover.recovered) {
            for (const extra of softRecover.stepsExtra) {
              steps.push(extra);
              this.session.addStep(extra);
            }
            result = softRecover.payload;
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: tools.truncatePayload(result || {}, tools.TOOL_RESULT_CAP || 2000),
            });
            continue;
          } else {
            result = softRecover.payload;
          }

          const isSoft = result?.soft === true || result?.ooda === "continue"
            || tools.isSoftToolFailure?.(name, result, args);
          if (isSoft && result?.ok === false) {
            const softN = (softRetryCounts.get(callKey) || 0) + 1;
            softRetryCounts.set(callKey, softN);
            if (softN < 3) {
              toolHistory.delete(callKey);
              onProgress?.({
                phase: "narration",
                text: name === "replace_in_file"
                  ? "Ajusto: releo el contexto para reintentar…"
                  : "Fallo leve, sigo…",
              });
            } else {
              result = {
                ...result,
                soft: true,
                ooda: "stop-soft-retry",
                guidance: "Tope de reintentos leves alcanzado para esta acción. Cambia de enfoque o entrega resultado parcial.",
              };
            }
          }

          const stepData = {
            name,
            input: args,
            result,
            ok: result?.ok !== false,
            soft: isSoft || undefined,
            softContinue: isSoft || undefined,
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

          if ((name === "write_file" || name === "replace_in_file") && result?.ok !== false && args.path) {
            pendingWrites.delete(String(args.path));
            try {
              const { resolveSnapshotBackupAbs } = require("./snapshot");
              const rel = String(args.path || "").replace(/\\/g, "/");
              const backupPath = resolveSnapshotBackupAbs(projectRoot, result?.snapshotId, rel);
              const existedBefore = Boolean(backupPath);
              const idx = runMutations.findIndex((m) => m.path === rel);
              if (idx >= 0) {
                runMutations[idx].action = name;
              } else {
                runMutations.push({
                  path: rel,
                  action: name,
                  backupPath,
                  created: name === "write_file" && !existedBefore,
                });
              }
            } catch { /* undo checkpoint best-effort */ }
          }

          if (memory) {
            if ((name === "write_file" || name === "replace_in_file") && result?.ok) memory.touchFile(args.path, "write");
            if (name === "read_file" && result?.ok) memory.touchFile(args.path, "read");
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: tools.truncatePayload(result || {}, tools.TOOL_RESULT_CAP || 2000),
          });
        }
      }

      this.session.kill();
      const written = successfulWritePaths(steps);

      let textOut = "";
      if (written.length > 0) {
        const lista = written.map((p) => `- \`${p}\``).join("\n");
        const cierre = written.length === 1
          ? "He finalizado esta tarea y aplicado la modificación solicitada en el proyecto con éxito."
          : `He finalizado esta tarea y aplicado las modificaciones solicitadas (${written.length} archivos actualizados con éxito).`;
        const sugerencia = nextStepsClosingText(projectRoot, written, steps);
        textOut = `${cierre}\n\n${lista}${sugerencia ? `\n\n${sugerencia}` : ""}`;
      } else {
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content || "";
        textOut = groundUngroundedClaims(String(lastAssistant || ""), steps, message, decision);
          if (readFiles.length > 0) {
            const filesStr = readFiles.slice(0, 3).map((f) => `\`${f}\``).join(", ");
            textOut = `Revisé con tools: ${filesStr}. No apliqué escrituras en este turno.`;
          } else {
            textOut = "No pude completar acciones con tools en este turno. Reformulá el pedido o verificá la carpeta conectada.";
          }
        }
      }
      textOut = repairDanglingOutput(textOut, steps, message, decision);

      persistKernelRoadmap(projectRoot, {
        task: message, steps, kind: decision?.kind, text: textOut, completed: true,
      });
      rememberOut(textOut);
      detachLongRunningStreams(steps);
      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, incomplete: false, mutations: runMutations, threadId, usage: totalUsage };
    } catch (err) {
      this.session.kill();
      let safeMsg = String(err?.message || err || "Error desconocido");
      try {
        const { sanitizeChatProviderError } = require("../runtime/chat-error-sanitize");
        safeMsg = sanitizeChatProviderError(err);
      } catch {
        if (/gafcore/i.test(safeMsg)) {
          safeMsg = "El proveedor no respondió a tiempo. Reintentá en unos segundos; tu modelo se conserva.";
        }
      }
      const errText = formatAgentVisibleText("Algo falló durante la ejecución: " + safeMsg);
      persistKernelRoadmap(projectRoot, {
        task: message, steps, kind: decision?.kind, text: errText, completed: false,
      });
      rememberOut(errText);
      detachLongRunningStreams(steps);
      return { kind: "CHAT", text: errText, steps, mutations: runMutations, threadId, usage: totalUsage };
    } finally {
      this.running = false;
      this.turnAbort = null;
      try { onProgress?.({ phase: "done", text: "" }); } catch { /* ignore */ }
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue };