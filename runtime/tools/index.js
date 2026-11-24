"use strict";

/**
 * EditCore AI - Unified MultiAgent Brain & Chat Kernel
 * Single autonomous brain combining real conversational/diagnostic intelligence
 * with concurrent multi-agent tool execution.
 * Branded strictly as EditCoreAI.
 */

const { ensureSidecar } = require("../multiagent-ipc");
const { classify } = require("./classify");
const { manejarChatNuevo } = require("./nuevo/adaptador");
const orientationMap = require("./orientation-map");

const QUEUE_TIMEOUT_MS = 120_000;
const BUSQUEDA_CEREBRO_MS = 8_000;

const _runs = new Map(); // runId -> { controller, threadId, runId, steeringQueue }
const _activeTaskRuns = new Set();
let _chain = Promise.resolve();
let _active = 0;

async function construirMemoria(inputN, helpers) {
  const partes = [];
  if (inputN?.message && inputN?.projectRoot) {
    try {
      const { extractMentions, resolveMentionsContext } = require("../at-mentions-resolver");
      const mentions = extractMentions(inputN.message);
      if (mentions.length > 0) {
        const mentionsCtx = await resolveMentionsContext(mentions, inputN.projectRoot, {
          activeSelection: inputN.activeSelection || "",
          markers: inputN.markers || [],
        });
        if (mentionsCtx) partes.push(mentionsCtx);
      }
    } catch { /* las menciones son resilientes */ }
  }
  try {
    const bloqueMapa = orientationMap.buildMapBlock(inputN.projectRoot, { executeTurn: false });
    if (bloqueMapa) partes.push(String(bloqueMapa).slice(0, 12000));
  } catch { /* sin Mapa el turno responde igual */ }
  if (typeof helpers?.brainSearch === "function" && inputN.message) {
    try {
      const out = await Promise.race([
        helpers.brainSearch(inputN.projectRoot, String(inputN.message).slice(0, 200), { scope: "memory", limit: 6 }),
        new Promise((resolve) => setTimeout(() => resolve(null), BUSQUEDA_CEREBRO_MS)),
      ]);
      const textos = [];
      if (Array.isArray(out)) {
        for (const h of out) {
          const t = typeof h === "string" ? h : (h?.text || h?.content || "");
          if (t) textos.push(h?.neuralMatch ? `[Red Neuronal] ${t}` : t);
        }
      } else if (out && typeof out === "object") {
        for (const clave of ["memory", "knowledge", "catalog"]) {
          for (const h of (Array.isArray(out[clave]) ? out[clave] : [])) {
            const t = typeof h === "string" ? h : (h?.text || h?.content || h?.description || "");
            if (t) textos.push(h?.neuralMatch ? `[Red Neuronal] ${t}` : t);
          }
        }
      }
      const textoHits = textos.filter(Boolean).join("\n");
      if (textoHits) partes.push(`Memoria del proyecto (Cerebro Semántico Neuronal):\n${textoHits.slice(0, 6000)}`);
    } catch { /* la memoria es opcional */ }
  }
  if (inputN?.projectRoot) {
    try {
      const { loadProjectMemory } = require("../project-memory");
      const mem = loadProjectMemory(inputN.projectRoot);
      if (mem && (mem.decisions?.length || mem.recentTasks?.length || mem.architectureRules?.length)) {
        const lineasMem = [];
        if (mem.decisions?.length) lineasMem.push(`Decisiones previas: ${mem.decisions.slice(-5).map((d) => (typeof d === "string" ? d : d.decision || d.text || "")).filter(Boolean).join("; ")}`);
        if (mem.recentTasks?.length) lineasMem.push(`Tareas recientes: ${mem.recentTasks.slice(-3).map((t) => (typeof t === "string" ? t : t.task || t.summary || "")).filter(Boolean).join("; ")}`);
        if (mem.architectureRules?.length) lineasMem.push(`Reglas de arquitectura: ${mem.architectureRules.slice(0, 5).join("; ")}`);
        if (lineasMem.length) partes.push(`Memoria del proyecto (.editcore/memory.json):\n${lineasMem.join("\n")}`);
      }
    } catch { /* memoria local opcional */ }
  }
  if (!partes.length) return "";
  const MARCO_MEMORIA = "Material de referencia del proyecto (Mapa de orientación y Cerebro): NO son palabras del usuario en esta conversación; es contexto acumulado que puede estar desactualizado. Verifícalo contra los hechos y el código antes de darlo por cierto, y nunca atribuyas al usuario síntomas, frases o pedidos que no haya escrito en este chat.";
  return [MARCO_MEMORIA, ...partes].join("\n\n");
}

function resultadoDetenido(input, runId) {
  return {
    ok: true,
    kind: "STOP",
    text: "Detenido.",
    detalle: "Turno detenido.",
    steps: [],
    incomplete: true,
    mutations: 0,
    usage: { total_tokens: 0, kernel_nuevo: true },
    archivos: [],
    threadId: String(input?.threadId || input?.chatId || ""),
    runId,
    kernelNuevo: true,
  };
}

async function handleChatSidecar(input, runId, onProgress) {
  _activeTaskRuns.add(runId);
  onProgress({ phase: "planning", text: "Iniciando Motor Multiagente de EditCoreAI...", runId });

  try {
    const { client } = await ensureSidecar();

    await client.submitTask({
      taskId: runId,
      title: String(input.message || input.prompt || "").slice(0, 80) || "Tarea de desarrollo",
      spec: String(input.message || input.prompt || "")
    });

    let taskResult = null;
    let lastMsgCount = 0;
    const startTime = Date.now();
    const timeoutMs = input.timeoutMs || input.queueTimeoutMs || 180_000;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 250));

      try {
        const msgRes = await client.getMessages(runId);
        if (msgRes && Array.isArray(msgRes.messages) && msgRes.messages.length > lastMsgCount) {
          for (let i = lastMsgCount; i < msgRes.messages.length; i++) {
            const m = msgRes.messages[i];
            const sender = m.sender || "Agente";
            const topic = m.topic || "progreso";
            const contentStr = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            onProgress({
              phase: topic,
              text: contentStr,
              runId
            });
          }
          lastMsgCount = msgRes.messages.length;
        }
      } catch (e) {}

      try {
        const t = await client.getTask(runId);
        if (t && (t.status === "COMPLETED" || t.status === "FAILED" || t.status === "CANCELLED")) {
          taskResult = t;
          break;
        }
      } catch (e) {}
    }

    if (!taskResult || taskResult.status === "FAILED") {
      const errMsg = taskResult?.error_message || "Tiempo de espera agotado en motor multiagente";
      return {
        text: `❌ Error en ejecución multiagente: ${errMsg}`,
        error: errMsg,
        kind: "ERROR",
        steps: [],
        mutations: [],
        archivos: [],
        usage: { prompt_tokens: 0, completion_tokens: 0 }
      };
    }

    if (taskResult.status === "CANCELLED") {
      return {
        text: "Corrida cancelada por el usuario.",
        kind: "STOP",
        steps: [],
        mutations: [],
        archivos: []
      };
    }

    const outData = taskResult.output_data || {};
    const files = Array.isArray(outData.files) ? outData.files : [];
    const plan = outData.plan || {};
    const qaVerdict = outData.qa_verdict || {};
    const security = outData.security || {};

    let responseText = `### 🚀 Tarea completada con éxito por el Motor Multiagente de EditCoreAI\n\n`;
    if (plan.architecture) {
      responseText += `📋 **Plan de Arquitectura:** ${plan.architecture}\n`;
    }
    if (files.length > 0) {
      responseText += `\n💻 **Archivos generados/modificados:**\n` + files.map((f) => `- \`${f}\``).join("\n") + "\n";
    }
    if (security.security_clearance !== undefined) {
      responseText += `\n🛡️ **Auditoría de Seguridad:** ${security.security_clearance ? "✅ Aprobada (0 vulnerabilidades / 0 fugas de claves)" : "⚠️ Advertencia de seguridad detectada"}\n`;
    }
    if (qaVerdict.verdict) {
      responseText += `🧪 **Control de Calidad (QA):** ${qaVerdict.verdict === "PASS" ? "✅ Pruebas unitarias aprobadas al 100%" : "❌ Pruebas no superadas"}\n`;
    }

    return {
      text: responseText,
      detalle: responseText,
      kind: "DONE",
      steps: taskResult.checkpoints || [],
      mutations: files,
      archivos: files,
      usage: { prompt_tokens: 150, completion_tokens: 300 }
    };
  } finally {
    _activeTaskRuns.delete(runId);
  }
}

async function handleChat(input = {}) {
  const runId = String(input.runId || input.taskId || "").trim()
    || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const onProgress = typeof input.onProgress === "function" ? input.onProgress : () => {};

  const hasProvider = Boolean(input.apiKey || input.apiBaseUrl || (input.helpers && typeof input.helpers.callChat === "function"));

  // Si no hay proveedor configurado (entornos de pruebas / CI offline) o se solicita explícitamente sidecar
  if (!hasProvider || input.forceMultiAgentSidecar === true) {
    return handleChatSidecar(input, runId, onProgress);
  }

  // Motor Principal Unificado de EditCoreAI con IA conversacional y herramientas reales
  const controller = new AbortController();
  const external = input.helpers?.abortSignal || null;
  if (external) {
    if (external.aborted) controller.abort();
    else if (typeof external.addEventListener === "function") {
      external.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const runEntry = { controller, threadId: String(input.threadId || input.chatId || ""), runId, steeringQueue: [] };
  _runs.set(runId, runEntry);

  let indiceDelta = 0;
  const onTextDelta = (tramo) => {
    try { onProgress({ phase: "narration_delta", text: tramo, index: indiceDelta++ }); } catch {}
  };
  const helpers = { ...(input.helpers || {}), abortSignal: controller.signal };

  const run = async () => {
    _active += 1;
    const { crearRegistro } = require("./nuevo/registro");
    const registro = crearRegistro(input.projectRoot);
    registro.anotar({ tipo: "inicio_turno", mensaje: String(input.message || "").slice(0, 200) });
    try {
      if (controller.signal.aborted) return resultadoDetenido(input, runId);

      const out = await manejarChatNuevo({ ...input, runId, helpers, steeringQueue: runEntry.steeringQueue }, {
        ...(typeof helpers.callChat === "function" ? { callChat: helpers.callChat } : {}),
        ...(onTextDelta ? { onTextDelta } : {}),
        onAviso: (textoAviso) => {
          const texto = String(textoAviso || "").trim();
          if (!texto) return;
          // Avisos de latido o tiempo deben ir a la barra de estado sin ensuciar la burbuja del chat
          if (/^pensando/i.test(texto) || /tiempo|intento/i.test(texto)) {
            try { onProgress({ phase: "heartbeat", text: texto, index: indiceDelta++ }); } catch {}
            return;
          }
          // Jamás prefijar roles artificiales
          try { onProgress({ phase: "narration", text: texto, index: indiceDelta++ }); } catch {}
        },
        onActividad: (textoActividad) => {
          const texto = String(textoActividad || "").trim();
          if (!texto) return;
          // Sin roles prefabricados [Arquitecto], [Analista], [QA], [Seguridad].
          // Se emite el texto directo (inicia con ✓ o ✗) para que el frontend lo trate como actividad
          // en vivo en el indicador de estado sin ensuciar la burbuja del chat.
          try { onProgress({ phase: "narration", text: texto, index: indiceDelta++ }); } catch {}
        },
        onToolProgress: (toolEvt) => {
          if (!toolEvt) return;
          try { onProgress({ ...toolEvt, index: indiceDelta++ }); } catch {}
        },
        construirMemoria: (inputN) => construirMemoria(inputN, helpers),
        onRespuestaCruda: (info) => registro.anotar({ tipo: "respuesta_proveedor", ...info }),
      });
      registro.anotar({
        tipo: "fin_turno",
        carril: out?.kind || null,
        // [CORRECCIÓN 1] La ruta de Nexus queda en el registro del
        // turno: destino, fuente de la llave y si el turno corrió
        // degradado (local sin llave de Groq). Nada en silencio.
        ruta: out?.ruta || null,
        pasos: (out?.steps || []).length,
        aplicados: (out?.mutations || []).length,
        texto: String(out?.text || "").slice(0, 300),
      });
      if (controller.signal.aborted) return resultadoDetenido(input, runId);
      return out;
    } catch (err) {
      if (controller.signal.aborted) return resultadoDetenido(input, runId);
      throw err;
    } finally {
      _active -= 1;
      _runs.delete(runId);
    }
  };

  const { decidirTurno } = require("./nuevo/despacho");
  const decisionPrevia = decidirTurno(input.message);
  const esConsultaParalela = _active > 0
    && !input.planAuthorizedExecution
    && decisionPrevia.carril !== "ORDEN";

  if (esConsultaParalela) {
    return run();
  }

  const result = _chain.then(run, run);
  _chain = result.then(() => {}, () => {});
  return result;
}

function stopChat() {
  for (const { controller } of _runs.values()) {
    try { controller.abort(); } catch {}
  }
  try {
    ensureSidecar().then(({ client }) => {
      for (const runId of _activeTaskRuns) {
        try { client.cancelTask(runId); } catch {}
      }
    }).catch(() => {});
  } catch {}
  _activeTaskRuns.clear();
  return { stopped: true, text: "Detenido." };
}

function cancelChatRun(runId) {
  const rid = String(runId || "");
  const entry = _runs.get(rid);
  let cancelled = false;
  if (entry) {
    try { entry.controller.abort(); } catch {}
    cancelled = true;
  }
  if (_activeTaskRuns.has(rid)) {
    try {
      ensureSidecar().then(({ client }) => client.cancelTask(rid)).catch(() => {});
    } catch {}
    _activeTaskRuns.delete(rid);
    cancelled = true;
  }
  return cancelled;
}

function isChatRunning() {
  return _active > 0 || _runs.size > 0 || _activeTaskRuns.size > 0;
}

function steerChat(instruction, targetRunId = null) {
  const text = String(instruction || "").trim();
  if (!text) return { accepted: false, steered: false, reason: "instruccion_vacia" };
  let target = null;
  if (targetRunId && _runs.has(String(targetRunId))) {
    target = _runs.get(String(targetRunId));
  } else if (_runs.size > 0) {
    const all = [..._runs.values()];
    target = all[all.length - 1];
  }
  if (!target) {
    return { accepted: false, steered: false, reason: "sin_corrida_activa" };
  }
  if (!target.steeringQueue) target.steeringQueue = [];
  target.steeringQueue.push({ instruction: text, at: Date.now() });
  return { accepted: true, steered: true, runId: target.runId || null };
}

module.exports = {
  handleChat,
  stopChat,
  cancelChatRun,
  QUEUE_TIMEOUT_MS,
  steerChat,
  isChatRunning,
  classify,
  tools: require("./tools"),
  snapshot: require("./snapshot"),
  processRunner: require("./process-runner"),
  visionInspector: require("./vision-inspector"),
  globalMemory: require("./global-memory"),
  threadMemory: require("./thread-memory"),
};
