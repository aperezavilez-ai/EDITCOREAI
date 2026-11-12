"use strict";

const path = require("path");
const {
  classify,
  extractListTarget,
  isFullAccess,
  resolveExecutionMode,
  MODES,
  CHAT_READ_TOOLS,
  WRITE_TOOLS,
  SUB_AGENTS,
  APPROVAL_RE,
  isContinuePhrase,
  // [EDITCORE-INTEGRAL-B5] Modo efectivo único + anuncio de chat nuevo.
  normalizePermissionMode,
  buildModeAnnouncement,
} = require("./classify");
const { searchBrainDocs, ensureCoreProjectBrain, listBrainDocs } = require("./brain-ingest");
const { ChatSession } = require("./session");
const { PersistentMemory } = require("./memory");
const { skillsPrompt, SKILL_IDS, buildSkillsTurn } = require("./skills-catalog");
const { runExplorer } = require("./subagents/explorer");
const { runAnalyst } = require("./subagents/analyst");
const { runImplementer } = require("./subagents/implementer");
const { runVerifier } = require("./subagents/verifier");
const forensic = require("./forensic-checks");

const DEEP_FORENSIC_REQUEST = /forens|auditor|audita|errores|bugs?\b|fallas?|fallos?|diagn[oó]stic|qu[eé]\s+(est[aá]\s+)?(mal|roto|falla)|revisi[oó]n\s+(completa|total|profunda)|revisa\s+todo|verifica|a\s+fondo|completo/i;
const BUILD_REQUEST = /\bbuild\b|compila|compilaci[oó]n/i;

// [EDITCORE-ADD] Red neuronal entre agentes (opcional). Si el archivo no está, no-op.
let agentNetwork = null;
try {
  const _an = require("./agent-network");
  agentNetwork = _an.globalNetwork || new _an.AgentNetwork();
} catch (_) { agentNetwork = null; }
// [/EDITCORE-ADD]

// [EDITCORE-STACK] Fases 1–5 — memoria, A2A, harness, disk, surface (opcional, no-op si falta)
let _editcoreStackCache = new Map();
async function getEditcoreStack(projectRoot) {
  if (!projectRoot) return null;
  const key = require("path").resolve(String(projectRoot));
  if (_editcoreStackCache.has(key)) return _editcoreStackCache.get(key);
  try {
    const { getStack } = require("../runtime/editcore-stack");
    const stack = await getStack(key);
    _editcoreStackCache.set(key, stack);
    return stack;
  } catch (e) {
    console.warn("[EDITCORE-STACK] no disponible:", e && e.message ? e.message : e);
    return null;
  }
}
// [/EDITCORE-STACK]

// [EDITCORE-ELITE-UI] Fase 6 — política visual + pipeline de producto
let eliteUiPolicy = null;
let productPipeline = null;
try {
  eliteUiPolicy = require("../runtime/elite-ui-policy");
} catch (_) { eliteUiPolicy = null; }
try {
  productPipeline = require("../runtime/product-pipeline");
} catch (_) { productPipeline = null; }
let repairGuard = null;
try {
  repairGuard = require("./repair-guard");
} catch (_) { repairGuard = null; }

let buildBaseGuard = null;
try {
  buildBaseGuard = require("./build-base-guard");
} catch (_) { buildBaseGuard = null; }
let agentCoordination = null;
try {
  agentCoordination = require("../runtime/agent-coordination");
} catch (_) { agentCoordination = null; }
// [EDITCORE-INTEGRAL-B9] agent-parallel ya NO se importa en el
// orquestador: «Fase 8» salió del camino vivo (ver la nota en
// _handleCore). El módulo sigue existiendo para uso explícito.
let activeEditorContext = null;
try {
  activeEditorContext = require("../runtime/active-editor-context");
} catch (_) { activeEditorContext = null; }
let ideReviewQueue = null;
try {
  ideReviewQueue = require("../runtime/ide-review-queue");
} catch (_) { ideReviewQueue = null; }
// [/EDITCORE-ELITE-UI]

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
// [EDITCORE-INTEGRAL-B6] Sesión viva: detección NO_SESSION y mensaje
// de sesión compartidos (nunca el consejo de la API key).
const { isNoSessionError, SESSION_EXPIRED_MESSAGE } = require("../runtime/http-error-taxonomy");
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
const globalMemory = require("./global-memory");
const taskQueue = require("./task-queue");
const threadCore = require("./thread-core");
const { pickModel } = require("./model-router");
const fs = require("fs");
// [EDITCORE-V491-A] Visión real: la captura del preview se adjunta al
// modelo como parte de imagen reutilizando el formato multimodal de
// los adjuntos del usuario (vision-intake), no como metadatos de texto.
const { buildOpenAiImageContent, modelSupportsVision } = require("../runtime/vision-intake");

// [EDITCORE-V491-C] PLAN PRESENTADO, PERSISTIDO: cuando el despacho
// corta una escritura con needsAuthorization («Pregunta antes»), la
// llamada propuesta (herramienta, archivo y cambio) se guarda asociada
// a la conversación en .editcore/presented-plan.json. Antes la
// autorización viajaba como booleano y el turno del «procede»
// RECONSTRUÍA la tarea desde el historial, re-derivando otro cambio
// (en vivo, v4.9.0: el «procede» de la C-1 terminó revirtiendo desde
// un snapshot y quitando un badge que no era lo presentado). Al
// autorizarse, el turno de ejecución recibe el plan como instrucción
// VINCULANTE y el cierre declara cualquier escritura fuera del plan.
const PRESENTED_PLAN_FILE = "presented-plan.json";
const PRESENTED_PLAN_MAX_CALLS = 12;

function presentedPlanFile(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", PRESENTED_PLAN_FILE);
}

function loadPresentedPlan(projectRoot, threadId) {
  if (!projectRoot) return null;
  try {
    const all = JSON.parse(fs.readFileSync(presentedPlanFile(projectRoot), "utf8"));
    const rec = all && typeof all === "object" ? all[String(threadId || "default")] : null;
    if (!rec || !Array.isArray(rec.calls) || !rec.calls.length) return null;
    return rec;
  } catch { return null; }
}

function savePresentedPlan(projectRoot, threadId, rec) {
  if (!projectRoot || !rec) return;
  try {
    const file = presentedPlanFile(projectRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let all = {};
    try { all = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { all = {}; }
    all[String(threadId || "default")] = rec;
    fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
  } catch { /* el plan es una ayuda de fidelidad: nunca tumba el turno */ }
}

function clearPresentedPlan(projectRoot, threadId) {
  if (!projectRoot) return;
  try {
    const file = presentedPlanFile(projectRoot);
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    if (all && typeof all === "object" && delete all[String(threadId || "default")]) {
      fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
    }
  } catch { /* ignore */ }
}

function presentedCallFrom(name, args = {}) {
  const clip = (v, n) => {
    const s = String(v == null ? "" : v);
    return s.length > n ? `${s.slice(0, n)}…[recortado]` : s;
  };
  return {
    name: String(name || ""),
    path: String(args.path || args.file || ""),
    content: args.content != null ? clip(args.content, 6000) : undefined,
    oldText: args.oldText != null ? clip(args.oldText, 3000) : undefined,
    newText: args.newText != null ? clip(args.newText, 3000) : undefined,
    command: args.command != null ? clip(args.command, 500) : undefined,
  };
}

function describePresentedPlan(rec) {
  const lines = (rec.calls || []).slice(0, PRESENTED_PLAN_MAX_CALLS).map((c, i) => {
    const bits = [`${i + 1}. ${c.name}${c.path ? ` en \`${c.path}\`` : ""}`];
    if (c.oldText != null && c.newText != null) bits.push(`cambia «${String(c.oldText).slice(0, 220)}» por «${String(c.newText).slice(0, 220)}»`);
    else if (c.content != null) bits.push(`escribe este contenido: «${String(c.content).slice(0, 220)}»`);
    else if (c.command) bits.push(`comando: ${c.command}`);
    return bits.join(" — ");
  });
  const parts = [
    "PLAN PRESENTADO Y AUTORIZADO POR EL USUARIO (vinculante): en el turno anterior presentaste ESTE cambio exacto y el usuario lo autorizó («procede»). Aplícalo TAL CUAL con las herramientas: no lo re-derives, no lo sustituyas por otro cambio ni escribas archivos fuera de esta lista. Si una llamada ya no aplica porque el archivo cambió desde entonces, dilo con el motivo exacto y detente en ese punto.",
    ...lines,
  ];
  if (rec.presentedText) parts.push(`Así lo presentaste: «${String(rec.presentedText).slice(0, 1200)}»`);
  return parts.join("\n");
}

function presentedPlanPaths(rec) {
  return [...new Set((rec?.calls || []).map((c) => String(c.path || "").replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))];
}
// [EDITCORE-INTEGRAL-B9] agent-bus ya no se importa aquí: el
// orquestador dejó de escribir el bus por turno (solo escritura,
// nadie lo leía). El módulo queda para uso explícito.
const { SELF_KNOWLEDGE_PROMPT, CONNECT_GUIDE_PROMPT, wantsConnectGuide } = require("./self-knowledge");

let projectMapApi = null;
try {
  projectMapApi = require("../runtime/project-map");
} catch (_) {
  projectMapApi = null;
}

let projectRoadmapApi = null;
try {
  projectRoadmapApi = require("../runtime/project-roadmap");
} catch (_) {
  projectRoadmapApi = null;
}

const DEFAULT_MAX_STEPS = 200;
const AUTHORIZED_MAX_STEPS = 1000;
const DEFAULT_TOTAL_TIMEOUT_MS = 3_600_000; // 60 min — el agente nunca se queda sin tiempo en tareas complejas
const HEARTBEAT_INTERVAL_MS = 5_000;
const ROADMAP_MIN_LENGTH = 500;
const MAX_PROMISE_RETRIES = 3;
const MAX_NO_WRITE_NUDGES = 2;
// [EDITCORE-INTEGRAL-B1] Compuertas de cierre PERSISTENTES: ya no son de un
// solo disparo ni se apagan en las dos últimas iteraciones; pueden empujar
// hasta MAX_CLOSE_NUDGES veces mientras quede al menos una iteración.
const MAX_CLOSE_NUDGES = 3;
// Análisis forense/quirúrgico exhaustivo
const ANALYSIS_MAX_STEPS = 200;
const ANALYSIS_TIMEOUT_MS = 1_800_000; // 30 min por turno en análisis

// [EDITCORE-INTEGRAL-B2] PRESUPUESTO AGREGADO DE turnContext. Cada bloque
// ya tenía su propio tope (Cerebro del proyecto ≤2.150, Cerebro service
// ≤3.200, memoria semántica ≤3.000, memoria global ≤1.200, extras del
// turno ~7.600, más roadmap/conexiones/cognitivo sin tope conjunto), pero
// la SUMA podía pasar de 20.000 caracteres y se re-pagaba en cada llamada
// del bucle. El presupuesto agregado es 16.000: cubre lo esencial del
// turno (protocolo/roadmap/errores verificados/idioma ≈ 4.000) + la
// política élite completa (~6.300) + un bloque de memoria grande, y corta
// el apilado patológico de TODOS los bloques a la vez. El expediente
// (≤3.500) NO entra en este presupuesto: buildMessageList lo antepone y
// es esencial — nunca lo amputa este corte. Al exceder, se conservan los
// bloques por prioridad (esencial → normal → accesorio) y se corta del
// FINAL con la marca declarada TURN_CONTEXT_TRUNCATION_MARKER.
const TURN_CONTEXT_MAX_CHARS = 16_000;
const TURN_CONTEXT_TRUNCATION_MARKER = "[contexto recortado por presupuesto]";
const CTX_TIER_ESSENTIAL = 0;
const CTX_TIER_NORMAL = 1;
const CTX_TIER_ACCESSORY = 2;

// [EDITCORE-INTEGRAL-B2] Aplica el presupuesto agregado a los bloques de
// contexto del turno. Entrada: [{ text, tier }] (o strings sueltos, que se
// tratan como tier normal). Salida: el texto unido, ≤ maxChars (salvo un
// único bloque esencial mayor que el presupuesto, que se corta también
// con marca: el tope es DURO). El orden final es por prioridad con orden
// de inserción estable dentro de cada tier; el contenido esencial jamás
// se amputa antes que el accesorio.
function applyTurnContextBudget(blocks, maxChars = TURN_CONTEXT_MAX_CHARS) {
  const cap = Math.max(500, Number(maxChars) || TURN_CONTEXT_MAX_CHARS);
  const entries = (Array.isArray(blocks) ? blocks : [])
    .map((b, idx) => {
      if (typeof b === "string") return { text: b, tier: CTX_TIER_NORMAL, idx };
      return { text: String(b?.text || ""), tier: Number.isFinite(b?.tier) ? b.tier : CTX_TIER_NORMAL, idx };
    })
    .filter((e) => e.text && e.text.trim())
    .sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx));
  const joined = entries.map((e) => e.text).join("\n\n");
  if (joined.length <= cap) return joined;
  const marker = `\n\n${TURN_CONTEXT_TRUNCATION_MARKER}`;
  const room = Math.max(0, cap - marker.length);
  const kept = [];
  let used = 0;
  for (const entry of entries) {
    const sep = kept.length ? 2 : 0;
    if (used + sep + entry.text.length <= room) {
      kept.push(entry.text);
      used += sep + entry.text.length;
      continue;
    }
    // Bloque frontera: se conserva su cabeza y el resto se corta.
    const partialRoom = room - used - sep;
    if (partialRoom > 120) kept.push(entry.text.slice(0, partialRoom).trimEnd());
    break;
  }
  return `${kept.join("\n\n")}${marker}`;
}

const LEADERSHIP_PROMPT = [
  "Eres EditCoreAI. Si la orden requiere cambios en disco o comandos, ejecútalos directamente con las herramientas disponibles (write_file, replace_in_file, run_command).",
  "Narra brevemente qué hiciste y el resultado concreto. No pidas confirmaciones redundantes si tienes permisos activos.",
].join("\n");

const LIVE_NARRATION_PROMPT = "Voz EditCoreAI: directa, técnica y en español.";

const MARKDOWN_FORMAT_PROMPT = "Formato: Markdown estructurado con títulos (##), listas y código en backticks.";

const CAPABILITIES_PROMPT = "";

// CHAT_READ_TOOLS se importa de classify.js (única fuente de clasificación);
// aquí vivía una copia a mano que ya había derivado (web_scrape, list_brain).
const CHAT_MAX_STEPS = 6;
const PENDING_EXTERNAL_TTL_MS = 10 * 60_000;
const BRAIN_CONTEXT_MIN_SCORE = 2;

const CHAT_TOOLS_PROMPT = [
  "MODO CHARLA (SOLO LECTURA):",
  "- Tienes herramientas de lectura (list_files, read_file, search_files, web_search, git_status).",
  "- Responde directo a la consulta del usuario sin rodeos ni menús de opciones.",
].join("\n");

const PROJECTLESS_CHAT_PROMPT = [
  "MODO CONVERSACIÓN SIN PROYECTO:",
  "- Todavía NO hay proyecto abierto: no tienes herramientas de disco y no puedes leer ni escribir archivos. No prometas revisar carpetas ni crear archivos en este modo.",
  "- Tu trabajo es conversar: responder preguntas, ayudar a pensar la idea, proponer arquitectura, funciones y un plan de trabajo.",
  "- Si te piden analizar, corregir o abrir un proyecto existente, di con claridad que no hay ninguno abierto y ofrece dos salidas: abrirlo desde Proyectos o crear uno nuevo en modo Agente desde esta conversación. Nunca finjas que lo analizaste.",
  "- Cuando el usuario decida construir (\"créalo\", \"hazlo\", \"empecemos\"), dile que cambie a modo Agente y lo pida ahí: la app crea el proyecto desde esta misma conversación y el agente construye con todo lo platicado como contexto. No le pidas abrir carpetas a mano ni escribir rutas.",
].join("\n");

const LIST_ONLY_PROMPT = [
  "MODO LISTADO: Responde brevemente con las carpetas y archivos del primer nivel del path indicado.",
].join("\n");

const ANALYSIS_MODE_PROMPT = [
  "MODO ANALISIS (SOLO LECTURA):",
  "1. Revisa los archivos clave con read_file o la evidencia recolectada.",
  "2. Reporta de forma concisa los errores encontrados y qué falta exactamente para que el proyecto funcione.",
  "3. Termina indicando la acción o comando concreto para corregirlo.",
].join("\n");

let eliteCommunication = null;
try { eliteCommunication = require("../runtime/elite-communication-policy"); } catch (_) { eliteCommunication = null; }

let autoRouterProtocol = null;
try { autoRouterProtocol = require("../runtime/auto-router-transparent-protocol"); } catch (_) { autoRouterProtocol = null; }

let requestScopePolicy = null;
try { requestScopePolicy = require("../runtime/request-scope-policy"); } catch (_) { requestScopePolicy = null; }

function isRoadmapUsable(root) {
  if (!root || !projectRoadmapApi?.readRoadmap) return false;
  try {
    const rm = projectRoadmapApi.readRoadmap(root);
    if (!rm?.exists) return false;
    const content = String(rm.content || "");
    if (content.length < ROADMAP_MIN_LENGTH) return false;
    const isStub = typeof projectRoadmapApi.isStubRoadmap === "function" ? projectRoadmapApi.isStubRoadmap(content) : false;
    return !isStub;
  } catch { return false; }
}

function stripOpenEndedClosings(text = "") {
  let value = String(text || "");
  const lines = value.split("\n");
  while (lines.length) {
    const last = (lines[lines.length - 1] || "").trim();
    if (!last) { lines.pop(); continue; }
    const isOffer =
      (/^(?:\u00bf?quer[e\u00e9]s?|\u00bf?quieres?|\u00bf?deseas?|\u00bf?pasamos|\u00bf?seguimos|\u00bf?te\s+gustar|\u00bf?prefer)/i.test(last)
        || /\b(?:quer[e\u00e9]s?|quieres?)\s+que\b/i.test(last))
      && last.includes("?");
    if (isOffer) { lines.pop(); continue; }
    break;
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatAgentVisibleText(text = "") {
  let value = String(text || "");
  if (!value.trim()) return value;
  try {
    if (eliteCommunication?.stripEliteFiller) value = eliteCommunication.stripEliteFiller(value);
    else if (eliteCommunication?.normalizeSpanishProse) {
      value = eliteCommunication.normalizeSpanishProse(value);
      if (eliteCommunication?.ensureChatParagraphs) value = eliteCommunication.ensureChatParagraphs(value);
    }
  } catch { /* keep */ }
  value = stripOpenEndedClosings(value);
  return String(value || "").replace(/\n{3,}/g, "\n\n").trim();
}

function userWantsDiskMutation(message = "") {
  return /\b(?:crea(?:r|ción)?|genera(?:r)?|implementa(?:r|lo|los|la|las)?|escrib[ie]|haz|hacer|hazlo|hazlos|arma|scaffold|nuevo\s+proyecto|app\b|muev\w*|copiar?|guarda(?:r)?|fix|corrige|corrije|corrijelo|corrijelos|corrigelo|corrigelos|arregla|arreglalo|arreglalos|repara|reparalo|reparalos|soluciona|solucionalo|solucionalos|aplica|aplicalo|aplicalos|modifica|modificar|modificalo|modificalos|modificaciones|añad[ie]|agrega|agregalo|agregalos)\b/i.test(String(message || ""))
    || FIX_INTENT_RE.test(String(message || ""));
}

const FIX_INTENT_RE = /\b(?:corr[eií][gj](?:e|ir|alo|alos|ala|alas|eme|me|as)?(?:me|lo|la|los|las)?|arregl(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|repar(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|solucion(?:a|á|ar|alo|alos|ala|alas|ame|as)?(?:me|lo|la|los|las)?|resu[eé]lve(?:lo|la|los|las|me)?|resolver(?:lo|la|los|las|me)?|fix(?:ea)?|implementa(?:r|lo|los|la|las)?|aplica(?:r|lo|los|la|las)?|modifica(?:r|lo|los|la|las)?|modificaciones|agrega(?:r|lo|los|la|las)?|añad[ei]r?)\b/i;

// [EDITCORE-CONSOLIDADA] Léxico de intención de mutación CENTRALIZADO.
// El suplemento vivía DUPLICADO como regex inline en dos compuertas (el
// cierre propositivo de presencia y la garantía determinista del
// «procede»), y ninguna de las dos conocía los verbos de MEJORA: en
// vivo, «Ahora mejora el hero» no disparó ninguna compuerta y el
// agente cerró sin proponer ni hacer nada. Ahora hay UNA sola fuente:
// FIX_INTENT_RE + suplemento histórico + verbos estéticos/de mejora.
// Los verbos estéticos cuentan como ORDEN, no como hipótesis: en
// condicional («¿cómo mejoraría…?», «¿qué optimizarías?») no hay
// pedido de mutación y el helper devuelve false por esa vía — las
// compuertas conservan además TODOS sus guardas actuales (modo, kind,
// autorización), que son los que deciden si la intención es accionable.
const MUTATION_SUPPLEMENT_RE = /\b(?:reescrib\w*|cr(?:e|é)(?:a|á)\w*|constru\w*|elimin\w*|borra\w*|actualiz\w*|instal\w*)\b/i;
const MUTATION_AESTHETIC_RE = /\b(?:mejor(?:a|á|ar|alo|ala|alos|alas|ame|ando|ado|ada)\w*|optimi\w+|rediseñ\w+|renov\w+|moderni\w+|embelle\w+|pul(?:ir|e|iendo|ido)\w*|ajust\w+\s+visualmente)\b/i;
const MUTATION_AESTHETIC_CONDITIONAL_RE = /\b(?:mejorarí\w*|optimizarí\w*|rediseñarí\w*|renovarí\w*|modernizarí\w*|embellecerí\w*|pulirí\w*)\b/i;

function hasMutationIntent(text = "") {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (FIX_INTENT_RE.test(t) || MUTATION_SUPPLEMENT_RE.test(t)) return true;
  if (!MUTATION_AESTHETIC_RE.test(t)) return false;
  if (MUTATION_AESTHETIC_CONDITIONAL_RE.test(t)) return false;
  return true;
}

// [EDITCORE-REVISION-VISUAL] Detector de turnos de REVISIÓN VISUAL: el
// usuario PREGUNTA por las imágenes o el aspecto de una página que YA
// existe (no pide construirla ni corregirla). Fallo probado en vivo 3
// veces (P-3): en un turno así el agente leía archivos y juzgaba por el
// nombre del archivo y el texto alt, porque capture_preview_screenshot
// solo se ofrecía en tareas de construcción (_uiTask) y la regla de
// mirar viajaba con la política de construcción — en un turno de
// pregunta no había ni ojos ni regla en la sala.
const VISUAL_SUBJECT_RE = /\b(?:im[áa]gen(?:es)?|fotos?|fotograf[íi]as?|hero|banner|portada|aspecto|apariencia)\b/i;
const VISUAL_REVIEW_INTENT_RE = /\b(?:corresponde\w*|revisa\w*|mira\w*|mir[áa]\w*|dime\s+si|est[áa]n\s+bien|se\s+ven\s+bien|c[óo]mo\s+se\s+ve|checa\w*|verifica\w*|juzga\w*)\b/i;

function isVisualReviewRequest(message = "") {
  const text = String(message || "");
  if (!text.trim()) return false;
  if (!VISUAL_SUBJECT_RE.test(text) || !VISUAL_REVIEW_INTENT_RE.test(text)) return false;
  // Construir o corregir NO es revisar: si el pedido trae intención de
  // mutación manda la acción (construcción y reparación ya tienen sus
  // propios ojos y protocolos); esto es solo para el juicio sin cambios.
  if (userWantsDiskMutation(text)) return false;
  return true;
}

// [EDITCORE-REVISION-VISUAL] Protocolo del turno de revisión visual: va
// en el contexto del turno, NO en la política de construcción (que en
// un turno de pregunta ni siquiera entra). Compacto a propósito.
const VISUAL_REVIEW_PROTOCOL = [
  "REVISIÓN VISUAL — este turno PREGUNTA por las imágenes o el aspecto de una página que YA existe. Tu juicio sale de lo que VES, no de lo que lees:",
  "1) Llama capture_preview_screenshot sobre el PREVIEW ACTIVO del IDE (su URL ya está en tu contexto) y juzga la imagen real: hero, tarjetas y demás secciones.",
  "2) PROHIBIDO juzgar por el nombre del archivo, el texto alt o los comentarios del código: esas etiquetas las escribió quien eligió las fotos y no prueban nada.",
  "3) Si la captura falla o no hay preview activo, dilo con esas palabras en vez de certificar: un juicio sin captura queda marcado como no verificado.",
  "4) Responde con veredicto POR ZONA (hero, tarjetas, resto): qué se ve, si corresponde al negocio y la discrepancia exacta si la hay.",
].join("\n");

// [EDITCORE-V492-3] ANTI-CONFABULACIÓN DE RECUERDOS (fallo en vivo 9.1
// de la v4.9.1): ante «¿Qué recuerdas del cambio de precios que hicimos
// la semana pasada?», el agente ACEPTÓ la premisa falsa adornando
// hechos VECINOS reales (Showcase.tsx tocado por testimonios y un
// descarte registrado) en vez de decir «no consta». Tres piezas con el
// mismo patrón de la revisión visual: (1) detección de la pregunta de
// recuerdo CON EVENTO, (2) protocolo inyectado al turno y (3) guarda de
// cierre DETERMINISTA: si la respuesta afirma el evento preguntado y el
// expediente no lo registra, el kernel antepone su corrección honesta
// (estilo banner, sin reescribir la respuesta del modelo).

const MEMORY_QUESTION_RE = /\b(?:qu[ée]\s+recuerdas|recuerdas\s+(?:el|la|los|las|de|del|que|c[óo]mo|cu[áa]ndo)|qu[ée]\s+(?:hicimos|cambiamos|modificamos|actualizamos|ajustamos)\b)/i;
const MEMORY_EVENT_PATTERNS = [
  /\b(cambios?|modificaci[óo]n|ajustes?|actualizaci[óo]n|subida|bajada)\s+de\s+([a-záéíóúñü][a-záéíóúñü ]{2,40})/i,
  /\b(?:cambiamos|modificamos|actualizamos|ajustamos|subimos|bajamos)\s+(?:los\s+|las\s+|el\s+|la\s+)?([a-záéíóúñü][a-záéíóúñü ]{2,40})/i,
];
const MEMORY_EVENT_KIND = { cambio: "cambio", cambios: "cambio", "modificación": "modificación", modificacion: "modificación", ajuste: "ajuste", ajustes: "ajuste", "actualización": "actualización", actualizacion: "actualización", subida: "subida", bajada: "bajada" };
const MEMORY_TOPIC_STOPWORDS = new Set(["que", "hicimos", "cambiamos", "modificamos", "actualizamos", "ajustamos", "semana", "pasada", "pasado", "ayer", "cuando", "donde", "esto", "esta", "este", "para", "pero", "tambien", "sobre", "hubo", "hizo", "hice"]);

function detectMemoryEventQuestion(message = "") {
  const text = String(message || "");
  if (!text.trim() || text.length > 400) return null;
  if (!MEMORY_QUESTION_RE.test(text)) return null;
  let loose = null;
  try { loose = require("./thread-memory").normalizeLoose; } catch { /* sin normalizador no hay detección */ }
  if (typeof loose !== "function") return null;
  for (let i = 0; i < MEMORY_EVENT_PATTERNS.length; i += 1) {
    const m = text.match(MEMORY_EVENT_PATTERNS[i]);
    if (!m) continue;
    const phraseRaw = i === 0 ? m[2] : m[1];
    const phrase = String(phraseRaw || "").split(/\s+(?:que|cuando|donde)\b/i)[0].trim().replace(/[?¿.,;:!]+$/g, "");
    const tokens = [...new Set(loose(phrase).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !MEMORY_TOPIC_STOPWORDS.has(w)))];
    if (!tokens.length) continue;
    const kind = i === 0 ? (MEMORY_EVENT_KIND[loose(m[1])] || "cambio") : "cambio";
    return { tokens, label: `${kind} de ${phrase}`, phrase };
  }
  return null;
}

const MEMORY_EVENT_PROTOCOL = [
  "PREGUNTA DE RECUERDO — este turno pregunta por un evento pasado concreto de esta conversación/proyecto. Responde SOLO desde los hechos recuperados del expediente SOBRE ESTE EVENTO:",
  "1) Si el expediente no registra ese evento, dilo con claridad («no consta», «no tengo registro de ese cambio») y NO lo completes con hechos vecinos: que el mismo archivo se haya tocado por OTRO motivo (otra sección, otro cambio) no prueba que este evento ocurriera.",
  "2) Un descarte registrado tampoco prueba el evento preguntado: un descarte habla de lo descartado, no del evento por el que se pregunta.",
  "3) Si el evento SÍ consta, cítalo con su hecho concreto (archivo y qué cambió), sin adornarlo con eventos que no consten.",
].join("\n");

// ¿El evento consta en el expediente? «Consta» = algún asiento del
// expediente (hecho destilado, decisión, nota, verificado, descartado o
// archivo tocado) menciona TODOS los tokens del tema. Los hechos
// vecinos que no nombran el tema NO cuentan, aunque sean del mismo
// archivo: eso es justo la mezcla que produjo la confabulación.
function memoryEventInDossier(projectRoot, tokens) {
  try {
    const tm = require("./thread-memory");
    const state = tm.loadProjectState(projectRoot);
    const entries = [];
    for (const f of state.facts || []) entries.push(tm.factText(f));
    for (const key of ["decisions", "notes", "verified", "discarded"]) {
      for (const d of state[key] || []) entries.push(String(d?.text || d || ""));
    }
    for (const f of state.files || []) entries.push(String(typeof f === "string" ? f : (f?.rel || f?.path || "")));
    return entries.some((entry) => {
      const blob = tm.normalizeLoose(entry);
      return tokens.every((t) => blob.includes(t));
    });
  } catch { return false; }
}

const MEMORY_ABSENCE_RE = /\b(?:no consta|no tengo registro|no aparece(?:\s+registrad\w*)?|no hay registro|no qued[óo] registrad\w*|no se registr[óo]|sin registro de|no recuerdo (?:ese|ning[úu]n|haber))/i;
const MEMORY_AFFIRM_RE = /\b(?:recuerdo que|se\s+(?:cambi[óo]|modific[óo]|actualiz[óo]|ajust[óo])|cambiamos|modificamos|actualizamos|ajustamos|hicimos\s+(?:el\s+|un\s+|ese\s+)?cambio|la semana pasada\s+(?:se|hicimos|cambiamos|modificamos))/i;

function memoryAnswerAffirmsEvent(answer, tokens) {
  const text = String(answer || "");
  if (!text.trim()) return false;
  if (MEMORY_ABSENCE_RE.test(text)) return false;
  let blob = text;
  try { blob = require("./thread-memory").normalizeLoose(text); } catch { /* texto crudo */ }
  const mentionsTopic = tokens.some((t) => blob.includes(t));
  return mentionsTopic && MEMORY_AFFIRM_RE.test(text);
}

// Guarda de cierre: devuelve el banner de corrección o "" si no aplica.
function memoryEventGuardBanner(memEvent, answerText, projectRoot) {
  if (!memEvent || !projectRoot) return "";
  if (memoryEventInDossier(projectRoot, memEvent.tokens)) return "";
  if (!memoryAnswerAffirmsEvent(answerText, memEvent.tokens)) return "";
  return `> ⚠️ **Ojo: en el expediente de esta conversación no consta ningún ${memEvent.label}.** Lo que sigue lo afirmó el modelo sin respaldo en los hechos registrados: puede estar mezclando hechos vecinos reales (del mismo archivo o de otro cambio) con un evento que no consta. Tómalo con esa reserva.`;
}

function textClaimsDiskMutation(text = "") {
  const raw = String(text || "");
  if (/<!DOCTYPE\s+html>/i.test(raw)) return true;
  return /(?:^|[^\wáéíóúñ])(he\s+(?:creado|escrito|generado|movido|implementado|guardado|corregido|arreglado|aplicado|modificado|actualizado|reemplazado)|cre[eé]\s+(?:la\s+)?(?:carpeta|archivo|proyecto)|escrib[ií]|mov[ií]|gener[eé]|implement[eé]|guard[eé]|correg[ií]|arregl[eé]|apliqu[eé]|modifiqu[eé]|actualic[eé]|reemplac[eé]|finalic[eé]\s+(?:la\s+)?(?:creaci[oó]n|implementaci[oó]n))(?![\wáéíóúñ])/i.test(raw);
}

function successfulWritePaths(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .filter((s) => (s.name === "write_file" || s.name === "replace_in_file" || s.name === "scaffold_project") && s.ok !== false && s.result?.ok !== false && !s.result?.unchanged)
    .map((s) => s.input?.path || s.result?.path || s.result?.projectRoot)
    .filter(Boolean);
}

// [EDITCORE-INTEGRAL-B1] Resumen FACTUAL del kernel: los hechos del cierre
// (qué archivo cambió y qué hunk real se aplicó) los construye el KERNEL
// desde los steps — args oldText/newText/content que ya viajan en cada paso
// de escritura — no la prosa libre del modelo. El texto del modelo puede
// acompañar, pero si exagera («cambié el fondo principal» habiendo tocado
// otra capa) el lector ve primero el hunk real. Extiende el patrón de los
// banners deterministas existentes; no los sustituye.
function summarizeHunkText(value, max = 90) {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "(vacío)";
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const SPECIALIST_ROLES_NOT_IMPLEMENTED = new Set(["security", "database", "ui_ux", "devops", "analyst"]);

// [EDITCORE-INTEGRAL-B1] Auditoría de pasos delegados al cerrar: un patch
// planned:true del implementer delegado JAMÁS es un hecho aplicado, y un
// rol especialista no implementado (que degrada a exploración) se declara
// como exploración, nunca como la auditoría/especialidad pedida.
function auditSubagentSteps(steps = []) {
  const findings = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || (s.name !== "invoke_subagent" && s.name !== "delegate_parallel")) continue;
    const result = s.result || {};
    const requestedRole = String(s.input?.role || result.requestedRole || "").toLowerCase();
    if (Array.isArray(result.applied)) {
      for (const patch of result.applied) {
        if (patch?.planned === true) {
          findings.push(`invoke_subagent${requestedRole ? ` (rol «${requestedRole}»)` : ""}: el patch en \`${patch.path || "?"}\` quedó **PLANIFICADO, NO aplicado** — ningún archivo cambió por esa delegación.`);
        }
      }
    }
    if (result.planned === true) {
      findings.push(`invoke_subagent${requestedRole ? ` (rol «${requestedRole}»)` : ""}: el resultado quedó **PLANIFICADO, NO aplicado**.`);
    }
    const degraded = result.degradedRole === true
      || (s.name === "invoke_subagent" && SPECIALIST_ROLES_NOT_IMPLEMENTED.has(requestedRole) && result.mode === "parallel-explore");
    if (degraded) {
      findings.push(`invoke_subagent (rol «${requestedRole}»): ese rol **no existe como especialista** en EditCoreAI; lo que corrió fue exploración de solo lectura, no la tarea especializada pedida.`);
    }
    if (s.name === "delegate_parallel" && Array.isArray(result.results)) {
      const failed = result.results.filter((r) => r && r.ok === false).length;
      if (failed > 0) findings.push(`delegate_parallel: ${failed} subagente(s) delegado(s) NO entregaron informe; su parte no está hecha.`);
    }
  }
  return findings;
}

function buildKernelFactSummary(steps = []) {
  const lines = [];
  const seenWrites = new Set();
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s) continue;
    if ((s.name === "write_file" || s.name === "replace_in_file" || s.name === "scaffold_project") && s.ok !== false && s.result?.ok !== false && !s.result?.unchanged) {
      const rel = String(s.input?.path || s.result?.path || s.result?.projectRoot || "").replace(/\\/g, "/");
      if (!rel) continue;
      const key = `${s.name}:${rel}:${summarizeHunkText(s.input?.oldText || "", 40)}:${summarizeHunkText(s.input?.newText || s.input?.content || "", 40)}`;
      if (seenWrites.has(key)) continue;
      seenWrites.add(key);
      if (s.name === "replace_in_file" && (s.input?.oldText != null || s.input?.newText != null)) {
        lines.push(`- \`${rel}\`: «${summarizeHunkText(s.input?.oldText)}» → «${summarizeHunkText(s.input?.newText)}»`);
      } else if (s.name === "scaffold_project") {
        lines.push(`- \`${rel}\`: base del proyecto sentada con scaffold_project`);
      } else {
        const body = String(s.input?.content ?? "");
        lines.push(`- \`${rel}\`: archivo escrito por el kernel (${body ? `${body.split(/\r?\n/).length} líneas, ${body.length} caracteres` : "sin contenido registrado en el paso"})`);
      }
    }
    // [EDITCORE-INTEGRAL-B4] Una reversión aplicada también es un hecho
    // del turno: el archivo volvió a su snapshot previo.
    if (s.name === "rollback_last_change" && s.ok !== false && s.result?.ok === true) {
      const rel = String(s.result?.path || s.input?.path || "").replace(/\\/g, "/");
      if (rel) lines.push(`- \`${rel}\`: última escritura revertida desde el snapshot ${s.result?.snapshotId || ""} (rollback_last_change)`);
    }
    // Escrituras REALES hechas por el implementer delegado (vía applyWrite/
    // applyReplace cableadas a tools con lock): son hechos, con su origen.
    if (s.name === "invoke_subagent" && Array.isArray(s.result?.applied)) {
      for (const patch of s.result.applied) {
        if (patch?.ok === true && patch?.planned !== true && patch?.path) {
          lines.push(`- \`${String(patch.path).replace(/\\/g, "/")}\`: cambio aplicado por el subagente implementer delegado (${patch.mode || "write"})`);
        }
      }
    }
  }
  const audit = auditSubagentSteps(steps);
  if (!lines.length && !audit.length) return "";
  const out = ["## 🧾 Hechos del turno (kernel)", ""];
  if (lines.length) {
    out.push("Cambios que el kernel SÍ aplicó en disco (desde los pasos reales, no desde el relato):", "", ...lines, "");
  } else {
    out.push("El kernel no registró ninguna escritura aplicada en este turno.", "");
  }
  if (audit.length) {
    out.push("Auditoría de lo delegado:", "", ...audit.map((f) => `- ${f}`), "");
  }
  return out.join("\n").trim();
}

async function runPostWriteVerify(projectRoot, writtenPaths, onProgress, opts = {}) {
  const paths = [...new Set((Array.isArray(writtenPaths) ? writtenPaths : []).map((p) => String(p || "").replace(/\\/g, "/").trim()).filter(Boolean))].slice(0, 3);
  if (!paths.length || !projectRoot) return [];
  const reports = [];
  for (const rel of paths) {
    try {
      onProgress?.({ phase: "subagent", name: "verifier", text: `Verificando ${rel}…` });
      const v = await runVerifier({
        projectRoot,
        path: rel,
        onProgress,
        timeoutMs: 45_000,
        autoRollback: false,
        incremental: true,
        learn: true,
        // [EDITCORE-INTEGRAL-B6] La señal del turno llega al verifier
        // también en la verificación post-escritura.
        signal: opts.signal || undefined,
      });
      // [EDITCORE-INTEGRAL-B1] La causa concreta manda: si la verificación
      // falló, la note genérica («Sintaxis, imports y tests verificados»)
      // NO tapa result.error — primero el error real. Y un timeout blando
      // NO computa como ok a efectos de «verificado» (se muestra ⏱️).
      const failed = v?.ok === false || v?.result?.ok === false;
      const note = String((failed ? (v?.result?.error || v?.result?.note) : (v?.result?.note || v?.result?.error)) || "").slice(0, 280);
      reports.push({
        path: rel,
        ok: !failed && v?.softTimeout !== true,
        softTimeout: v?.softTimeout === true,
        note,
      });
    } catch (err) {
      reports.push({ path: rel, ok: false, softTimeout: false, note: String(err?.message || err).slice(0, 200) });
    }
  }
  return reports;
}

function formatVerifyBlock(reports = []) {
  if (!Array.isArray(reports) || !reports.length) return "";
  const lines = reports.map((r) => {
    if (r.softTimeout) return `- \`${r.path}\`: ⏱️ verificación tardó (cambios **conservados**)`;
    if (r.ok) return `- \`${r.path}\`: ✅ comprobación ligera OK`;
    return `- \`${r.path}\`: ⚠️ ${r.note || "check no pasó (sin rollback)"}`;
  });
  return `\n\n## 🔍 Verificación post-escritura\n\n${lines.join("\n")}\n`;
}

// [EDITCORE-REPAIR] Verificación REAL al cerrar el turno. La ligera por
// archivo no prueba que la app funciona: en la sesión VIXERAI el agente
// declaró "corregido" tres veces con la ligera en verde mientras el CSS
// no compilaba. Aquí se comprueba contra el proyecto corriendo (captura
// del preview activo, con errores de consola) o compilado (npm run
// build), y el resultado manda sobre la narrativa del modelo.
async function runRealVerification(projectRoot, opts = {}) {
  const previewUrl = String(opts.previewUrl || "").trim();
  // [EDITCORE-INTEGRAL-B6] Señal del llamador para la rama de build
  // (debajo): abortar MATA el proceso en curso, no abandona la promesa.
  const turnSignal = opts.signal || null;
  if (previewUrl) {
    try {
      const shot = await capture_preview_screenshot({ url: previewUrl, projectRoot });
      if (shot && shot.ok) {
        const errs = Array.isArray(shot.diagnostics?.consoleErrors)
          ? shot.diagnostics.consoleErrors.filter((e) => e && e.type !== "warning")
          : [];
        const ok = shot.renderOk === true && errs.length === 0;
        return {
          kind: "preview",
          ok,
          detail: ok ? "" : String(errs[0]?.text || (shot.diagnostics?.issues || [])[0] || "El preview no renderiza correctamente.").slice(0, 400),
        };
      }
    } catch { /* sin captura: cae al build */ }
  }
  let hasBuild = false;
  try {
    const pkg = JSON.parse(require("fs").readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    hasBuild = Boolean(pkg?.scripts?.build);
  } catch { /* sin package.json o ilegible */ }
  if (!hasBuild) return null;
  // [EDITCORE-INTEGRAL-B6] Antes: Promise.race de 150 s que ABANDONABA
  // la promesa sin matar el proceso (el build seguía tras Detener).
  // Ahora el timeout y la señal del turno abortan un AbortController
  // propio cuyo abortSignal llega a run_command → process-runner, que
  // MATA el árbol; la promesa perdedora ya no deja nada corriendo.
  const runCtrl = new AbortController();
  const onTurnAbort = () => { try { runCtrl.abort(); } catch { /* ignore */ } };
  if (turnSignal) {
    if (turnSignal.aborted) runCtrl.abort();
    else turnSignal.addEventListener("abort", onTurnAbort, { once: true });
  }
  let runTimer = null;
  let run;
  try {
    run = await Promise.race([
      tools.execute("run_command", { command: "npm run build" }, projectRoot, true, { abortSignal: runCtrl.signal }),
      new Promise((resolve) => { runTimer = setTimeout(() => { try { runCtrl.abort(); } catch { /* ignore */ } resolve({ ok: false, softTimeout: true }); }, 150_000); }),
    ]);
  } finally {
    if (runTimer) clearTimeout(runTimer);
    if (turnSignal) { try { turnSignal.removeEventListener("abort", onTurnAbort); } catch { /* ignore */ } }
  }
  if (turnSignal?.aborted || run?.aborted) return { kind: "build", ok: false, aborted: true, detail: "Verificación real detenida por el usuario (Detener): el proceso fue terminado." };
  if (run?.softTimeout) return { kind: "build", ok: false, softTimeout: true, detail: "El build no concluyó en 150 s." };
  const blob = `${run?.stderr || ""}\n${run?.output || ""}`;
  const errLine = blob.split(/\r?\n/).map((l) => l.trim()).filter((l) => /error|failed|cannot|✗/i.test(l))[0] || "";
  return { kind: "build", ok: run?.ok === true, detail: run?.ok ? "" : String(errLine || run?.error || "El build falló.").slice(0, 400) };
}

function formatRealVerifyBlock(rv) {
  const what = rv.kind === "preview" ? "Captura del preview activo (render + errores de consola)" : "`npm run build`";
  if (rv.ok) return `\n\n## ✅ Verificación real\n\n- ${what}: **aprobada** — el resultado de este turno quedó confirmado contra el proyecto corriendo/compilado, no solo contra los archivos editados.\n`;
  if (rv.softTimeout) return `\n\n## ⏱️ Verificación real\n\n- ${what}: no concluyó a tiempo — el resultado de este turno queda **sin confirmar**.\n`;
  return `\n\n## ❌ Verificación real\n\n- ${what}: **FALLÓ** — ${rv.detail}\n`;
}

function formatRealVerifyBanner(rv) {
  const what = rv.kind === "preview" ? "la captura del preview activo" : "el build del proyecto";
  return `## ⚠️ OJO: LA VERIFICACIÓN REAL FALLÓ — EL PROBLEMA SIGUE\n\nLa comprobación automática posterior a los cambios (${what}) falló: ${rv.detail}\n\nLo que sigue es la explicación del modelo, pero el proyecto **todavía no funciona**. No lo des por corregido.\n\n---\n\n`;
}

async function appendRealVerification(projectRoot, written, steps, textOut, onProgress, opts = {}) {
  try {
    if (!Array.isArray(written) || !written.length || !projectRoot) return textOut;
    const buildAffecting = repairGuard ? written.some((p) => repairGuard.isBuildAffectingPath(p)) : false;
    // [EDITCORE-INTEGRAL-B3] Si el propio turno YA trae una verificación
    // real aprobada (posterior a la escritura y relacionada con el
    // cambio, el criterio del Bloque 1), el hecho se ESCRIBE en el
    // expediente TAMBIÉN en turnos de CREACIÓN: antes esta vía devolvía
    // en silencio y noteVerified solo se alimentaba en reparación o en
    // rutas build-affecting, así que un turno normal de creación no
    // generaba ni verificado ni descartado. Un intento con timeout
    // blando (softTimeout) JAMÁS se registra — ni como verificado ni
    // como descartado —: el criterio del expediente sobre verificaciones
    // blandas es intocable y aquí se respeta igual.
    // [EDITCORE-INTEGRAL-B3] Los pasos marcados softTimeout se EXCLUYEN
    // de la comprobación: aunque un resultado tardío trajera ok:true,
    // una verificación que no concluyó no afirma nada.
    const stepsForVerified = (Array.isArray(steps) ? steps : []).filter((s) => !(s && (s.softTimeout === true || s.result?.softTimeout === true)));
    if (repairGuard && repairGuard.turnHasPassingRealVerification(stepsForVerified, written)) {
      try {
        const tm = threadCore && threadCore.threadMemory;
        if (tm && typeof tm.noteVerified === "function") {
          const usedCapture = stepsForVerified.some((s) => s && s.name === "capture_preview_screenshot" && s.result?.renderOk === true);
          const what = usedCapture ? "captura del preview" : "verificación real del turno (build/test/typecheck)";
          tm.noteVerified(projectRoot, `Verificado (${what}): OK — ${String(written.slice(0, 3).join(", "))}`, true);
        }
      } catch { /* el expediente nunca tumba el turno */ }
      return textOut;
    }
    if (opts.repairTask !== true && !buildAffecting) return textOut;
    onProgress?.({ phase: "subagent", name: "verifier", text: "Verificación real: capturando el preview o compilando el proyecto…" });
    // [EDITCORE-INTEGRAL-B6] La señal del turno viaja a la verificación real.
    const rv = await runRealVerification(projectRoot, { previewUrl: opts.previewUrl, signal: opts.signal || null });
    if (!rv) return textOut;
    // [EDITCORE-DOSSIER] La verificación real se ESCRIBE en el expediente:
    // si pasó, el próximo turno no la re-verifica; si falló, la hipótesis
    // queda descartada y no se reintenta el mismo arreglo a ciegas. Sin
    // esto, cada turno volvía a diagnosticar desde cero (sesión VIXERAI).
    try {
      const tm = threadCore && threadCore.threadMemory;
      if (tm && typeof tm.noteVerified === "function" && !rv.softTimeout) {
        const what = rv.kind === "preview" ? "captura del preview" : "npm run build";
        if (rv.ok === true) {
          tm.noteVerified(projectRoot, `Verificado (${what}): OK — ${String(written.slice(0, 3).join(", "))}`, true);
        } else {
          // La verificación falló: el arreglo intentado queda descartado.
          // Un timeout blando NO se registra: sin concluir no es ni
          // verificado ni descartado, y registrarlo mentiría al expediente.
          tm.noteVerified(projectRoot, `Arreglo descartado (${what}): ${String(rv.detail || "sin detalle").slice(0, 200)}`, false);
        }
      }
    } catch { /* el expediente nunca tumba el turno */ }
    const block = formatRealVerifyBlock(rv);
    if (rv.ok || rv.softTimeout) return String(textOut || "") + block;
    return formatRealVerifyBanner(rv) + String(textOut || "") + block;
  } catch { return textOut; }
}


function looksLikePromiseWithoutAction(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const promisesFuture = /(?:ahora|voy\s+a|luego|siguiente|empiezo|sigo|continu[oa]|procedo\s+a|voy\s+con|paso\s+a|en\s+el\s+pr[oó]ximo|cuando\s+termine)\s+(?:a\s+)?(?:leer|revisar|ver|abrir|analizar|buscar|escanear|recorrer|inspeccionar|verificar|ejecutar|correr|escribir|crear|editar|implementar)/i.test(raw);
  if (promisesFuture) return true;
  const claimsDoneWork = /\b(?:he\s+(?:le[ií]do|creado|escrito|generado|implementado|verificado|ejecutado|analizado)|le[ií]\s+el\s+archivo|ya\s+(?:est[aá]|qu[eé]d[oó])\s+(?:listo|creado|hecho))\b/i.test(raw);
  if (claimsDoneWork) return true;
  // Narración en curso: el modelo cierra el turno contando lo que ESTÁ
  // haciendo ("Sigue leyendo el archivo para ver si…") sin haber ejecutado
  // la herramienta. Es el mismo defecto que la promesa a futuro, en gerundio:
  // nunca es una respuesta final válida. (Las formas "sigo/voy a + infinitivo"
  // ya estaban; faltaban "sigue/continúa + gerundio".)
  const narratesOngoing = /^(?:sigue|siguiendo|contin[uú]a|continuando|ahora\s+sigue)\b[^.!?\n]{0,140}\b(?:leyendo|revisando|analizando|buscando|verificando|ejecutando|escribiendo|creando|editando|implementando|inspeccionando|escaneando|abriendo)\b/i.test(raw)
    || /\b(?:sigue|siguiendo)\s+(?:\w+\s+){0,3}?(?:leyendo|revisando|analizando|buscando|verificando|ejecutando)\b/i.test(raw);
  if (narratesOngoing) return true;
  return /(?:d[eé]jame|espera|un\s+momento|voy)\s+(?:revisar|leer|buscar|chequear)/i.test(raw);
}

function repairDanglingOutput(text, steps = [], userMessage = "", decision = {}) {
  const value = String(text || "").trim();
  // Solo se considera cortada si está vacía o termina colgando ("…y revisé el", "Voy a"); una respuesta que
  // termina en palabra sin punto ("corregí los errores", "- src/app.ts") es válida y se muestra tal cual.
  const isTrulyBroken = !value
    || /\s(?:y|o|de|del|la|el|los|las|en|con|para|por|que|a|al|un|una|se|lo|voy|ahora)$/i.test(value)
    || (value.length < 25 && /[a-záéíóúñ]$/i.test(value));
  if (!isTrulyBroken) return formatAgentVisibleText(value);

  const written = successfulWritePaths(steps);
  if (written.length > 0) {
    const lista = written.map((p) => `- \`${p}\``).join("\n");
    return formatAgentVisibleText(`## ✅ Cambios aplicados\n\n${lista}\n\nDecime la próxima tarea concreta.`);
  }

  const cmdSteps = steps.filter((s) => s.name === "run_command" || s.name === "run_diagnostic");
  if (cmdSteps.length > 0) {
    const last = cmdSteps[cmdSteps.length - 1];
    const out = String(last.result?.stdout || last.result?.output || last.result?.stderr || "").trim();
    if (out) return formatAgentVisibleText(`## ⚙️ Último comando\n\n\`\`\`\n${out.slice(0, 1200)}\n\`\`\``);
  }

  const readFiles = steps.filter((s) => s.name === "read_file" || s.name === "list_files").map((s) => s.input?.path).filter(Boolean);
  if (readFiles.length > 0) {
    const filesStr = readFiles.slice(0, 5).map((f) => `\`${f}\``).join(", ");
    return formatAgentVisibleText(`## 📁 Archivos revisados\n\n${filesStr}\n\nDecime qué hacer con esta evidencia.`);
  }

  return formatAgentVisibleText("## ℹ️ Respuesta\n\nNo completé la instrucción en este turno. Reformulá o indicá el archivo puntual.");
}

const DISK_READ_TOOLS = new Set(["read_file", "list_files", "search_files", "project_discovery", "codebase_map", "symbol_search", "dependency_search", "search_codebase_semantic", "run_command", "run_diagnostic"]);

function successfulDiskReads(steps = []) {
  return (Array.isArray(steps) ? steps : []).filter((s) => DISK_READ_TOOLS.has(s.name) && s.ok !== false && s.result?.ok !== false).length;
}

function groundUngroundedClaims(text, steps = [], userMessage = "", decision = {}, evidenceReads = 0) {
  if (decision?.kind === "LIST") return formatAgentVisibleText(String(text || "").trim());
  const written = successfulWritePaths(steps);
  if (written.length === 0 && textClaimsDiskMutation(text)) {
    return formatAgentVisibleText(
      "> ⚠️ **En este turno no se modificó ningún archivo en disco.** Lo que sigue es explicación del modelo, no cambios aplicados.\n\n" +
      String(repairDanglingOutput(text, steps, userMessage, decision) || "")
    );
  }
  if (decision?.kind === "ANALYZE" && successfulDiskReads(steps) + evidenceReads === 0 && String(text || "").trim().length > 280) {
    return formatAgentVisibleText(
      "> ⚠️ **Este análisis no se basa en lecturas del disco:** en este turno no se ejecutó ninguna herramienta de lectura con éxito.\n\n" +
      String(repairDanglingOutput(text, steps, userMessage, decision) || "")
    );
  }
  if (decision?.kind === "ANALYZE" || decision?.kind === "ASK" || decision?.kind === "CHAT" || decision?.allowWrite === false
    || /\b(?:sin\s+modificar|solo\s+(?:analiza|reporte|diagn[oó]stico)|reporte|an[aá]lisis|auditor[ií]a|resumen)\b/i.test(userMessage)) {
    return repairDanglingOutput(text, steps, userMessage, decision);
  }
  if (written.length > 0) return repairDanglingOutput(text, steps, userMessage, decision);
  return repairDanglingOutput(text, steps, userMessage, decision);
}

function wrapSystemPrompt(raw = "") {
  return String(raw || "").trim();
}

function scopeUserMessage(message = "", evidence = "") {
  if (requestScopePolicy?.buildScopedUserDirective) {
    try { return requestScopePolicy.buildScopedUserDirective(message, evidence); } catch { /* fall through */ }
  }
  return String(message || "");
}

let operatorConnectionsApi = null;
try { operatorConnectionsApi = require("../runtime/operator-connections-context"); } catch { operatorConnectionsApi = null; }

function buildConnectionsBlock(projectRoot) {
  if (!projectRoot || !operatorConnectionsApi) return "";
  try {
    const snap = operatorConnectionsApi.connectionsForProject ? operatorConnectionsApi.connectionsForProject({}, projectRoot) : null;
    if (operatorConnectionsApi.formatOperatorConnectionsMemory) return operatorConnectionsApi.formatOperatorConnectionsMemory(snap);
  } catch { /* ignore */ }
  return "";
}

function nextStepsClosingText(projectRoot, writtenFiles = [], steps = []) {
  if (writtenFiles.length > 0) {
    let reviewNote = "";
    try {
      const unified = require("../runtime/unified-review");
      const listed = unified.list(projectRoot);
      if (listed?.count > 0) {
        reviewNote = ` Review pendiente: **${listed.count}** archivo(s).`;
      }
    } catch { /* ignore */ }
    return "Cambios aplicados." + reviewNote;
  }
  if (steps.length > 0) {
    const toolNames = [...new Set(steps.map((s) => s.name).filter(Boolean))].slice(0, 5).join(", ");
    return "Herramientas usadas: " + toolNames + ".";
  }
  return "";
}

function ensureCognitiveMap(projectRoot) {
  if (!projectRoot || !projectMapApi?.ensureProjectMap) return null;
  try { return projectMapApi.ensureProjectMap(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null; }
  catch { return projectMapApi.loadProjectMap?.(projectRoot) || null; }
}

function formatCognitiveBlock(projectRoot) {
  // Context Pruning: no inyectar árbol de archivos ni mapa cognitivo en cada mensaje para ahorrar tokens
  return "";
}

function buildRoadmapFirstBlock(projectRoot) {
  // Context Pruning: no inyectar el roadmap completo ni session state en cada mensaje
  return "";
}

function recoverSoftToolFailure(name, args, result, projectRoot) {
  const soft = tools.isSoftToolFailure?.(name, result, args) || result?.soft === true;
  if (!soft) return { recovered: false, payload: result };
  const enriched = { ...(result || {}), soft: true, ooda: "continue", guidance: "Fallo leve: NO detengas la sesión. Relee contexto y reintenta." };
  if (name === "replace_in_file" && args?.path) {
    try {
      const read = tools.readFile(projectRoot, args.path, 4000);
      if (read?.ok) {
        enriched.autoRead = { path: args.path, content: String(read.content || "").slice(0, 3500) };
        enriched.guidance = "oldText no coincidió. Usa el contenido de autoRead para construir oldText EXACTO.";
      }
    } catch { /* ignore */ }
  }
  return { recovered: false, payload: enriched };
}

function formatToolActionNarration(name, args = {}) {
  const rel = String(args.path || "").replace(/\\/g, "/");
  const file = rel.split("/").filter(Boolean).pop() || rel;
  if (name === "write_file") return file ? `Creo \`${file}\`.` : "Creo archivo.";
  if (name === "replace_in_file") return file ? `Edito \`${file}\`.` : "Edito archivo.";
  if (name === "read_file") return file ? `Leo \`${file}\`.` : "Leo archivo.";
  if (name === "run_command") { const cmd = String(args.command || "").slice(0, 60); return cmd ? `Ejecuto \`${cmd}\`.` : "Ejecuto comando."; }
  if (name === "list_files") return "Listo la carpeta.";
  if (name === "search_files") { const q = String(args.query || "").slice(0, 40); return q ? `Busco \`${q}\`.` : "Busco."; }
  if (name === "web_search") { const q = String(args.query || "").slice(0, 40); return q ? `Busco en internet: \`${q}\`.` : "Busco en internet."; }
  if (name === "web_scrape") return "Leo URL.";
  if (name === "read_skill") { const s = String(args.name || args.skill || args.id || "").slice(0, 40); return s ? `Consulto la skill \`${s}\`.` : "Consulto una skill."; }
  if (name === "search_brain") return "Consulto el Cerebro.";
  if (name === "capture_preview_screenshot") return "Capturo el preview para verificar con la vista.";
  // [EDITCORE-INTEGRAL-B4] Narración de las herramientas nuevas/reales.
  if (name === "start_preview") return "Arranco el preview del proyecto en el IDE.";
  if (name === "rollback_last_change") return file ? `Revierte la última escritura de \`${file}\` desde su snapshot.` : "Revierte el último cambio desde su snapshot.";
  if (name === "git_status" || name === "git_log" || name === "git_diff") return "Inspecciono git.";
  if (name === "git_commit") return `Creo commit Git: "${String(args.message || "").slice(0, 50)}".`;
  if (name === "git_push") return "Envío cambios con git push.";
  if (name === "build_project") return "Compilando ejecutable del proyecto...";
  if (name === "install_skill") return `Instalo skill \`${String(args.skillName || "")}\`.`;
  if (name === "list_skills") return "Listo skills instaladas.";
  return "";
}

const APPROVAL_WORDS = new Set(["procede", "procedo", "adelante", "hazlo", "autorizado", "continua", "continúa", "ejecuta", "si", "sí", "ok", "dale", "va"]);

function persistKernelRoadmap(projectRoot, { task, steps, kind, text, completed } = {}) {
  if (!projectRoot) return false;
  const okSteps = (Array.isArray(steps) ? steps : []).filter((s) => s && s.ok !== false);
  const upperKind = String(kind || "").toUpperCase();
  if (upperKind === "CHAT" || upperKind === "STOP" || upperKind === "LIST" || okSteps.length === 0) return false;
  if (completed !== true) text = "";
  try {
    const { syncProjectRoadmap, buildRoadmapSyncFromRun } = require("../runtime/project-roadmap");
    const analysisMode = String(kind || "").toUpperCase() === "ANALYZE";
    const payload = buildRoadmapSyncFromRun({
      steps: Array.isArray(steps) ? steps : [],
      task: String(task || "").slice(0, 220),
      analysisMode,
      completed: completed === true,
      reportText: String(text || "").slice(0, 1800),
      status: completed ? (analysisMode ? "Análisis completado. Fase lista para avanzar." : "Ciclo finalizado.") : `Interrumpido tras ${okSteps.length} tool(s) OK.`,
      nextAction: completed ? "Proponer optimización o nueva funcionalidad." : "Continuar desde el estado actual.",
      phase: analysisMode ? "analisis" : "implementacion",
    });
    const changed = (Array.isArray(steps) ? steps : [])
      .filter((s) => s && s.ok !== false && ["write_file", "replace_in_file", "delete_file", "apply_diff", "create_project"].includes(String(s?.name || "")))
      .map((s) => String(s?.input?.path || s?.result?.path || "").replace(/\\/g, "/"))
      .filter(Boolean);
    if (changed.length) {
      payload.files = [...new Set([...(payload.files || []), ...changed])];
      payload.mutated = [...new Set([...(payload.mutated || []), ...changed])];
    }
    syncProjectRoadmap(projectRoot, payload);
    return true;
  } catch { return false; }
}

function detachLongRunningStreams(steps) {
  if (!Array.isArray(steps)) return;
  for (const s of steps) {
    const detach = s?.result?.detach;
    if (typeof detach === "function") { try { detach(); } catch { /* ignore */ } }
  }
}

function wantsCodeSearch(text) {
  return /\b(?:busca|buscar|encuentra|localiza|d[oó]nde\s+est[aá]|en\s+qu[eé]\s+archivo|signIn|signInWithPassword|\bauth\b|\blogin\b)\b/i.test(String(text || ""));
}

function wantsConnectionsCheck(text) {
  // Sin "qué falta" a secas: esa frase en una pregunta cualquiera
  // ("¿qué falta para que la IA funcione?") secuestraba el turno y forzaba
  // check_connections en cada paso. Hace falta contexto de conexión/deploy.
  return /\b(?:check_connections|conect(?:a|ar|iones)?|publica(?:r)?|deploy|checklist|github|vercel)\b/i.test(String(text || ""));
}

function maybeBlockRootListFiles(name, args, projectRoot, listOnly) {
  if (name !== "list_files") return null;
  if (listOnly === true) return null;
  const p = String(args?.path || "").trim();
  if (p && p !== "." && p !== "./" && p !== "") return null;
  return {
    ok: false,
    blocked: true,
    error: "list_files de la raiz bloqueado en este modo. No sustituye busqueda ni check_connections.",
    guidance: "Usa search_files, search_codebase_semantic, check_connections, o list_files('src').",
  };
}

function buildBrainContextBlock(projectRoot, query) {
  if (!projectRoot || projectRoot === ".") return "";
  try {
    const hits = searchBrainDocs(projectRoot, query, 3).filter((h) => h.score >= BRAIN_CONTEXT_MIN_SCORE);
    if (!hits.length) return "";
    const lines = hits.map((h) => `- **${h.title}**: ${String(h.text || "").slice(0, 700)}`);
    return `## CEREBRO DEL PROYECTO (documentos relevantes ya ingeridos)\n${lines.join("\n")}`;
  } catch { return ""; }
}

// IDIOMA DEL TURNO (presencia, 2026-11-10): el sistema ya decía «respondé
// siempre en español» y el modelo igual narraba en inglés — una línea fija
// y genérica no basta, y además EditCoreAI es multilingüe: la regla es
// ESPEJO del usuario. Se detecta el idioma del mensaje (conteo de palabras
// función) y se inyecta la directiva como dato del turno, junto al mensaje.
function turnLanguageDirective(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const es = (t.match(/\b(?:el|la|los|las|de|del|que|en|un|una|para|con|por|está|están|son|como|más|quiero|necesito|hace|hacer|cuando|donde|esto|esta|este|pero|también|tiene|puedes|debe|sería|hay|muy|ya|si|no|se|su|al|lo|mi|me|te|nos|les|era|han|fue)\b/g) || []).length;
  const en = (t.match(/\b(?:the|is|are|and|to|of|for|with|on|an|be|this|that|please|make|create|fix|when|where|what|should|would|from|have|has|was|were|will|can|could|not|but|all|any|had|her|his|its|our|their|then|than|too|very|just)\b/g) || []).length;
  if (es >= 2 && es > en) return "IDIOMA DEL USUARIO: ESPAÑOL. Toda tu salida VISIBLE de este turno va en español: el texto que acompaña a tus herramientas, tu análisis, tus propuestas, tus preguntas y tu cierre. Si tu razonamiento interno surge en otro idioma, al escribir para el usuario va en español — nada de mezclar inglés en el chat.";
  if (en >= 2 && en > es) return "USER LANGUAGE: ENGLISH. All your VISIBLE output this turn is in English: the text around your tool calls, your analysis, your proposals, your questions and your closing. Do not mix languages in the chat.";
  return "";
}

// Consulta AUTOMÁTICA al Cerebro real (brain-service vía helpers.brainSearch)
// al abrir el turno (contrato de turno): el agente ya no depende de acordarse
// de llamar search_brain — lo que el usuario instaló/curó en Herramientas →
// Cerebro (memoria global y del proyecto, conocimiento y skills instaladas)
// entra al contexto desde el primer mensaje, con presupuesto propio.
async function buildCerebroServiceBlock(projectRoot, query, helpers) {
  if (!projectRoot || projectRoot === "." || typeof helpers?.brainSearch !== "function") return "";
  const q = String(query || "").trim();
  if (!q) return "";
  let out = null;
  try {
    out = await Promise.race([
      Promise.resolve(helpers.brainSearch(projectRoot, q, { scope: "all", limit: 5 })),
      new Promise((resolve) => setTimeout(() => resolve(null), 6_000)),
    ]);
  } catch { return ""; }
  if (!out) return "";
  const lines = [];
  for (const m of (Array.isArray(out.memory) ? out.memory : []).slice(0, 4)) {
    const text = String(m?.content || m?.text || "").trim();
    if (text) lines.push(`- [memoria] **${String(m?.title || "recuerdo")}**: ${text.slice(0, 500)}`);
  }
  for (const k of (Array.isArray(out.knowledge) ? out.knowledge : []).slice(0, 4)) {
    const text = String(k?.text || k?.content || "").trim();
    if (text) lines.push(`- [conocimiento] \`${String(k?.path || k?.title || "instalado")}\`: ${text.slice(0, 500)}`);
  }
  for (const c of (Array.isArray(out.catalog) ? out.catalog : []).slice(0, 4)) {
    const name = String(c?.name || c?.id || "").trim();
    if (name) lines.push(`- [catálogo] **${name}**: ${String(c?.description || "").slice(0, 200)}`);
  }
  if (!lines.length) return "";
  return `## CEREBRO (lo instalado y recordado en EditCoreAI, relevante a este turno)\n${lines.join("\n")}`.slice(0, 3200);
}

// [EDITCORE-INTEGRAL-B6] Disciplina de las esperas previas al primer
// paso: la MISMA que el bloque del Cerebro (race con timeout de 6 s,
// fail-open declarado) MÁS chequeo de la señal de aborto. Antes
// memory/globalMemory.promptBlockSemantic() se esperaban sin tope ni
// señal: si el vector store se colgaba, el turno nunca arrancaba y
// Detener parecía muerto. Ahora, vencido el plazo o con stop, el
// turno arranca SIN ese bloque.
const SEMANTIC_MEMORY_TIMEOUT_MS = 6_000;
async function raceSemanticBlock(factory, { signal = null, timeoutMs = SEMANTIC_MEMORY_TIMEOUT_MS } = {}) {
  if (signal?.aborted) return "";
  let timer = null;
  let onAbort = null;
  try {
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((resolve) => { timer = setTimeout(() => resolve(""), timeoutMs); }),
      ...(signal ? [new Promise((resolve) => {
        onAbort = () => resolve("");
        signal.addEventListener("abort", onAbort, { once: true });
      })] : []),
    ]);
  } catch { return ""; } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) { try { signal.removeEventListener("abort", onAbort); } catch { /* ignore */ } }
  }
}

function formatExternalActionResult(name, result) {
  const label = name === "deploy_one_click" ? "Deploy" : name === "connect_project" ? "Conexión del proyecto" : "Publicación";
  // [EDITCORE-INTEGRAL-B8] publish_project ya trae la URL en la raíz
  // (publish-pipeline); liveUrl queda como respaldo de otras rutas.
  const url = result?.url || result?.deployUrl || result?.liveUrl || result?.deploy?.url || "";
  const detail = String(result?.message || result?.error || "").slice(0, 600);
  if (result?.ok) {
    // [EDITCORE-INTEGRAL-B8] Completado ≠ verificado: si el humo no
    // pudo verificar la app (401/403/404 en la ruta principal), el
    // texto lo declara aunque el deploy haya terminado.
    const notVerified = result?.smokeNotVerified === true ? result : (result?.deploy?.smokeNotVerified === true ? result.deploy : null);
    const warn = notVerified
      ? `⚠️ Publicación NO verificada: ${notVerified.smokeCause || "la ruta principal respondió pero no se pudo comprobar que fuera la app"}.`
      : "";
    return [`## ✅ ${label} completado`, url ? `URL: ${url}` : "", warn, detail].filter(Boolean).join("\n\n");
  }
  // [EDITCORE-CONSOLIDADA] Producción caída tras el deploy (humo
  // post-despliegue de deploy-one-click): el texto que reciben el
  // usuario Y el agente debe decirlo sin anestesia — qué URLs
  // fallaron y con qué estado, los logs como evidencia y la orden de
  // reparación. publish_project anida el resultado del deploy en
  // result.deploy; deploy_one_click lo trae en la raíz.
  const down = result?.productionDown === true || result?.publishFailed === true
    ? result
    : (result?.deploy?.productionDown === true || result?.deploy?.publishFailed === true ? result.deploy : null);
  if (down) {
    const smokeLines = (Array.isArray(down.smoke) ? down.smoke : [])
      .map((s) => `- GET ${s.url} → ${s.status === 0 ? (s.error || "sin respuesta") : `HTTP ${s.status}`}`)
      .join("\n");
    return [
      `## ❌ ${label}: el despliegue terminó pero la aplicación NO responde`,
      String(down.message || result?.message || "").slice(0, 900),
      smokeLines ? `### Humo post-despliegue\n\n${smokeLines}` : "",
      down.logs
        ? `### Logs del despliegue (evidencia para reparar)\n\n\`\`\`\n${String(down.logs).slice(0, 4000)}\n\`\`\``
        : (down.logsNote ? `Logs del despliegue: ${down.logsNote}` : ""),
      "### Qué sigue\n\nEsto es ahora una tarea de **REPARACIÓN PRIORITARIA**: diagnostica la causa desde los logs, corrígela en el código, verifica en local y vuelve a publicar. No des la publicación por buena.",
    ].filter(Boolean).join("\n\n");
  }
  return [`## ❌ ${label} no se completó`, detail || "Sin detalle del error.", result?.failedStep ? `Paso que falló: \`${result.failedStep}\`` : ""].filter(Boolean).join("\n\n");
}

function maybeBlockRoadmapReadFile(name, args, projectRoot) {
  if (name !== "read_file") return null;
  const p = String(args?.path || "").replace(/\\/g, "/").trim();
  if (!p) return null;
  if (!/(^|\/)ROADMAP(\.md)?$/i.test(p) && !/^ROADMAP\.md$/i.test(p)) return null;
  if (!isRoadmapUsable(projectRoot)) return null;
  return { ok: false, blocked: true, error: "El ROADMAP ya está en tu contexto.", guidance: "No hace falta leerlo con `read_file`." };
}

// [EDITCORE-CONSOLIDADA] Forma de PLAN (no de resultado): el modelo
// entrega el mapa de lo que HABRÍA que hacer — pasos en infinitivo —
// en vez de ejecutarlo. En vivo (batería v4.7.5) el turno «Créame una
// sección nueva de testimonios…» cerró exactamente así: «Mapa UI
// (testimonios)… Para cumplir lo pedido: Conseguir fotos… Ampliar
// testimonials… Verificar visualmente…», sin escribir una línea. La
// compuerta de cierre-plan usa esta forma como gatillo; no intenta
// juzgar el contenido, solo la silueta del texto.
function looksLikePlanClose(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (/para cumplir lo pedido/i.test(raw)) return true;
  if (/(?:^|\n)\s{0,3}(?:#{1,4}\s*)?(?:mapa|plan|pasos a seguir|qué haré|que haré)\b/i.test(raw)) return true;
  // [EDITCORE-V491-D] Las formas REALES de propuesta, observadas en
  // vivo con la v4.9.0 («Ahora mejora el hero» en modo Agente): el
  // modelo cierra con «**Propuesta: hero más profesional (sin
  // implementar aún)**», los pasos como infinitivos A MITAD DE LÍNEA
  // tras encabezados en negrita o tras dos puntos («**Fondo premium:**
  // conservar…», «Composición más clara: mantener…», «Confianza
  // visible: convertir…») y el remate «dime "procede" y lo implemento»
  // — pese a estar AUTORIZADO. Ninguna forma vieja lo veía: el
  // infinitivo no abría la línea y «Propuesta» no era encabezado
  // conocido. La compuerta que consume esto (planClose) ya exige
  // turno autorizado + intención de mutación + cero escrituras, así
  // que reconocer la propuesta aquí no puede castigar un cierre
  // legítimo de «Pregunta antes» (ahí la compuerta no aplica).
  if (/sin implementar(?:\s+a[uú]n)?/i.test(raw)) return true;
  if (/(?:^|\n)\s{0,3}(?:#{1,4}\s*)?(?:\*\*)?\s*propuesta\b/i.test(raw)) return true;
  if (/\bdime\s+["«“]?\s*procede/i.test(raw)) return true;
  const midLineInfinitives = raw.split(/\r?\n/).filter((line) =>
    /\*\*[^*\n]{2,80}\*\*\s*:?\s*(?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*\s+){0,3}?[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?:ar|er|ir)\b/.test(line)
    || /^[^:\n]{3,80}:\s*[a-záéíóúñ][\wáéíóúñ]*(?:ar|er|ir)\b/.test(line)).length;
  if (midLineInfinitives >= 2) return true;
  const infinitiveLed = raw.split(/\r?\n/).filter((line) =>
    /^\s*(?:[-*•]|\d+[.)])?\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?:ar|er|ir)\b/i.test(line)).length;
  return infinitiveLed >= 2;
}

// [EDITCORE-CONSOLIDADA] El formato 📁 de listados es SOLO para
// pedidos de listado (kind LIST). listOnlyMode incluía también los
// ASK, y la finalización REEMPLAZABA la respuesta del modelo por el
// directorio siempre que el turno hubiera hecho un list_files: en
// vivo, «revisa la landing y dime qué secciones tiene y en qué
// archivo está cada una» (y la propia P-3) se respondieron con el
// 📁 aunque el agente había leído los archivos y podía contestar el
// mapa. Regla nueva: un ASK nunca se aplana a listado, y ni siquiera
// un LIST lo hace cuando el turno leyó contenido de verdad más allá
// de list_files y el modelo escribió una respuesta sustantiva —
// el formato lista es para cuando el usuario pidió LISTAR, no para
// cuando pidió CONTENIDO (dime / revisa / explica / dónde está).
const SUBSTANTIVE_READ_TOOLS = new Set([
  "read_file", "search_files", "search_codebase_semantic", "search_brain",
  "read_skill", "capture_preview_screenshot", "symbol_search",
  "dependency_search", "codebase_map", "project_discovery",
]);

function turnDidSubstantiveReads(steps = []) {
  return (Array.isArray(steps) ? steps : []).some((s) => s && s.ok !== false && s.result?.ok !== false && SUBSTANTIVE_READ_TOOLS.has(s.name));
}

function shouldFormatAsListing({ decision, steps = [], cleanText = "" } = {}) {
  if (decision?.kind !== "LIST") return false;
  const raw = String(cleanText || "").trim();
  // El modelo ya respondió EN formato lista: se respeta tal cual.
  if (/##\s*📁/i.test(raw) && /\*\*Carpetas\s*\(/i.test(raw)) return true;
  // Leyó contenido de verdad y contestó en serio: su texto manda.
  if (raw.length >= 160 && turnDidSubstantiveReads(steps)) return false;
  return true;
}

function formatListOnlyAnswer(text = "", steps = [], prompt = "") {
  const raw = String(text || "").trim();
  if (/##\s*📁/i.test(raw) && /\*\*Carpetas\s*\(/i.test(raw)) return raw;
  const listStep = [...(Array.isArray(steps) ? steps : [])].reverse().find((s) => s?.name === "list_files" && s?.ok !== false && s?.result?.ok !== false);
  if (!listStep?.result) return raw || "## 📁 Listado\n\n_Sin resultados._";
  const r = listStep.result;
  const targetPath = String(listStep.input?.path || r.path || ".").replace(/\\/g, "/");
  const dirs = Array.isArray(r.dirs) ? r.dirs : [];
  const files = Array.isArray(r.files) ? r.files : [];
  const lines = [`## 📁 \`${targetPath || "."}\``, ""];
  lines.push(`**Carpetas (${dirs.length}):**`);
  if (dirs.length) { for (const d of dirs.slice(0, 80)) lines.push(`- ${d}/`); } else lines.push("- _(ninguna)_");
  lines.push("");
  lines.push(`**Archivos (${files.length}):**`);
  if (files.length) { for (const f of files.slice(0, 120)) lines.push(`- ${f}`); } else lines.push("- _(ninguno)_");
  return lines.join("\n");
}

class ChatOrchestrator {
  constructor() {
    this.session = new ChatSession();
    this.abort = null;
    this.turnAbort = null;
    this.steering = [];
    this.running = false;
    this.pendingTask = null;
    this.pendingExternal = null;
  }

  stop() {
    const reason = Object.assign(new Error("Detenido por el usuario."), { code: "AGENT_STEER" });
    if (this.turnAbort) { try { this.turnAbort.abort(reason); } catch (_) {} this.turnAbort = null; }
    if (this.abort) { try { this.abort.abort(reason); } catch (_) {} }
    this.session.kill(); this.pendingTask = null; this.pendingExternal = null; this.steering = []; this.running = false;
    try { taskQueue.cancelAll(); } catch (_) {}
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
      try { this.turnAbort.abort(steerError); interrupted = true; } catch (_) {}
    }
    return { accepted: true, pendingDirections: this.steering.length, interrupted };
  }

  isRunning() { return this.running === true; }

  async runPendingExternal(pending, { helpers, onProgress } = {}) {
    const { name, args, projectRoot } = pending;
    this.running = true;
    // [EDITCORE-INTEGRAL-B6] Controlador propio para esta ejecución:
    // stop() lo aborta y la señal viaja a la acción externa.
    if (!this.abort || this.abort.signal.aborted) this.abort = new AbortController();
    const step = { name, input: args, result: null, ok: false };
    try {
      onProgress?.({ phase: "start", text: name === "deploy_one_click" ? "Desplegando…" : name === "connect_project" ? "Conectando el proyecto…" : "Publicando…" });
      onProgress?.({ phase: "tool", stage: "running", name, input: args });
      const result = await tools.execute(name, args, projectRoot, true, { ...(helpers || {}), externalActionApproved: true, abortSignal: this.abort?.signal || null });
      step.result = result;
      step.ok = result?.ok !== false;
      onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: step.ok });
      if (step.ok && name !== "connect_project") {
        try {
          const sync = require("../runtime/roadmap-sync").createRoadmapSync();
          const url = result?.url || result?.deployUrl || result?.liveUrl || result?.deploy?.url || ""; // [EDITCORE-INTEGRAL-B8] misma lectura que el formateador
          sync.recordDeploy(projectRoot, { type: name === "deploy_one_click" ? (result?.provider || "deploy") : "publish", status: "success", url });
        } catch { /* el roadmap es opcional */ }
      }
      return { kind: "EXECUTE", text: formatAgentVisibleText(formatExternalActionResult(name, result)), steps: [step] };
    } catch (err) {
      step.result = { ok: false, error: String(err?.message || err) };
      return { kind: "EXECUTE", text: formatAgentVisibleText(formatExternalActionResult(name, step.result)), steps: [step] };
    } finally {
      this.running = false;
      try { onProgress?.({ phase: "done", text: "" }); } catch {}
    }
  }

  // [EDITCORE-INTEGRAL-B5] handle() es ahora la ENVOLTURA del turno: su
  // único trabajo extra es el ANUNCIO de modo restrictivo en un chat
  // nuevo (costura del Bloque 5b). El modo es por proyecto y se hereda
  // en silencio; si este chat es nuevo (isNewChat/chatIsNew, dato que
  // traen renderer→main→bridge) y el modo efectivo es restrictivo, la
  // línea de estado abre el turno: se emite por onProgress al abrir y
  // se ANTEPONE al texto final, para que sea la primera línea visible
  // del primer turno diga el modo y cómo cambiarlo. En modo completo
  // no hay anuncio. El cuerpo histórico vive en _handleCore sin tocar.
  async handle(input = {}) {
    const safeInput = input && typeof input === "object" ? input : {};
    const isNewChat = safeInput.isNewChat === true || safeInput.chatIsNew === true || safeInput.newChat === true;
    const modeForAnnouncement = String(safeInput.permissionMode || "").trim()
      ? normalizePermissionMode(safeInput.permissionMode)
      : (safeInput.allowWrite === false ? "readonly" : "");
    const announcement = modeForAnnouncement
      ? buildModeAnnouncement({ permissionMode: modeForAnnouncement, isNewChat })
      : "";
    if (announcement) {
      try { safeInput.onProgress?.({ phase: "narration", text: announcement }); } catch { /* el anuncio no tumba el turno */ }
    }
    const out = await this._handleCore(safeInput);
    if (announcement && out && typeof out === "object") {
      out.modeAnnouncement = announcement;
      if (typeof out.text === "string" && out.text.trim() && !out.text.includes(announcement)) {
        out.text = `${announcement}\n\n${out.text}`;
      }
    }
    return out;
  }

  async _handleCore(input = {}) {
    const { message, projectRoot, apiBaseUrl, apiKey, model, images, onProgress, helpers,
      autoHeal, background, runModelTaskFn, allowWrite: inputAllowWrite, permissionMode,
      permissionFull, fullAccess: inputFullAccess, planAuthorizedExecution: inputPlanAuthRaw,
      // [EDITCORE-INTEGRAL-B5] La autorización viaja como DATO con el
      // nombre de CADA ruta: el renderer la manda como planAuthorized
      // (agent:run) y como planAuthorizedExecution (chat); main y el
      // bridge la normalizan a planAuthorizedExecution, y el kernel
      // acepta AMBOS nombres aquí, en un solo punto. Antes handle()
      // solo leía planAuthorizedExecution y main ni siquiera lo
      // reenviaba (recalculaba desde el modo): el «procede» del
      // renderer —transformado en un prompt que empieza «AUTORIZACION
      // DE EJECUCION (PROCEDE): …»— no cumplía ninguna de las formas
      // de texto que el kernel reconocía y la compuerta pedía un
      // «procede» que el usuario YA había dicho: bucle infinito de
      // needsAuthorization en la ruta Agente en modo step.
      planAuthorized: inputPlanAuthorizedRaw,
      authorizedContinuation: inputAuthorizedContinuation,
      history, messages: inputMessages, threadId: inputThreadId, chatId, maxSteps } = input;
    const inputPlanAuth = inputPlanAuthRaw === true
      || inputPlanAuthorizedRaw === true
      || inputAuthorizedContinuation === true;

    const rawText = typeof message === "object" && message?.text ? message.text : String(message || "");
    const taskImages = Array.isArray(images) ? images.filter(Boolean) : [];
    const hasImages = taskImages.length > 0;
    const text = rawText.trim() || (hasImages ? "Analiza la imagen adjunta." : "");
    const textLower = text.toLowerCase();
    const isApprovalText = APPROVAL_WORDS.has(textLower) || isContinuePhrase(text);
    const startsWithContinue = /^\s*(?:contin[uú]a|sigue|s[ií]guele|avanza|termina|procede|dale)\b/i.test(text);

    const fullAccess = isFullAccess({ allowWrite: inputAllowWrite, permissionMode, permissionFull, fullAccess: inputFullAccess, planAuthorizedExecution: inputPlanAuth, mode: permissionMode })
      || String(permissionMode || "").toLowerCase() === "full";

    if (fullAccess) this.pendingTask = null;
    global.__editcoreFullAccess = Boolean(fullAccess);

    if (this.pendingExternal) {
      const pending = this.pendingExternal;
      this.pendingExternal = null;
      const fresh = Date.now() - pending.createdAt < PENDING_EXTERNAL_TTL_MS
        && path.resolve(String(pending.projectRoot || "")) === path.resolve(String(projectRoot || ""));
      const isApproved = APPROVAL_RE.test(text)
        || isApprovalText
        || isContinuePhrase(text)
        || fullAccess
        || String(permissionMode || "").toLowerCase() === "full";
      if (fresh && isApproved) return this.runPendingExternal(pending, { helpers: { ...(helpers || {}), fullAccess: true, externalActionApproved: true }, onProgress });
    }

    const visionAsk = hasImages && /\b(?:imagen|foto|captura|screenshot|adjunt|overlay|error\s+visible|analiza\s+(?:esto|la|el))\b/i.test(text);

    let effectiveText = text;
    let resumedTask = "";
    if (isApprovalText || startsWithContinue) {
      const hist = Array.isArray(history) ? history : Array.isArray(inputMessages) ? inputMessages : [];
      const prevUserTexts = hist
        .filter((m) => m && (m.role === "user" || m.sender === "user" || m.from === "user"))
        .map((item) => String(typeof item.content === "string" ? item.content : item.text || (Array.isArray(item.content) ? item.content.map((c) => c.text || "").join(" ") : "")).trim())
        .filter((t) => t.length > 5 && t !== text && !APPROVAL_WORDS.has(t.toLowerCase()) && !isContinuePhrase(t))
        .slice(-8)
        .reverse();
      // Las preguntas sueltas ("¿por qué te detienes?") no son la tarea: se retoma el último pedido accionable.
      resumedTask = prevUserTexts.find((t) => classify(t).kind === "EXECUTE" || classify(t).kind === "ANALYZE") || prevUserTexts.find((t) => classify(t).kind !== "CHAT") || (isApprovalText ? prevUserTexts[0] || "" : "");
      if (resumedTask) {
        effectiveText = `INSTRUCCIÓN AUTORIZADA DEL USUARIO: "${resumedTask}". Aplica las correcciones y modificaciones de código y verifica.`;
        if (!isApprovalText) effectiveText += ` Ahora dice: "${text}".`;
      }
    }
    const taskMessage = resumedTask
      ? `${effectiveText}\nMensaje actual del usuario: "${text}". Retoma esa tarea donde quedó (revisa el historial y los errores pendientes) y termínala; no repitas lo que ya está hecho.`
      : text;

    const isExplicitReadOnly = ["read", "readonly", "solo lectura", "solo-lectura", "chat"].includes(String(permissionMode || "").toLowerCase().trim()) || inputAllowWrite === false;
    const defaultAllowWrite = fullAccess || !isExplicitReadOnly;

    let decision = classify(effectiveText, {
      allowWrite: inputAllowWrite !== undefined ? inputAllowWrite : defaultAllowWrite,
      permissionMode: fullAccess ? "full" : permissionMode,
      fullAccess,
    });

    if (isApprovalText || startsWithContinue || /^INSTRUCCI[OÓ]N AUTORIZADA/i.test(effectiveText)) {
      decision = { kind: "EXECUTE", label: fullAccess ? "Ejecución (Acceso completo)" : "Ejecución autorizada", allowTools: true, allowWrite: true, background: false };
    }

    if (fullAccess) {
      decision.allowWrite = true;
      if (decision.kind === "CONFIRM" || isApprovalText) decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
    }

    if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) {
      decision = { kind: "EXECUTE", label: fullAccess ? "Ejecución (Acceso completo)" : "Construcción / Ejecución", allowTools: true, allowWrite: true, background: false };
    }
    if (decision.kind === "CHAT" && !userWantsDiskMutation(effectiveText) && /(?:^|[^\w])(?:analiz[aá]|analizar|an[aá]lisis|auditor[ií]a|diagn[oó]stico|diagnostica|revis[aá]|inspecciona|explora(?:r)?\s+el\s+proyecto)(?=\s|$|[.!,?¿¡:])/i.test(effectiveText)) {
      decision = { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background: false };
    }
    if (hasImages && (decision.kind === "ANALYZE" || decision.kind === "ASK" || visionAsk)) {
      decision = fullAccess ? { kind: "EXECUTE", label: "Análisis visual + acción", allowTools: true, allowWrite: true, background: false } : { kind: "ASK", label: "Análisis visual", allowTools: true, allowWrite: false, background: false };
    }
    if (background === true) decision.background = true;

    if (decision.kind === "STOP") return this.stop();

    // Sin proyecto abierto, una orden de construcción (EXECUTE) ya no se
    // rechaza: se conversa (idea/spec/plan) sin herramientas de disco hasta
    // que la app cree el proyecto desde esta misma conversación. El resto
    // (ASK/ANALYZE/CONFIRM…) sí necesita una carpeta real: mantiene la negativa.
    if (!projectRoot && (decision.kind === "EXECUTE" || decision.kind === "ASK" || decision.kind === "ANALYZE")) {
      decision = { kind: "CHAT", label: "Conversación sin proyecto", allowTools: false, allowWrite: false, background: false };
    }
    if (!projectRoot && decision.kind !== "CHAT" && decision.kind !== "LIST") {
      return { kind: "CHAT", text: "Abrí un proyecto primero y después te ayudo con eso." };
    }

    const memory = projectRoot ? new PersistentMemory(projectRoot) : null;
    if (memory) memory.load();

    const threadId = threadCore.resolveThreadId({ threadId: inputThreadId, chatId, conversationId: input.conversationId, sessionId: input.sessionId });
    const historyInput = Array.isArray(history) && history.length ? history : (Array.isArray(inputMessages) ? inputMessages : []);
    if (projectRoot) threadCore.seedThreadFromInput(projectRoot, threadId, { history: historyInput }, text);
    input._threadId = threadId;
    input._historyInput = historyInput;
    this._threadId = threadId;
    this._historyInput = historyInput;
    this._fallbackProfiles = Array.isArray(input.fallbackProfiles) ? input.fallbackProfiles : [];
    this._skillsPrompt = String(input.skillsPrompt || "").trim();
    this._skillsPickedIds = [];
    this._currentUserText = text;
    // Lo que cambia por tarea (pipeline, coordinación, archivo abierto, reviews) va al mensaje del turno, no al system cacheado.
    this._turnExtras = [];
    // Skills vivas: si no vinieron del caller, elegir por mensaje + kind (no quita skills ni catálogo)
    if (!this._skillsPrompt) {
      try {
        const kindForSkills = String(decision?.kind || "EXECUTE");
        // [EDITCORE-INTEGRAL-B2] UNA sola selección por turno: buildSkillsTurn
        // selecciona una vez y construye el ÍNDICE con esa misma selección;
        // los ids devueltos alimentan _skillsPickedIds y la narrativa. Antes
        // se seleccionaba dos veces (dentro de skillsPrompt con tope 6 y aquí
        // con tope 4) y ambas selecciones podían divergir.
        const skillsTurn = typeof buildSkillsTurn === "function"
          ? buildSkillsTurn(projectRoot, kindForSkills, effectiveText || text || "")
          : { prompt: skillsPrompt(projectRoot, kindForSkills, effectiveText || text || ""), pickedIds: [] };
        this._skillsPrompt = String(skillsTurn.prompt || "");
        const pickedIds = Array.isArray(skillsTurn.pickedIds) ? skillsTurn.pickedIds.filter(Boolean) : [];
        if (pickedIds.length) {
          this._skillsPickedIds = pickedIds;
          this._turnExtras.push(`Skills activas este turno: ${pickedIds.join(", ")}`);
          // [EDITCORE-V492-2] VOZ NATURAL (regla de producto de Luis,
          // 2026-11-11): la línea-recibo visible «Skills aplicadas este
          // turno: …» se RETIRA de la superficie. La selección de skills
          // y su inyección al contexto del modelo siguen ocurriendo por
          // debajo (eso no se toca); simplemente ya no se anuncia con
          // una línea preestablecida: la superficie del chat es la voz
          // del agente, no contadores del sistema.
        }
      } catch (err) {
        console.warn("[skills] carga diferida:", err && err.message ? err.message : err);
      }
    }

    // [EDITCORE-STACK] iniciar tarea / memoria / A2A
    let _ecStack = null;
    try {
      _ecStack = await getEditcoreStack(projectRoot);
      if (_ecStack) {
        this._editcoreStack = _ecStack;
        _ecStack.startTask(String(effectiveText || text || "").slice(0, 2000), {
          threadId: threadId || "default",
        });
      }
    } catch (e) {
      console.warn("[EDITCORE-STACK] startTask:", e && e.message ? e.message : e);
    }
    // [/EDITCORE-STACK]

    // [EDITCORE-ELITE-UI] preparar prompts de calidad visual / pipeline
    try {
      this._eliteUiExtra = "";
      this._productPipelineExtra = "";
      this._repairExtra = "";
      this._repairTask = false;
      this._buildBaseExtra = "";
      this._buildBaseTask = false;
      this._uiTask = false;
      this._visualReviewTask = false;
      const taskText = String(effectiveText || text || "");
      if (eliteUiPolicy && typeof eliteUiPolicy.isUiTask === "function" && eliteUiPolicy.isUiTask(taskText)) {
        this._eliteUiExtra = eliteUiPolicy.eliteUiSystemPrompt();
      }
      // Construcción de producto (crear app/web/saas) también es tarea visual:
      // aplica la política élite completa y habilita la verificación con capturas.
      if (eliteUiPolicy && typeof eliteUiPolicy.isProductBuildTask === "function" && eliteUiPolicy.isProductBuildTask(taskText)) {
        this._uiTask = true;
        if (!this._eliteUiExtra) this._eliteUiExtra = eliteUiPolicy.eliteUiSystemPrompt();
      }
      if (this._eliteUiExtra) this._uiTask = true;
      // [EDITCORE-REPAIR] Un turno de reparación también tiene ojos: sin
      // la herramienta de captura el agente diagnostica de memoria (así
      // nació el falso "gap-2" de la sesión VIXERAI). Y viaja con el
      // protocolo de reparación como instrucción del turno.
      if (repairGuard && typeof repairGuard.isRepairTask === "function" && repairGuard.isRepairTask(taskText)) {
        this._repairTask = true;
        this._repairExtra = repairGuard.repairProtocolPrompt();
        // Ojos solo si hay algo que mirar: el daño es visible/render o
        // el proyecto es web. Una reparación de lógica pura en el
        // servidor verifica con build/tests, sin pagar la captura.
        if (repairGuard.isVisualRepairTask(taskText) || repairGuard.projectLooksWeb(projectRoot)) {
          this._uiTask = true;
        }
      }
      // [EDITCORE-BUILD-BASE] Construir una web sobre un proyecto vacío
      // (blank) sin sentar la base profesional sale como un HTML suelto
      // plano — la landing de Taller Luis. Si el turno es visual/de
      // construcción y el proyecto es un lienzo, el turno viaja con el
      // protocolo de base y la compuerta del despachador bloquea una
      // vez el HTML suelto para que el agente siente la base primero.
      if (buildBaseGuard && this._uiTask === true && this._repairTask !== true
        && buildBaseGuard.projectLooksEmpty(projectRoot)) {
        this._buildBaseTask = true;
        this._buildBaseExtra = buildBaseGuard.buildBaseProtocolPrompt();
      }
      // [EDITCORE-REVISION-VISUAL] Un turno de PREGUNTA/revisión sobre
      // las imágenes de una página ya hecha también necesita ojos y
      // protocolo propios: sin este flag, el filtro de herramientas
      // dejaba fuera capture_preview_screenshot (solo _uiTask, de
      // construcción, la ofrecía) y el agente juzgaba por nombre/alt.
      this._visualReviewTask = isVisualReviewRequest(taskText);
      // [EDITCORE-V492-3] Pregunta de recuerdo con evento: activa el
      // protocolo anti-confabulación y la guarda de cierre.
      this._memoryEvent = detectMemoryEventQuestion(taskText);
      if (productPipeline && typeof productPipeline.buildPipelinePrompt === "function") {
        const pipe = productPipeline.buildPipelinePrompt(taskText);
        if (pipe && pipe.active && pipe.prompt) {
          this._productPipelineExtra = pipe.prompt;
          this._productPipeline = pipe;
        }
      }
      this._turnExtras.push(this._productPipelineExtra, this._eliteUiExtra, this._repairExtra, this._buildBaseExtra);
    } catch (e) {
      console.warn("[EDITCORE-ELITE-UI]", e && e.message ? e.message : e);
    }
    // [/EDITCORE-ELITE-UI]

    // [EDITCORE-COORD] agente activo + contexto anti-pisoteo
    try {
      if (agentCoordination && projectRoot) {
        const coord = agentCoordination.getCoordination(projectRoot);
        const roleName = "supervisor";
        global.__editcoreCoord = {
          threadId: threadId || "default",
          agentRole: roleName,
          projectRoot,
        };
        coord.setActiveAgent(threadId || "default", roleName, {
          task: String(effectiveText || text || "").slice(0, 300),
        });
        this._turnExtras.push(coord.getCoordinationPrompt(threadId || "default"));
      }
    } catch (e) {
      console.warn("[EDITCORE-COORD]", e && e.message ? e.message : e);
    }
    // [/EDITCORE-COORD]

    // [EDITCORE-INTEGRAL-B9] «Fase 8» RETIRADA del camino vivo.
    // El bloque anterior creaba un ParallelBatch NUEVO por turno,
    // nunca llamaba loadLatest() (la rama de «batch activo» era
    // inalcanzable), sobrescribía .editcore/parallel/LATEST.json,
    // hacía beginJob() solo del job 1 e inyectaba su prompt:
    // completeJob/failJob/fanIn tenían 0 llamadores en el árbol
    // vivo, así que los jobs 2..N jamás empezaban y el fan-in
    // jamás ocurría — no era paralelo ni serie, era 1 job fantasma
    // por turno pagando contexto. Completar el ciclo exigiría
    // mapear steps reales a jobs heurísticos que no corresponden a
    // pasos del bucle (los jobs son scopes propuestos por regex,
    // no unidades de trabajo ejecutadas), así que la decisión es
    // RETIRAR la inyección: runtime/agent-parallel.js queda como
    // módulo fuera del turno, usable solo por un llamador explícito
    // que sí conduzca su ciclo de vida. Los LATEST.json/batches
    // previos en disco quedan ABANDONADOS sin migración: nadie los
    // leía (loadLatest no tenía llamadores vivos), y desde ahora
    // tampoco se sobrescriben.
    this._parallelBatch = null;
    // [/EDITCORE-INTEGRAL-B9]

    // [EDITCORE-EDITOR-CTX] archivo activo + cola de review
    try {
      if (activeEditorContext) {
        const ed = activeEditorContext.extractEditorContext(input || {});
        this._turnExtras.push(activeEditorContext.buildActiveEditorPrompt(ed));
      }
      if (ideReviewQueue && projectRoot) {
        if (fullAccess) {
          try {
            ideReviewQueue.getReviewQueue(projectRoot).acceptAll();
          } catch (_) {}
        } else {
          this._turnExtras.push(ideReviewQueue.getReviewQueue(projectRoot).getPendingPrompt());
        }
      }
    } catch (e) {
      console.warn("[EDITCORE-EDITOR-CTX]", e && e.message ? e.message : e);
    }
    // [/EDITCORE-EDITOR-CTX]

    // [EDITCORE-ADD] Ruteo por red neuronal (opcional). Guarda el agente elegido para feedback.
    try {
      if (agentNetwork && typeof agentNetwork.route === "function") {
        const _r = await agentNetwork.route(String(text || "").slice(0, 500));
        this._ecRoutedAgent = _r && _r.agent || null;
        this._ecRoutedScore = _r && _r.score || 0;
        // [EDITCORE-INTEGRAL-B9] Sin agentBus.record: el bus dejó de
        // escribirse por turno (ver la nota en la ruta ASK/ANALYZE).
      }
    } catch (_) { /* no-op */ }
    // [/EDITCORE-ADD]

    // [EDITCORE-SPECIALIST] Subagente especialista por dominio (UI, DB, Auth, DevOps, Streaming, Release)
    try {
      const specialist = dispatchSpecialist(text || "", effectiveText || "");
      if (specialist && specialist.name) {
        this._specialist = specialist;
        this._turnExtras.push([
          `=== SUBAGENTE ESPECIALISTA ACTIVO: ${specialist.name} ===`,
          specialist.systemPrompt,
          `=== FIN SUBAGENTE ESPECIALISTA ===`,
        ].join("\n"));
        onProgress?.({
          phase: "specialist",
          name: specialist.name,
          text: `Subagente especialista asignado: ${specialist.name}`,
        });
        // [EDITCORE-INTEGRAL-B9] Sin agentBus.record por turno.
      }
    } catch (e) {
      console.warn("[EDITCORE-SPECIALIST]", e && e.message ? e.message : e);
    }
    // [/EDITCORE-SPECIALIST]

    if (decision.kind === "CHAT") {
      this.pendingTask = null;
      if (!apiKey) return { kind: "CHAT", text: "EditCoreAI es un IDE con agente autónomo. Abrí un proyecto y pedime un cambio concreto." };
      return this.runModelTask({ decision, message: text, projectRoot: projectRoot || ".", apiBaseUrl, apiKey, model, memory, onProgress, allowWrite: false, maxSteps: CHAT_MAX_STEPS, helpers, chatOnly: true, projectless: !projectRoot, images: taskImages });
    }

    // LIST directo (sin LLM).
    if (decision.kind === "LIST") {
      const target = extractListTarget(effectiveText, projectRoot) || ".";
      this.session.start(decision.kind, projectRoot || process.cwd());
      this.abort = new AbortController();
      this.running = true;
      this.turnAbort = null;
      const steps = [];
      try {
        onProgress?.({ phase: "start", text: `Listando ${target}...` });
        const result = await tools.execute("list_files", { path: target, forceReal: true }, projectRoot || process.cwd(), false, helpers || {});
        steps.push({ name: "list_files", input: { path: target }, result, ok: result?.ok !== false });
        onProgress?.({ phase: "tool", stage: "done", name: "list_files", input: { path: target }, result, ok: result?.ok !== false });
        const formatted = formatListOnlyAnswer("", steps, effectiveText);
        this.session.kill();
        return { kind: "LIST", text: formatted, steps, threadId, usage: {} };
      } catch (err) {
        this.session.kill();
        return { kind: "LIST", text: `## ⚠️ Error al listar\n\n\`${target}\`\n\n> ${String(err?.message || err).slice(0, 300)}`, steps, threadId };
      } finally {
        this.running = false; this.turnAbort = null;
      }
    }

    if (decision.kind === "ASK") {
      ensureCognitiveMap(projectRoot);
      if (hasImages) {
        onProgress?.({ phase: "start", text: "Analizando la imagen que adjuntaste…" });
        return this.runModelTask({ decision, message: text, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress, allowWrite: false, maxSteps: 8, helpers, images: taskImages, fullAccess: false, permissionMode });
      }
      const target = extractListTarget(text, projectRoot) || ".";
      this.session.start(decision.kind, projectRoot);
      // [EDITCORE-INTEGRAL-B9] agent-bus: SE DEJA DE ESCRIBIR por
      // turno. Era un tablero de SOLO escritura: el orquestador
      // llamaba record()/wrapSubagentResult() cada turno y
      // promptBlock/readMessages/postMessage tenían 0 llamadores —
      // ningún prompt reinyectaba .editcore/chat-memory/bus-*.json.
      // Leerlo ahora costaría hasta ~2.200 caracteres por turno del
      // presupuesto agregado del Bloque 2 para duplicar lo que el
      // expediente (thread-memory, Bloque 3) ya trae con hechos; no
      // cabe sin inflar. El módulo queda para uso EXPLÍCITO.
      const out = await runExplorer({ projectRoot, target, onProgress, threadId: this._threadId, signal: this.abort?.signal });
      this.session.kill();
      if (memory) memory.note(`listó ${out.target || target}`);

      if (apiKey) {
        return this.runModelTask({ decision, message: scopeUserMessage(text, out.summary), projectRoot, apiBaseUrl, apiKey, model, memory, onProgress, allowWrite: false, maxSteps: 4, helpers, images: taskImages });
      }
      return { kind: decision.kind, text: out.summary, steps: out.steps };
    }

    if (decision.kind === "ANALYZE") {
      if (hasImages) {
        onProgress?.({ phase: "start", text: "Analizando la imagen que adjuntaste…" });
        return this.runModelTask({
          decision: fullAccess ? { kind: "EXECUTE", label: "Análisis visual", allowTools: true, allowWrite: true } : decision,
          message: text, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: fullAccess, planAuthorizedExecution: fullAccess,
          maxSteps: fullAccess ? AUTHORIZED_MAX_STEPS : ANALYSIS_MAX_STEPS,
          helpers, fullAccess, permissionMode, images: taskImages, authorizedFromPending: fullAccess,
        });
      }
      this.session.start("ANALYZE", projectRoot);
      const scope = requestScopePolicy?.classifyRequestScope?.(text) || "focused";
      const maxReads = scope === "broad" ? 18 : scope === "action" ? 12 : 10;
      const deep = scope === "broad" || DEEP_FORENSIC_REQUEST.test(text);
      onProgress?.({ phase: "start", text: deep ? "Ejecutando chequeos reales: sintaxis, imports, tipos y tests…" : "Ejecutando chequeos reales: sintaxis e imports…" });
      // [EDITCORE-INTEGRAL-B5] Los chequeos con EJECUCIÓN del ANALYZE
      // (npm test / typecheck / build vía spawn) pasan por la MISMA
      // autorización que run_command: en solo lectura no se ejecuta
      // ningún script del proyecto, y en paso a paso tampoco sin la
      // autorización como dato de ESTE turno (full o plan autorizado).
      // Sin modo declarado (uso directo del kernel) se conserva la
      // conducta histórica, igual que en la ruta EXECUTE. Los chequeos
      // estáticos (sintaxis/imports, lectura de disco) sí corren, y la
      // omisión queda DECLARADA en el resultado (executionOmitted).
      const forensicMode = normalizePermissionMode(permissionMode);
      const forensicStepGate = String(permissionMode || "").toLowerCase().trim() === "step";
      const forensicExecutionAllowed = forensicMode !== "readonly"
        && inputAllowWrite !== false
        && (!forensicStepGate || fullAccess || inputPlanAuth);
      const forensicOmittedReason = forensicMode === "readonly" || inputAllowWrite === false
        ? "modo solo lectura"
        : "modo paso a paso sin autorización";
      let verified = null;
      try {
        verified = await forensic.runForensicChecks(projectRoot, {
          runTests: deep,
          runTypecheck: deep,
          runBuild: deep && BUILD_REQUEST.test(text),
          // [EDITCORE-INTEGRAL-B5] Compuerta de ejecución (ver arriba).
          allowExecution: forensicExecutionAllowed,
          executionOmittedReason: forensicOmittedReason,
          onProgress,
        });
        forensic.saveForensic(projectRoot, verified);
        const flagged = [...new Set((verified?.findings || []).map((f) => f.file).filter(Boolean))].slice(0, 30);
        for (const file of flagged) onProgress?.({ phase: "tool", stage: "done", name: "read_file", ok: true, input: { path: file } });
      } catch (err) {
        onProgress?.({ phase: "warn", text: `No se pudieron ejecutar los chequeos reales: ${String(err?.message || err).slice(0, 160)}` });
      }
      const verifiedMd = verified ? forensic.formatForensicMarkdown(verified) : "";
      onProgress?.({ phase: "start", text: "Reuniendo evidencia del proyecto…" });
      if (!this.abort || this.abort.signal.aborted) this.abort = new AbortController();
      const out = await runAnalyst({ projectRoot, onProgress, maxReads, userMessage: text, threadId: this._threadId, signal: this.abort?.signal }); // [EDITCORE-INTEGRAL-B9] sin wrap del bus
      const testsRun = (verified?.checks || []).find((c) => c.id === "tests" && (c.status === "pass" || c.status === "fail"));
      if (testsRun && typeof out?.report === "string") {
        out.report = out.report.replace(
          /- \*\*Tests\*\*: script `npm test` = [^\n]*No ejecutado en este análisis \(resultado no verificado\)\./,
          `- **Tests**: ejecutados en este análisis (\`${testsRun.command || "npm test"}\`): ${testsRun.summary}.`,
        );
      }
      if (memory) { memory.setReport(out.report); memory.note("análisis completado"); }
      this.session.kill();
      // Honestidad del análisis (contrato): los extractos son parciales por
      // presupuesto de tokens; PROHIBIDO reportar un archivo como 'truncado'
      // solo porque un extracto termine a mitad de una función. Y todo lo que
      // no salga de los chequeos reales ni de lecturas de este turno queda
      // no verificado en este analisis: va etiquetado como hipótesis.
      const analysisHonesty = [
        "REGLAS DE HONESTIDAD DEL REPORTE:",
        "- PROHIBIDO reportar un archivo como 'truncado' o incompleto solo porque un extracto termine a mitad: los extractos son parciales por presupuesto.",
        "- Lo confirmado por los chequeos reales va como hallazgo verificado. Todo lo demás queda no verificado en este analisis y debe presentarse bajo la sección «## 🔎 Hipótesis (no verificadas)», nunca como hecho.",
      ].join("\n");
      const evidence = `${verified ? `${forensic.formatForensicPromptBlock(verified)}\n\n` : ""}${out.report}\n\n${analysisHonesty}`;

      if (apiKey) {
        onProgress?.({ phase: "model", text: "Generando reporte completo..." });
        const res = await this.runModelTask({
          decision,
          message: scopeUserMessage(text, evidence),
          projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
          allowWrite: false,
          maxSteps: ANALYSIS_MAX_STEPS,          // ← 8 turnos
          totalTimeoutMs: 900_000,               // 15 min global
          helpers,
          images: taskImages,
          verifiedShown: Boolean(verifiedMd),
          evidenceReads: successfulDiskReads(out?.steps),
        });
        if (verifiedMd && res && typeof res.text === "string") res.text = `${verifiedMd}\n\n---\n\n${forensic.stripRepeatedForensic(res.text)}`;
        return res;
      }
      return { kind: "ANALYZE", text: verifiedMd ? `${verifiedMd}\n\n---\n\n${out.report}` : out.report, steps: out.steps };
    }

    if (decision.kind === "VERIFY") {
      this.session.start("VERIFY", projectRoot);
      if (!this.abort || this.abort.signal.aborted) this.abort = new AbortController();
      // [EDITCORE-INTEGRAL-B5] El verifier recibe la MISMA autorización
      // de ejecución/escritura que el resto del turno: en solo lectura
      // (o paso a paso sin autorizar) no ejecuta scripts ni escribe el
      // stub de .next/types — verifica lo estático y declara la
      // omisión. Sin modo declarado se conserva la conducta histórica.
      const verifyMode = normalizePermissionMode(permissionMode);
      const verifyStepGate = String(permissionMode || "").toLowerCase().trim() === "step";
      const verifyExecutionAllowed = verifyMode !== "readonly"
        && inputAllowWrite !== false
        && (!verifyStepGate || fullAccess || inputPlanAuth);
      const out = await runVerifier({ projectRoot, onProgress, timeoutMs: 60_000, threadId: this._threadId, signal: this.abort?.signal, allowExecution: verifyExecutionAllowed, allowWrite: verifyExecutionAllowed }); // [EDITCORE-INTEGRAL-B9] sin wrap del bus
      this.session.kill();
      if (out?.forensic) {
        const previous = forensic.loadForensic(projectRoot);
        const comparison = previous ? forensic.formatComparisonMarkdown(forensic.compareForensic(previous, out.forensic)) : "";
        if (!out.forensic.onlyFiles) forensic.saveForensic(projectRoot, out.forensic);
        return { kind: "VERIFY", text: [out.report, comparison].filter(Boolean).join("\n\n"), steps: out?.steps || [] };
      }
      return { kind: "VERIFY", text: out?.ok ? `Verificación OK (\`${out?.result?.command || "comando"}\`).` : `Falló la verificación: ${String(out?.result?.error || out?.result?.stderr || "").slice(0, 600)}`, steps: out?.steps || [] };
    }

    if (decision.kind === "EXECUTE") {
      if (!apiKey) return { kind: "CHAT", text: "Me falta la API key para ejecutar cambios." };
      const isReadOnly = ["read", "readonly", "solo lectura", "solo-lectura", "chat"].includes(String(permissionMode || "").toLowerCase().trim()) || inputAllowWrite === false;
      const canWrite = (fullAccess || decision.allowWrite !== false) && !isReadOnly;
      onProgress?.({ phase: "start", text: canWrite ? "Ejecutando los cambios de forma autónoma…" : "Modo solo lectura: revisando sin modificar archivos…" });
      this.pendingTask = null;
      const runner = runModelTaskFn || this.runModelTask.bind(this);
      // La autorización para escribir SIN preguntar solo existe si el usuario
      // la dio de verdad: Acceso completo, un plan autorizado que llega como
      // tal, o un mensaje de aprobación/continuación en ESTE turno. Antes se
      // pasaba authorizedFromPending: canWrite, lo que pre-autorizaba TODA
      // corrida en modo "Pregunta antes" (step): runModelTask calculaba
      // acceso completo a partir de ese flag y escribía sin pedir
      // confirmación nunca, aunque el menú dijera "Pregunta antes".
      // La compuerta aplica solo cuando el usuario eligió explícitamente
      // "Pregunta antes" (step). Sin modo declarado (uso directo del kernel
      // y llamantes internos históricos) se conserva el comportamiento de
      // siempre: la orden directa del usuario autoriza.
      const stepGate = String(permissionMode || "").toLowerCase().trim() === "step";
      const userAuthorized = !stepGate
        || fullAccess
        || inputPlanAuth === true
        || isApprovalText
        || startsWithContinue
        || /^INSTRUCCI[OÓ]N AUTORIZADA/i.test(effectiveText);
      // [EDITCORE-V491-C] Plan presentado y persistido: si esta
      // conversación tiene uno y ESTE turno es su ejecución autorizada,
      // el plan viaja como instrucción vinculante dentro del mensaje y
      // como dato (presentedPlan) para que el cierre declare cualquier
      // escritura fuera de él. Se consume al entregarlo: no se
      // re-aplica en turnos posteriores.
      let consumedPlan = null;
      let executionMessage = taskMessage;
      if (canWrite && userAuthorized) {
        const rec = loadPresentedPlan(projectRoot, this._threadId);
        if (rec) {
          consumedPlan = rec;
          executionMessage = `${taskMessage}\n\n${describePresentedPlan(rec)}`;
          clearPresentedPlan(projectRoot, this._threadId);
        }
      }
      const out = await runner({
        decision, message: executionMessage, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
        allowWrite: canWrite, planAuthorizedExecution: canWrite && userAuthorized, maxSteps: canWrite ? AUTHORIZED_MAX_STEPS : CHAT_MAX_STEPS,
        helpers, authorizedFromPending: canWrite && userAuthorized, fullAccess,
        permissionMode: fullAccess ? "full" : permissionMode, images: taskImages,
        presentedPlan: consumedPlan,
      });
      // El Cerebro también APRENDE del turno (contrato de turno): el cierre
      // de una ejecución se recuerda en el almacén que el usuario ve en
      // Herramientas → Cerebro, no solo en la memoria interna del hilo.
      try {
        if (typeof helpers?.brainRemember === "function" && out && out.text) {
          Promise.resolve(helpers.brainRemember(projectRoot, {
            title: "Turno del agente",
            type: "session",
            content: `Pedido: ${String(text || "").slice(0, 300)}\nResultado: ${String(out.text).slice(0, 1200)}`,
          })).catch(() => {});
        }
      } catch { /* recordar nunca bloquea el cierre */ }
      return out;
    }

    return { kind: "CHAT", text: "No terminé de entender el pedido. ¿Me lo reformulás?" };
  }

  // Tras escribir código: con errores verificados pendientes se repiten los mismos chequeos del
  // análisis; si no, solo los estáticos sobre los archivos tocados. Resuelto = el chequeo ahora pasa.
  async appendBeforeAfter(projectRoot, written, textOut, onProgress) {
    const previous = projectRoot ? forensic.loadForensic(projectRoot) : null;
    if (!previous) return textOut;
    try {
      const fixing = Number(previous.counts?.error || 0) > 0;
      const ran = (id) => (previous.checks || []).some((c) => c.id === id && c.status !== "skipped");
      onProgress?.({ phase: "subagent", name: "verifier", text: fixing ? "Reverificando con los mismos chequeos del análisis (antes / después)…" : "Verificando sintaxis e imports de los archivos cambiados…" });
      const after = await forensic.runForensicChecks(projectRoot, fixing
        ? { runTests: ran("tests"), runTypecheck: ran("typecheck"), runBuild: ran("build"), onProgress }
        : { runTests: false, runTypecheck: false, onlyFiles: written, onProgress });
      if (fixing) forensic.saveForensic(projectRoot, after);
      const cmp = forensic.compareForensic(previous, after);
      if (!fixing && !cmp.introduced.length) return textOut;
      return `${textOut}\n\n${forensic.formatComparisonMarkdown(cmp)}`;
    } catch {
      return textOut;
    }
  }

  async runModelTask(opts) {
    const { decision, message, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
      allowWrite, maxSteps, helpers, chatOnly, projectless, authorizedFromPending,
      fullAccess, permissionMode, images: taskImages = [],
      presentedPlan,
      history: taskHistory, threadId: taskThreadId } = opts;
    const threadId = threadCore.resolveThreadId({ threadId: taskThreadId || this._threadId, chatId: this._threadId });
    const historyInput = Array.isArray(taskHistory) && taskHistory.length ? taskHistory : (Array.isArray(this._historyInput) ? this._historyInput : []);

    // Respeta el permiso que YA eligió el usuario en la UI. Nunca lo "resetea".
    const accessFull = fullAccess === true
      || isFullAccess({
        ...(opts && typeof opts === "object" ? opts : {}),
        allowWrite,
        permissionMode,
        fullAccess,
        permissionFull: opts?.permissionFull,
        mode: opts?.mode || permissionMode,
        permission: opts?.permission,
        accessMode: opts?.accessMode,
        agentPermission: opts?.agentPermission,
        permissions: opts?.permissions,
        planAuthorizedExecution: authorizedFromPending,
      });
    // Solo lectura explícita. Acceso completo / Agente NUNCA es read-only.
    const readOnlyMode = !accessFull && /^(?:readonly|read-only|solo[\s-]?lectura)$/i.test(String(permissionMode || "").trim());
    // Con Acceso completo se puede escribir sin pedir "procede". En paso a paso hace falta autorización.
    const orderedWrite = !readOnlyMode && (accessFull || (allowWrite === true && authorizedFromPending === true));
    // CONTRATO DE TURNO (raíz, 2026-11-10): la AUTORIZACIÓN de escritura se
    // decide UNA sola vez y se aplica SOLO en el despacho. Sin modo "step"
    // declarado (uso directo del kernel y llamantes internos históricos) la
    // orden directa del usuario autoriza, como resolvió run() para su ruta.
    const stepDeclared = String(permissionMode || "").trim().toLowerCase() === "step";
    const writeAuthorized = accessFull || orderedWrite || (allowWrite === true && !stepDeclared && !readOnlyMode);

    this.session.start(decision?.kind || "EXECUTE", projectRoot);
    this.abort = new AbortController();
    this.running = true;
    this.turnAbort = null;
    if (!Array.isArray(this.steering)) this.steering = [];

    const globalTimeoutMs = Math.max(60_000, Number(opts.totalTimeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS);
    const deadline = Date.now() + globalTimeoutMs;
    let promiseRetries = 0;
    let noWriteNudges = 0;
    let verifyNudges = 0;
    let closingNudges = 0;
    let planNudges = 0;
    let visualReviewNudges = 0;
    let evidenceBlocks = 0;
    let looseHtmlBlocks = 0;
    let connNudges = 0;
    let narrationRetries = 0;

    const toolHistory = new Map();
    // [EDITCORE-V491-C] Llamadas cortadas por needsAuthorization en
    // ESTE turno: se persisten como plan presentado en cuanto ocurren
    // (no al cierre), para que el plan exista aunque el turno termine
    // por otra vía.
    const presentedCalls = [];
    // [EDITCORE-V491-A] Capturas cuyo PNG va adjunto como imagen en el
    // siguiente mensaje al modelo (se vuelca tras cerrar el lote de
    // herramientas, nunca entre mensajes tool del mismo lote).
    const pendingVisionImages = [];
    const readCache = new Map();
    // [EDITCORE-INTEGRAL-B6] Estado de sesión/parcial del turno: la
    // apiKey puede refrescarse UNA vez por turno ante NO_SESSION y
    // viaja actualizada en los pasos siguientes; un paso parcial
    // (stream cortado) se declara al cerrar, nunca se disfraza.
    let currentApiKey = apiKey;
    let sessionRefreshUsed = false;
    let turnWasPartial = false;
    const refreshSessionSeam = (helpers && (typeof helpers.refreshAccessToken === "function" || typeof helpers.refreshSessionToken === "function" || typeof helpers.getAccessToken === "function"))
      ? async () => {
        const fn = helpers.refreshAccessToken || helpers.refreshSessionToken || helpers.getAccessToken;
        const fresh = await fn();
        return fresh ? String(fresh) : null;
      }
      : null;
    const sessionExpiredError = () => Object.assign(new Error(SESSION_EXPIRED_MESSAGE), { status: 401, code: "NO_SESSION", providerCode: "NO_SESSION" });

    const listOnlyMode = decision?.kind === "LIST" || decision?.kind === "ASK";
    const analysisMode = decision?.kind === "ANALYZE";

    const roadmapFirstBlock = (!chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode) ? buildRoadmapFirstBlock(projectRoot) : "";
    const cognitiveBlock = (!chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode) ? formatCognitiveBlock(projectRoot) : "";
    const connectionsBlock = (!chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode) ? buildConnectionsBlock(projectRoot) : "";
    const pendingVerified = (!chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode && allowWrite) ? forensic.loadForensic(projectRoot) : null;
    const pendingVerifiedBlock = pendingVerified?.counts?.error
      ? [
        `ERRORES VERIFICADOS PENDIENTES (última corrida de chequeos reales, ${String(pendingVerified.generatedAt || "").slice(0, 16).replace("T", " ")}):`,
        ...pendingVerified.findings.filter((f) => f.severity === "error").slice(0, 30)
          .map((f) => `- ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "(proyecto)"} — ${String(f.message).split("\n")[0]}`),
        "Si el usuario pide corregir, empieza por estos. Al terminar, EditCore repite los mismos chequeos y muestra cuáles quedaron resueltos: no declares resuelto nada que no hayas corregido.",
      ].join("\n")
      : "";

    const previewUrl = String(helpers?.previewUrl || "").trim();
    this._activePreviewUrl = previewUrl;
    const previewBlock = previewUrl ? `PREVIEW ACTIVO DEL IDE: ${previewUrl}` : "";
    const visionHardRule = (Array.isArray(taskImages) && taskImages.length) ? "VISION: Hay imágenes adjuntas. Analizalas directamente en este turno." : "";
    const noConfirmBlock = (accessFull || authorizedFromPending)
      ? "ACCESO COMPLETO YA OTORGADO EN EL IDE: está PROHIBIDO pedir activar permisos, Acceso completo, Procede o contraseñas solo para editar/ejecutar. Usá write_file, replace_in_file y run_command YA. No digas 'activa permisos de escritura'."
      : "Modo con confirmación: si necesitás escribir, pedí una orden clara (corrige/procede) o que el usuario active Acceso completo en el IDE.";

    // El system lleva instrucciones (fijas por modo y proyecto, más las skills): el proveedor cachea por prefijo exacto,
    // y los datos que cambian entre turnos (roadmap, mapa, Cerebro, conexiones, rol) van en turnContext, en el mensaje del turno.
    let system;
    // [EDITCORE-INTEGRAL-B2] turnContext acumula { text, tier }: al cerrar
    // se le aplica el presupuesto agregado por prioridades (esencial →
    // normal → accesorio) con applyTurnContextBudget.
    const turnContext = [];
    const pushTurnContext = (tier, ...texts) => {
      for (const t of texts) {
        if (typeof t === "string" && t.trim()) turnContext.push({ text: t, tier });
      }
    };
    if (chatOnly || decision?.kind === "CHAT") {
      system = wrapSystemPrompt([
        "Sos EditCoreAI: asistente del IDE. Respondé siempre en español, claro y directo.",
        MARKDOWN_FORMAT_PROMPT, projectless ? PROJECTLESS_CHAT_PROMPT : CHAT_TOOLS_PROMPT,
        projectless ? "Proyecto abierto: ninguno (conversación libre, sin carpeta)." : `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
      ].filter(Boolean).join("\n\n"));
      pushTurnContext(CTX_TIER_ESSENTIAL, previewBlock, visionHardRule);
    } else if (listOnlyMode) {
      system = wrapSystemPrompt([
        LIST_ONLY_PROMPT, MARKDOWN_FORMAT_PROMPT,
        `Proyecto: ${projectRoot || "(ninguno)"}.`,
      ].filter(Boolean).join("\n\n"));
      pushTurnContext(CTX_TIER_ESSENTIAL, previewBlock, visionHardRule);
    } else if (analysisMode) {
      system = wrapSystemPrompt([
        "Sos EditCoreAI. Estas haciendo un analisis de proyecto.",
        ANALYSIS_MODE_PROMPT,
        MARKDOWN_FORMAT_PROMPT,
        CAPABILITIES_PROMPT,
        "Tenes acceso a `read_file`, `list_files`, `search_files`, `git_status`, `web_search` para profundizar el analisis.",
        "NO uses write_file / replace_in_file (modo solo lectura).",
        `Proyecto: ${projectRoot}.`,
      ].filter(Boolean).join("\n\n"));
      pushTurnContext(CTX_TIER_ESSENTIAL,
        opts.verifiedShown ? "La tabla de chequeos reales y la lista completa de hallazgos verificados YA se muestran al usuario arriba de tu respuesta. NO las copies: prioriza los errores verificados, explica la causa probable de cada uno citando archivo:línea y propone el arreglo. Tus observaciones propias van en la sección de hipótesis." : "",
        previewBlock,
      );
    } else {
      system = wrapSystemPrompt([
        "Sos EditCoreAI. Hablá como un ingeniero senior al lado del usuario.",
        LEADERSHIP_PROMPT, LIVE_NARRATION_PROMPT, MARKDOWN_FORMAT_PROMPT, CAPABILITIES_PROMPT, noConfirmBlock,
        "REGLA CRÍTICA: no cierres un turno diciendo 'ahora leo X' o 'voy a revisar Y'. Si vas a leer algo, llamá la tool en el MISMO turno.",
        "REGLA CRÍTICA: si el usuario pide corregir/arreglar, el trabajo son llamadas reales a replace_in_file/write_file, no texto. Nunca digas que aplicaste un cambio que no hiciste con una tool. Nunca inventes límites ('se me acabaron los tokens', 'se acabó mi turno'): mientras queden errores, sigue corrigiendo; si se agota el turno, EditCore se lo avisa al usuario. Cierra solo cuando terminaste o cuando necesites una decisión del usuario.",
        "Respondé siempre en español al usuario.",
      ].filter(Boolean).join("\n\n"));
      // [EDITCORE-INTEGRAL-B2] Prioridades: roadmap/preview/visión y los
      // errores verificados pendientes son ESENCIALES; el mapa cognitivo y
      // las conexiones son normales (ceden antes si falta presupuesto).
      pushTurnContext(CTX_TIER_ESSENTIAL, roadmapFirstBlock, previewBlock, visionHardRule, pendingVerifiedBlock);
      pushTurnContext(CTX_TIER_NORMAL, cognitiveBlock, connectionsBlock);
    }

    if (!listOnlyMode && wantsConnectGuide(this._currentUserText || message)) pushTurnContext(CTX_TIER_ESSENTIAL, CONNECT_GUIDE_PROMPT);
    if (!chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode && this._ecRoutedAgent && typeof agentNetwork?.rolePrompt === "function") {
      pushTurnContext(CTX_TIER_ACCESSORY, agentNetwork.rolePrompt(this._ecRoutedAgent));
    }
    if (this._skillsPrompt) system = `${system}\n\n${this._skillsPrompt}`;
    // [EDITCORE-V492-2] La línea visible «Skills aplicadas este turno»
    // ya no se emite en NINGUNA ruta (ver handle()): voz natural.
    if (!listOnlyMode && projectRoot) {
      try {
        // La indexación del Cerebro sigue ocurriendo; su contador
        // («Cerebro: indexados N documentos…») ya no se anuncia en la
        // superficie [EDITCORE-V492-2].
        ensureCoreProjectBrain(projectRoot);
      } catch { /* no bloquear turno */ }
    }
    if (!listOnlyMode) pushTurnContext(CTX_TIER_NORMAL, buildBrainContextBlock(projectRoot, this._currentUserText || message));
    if (!listOnlyMode && !chatOnly) {
      const cerebroBlock = await buildCerebroServiceBlock(projectRoot, this._currentUserText || message, helpers);
      if (cerebroBlock) {
        pushTurnContext(CTX_TIER_NORMAL, cerebroBlock);
        // [EDITCORE-V492-2] VOZ NATURAL: la línea-recibo «Cerebro:
        // consulté lo instalado y recordado — N aporte(s)…» (regla
        // v4.7.5, hoy SUPERADA por la regla de producto de Luis de
        // 2026-11-11) ya no se emite. El bloque de servicio del Cerebro
        // SIGUE entrando al contexto del modelo por la línea anterior;
        // si un recuerdo influye en la respuesta, el agente lo menciona
        // en lenguaje natural, no con un contador preestablecido.
      }
    }
    // [EDITCORE-DOSSIER] La memoria semántica existía pero NADIE la leía:
    // PersistentMemory.promptBlockSemantic y globalMemory.promptBlockSemantic
    // estaban definidos y sin un solo llamador; la memoria solo se ESCRIBÍA
    // (note/setReport) y nunca se inyectaba en el turno. Ahora ambas se
    // consultan con la consulta actual, con tope y fail-open: si el vector
    // store no cargó o no hay hits, caen al bloque clásico sin romper nada.
    // Solo en turnos con proyecto y con trabajo real (no CHAT/LIST ni sin
    // proyecto): en conversación libre no hay expediente que consultar.
    if (!listOnlyMode && !chatOnly && decision?.kind !== "CHAT" && projectRoot && !projectless) {
      // [EDITCORE-INTEGRAL-B6] Ambas esperas semánticas con race de
      // timeout (6 s, patrón Cerebro) y señal: fail-open DECLARADO —
      // si vencen o hay stop, el turno arranca sin ese bloque.
      try {
        if (memory && typeof memory.promptBlockSemantic === "function") {
          const memBlock = await raceSemanticBlock(
            () => memory.promptBlockSemantic(String(this._currentUserText || message || "")),
            { signal: this.abort?.signal || null, timeoutMs: Number(helpers?.semanticMemoryTimeoutMs) > 0 ? Number(helpers.semanticMemoryTimeoutMs) : SEMANTIC_MEMORY_TIMEOUT_MS },
          );
          if (memBlock && memBlock.trim()) pushTurnContext(CTX_TIER_ACCESSORY, String(memBlock).slice(0, 3000));
        }
      } catch { /* memoria semántica opcional: nunca tumba el turno */ }
      try {
        if (globalMemory && typeof globalMemory.promptBlockSemantic === "function") {
          const globBlock = await raceSemanticBlock(
            () => globalMemory.promptBlockSemantic(String(this._currentUserText || message || "")),
            { signal: this.abort?.signal || null, timeoutMs: Number(helpers?.semanticMemoryTimeoutMs) > 0 ? Number(helpers.semanticMemoryTimeoutMs) : SEMANTIC_MEMORY_TIMEOUT_MS },
          );
          if (globBlock && globBlock.trim()) pushTurnContext(CTX_TIER_ACCESSORY, String(globBlock).slice(0, 1200));
        }
      } catch { /* memoria global opcional: nunca tumba el turno */ }
    }
    // [EDITCORE-INTEGRAL-B2] Los extras del turno (políticas élite/reparación/
    // base, pipeline, coordinación, especialista) son tier NORMAL: contienen
    // protocolos, pero ceden tras lo esencial y antes que lo accesorio.
    if (!listOnlyMode && Array.isArray(this._turnExtras)) pushTurnContext(CTX_TIER_NORMAL, ...this._turnExtras.filter((x) => typeof x === "string" && x.trim()));
    if (!listOnlyMode) {
      const langDirective = turnLanguageDirective(this._currentUserText || message);
      if (langDirective) pushTurnContext(CTX_TIER_ESSENTIAL, langDirective);
    }
    // [EDITCORE-REVISION-VISUAL] El protocolo de revisión visual viaja
    // en el contexto del turno (no en la política de construcción, que
    // en un turno de pregunta ni entra): juzgar solo desde la captura
    // del preview activo, nunca del nombre del archivo ni del alt.
    // OJO: sin excluir listOnlyMode — la pregunta P-3 se clasifica ASK
    // y ASK cae en listOnlyMode dentro de runModelTask; excluirlo
    // dejaría fuera justo el caso que se viene a arreglar.
    if (!chatOnly && this._visualReviewTask === true) {
      pushTurnContext(CTX_TIER_ESSENTIAL, VISUAL_REVIEW_PROTOCOL);
    }
    // [EDITCORE-V492-3] El protocolo anti-confabulación viaja en el
    // contexto del turno igual que el visual — también sin excluir
    // listOnlyMode: la pregunta de recuerdo se clasifica ASK y ASK cae
    // en listOnlyMode dentro de runModelTask.
    if (!chatOnly && this._memoryEvent) {
      pushTurnContext(CTX_TIER_ESSENTIAL, MEMORY_EVENT_PROTOCOL);
    }

    const userText = `Proyecto: ${projectless ? "(ninguno)" : projectRoot}\n${scopeUserMessage(message)}`;
    // [EDITCORE-INTEGRAL-B2] El contexto del turno sale SIEMPRE por el
    // presupuesto agregado: por prioridades y con marca declarada si corta.
    const messages = threadCore.buildMessageList({ system, systemPrefix: listOnlyMode ? "" : SELF_KNOWLEDGE_PROMPT, turnContext: applyTurnContextBudget(turnContext), userText, projectRoot, threadId, historyInput, query: String(this._currentUserText || message || ""), images: taskImages });

    const steps = [];
    const runMutations = [];
    const chatMode = Boolean(chatOnly || decision?.kind === "CHAT");
    const stepsLimit = Math.max(1, Number(maxSteps) || (chatMode ? CHAT_MAX_STEPS : (fullAccess ? AUTHORIZED_MAX_STEPS : DEFAULT_MAX_STEPS)));
    const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_write_input_tokens: 0, cachedInputTokens: 0, provider_cache_read_tokens: 0, cached_input_tokens: 0, provider_calls: 0 };
    const addUsage = (raw = {}) => {
      const input = Number(raw.prompt_tokens || raw.input_tokens || 0);
      const output = Number(raw.completion_tokens || raw.output_tokens || 0);
      totalUsage.prompt_tokens += input;
      totalUsage.completion_tokens += output;
      totalUsage.total_tokens += Number(raw.total_tokens || 0) || input + output;
      const cacheRead = Number(raw.cache_read_input_tokens || raw.cachedInputTokens || raw.cached_tokens || 0);
      const cacheWrite = Number(raw.cache_creation_input_tokens || raw.cache_write_input_tokens || 0);
      totalUsage.cache_read_input_tokens += cacheRead;
      totalUsage.cache_creation_input_tokens += cacheWrite;
      totalUsage.cache_write_input_tokens += cacheWrite;
      totalUsage.cachedInputTokens += cacheRead;
      totalUsage.provider_cache_read_tokens += cacheRead;
      totalUsage.cached_input_tokens += cacheRead;
      if (input || output) totalUsage.provider_calls += 1;
    };

    const routed = pickModel({ requested: model, kind: decision?.kind || "CHAT", hasTools: !(chatOnly || decision?.kind === "CHAT") });
    const routedModel = String(routed.model || model || "").trim();
    const rememberOut = (textOut, extra = {}) => {
      try {
        threadCore.rememberExchange(projectRoot, threadId, this._currentUserText || message, textOut, {
          steps,
          written: successfulWritePaths(steps),
          // [EDITCORE-INTEGRAL-B3] Señal de autorización del turno para
          // la destilación de decisiones en thread-core: solo vale como
          // hecho si el mensaje del usuario fue una aprobación o trae la
          // marca de instrucción autorizada que handle() genera desde
          // esa aprobación; el flag solo nunca crea la decisión.
          userAuthorized: authorizedFromPending === true,
          ...extra,
        });
      } catch { /* ignore */ }
    };

    // Timeout por turno: 3 min en análisis, default en el resto.
    const turnTimeoutMs = analysisMode ? ANALYSIS_TIMEOUT_MS : undefined;

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (Date.now() > deadline) {
          this.session.kill();
          const partial = formatAgentVisibleText("## ⏱️ Tiempo agotado\n\nSe agotó el tiempo límite de este turno y la tarea **no está terminada**. Avance parcial registrado: escribe **continúa** y sigo donde quedé.");
          rememberOut(partial); detachLongRunningStreams(steps);
          return { kind: decision?.kind || "CHAT", text: partial, steps, incomplete: true, threadId, usage: totalUsage };
        }
        if (!this.session.alive) {
          rememberOut("Detenido."); detachLongRunningStreams(steps);
          return { kind: "STOP", text: "Detenido.", steps, threadId, usage: totalUsage };
        }

        const availableTools = projectless
          ? []
          : chatMode
          ? (i < stepsLimit - 1
            ? tools.getToolDefinitions({ allowWrite: false, isFullAccess: false, isAnalysis: false })
              .filter((t) => CHAT_READ_TOOLS.has(t.function?.name || t.name))
            : [])
          // CONTRATO DE TURNO: en modo Agente el modelo ve SIEMPRE el set
          // completo de herramientas (allowWrite: true SOLO decide la
          // VISIBILIDAD de las definiciones). Antes, sin autorización previa
          // el set salía recortado y el agente quedaba sin manos a mitad de
          // conversación ("no tengo herramienta de escritura directa"),
          // delegando a ciegas. La escritura sin autorización la corta el
          // DESPACHO (compuerta única, más abajo), no la vista del modelo.
          : tools.getToolDefinitions({ allowWrite: true, isFullAccess: accessFull, isAnalysis: false })
            // [EDITCORE-INTEGRAL-B4] rollback_last_change SALE de esta
            // lista de filtradas: la herramienta ya es real (definición
            // + case sobre snapshot.js) y la compuerta única decide su
            // ejecución como con cualquier escritura — filtrarla aquí
            // era el tercer candado que la hacía fantasma.
            .filter((t) => !["preview_browser_interaction", "browser_page_action", "auto_scaffold_project", "clone_web_page", "images_to_code"].includes(t.function?.name || t.name))
            // Ojos solo donde aportan: la captura del preview se ofrece en tareas
            // de UI/construcción (this._uiTask lo fija handle); en el resto sigue fuera.
            // [EDITCORE-REVISION-VISUAL] También en turnos de revisión
            // visual (_visualReviewTask): preguntar por las imágenes sin
            // ofrecer la captura condenaba al agente a juzgar por el
            // nombre del archivo y el texto alt (P-3, tres veces).
            .filter((t) => this._uiTask === true || this._visualReviewTask === true || (t.function?.name || t.name) !== "capture_preview_screenshot");

        this.turnAbort = new AbortController();
        const turnSignal = (typeof AbortSignal.any === "function" && this.abort?.signal) ? AbortSignal.any([this.abort.signal, this.turnAbort.signal]) : (this.turnAbort.signal || this.abort?.signal);

        const hb = setInterval(() => { try { onProgress?.({ phase: "heartbeat", text: "Procesando…" }); } catch {} }, HEARTBEAT_INTERVAL_MS);

        // Inyectar direcciones/consultas pendientes del usuario antes del turno del modelo
        if (Array.isArray(this.steering) && this.steering.length > 0) {
          const pendingSteer = this.steering.splice(0).map((s) => (typeof s === "object" ? s.instruction : s)).filter(Boolean);
          if (pendingSteer.length > 0) {
            const steerBlock = pendingSteer.join("\n\n");
            messages.push({ role: "user", content: `INSTRUCCIÓN / CONSULTA DEL USUARIO MIENTRAS TRABAJABAS: "${steerBlock}". Responde o ajusta tu trabajo inmediatamente según esta consulta sin perder el avance de las herramientas ya ejecutadas ni romper la memoria del proyecto.` });
            onProgress?.({ phase: "direction", text: `Recibida instrucción del usuario: ${pendingSteer[0].slice(0, 80)}…` });
          }
        }

        // Compactar outputs antiguos de tools para evitar desbordar el contexto del modelo (3.4M tokens)
        // Compactación profunda y poda de contexto (cosechado al kernel en la convergencia)
        try {
          const { ContextCompactor } = require("./context-compactor");
          const compactor = new ContextCompactor();
          messages = compactor.compactMessages(messages);
        } catch (_) {
          if (Array.isArray(messages) && messages.length > 16) {
            let toolSeen = 0;
            for (let idx = messages.length - 1; idx >= 0; idx--) {
              const m = messages[idx];
              if (m && m.role === "tool") {
                toolSeen++;
                if (toolSeen > 8 && typeof m.content === "string" && m.content.length > 250) {
                  try {
                    const parsed = JSON.parse(m.content);
                    const brief = {
                      ok: parsed.ok !== false,
                      summary: parsed.summary || parsed.note || (parsed.path ? `archivo ${parsed.path} procesado` : "resultado previo completado"),
                      compacted: true,
                    };
                    m.content = JSON.stringify(brief);
                  } catch (_) {
                    m.content = JSON.stringify({ ok: true, summary: "resultado previo completado", compacted: true });
                  }
                }
              }
            }
          }
        }

        let turn;
        try {
          // Inyección opcional del llamador de chat (helpers.callChat): la
          // usa el bridge para arneses/pruebas; en producción no viene y se
          // usa el callChat real del proveedor.
          const chatCaller = (helpers && typeof helpers.callChat === "function") ? helpers.callChat : callChat;
          // [EDITCORE-INTEGRAL-B6] Paso con SESIÓN VIVA: si el proxy
          // responde NO_SESSION (el token de 1 h venció a mitad de un
          // turno largo), se re-pide el token UNA vez por la costura
          // inyectada (helpers.refreshAccessToken, que main conecta a
          // authManager.getAccessToken) y el paso se reintenta con el
          // token fresco ANTES de matar el turno. El provider real
          // recibe la misma costura (refreshApiKey) para refrescar
          // dentro de su propio reintento; su aviso marca el refresco
          // como usado para no pedir dos veces. Si el refresco falla
          // o el NO_SESSION persiste: error de SESIÓN.
          const invokeModel = () => chatCaller({
            apiBaseUrl, apiKey: currentApiKey, model: routedModel, messages,
            tools: availableTools,
            signal: turnSignal,
            stream: true,
            timeoutMs: turnTimeoutMs,   // ← 180s en análisis
            fallbackProfiles: this._fallbackProfiles || [],
            refreshApiKey: refreshSessionSeam,
            onSessionRefreshed: (fresh) => { currentApiKey = String(fresh); sessionRefreshUsed = true; },
            onFallback: ({ model: fallbackModel }) => { try { onProgress?.({ phase: "heartbeat", text: `Cambiando a ${fallbackModel}…` }); } catch {} },
            // [EDITCORE-PRESENTACION] SIN onTextDelta a propósito: antes los
            // deltas del modelo se volcaban CRUDOS a la narrativa del chat
            // (narration_delta) — el usuario leía el razonamiento interno
            // en inglés, con sus auto-instrucciones filtradas, y al final
            // la respuesta REPETÍA la misma evidencia ya volcada (en vivo,
            // P-3 de la v4.7.4: 27k tokens para un sí/no contado dos
            // veces). La narrativa visible de un turno ahora es SOLO lo
            // que el kernel compone: líneas de acción por herramienta,
            // Cerebro/skills aplicadas, compuertas y el latido con su
            // temporizador; la única prosa del modelo es su respuesta
            // final, una sola vez. El texto completo del paso sigue
            // llegando en turn.text (parseo de tool calls intacto).
          });
          // [EDITCORE-INTEGRAL-B6] Ejecución del paso con el
          // reintento de sesión descrito arriba (invokeModel).
          try {
            turn = await invokeModel();
          } catch (firstErr) {
            if (!isNoSessionError(firstErr)) throw firstErr;
            if (sessionRefreshUsed || !refreshSessionSeam) throw sessionExpiredError();
            sessionRefreshUsed = true;
            let fresh = null;
            try { fresh = await refreshSessionSeam(); } catch { fresh = null; }
            if (!fresh) throw sessionExpiredError();
            currentApiKey = String(fresh);
            try { onProgress?.({ phase: "heartbeat", text: "Sesión renovada: reintentando el paso…" }); } catch { /* ignore */ }
            try {
              turn = await invokeModel();
            } catch (secondErr) {
              if (isNoSessionError(secondErr)) throw sessionExpiredError();
              throw secondErr;
            }
          }
        } catch (callErr) {
          if (callErr?.code === "AGENT_STEER" || String(callErr?.message || "").includes("Nueva instruccion") || (Array.isArray(this.steering) && this.steering.length > 0)) {
            // Reorientación sin romper el avance: capturar la nueva orden del usuario y continuar el bucle
            const pendingSteer = (Array.isArray(this.steering) ? this.steering.splice(0) : []).map((s) => (typeof s === "object" ? s.instruction : s)).filter(Boolean);
            const steerBlock = pendingSteer.length > 0 ? pendingSteer.join("\n\n") : "Continúa respondiendo a la última instrucción.";
            messages.push({ role: "user", content: `INSTRUCCIÓN / CONSULTA DEL USUARIO MIENTRAS TRABAJABAS: "${steerBlock}". Responde o ajusta tu trabajo inmediatamente según esta consulta sin perder el avance de las herramientas ya ejecutadas ni romper la memoria del proyecto.` });
            onProgress?.({ phase: "direction", text: `Reorientando agente: ${steerBlock.slice(0, 80)}…` });
            continue;
          }
          throw callErr;
        } finally {
          clearInterval(hb); this.turnAbort = null;
        }
        addUsage(turn?.usage || {});
        // [EDITCORE-INTEGRAL-B6] Paso parcial (stream cortado): queda
        // registrado y el cierre lo declara; no se presenta completo.
        if (turn?.partial === true) turnWasPartial = true;

        let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        if (!toolCalls.length && turn.text) toolCalls = parseTextToolCalls(turn.text, { projectRoot });
        if (chatMode) toolCalls = availableTools.length ? toolCalls.filter((c) => CHAT_READ_TOOLS.has(c.function?.name)) : [];
        const cleanText = stripTextToolMarkup(turn.text || "");

        if (!toolCalls.length) {
          // NARRACIÓN COMO RESPUESTA, también en modo CHAT: si TODO el turno
          // es "sigue leyendo… / voy a revisar…" sin herramientas, no es una
          // respuesta, es el modelo narrando a mitad de tarea (pasa cuando el
          // historial trae una tarea de agente y el turno se clasifica CHAT).
          // En CHAT ninguna otra compuerta lo atrapaba: el fragmento salía
          // como respuesta final. Se empuja UNA vez a responder o a leer.
          if ((chatOnly || decision?.kind === "CHAT")
            && narrationRetries < 1
            && i < stepsLimit - 1
            && looksLikePromiseWithoutAction(cleanText)) {
            narrationRetries += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "No cierres con una narración de lo que estás haciendo. Responde ahora a la pregunta del usuario con lo que ya sabes, o usa las herramientas de lectura (read_file, list_files, search_files) si necesitas revisar el proyecto antes de responder." });
            onProgress?.({ phase: "model", text: "Narración sin respuesta: pidiendo que responda o actúe" });
            continue;
          }

          // Sin !listOnlyMode: en ASK/LIST el empujón solo puede dispararse
          // cuando el texto ES promesa/narración (looksLikePromiseWithoutAction
          // ya es condición), y una narración a mitad de tarea tampoco es una
          // respuesta válida en esos modos: antes el turno cerraba con el
          // fragmento ("Sigue leyendo el archivo…") como si fuera la respuesta.
          const promisesAction = !chatOnly && decision?.kind !== "CHAT" && !analysisMode
            && looksLikePromiseWithoutAction(cleanText)
            && promiseRetries < MAX_PROMISE_RETRIES
            && i < stepsLimit - 1
            && successfulWritePaths(steps).length === 0;

          if (promisesAction) {
            promiseRetries += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: `No cierres el turno. Ejecutá AHORA las tools que prometiste ("${cleanText.slice(-120)}").` });
            onProgress?.({ phase: "model", text: `Reintentando: promesa sin acción (${promiseRetries}/${MAX_PROMISE_RETRIES})` });
            continue;
          }

          const textDiffWithoutWrite = !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode
            && (accessFull || orderedWrite)
            && /(?:---|\+\+\+|@@)\s+[ab]\/|```(?:diff|patch)/i.test(cleanText)
            && successfulWritePaths(steps).length === 0
            && noWriteNudges < MAX_NO_WRITE_NUDGES
            && i < stepsLimit - 1;
          if (textDiffWithoutWrite) {
            noWriteNudges += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "No muestres diffs en texto markdown. Tienes acceso completo para editar archivos: ejecuta los cambios DIRECTAMENTE llamando a la herramienta replace_in_file o write_file en este mismo turno." });
            onProgress?.({ phase: "model", text: `Diff en texto detectado: pidiendo que aplique las herramientas de escritura (${noWriteNudges}/${MAX_NO_WRITE_NUDGES})` });
            continue;
          }

          const fixWithoutWrites = !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode
            && (accessFull || orderedWrite)
            && FIX_INTENT_RE.test(`${this._currentUserText || ""} ${message || ""}`)
            && successfulWritePaths(steps).length === 0
            && noWriteNudges < MAX_NO_WRITE_NUDGES
            && i < stepsLimit - 1;
          if (fixWithoutWrites) {
            noWriteNudges += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "Todavía no modificaste ningún archivo y el usuario pidió corregir/implementar. No describas cambios ni digas que los aplicaste: aplícalos AHORA con replace_in_file o write_file (lee antes el archivo si hace falta). Solo si de verdad no hace falta cambiar nada, explica por qué con evidencia concreta (archivo:línea o salida de un comando)." });
            onProgress?.({ phase: "model", text: `Sin cambios aplicados todavía: pidiendo que aplique las correcciones (${noWriteNudges}/${MAX_NO_WRITE_NUDGES})` });
            continue;
          }

                    const userMsg = String(this._currentUserText || message || "");
          if (!analysisMode && !listOnlyMode && wantsCodeSearch(userMsg) && i < stepsLimit - 2) {
            const usedSearch = steps.some((s) => s.name === "search_files" || s.name === "search_codebase_semantic" || s.name === "search_brain");
            if (!usedSearch) {
              messages.push({ role: "assistant", content: cleanText || null });
              messages.push({ role: "user", content: "No listes la raiz. Ejecuta AHORA search_codebase_semantic o search_files (auth/login/signIn) y reporta archivo + lineas. Cierra SIN menus ni opciones." });
              onProgress?.({ phase: "model", text: "Forzando busqueda en codigo..." });
              continue;
            }
          }
          if (!analysisMode && !listOnlyMode && wantsConnectionsCheck(userMsg) && connNudges < 1 && i < stepsLimit - 2) {
            const usedConn = steps.some((s) => s.name === "check_connections");
            if (!usedConn) {
              connNudges += 1;
              messages.push({ role: "assistant", content: cleanText || null });
              messages.push({ role: "user", content: "Ejecuta AHORA check_connections y muestra checklist. No uses list_files de la raiz. Cierra SIN preguntar opciones." });
              onProgress?.({ phase: "model", text: "Forzando check_connections..." });
              continue;
            }
          }

// En ANALYSIS: si el reporte es muy corto, forzar un turno más.
          if (analysisMode && cleanText.trim().length < 400 && i < stepsLimit - 1 && !/##\s*(?:📊|🏗️|⚙️|⚠️|🎯|📁)/.test(cleanText)) {
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "El reporte es demasiado corto. Necesito un análisis completo con las secciones obligatorias (📊 Resumen ejecutivo, 🏗️ Arquitectura, ⚙️ Funcionalidad, ⚠️ Hallazgos, 🎯 Recomendaciones, 📁 Evidencia). Si te falta contexto, usa read_file ANTES de cerrar." });
            onProgress?.({ phase: "model", text: "Reporte corto detectado. Pidiendo análisis completo..." });
            continue;
          }

          // [EDITCORE-CONSOLIDADA] Compuerta de CIERRE-PLAN: en un turno
          // AUTORIZADO con intención de mutación, cerrar con el PLAN
          // (mapa + pasos en infinitivo) sin haber escrito nada no es
          // un cierre válido: el usuario pidió el resultado, no el mapa
          // (así murió el turno de testimonios de la batería v4.7.5, y
          // ninguna compuerta lo atrapó: la de presencia pide una
          // propuesta, no la ejecución). Se devuelve el turno UNA vez
          // ordenando EJECUTAR el plan ahora con las herramientas. En
          // «Pregunta antes» sin autorización NO aplica: ahí el cierre
          // correcto es la propuesta + «¿procedo?» (compuerta de
          // presencia, justo debajo).
          const planClose = !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode && !projectless
            && (accessFull || writeAuthorized)
            && planNudges < MAX_CLOSE_NUDGES && i < stepsLimit - 1
            && successfulWritePaths(steps).length === 0
            && hasMutationIntent(`${this._currentUserText || ""} ${message || ""}`)
            && looksLikePlanClose(cleanText);
          if (planClose) {
            planNudges += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "No cierres con el plan: estás AUTORIZADO a ejecutar en este turno y el usuario pidió el RESULTADO, no el mapa de lo que harías. EJECUTA AHORA ese plan con las herramientas: lee lo que falte, consigue los recursos con las herramientas del proyecto (fetch_stock_photo, read_file…) y aplica los cambios con write_file / replace_in_file. Si un paso resulta imposible, ejecuta los demás y reporta ese paso con su error exacto al cerrar." });
            onProgress?.({ phase: "model", text: "Cierre en forma de plan: pidiendo que lo ejecute ahora" });
            continue;
          }

          // [EDITCORE-PRESENCIA] Cierre propositivo (regla de producto de
          // Luis, 2026-11-10): un turno de Agente NO puede cerrar «mocho» —
          // ni en plan narrado ni en reporte pelado — cuando el pedido
          // implica mutación y no se escribió nada. La compuerta del
          // despacho solo habla si el modelo INTENTA escribir; un modelo
          // cauteloso que nunca intenta moría en el diagnóstico (así cerró
          // dos veces el turno de la C-1: evidencia correcta, cero
          // propuesta, cero pedido de autorización). Si el cierre ya trae
          // pregunta o propuesta, pasa; si no, se devuelve UNA vez:
          //  (a) en «Pregunta antes» sin autorización: presentar el arreglo
          //      concreto y pedir el «procede»;
          //  (b) autorizado: proponer el siguiente paso con nombre propio
          //      (las compuertas de aplicación ya empujaron a ejecutar;
          //      esta es la red final del cierre).
          const closingBare = !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode && !projectless
            && closingNudges < MAX_CLOSE_NUDGES && i < stepsLimit - 1
            && successfulWritePaths(steps).length === 0
            && cleanText.trim().length >= 60
            && !/(?:¿[^?]*\?|\bprocede\b|\bautoriz|\bpropongo\b|siguiente paso|¿quieres|¿puedo|¿sigo)/i.test(cleanText.slice(-600));
          if (closingBare) {
            const userTextForIntent = `${this._currentUserText || ""} ${message || ""}`;
            // [EDITCORE-CONSOLIDADA] Léxico centralizado (hasMutationIntent):
            // antes esta fusión vivía duplicada aquí y en la garantía del
            // «procede», sin los verbos de mejora («mejora el hero» no
            // disparaba ninguna compuerta).
            const mutationIntent = hasMutationIntent(userTextForIntent);
            if (mutationIntent && stepDeclared && !writeAuthorized) {
              closingNudges += 1;
              messages.push({ role: "assistant", content: cleanText || null });
              messages.push({ role: "user", content: "No cierres con un reporte pelado. Estás en modo «Pregunta antes» y este pedido requiere escribir: presenta AHORA tu propuesta — el arreglo concreto por archivo, apoyado en la evidencia que ya trajiste — y pide la autorización del usuario para ejecutarlo («¿procedo?»). El usuario decide con tu propuesta a la vista, no con un parte." });
              onProgress?.({ phase: "model", text: "Cierre sin propuesta: pidiendo que presente el arreglo y pida autorización" });
              continue;
            }
            if (mutationIntent) {
              closingNudges += 1;
              messages.push({ role: "assistant", content: cleanText || null });
              messages.push({ role: "user", content: "No cierres «mocho»: tu cierre debe traer el resultado Y una propuesta concreta del siguiente paso (qué harías ahora, en qué archivos y para qué), o la pregunta exacta que necesitas que el usuario responda. Un usuario que va empezando debe saber qué sigue con solo leerte." });
              onProgress?.({ phase: "model", text: "Cierre sin propuesta: pidiendo cierre propositivo" });
              continue;
            }
          }

          // [EDITCORE-REVISION-VISUAL] Compuerta de cierre: en un turno
          // de revisión visual, cerrar con un juicio sobre las imágenes
          // sin que ningún paso haya capturado el preview ES el fallo
          // (P-3, tres veces en vivo: veredictos leídos del nombre del
          // archivo y del texto alt mientras el hero visible era otra
          // cosa). Se devuelve el turno UNA vez ordenando mirar; si aun
          // así cierra sin capturar, la finalización antepone el banner
          // honesto de «no verificado con la vista».
          const visualReviewWithoutCapture = this._visualReviewTask === true
            && !chatOnly && decision?.kind !== "CHAT" && !analysisMode && !projectless
            && visualReviewNudges < MAX_CLOSE_NUDGES && i < stepsLimit - 1
            && !steps.some((s) => s.name === "capture_preview_screenshot");
          if (visualReviewWithoutCapture) {
            visualReviewNudges += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "ALTO: este turno es una REVISIÓN VISUAL y todavía no capturaste el preview: un juicio sobre las imágenes no puede salir del nombre del archivo, del texto alt ni de los comentarios del código. Ejecuta AHORA capture_preview_screenshot sobre el PREVIEW ACTIVO de tu contexto, mira lo que se ve (hero, tarjetas y secciones) y cierra con el veredicto por zona apoyado en esa captura. Si la captura falla o no hay preview activo, dilo con esas palabras en vez de certificar." });
            onProgress?.({ phase: "model", text: "Revisión visual sin captura: pidiendo que mire el preview antes de juzgar…" });
            continue;
          }

          // [EDITCORE-REPAIR] Sin verificación real no hay "corregido":
          // un turno de reparación que editó archivos no puede cerrarse
          // apoyado solo en la comprobación ligera por archivo (así se
          // declararon tres éxitos falsos en la sesión VIXERAI). Se le
          // devuelve el turno UNA vez para que verifique de verdad; si
          // aun así cierra, la finalización adjunta la verificación
          // real automática con su veredicto.
          const unverifiedRepair = this._repairTask === true
            && !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode
            && successfulWritePaths(steps).length > 0
            && !(repairGuard && repairGuard.turnHasPassingRealVerification(steps, successfulWritePaths(steps)))
            && verifyNudges < MAX_CLOSE_NUDGES
            && i < stepsLimit - 1;
          if (unverifiedRepair) {
            verifyNudges += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "ALTO: todavía no hay una verificación REAL aprobada en este turno (captura del preview activo con renderOk y sin errores de consola, o build del proyecto en verde). No des el problema por corregido. Ejecuta AHORA la verificación que corresponde (capture_preview_screenshot sobre el PREVIEW ACTIVO de tu contexto, o run_command con el build), lee su resultado y actúa según él: si falla, sigue corrigiendo desde ese error exacto; si pasa, cierra citando esa evidencia." });
            onProgress?.({ phase: "model", text: "Sin verificación real: pidiendo verificar antes de cerrar…" });
            continue;
          }

          this.session.kill();
          const written = successfulWritePaths(steps);
          let textOut = cleanText;

          // [EDITCORE-V491-C] La presentación en prosa del plan (lo que
          // el usuario leyó antes de decir «procede») se anexa al plan
          // persistido por las llamadas cortadas: el turno de ejecución
          // recibe también CÓMO se describió el cambio.
          if (presentedCalls.length) {
            const recForText = loadPresentedPlan(projectRoot, threadId);
            if (recForText) {
              recForText.presentedText = String(cleanText || "").slice(0, 3000);
              savePresentedPlan(projectRoot, threadId, recForText);
            }
          }

          // [EDITCORE-CONSOLIDADA] El 📁 solo cuando el pedido ERA de
          // listado (shouldFormatAsListing): un ASK con lecturas
          // reales conserva la respuesta sustantiva del modelo.
          if (listOnlyMode && shouldFormatAsListing({ decision, steps, cleanText })) {
            textOut = formatListOnlyAnswer(cleanText, steps, message);
          } else if (written.length > 0) {
            if (cleanText && cleanText.trim().length >= 60) textOut = cleanText;
            else {
              const head = cleanText && cleanText.length > 20 ? cleanText + "\n\n" : "";
              const lista = written.map((p) => `- \`${p}\``).join("\n");
              textOut = `## ✅ Cambios aplicados\n\n${head}Archivos actualizados:\n\n${lista}\n\n${nextStepsClosingText(projectRoot, written, steps)}`;
            }
          } else {
            textOut = groundUngroundedClaims(cleanText, steps, message, decision, Number(opts.evidenceReads) || 0);
          }

          // [EDITCORE-INTEGRAL-B1] Resumen factual del KERNEL antepuesto al
          // relato: los hechos (archivos + hunks reales + auditoría de lo
          // delegado) salen de los steps, no de la prosa del modelo. Si el
          // modelo exagera, el lector contrasta arriba qué cambió de verdad.
          if (!listOnlyMode && !analysisMode && !chatOnly && decision?.kind !== "CHAT") {
            const factSummary = buildKernelFactSummary(steps);
            if (factSummary) textOut = `${factSummary}\n\n---\n\n${String(textOut || "").trim()}`;
          }

          // [EDITCORE-INTEGRAL-B1] Garantía ESTRUCTURAL (sin regex sobre la
          // prosa): pedido con intención de mutación + turno AUTORIZADO +
          // CERO escrituras registradas = el kernel lo dice él mismo,
          // suene como suene el cierre del modelo. Extiende la garantía
          // determinista del «procede» (abajo, para «Pregunta antes») al
          // caso autorizado: aquí no falta autorización, falta el cambio.
          if (written.length === 0 && !listOnlyMode && !analysisMode && !chatOnly && !projectless
            && decision?.kind !== "CHAT" && writeAuthorized) {
            const intentText = `${this._currentUserText || ""} ${message || ""}`;
            if (hasMutationIntent(intentText)) {
              textOut = `${String(textOut || "").trim()}\n\n---\n\n**Nota del kernel:** este pedido implicaba cambios y estabas autorizado a escribir, pero el kernel **no registró ninguna escritura** en este turno. Nada quedó aplicado: pide que se ejecute el cambio o revisa el motivo exacto arriba.`;
            }
          }

          // [EDITCORE-V491-C] Ejecución de un plan PRESENTADO: si el
          // turno escribió archivos FUERA del plan que el usuario
          // autorizó, el cierre lo declara — el usuario autorizó otra
          // cosa y tiene derecho a saber que se hizo de más.
          if (presentedPlan && written.length > 0 && !listOnlyMode && !chatOnly) {
            const allowedPaths = presentedPlanPaths(presentedPlan);
            const outside = written.filter((p) => !allowedPaths.some((a) => p === a || p.endsWith(`/${a}`) || a.endsWith(`/${p}`)));
            if (outside.length) {
              textOut = `${String(textOut || "").trim()}\n\n---\n\n**Nota del kernel:** este turno ejecutaba el plan presentado y autorizado por el usuario (${allowedPaths.map((a) => `\`${a}\``).join(", ") || "sin archivos declarados"}), pero también escribió FUERA del plan presentado: ${outside.map((p) => `\`${p}\``).join(", ")}. Ese exceso no era lo presentado: revísalo con el usuario antes de darlo por bueno.`;
            }
          }

          // [EDITCORE-PRESENTACION] Garantía DETERMINISTA del «¿procedo?»:
          // la compuerta de cierre (v4.7.4) le DEVUELVE el turno al modelo
          // una vez, pero en vivo el modelo obedeció una prohibición vieja
          // de request-scope-policy («PROHIBIDO… '¿procedemos a…?'») y
          // cerró igual sin preguntar (P-1 de la v4.7.4). La prohibición
          // ya quedó acotada en su casa; esta es la red que no depende de
          // obediencia: si el turno es «Pregunta antes», el pedido implica
          // mutación, no se escribió nada y el cierre sigue sin traer la
          // pregunta, el KERNEL adjunta el pedido de autorización. No
          // fabrica la propuesta (esa la escribió el modelo arriba): solo
          // garantiza que el usuario siempre tenga el «procede» a la vista.
          if (written.length === 0 && !listOnlyMode && !analysisMode && !chatOnly && !projectless
            && decision?.kind !== "CHAT" && stepDeclared && !writeAuthorized) {
            const intentText = `${this._currentUserText || ""} ${message || ""}`;
            // [EDITCORE-CONSOLIDADA] Misma fuente única que la compuerta
            // de cierre: hasMutationIntent (FIX + suplemento + mejora).
            const mutationIntent = hasMutationIntent(intentText);
            if (mutationIntent && !/(?:¿[^?]*\?|\bprocede\b|\bautoriz)/i.test(String(textOut || "").slice(-800))) {
              textOut = `${String(textOut || "").trim()}\n\n---\n\n**No apliqué ningún cambio**: estoy en modo «Pregunta antes» y este pedido requiere escribir. Si quieres que ejecute el arreglo tal como lo describí, responde **«procede»** y lo hago en este mismo chat.`;
            }
          }

          // [EDITCORE-REVISION-VISUAL] Banner honesto DETERMINISTA: si
          // el turno era de revisión visual y ningún paso capturó el
          // preview, el juicio sobre las imágenes queda marcado al
          // frente como NO verificado con la vista. Mismo espíritu que
          // la garantía del «procede» de aquí arriba: lo que el kernel
          // sabe, el usuario lo lee — el agente no puede certificar en
          // silencio lo que nunca miró. (Si la herramienta se llamó y
          // falló, el paso existe y el banner no sale: el propio
          // resultado de la captura ya cuenta la falla.)
          if (this._visualReviewTask === true && !analysisMode && !chatOnly && !projectless
            && decision?.kind !== "CHAT"
            && !steps.some((s) => s.name === "capture_preview_screenshot")
            && String(textOut || "").trim()) {
            textOut = `> ⚠️ **Este juicio sobre las imágenes NO se verificó con la vista: no se capturó el preview en este turno.**\n\n${String(textOut || "").trim()}`;
          }

          // [EDITCORE-V492-3] Guarda anti-confabulación DETERMINISTA:
          // si el turno preguntaba por un evento concreto, el evento
          // NO consta en el expediente y la respuesta aun así lo
          // AFIRMA, el kernel antepone su corrección honesta — el
          // mismo espíritu que el banner visual de aquí arriba: lo que
          // el kernel sabe (el expediente), el usuario lo lee. No se
          // reescribe la respuesta del modelo; se la marca al frente.
          if (this._memoryEvent && !projectless && decision?.kind !== "CHAT"
            && String(textOut || "").trim()) {
            const memoryBanner = memoryEventGuardBanner(this._memoryEvent, textOut, projectRoot);
            if (memoryBanner) textOut = `${memoryBanner}\n\n${String(textOut || "").trim()}`;
          }

          if (written.length > 0) {
            textOut = await this.appendBeforeAfter(projectRoot, written, textOut, onProgress);
            try {
              const verifyReports = await runPostWriteVerify(projectRoot, written, onProgress, { signal: this.abort?.signal || null }); // [EDITCORE-INTEGRAL-B6]
              textOut = String(textOut || "") + formatVerifyBlock(verifyReports);
              textOut = await appendRealVerification(projectRoot, written, steps, textOut, onProgress, { repairTask: this._repairTask === true, previewUrl: this._activePreviewUrl || "", signal: this.abort?.signal || null }); // [EDITCORE-INTEGRAL-B6]
            } catch (_) { /* verify no debe tumbar el turno */ }
          }
          // [EDITCORE-INTEGRAL-B6] Cierre con parcial DECLARADO: si
          // algún paso llegó cortado (partial), la respuesta no se
          // presenta como completa.
          if (turnWasPartial) {
            textOut = `${String(textOut || "").trim()}\n\n> ⚠️ **Respuesta parcial:** el proveedor cortó la transmisión en este turno; lo de arriba puede estar incompleto. Pide «continúa» si falta algo.`;
          }
          textOut = formatAgentVisibleText(textOut);
          persistKernelRoadmap(projectRoot, { task: this._currentUserText || message, steps, kind: decision?.kind, text: textOut, completed: true });
          rememberOut(textOut); detachLongRunningStreams(steps);
          // [EDITCORE-ADD] Feedback de éxito a la red neuronal.
          try {
            if (agentNetwork && this._ecRoutedAgent && typeof agentNetwork.recordOutcome === "function") {
              agentNetwork.recordOutcome(this._ecRoutedAgent, true);
            }
          } catch (_) {}
          // [/EDITCORE-ADD]
          return { kind: decision?.kind || "CHAT", text: textOut, steps, mutations: runMutations, incomplete: false, partial: turnWasPartial || undefined, report: { completed: true }, threadId, usage: totalUsage };
        }

        messages.push({ role: "assistant", content: cleanText || null, tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: c.function })) });

        if (!this.session?.alive || !this.running || this.abort?.signal?.aborted) {
          rememberOut("Detenido."); detachLongRunningStreams(steps);
          return { kind: "STOP", text: "Detenido.", steps, threadId, usage: totalUsage };
        }

        for (const call of toolCalls) {
          const name = call.function?.name;
          let args = {};
          // [EDITCORE-INTEGRAL-B6] tool_call TRUNCADO: si los
          // argumentos no parsean (o el lector de stream los marcó
          // truncados), la herramienta NO se ejecuta con {} en
          // silencio — el paso queda marcado con error explícito y
          // el modelo recibe el motivo para reintentar completo.
          // Una cadena vacía sí es «sin argumentos» (válido).
          const rawArgsText = String(call.function?.arguments ?? "");
          let argsTruncated = call.argumentsTruncated === true || call.function?.argumentsTruncated === true;
          if (!argsTruncated) {
            try { args = JSON.parse(rawArgsText.trim() ? rawArgsText : "{}"); } catch { argsTruncated = true; }
          }
          if (argsTruncated) {
            const truncatedResult = { ok: false, toolCallTruncated: true, error: `tool_call truncado: los argumentos de «${name}» llegaron incompletos y no se ejecutó la herramienta. Vuelve a emitir la llamada completa.` };
            const stepData = { name, input: {}, result: truncatedResult, ok: false, toolCallTruncated: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: {}, result: truncatedResult, ok: false });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(truncatedResult, 2000) });
            continue;
          }
          if (args.path) args.path = toRelativePath(projectRoot, args.path);

          const actionLine = formatToolActionNarration(name, args);
          if (actionLine) onProgress?.({ phase: "narration", text: actionLine });

          const blockedList = maybeBlockRootListFiles(name, args, projectRoot, listOnlyMode || analysisMode);
          if (blockedList) {
            const stepData = { name, input: args, result: blockedList, ok: false, blocked: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: blockedList, ok: false, blocked: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(blockedList, 2000) });
            continue;
          }
          const blockedRoadmap = maybeBlockRoadmapReadFile(name, args, projectRoot);
          if (blockedRoadmap) {
            const stepData = { name, input: args, result: blockedRoadmap, ok: false, blocked: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: blockedRoadmap, ok: false, blocked: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(blockedRoadmap, 2000) });
            continue;
          }

          // [EDITCORE-REPAIR] Compuerta de evidencia: en un turno de
          // reparación no se escribe ni una línea sin haber capturado
          // antes el fallo real en el propio turno (captura del preview
          // o build/dev). [EDITCORE-INTEGRAL-B1] Una captura FALLIDA no
          // cuenta como evidencia; la compuerta solo se libera con
          // evidencia real o tras dos bloqueos (fail-open DECLARADO en
          // la narrativa, justo debajo, para que no pase en silencio).
          const blockedEvidence = repairGuard && this._repairTask === true
            ? repairGuard.maybeBlockWriteBeforeEvidence(name, steps, evidenceBlocks)
            : null;
          if (!blockedEvidence && repairGuard && this._repairTask === true
            && evidenceBlocks >= repairGuard.EVIDENCE_BLOCK_LIMIT
            && !repairGuard.turnHasEvidence(steps)
            && (name === "write_file" || name === "replace_in_file" || name === "scaffold_project")) {
            onProgress?.({ phase: "model", text: "Compuerta de evidencia: fail-open DECLARADO tras agotar los bloqueos — se permite escribir SIN evidencia capturada en este turno." });
          }
          if (blockedEvidence) {
            evidenceBlocks += 1;
            const stepData = { name, input: args, result: blockedEvidence, ok: false, blocked: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: blockedEvidence, ok: false, blocked: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(blockedEvidence, 2000) });
            continue;
          }

          // [EDITCORE-BUILD-BASE] Compuerta de base profesional: en un
          // turno de construcción sobre un proyecto vacío, el primer
          // HTML suelto en la raíz se bloquea una vez para que el
          // agente siente la base (scaffold_project) antes de escribir
          // la página a mano. Fail-open tras un bloqueo.
          const blockedLooseHtml = buildBaseGuard && this._buildBaseTask === true
            ? buildBaseGuard.maybeBlockLooseHtmlWrite({
              name,
              args,
              buildTask: true,
              projectEmpty: true,
              scaffolded: steps.some((s) => s.name === "scaffold_project" && s.ok !== false),
              blocksSoFar: looseHtmlBlocks,
            })
            : null;
          if (blockedLooseHtml) {
            looseHtmlBlocks += 1;
            const stepData = { name, input: args, result: blockedLooseHtml, ok: false, blocked: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: blockedLooseHtml, ok: false, blocked: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(blockedLooseHtml, 2000) });
            continue;
          }

          const readCacheKey = name === "read_file" && args.path
            ? `${String(args.path).replace(/\\/g, "/").toLowerCase()}#${Number(args.startLine) || 1}-${Number(args.endLine) || 0}`
            : "";
          // [EDITCORE-V492-5] DIETA DE LLAMADAS: releer en el MISMO
          // turno un archivo ya leído devolvía OTRA VEZ el contenido
          // completo (la caché solo marcaba cached:true): el modelo
          // pagaba los mismos miles de tokens dos o tres veces por
          // turno. Ahora la relectura devuelve un COMPROBANTE CORTO
          // («ya leído en este turno» + hechos clave: líneas y rango);
          // el contenido íntegro ya está en el contexto del turno. La
          // lectura forzada explícita (force:true) sí relee de disco, y
          // una escritura sobre el archivo invalida su caché (abajo).
          if (readCacheKey && readCache.has(readCacheKey) && args.force !== true) {
            const cached = readCache.get(readCacheKey);
            const stubResult = {
              ok: true,
              path: args.path,
              cached: true,
              alreadyReadThisTurn: true,
              totalLines: cached.totalLines,
              bytes: cached.bytes,
              note: `Ya leíste «${args.path}» en este turno (${cached.totalLines ?? "?"} líneas${cached.startLine || cached.endLine ? `, rango ${cached.startLine || 1}-${cached.endLine || cached.totalLines || "?"}` : ""}): su contenido completo YA está en tu contexto de este turno y no se repite. Trabaja con lo ya leído; si necesitas releerlo de disco porque pudo cambiar, repite read_file con force:true.`,
            };
            const stepData = { name, input: args, result: stubResult, ok: true, cached: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: stubResult, ok: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(stubResult, tools.READ_FILE_PAYLOAD_CAP) });
            continue;
          }

          const callKey = `${name}:${JSON.stringify(args)}`;
          // [EDITCORE-DESBLOQUEOS] El historial guarda el RESULTADO de la
          // llamada idéntica anterior, no solo el conteo: si tuvo ÉXITO, el
          // bloqueo se mantiene (nada de duplicar publicaciones ni commits);
          // si FALLÓ, se permite UN reintento (máximo 2 ejecuciones
          // idénticas por turno). Antes no se distinguía éxito de fracaso y
          // un publish_project que fallaba a mitad no podía reintentarse:
          // el agente terminaba en rodeos manuales con Git. El mensaje de
          // bloqueo dice qué pasó con el intento anterior para que el
          // modelo cambie de estrategia en vez de insistir a ciegas.
          const prevCall = toolHistory.get(callKey);
          if (prevCall && prevCall.count >= 1) {
            const prevFailed = prevCall.lastOk === false;
            if (!prevFailed || prevCall.count >= 2) {
              const detail = prevCall.lastOk === true
                ? "La misma acción con los mismos argumentos YA se ejecutó con ÉXITO en este turno: repetirla duplicaría su efecto. No la llames de nuevo; trabaja con su resultado o cambia los argumentos."
                : prevFailed
                  ? `La misma acción con los mismos argumentos ya FALLÓ ${prevCall.count} veces en este turno${prevCall.lastError ? ` (último error: «${prevCall.lastError}»)` : ""} y el reintento permitido se agotó. No insistas con la llamada idéntica: diagnostica la causa, cambia los argumentos o busca otra vía.`
                  : "La misma acción con los mismos argumentos ya se ejecutó en este turno. No la repitas; trabaja con su resultado o cambia los argumentos.";
              messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload({ ok: false, error: `Límite alcanzado para esta acción repetida. ${detail}`, repeatedActionBlocked: true }) });
              continue;
            }
            // prevFailed && count === 1 → reintento permitido: sigue al registro.
          }
          toolHistory.set(callKey, { count: (prevCall?.count || 0) + 1, lastOk: prevCall?.lastOk, lastError: prevCall?.lastError });

          onProgress?.({ phase: "tool", stage: "running", name, input: args });

          let result;
          // Compuerta ÚNICA de escritura antes de despachar (contrato de
          // turno): cualquier herramienta de escritura (clasificación de
          // classify.js) se corta aquí si el turno no está autorizado, no
          // solo write_file/replace_in_file como antes. El paso queda
          // registrado como bloqueado (ok:false) y el archivo no se toca.
          // El modelo SÍ ve la herramienta: lo que falta no es la mano, es
          // la autorización, y el resultado le dice cómo pedirla.
          if (WRITE_TOOLS.includes(name) && (readOnlyMode || allowWrite === false || !writeAuthorized)) {
            result = (readOnlyMode || allowWrite === false)
              ? { ok: false, error: "Modo solo lectura: no se ejecutan herramientas de escritura. Pide al usuario que cambie el modo de permisos.", blockedReadOnly: true }
              : { ok: false, needsAuthorization: true, error: "Modo paso a paso (Pregunta antes): esta escritura requiere la autorización del usuario. Presenta en el chat el cambio exacto que harías y pide que responda «procede» (o que active Acceso completo). No delegues la escritura ni digas que no tienes la herramienta: la tienes — falta la autorización de este turno." };
          } else if (name === "write_file" || name === "replace_in_file") {
            const impl = await runImplementer({ projectRoot, path: args.path, content: args.content, oldText: args.oldText, newText: args.newText, onProgress, threadId });
            result = impl.result || impl;
          } else {
            const effectiveHelpers = {
              ...(helpers || {}),
              // Identidad de coordinación de ESTA corrida: los locks por
              // archivo de tools distinguen a este agente de otros que
              // corran en paralelo sobre el mismo proyecto.
              threadId: threadId || (helpers && helpers.threadId) || "default",
              agentRole: "supervisor",
              // [EDITCORE-PRESENTACION] La señal de ESTA corrida nunca
              // llegaba a las herramientas: tools.execute la lee de
              // helpers.abortSignal (run_command, delegate_parallel) y el
              // orquestador no la ponía — Detener no cortaba lo que el
              // turno estaba ejecutando.
              abortSignal: this.abort?.signal || null,
              // [EDITCORE-INTEGRAL-B1] Cableado del implementer delegado:
              // invoke_subagent → runSubagent → runBoundedImplement recibe
              // applyWrite/applyReplace apuntando a las MISMAS funciones
              // con lock que usa el supervisor (tools.writeFile /
              // tools.replaceInFile con la identidad de coordinación de
              // esta corrida). Solo se ofrecen si el turno está AUTORIZADO
              // a escribir: sin autorización, el delegado devuelve
              // planned:true y la auditoría de cierre lo declara.
              // [EDITCORE-INTEGRAL-B9] UNA sola identidad de lock por
              // corrida: el delegado escribe con la MISMA identidad
              // que el supervisor («supervisor» = la corrida), no con
              // una segunda («implementer») que se autobloqueaba.
              applyWrite: writeAuthorized ? async (rel, content) => {
                const r = tools.writeFile(projectRoot, rel, content, { threadId: threadId || "default", agentRole: "supervisor" });
                if (!r || r.ok === false) throw new Error(r?.error || "applyWrite rechazado por tools.writeFile");
                return r;
              } : undefined,
              applyReplace: writeAuthorized ? async (rel, oldText, newText) => {
                const r = tools.replaceInFile(projectRoot, rel, oldText, newText, { threadId: threadId || "default", agentRole: "supervisor" });
                if (!r || r.ok === false) throw new Error(r?.error || "applyReplace rechazado por tools.replaceInFile");
                return r;
              } : undefined,
              activePreviewUrl: this._activePreviewUrl || (helpers && helpers.activePreviewUrl) || undefined,
              fullAccess: accessFull || (helpers && helpers.fullAccess === true),
              externalActionApproved: accessFull || (helpers && helpers.externalActionApproved === true),
              permissionMode: accessFull ? "full" : (permissionMode || helpers?.permissionMode || "step"),
            };
            result = await tools.execute(name, args, projectRoot, allowWrite, effectiveHelpers);
          }

          if (result?.needsConfirmation) {
            if (accessFull) {
              // Con Acceso Completo se ejecuta directamente sin pedir confirmación
              const execHelpers = {
                ...(helpers || {}),
                fullAccess: true,
                externalActionApproved: true,
                permissionMode: "full",
                abortSignal: this.abort?.signal || null,
              };
              result = await tools.execute(name, args, projectRoot, true, execHelpers);
            } else {
              this.pendingExternal = { name, args, projectRoot, createdAt: Date.now() };
              const stepData = { name, input: args, result, ok: false, pendingConfirmation: true };
              steps.push(stepData); this.session.addStep(stepData);
              onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: false });
              this.session.kill();
              const ask = formatAgentVisibleText(`## ⚠️ Confirmación requerida\n\n${result.preview || name}\n\nResponde **sí** o **procede** para ejecutarlo. Cualquier otro mensaje lo cancela.`);
              rememberOut(ask); detachLongRunningStreams(steps);
              return { kind: decision?.kind || "EXECUTE", text: ask, steps, pendingConfirmation: true, threadId, usage: totalUsage };
            }
          }

          const softRecover = recoverSoftToolFailure(name, args, result, projectRoot);
          result = softRecover.payload;

          // [EDITCORE-V491-C] Corte por autorización = plan presentado:
          // la llamada propuesta se persiste asociada a la conversación
          // para que el «procede» ejecute ESTO, no una re-derivación.
          if (result?.needsAuthorization === true && presentedCalls.length < PRESENTED_PLAN_MAX_CALLS) {
            presentedCalls.push(presentedCallFrom(name, args));
            savePresentedPlan(projectRoot, threadId, {
              taskText: String(this._currentUserText || message || "").slice(0, 500),
              createdAt: Date.now(),
              calls: presentedCalls.slice(),
            });
          }

          // [EDITCORE-V491-A] VISIÓN REAL: el PNG de la captura se lee
          // de disco y queda listo para adjuntarse como parte de imagen
          // en el siguiente mensaje al modelo. Sin modelo con visión (o
          // sin PNG legible) el resultado lo DECLARA («captura sin
          // visión»): el juicio sale de los diagnósticos de texto y
          // nadie finge haber visto la imagen.
          if (name === "capture_preview_screenshot" && result && result.ok !== false) {
            const abs = result.screenshotAbs
              || (result.screenshotPath ? path.resolve(String(projectRoot || ""), String(result.screenshotPath)) : "");
            if (!modelSupportsVision(model)) {
              result.visionAttached = false;
              result.visionNote = "captura sin visión: el modelo de este turno no acepta imágenes, así que la captura NO se le adjuntó. Juzga solo con los diagnósticos de texto (renderOk, errores de consola, overflow, encabezados) y no afirmes cómo se ve la imagen.";
            } else if (!abs || !fs.existsSync(abs)) {
              result.visionAttached = false;
              result.visionNote = "captura sin visión: no se pudo leer el PNG capturado para adjuntarlo al modelo. Juzga solo con los diagnósticos de texto y no afirmes cómo se ve la imagen.";
            } else {
              try {
                const dataUrl = `data:image/png;base64,${fs.readFileSync(abs).toString("base64")}`;
                pendingVisionImages.push({ name: `captura-${result.viewport || "desktop"}`, dataUrl });
                result.visionAttached = true;
                result.visionNote = "La imagen REAL de esta captura va adjunta como imagen en el siguiente mensaje: júzgala directamente (qué se ve en el hero, las tarjetas y las secciones), no por el nombre del archivo ni el texto alt.";
              } catch {
                result.visionAttached = false;
                result.visionNote = "captura sin visión: no se pudo leer el PNG capturado para adjuntarlo al modelo. Juzga solo con los diagnósticos de texto y no afirmes cómo se ve la imagen.";
              }
            }
          }

          if (readCacheKey && result?.ok !== false && typeof result?.content === "string") {
            readCache.set(readCacheKey, result);
          }
          // [EDITCORE-V492-5] Una escritura EXITOSA sobre un archivo
          // invalida su entrada en la caché de lecturas del turno: el
          // comprobante «ya leído» jamás debe tapar un contenido que el
          // propio turno acaba de cambiar. También se retira la entrada
          // de ese read_file en el historial de acciones repetidas:
          // releer tras escribir no «duplica el efecto» de nada (leer
          // no muta) y la compuerta no debe vetar la confirmación.
          if ((name === "write_file" || name === "replace_in_file") && result?.ok !== false && args?.path) {
            const writtenKey = `${String(args.path).replace(/\\/g, "/").toLowerCase()}#`;
            for (const key of [...readCache.keys()]) {
              if (key.startsWith(writtenKey)) readCache.delete(key);
            }
            const writtenPath = String(args.path).replace(/\\/g, "/").toLowerCase();
            for (const key of [...toolHistory.keys()]) {
              if (!key.startsWith("read_file:")) continue;
              try {
                const prevArgs = JSON.parse(key.slice("read_file:".length));
                if (String(prevArgs?.path || "").replace(/\\/g, "/").toLowerCase() === writtenPath) toolHistory.delete(key);
              } catch { /* clave no parseable: se deja como está */ }
            }
          }

          const stepData = { name, input: args, result, ok: result?.ok !== false };
          // [EDITCORE-DESBLOQUEOS] Registrar el RESULTADO de esta ejecución
          // en el historial de repeticiones: la compuerta de arriba lo lee
          // si el modelo repite la llamada idéntica. Las rutas que salen con
          // `continue` ANTES de la compuerta (evidencia, base profesional,
          // caché de lectura) nunca llegan aquí: no cuentan como ejecución.
          const histEntry = toolHistory.get(callKey);
          if (histEntry) {
            histEntry.lastOk = stepData.ok;
            histEntry.lastError = stepData.ok ? "" : String(result?.error || result?.message || result?.stderr || "").slice(0, 160);
          }
          steps.push(stepData); this.session.addStep(stepData);
          onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: stepData.ok });
          // [EDITCORE-INTEGRAL-B4] El payload que recibe el modelo sale
          // de la POLÍTICA POR HERRAMIENTA de tools.truncatePayload
          // (topes propios, campos críticos primero, cabeza+cola con
          // elipsis declarada), no del corte único de 2.000 por la
          // cabeza que eliminaba stderr, las colas con el error final,
          // la cola de read_skill y los diagnostics de la captura.
          messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(result || {}, name === "read_file" ? tools.READ_FILE_PAYLOAD_CAP : undefined, name) });
        }

        // [EDITCORE-V491-A] Cerrado el lote de herramientas (los
        // mensajes tool ya quedaron en su sitio, pegados a su
        // assistant), las capturas del lote se adjuntan como UN mensaje
        // de usuario multimodal: es el siguiente mensaje que el modelo
        // recibe en este mismo turno, con la imagen real.
        if (pendingVisionImages.length) {
          const shots = pendingVisionImages.splice(0, pendingVisionImages.length);
          messages.push({
            role: "user",
            content: buildOpenAiImageContent(`📷 Captura(s) real(es) del preview de este turno (${shots.length}): mírala(s) directamente y juzga lo que se ve — hero, tarjetas y secciones — antes de cerrar tu veredicto.`, shots.map((s) => ({ name: s.name, dataUrl: s.dataUrl }))),
          });
        }
      }

      this.session.kill();
      const written = successfulWritePaths(steps);
      let textOut;
      const pausedByLimit = !listOnlyMode && !(chatOnly || decision?.kind === "CHAT");
      if (listOnlyMode) textOut = formatListOnlyAnswer("", steps, message);
      else if (pausedByLimit) {
        const lista = written.length ? `Archivos modificados en este turno:\n\n${[...new Set(written)].map((p) => `- \`${p}\``).join("\n")}` : "En este turno todavía no se modificó ningún archivo.";
        textOut = `## ⏸️ Pausa: llegué al límite de pasos de este turno\n\nLa tarea **no está terminada**. ${lista}\n\nEscribe **continúa** y sigo exactamente donde quedé, con los errores que falten.`;
      }
      else if (written.length > 0) textOut = `## ✅ Archivos actualizados\n\n${written.map(p => `- \`${p}\``).join("\n")}\n\n${nextStepsClosingText(projectRoot, written, steps)}`;
      else textOut = `## ℹ️ Sin acciones registradas\n\n${nextStepsClosingText(projectRoot, [], steps)}`;

      if (written.length > 0) {
        textOut = await this.appendBeforeAfter(projectRoot, written, textOut, onProgress);
        try {
          const verifyReports = await runPostWriteVerify(projectRoot, written, onProgress, { signal: this.abort?.signal || null }); // [EDITCORE-INTEGRAL-B6]
          textOut = String(textOut || "") + formatVerifyBlock(verifyReports);
          textOut = await appendRealVerification(projectRoot, written, steps, textOut, onProgress, { repairTask: this._repairTask === true, previewUrl: this._activePreviewUrl || "", signal: this.abort?.signal || null }); // [EDITCORE-INTEGRAL-B6]
        } catch (_) { /* verify no debe tumbar el turno */ }
      }
      textOut = formatAgentVisibleText(textOut);
      persistKernelRoadmap(projectRoot, { task: this._currentUserText || message, steps, kind: decision?.kind, text: textOut, completed: !pausedByLimit });
      rememberOut(textOut); detachLongRunningStreams(steps);
      // [EDITCORE-ADD] Feedback a la red: un turno pausado por límite de
      // pasos es un turno INCOMPLETO, no un éxito. Antes se registraba true
      // y la confianza del rol subía con trabajo no terminado.
      try {
        if (agentNetwork && this._ecRoutedAgent && typeof agentNetwork.recordOutcome === "function") {
          agentNetwork.recordOutcome(this._ecRoutedAgent, !pausedByLimit);
        }
      } catch (_) {}
      // [/EDITCORE-ADD]
      // [EDITCORE-STACK] persistir memoria al cerrar turno
      try {
        if (this._editcoreStack) {
          this._editcoreStack.complete(pausedByLimit ? "turno pausado por límite de pasos" : "turno completado");
          await this._editcoreStack.save();
        }
      } catch (_) {}
      // [/EDITCORE-STACK]
      try {
        if (agentCoordination && projectRoot) {
          agentCoordination.getCoordination(projectRoot).releaseAllForThread(threadId || "default");
        }
      } catch (_) {}
      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, mutations: runMutations, incomplete: pausedByLimit, threadId, usage: totalUsage };
    } catch (err) {
      this.session.kill();
      let safeMsg = String(err?.message || err || "Error desconocido");
      const errText = formatAgentVisibleText("## ❌ Error\n\nAlgo falló durante la ejecución: " + safeMsg);
      persistKernelRoadmap(projectRoot, { task: this._currentUserText || message, steps, kind: decision?.kind, text: errText, completed: false });
      rememberOut(errText); detachLongRunningStreams(steps);
      // [EDITCORE-ADD] Feedback de fallo a la red neuronal (baja confianza del agente).
      try {
        if (agentNetwork && this._ecRoutedAgent && typeof agentNetwork.recordOutcome === "function") {
          agentNetwork.recordOutcome(this._ecRoutedAgent, false);
        }
      } catch (_) {}
      // [/EDITCORE-ADD]
      // [EDITCORE-STACK] guardar estado aunque falle el turno
      try {
        if (this._editcoreStack) {
          this._editcoreStack.complete("turno con error");
          await this._editcoreStack.save();
        }
      } catch (_) {}
      // [/EDITCORE-STACK]
      try {
        if (agentCoordination && projectRoot) {
          agentCoordination.getCoordination(projectRoot).releaseAllForThread(threadId || "default");
        }
      } catch (_) {}
      return { kind: "ERROR", error: safeMsg, text: errText, steps, threadId, usage: totalUsage };
    } finally {
      this.running = false; this.turnAbort = null;
      try { onProgress?.({ phase: "done", text: "" }); } catch {}
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue, groundUngroundedClaims, successfulDiskReads, hasMutationIntent, buildKernelFactSummary, auditSubagentSteps, runPostWriteVerify, formatVerifyBlock, applyTurnContextBudget, TURN_CONTEXT_MAX_CHARS, TURN_CONTEXT_TRUNCATION_MARKER, CTX_TIER_ESSENTIAL, CTX_TIER_NORMAL, CTX_TIER_ACCESSORY, /* [EDITCORE-INTEGRAL-B3] */ appendRealVerification, /* [EDITCORE-INTEGRAL-B5] */ normalizePermissionMode, buildModeAnnouncement, /* [EDITCORE-INTEGRAL-B6] */ raceSemanticBlock, SEMANTIC_MEMORY_TIMEOUT_MS, runRealVerification, /* [EDITCORE-INTEGRAL-B8] */ formatExternalActionResult, /* [EDITCORE-INTEGRAL-B9] */ buildCerebroServiceBlock, buildBrainContextBlock, /* [EDITCORE-V492-3] */ detectMemoryEventQuestion, memoryEventInDossier, memoryAnswerAffirmsEvent, memoryEventGuardBanner, MEMORY_EVENT_PROTOCOL };