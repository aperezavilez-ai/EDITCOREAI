"use strict";
// ============================================================
// [KERNEL ÚNICO — v5.2.7] Entrada del kernel de chat.
//
// Desde la v5.2.7 esta es la ÚNICA ruta de chat: el kernel nuevo
// (editcore-chat-kernel/nuevo: despacho por carriles, turno con
// presupuestos duros, subagentes reales, cierre desde los hechos)
// atiende TODOS los turnos. El kernel viejo (orchestrator.js y su
// cadena serial con cola y steering) se retiró del árbol en esta
// misma entrega, con su mapa de alcanzabilidad: lo compartido se
// quedó (provider.js, tools.js, extra-tools.js, parse-text-tools.js,
// classify.js, concierge.js, orientation-map.js) y lo exclusivo se
// borró con sus tests exclusivos. La red de seguridad es el tag
// v5.2.6 en GitHub, no código muerto conviviendo.
//
// Contrato que esta entrada mantiene con runtime/chat-kernel-bridge.js
// (y, a través de él, con main.js):
//   handleChat(input)      → resultado del adaptador (text, detalle,
//                            steps, kind=carril, incomplete,
//                            mutations, usage, archivos) o la forma
//                            STOP si la corrida fue cancelada.
//   stopChat()             → aborta TODAS las corridas vivas.
//   cancelChatRun(runId)   → aborta UNA corrida; true si existía.
//   isChatRunning()        → hay corridas vivas o en cadena.
//   steerChat(instruction) → DECLARADO: { accepted: false }. El
//                            carril paralelo del kernel nuevo
//                            (nuevo/subagentes.atenderEnParalelo)
//                            existe como módulo probado pero aún no
//                            está cableado a esta entrada; hasta
//                            que lo esté, una instrucción a mitad de
//                            turno NO se funde — entra al cerrar el
//                            turno en curso. No se finge lo contrario.
//   classify               → el clasificador compartido (classify.js).
//   QUEUE_TIMEOUT_MS       → constante de compatibilidad del
//                            puente; la cola con plazo del kernel
//                            viejo ya no existe (los turnos se
//                            serializan en cadena, sin aviso de cola).
// ============================================================

const { manejarChatNuevo } = require("./nuevo/adaptador");
const { classify } = require("./classify");

const QUEUE_TIMEOUT_MS = 120_000;
// Tope de espera de la búsqueda del Cerebro al construir la memoria
// del turno: el Cerebro es opcional y nunca retiene un turno.
const BUSQUEDA_CEREBRO_MS = 8_000;

const _runs = new Map(); // runId -> { controller, threadId, runId, steeringQueue }
let _chain = Promise.resolve();
let _active = 0;

// La memoria del turno, con TODO a la mano como en el kernel
// vigente hasta la v5.2.6: el MAPA (capas usuario + proyecto, la
// misma fuente del carril de orientación) y el Cerebro visible
// (brainSearch). Las skills viajan en skillsPrompt y por las
// herramientas read_skill/list_skills. Mudada desde el puente en
// la unificación de ruta, con DOS correcciones de contrato: la
// búsqueda del Cerebro se llama con su firma real
// (root, query, opciones) — el puente la llamaba con un solo
// argumento y el Cerebro nunca respondía en producción — y el
// resultado se aplana desde su forma real ({memory, knowledge,
// catalog}) además de la forma de lista simple.
async function construirMemoria(inputN, helpers) {
  const partes = [];
  try {
    const orientationMap = require("./orientation-map");
    const bloqueMapa = orientationMap.buildMapBlock(inputN.projectRoot, { executeTurn: false });
    if (bloqueMapa) partes.push(String(bloqueMapa).slice(0, 12000));
  } catch { /* sin Mapa el turno responde igual */ }
  if (typeof helpers?.brainSearch === "function" && inputN.message) {
    try {
      // [Juicio en vivo v5.2.7] El ámbito manda: con "all"/"code",
      // searchForAgent REINDEXA el proyecto en línea antes de buscar
      // (indexProject camina el árbol, re-troza lo cambiado y
      // reconstruye el FTS en el proceso principal). Tras un
      // reemplazo del árbol eso es una reindexación completa DENTRO
      // del primer turno — la ventana dejó de responder antes de
      // que el proveedor recibiera nada. La memoria del turno se
      // pide con ámbito "memory" (solo el almacén de memoria, sin
      // indexar) y con tope de espera: el Cerebro es opcional y
      // jamás retiene un turno. El conocimiento del proyecto sigue
      // alcanzable por la herramienta brain_search, llamada
      // explícita y visible, no peaje de cada mensaje.
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
    } catch { /* la memoria es opcional: sin ella el turno responde igual */ }
  }
  if (!partes.length) return "";
  // La memoria entra ENMARCADA como referencia: en el juicio en
  // vivo de la v5.2.6 el agente recitó el expediente del Mapa como
  // si fuera el estado real y atribuyó al usuario un síntoma que
  // nunca escribió. El marco viaja SIEMPRE que haya Mapa o Cerebro.
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

async function handleChat(input = {}) {
  const runId = String(input.runId || "").trim()
    || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  // Streaming en vivo hacia la superficie: el puente entrega
  // onProgress en la entrada; los deltas de texto del proveedor se
  // traducen a la fase que el renderer pinta en vivo
  // (narration_delta). Sin onProgress el turno corre igual, solo
  // que sin pintado en vivo.
  let indiceDelta = 0;
  const onTextDelta = typeof input.onProgress === "function"
    ? (tramo) => {
        try { input.onProgress({ phase: "narration_delta", text: tramo, index: indiceDelta++ }); } catch { /* ignore */ }
      }
    : null;
  // La señal de ESTA corrida manda sobre la que trajera el llamante:
  // el adaptador la reenvía a callChat y las herramientas la reciben
  // en helpers — así Detener corta proveedor y herramientas a la vez.
  const helpers = { ...(input.helpers || {}), abortSignal: controller.signal };

  const run = async () => {
    _active += 1;
    // Registro de diagnóstico del turno (.editcore/turnos.jsonl
    // del proyecto abierto): la evidencia cruda para diagnosticar
    // en la máquina del usuario en vez de corregir a ciegas.
    const { crearRegistro } = require("./nuevo/registro");
    const registro = crearRegistro(input.projectRoot);
    registro.anotar({ tipo: "inicio_turno", mensaje: String(input.message || "").slice(0, 200) });
    try {
      // Cancelada mientras esperaba en la cadena: ni proveedor ni
      // herramientas — resuelve STOP directamente.
      if (controller.signal.aborted) return resultadoDetenido(input, runId);
      const out = await manejarChatNuevo({ ...input, runId, helpers, steeringQueue: runEntry.steeringQueue }, {
        // La misma costura de inyección del proveedor que el
        // kernel viejo honraba (helpers.callChat): si el llamante
        // la trae, el adaptador la usa; en producción main no la
        // pasa y el adaptador usa el callChat real de provider.js.
        ...(typeof helpers.callChat === "function" ? { callChat: helpers.callChat } : {}),
        ...(onTextDelta ? { onTextDelta } : {}),
        // Avisos del turno (inicio según el carril, latido de
        // espera, reintento del proveedor): la espera deja de ser
        // muda — la superficie los narra en el registro del turno
        // (fase narration, la que el renderer pinta).
        ...(typeof input.onProgress === "function" ? {
          onAviso: (textoAviso) => {
            const texto = String(textoAviso || "").trim();
            if (!texto) return;
            try { input.onProgress({ phase: "model", text: texto, index: indiceDelta++ }); } catch { /* ignore */ }
          },
        } : {}),
        // Actividad del turno (una línea por herramienta
        // ejecutada): viaja por el MISMO canal de narración que
        // los avisos — la superficie la pinta en vivo y la espera
        // deja de ser un «Trabajando…» mudo.
        ...(typeof input.onProgress === "function" ? {
          onActividad: (textoActividad) => {
            const texto = String(textoActividad || "").trim();
            if (!texto) return;
            try { input.onProgress({ phase: "narration", text: texto, index: indiceDelta++ }); } catch { /* ignore */ }
          },
          onToolProgress: (toolEvt) => {
            if (!toolEvt) return;
            try { input.onProgress({ ...toolEvt, index: indiceDelta++ }); } catch { /* ignore */ }
          },
        } : {}),
        construirMemoria: (inputN) => construirMemoria(inputN, helpers),
        onRespuestaCruda: (info) => registro.anotar({ tipo: "respuesta_proveedor", ...info }),
      });
      registro.anotar({
        tipo: "fin_turno",
        carril: out?.kind || null,
        pasos: (out?.steps || []).length,
        aplicados: (out?.mutations || []).length,
        // Los fallos CON su resumen: el registro anterior solo
        // contaba pasos y el error concreto de un comando era
        // ilegible desde el registro (hizo falta arqueología en
        // tres turnos para llegar a él).
        fallos: (out?.steps || []).filter((s) => s && s.ok === false).slice(0, 5)
          .map((s) => ({ nombre: s.nombre, resumen: String(s.resumen || "").slice(0, 300) })),
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

  // Carril concurrente para subagentes: si ya hay un turno activo
  // y el mensaje del usuario es una pregunta o consulta (no una orden
  // que escribe en disco), se atiende de inmediato en paralelo sin
  // esperar en la cadena al agente principal.
  const { decidirTurno } = require("./nuevo/despacho");
  const decisionPrevia = decidirTurno(input.message);
  const esConsultaParalela = _active > 0
    && !input.planAuthorizedExecution
    && decisionPrevia.carril !== "ORDEN";

  if (esConsultaParalela) {
    return run();
  }

  // Serialización de turnos con mutación: la cadena garantiza que dos órdenes
  // nunca se pisan al escribir código en disco.
  const result = _chain.then(run, run);
  _chain = result.then(() => {}, () => {});
  return result;
}

function stopChat() {
  for (const { controller } of _runs.values()) {
    try { controller.abort(); } catch { /* ignore */ }
  }
  return { stopped: true, text: "Detenido." };
}

function cancelChatRun(runId) {
  const entry = _runs.get(String(runId || ""));
  if (!entry) return false;
  try { entry.controller.abort(); } catch { /* ignore */ }
  return true;
}

function isChatRunning() {
  return _active > 0 || _runs.size > 0;
}

// Dirección en vuelo (Steering vivo): inyecta la instrucción prioritaria
// directamente en la cola del turno en curso para que el modelo la
// incorpore en la siguiente llamada sin tener que reiniciar el turno.
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
  // Infraestructura compartida que la entrada vieja re-exportaba y
  // que sigue viva por sus propios consumidores:
  tools: require("./tools"),
  snapshot: require("./snapshot"),
  processRunner: require("./process-runner"),
  visionInspector: require("./vision-inspector"),
  globalMemory: require("./global-memory"),
  threadMemory: require("./thread-memory"),
};
