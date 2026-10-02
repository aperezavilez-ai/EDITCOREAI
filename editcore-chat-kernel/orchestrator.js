"use strict";

const path = require("path");
const {
  classify,
  extractListTarget,
  isFullAccess,
  resolveExecutionMode,
  MODES,
  TOOL_ALLOWLIST,
  SUB_AGENTS,
  APPROVAL_RE,
} = require("./classify");
const { searchBrainDocs } = require("./brain-ingest");
const { ChatSession } = require("./session");
const { PersistentMemory } = require("./memory");
const { skillsPrompt, SKILL_IDS } = require("./skills-catalog");
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

let projectRoadmapApi = null;
try {
  projectRoadmapApi = require("../runtime/project-roadmap");
} catch (_) {
  projectRoadmapApi = null;
}

const DEFAULT_MAX_STEPS = 28;
const AUTHORIZED_MAX_STEPS = 32;
const DEFAULT_TOTAL_TIMEOUT_MS = 900_000; // 15 min (antes 10 min) — análisis profundo cabe holgado
const HEARTBEAT_INTERVAL_MS = 5_000;
const ROADMAP_MIN_LENGTH = 500;
const MAX_PROMISE_RETRIES = 3;
const ANALYSIS_MAX_STEPS = 8;      // antes 2 — ahora el LLM tiene margen real
const ANALYSIS_TIMEOUT_MS = 180_000; // 3 min por turno en análisis

const LEADERSHIP_PROMPT = [
  "Protocolo obligatorio de cada orden: 1) Analiza la solicitud en 1-3 lineas. 2) Di que vas a hacer. 3) Ejecuta las tools EN ESTE TURNO. 4) Cierra con REPORTE: que hiciste, archivos/comandos reales, resultado, siguiente paso.",
  "Con Acceso completo esta PROHIBIDO pedir Procede, Adelante, confirmacion o permiso extra.",
  "Credenciales de GitHub, Vercel, Supabase, GafCore y servidor propio estan en la boveda: usa las tools de conexion, no pidas tokens al usuario.",
  "REGLA DURA: no digas que vas a hacer algo — hacelo en el mismo turno con la tool. Nunca cierres con 'Ahora leo X' sin haber llamado read_file(X).",
  "Si falla algo leve (oldText, git auxiliar, ruta ausente), releé contexto y reintentá. No detengas la sesión por eso.",
].join("\n");

const LIVE_NARRATION_PROMPT = [
  "Voz EditCoreAI. Primera frase = hallazgo o decisión.",
  "Si el hilo basta, no llames tools. Si llamás una, contá el porqué en el mismo mensaje.",
].join("\n");

const MARKDOWN_FORMAT_PROMPT = [
  "=== FORMATO DE RESPUESTA OBLIGATORIO (MARKDOWN RICO) ===",
  "TODAS tus respuestas al usuario DEBEN estar en Markdown enriquecido, igual que ChatGPT, Claude o Cursor.",
  "",
  "ESTRUCTURA OBLIGATORIA:",
  "1. Titulo de seccion con `##` (nunca uses `#` salvo para el titulo global de la respuesta).",
  "2. Subsecciones con `###`.",
  "3. Negritas con `**texto**` para conceptos clave, nombres de archivos, comandos y herramientas.",
  "4. Codigo inline con backticks simples: `archivo.js`, `npm install`, `run_command`.",
  "5. Bloques de codigo con triple backtick y lenguaje (```javascript, ```bash, ```json) para codigo o resultados tecnicos.",
  "6. Listas con `-` para enumeraciones, `1.` para secuencias de pasos.",
  "7. Tablas con `| Col | Col |` para comparaciones o datos estructurados.",
  "8. Citas con `>` para advertencias, notas o resumenes destacados.",
  "9. Separadores `---` entre secciones largas.",
  "10. Emojis moderados (✅ ❌ ⚠️ 🎯 📁 🔍 🚀 💡) solo para marcar estado o categoria.",
  "",
  "REGLAS DURAS:",
  "- NUNCA respondas con un parrafo monolitico. Divide en secciones.",
  "- SIEMPRE deja una linea en blanco entre secciones.",
  "- Los paths van en backticks: `editcore-chat-kernel/orchestrator.js`.",
  "- Los resultados de herramientas van en bloques de codigo o tablas.",
  "=== FIN DE FORMATO ===",
].join("\n");

const CAPABILITIES_PROMPT = [
  "=== CAPACIDADES ESPECIALES ===",
  "- **web_search(query)**: busca en internet (DuckDuckGo + Wikipedia).",
  "- **web_scrape(url)**: lee el contenido completo de una URL.",
  "- **git_status / git_log / git_diff**: inspecciona el repositorio git.",
  "- **install_skill(repoUrl, skillName)** y **list_skills**: gestiona skills.",
  "- **clone_repo(url)**: clona un repositorio Git dentro del proyecto.",
  "- **ingest_to_brain(path|title+content) / list_brain / search_brain(query)**: gestiona y consulta el Cerebro RAG (con path ingesta una carpeta de documentacion).",
  "- **read_pdf(path)**: texto de PDF, Word o Excel. **screenshot_page(url)**: captura y texto de una web. **docker_ps**: contenedores Docker.",
  "- **publish_project / deploy_one_click**: publicar y desplegar. EditCore pide confirmacion al usuario antes de ejecutarlos; llamalos una sola vez y espera.",
  "Cuando necesites informacion externa (version de una libreria, API actual, error desconocido), usa `web_search` ANTES de responder con conocimiento desactualizado.",
  "=== FIN CAPACIDADES ===",
].join("\n");

const CHAT_READ_TOOLS = new Set([
  "web_search", "web_scrape", "list_files", "read_file", "search_files",
  "list_skills", "list_brain", "git_status", "git_log", "git_diff",
  "search_brain", "read_pdf", "screenshot_page", "docker_ps",
]);
const CHAT_MAX_STEPS = 6;
const PENDING_EXTERNAL_TTL_MS = 10 * 60_000;
const BRAIN_CONTEXT_MIN_SCORE = 2;

const CHAT_TOOLS_PROMPT = [
  "=== HERRAMIENTAS EN MODO CHARLA (SOLO LECTURA) ===",
  "- **web_search(query)** / **web_scrape(url)**: informacion actual de internet (versiones, noticias, fechas de lanzamiento, documentacion).",
  "- **list_files(path)** / **read_file(path)** / **search_files(query)**: leer el disco. Aceptan rutas absolutas como `D:\\PROGRAMAS IA`.",
  "- **list_skills(query?)**: skills de EditCoreAI (integradas, globales, del proyecto y de los repos del Cerebro). Sin query da un resumen por origen; con query busca una concreta.",
  "- **git_status / git_log / git_diff**: estado del repositorio.",
  "- **search_brain(query)**: documentacion y memoria del proyecto guardadas en el Cerebro.",
  "- **read_pdf(path)**: texto de un PDF, Word o Excel del disco.",
  "- **screenshot_page(url)**: abre una web, guarda una captura y devuelve su titulo y texto visible.",
  "- **docker_ps**: contenedores Docker y su estado.",
  "REGLAS:",
  "- Si la pregunta depende de datos que cambian (ultima version de algo, precios, noticias), llama `web_search` ANTES de responder. No respondas de memoria.",
  "- Si piden ver una carpeta o archivo del disco, usa `list_files` / `read_file` con la ruta indicada. NUNCA digas que no tenes acceso al disco.",
  "- Si preguntan que skills tenes, llama `list_skills` y responde con esa lista.",
  "- En este modo no escribis archivos ni ejecutas comandos; para cambios, el usuario debe pedir la tarea concreta.",
  "- Si el usuario dice que algo no esta bien, NO repitas tu respuesta anterior: pregunta que parte falla o revisa los datos con las herramientas.",
  "=== FIN HERRAMIENTAS ===",
].join("\n");

const LIST_ONLY_PROMPT = [
  "=== MODO LISTADO (SOLO LISTAR) ===",
  "El usuario pidio SOLO listar el contenido de una carpeta/archivo.",
  "",
  "REGLAS DURAS:",
  "1. Usa `list_files` con el path indicado. UNICA herramienta permitida.",
  "2. Responde en espanol con una lista breve: carpetas y archivos del primer nivel.",
  "3. PROHIBIDO analizar, diagnosticar, dar hallazgos, sugerir soluciones o escribir reportes extensos.",
  "4. PROHIBIDO pedir confirmacion o pedir que el usuario pegue archivos.",
  "5. Formato: `## 📁 <path>` + `**Carpetas (N):**` (lista) + `**Archivos (N):**` (lista).",
  "6. Si el path no existe, dilo en 1 linea y nada mas.",
  "=== FIN MODO LISTADO ===",
].join("\n");

const ANALYSIS_MODE_PROMPT = [
  "=== MODO ANALISIS (REPORTE COMPLETO) ===",
  "El usuario pidio un analisis del proyecto. Debes generar un REPORTE COMPLETO en markdown.",
  "",
  "PASOS OBLIGATORIOS:",
  "1. Revisa la EVIDENCIA BASE que EditCore ya reunio (ROADMAP, package.json, entrypoints, modulos).",
  "2. Si falta contexto para un analisis honesto, USA read_file para leer MAS archivos (entrypoints, configs, modulos clave). Maximo 6 lecturas adicionales.",
  "3. NO cierres el reporte con menos de 500 palabras. Un analisis corto es un analisis fallido.",
  "4. SOLO reporta hallazgos que puedas anclar a archivos reales que leiste.",
  "",
  "ESTRUCTURA OBLIGATORIA DEL REPORTE FINAL:",
  "## 📊 Resumen ejecutivo",
  "   - 3-5 bullets con lo mas importante del proyecto.",
  "## 🏗️ Arquitectura y stack",
  "   - Que tecnologias usa, como esta organizado, entrypoints reales.",
  "## ⚙️ Funcionalidad principal",
  "   - Que hace el proyecto hoy, con evidencia de archivos leidos.",
  "## ⚠️ Errores verificados: prioridad y causa",
  "   - Los errores de HECHOS VERIFICADOS ordenados por impacto, con causa probable y arreglo (archivo:linea). Si no hay errores verificados, dilo.",
  "## 🔎 Hipótesis (no verificadas)",
  "   - Riesgos que ves al leer codigo pero que ningun chequeo confirmo. Marcalos como hipotesis, nunca como hechos.",
  "## 🎯 Recomendaciones",
  "   - 3-5 acciones concretas priorizadas.",
  "## 📁 Evidencia real",
  "   - Lista de archivos que leiste con `read_file`.",
  "",
  "REGLAS DURAS:",
  "- NO uses write_file / replace_in_file (modo solo lectura).",
  "- NO inventes. Si un archivo no lo leiste, no afirmes nada sobre el.",
  "- Los extractos y lecturas son PARCIALES por presupuesto. Que un extracto termine a mitad de una funcion NO es un hallazgo: PROHIBIDO reportar un archivo como 'truncado' o 'incompleto' por eso. La integridad esta en el encabezado del extracto (lineas totales, bytes, sintaxis): solo hay archivo roto si la sintaxis dice ERROR.",
  "- Para ver mas de un archivo usa read_file con startLine/endLine (el resultado trae totalLines y endLine).",
  "- Cada hallazgo cita archivo y linea que leiste. Lo que no pudiste comprobar va como 'no verificado', nunca como 'no existe' ni 'no hay evidencia'. Antes de afirmar que algo falta, buscalo con search_files.",
  "- En este modo no se ejecutan tests ni builds: no afirmes que pasan ni que no se ejecutaron; di 'no verificado en este analisis'.",
  "- Los datos que salen de documentos del proyecto (ROADMAP, ANALISIS_*.md, informes, changelogs) se atribuyen: \"segun `archivo.md`\". NO los presentes como verificados por vos: en este modo no ejecutas tests ni builds.",
  "- Si un documento tiene cifras distintas en varias secciones (ej. 19/19, 30/30, 46/46 tests), usa la mas reciente y menciona la discrepancia.",
  "- Usa tablas cuando listes varios hallazgos o archivos.",
  "- Si no hay evidencia suficiente, dilo explicitamente.",
  "- CIERRE: Después de 📁 Evidencia real, agregá 1-2 líneas preguntando al usuario si quiere profundizar en algún módulo o pasar a implementar una mejora concreta.",
  "=== FIN MODO ANALISIS ===",
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

function looksLikePromiseWithoutAction(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const promisesFuture = /(?:ahora|voy\s+a|luego|siguiente|empiezo|sigo|continu[oa]|procedo\s+a|voy\s+con|paso\s+a|en\s+el\s+pr[oó]ximo|cuando\s+termine)\s+(?:a\s+)?(?:leer|revisar|ver|abrir|analizar|buscar|escanear|recorrer|inspeccionar|verificar|ejecutar|correr|escribir|crear|editar|implementar)/i.test(raw);
  if (promisesFuture) return true;
  const claimsDoneWork = /\b(?:he\s+(?:le[ií]do|creado|escrito|generado|implementado|verificado|ejecutado|analizado)|le[ií]\s+el\s+archivo|ya\s+(?:est[aá]|qu[eé]d[oó])\s+(?:listo|creado|hecho))\b/i.test(raw);
  if (claimsDoneWork) return true;
  return /(?:d[eé]jame|espera|un\s+momento|voy)\s+(?:revisar|leer|buscar|chequear)/i.test(raw);
}

function repairDanglingOutput(text, steps = [], userMessage = "", decision = {}) {
  const value = String(text || "").trim();
  const isTrulyBroken = !value || /[a-záéíóúñ]{1,3}$/i.test(value);
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

function groundUngroundedClaims(text, steps = [], userMessage = "", decision = {}) {
  if (decision?.kind === "LIST") return formatAgentVisibleText(String(text || "").trim());
  if (decision?.kind === "ANALYZE" && successfulDiskReads(steps) === 0 && String(text || "").trim().length > 280) {
    return formatAgentVisibleText(
      "> ⚠️ **Este análisis no se basa en lecturas del disco:** en este turno no se ejecutó ninguna herramienta de lectura con éxito.\n\n" +
      String(repairDanglingOutput(text, steps, userMessage, decision) || "")
    );
  }
  if (decision?.kind === "ANALYZE" || decision?.kind === "ASK" || decision?.kind === "CHAT" || decision?.allowWrite === false
    || /\b(?:sin\s+modificar|solo\s+(?:analiza|reporte|diagn[oó]stico)|reporte|an[aá]lisis|auditor[ií]a|explica|resumen)\b/i.test(userMessage)) {
    return repairDanglingOutput(text, steps, userMessage, decision);
  }
  const written = successfulWritePaths(steps);
  if (written.length > 0) return repairDanglingOutput(text, steps, userMessage, decision);
  if (textClaimsDiskMutation(text) && userWantsDiskMutation(userMessage)) {
    return formatAgentVisibleText("## ⚠️ Sin cambios reales\n\nNo pude comprobar creación ni escritura real en disco en este turno.\n\nIndica la carpeta de destino y pedime de nuevo que lo cree con tools.");
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
  if (writtenFiles.length > 0) return "Cambios aplicados. Decime la próxima tarea concreta.";
  if (steps.length > 0) {
    const toolNames = [...new Set(steps.map((s) => s.name).filter(Boolean))].slice(0, 5).join(", ");
    return `Ejecuté: ${toolNames}. Decime el siguiente paso concreto.`;
  }
  return "Sin acciones ejecutadas en este turno. Reformulá la instrucción o indicá el archivo puntual.";
}

function ensureCognitiveMap(projectRoot) {
  if (!projectRoot || !projectMapApi?.ensureProjectMap) return null;
  try { return projectMapApi.ensureProjectMap(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null; }
  catch { return projectMapApi.loadProjectMap?.(projectRoot) || null; }
}

function formatCognitiveBlock(projectRoot) {
  const map = ensureCognitiveMap(projectRoot);
  if (projectMapApi?.formatMapForPrompt) return projectMapApi.formatMapForPrompt(map);
  return "";
}

function buildRoadmapFirstBlock(projectRoot) {
  if (!projectRoot) return "";
  const parts = [];
  try {
    const { ensureProjectRoadmap, formatRoadmapForPrompt, readRoadmap, isStubRoadmap } = require("../runtime/project-roadmap");
    const loaded = readRoadmap(projectRoot);
    if (!loaded.exists || isStubRoadmap(loaded.content || "")) {
      try { ensureProjectRoadmap(projectRoot, { reason: "kernel-bootstrap" }); } catch { /* ignore */ }
    }
    parts.push(formatRoadmapForPrompt(projectRoot));
  } catch { parts.push(""); }
  try {
    const { formatSessionStateForPrompt, ensureSessionState } = require("../runtime/session-state");
    ensureSessionState(projectRoot);
    parts.push(formatSessionStateForPrompt(projectRoot, 2_000));
  } catch { /* ignore */ }
  parts.push([
    "## REGLAS DE LECTURA (obligatorias)",
    "1) El ROADMAP y el session-state YA están arriba. NO ejecutes `list_files('.')` del repo entero si el mapa cubre la tarea.",
    "2) NO re-leas `ROADMAP.md` con `read_file`.",
    "3) Para modificar: `read_file` SOLO de archivos concretos, con `startLine`/`endLine` si son grandes.",
    "4) NO repitas `read_file` del mismo archivo en el mismo turno.",
    "5) Si el ROADMAP no cubre algo puntual, `list_files('subcarpeta')` SÍ está permitido.",
    "6) Tras `write_file`/`replace_in_file`, EditCore actualiza el ROADMAP automáticamente.",
    "7) Nunca cierres un turno diciendo 'ahora leo X' sin llamar la tool en el mismo turno.",
  ].join("\n"));
  return parts.filter(Boolean).join("\n\n").slice(0, 9_000);
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
  if (name === "git_status" || name === "git_log" || name === "git_diff") return "Inspecciono git.";
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

function maybeBlockRootListFiles(name, args, projectRoot, listOnly) {
  if (name !== "list_files") return null;
  if (listOnly === true) return null;
  const p = String(args?.path || "").trim();
  if (p && p !== "." && p !== "./") return null;
  if (!isRoadmapUsable(projectRoot)) return null;
  return { ok: false, blocked: true, error: "Exploración de raíz bloqueada: el ROADMAP ya describe la estructura.", guidance: "Usa `## Mapa` del ROADMAP o `list_files('<subcarpeta>')`." };
}

function buildBrainContextBlock(projectRoot, query) {
  if (!projectRoot || projectRoot === ".") return "";
  let hits = [];
  try { hits = searchBrainDocs(projectRoot, query, 3).filter((h) => h.score >= BRAIN_CONTEXT_MIN_SCORE); } catch { return ""; }
  if (!hits.length) return "";
  return [
    "=== CEREBRO DEL PROYECTO (documentos que el usuario ingirio; pueden estar desactualizados) ===",
    "Si los usas, citalos: \"segun <titulo>\". No los presentes como verificados.",
    ...hits.map((h) => `--- ${h.title} (${h.path}) ---\n${h.text.slice(0, 900)}`),
    "=== FIN CEREBRO ===",
  ].join("\n");
}

function formatExternalActionResult(name, result) {
  const label = name === "deploy_one_click" ? "Deploy" : "Publicación";
  const url = result?.url || result?.deployUrl || result?.deploy?.url || "";
  const detail = String(result?.message || result?.error || "").slice(0, 600);
  if (result?.ok) {
    return [`## ✅ ${label} completado`, url ? `URL: ${url}` : "", detail].filter(Boolean).join("\n\n");
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
    const step = { name, input: args, result: null, ok: false };
    try {
      onProgress?.({ phase: "start", text: name === "deploy_one_click" ? "Desplegando…" : "Publicando…" });
      onProgress?.({ phase: "tool", stage: "running", name, input: args });
      const result = await tools.execute(name, args, projectRoot, true, { ...(helpers || {}), externalActionApproved: true });
      step.result = result;
      step.ok = result?.ok !== false;
      onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: step.ok });
      if (step.ok) {
        try {
          const sync = require("../runtime/roadmap-sync").createRoadmapSync();
          const url = result?.url || result?.deployUrl || "";
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

  async handle(input = {}) {
    const { message, projectRoot, apiBaseUrl, apiKey, model, images, onProgress, helpers,
      autoHeal, background, runModelTaskFn, allowWrite: inputAllowWrite, permissionMode,
      permissionFull, fullAccess: inputFullAccess, planAuthorizedExecution: inputPlanAuth,
      history, messages: inputMessages, threadId: inputThreadId, chatId } = input;

    const rawText = typeof message === "object" && message?.text ? message.text : String(message || "");
    const taskImages = Array.isArray(images) ? images.filter(Boolean) : [];
    const hasImages = taskImages.length > 0;
    const text = rawText.trim() || (hasImages ? "Analiza la imagen adjunta." : "");
    const textLower = text.toLowerCase();
    const isApprovalText = APPROVAL_WORDS.has(textLower);

    if (this.pendingExternal) {
      const pending = this.pendingExternal;
      this.pendingExternal = null;
      const fresh = Date.now() - pending.createdAt < PENDING_EXTERNAL_TTL_MS
        && path.resolve(String(pending.projectRoot || "")) === path.resolve(String(projectRoot || ""));
      if (fresh && APPROVAL_RE.test(text)) return this.runPendingExternal(pending, { helpers, onProgress });
    }

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
          effectiveText = `INSTRUCCIÓN AUTORIZADA DEL USUARIO: "${cleanPrev}". Procede con las modificaciones de código y verifica.`;
          break;
        }
      }
    }

    const fullAccess = isFullAccess({ allowWrite: inputAllowWrite, permissionMode, permissionFull, fullAccess: inputFullAccess, planAuthorizedExecution: inputPlanAuth, mode: permissionMode })
      || String(permissionMode || "").toLowerCase() === "full";

    if (fullAccess) this.pendingTask = null;

    let decision = classify(effectiveText, { allowWrite: fullAccess || inputAllowWrite === true, permissionMode: fullAccess ? "full" : permissionMode, fullAccess });

    if (fullAccess) {
      decision.allowWrite = true;
      if (decision.kind === "CONFIRM" || isApprovalText) decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
      if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) decision = { kind: "EXECUTE", label: "Ejecución (Acceso completo)", allowTools: true, allowWrite: true, background: false };
    }

    if (decision.kind === "CHAT" && userWantsDiskMutation(effectiveText)) {
      decision = { kind: "EXECUTE", label: fullAccess ? "Ejecución (Acceso completo)" : "Construcción / Ejecución", allowTools: true, allowWrite: true, background: false };
    }
    if (decision.kind === "CHAT" && /(?:^|[^\w])(?:analiz[aá]|analizar|an[aá]lisis|auditor[ií]a|diagn[oó]stico|diagnostica|revis[aá]|inspecciona|explora(?:r)?\s+el\s+proyecto)(?=\s|$|[.!,?¿¡:])/i.test(effectiveText)) {
      decision = { kind: "ANALYZE", label: "Análisis", allowTools: true, allowWrite: false, background: false };
    }
    if (hasImages && (decision.kind === "ANALYZE" || decision.kind === "ASK" || visionAsk)) {
      decision = fullAccess ? { kind: "EXECUTE", label: "Análisis visual + acción", allowTools: true, allowWrite: true, background: false } : { kind: "ASK", label: "Análisis visual", allowTools: true, allowWrite: false, background: false };
    }
    if (background === true) decision.background = true;

    if (decision.kind === "STOP") return this.stop();

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
    this._currentUserText = text;

    // [EDITCORE-ADD] Ruteo por red neuronal (opcional). Guarda el agente elegido para feedback.
    try {
      if (agentNetwork && typeof agentNetwork.route === "function") {
        const _r = await agentNetwork.route(String(text || "").slice(0, 500));
        this._ecRoutedAgent = _r && _r.agent || null;
        this._ecRoutedScore = _r && _r.score || 0;
        try {
          agentBus.record(projectRoot || ".", threadId, {
            agent: this._ecRoutedAgent,
            summary: `routed (score ${Number(this._ecRoutedScore || 0).toFixed(2)})`,
            phase: "routing",
          });
        } catch (_) {}
      }
    } catch (_) { /* no-op */ }
    // [/EDITCORE-ADD]

    if (decision.kind === "CHAT") {
      this.pendingTask = null;
      if (!apiKey) return { kind: "CHAT", text: "EditCoreAI es un IDE con agente autónomo. Abrí un proyecto y pedime un cambio concreto." };
      return this.runModelTask({ decision, message: text, projectRoot: projectRoot || ".", apiBaseUrl, apiKey, model, memory, onProgress, allowWrite: false, maxSteps: CHAT_MAX_STEPS, helpers, chatOnly: true, images: taskImages });
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
      const out = agentBus.wrapSubagentResult(projectRoot, this._threadId, "explorer",
        await runExplorer({ projectRoot, target, onProgress, threadId: this._threadId }));
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
      let verified = null;
      try {
        verified = await forensic.runForensicChecks(projectRoot, {
          runTests: deep,
          runTypecheck: deep,
          runBuild: deep && BUILD_REQUEST.test(text),
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
      const out = agentBus.wrapSubagentResult(projectRoot, this._threadId, "analyst",
        await runAnalyst({ projectRoot, onProgress, maxReads, userMessage: text, threadId: this._threadId }));
      const testsRun = (verified?.checks || []).find((c) => c.id === "tests" && (c.status === "pass" || c.status === "fail"));
      if (testsRun && typeof out?.report === "string") {
        out.report = out.report.replace(
          /- \*\*Tests\*\*: script `npm test` = [^\n]*No ejecutado en este análisis \(resultado no verificado\)\./,
          `- **Tests**: ejecutados en este análisis (\`${testsRun.command || "npm test"}\`): ${testsRun.summary}.`,
        );
      }
      if (memory) { memory.setReport(out.report); memory.note("análisis completado"); }
      this.session.kill();
      const evidence = verified ? `${forensic.formatForensicPromptBlock(verified)}\n\n${out.report}` : out.report;

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
        });
        if (verifiedMd && res && typeof res.text === "string") res.text = `${verifiedMd}\n\n---\n\n${res.text}`;
        return res;
      }
      return { kind: "ANALYZE", text: verifiedMd ? `${verifiedMd}\n\n---\n\n${out.report}` : out.report, steps: out.steps };
    }

    if (decision.kind === "VERIFY") {
      this.session.start("VERIFY", projectRoot);
      const out = agentBus.wrapSubagentResult(projectRoot, this._threadId, "verifier",
        await runVerifier({ projectRoot, onProgress, timeoutMs: 60_000, threadId: this._threadId }));
      this.session.kill();
      if (out?.forensic) {
        const previous = forensic.loadForensic(projectRoot);
        const comparison = previous ? forensic.formatComparisonMarkdown(forensic.compareForensic(previous, out.forensic)) : "";
        if (!out.forensic.onlyFiles) forensic.saveForensic(projectRoot, out.forensic);
        return { kind: "VERIFY", text: [out.report, comparison].filter(Boolean).join("\n\n"), steps: out?.steps || [] };
      }
      return { kind: "VERIFY", text: out?.ok ? `Verificación OK (\`${out?.result?.command || "comando"}\`).` : `Falló la verificación: ${String(out?.result?.error || out?.result?.stderr || "").slice(0, 600)}`, steps: out?.steps || [] };
    }

    const wantsWrite = fullAccess || decision.allowWrite;
    if (wantsWrite) {
      if (!apiKey) return { kind: "CHAT", text: "Me falta la API key para ejecutar cambios." };
      onProgress?.({ phase: "start", text: "Ejecutando los cambios de forma autónoma…" });
      this.pendingTask = null;
      const runner = runModelTaskFn || this.runModelTask.bind(this);
      return runner({
        decision, message: text, projectRoot, apiBaseUrl, apiKey, model, memory, onProgress,
        allowWrite: true, planAuthorizedExecution: true, maxSteps: AUTHORIZED_MAX_STEPS,
        helpers, authorizedFromPending: true, fullAccess,
        permissionMode: fullAccess ? "full" : permissionMode, images: taskImages,
      });
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
      allowWrite, maxSteps, helpers, chatOnly, authorizedFromPending,
      fullAccess, permissionMode, images: taskImages = [],
      history: taskHistory, threadId: taskThreadId } = opts;
    const threadId = threadCore.resolveThreadId({ threadId: taskThreadId || this._threadId, chatId: this._threadId });
    const historyInput = Array.isArray(taskHistory) && taskHistory.length ? taskHistory : (Array.isArray(this._historyInput) ? this._historyInput : []);

    const accessFull = fullAccess === true || isFullAccess({ allowWrite, permissionMode, fullAccess, planAuthorizedExecution: authorizedFromPending });

    this.session.start(decision?.kind || "EXECUTE", projectRoot);
    this.abort = new AbortController();
    this.running = true;
    this.turnAbort = null;
    if (!Array.isArray(this.steering)) this.steering = [];

    const globalTimeoutMs = Math.max(60_000, Number(opts.totalTimeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS);
    const deadline = Date.now() + globalTimeoutMs;
    let promiseRetries = 0;

    const toolHistory = new Map();
    const readCache = new Map();

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
    const previewBlock = previewUrl ? `PREVIEW ACTIVO DEL IDE: ${previewUrl}` : "";
    const visionHardRule = (Array.isArray(taskImages) && taskImages.length) ? "VISION: Hay imágenes adjuntas. Analizalas directamente en este turno." : "";
    const noConfirmBlock = (accessFull || authorizedFromPending) ? "ACCESO COMPLETO: Ejecutá herramientas de inmediato sin pedir confirmación previa." : "";

    let system;
    if (chatOnly || decision?.kind === "CHAT") {
      system = wrapSystemPrompt([
        "Sos EditCoreAI: asistente del IDE. Respondé siempre en español, claro y directo.",
        MARKDOWN_FORMAT_PROMPT, CHAT_TOOLS_PROMPT,
        `Proyecto abierto: ${projectRoot || "(ninguno)"}.`,
        previewBlock, visionHardRule,
      ].filter(Boolean).join("\n\n"));
    } else if (listOnlyMode) {
      system = wrapSystemPrompt([
        LIST_ONLY_PROMPT, MARKDOWN_FORMAT_PROMPT,
        `Proyecto: ${projectRoot || "(ninguno)"}.`,
        previewBlock, visionHardRule,
      ].filter(Boolean).join("\n\n"));
    } else if (analysisMode) {
      system = wrapSystemPrompt([
        "Sos EditCoreAI. Estas haciendo un analisis de proyecto.",
        ANALYSIS_MODE_PROMPT,
        MARKDOWN_FORMAT_PROMPT,
        CAPABILITIES_PROMPT,
        "Tenes acceso a `read_file`, `list_files`, `search_files`, `git_status`, `web_search` para profundizar el analisis.",
        "NO uses write_file / replace_in_file (modo solo lectura).",
        opts.verifiedShown ? "La tabla de chequeos reales y la lista completa de hallazgos verificados YA se muestran al usuario arriba de tu respuesta. NO las copies: prioriza los errores verificados, explica la causa probable de cada uno citando archivo:línea y propone el arreglo. Tus observaciones propias van en la sección de hipótesis." : "",
        `Proyecto: ${projectRoot}.`,
        previewBlock,
      ].filter(Boolean).join("\n\n"));
    } else {
      system = wrapSystemPrompt([
        roadmapFirstBlock,
        "Sos EditCoreAI. Hablá como un ingeniero senior al lado del usuario.",
        LEADERSHIP_PROMPT, LIVE_NARRATION_PROMPT, MARKDOWN_FORMAT_PROMPT, CAPABILITIES_PROMPT, noConfirmBlock,
        "REGLA CRÍTICA: no cierres un turno diciendo 'ahora leo X' o 'voy a revisar Y'. Si vas a leer algo, llamá la tool en el MISMO turno.",
        "Respondé siempre en español al usuario.",
        previewBlock, visionHardRule, cognitiveBlock, connectionsBlock, pendingVerifiedBlock,
      ].filter(Boolean).join("\n\n"));
    }

    if (this._skillsPrompt) system = `${system}\n\n${this._skillsPrompt}`;
    if (!listOnlyMode) {
      const brainBlock = buildBrainContextBlock(projectRoot, this._currentUserText || message);
      if (brainBlock) system = `${system}\n\n${brainBlock}`;
    }

    const userText = `Proyecto: ${projectRoot}\n${scopeUserMessage(message)}`;
    const messages = threadCore.buildMessageList({ system, userText, projectRoot, threadId, historyInput, query: String(this._currentUserText || message || ""), images: taskImages });

    const steps = [];
    const runMutations = [];
    const stepsLimit = Math.max(1, Number(maxSteps) || DEFAULT_MAX_STEPS);
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
    const rememberOut = (textOut) => { try { threadCore.rememberExchange(projectRoot, threadId, this._currentUserText || message, textOut); } catch { /* ignore */ } };

    // Timeout por turno: 3 min en análisis, default en el resto.
    const turnTimeoutMs = analysisMode ? ANALYSIS_TIMEOUT_MS : undefined;

    try {
      for (let i = 0; i < stepsLimit; i++) {
        if (Date.now() > deadline) {
          this.session.kill();
          const partial = formatAgentVisibleText("## ⏱️ Tiempo agotado\n\nSe agotó el tiempo límite. Avance parcial registrado.");
          rememberOut(partial); detachLongRunningStreams(steps);
          return { kind: decision?.kind || "CHAT", text: partial, steps, incomplete: true, threadId, usage: totalUsage };
        }
        if (!this.session.alive) {
          rememberOut("Detenido."); detachLongRunningStreams(steps);
          return { kind: "STOP", text: "Detenido.", steps, threadId, usage: totalUsage };
        }

        const chatMode = chatOnly || decision?.kind === "CHAT";
        const availableTools = chatMode
          ? (i < stepsLimit - 1
            ? tools.getToolDefinitions({ allowWrite: false, isFullAccess: false, isAnalysis: false })
              .filter((t) => CHAT_READ_TOOLS.has(t.function?.name || t.name))
            : [])
          : tools.getToolDefinitions({ allowWrite: accessFull, isFullAccess: accessFull, isAnalysis: false })
            .filter((t) => !["preview_browser_interaction", "browser_page_action", "capture_preview_screenshot", "auto_scaffold_project", "clone_web_page", "images_to_code", "rollback_last_change"].includes(t.function?.name || t.name));

        let streamAccum = "";
        let lastVisible = "";
        this.turnAbort = new AbortController();
        const turnSignal = (typeof AbortSignal.any === "function" && this.abort?.signal) ? AbortSignal.any([this.abort.signal, this.turnAbort.signal]) : (this.turnAbort.signal || this.abort?.signal);

        const hb = setInterval(() => { try { onProgress?.({ phase: "heartbeat", text: "Procesando…" }); } catch {} }, HEARTBEAT_INTERVAL_MS);

        let turn;
        try {
          turn = await callChat({
            apiBaseUrl, apiKey, model: routedModel, messages,
            tools: availableTools,
            signal: turnSignal,
            stream: true,
            timeoutMs: turnTimeoutMs,   // ← 180s en análisis
            fallbackProfiles: this._fallbackProfiles || [],
            onFallback: ({ model: fallbackModel }) => { try { onProgress?.({ phase: "heartbeat", text: `Cambiando a ${fallbackModel}…` }); } catch {} },
            onTextDelta: (delta) => {
              const chunk = String(delta || ""); if (!chunk) return;
              try {
                streamAccum += chunk;
                const visible = visibleNarrationText(streamAccum);
                let piece = "";
                if (visible.startsWith(lastVisible)) piece = visible.slice(lastVisible.length);
                else if (visible !== lastVisible) piece = visible;
                lastVisible = visible;
                if (!piece) return;
                onProgress?.({ phase: "narration_delta", text: piece, index: steps.length, streaming: true });
              } catch {}
            },
          });
        } finally {
          clearInterval(hb); this.turnAbort = null;
        }
        addUsage(turn?.usage || {});

        let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        if (!toolCalls.length && turn.text) toolCalls = parseTextToolCalls(turn.text, { projectRoot });
        if (chatMode) toolCalls = availableTools.length ? toolCalls.filter((c) => CHAT_READ_TOOLS.has(c.function?.name)) : [];
        const cleanText = stripTextToolMarkup(turn.text || "");

        if (!toolCalls.length) {
          const promisesAction = !chatOnly && decision?.kind !== "CHAT" && !listOnlyMode && !analysisMode
            && looksLikePromiseWithoutAction(cleanText)
            && promiseRetries < MAX_PROMISE_RETRIES
            && i < stepsLimit - 2
            && successfulWritePaths(steps).length === 0;

          if (promisesAction) {
            promiseRetries += 1;
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: `No cierres el turno. Ejecutá AHORA las tools que prometiste ("${cleanText.slice(-120)}").` });
            onProgress?.({ phase: "model", text: `Reintentando: promesa sin acción (${promiseRetries}/${MAX_PROMISE_RETRIES})` });
            continue;
          }

          // En ANALYSIS: si el reporte es muy corto, forzar un turno más.
          if (analysisMode && cleanText.trim().length < 400 && i < stepsLimit - 1 && !/##\s*(?:📊|🏗️|⚙️|⚠️|🎯|📁)/.test(cleanText)) {
            messages.push({ role: "assistant", content: cleanText || null });
            messages.push({ role: "user", content: "El reporte es demasiado corto. Necesito un análisis completo con las secciones obligatorias (📊 Resumen ejecutivo, 🏗️ Arquitectura, ⚙️ Funcionalidad, ⚠️ Hallazgos, 🎯 Recomendaciones, 📁 Evidencia). Si te falta contexto, usa read_file ANTES de cerrar." });
            onProgress?.({ phase: "model", text: "Reporte corto detectado. Pidiendo análisis completo..." });
            continue;
          }

          this.session.kill();
          const written = successfulWritePaths(steps);
          let textOut = cleanText;

          if (listOnlyMode) {
            textOut = formatListOnlyAnswer(cleanText, steps, message);
          } else if (written.length > 0) {
            if (cleanText && cleanText.trim().length >= 60) textOut = cleanText;
            else {
              const head = cleanText && cleanText.length > 20 ? cleanText + "\n\n" : "";
              const lista = written.map((p) => `- \`${p}\``).join("\n");
              textOut = `## ✅ Cambios aplicados\n\n${head}Archivos actualizados:\n\n${lista}\n\n${nextStepsClosingText(projectRoot, written, steps)}`;
            }
          } else {
            textOut = groundUngroundedClaims(cleanText, steps, message, decision);
          }

          if (written.length > 0) textOut = await this.appendBeforeAfter(projectRoot, written, textOut, onProgress);
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
          return { kind: decision?.kind || "CHAT", text: textOut, steps, mutations: runMutations, incomplete: false, report: { completed: true }, threadId, usage: totalUsage };
        }

        messages.push({ role: "assistant", content: cleanText || null, tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: c.function })) });

        for (const call of toolCalls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
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

          const readCacheKey = name === "read_file" && args.path
            ? `${String(args.path).replace(/\\/g, "/").toLowerCase()}#${Number(args.startLine) || 1}-${Number(args.endLine) || 0}`
            : "";
          if (readCacheKey && readCache.has(readCacheKey)) {
            const cachedResult = { ...readCache.get(readCacheKey), cached: true };
            const stepData = { name, input: args, result: cachedResult, ok: true, cached: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result: cachedResult, ok: true });
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(cachedResult, tools.READ_FILE_PAYLOAD_CAP) });
            continue;
          }

          const callKey = `${name}:${JSON.stringify(args)}`;
          const execCount = toolHistory.get(callKey) || 0;
          if (execCount >= 1) {
            messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload({ ok: false, error: "Límite alcanzado para esta acción repetida." }) });
            continue;
          }
          toolHistory.set(callKey, execCount + 1);

          onProgress?.({ phase: "tool", stage: "running", name, input: args });

          let result;
          if (name === "write_file" || name === "replace_in_file") {
            const impl = await runImplementer({ projectRoot, path: args.path, content: args.content, oldText: args.oldText, newText: args.newText, onProgress, threadId });
            result = impl.result || impl;
          } else {
            result = await tools.execute(name, args, projectRoot, allowWrite, helpers || {});
          }

          if (result?.needsConfirmation) {
            this.pendingExternal = { name, args, projectRoot, createdAt: Date.now() };
            const stepData = { name, input: args, result, ok: false, pendingConfirmation: true };
            steps.push(stepData); this.session.addStep(stepData);
            onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: false });
            this.session.kill();
            const ask = formatAgentVisibleText(`## ⚠️ Confirmación requerida\n\n${result.preview || name}\n\nResponde **sí** o **procede** para ejecutarlo. Cualquier otro mensaje lo cancela.`);
            rememberOut(ask); detachLongRunningStreams(steps);
            return { kind: decision?.kind || "EXECUTE", text: ask, steps, pendingConfirmation: true, threadId, usage: totalUsage };
          }

          const softRecover = recoverSoftToolFailure(name, args, result, projectRoot);
          result = softRecover.payload;

          if (readCacheKey && result?.ok !== false && typeof result?.content === "string") {
            readCache.set(readCacheKey, result);
          }

          const stepData = { name, input: args, result, ok: result?.ok !== false };
          steps.push(stepData); this.session.addStep(stepData);
          onProgress?.({ phase: "tool", stage: "done", name, input: args, result, ok: stepData.ok });
          messages.push({ role: "tool", tool_call_id: call.id, name, content: tools.truncatePayload(result || {}, name === "read_file" ? tools.READ_FILE_PAYLOAD_CAP : 2000) });
        }
      }

      this.session.kill();
      const written = successfulWritePaths(steps);
      let textOut;
      if (listOnlyMode) textOut = formatListOnlyAnswer("", steps, message);
      else if (written.length > 0) textOut = `## ✅ Archivos actualizados\n\n${written.map(p => `- \`${p}\``).join("\n")}\n\n${nextStepsClosingText(projectRoot, written, steps)}`;
      else textOut = `## ℹ️ Sin acciones registradas\n\n${nextStepsClosingText(projectRoot, [], steps)}`;

      if (written.length > 0) textOut = await this.appendBeforeAfter(projectRoot, written, textOut, onProgress);
      textOut = formatAgentVisibleText(textOut);
      persistKernelRoadmap(projectRoot, { task: this._currentUserText || message, steps, kind: decision?.kind, text: textOut, completed: true });
      rememberOut(textOut); detachLongRunningStreams(steps);
      // [EDITCORE-ADD] Feedback de éxito (steps agotados pero sin excepción).
      try {
        if (agentNetwork && this._ecRoutedAgent && typeof agentNetwork.recordOutcome === "function") {
          agentNetwork.recordOutcome(this._ecRoutedAgent, true);
        }
      } catch (_) {}
      // [/EDITCORE-ADD]
      return { kind: decision?.kind || "EXECUTE", text: textOut, steps, incomplete: false, threadId, usage: totalUsage };
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
      return { kind: "CHAT", text: errText, steps, threadId, usage: totalUsage };
    } finally {
      this.running = false; this.turnAbort = null;
      try { onProgress?.({ phase: "done", text: "" }); } catch {}
    }
  }
}

module.exports = { ChatOrchestrator, SKILL_IDS, taskQueue };