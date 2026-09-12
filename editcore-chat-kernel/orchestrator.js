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
const { parseTextToolCalls, stripTextToolMarkup, toRelativePath } = require("./parse-text-tools");
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
  "ROL: GUÍA LÍDER (inversión del control).",
  "Ante objetivos de alto nivel o solicitudes generales:",
  "1) Genera tu propia hoja de ruta de 3 a 5 pasos concretos (basada en el mapa cognitivo real).",
  "2) Informa al usuario en 2-4 líneas qué vas a hacer (sin pedir permiso ni esperar confirmación si ya hay autorización o la tarea es exploratoria/análisis).",
  "3) Ejecuta paso a paso de forma autónoma con tools: Observar → Orientar → Decidir → Actuar.",
  "4) No te detengas por fallos leves (oldText desfasado, git auxiliar, carpetas inexistentes): relee contexto cercano y reintenta.",
  "PROHIBIDO inventar carpetas típicas (src/, app/, lib/) si no aparecen en el MAPA COGNITIVO.",
  "PROHIBIDO devolver solo un plan vacío sin ejecutar tools cuando el modo permite herramientas.",
].join("\n");

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

const APPROVAL_WORDS = new Set([
  "procede", "procedo", "adelante", "hazlo", "autorizado",
  "continua", "continúa", "ejecuta", "si", "sí", "ok", "dale", "va",
]);

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
    const text = rawText.trim();
    const textLower = text.toLowerCase();
    const isApprovalText = APPROVAL_WORDS.has(textLower);

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

    if (/\b(?:explora|explorer|directorio|listar|estructura|archivos)\b/i.test(text) && decision.kind === "CHAT") {
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
      });
    }

    if (decision.kind === "LIST" || decision.kind === "ASK") {
      ensureCognitiveMap(projectRoot);
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
          message: `El explorador analizó el directorio '${out.target || target}' con los siguientes resultados:\n\n${out.summary}\n\nCon base en la estructura encontrada (mapa cognitivo real), responde a la solicitud del usuario: "${text}" proponiendo 3 tareas altamente concretas y contextualizadas.`,
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false, maxSteps: 4, helpers,
        });
      }

      return { kind: decision.kind, text: out.summary, steps: out.steps };
    }

    if (decision.kind === "ANALYZE") {
      if (wantsBackground(text, decision, input)) {
        return this.enqueueBackgroundTask({
          decision, message: text, projectRoot, onProgress, extra: { maxReads: 8 },
        });
      }
      this.session.start("ANALYZE", projectRoot);
      onProgress?.({ phase: "start", text: "Subagente Analyst: Escaneando proyecto..." });
      const out = await runAnalyst({ projectRoot, onProgress, maxReads: 8 });
      if (memory) {
        memory.setReport(out.report);
        memory.note("análisis completado");
      }
      this.session.kill();

      if (apiKey) {
        return this.runModelTask({
          decision,
          message: `El analista examinó el proyecto e identificó lo siguiente:\n\n${out.report}\n\nResponde directamente al usuario ofreciendo recomendaciones reales para continuar.`,
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false, maxSteps: 2, helpers,
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
      });
    }

    return { kind: "CHAT", text: "Instrucción no reconocida. Especifica qué deseas analizar, listar o corregir." };
  }

  async runModelTask(opts) {
    const {
      decision, message, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
      allowWrite, maxSteps, helpers, chatOnly, authorizedFromPending,
      fullAccess, permissionMode,
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

    const noConfirmBlock = (accessFull || authorizedFromPending)
      ? [
        "ACCESO COMPLETO / EJECUCIÓN AUTORIZADA:",
        "PROHIBIDO preguntar: '¿Deseas que proceda?', 'Confirma para aplicar los cambios.', 'Escribe procede.', '¿Procedo?'.",
        "Ejecuta YA tools: write_file, replace_in_file, run_command. Sin preguntas previas.",
      ].join("\n")
      : "";

    const system = chatOnly || decision?.kind === "CHAT"
      ? [
        "Eres EDITCOREAI: asistente del IDE. Responde en español, 2-5 frases, directo.",
        "PROHIBIDO: decir que vas a analizar, abrir tools, listar archivos, o inventar pasos de exploración.",
        `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
      ].filter(Boolean).join("\n\n")
      : authorizedFromPending || accessFull
        ? [
          "Eres EditCore Agent — GUÍA LÍDER autónomo.",
          LEADERSHIP_PROMPT,
          noConfirmBlock,
          "Ejecuta YA la instrucción con tools (write_file, replace_in_file, run_command).",
          "Antes de mutar: narra en 2-4 líneas tu hoja de ruta (3-5 pasos) y procede sin pedir confirmación.",
          "PROHIBIDO inventar ROADMAP.md u otras tareas genéricas: solo la instrucción del usuario.",
          "Ante fallo leve de tool: relee y reintenta; NUNCA abandones con 'Detenido' por errores secundarios.",
          `Permiso de escritura: SÍ.${accessFull ? " Acceso completo activo." : ""}`,
          cognitiveBlock,
          specialistInstruction,
        ].filter(Boolean).join("\n\n")
        : [
          "Eres EditCore Agent — entorno autónomo y GUÍA LÍDER del IDE.",
          LEADERSHIP_PROMPT,
          `Modo actual: ${decision?.kind || "EXECUTE"}. Permiso de escritura: ${allowWrite ? "SÍ" : "NO"}.`,
          specialistInstruction,
          "REGLAS OBLIGATORIAS:",
          "1. Usa SOLO function calling / tools nativas. NUNCA escribas XML como <list_directory>, <read_file>, <execute_command>, <tool_call>.",
          "2. Observa el MAPA COGNITIVO antes de explorar; no inventes src/ ni app/.",
          "3. Sé conciso. Informa la hoja de ruta y actúa.",
          "4. NO repitas exactamente la misma herramienta con los mismos parámetros.",
          "5. Paths relativos al proyecto (ej. package.json), nunca absolutos.",
          "6. Si ejecutas 'run_command' o un test/build, analiza la salida y aplica corrección inmediata (OODA).",
          "7. Fallos leves (oldText, git auxiliar, list_files de ruta ausente): recupera y continúa; no detengas la sesión.",
          cognitiveBlock,
          skillsPrompt(projectRoot, decision?.kind, message),
          memory && !authorizedFromPending ? memory.promptBlock() : "",
          globalLearned,
        ].filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: authorizedFromPending
          ? `Proyecto: ${projectRoot}\nEjecuta ahora:\n${message}`
          : `Proyecto: ${projectRoot}\n${message}`,
      },
    ];

    const steps = [];
    const pendingWrites = new Set();
    const stepsLimit = Math.max(1, Number(maxSteps) || DEFAULT_MAX_STEPS);

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (!this.session.alive) return { kind: "STOP", text: "Detenido.", steps };

        const availableTools = allowWrite
          ? tools.DEFINITIONS
          : tools.DEFINITIONS.filter((t) => ![
            "write_file", "replace_in_file", "run_command", "scaffold_project",
            "supabase_migrate", "ingest_to_brain", "clone_repo",
            "rollback_last_change",
          ].includes(t.function.name));

        const turn = await callChat({
          apiBaseUrl, apiKey, model, messages,
          tools: (chatOnly || decision?.kind === "CHAT") ? [] : availableTools,
          signal: this.abort.signal,
        });

        let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        if (chatOnly || decision?.kind === "CHAT") {
          toolCalls = [];
        } else if (!toolCalls.length && turn.text) {
          toolCalls = parseTextToolCalls(turn.text, { projectRoot });
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
          } else if (!textOut || textOut === "Listo.") {
            textOut = "Se ha completado la lectura y análisis de los archivos especificados. Si deseas que aplique los cambios directamente en el código, por favor confirma escribiendo **procede** o **hazlo**.";
          }

          return { kind: decision?.kind || "CHAT", text: textOut, steps };
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

          if (Array.isArray(softRecover.stepsExtra) && softRecover.stepsExtra.length && softRecover.recovered) {
            // Solo registrar el list_files corregido; evita duplicar el step fallido+recuperado
            for (const extra of softRecover.stepsExtra) {
              steps.push(extra);
              this.session.addStep(extra);
            }
            result = softRecover.payload;
            // No volver a pushar el intento fallido como step principal
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

          // Fallo leve: permitir reintento con args distintos (no bloquear toolHistory por soft).
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
          onProgress?.({ phase: "tool", name, input: args, result, ok: stepData.ok });

          if ((name === "write_file" || name === "replace_in_file") && result?.ok !== false && args.path) {
            pendingWrites.delete(String(args.path));
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
      } else {
        textOut = "Se ha completado la lectura y análisis de los archivos especificados. Si deseas que aplique los cambios directamente en el código, por favor confirma escribiendo **procede** o **hazlo**.";
      }

      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, incomplete: false };
    } catch (err) {
      this.session.kill();
      return { kind: "CHAT", text: "Atención durante la ejecución: " + (err.message || err), steps };
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue };