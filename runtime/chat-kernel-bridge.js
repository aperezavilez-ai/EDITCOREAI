"use strict";

const path = require("path");
const {
  handleChat,
// [EDITCORE] Ensure step budget is respected and final response always closes properly.
  stopChat,
  // [EDITCORE-INTEGRAL-B7] Cancelación por runId y plazo de cola del kernel.
  cancelChatRun,
  QUEUE_TIMEOUT_MS,
  steerChat,
  isChatRunning,
  classify,
} = require("./tools/index");

const KERNEL_TIMEOUT_MS = 60 * 60 * 1000; // 60 min — el agente nunca se queda sin tiempo en tareas complejas
// [EDITCORE-INTEGRAL-B7] El plazo de COLA vive en el kernel
// (QUEUE_TIMEOUT_MS, 120 s) y es deliberadamente menor que
// KERNEL_TIMEOUT_MS: quien espera en cola no consume el plazo de
// ejecución de su turno; al vencer recibe el resultado honesto
// «sigue en cola» en su propia burbuja (ver index.js).

function buildKernelHelpers({ BrowserWindow, capturePreview, previewUrl, startPreview, appUserData, onProcessChunk, onProcessSevereError, abortSignal, brainSearch, brainRemember, brainReadSkill, readConnections, writeConnections, refreshAccessToken, ...extra }) {
  return {
    ...extra,
    // [EDITCORE-INTEGRAL-B6] Costura de sesión viva: el kernel la usa
    // para re-pedir el token UNA vez ante NO_SESSION y reintentar el
    // paso con el token fresco (main la conecta a authManager).
    refreshAccessToken: typeof refreshAccessToken === "function" ? refreshAccessToken : (typeof extra.refreshSessionToken === "function" ? extra.refreshSessionToken : null),
    previewUrl: previewUrl || "",
    // [EDITCORE-INTEGRAL-B4] Costura del preview para el kernel: la
    // herramienta start_preview de tools.js llama helpers.startPreview
    // (main lo conecta a su startProjectPreview). Sin esta costura la
    // herramienta responde honestamente «no disponible en esta ruta».
    startPreview: typeof startPreview === "function" ? startPreview : null,
    userDataPath: appUserData || "",
    brainSearch: typeof brainSearch === "function" ? brainSearch : null,
    brainRemember: typeof brainRemember === "function" ? brainRemember : null,
    brainReadSkill: typeof brainReadSkill === "function" ? brainReadSkill : null,
    readConnections: typeof readConnections === "function" ? readConnections : null,
    // [SOCIAL-META FASE 1] Escritura a la bóveda de Conexiones: el
    // kernel la usa para guardar credenciales (tokens de Meta) por el
    // mismo estado seguro cifrado que lee readConnections.
    writeConnections: typeof writeConnections === "function" ? writeConnections : null,
    abortSignal: abortSignal || null,
    onProcessChunk: typeof onProcessChunk === "function" ? onProcessChunk : null,
    onProcessSevereError: typeof onProcessSevereError === "function" ? onProcessSevereError : null,
    async capturePreview(opts = {}) {
      if (typeof capturePreview !== "function" || !BrowserWindow) {
        throw new Error("Captura visual no disponible");
      }
      const url = String(opts.url || previewUrl || "").trim();
      if (!url) throw new Error("Sin URL de preview");
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
        throw new Error("Solo se permiten capturas de localhost");
      }
      return capturePreview({
        BrowserWindow,
        url,
        viewport: opts.viewport || "desktop",
        outputRoot: path.join(appUserData || process.cwd(), "preview-captures"),
      });
    },
  };
}

async function runKernelChat({
  message,
  history,
  messages,
  threadId,
  chatId,
  // [EDITCORE-INTEGRAL-B7] Identidad de la corrida y plazo de cola:
  // el runId lo genera/manda el renderer (ruta chat igual que la de
  // agente) y aquí jamás se vacía: entra al kernel y sale en CADA
  // evento de progreso y en el resultado.
  runId,
  queueTimeoutMs,
  projectRoot,
  apiBaseUrl,
  apiKey,
  // [CORRECCIÓN 1] Llave de Groq resuelta por main desde la bóveda
  // de la app: viaja al kernel para el ruteo de Nexus.
  groqApiKey,
  model,
  images,
  onProgress,
  helpers,
  autoHeal,
  allowWrite,
  permissionMode,
  permissionFull,
  fullAccess,
  planAuthorizedExecution,
  // [EDITCORE-INTEGRAL-B5] Nombres de la autorización en las demás
  // rutas (el renderer la manda como planAuthorized en agent:run) y el
  // dato de chat nuevo para el anuncio de modo: el bridge los acepta
  // y los NORMALIZA a la costura del kernel, sin reconstruir nada
  // desde el texto del prompt.
  planAuthorized,
  authorizedContinuation,
  isNewChat,
  chatIsNew,
  // [EDITCORE-V492-1] Opt-out EXPLÍCITO del acceso completo permanente:
  // solo lo pasa main para sus corridas INTERNAS del Inspector
  // (agentId inspector-* / namespace inspector), que son un subsistema
  // interno y no la superficie del chat. Sin este flag, TODO turno de
  // usuario se normaliza aquí a acceso completo (regla de producto de
  // Luis, 2026-11-11: «que quede con todos los permisos y ya»).
  respectRestrictiveMode,
  fallbackProfiles,
  skillsPrompt,
  maxSteps,
  totalTimeoutMs,
  // [KERNEL ÚNICO — v5.2.7] Marca informativa heredada: hasta la
  // v5.2.6 conmutaba opt-in al kernel nuevo. Desde la v5.2.7 el
  // kernel nuevo es la ÚNICA ruta y este campo ya no decide nada;
  // el resultado siempre lleva kernelNuevo: true.
  kernelNuevo,
}) {
  // [EDITCORE-INTEGRAL-B5] La autorización viaja como DATO estructurado
  // hasta handle(): cualquier nombre de ruta vale, el kernel recibe
  // siempre planAuthorizedExecution.
  const planAuthorizedData = planAuthorizedExecution === true
    || planAuthorized === true
    || authorizedContinuation === true;
  const newChatData = isNewChat === true || chatIsNew === true;
  const mode = String(permissionMode || "").toLowerCase();

  // NOTA: se eliminó el caso "(planAuthorizedExecution && mode === 'plan')"
  // que convertía a full access por error. Solo fullAccess/permissionFull/mode=full.
  const isFull = Boolean(
    fullAccess === true ||
    permissionFull === true ||
    mode === "full"
  );

  // [EDITCORE-V492-1] ACCESO COMPLETO PERMANENTE: esta es la ÚNICA
  // costura app→kernel, así que la normalización vive aquí y cubre
  // todas las rutas de usuario (chat y agente): cualquier modo guardado
  // o heredado («solo lectura»/Charla, «step»/Pregunta antes, por
  // proyecto, por chat o global) llega al kernel como acceso completo
  // efectivo. Con el modo efectivo siempre «full», el anuncio de modo
  // restrictivo del kernel nunca puede dispararse y ninguna
  // herramienta (write/publish/capture/run) se bloquea por modo. La
  // maquinaria de compuerta del kernel NO se toca: sigue existiendo y
  // probada; la app simplemente nunca le entrega un modo restrictivo.
  // Única excepción: respectRestrictiveMode === true, que main pasa
  // SOLO para las corridas internas del Inspector.
  const forceFullAccess = respectRestrictiveMode !== true;
  const effectivePermissionMode = forceFullAccess ? "full" : permissionMode;
  const effectiveFullAccess = forceFullAccess ? true : fullAccess;
  const effectivePermissionFull = forceFullAccess ? true : permissionFull;
  const effectiveAllowWrite = forceFullAccess ? true : allowWrite;

  // threadId estable: si no viene, generar uno (evita hilos huérfanos por mensaje).
  const tid = String(threadId || chatId || "").trim()
    || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // [EDITCORE-INTEGRAL-B7] runId de la corrida: viene del renderer o se
  // genera UNA vez aquí; nunca vacío. emitProgress es la ÚNICA puerta
  // de progreso del bridge: estampa runId/chatId/threadId en cada
  // evento (kernel, heartbeat, casual y error), para que el renderer
  // enrute cada evento a SU tarjeta y nunca a «la primera que haya».
  const rid = String(runId || "").trim()
    || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const emitProgress = (p) => {
    if (typeof onProgress !== "function") return;
    const base = p && typeof p === "object" ? p : { text: String(p || "") };
    try { onProgress({ ...base, runId: rid, chatId: chatId || tid, threadId: tid }); } catch { /* ignore */ }
  };

  const { isCasualPrompt, localConversationResponse } = require("./chat-local");
  if (isCasualPrompt(message)) {
    const casualText = localConversationResponse(message) || "Hola. ¿En qué te ayudo?";
    emitProgress({ phase: "delta", text: casualText });
    return {
      ok: true,
      text: casualText,
      steps: [],
      threadId: tid,
      runId: rid,
      kernel: true,
      brain: true,
      casual: true,
      report: { completed: true, role: "assistant" },
    };
  }

  const chatHistory = (Array.isArray(history) ? history : Array.isArray(messages) ? messages : [])
    .filter((msg) => {
      if (!msg) return false;
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content.includes("buildKernelProcessHooks is not defined") || content.includes("Error invoking remote method")) {
        return false;
      }
      return true;
    });

  // Heartbeat cada 5s para que la UI muestre actividad mientras el kernel trabaja.
  const heartbeatStart = Date.now();
  const heartbeat = setInterval(() => {
    try {
      const elapsedSec = Math.floor((Date.now() - heartbeatStart) / 1000);
      emitProgress({ phase: "heartbeat", text: "Procesando…", elapsedMs: elapsedSec * 1000 });
    } catch { /* ignore */ }
  }, 5_000);

  try {
    // [KERNEL ÚNICO — v5.2.7] La ÚNICA ruta: index.handleChat corre
    // SIEMPRE el kernel nuevo (carriles + adaptador a callChat/tools
    // reales). Ya no hay condición de flag ni camino viejo: el
    // kernel viejo salió del árbol en esta entrega. La memoria del
    // turno (Mapa + Cerebro, enmarcada como referencia) la compone
    // la propia entrada del kernel; aquí quedan el atajo casual, el
    // heartbeat, la normalización de acceso completo y el modelado
    // del resultado, como siempre.
    const out = await handleChat({
      message,
      // La autorización como DATO: sin este reenvío el kernel
      // solo veía el texto enlatado que la transporta y lo
      // clasificaba por su forma (CONVERSACION, sin
      // herramientas) — la ejecución autorizada jamás ejecutaba.
      planAuthorizedExecution: planAuthorizedData,
      history: chatHistory,
      messages: chatHistory,
      threadId: tid,
      chatId,
      runId: rid,
      projectRoot,
      apiBaseUrl,
      apiKey,
      groqApiKey,
      model,
      images: Array.isArray(images) ? images : [],
      onProgress: emitProgress,
      helpers,
      fallbackProfiles,
      skillsPrompt,
    });

    if (out?.error || out?.kind === "ERROR") {
      const err = new Error(out?.error || out?.text || "Error en ejecución del kernel");
      err.code = "KERNEL_FAILED";
      err.threadId = tid;
      err.runId = rid;
      err.kernelFailed = true;
      throw err;
    }

    // Cierre con memoria, el mismo contrato de turno vigente:
    // el Cerebro guarda los HECHOS destilados del turno (el
    // detalle, no la prosa) y el Mapa se mantiene al cierre.
    try {
      if (typeof helpers?.brainRemember === "function" && out.text) {
        Promise.resolve(helpers.brainRemember(projectRoot, {
          title: "Turno del agente",
          type: "session",
          content: `Pedido: ${String(message || "")}\n${out.detalle || ""}`,
        })).catch(() => {});
      }
    } catch { /* recordar nunca bloquea el cierre */ }
    try {
      if (projectRoot) {
        const orientationMap = require("./tools/orientation-map");
        const maintained = orientationMap.maintainProjectMap(projectRoot, {
          steps: out.steps, finalText: out.text, userText: message,
        });
        if (maintained) orientationMap.syncUserProjectIndex(projectRoot, maintained);
      }
    } catch { /* el Mapa nunca tumba el cierre */ }

    const isStopped = out?.kind === "STOP";
    return {
      ok: !isStopped,
      text: out.text || (isStopped ? "Detenido." : "Operación procesada."),
      detalle: out.detalle,
      cierreCorregida: out.cierreCorregida,
      steps: Array.isArray(out.steps) ? out.steps : [],
      threadId: out.threadId || tid,
      runId: out.runId || rid,
      kernel: true,
      // [KERNEL ÚNICO] Marca informativa: la ruta ya es siempre esta.
      kernelNuevo: true,
      brain: true,
      kind: out.kind,
      incomplete: isStopped || !!out.incomplete,
      cancelled: isStopped,
      mutations: out.mutations,
      // Archivos entregables del turno: la superficie los pinta
      // en la burbuja del chat como enlace «Descargar».
      archivos: Array.isArray(out.archivos) ? out.archivos : [],
      usage: out.usage,
      report: { completed: !isStopped && !out.incomplete && !out.cierreCorregida, role: "assistant" },
    };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 400);
    try {
      emitProgress({ phase: "error", text: message, stage: "kernel_failed" });
    } catch { /* ignore */ }
    // FIX: propagar el error real. El caller (main.js / renderer) debe marcar
    // la corrida como fallida y mostrar el mensaje. Antes se devolvia un
    // objeto "success" con error:true y el renderer cerraba las bolitas OK.
    const error = new Error(message);
    error.code = err?.code || "KERNEL_FAILED";
    error.threadId = tid;
    error.kernelFailed = true;
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = {
  handleChatKernel: runKernelChat,
  stopChatKernel: stopChat,
  // [EDITCORE-INTEGRAL-B7] Cancelación quirúrgica por runId (main la
  // usa en editcore:cancel / agent:cancel cuando el llamante
  // identifica la corrida) y constantes de plazo declaradas.
  cancelChatKernelRun: cancelChatRun,
  KERNEL_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  steerChatKernel: steerChat,
  isChatKernelRunning: isChatRunning,
  classifyChatKernel: classify,
  buildKernelHelpers,
  handleChat,
  stopChat,
  cancelChatRun,
  steerChat,
  classify,
};
