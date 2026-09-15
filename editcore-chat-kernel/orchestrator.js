"use strict";

const { classify, extractListTarget, isFullAccess } = require("./classify");
const { ChatSession } = require("./session");
const { PersistentMemory } = require("./memory");
const { skillsPrompt, SKILL_IDS } = require("./skills-catalog");
const { runExplorer } = require("./subagents/explorer");
const { runAnalyst } = require("./subagents/analyst");
const { runImplementer } = require("./subagents/implementer");
const { runVerifier } = require("./subagents/verifier");
const { dispatchSpecialist } = require("./subagents/dispatcher");
const { parseTextToolCalls, stripTextToolMarkup, toRelativePath, visibleNarrationText } = require("./parse-text-tools");
const tools = require("./tools");
const { callChat } = require("./provider");
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
const globalMemory = require("./global-memory");
const taskQueue = require("./task-queue");

let intentOrchestrator = null;
try {
  intentOrchestrator = require("../runtime/intent-orchestrator");
} catch (_) {
  try {
    intentOrchestrator = require("./intent-orchestrator");
  } catch (e) {
    intentOrchestrator = null;
  }
}

let projectMapApi = null;
try {
  projectMapApi = require("../runtime/project-map");
} catch (_) {
  projectMapApi = null;
}

/** Límite útil para ciclos Lectura → Modificación → Verificación (OODA). */
const DEFAULT_MAX_STEPS = 28;
const AUTHORIZED_MAX_STEPS = 32;

const LEADERSHIP_PROMPT = [
  "ROL: GUÍA LÍDER (inversión del control) — pero SIEMPRE subordinado al alcance de la petición.",
  "Ante objetivos de alto nivel o solicitudes generales:",
  "1) Genera tu propia hoja de ruta de 3 a 5 pasos concretos (basada en el mapa cognitivo real).",
  "2) Informa al usuario en 2-4 líneas qué vas a hacer (sin pedir permiso ni esperar confirmación si ya hay autorización, Acceso completo, o la tarea es exploratoria/análisis).",
  "3) Ejecuta paso a paso de forma autónoma con tools: Observar → Orientar → Decidir → Actuar.",
  "4) No te detengas por fallos leves (oldText desfasado, git auxiliar, carpetas inexistentes): relee contexto cercano y reintenta.",
  "5) Al TERMINAR: responde el resultado de LO PEDIDO. Solo ofrece siguientes pasos si el usuario pidió un plan o un análisis amplio.",
  "PROHIBIDO inventar carpetas típicas (src/, app/, lib/) si no aparecen en el MAPA COGNITIVO.",
  "PROHIBIDO devolver solo un plan vacío sin ejecutar tools cuando el modo permite herramientas.",
  "PROHIBIDO ampliar una pregunta puntual a un análisis total del proyecto.",
  "Con Acceso completo: PROHIBIDO pedir PROCEDE/¿Procedo? durante la tarea pedida.",
].join("\n");

/** Narración continua en el stream (estilo Cursor) — obligatoria en cada turno con tools. */
const LIVE_NARRATION_PROMPT = [
  "NARRACIÓN EN VIVO (OBLIGATORIO — el usuario lee tu texto token a token):",
  "- PROHIBIDO callar y solo devolver tools, un checkmark, \"Done\", \"Listo\" o un resumen corto al final.",
  "- ANTES de cada tool: 1-3 oraciones en prosa (qué vas a leer/buscar/cambiar y por qué).",
  "- DURANTE: si razonas, escríbelo en el chat; no lo escondas.",
  "- DESPUÉS de cada tool: di qué encontraste o qué cambiaste en 1-2 frases concretas.",
  "- Escribe como conversación continua; el UI muestra tu texto en tiempo real.",
  "- No uses solo badges/checks: el cuerpo del mensaje debe ser prosa legible.",
  "- PÁRRAFOS: separa ideas con línea en blanco (\\n\\n). PROHIBIDO una sola plasta de texto sin saltos.",
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

function nextStepsClosingText({ fullAccess = false, wroteFiles = false } = {}) {
  if (wroteFiles) {
    return fullAccess
      ? "\n\nCambios aplicados con Acceso completo."
      : "";
  }
  // Acceso completo / ejecución directa: NUNCA pedir PROCEDE.
  if (fullAccess) {
    return "\n\nAcceso completo activo: las correcciones comprobables se aplican sin pedir PROCEDE.";
  }
  return "";
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

/** ROADMAP + session-state inyectados al prompt (ahorro de tokens). */
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
    "ROADMAP-FIRST (OBLIGATORIO — ahorro de tokens, se evalúa como incumplimiento):",
    "1) El ROADMAP y session-state YA están arriba (incluye ## Proceso, ## Bloqueos, ## Tarea activa, ## Mapa). NO ejecutes list_files('.') ni project_discovery ni codebase_map del repo entero si el mapa cubre la tarea.",
    "2) Lee primero ## Proceso (fase/stack/preview) y ## Bloqueos / bugs conocidos: es la memoria del estado del proyecto entre mensajes.",
    "3) Prohibido re-listar o re-leer archivos que ya aparezcan en ## Mapa o ## Archivos clave salvo que el usuario pida explícitamente 'léelo ahora'.",
    "4) Para agregar/modificar: read_file SOLO de los archivos concretos que vas a tocar. Máximo 1 lectura por archivo.",
    "5) Si el ROADMAP está vacío o parece stub y crees que hace falta explorar, primero di en 1-2 frases qué falta y por qué; luego haz UNA sola llamada a list_files('.') — nunca dos seguidas.",
    "6) Tras write_file/replace_in_file, EditCore actualiza ROADMAP.md por ti (Proceso+Cambios+Bloqueos). NO lo reescribas a mano.",
    "7) Prohibido re-leer un archivo que ya leíste en este mismo turno. Si necesitas más contexto, usa search_files acotado o symbol_search.",
    "8) Si el usuario pide algo simple y el ROADMAP ya dice dónde está: ve DIRECTO al archivo. No explores.",
  ].join("\n"));
  return parts.filter(Boolean).join("\n\n").slice(0, 7_500);
}

/**
 * Auto-corrección transparente OODA ante fallo leve de herramienta.
 * Devuelve payload enriquecido para el modelo (sin detener la sesión).
 */
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

function formatToolActionNarration(name, args = {}) {
  const rel = String(args.path || "").replace(/\\/g, "/");
  const file = rel.split("/").filter(Boolean).pop() || rel;
  if (name === "write_file") return file ? `Creando ${file}…` : "Creando archivo…";
  if (name === "replace_in_file") return file ? `Editando ${file}…` : "Editando archivo…";
  if (name === "read_file") return file ? `Leyendo ${file}…` : "Leyendo archivo…";
  if (name === "run_command") return "Verificando cambios…";
  if (name === "list_files") return "Explorando el proyecto…";
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

/**
 * Antes había un router que sustituía sonnet→haiku etc. Eso rompía MEAI
 * ("modelo no permitido"). Se conserva el modelo seleccionado por el usuario.
 */
function pickModelForKind(_kind, currentModel) {
  return currentModel;
}

const APPROVAL_WORDS = new Set([
  "procede", "procedo", "adelante", "hazlo", "autorizado",
  "continua", "continúa", "ejecuta", "si", "sí", "ok", "dale", "va",
]);

/**
 * Sincroniza ROADMAP.md con el resumen de la corrida del kernel.
 * Se llama al cerrar cada turno (éxito, temprano o error) para que la
 * siguiente corrida lea un ROADMAP fresco y evite re-explorar el proyecto.
 */
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

class ChatOrchestrator {
  constructor() {
    this.session = new ChatSession();
    this.abort = null;
    this.pendingTask = null;
  }

  stop() {
    if (this.abort) {
      try { this.abort.abort(); } catch (_) { /* ignore */ }
    }
    this.session.kill();
    this.pendingTask = null;
    try { taskQueue.cancelAll(); } catch (_) { /* ignore */ }
    return { kind: "STOP", text: "Ejecución cancelada. Tareas pendientes limpiadas. ¿Qué deseas hacer ahora?" };
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
        `⚡ Tarea [${taskId}] iniciada en segundo plano (${decision.label || decision.kind}).`,
        `Puedes seguir dando instrucciones mientras el subagente trabaja.`,
        `Te avisaré en el panel cuando termine.`,
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
    } = input;

    const rawText = typeof message === "object" && message?.text ? message.text : String(message || "");
    const taskImages = Array.isArray(images) ? images.filter(Boolean) : [];
    const hasImages = taskImages.length > 0;
    const text = rawText.trim() || (hasImages ? "Analiza la imagen adjunta." : "");
    const textLower = text.toLowerCase();
    const isApprovalText = APPROVAL_WORDS.has(textLower);
    const visionAsk = hasImages && /\b(?:imagen|foto|captura|screenshot|adjunt|overlay|error\s+visible|analiza\s+(?:esto|la|el))\b/i.test(text);

    const fullAccess = isFullAccess({
      allowWrite: inputAllowWrite,
      permissionMode,
      permissionFull,
      fullAccess: inputFullAccess,
      planAuthorizedExecution: inputPlanAuth,
      mode: permissionMode,
    }) || String(permissionMode || "").toLowerCase() === "full";

    // Acceso completo: anular pendingTask / CONFIRM — ejecutar directo
    if (fullAccess) {
      this.pendingTask = null;
    }

    if (!fullAccess && this.pendingTask && isApprovalText) {
      const taskToRun = this.pendingTask;
      this.pendingTask = null;
      onProgress?.({ phase: "start", text: "Autorización confirmada. Ejecutando cambios en disco..." });
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
        fullAccess: false,
        permissionMode,
      });
    }

    let decision = classify(text, {
      allowWrite: fullAccess || inputAllowWrite === true,
      permissionMode: fullAccess ? "full" : permissionMode,
      fullAccess,
    });

    if (fullAccess) {
      decision.allowWrite = true;
      if (decision.kind === "CONFIRM") {
        decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      }
      if (decision.kind === "CHAT" && /\b(?:crea|modifica|corrige|implementa|refactoriza|actualiza|audita|arregla|repara|escribe|agrega|añade|cambia)\b/i.test(text)) {
        decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      }
    }

    // Imagen adjunta: NUNCA degradar a ANALYZE ciego (el analyst de archivos no ve la foto).
    // Ruta vision-first → runModelTask con multimodal + tools.
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
      if (intentOrchestrator?.resolveUnifiedAgentPlan) {
        unifiedPlan = intentOrchestrator.resolveUnifiedAgentPlan({
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
          text: "No hay ninguna acción pendiente por autorizar. Dime qué archivo o cambio necesitas.",
        };
      }
      const taskToRun = this.pendingTask;
      this.pendingTask = null;
      onProgress?.({ phase: "start", text: "Autorización confirmada. Procesando modificaciones..." });
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
      return { kind: "CHAT", text: "Por favor, abre un proyecto primero antes de ejecutar acciones en disco." };
    }

    const memory = projectRoot ? new PersistentMemory(projectRoot) : null;
    if (memory) memory.load();

    if (autoHeal?.summary) {
      onProgress?.({ phase: "subagent", name: "auto-heal", text: autoHeal.summary });
      if (!apiKey) {
        return { kind: "CHAT", text: `Error de preview:\n${autoHeal.summary}\n\nConfigura API key para auto-corregir.` };
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
          text: "EDITCOREAI es un IDE con agente autónomo para crear, editar y verificar proyectos. Abre un proyecto y pide un cambio concreto, o escribe *ayuda*.",
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
        onProgress?.({ phase: "start", text: "Analizando imagen adjunta…" });
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
          extra: { target: extractListTarget(text, projectRoot) || "." },
        });
      }
      const target = extractListTarget(text, projectRoot) || ".";
      this.session.start(decision.kind, projectRoot);
      const out = await runExplorer({ projectRoot, target, onProgress });
      this.session.kill();
      if (memory) memory.note(`listó ${out.target || target}`);

      // Pasar datos al modelo para que la respuesta sea interactiva y coherente
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
        onProgress?.({ phase: "start", text: "Analizando imagen adjunta…" });
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
          decision, message: text, projectRoot, onProgress, extra: { maxReads: 8 },
        });
      }
      this.session.start("ANALYZE", projectRoot);
      const scope = requestScopePolicy?.classifyRequestScope?.(text) || "focused";
      const maxReads = scope === "broad" ? 16 : scope === "action" ? 10 : 6;
      onProgress?.({ phase: "start", text: scope === "broad" ? "Análisis amplio del proyecto…" : "Revisando lo necesario para tu pregunta…" });
      const out = await runAnalyst({ projectRoot, onProgress, maxReads, userMessage: text });
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
        return this.enqueueBackgroundTask({ decision, message: text, projectRoot, onProgress });
      }
      this.session.start("VERIFY", projectRoot);
      const out = await runVerifier({ projectRoot, onProgress, timeoutMs: 60_000 });
      this.session.kill();
      return {
        kind: "VERIFY",
        text: out?.ok
          ? "Verificación OK."
          : `Verificación falló: ${String(out?.result?.error || out?.result?.stderr || "").slice(0, 600)}`,
        steps: out?.steps || [],
      };
    }

    const wantsWrite = fullAccess
      || decision.allowWrite
      || unifiedPlan?.mode === intentOrchestrator?.MODES?.EXECUTE
      || unifiedPlan?.planAuthorizedExecution === true;

    if (wantsWrite) {
      if (!apiKey) return { kind: "CHAT", text: "Falta API key para ejecutar modificaciones." };

      onProgress?.({
        phase: "start",
        text: fullAccess
          ? "Acceso completo: ejecutando sin confirmación…"
          : "Ejecutando modificaciones directamente...",
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

    return { kind: "CHAT", text: "Instrucción no reconocida. Especifica qué deseas analizar, listar o corregir." };
  }

  async runModelTask(opts) {
    const {
      decision, message, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
      allowWrite, maxSteps, helpers, chatOnly, authorizedFromPending,
      fullAccess, permissionMode, images: taskImages = [],
    } = opts;

    const accessFull = fullAccess === true
      || isFullAccess({ allowWrite, permissionMode, fullAccess, planAuthorizedExecution: authorizedFromPending });

    this.session.start(decision?.kind || "EXECUTE", projectRoot);
    this.abort = new AbortController();

    const toolHistory = new Map();
    const softRetryCounts = new Map();
    let lastVerifyError = null;
    const cognitiveBlock = (!chatOnly && decision?.kind !== "CHAT")
      ? formatCognitiveBlock(projectRoot)
      : "";
    const roadmapFirstBlock = (!chatOnly && decision?.kind !== "CHAT")
      ? buildRoadmapFirstBlock(projectRoot)
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
        "Usa esa URL (o la tool capture_preview_screenshot). PROHIBIDO inventar puertos/URLs (ej. :1420) si el preview ya está publicado.",
      ].join("\n")
      : "Sin URL de preview conocida en este turno. No inventes localhost:puerto; pregunta o usa capture_preview_screenshot.";

    const visionHardRule = (Array.isArray(taskImages) && taskImages.length)
      ? [
        `VISION: Hay ${taskImages.length} imagen(es) adjunta(s) en este mensaje multimodal.`,
        "PROHIBIDO decir que no hay imagen, que no la ves, o pedir que el usuario la suba otra vez.",
        "Analiza el contenido visual en la PRIMERA respuesta (errores Vite/overlay, UI, texto legible).",
      ].join("\n")
      : "";

    const noConfirmBlock = (accessFull || authorizedFromPending)
      ? [
        "ACCESO COMPLETO / EJECUCIÓN AUTORIZADA:",
        "PROHIBIDO preguntar: '¿Deseas que proceda?', 'Confirma para aplicar los cambios.', 'Escribe procede.', '¿Procedo?'.",
        "Ejecuta YA tools: write_file, replace_in_file, run_command. Sin preguntas previas.",
      ].join("\n")
      : "";

    const system = wrapSystemPrompt(chatOnly || decision?.kind === "CHAT"
      ? [
        "Eres EDITCOREAI: asistente del IDE. Responde SIEMPRE en español, claro y directo.",
        "Habla en prosa continua con párrafos separados por línea en blanco; nunca una plasta de texto.",
        "PROHIBIDO: fingir que abriste tools o inventar exploración sin haberla hecho.",
        `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
        previewBlock,
        visionHardRule,
      ].filter(Boolean).join("\n\n")
      : authorizedFromPending || accessFull
        ? [
          "Eres EditCore Agent — GUÍA LÍDER autónomo.",
          LEADERSHIP_PROMPT,
          LIVE_NARRATION_PROMPT,
          noConfirmBlock,
          "Ejecuta YA la instrucción con tools (write_file, replace_in_file, run_command).",
          "Antes de mutar: narra en 2-4 líneas tu hoja de ruta (3-5 pasos) y procede sin pedir confirmación.",
          "NO reexplores el proyecto: usa ROADMAP + session-state. Solo read_file de lo que editarás.",
          "EditCore actualiza ROADMAP.md automáticamente tras cada write. NUNCA digas que no puedes modificar ROADMAP.",
          "PROHIBIDO inventar tareas genéricas ajenas a la instrucción del usuario.",
          "Ante fallo leve de tool: relee y reintenta; NUNCA abandones con 'Detenido' por errores secundarios.",
          `Permiso de escritura: SÍ.${accessFull ? " Acceso completo activo." : ""}`,
          "Responde SIEMPRE en español al usuario.",
          previewBlock,
          visionHardRule,
          roadmapFirstBlock,
          cognitiveBlock,
          specialistInstruction,
        ].filter(Boolean).join("\n\n")
        : [
          "Eres EditCore Agent — entorno autónomo y GUÍA LÍDER del IDE.",
          LEADERSHIP_PROMPT,
          LIVE_NARRATION_PROMPT,
          `Modo actual: ${decision?.kind || "EXECUTE"}. Permiso de escritura: ${allowWrite ? "SÍ" : "NO"}.`,
          specialistInstruction,
          "REGLAS OBLIGATORIAS:",
          "1. Usa SOLO function calling / tools nativas. NUNCA escribas XML como <list_directory>, <read_file>, <execute_command>, <tool_call>.",
          "2. ROADMAP-FIRST: lee el bloque ROADMAP/session-state; PROHIBIDO list_files('.') del repo entero si el mapa ya está cargado.",
          "3. Narra en prosa cada paso; no te limites a badges o checks.",
          "4. NO repitas exactamente la misma herramienta con los mismos parámetros.",
          "5. Paths relativos al proyecto (ej. package.json), nunca absolutos.",
          "6. Si ejecutas 'run_command' o un test/build, analiza la salida y aplica corrección inmediata (OODA).",
          "7. Fallos leves (oldText, git auxiliar, list_files de ruta ausente): recupera y continúa; no detengas la sesión.",
          "8. EditCore actualiza ROADMAP.md solo tras cambios. No digas que está prohibido actualizarlo.",
          "9. Responde SIEMPRE en español al usuario.",
          previewBlock,
          visionHardRule,
          roadmapFirstBlock,
          cognitiveBlock,
          skillsPrompt(projectRoot, decision?.kind, message),
          memory && !authorizedFromPending ? memory.promptBlock() : "",
          globalLearned,
        ].filter(Boolean).join("\n\n"));

    const scopedBody = authorizedFromPending
      ? String(message || "")
      : (String(message || "").includes("ALCANCE:")
        ? String(message || "")
        : scopeUserMessage(message));
    const userText = authorizedFromPending
      ? `Proyecto: ${projectRoot}\nEjecuta ahora:\n${scopedBody}`
      : `Proyecto: ${projectRoot}\n${scopedBody}`;
    const messages = [{ role: "system", content: system }];
    if (Array.isArray(taskImages) && taskImages.length) {
      try {
        const { buildOpenAiImageContent, VISION_ACK_RULE } = require("../runtime/vision-intake");
        messages.push({ role: "system", content: VISION_ACK_RULE });
        messages.push({ role: "user", content: buildOpenAiImageContent(userText, taskImages) });
      } catch {
        messages.push({ role: "user", content: userText });
      }
    } else {
      messages.push({ role: "user", content: userText });
    }

    const steps = [];
    const pendingWrites = new Set();
    const runMutations = [];
    const stepsLimit = Math.max(1, Number(maxSteps) || DEFAULT_MAX_STEPS);

    // Router: NUNCA sustituir el modelo del usuario (evita "modelo no permitido").
    const routedModel = String(model || "").trim();

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (!this.session.alive) return { kind: "STOP", text: "Detenido.", steps };

        // Tools: filtro write-safe original (NO filterToolsByPlan — dejaba al agente
        // sin tools del kernel y provocaba turnos vacíos).
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
        // Separar párrafos entre turnos del modelo (evita pasos pegados).
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
        const turn = await callChat({
          apiBaseUrl, apiKey, model: routedModel, messages,
          tools: (chatOnly || decision?.kind === "CHAT") ? [] : availableTools,
          signal: this.abort.signal,
          stream: true,
          onTextDelta: (delta) => {
            const chunk = String(delta || "");
            if (!chunk) return;
            try {
              // Acumular y emitir SOLO prosa visible (nunca <tool_call> / código interno).
              streamAccum += chunk;
              const visible = visibleNarrationText(streamAccum);
              let piece = "";
              if (visible.startsWith(lastVisible)) {
                piece = visible.slice(lastVisible.length);
              } else if (visible.length < lastVisible.length && lastVisible.startsWith(visible)) {
                // Encogió por corte de tool markup: no resetear el chat.
                piece = "";
              } else if (visible !== lastVisible) {
                // Nuevo tramo distinto: separar con párrafo, sin borrar lo anterior.
                piece = visible;
                try {
                  onProgress?.({
                    phase: "narration_delta",
                    text: "\n\n",
                    index: steps.length,
                    streaming: true,
                  });
                } catch { /* ignore */ }
              }
              lastVisible = visible;
              if (!piece) {
                if (/<(?:tool_call|function\s*=)/i.test(streamAccum) && !toolStreamNotified) {
                  toolStreamNotified = true;
                  onProgress?.({
                    phase: "model",
                    text: "Ejecutando herramienta…",
                  });
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

        let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        if (chatOnly || decision?.kind === "CHAT") {
          toolCalls = [];
        } else if (!toolCalls.length && turn.text) {
          toolCalls = parseTextToolCalls(turn.text, { projectRoot });
        }
        // Si write_file vino sin path, intentar inferirlo de la prosa previa.
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
          this.session.kill();
          if (memory) memory.note(`finalizó ${decision?.kind || "task"}`);
          
          const written = steps
            .filter((s) => (s.name === "write_file" || s.name === "replace_in_file") && s.ok)
            .map((s) => s.input?.path)
            .filter(Boolean);

          let textOut = cleanText;
          if (written.length > 0) {
            textOut = `Se aplicaron las modificaciones correctamente en los archivos:\n` +
              written.map((p) => `- \`${p}\``).join("\n");
            if (accessFull) textOut += nextStepsClosingText({ fullAccess: true, wroteFiles: true });
          } else if (!textOut || textOut === "Listo.") {
            textOut = nextStepsClosingText({ fullAccess: accessFull, wroteFiles: false });
          } else if (accessFull && /procede|¿procedo|cuando autorices/i.test(textOut)) {
            textOut = `${textOut.replace(/\s*(Cuando autorices procedo[^.]*\.?|Escribe\s+\*{0,2}procede\*{0,2}[^.]*\.?|Si deseas que aplique[^.]*\.?)\s*$/gi, "").trim()}${nextStepsClosingText({ fullAccess: true, wroteFiles: false })}`;
          }
          if (!String(textOut || "").trim()) {
            const toolNames = steps.map((s) => s.name).filter(Boolean).slice(-8);
            const errHint = String(turn?.error || turn?.message || "").trim();
            textOut = toolNames.length
              ? `Completé ${toolNames.length} acción(es): ${toolNames.join(", ")}.`
              : (errHint
                ? `El proveedor no devolvió texto usable: ${errHint.slice(0, 240)}`
                : "No pude generar texto visible en este turno. Reintenta con el mismo modelo o cambia de modelo en Auto.");
          }
          textOut = formatAgentVisibleText(textOut);

          persistKernelRoadmap(projectRoot, {
            task: message,
            steps,
            kind: decision?.kind,
            text: textOut,
            completed: true,
          });
          return { kind: decision?.kind || "CHAT", text: textOut, steps, mutations: runMutations };
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

          onProgress?.({
            phase: "tool",
            stage: "running",
            name,
            input: args,
          });

          let result;
          if (name === "write_file" || name === "replace_in_file") {
            const impl = await runImplementer({
              projectRoot,
              path: args.path,
              content: args.content,
              oldText: args.oldText,
              newText: args.newText,
              onProgress,
            });
            result = impl.result || impl;

            if (
              specialist?.name === "UI/UX Specialist"
              && result?.ok
              && isVisualUiPath(args.path)
            ) {
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
            const verif = await runVerifier({
              projectRoot,
              command: args.command,
              onProgress,
              autoRollback: true,
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
                  ? "Ajuste automático: releyendo contexto para reintentar…"
                  : "Fallo leve ignorado; continuando…",
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
                // Conservar el primer backup (estado pre-corrida) y el flag created.
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
      const written = steps
        .filter((s) => (s.name === "write_file" || s.name === "replace_in_file") && s.ok)
        .map((s) => s.input?.path)
        .filter(Boolean);

      let textOut = "";
      if (written.length > 0) {
        textOut = `Se aplicaron las modificaciones correctamente en los archivos:\n` +
          written.map((p) => `- \`${p}\``).join("\n");
        if (accessFull) textOut += nextStepsClosingText({ fullAccess: true, wroteFiles: true });
      } else {
        textOut = nextStepsClosingText({ fullAccess: accessFull, wroteFiles: false });
      }
      textOut = formatAgentVisibleText(textOut);

      persistKernelRoadmap(projectRoot, {
        task: message,
        steps,
        kind: decision?.kind,
        text: textOut,
        completed: true,
      });
      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, incomplete: false, mutations: runMutations };
    } catch (err) {
      this.session.kill();
      const errText = formatAgentVisibleText("Atención durante la ejecución: " + (err.message || err));
      persistKernelRoadmap(projectRoot, {
        task: message,
        steps,
        kind: decision?.kind,
        text: errText,
        completed: false,
      });
      return { kind: "CHAT", text: errText, steps, mutations: runMutations };
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue };