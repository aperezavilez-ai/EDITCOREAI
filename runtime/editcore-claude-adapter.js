"use strict";

/**
 * EDITCORE-CLAUDE-ADAPTER (CONVERSACIONAL)
 *
 * Ejecuta la tarea del agente manteniendo una conversacion nativa con el
 * proveedor: prefijo estable (system + tarea) y turnos append-only de
 * assistant/tool_calls/resultados. Toda retroalimentacion (rechazos,
 * validaciones, resultados) entra a la conversacion, por lo que el modelo
 * nunca recibe dos veces el mismo contexto y puede corregirse a si mismo.
 *
 * Soporta los dos protocolos que usan los proveedores de EditCore:
 *  - tool_calls nativos (OpenAI-compatible / Anthropic / Gemini)
 *  - protocolo JSON textual {"type":"tool"...} como fallback automatico
 */

const { ActionRegistry } = require("./action-registry");
const { TokenLedger } = require("./token-ledger");
const { ConversationLog } = require("./conversation-log");
const { buildExternalFoundationContext } = require("./external-agent-foundation");
const { AdaptiveBudget } = require("./adaptive-budget");
const { AgentMemory } = require("./agent-memory");
const { rememberProjectEvent, loadProjectMemory, formatMemoryForPrompt } = require("./project-memory");
const { compactChatHistory, agentTaskRequirements, classifyAgentStep, validateAgentCompletion, isShallowReadStep, isFailedDiagnosticResult, verificationStepPassed } = require("../agent-runtime");
const { isAnalysisReport, isPendingAnalysisPlan } = require("../project-analysis");
const { extractPlainToolCalls, narrationWithoutToolCalls, parseAgentPayload, providerToolCallAction } = require("../agent-parser");
const { redactSensitive } = require("../security-utils");
const { nextAutoFixState } = require("./auto-fix-loop");
const { evaluateOneShotFromSteps, buildOneShotGatePrompt } = require("./oneshot-gate");
const {
  collectToolEvidence,
  groundAnalysisReport,
  buildGroundedAnalysisReport,
  buildExecutionEvidenceReport,
  analysisReportPromptForEvidence,
  analysisEvidenceSufficient,
  detectContradictoryEvidence,
  formatEvidencePreservationBlock,
  formatCurrentRunEvidenceBlock,
  extractAnalysisTargets,
  analysisTargetCoverage,
  normalizeRunScope,
  filterStepsForScope,
  collapseDuplicateReportSections,
  hasMutationEvidence,
  hasNarrationOnlyClaim,
  requiredConcreteReads,
  narrationLooksLikeInventedAnalysis,
  narrationLooksLikeSimulatedWork,
  narrationClaimsCompletedWork,
  looksLikeFilePath,
  normalizePath,
  isHollowAnalysisReport,
  isDocNoisePath,
  isJunkRepairTargetPath,
  isVendorOrGeneratedPath,
  formatForensicExcerptsBlock,
  nextAnalysisWalkActions,
  formatIncrementalAnalysisNote,
  buildAnalysisCoverageMap,
  formatCoverageBlock,
  assessFixQueue,
  resolveAnalysisDiagnosticCommand,
} = require("./evidence-grounding");
const {
  buildFixQueueFromReport,
  syncFixQueueWithSteps,
  formatFixQueueBlock,
  buildFixQueueExecutionPrompt,
  normalizeTarget: normalizeFixTarget,
} = require("./fix-queue");
const {
  resolveUnifiedAgentPlan,
  applyRunProfile,
  isFilesystemTool,
  filterToolsByPlan,
  isListOnlyRequest,
  isAnalysisOnlyRequest,
} = require("./intent-orchestrator");
const { extractAbsolutePathHints } = require("../project-analysis");
const {
  withEliteCommunicationPolicy,
  stripEliteFiller,
} = require("./elite-communication-policy");
const {
  CURSOR_PARITY_LIMITS,
  buildCursorParitySystemGuide,
  isCursorParityActive,
  shouldCloseAfterVerifiedWork,
  isOperatorPublishRequest,
  OPERATOR_PUBLISH_TOOLS,
} = require("./cursor-parity");
const { resolveAnalysisDepth, buildDepthReportGuide, isDeepOrHeavier } = require("./analysis-depth");
const {
  resolveInstructionConstraints,
  assertInstructionToolAllowed,
  formatConstraintsForModel,
} = require("./instruction-obedience");
const {
  resolveHarnessProfile,
  clipToolResultForHarness,
  buildHarnessSystemNudge,
  RunReadCache,
} = require("./agent-token-harness");
const { classifyUserIntent, toAgentFlags } = require("./intent-unified");

const AGENT_PROTOCOL_PATTERN = /"type"\s*:\s*"(?:tool|final)"|tool_call|tool_use/i;

function narrationClaimsMissingTools(text = "") {
  const raw = String(text || "");
  // Modelos inventan "sin acceso al disco" aunque list_files/read_file/write_file esten activos.
  if (/no tengo acceso a (?:tu |el |las? )?(?:sistema de archivos|filesystem|disco|herramientas)/i.test(raw)) return true;
  if (/sin acceso (?:al|a (?:tu |el )?)(?:sistema de archivos|filesystem|disco|proyecto)/i.test(raw)) return true;
  if (/no (?:puedo|se puede) (?:acceder|continuar).{0,80}(?:sistema de archivos|filesystem|disco|proyecto|herramientas|archivos)/i.test(raw)) return true;
  if (/no puedo continuar/i.test(raw) && /acceso|archivos|herramientas|disco|filesystem/i.test(raw)) return true;
  // "package.json no está disponible en el contexto" / "no verificables" sin volver a leer.
  if (/contenido (?:de )?(?:package\.json|el archivo).{0,40}no est[aá] disponible/i.test(raw)) return true;
  if (/no est[aá] disponible en el contexto/i.test(raw)) return true;
  if (/solo consta que (?:fue |se )?le[ií]d/i.test(raw)) return true;
  if (/\bno verificables?\b/i.test(raw) && /\b(?:dependencias|scripts|package\.json)\b/i.test(raw)) return true;
  if (/sin (?:sus )?dependencias ni scripts/i.test(raw)) return true;
  // Claim concreto: write_file no expuesto / solo read_file (quema tokens en bucle).
  if (narrationClaimsWriteToolsMissing(raw)) return true;
  return /no (?:tengo|hay) acceso a\b.*\b(?:list_files|read_file|search_files)\b|herramientas de sistema de archivos|no (?:estan|están) disponibles.*(?:list_files|read_file)|(?:pega|comparte|env[ií]ame|adjunta|sube|indica(?:me)? la ruta).*(?:lista de archivos|package\.json|contenido de|roadmap)|(?:roadmap\.md?).{0,80}(?:pega|sube|adjunta|env[ií]ame|comparte)|en este entorno.*(list_files|read_file)/i.test(raw);
}

/** El modelo dice que write_file/replace_in_file no estan en la sesion (a menudo cierto si FOCO/analisis). */
function narrationClaimsWriteToolsMissing(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (/no puedo ejecutar\s+write_file/i.test(raw)) return true;
  if (/write_file.{0,80}replace_in_file.{0,120}(?:no est[aá]n|no estan|no\s+est[aá]n)\s+expuestas/i.test(raw)) return true;
  if (/(?:no est[aá]n|no estan)\s+expuestas.{0,80}(?:write_file|replace_in_file)/i.test(raw)) return true;
  if (/[uú]nicamente est[aá] disponible\s+read_file/i.test(raw)) return true;
  if (/solo(?:mente)?\s+(?:est[aá]|hay)\s+(?:disponible\s+)?read_file/i.test(raw) && /write_file|replace_in_file/i.test(raw)) return true;
  if (/no simular[eé]\s+una\s+escritura/i.test(raw) && /write_file|read_file/i.test(raw)) return true;
  return false;
}

function toolNamesFromDefinitions(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .map((item) => String(item?.function?.name || item?.name || "").trim())
    .filter(Boolean);
}

function toolsIncludeWrite(tools = []) {
  const names = new Set(toolNamesFromDefinitions(tools));
  return names.has("write_file") || names.has("replace_in_file");
}

function narrationAsksUserForRoadmap(text = "") {
  return /(?:pega|sube|adjunta|env[ií]ame|comparte|indica(?:me)?(?: la ruta)?).{0,100}roadmap|roadmap.{0,100}(?:pega|sube|adjunta|env[ií]ame|comparte)|no (?:encuentro|tengo|veo) (?:el )?roadmap|necesito (?:que )?(?:me )?(?:pegues|subas|adjuntos?|env[ií]es).{0,40}roadmap/i.test(String(text || ""));
}

function narrationFingerprint(text = "") {
  return String(text || "")
    .replace(/[✅✓☑]/g, "")
    .slice(0, 360)
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function reportBlocksRepetition(text = "") {
  const raw = String(text || "");
  if (reportLooksComplete(raw)) return true;
  if (/##\s*Evidencia de correcci[oó]n/i.test(raw)) return true;
  if (/ya complet[eé]|respuesta anterior|ya (?:le[ií]|analic[eé]|revis[eé]|hice)/i.test(raw)) return true;
  return raw.length > 320 && /(?:^|\n)\s*(?:#{1,3}\s+|\d+\.\s+)/m.test(raw);
}

function isUserStopInstruction(text = "") {
  const value = String(text || "").trim().toLowerCase().replace(/[.!?,;]+$/g, "");
  if (!value) return false;
  if (/^(?:por\s+favor\s+)?(?:alto|detente|det[eé]n(?:lo)?|detener|parar?|p[aá]ralo|stop|cancela(?:r|lo)?|aborta(?:r|lo)?|interrump(?:e|ir|alo)?|basta|escala|pausa(?:r)?|no\s+sigas)$/i.test(value)) {
    return true;
  }
  if (/^(?:por\s+favor\s+)?(?:cancela|cancelar|det[eé]n|detener|parar?|p[aá]ralo|aborta|abortar|pausa|pausar|interrumpir)\s+(?:el\s+an[aá]lisis|la\s+tarea|la\s+ejecuci[oó]n|esto|todo|el\s+proceso|la\s+b[uú]squeda)$/i.test(value)) {
    return true;
  }
  if (/^(?:ya\s+)?(?:no\s+sigas|deja\s+de\s+(?:analizar|buscar|ejecutar|trabajar|hacer\s+nada))$/i.test(value)) {
    return true;
  }
  return false;
}

const ANALYSIS_REPORT_PROMPT = [
  "DEJA de usar herramientas.",
  "Con la evidencia que ya tienes en esta conversacion, escribe AHORA el REPORTE FINAL en markdown.",
  "PROHIBIDO inventar carpetas/archivos no leidos ni listados (backend/, frontend/, uploads/, etc.).",
  "Obligatorio:",
  "## Análisis del proyecto",
  "## Errores y riesgos encontrados (archivo concreto + problema especifico)",
  "## Cómo lo corregiré (paso concreto por archivo o comando)",
  "## Recomendaciones concretas (archivo + cambio sugerido)",
  "## Evidencia real de herramientas",
  "Cierra con esta linea exacta: Cuando autorices procedo con las correcciones.",
  "",
  "REGLAS DE REDACCION (OBLIGATORIAS):",
  "- Responde 100% en español correcto (con tildes: está, también, código) para un usuario no técnico.",
  "- PROHIBIDO cortar o pegar palabras (\"archi vo\", \"enelproyecto\"). Espacios y ortografía correctos.",
  "- NO pegues código fuente, imports, bloques ``` ni líneas de archivo tal cual.",
  "- Describe cada problema en prosa: qué archivo, qué falla y qué harás para corregirlo.",
  "- Puedes citar nombres de archivo y símbolos, pero nunca volcar el contenido del código.",
  "- Si no leíste un archivo, no afirmes errores dentro de él.",
].join("\n");

function sanitizeUserFacingReport(text) {
  let value = stripEliteFiller(String(text || "").trim());
  if (!value) return value;
  // Nunca dejar llegar el meta-cierre al chat (analisis o ejecucion).
  value = value.replace(/^.*Verificacion completada con evidencia real.*$/gim, "");
  value = value.replace(/```[\w.-]*\n[\s\S]*?```/g, "");
  value = value.replace(/```[\s\S]*?```/g, "");
  // Quitar arboles ASCII inventados y relleno conversacional.
  value = value.replace(/^[ \t]*[├└│─]+.*$/gm, "");
  value = value.replace(/^(?:Entendido\.?|Disculpa,.*|Procedo con.*|Voy a proceder.*|Déjame verificar.*)\s*$/gim, "");
  value = value.replace(/^[ \t]*[📋✅⚠️📊🎯🔴]+[ \t]*/gm, "");
  value = value.split("\n").map((line) => {
    const trimmed = line.trim();
    const dumped = /^((?:[\w.@/-]+\/)*[\w.@-]+\.[a-zA-Z0-9]+)\s*:\s*(import\b|export\b|'use client'|"use client"|const\s|let\s|function\s|from\s)/i.exec(trimmed);
    if (dumped) {
      return `- **${dumped[1]}**: hay codigo relevante; se revisara y corregira sin pegarlo en el chat.`;
    }
    return line;
  }).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^(import|export|from|const|let|var|function|class|interface|type|enum)\s/.test(trimmed)) return false;
    if (/^[a-zA-Z_$][\w$]*\s*=\s*require\(/.test(trimmed)) return false;
    if (/^['"]use (?:client|server)['"];?$/.test(trimmed)) return false;
    if (/^[<{[\]();=+\-*\\/|&]+$/.test(trimmed)) return false;
    if (/Paso\s+\d+\s*:/i.test(trimmed) && /listado|lectura|explorando/i.test(trimmed)) return false;
    return true;
  }).join("\n");
  return stripEliteFiller(value.replace(/\n{3,}/g, "\n\n").trim());
}

function reportLooksComplete(text) {
  return isAnalysisReport(text) || isPendingAnalysisPlan(text);
}

/** Eco del prompt del usuario (o casi) como "respuesta" = fallo duro. */
function looksLikePromptEcho(prompt = "", candidate = "") {
  const a = String(prompt || "").replace(/\s+/g, " ").trim().toLowerCase();
  const b = String(candidate || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!a || !b || a.length < 40) return false;
  if (b === a) return true;
  if (b.includes(a) && b.length < a.length * 1.35) return true;
  const aHead = a.slice(0, Math.min(180, a.length));
  if (aHead.length >= 40 && b.startsWith(aHead)) return true;
  return false;
}

/** Respuesta corta de listado a partir de evidencia real (anti-plantilla forense). */
function formatListOnlyAnswerFromSteps(steps = [], projectRoot = "", prompt = "") {
  const listSteps = (Array.isArray(steps) ? steps : []).filter((s) => s?.name === "list_files" && s.ok === true);
  if (!listSteps.length) return "";
  const last = listSteps[listSteps.length - 1];
  const entries = Array.isArray(last.result)
    ? last.result
    : (Array.isArray(last.result?.entries) ? last.result.entries : []);
  const target = String(last.input?.path || last.result?.path || "").replace(/\\/g, "/").trim() || ".";
  const folders = [];
  const files = [];
  for (const entry of entries) {
    const name = String(entry?.name || entry?.path || "").replace(/\\/g, "/").split("/").pop();
    if (!name || name === "." || name === "..") continue;
    const isDir = entry?.kind === "directory" || entry?.type === "dir" || entry?.type === "directory"
      || entry?.isDirectory === true || entry?.directory === true;
    if (isDir) folders.push(name);
    else files.push(name);
  }
  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  const lines = [
    `Contenido de \`${target}\`${projectRoot ? ` (proyecto: ${projectRoot})` : ""}:`,
    "",
    `**Carpetas (${folders.length}):**`,
    ...(folders.length ? folders.map((n) => `- ${n}/`) : ["- (ninguna)"]),
    "",
    `**Archivos (${files.length}):**`,
    ...(files.length ? files.map((n) => `- ${n}`) : ["- (ninguno)"]),
    "",
    `Total: ${folders.length + files.length} entradas en el primer nivel.`,
  ];
  if (/\bcontiene\b/i.test(prompt) && (folders.length || files.length)) {
    lines.push("", `Resumen: ${folders.length} carpeta(s) y ${files.length} archivo(s) en \`${target}\`.`);
  }
  return lines.join("\n");
}

function looksLikeForensicListDrift(text = "") {
  return /Qu[eé] s[ií] funcion[oó]|FORENSIC_EXCERPTS|Cuando autorices procedo|C[oó]mo lo corregir[eé]|Mapa carpeta por carpeta/i.test(String(text || ""));
}

function looksLikeNoMutationMessage(text = "") {
  return /Sin cambios reales en disco|No hubo write_file\/replace_in_file|progreso simulado/i.test(String(text || ""));
}

// Solo las lecturas puras son reutilizables desde el cache: una mutacion o un
// comando deben ejecutarse siempre de verdad, y una escritura invalida las
// lecturas previas de ese archivo.
const READ_CACHEABLE_TOOLS = new Set([
  "list_files", "read_file", "search_files", "project_discovery", "codebase_map",
  "symbol_search", "dependency_search", "fetch_url",
  "github_repo_info", "github_list_files", "github_read_file", "github_search_repos",
  "brain_search", "brain_tools",
]);
const MUTATION_TOOLS = new Set(["write_file", "replace_in_file", "create_project", "create_pdf", "create_word", "create_excel", "create_csv"]);

class EditCoreClaudeAdapter {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 18;
    this.tokenBudget = options.tokenBudget || 100000;
    this.logger = options.logger || console;

    // NO crear ActionRegistry aquí - se pasa desde afuera
    this.actionRegistry = null;
    // Nuevos módulos de optimización
    this.tokenLedger = new TokenLedger();
    this.adaptiveBudget = new AdaptiveBudget(this.tokenBudget, { logger: this.logger });
    this.agentMemory = null;
    this.memoryProjectRoot = "";

    // Referencias al sistema de EditCore (configuradas después)
    this.providerApi = null;
    this.toolExecutor = null;
    this.taskManager = null;
    this.contextStore = null;

    this.steps = [];
    this.tokensUsed = 0;
    this.providerCalls = 0;
    this.conversation = null;
  }

  buildRunScope(input = {}) {
    return normalizeRunScope({
      runId: input.runId || input.chatRunId || "",
      taskId: input.taskId || "",
      projectRoot: input.projectRoot || "",
      prompt: input.prompt || "",
      analysisTargets: input.analysisTargets || extractAnalysisTargets(input.prompt || ""),
      analysisDepth: input.analysisDepth || null,
    });
  }

  tagStepMeta() {
    const scope = this.runScope || {};
    return {
      runId: scope.runId || "",
      taskId: scope.taskId || "",
      projectRoot: scope.projectRoot || "",
      startedAt: new Date().toISOString(),
    };
  }

  collectRunEvidence(steps = [], projectRoot = "") {
    return collectToolEvidence(steps, projectRoot || this.runScope?.projectRoot || "", this.runScope);
  }

  refreshEvidencePreservationBlock(steps = []) {
    if (!this.conversation || !this.runScope) return;
    const evidence = this.collectRunEvidence(steps);
    this.conversation.setEvidencePreservationBlock(formatEvidencePreservationBlock(evidence, this.runScope));
  }

  analysisSufficiencyOpts(input = {}) {
    return {
      prompt: input.prompt || "",
      targets: this.runScope?.analysisTargets || extractAnalysisTargets(input.prompt || ""),
      promptOnlyMode: input.promptOnlyMode === true,
      depthProfile: input.analysisDepth || null,
    };
  }

  trackNarrationEmission(text = "") {
    const fp = narrationFingerprint(text);
    if (!fp || fp.length < 36) return { emit: true, duplicate: false };
    if (this.narrationSeen.has(fp)) {
      this.duplicateNarrationCount += 1;
      return { emit: false, duplicate: true };
    }
    this.narrationSeen.add(fp);
    return { emit: true, duplicate: false };
  }

  finalizeAnalysisOnce(input, steps, candidateText = "") {
    if (this.analysisFinalizedText) {
      if (!/Verificacion completada con evidencia real/i.test(this.analysisFinalizedText)
        && !isHollowAnalysisReport(this.analysisFinalizedText)
        && reportLooksComplete(this.analysisFinalizedText)) {
        return this.analysisFinalizedText;
      }
      this.analysisFinalizedText = "";
    }
    let candidate = String(candidateText || "");
    if (/Verificacion completada con evidencia real/i.test(candidate) || isHollowAnalysisReport(candidate)) {
      candidate = "";
    }
    const grounded = groundAnalysisReport(candidate, steps, input.projectRoot || "", this.runScope);
    if (grounded.replaced) {
      this.logger.warn(`⚠️ [Grounding] Reporte de analisis reemplazado: ${grounded.reason || "sin evidencia"}`);
    }
    let text = collapseDuplicateReportSections(
      grounded.text || buildGroundedAnalysisReport(grounded.evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null }),
    );
    if (/Verificacion completada con evidencia real/i.test(text) || isHollowAnalysisReport(text)) {
      text = collapseDuplicateReportSections(buildGroundedAnalysisReport(grounded.evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null }));
    }
    if (!/(?:c[oó]mo proceder|siguiente paso|avanzamos|cuando autorices|\bprocede\b)/i.test(text)) {
      text = text.trim() + "\n\nCuando autorices procedo con las correcciones.\n\n---\n\n### 🚀 ¿Cómo proceder?\n¿Deseas que aplique estas correcciones y optimizaciones? Responde **\"procede\"** para comenzar la ejecución o indícame si prefieres ajustar algún detalle.";
    }
    this.analysisFinalizedText = text;
    return text;
  }

  /**
   * Analisis NO puede cerrar solo con seeds/walker + plantilla.
   * Exige al menos 1 llamada al modelo (investigacion real).
   */
  analysisHasModelInvestigation(finalText = "") {
    if (this.providerCalls < 1) return false;
    const raw = String(finalText || "").trim();
    if (!raw) return false;
    // Si solo es una promesa de lectura o razonamiento previo incompleto (ej. "Ahora leo...", "Voy a hacer un análisis...", "Tengo la estructura...")
    if (/(?:ahora\s+leo|voy\s+a\s+(?:hacer|leer|listar|revisar)|primero\s+listo|tengo\s+la\s+estructura|a\s+continuaci[oó]n\s+reviso)[^.\n]*$/i.test(raw) && !/(?:##\s*(?:Qué|Hallazgos|Problemas|Análisis|Estructura|Evidencia|Arquitectura))/i.test(raw)) {
      return false;
    }
    if (raw.length < 240 && !/(?:##\s*(?:An[aá]lisis|Diagn[oó]stico|Arquitectura|Hallazgos|Estructura|Flujo|Recomendaciones|Qu[eé]\s+s[ií]|Qu[eé]\s+fall[oó]))/i.test(raw)) {
      return false;
    }
    if (reportLooksComplete(raw) || isAnalysisReport(raw)) {
      if (/^(?:voy a|ahora leo|primero listo)/i.test(raw) && !/(?:##\s*(?:Qué|Hallazgos|Problemas|Análisis|Estructura|Evidencia|Arquitectura))/i.test(raw)) {
        return false;
      }
      return true;
    }
    return this.providerCalls >= 2 && raw.length >= 350;
  }

  /**
   * Fuerza turnos del modelo con tools hasta que investigue y redacte el informe.
   * Esto es el deber ser del agente: no programar la respuesta del chat.
   */
  async forceModelInvestigation(input, steps, { minModelTurns = 2, maxTurns = 10 } = {}) {
    let lastText = "";
    const startedAt = Date.now();
    for (let n = 0; n < maxTurns; n += 1) {
      if (input.signal?.aborted) break;
      if (Date.now() - startedAt > 180_000) break;

      const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
      const enough = analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok;

      if (enough && this.providerCalls >= 1 && !this.reportPromptSent) {
        this.reportPromptSent = true;
        this.forceTextOnlyClose = true;
        this.conversation.appendUser(analysisReportPromptForEvidence(evidence));
        input.onProgress?.({ phase: "model", text: "El modelo redacta el informe de hallazgos..." });
      } else if (!this.forceTextOnlyClose) {
        if (n === 0) {
          this.conversation.appendUser([
            "INVESTIGACION REAL (obligatoria — no cierres en segundos):",
            "1. Usa list_files / read_file / search_files sobre codigo fuente del producto (src/, app/, lib/, etc).",
            "2. Busca errores reales, configs rotas, imports rotos, env faltante, flujos incompletos.",
            "3. Cuando tengas evidencia, escribe el REPORTE FINAL con ## Qué sí funcionó, ## Qué falló, ## Evidencia, ## Cómo lo corregiré.",
            "PROHIBIDO inventar. PROHIBIDO responder solo con Avances. PROHIBIDO plantilla vacia.",
          ].join("\n"));
        }
        input.onProgress?.({
          phase: "model",
          text: `Investigando con el modelo (turno ${this.providerCalls + 1}/${minModelTurns}+)...`,
        });
      }

      let turn;
      try {
        turn = await this.getNextTurn(input, steps);
      } catch (error) {
        this.logger.warn(`⚠️ [Analisis] turno de investigacion falló: ${String(error?.message || error).slice(0, 160)}`);
        break;
      }

      lastText = String(turn?.text || "").trim() || lastText;
      const nativeCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
      const plainActions = nativeCalls.length ? [] : extractPlainToolCalls(turn.text);
      const actions = [];
      for (const call of nativeCalls) {
        const action = providerToolCallAction(call);
        if (action) actions.push({ ...action, callId: call?.id || null });
      }
      for (const action of plainActions) actions.push({ ...action, callId: null });

      if (actions.length && this.forceTextOnlyClose !== true) {
        this.conversation.appendAssistant({
          text: plainActions.length ? narrationWithoutToolCalls(turn.text) : (turn.text || ""),
          toolCalls: nativeCalls,
        });
        for (const action of actions.slice(0, 5)) {
          await this.executeSeedTool(input, steps, action.name, action.input || {});
        }
        continue;
      }

      // Si no hubo tool calls pero el texto menciona ejecutar tests o comandos de verificacion
      if (!actions.length && /npm\s+test|npm\s+run\s+test|node\s+--test/i.test(lastText) && !this.reportPromptSent && n < maxTurns - 1) {
        await this.executeSeedTool(input, steps, "run_command", { command: "npm test" });
        this.conversation.appendUser("Comando npm test ejecutado con éxito. Ahora entrega el resultado concreto y el cierre con la propuesta siguiente.");
        continue;
      }

      // Si no hubo tool calls pero el texto menciona archivos que quiere leer (ej. package.json, main.js, manifest)
      if (!actions.length && !this.analysisHasModelInvestigation(lastText) && n < maxTurns - 1) {
        const fileMentions = (lastText.match(/\b([a-zA-Z0-9_\-./]+\.(?:js|json|ts|jsx|tsx|html|css|md|py))\b/gi) || [])
          .filter(f => !f.endsWith('.md') || f === 'README.md');
        if (fileMentions.length && !this.reportPromptSent) {
          for (const f of fileMentions.slice(0, 3)) {
            await this.executeSeedTool(input, steps, "read_file", { path: f });
          }
          this.conversation.appendUser("Archivos leídos. Continúa tu análisis forense y redacta el reporte completo con tus hallazgos de arquitectura y flujo.");
          continue;
        }
      }

      if (this.analysisHasModelInvestigation(lastText)) {
        return lastText;
      }

      if (!actions.length && enough && !reportLooksComplete(lastText)) {
        this.forceTextOnlyClose = true;
        this.reportPromptSent = true;
        this.conversation.appendUser(analysisReportPromptForEvidence(evidence));
      }
    }
    return lastText;
  }

  /**
   * Unico cierre de analisis del orquestador: evidencia → informe (hallazgos + plan) → chat.
   * No cambia el deber ser: analizar, reportar, proponer correcciones; PROCEDE sigue mutando.
   */
  closeAnalysisWithReport(input, steps, candidateText = "", stopReason = "") {
    const text = this.finalizeAnalysisOnce(input, steps, candidateText || "");
    const safe = String(text || "").trim().length >= 80
      ? text
      : this.buildAnalysisFallbackReport(input, steps);
    this.analysisFinalizedText = safe;
    input.onProgress?.({
      phase: "final_report",
      stage: "analysis_complete",
      index: Array.isArray(steps) ? steps.length : 0,
      text: safe,
    });
    this.logger.log(`✓ [UNIFIED_AGENT] reporte de analisis listo (${String(safe).length} chars) — ${stopReason || "ok"}`);
    return { text: safe, stopReason: stopReason || "Analisis cerrado con reporte de hallazgos y plan." };
  }

  /**
   * Andamiaje de razonamiento explícito antes de tools (solo análisis).
   */
  buildReasoningPhase(input) {
    const prompt = String(input.prompt || "").trim();
    const isAnalysis = input.analysisMode === true
      || /^(?:analiza|audita|diagnostica|revisa|explora|investiga|compara|eval[uú]a|explica)\b/i.test(prompt);
  const isExecution = input.planAuthorized === true
    || input.planAuthorizedExecution === true;

    if (!isAnalysis || isExecution) {
      return "";
    }

    return [
      "═══════════════════════════════════════════════════════════════",
      "INVESTIGACIÓN Y ANÁLISIS:",
      "═══════════════════════════════════════════════════════════════",
      "1. Ejecuta herramientas (list_files, read_file, search_files) para inspeccionar los archivos reales del proyecto.",
      "2. Lee el package.json y los entry points o módulos clave.",
      "3. Explica con claridad la arquitectura, los componentes, el flujo de datos y los hallazgos.",
      "═══════════════════════════════════════════════════════════════",
    ].join("\n");
  }

  publishKickoffBriefing(input = {}, steps = []) {
    const isExecution = input.planAuthorized === true || input.planAuthorizedExecution === true;
    const prevSteps = Array.isArray(steps) ? steps.length : 0;
    const text = isExecution
      ? `Avance — inicio: ejecución autorizada (escritura / write_file). Pasos locales previos: ${prevSteps}.`
      : `Avance — inicio: modo análisis activo. Investigando el proyecto con herramientas de lectura.`;
    input.onProgress?.({ phase: "narration_delta", text });
    input.onProgress?.({ phase: "model", text: "Trabajando…" });
  }

  /**
   * Ejecuta una tarea completa del agente
   */
  async executeTask(input) {
    this.steps = [];
    this.tokensUsed = 0;
    this.providerCalls = 0;
    this.tokenLedger = new TokenLedger();
    // Contadores anti-repeticion: una accion identica repetida dentro de la
    // misma corrida no crea pasos nuevos ni progreso en el chat; solo devuelve
    // correccion al modelo, y si insiste la corrida se cierra con lo que hay.
    this.repeatCounts = new Map();
    this.wastedRepeats = 0;
    this.repeatWarned = false;
    this.narrationSeen = new Set();
    this.duplicateNarrationCount = 0;
    this.consecutiveNoToolTurns = 0;
    // Si el modelo responde 2 turnos seguidos sin emitir tool_calls reales,
    // normalmente cortamos para evitar gasto de tokens. Para casos donde
    // el modelo "olvida" las tool calls al reintentar, damos 1 oportunidad
    // extra forzando evidencia con herramientas antes de cerrar.
        this.forcedToolAfterNoToolStop = false;
        this.reportPromptSent = false;  // BUG 1/4 FIX: evita enviar el prompt de reporte más de una vez
        this.brainRequiredNudgeSent = false;
        this.hollowReportNudgeSent = false;
        this._modelWaitNudgeSent = false;
        this.writeToolsMissingNudgeSent = false;
        this.verifiedCloseArmed = false;
    this.forceTextOnlyClose = false;
    this.analysisDiagnosticSeeded = false;
    this.rejectionCounts = new Map();
    this.usageTotals = {
      confirmed_input_tokens: 0,
      confirmed_output_tokens: 0,
      estimated_input_tokens: 0,
      estimated_output_tokens: 0,
      provider_cache_read_tokens: 0,
      peak_request_input_tokens_estimate: 0,
    };
    const requestedBudget = Math.max(0, Number(input.maxTokens) || 0);
    // Las tareas con escritura no deben morir por limites internos: presupuesto
    // e iteraciones generosos; los guardas de progreso (fallos repetidos, loop
    // detection, validacion de completitud) son los que protegen del gasto inutil.
    const cursorParityMode = isCursorParityActive({
      isAgent: input.orchestratorPlan?.isAgent !== false && input.allowWrite !== false,
      permissionFull: input.permissionMode === "full" || input.runProfile?.permissionFull === true,
      permissionReadonly: input.permissionMode === "readonly",
      prompt: input.prompt,
      cursorParityEnabled: input.cursorParityEnabled !== false,
    }) || input.runProfile?.cursorParityMode === true || input.orchestratorPlan?.cursorParityMode === true;
    input.cursorParityMode = cursorParityMode;
    const listOnly = input.runProfile?.listOnly === true
      || input.orchestratorPlan?.listOnly === true
      || input.orchestratorPlan?.runProfile?.listOnly === true
      || (isListOnlyRequest(input.prompt) && input.promptOnlyMode !== true);
    input.listOnly = listOnly === true;
    if (listOnly) {
      // El agente responde (1 list_files + 1 turno de modelo). Sin bucle ni plantilla forense.
      input.cursorParityMode = false;
      input.analysisMode = false;
      input.maxIterations = Math.min(2, Number(input.maxIterations) || 2);
    }
    const depthProfileRaw = resolveAnalysisDepth(String(input.prompt || ""));
    const permissionFullEarly = input.permissionMode === "full"
      || input.runProfile?.permissionFull === true
      || input.orchestratorPlan?.permissionFull === true
      || input.fullAccess === true;
    input.analysisDepth = {
      ...depthProfileRaw,
      fullAccess: permissionFullEarly,
      skipAuthCloser: permissionFullEarly || depthProfileRaw.skipAuthCloser === true,
      nextOptionsCloser: permissionFullEarly || depthProfileRaw.nextOptionsCloser === true,
    };
    const instructionConstraints = resolveInstructionConstraints(
      String(input.rawUserPrompt || input.originalGoal || input.prompt || ""),
    );
    // PROCEDE / plan autorizado: el usuario manda. Sin FOCO, sin cola obligatoria, sin candados de analisis.
    if (input.planAuthorized === true) {
      input.instructionConstraints = {
        active: false,
        mode: "open",
        allowlist: [],
        folderAllowlist: [],
        denylist: [],
        skipBootstrap: true,
        maxIterations: Math.max(18, Number(input.maxIterations) || 18),
        depthOverride: null,
      };
      if (input.analysisDepth && typeof input.analysisDepth === "object") {
        input.analysisDepth = {
          ...input.analysisDepth,
          scopedFocus: false,
          scopedFolderFocus: false,
          scopedDiskFocus: false,
        };
      }
      if (input.runProfile && typeof input.runProfile === "object") {
        input.runProfile.scopedDiskFocus = false;
        input.runProfile.scopedFolderFocus = false;
        input.runProfile.skipBootstrap = true;
        input.runProfile.analysisMode = false;
      }
      if (input.orchestratorPlan && typeof input.orchestratorPlan === "object") {
        input.orchestratorPlan.analysisMode = false;
        if (input.orchestratorPlan.runProfile) {
          input.orchestratorPlan.runProfile.analysisMode = false;
          input.orchestratorPlan.runProfile.scopedDiskFocus = false;
        }
      }
      this.forceTextOnlyClose = false;
      input.allowWrite = true;
      input.analysisMode = false;
      input.planAuthorizedExecution = true;
      input.onProgress?.({
        phase: "startup",
        text: "PROCEDE: ejecucion libre autorizada (write_file/replace_in_file)...",
      });
    } else {
      input.instructionConstraints = instructionConstraints;
    }
    // FOCO retirado: nunca anunciarlo ni recortar presupuesto/iteraciones.
    if (input.instructionConstraints?.mode === "scoped" || input.instructionConstraints?.mode === "scoped_dir") {
      input.instructionConstraints = {
        active: false,
        mode: "open",
        allowlist: [],
        folderAllowlist: [],
        denylist: input.instructionConstraints.denylist || [],
        skipBootstrap: false,
        maxIterations: 0,
        depthOverride: null,
      };
    }
    if (input.analysisDepth && typeof input.analysisDepth === "object") {
      input.analysisDepth = {
        ...input.analysisDepth,
        scopedFocus: false,
        scopedFolderFocus: false,
        scopedDiskFocus: false,
      };
    }
    const depthProfile = input.analysisDepth || depthProfileRaw;
    const minimumTaskBudget = listOnly
      ? 12_000
      : (input.planAuthorized === true
        ? 180_000
        : (input.allowWrite && input.analysisMode !== true
          ? 180_000
          : (input.analysisMode === true
            ? Math.max(120_000, Number(depthProfile.tokenBudget) || 220_000)
            : 80_000)));
    const effectiveBudget = Math.max(this.tokenBudget, requestedBudget, minimumTaskBudget);
    const requestedIterations = Number(input.maxIterations) || 0;
    const deepAnalysis = input.analysisMode === true && isDeepOrHeavier(input.analysisDepth.depth);
    const hardCap = listOnly
      ? 2
      : (input.planAuthorized === true
        ? 24
        : (input.allowWrite && input.analysisMode !== true
          ? 24
          : Math.min(36, Number(input.analysisDepth.maxIterations) || (deepAnalysis ? 32 : 16))));
    const effectiveMaxIterations = Math.min(
      hardCap,
      requestedIterations > 0
        ? requestedIterations
        : (listOnly
          ? 2
          : (input.planAuthorized === true
            ? 18
            : Math.max(this.maxIterations, Number(input.analysisDepth.maxIterations) || (deepAnalysis ? 28 : 14)))),
    );
    const requirements = agentTaskRequirements(input.prompt, input.allowWrite !== false, {
      planAuthorized: input.planAuthorized === true,
    });
    this.adaptiveBudget = new AdaptiveBudget(effectiveBudget, { logger: this.logger });
    
    // Intent unificado: una sola decisión de modo (evita pelea renderer vs adapter)
    try {
      const classified = classifyUserIntent(input.prompt || input.userPrompt || "", {
        planAuthorizedExecution: input.planAuthorizedExecution === true,
        forceWrite: input.allowWrite === true && input.analysisMode !== true,
      });
      input._unifiedIntent = classified;
      input.onProgress?.({ phase: "start", text: `Intent: ${classified.label}` });
    } catch (e) {
      /* intent best-effort */
    }
    
    this.harnessProfile = resolveHarnessProfile(input.analysisDepth, this.adaptiveBudget, {
      analysisMode: input.analysisMode === true,
    });
    if (input.analysisMode === true) {
      input.onProgress?.({
        phase: "startup",
        text: `${input.analysisDepth.label} · harness ${this.harnessProfile.strategy} · presupuesto ${effectiveBudget.toLocaleString()} tok`,
      });
    }

    // Verificar que ActionRegistry exista
    if (!this.actionRegistry) {
      throw new Error('ActionRegistry no inicializado. Debe ser pasado desde main.js');
    }

    // Inicializar memoria del agente
    if (input.projectRoot && !listOnly && this.memoryProjectRoot !== input.projectRoot) {
      this.agentMemory = new AgentMemory(input.projectRoot, { maxConversations: 40 });
    this.readCache = new RunReadCache();
      this.memoryProjectRoot = input.projectRoot;
      await this.agentMemory.load();
      this.logger.log(`✓ [Memory] Cargada memoria persistente (${this.agentMemory.getSummary().conversations} conversaciones)`);
    }

    this.analysisFinalizedText = "";
    this.requiresReasoningBlock = false;
    if (input.orchestratorPlan?.runProfile) {
      applyRunProfile(input, input.orchestratorPlan.runProfile);
    } else if (input.runProfile) {
      applyRunProfile(input, input.runProfile);
    } else {
      input.allowFilesystem = input.promptOnlyMode !== true && (input.analysisMode === true || input.allowWrite === true);
    }
    this.activeInput = input;
    this.runScope = this.buildRunScope(input);
    this.autoFixCycles = 0;
    this.lastAutoFixStep = 0;
    const scopedResume = input.freshAnalysisRun === true
      ? []
      : filterStepsForScope(Array.isArray(input.resumeSteps) ? input.resumeSteps : [], this.runScope);

    // La conversacion vive durante toda la tarea: prefijo estable (prompt cache)
    // + harness compacta agresivo para no quemar tokens.
    const harnessConv = this.harnessProfile?.conversation || {};
    this.conversation = new ConversationLog({
      prefixMessages: this.buildPrefixMessages(input),
      maxChars: listOnly
        ? 24_000
        : (Number(harnessConv.maxChars) || (cursorParityMode ? CURSOR_PARITY_LIMITS.conversationMaxChars : 80_000)),
      keepLastTurns: listOnly
        ? 4
        : (Number(harnessConv.keepLastTurns) || (cursorParityMode ? CURSOR_PARITY_LIMITS.conversationTurns : 8)),
    });

    const steps = scopedResume
      .filter(Boolean)
      .map((step, index) => ({ ...this.tagStepMeta(), ...step, index: Number(step.index ?? index) }));
    this.refreshEvidencePreservationBlock(steps);
    let completed = false;
    let finalText = "";
    let stopReason = "";
    let finalRejections = 0;
    let emptyResponseRetries = 0;
    const EMPTY_PROVIDER_FALLBACK = "El proveedor no devolvio una instruccion ni una respuesta util.";

    // PASO 1: evidencia en disco solo si el perfil lo exige (no en prompt-primero).
    if (listOnly) {
      await this.seedListOnlyFolder(input, steps);
    } else if (input.analysisMode === true && !input.promptOnlyMode && input.runProfile?.skipBootstrap !== true) {
      await this.seedAnalysisBootstrap(input, steps);
    } else if (input.allowFilesystem !== false && input.promptOnlyMode !== true && !input.analysisMode) {
      await this.seedExplicitPathList(input, steps);
    } else if (input.promptOnlyMode) {
      input.onProgress?.({ phase: "model", text: input.runProfile?.statusLabel || "Entendiendo tu solicitud..." });
      this.conversation.appendUser([
        input.runProfile?.orchestrationBlock || "Analiza la solicitud del usuario antes de usar herramientas de archivos.",
        `SOLICITUD DEL USUARIO:\n${input.prompt}`,
      ].filter(Boolean).join("\n\n"));
    }

    // PROCEDE: ejecucion libre autorizada por el usuario (sin FOCO obligatorio).
    this.fixQueue = Array.isArray(input.fixQueue) ? input.fixQueue : [];
    if (input.planAuthorized === true) {
      this.forceTextOnlyClose = false;
      input.analysisMode = false;
      if (!this.fixQueue.length) {
        const planText = [
          String(input.authorizedPlanText || ""),
          String(input.persistedPlan || ""),
          String(input.originalGoal || ""),
          String(input.analysisContext || ""),
        ].filter((chunk) => chunk && !/^\s*(?:procede|adelante|autorizo|contin[uú]a)\b/i.test(chunk) && chunk.length > 80)
          .sort((a, b) => b.length - a.length)[0] || "";
        if (planText) {
          this.fixQueue = buildFixQueueFromReport(planText, {}, { maxItems: 12 });
        }
      }
      this.fixQueue = (this.fixQueue || []).filter((item) => item?.target && !isJunkRepairTargetPath(item.target));
      input.fixQueue = this.fixQueue;

      // Preleer candidatos si hay cola (ayuda a replace_in_file); si no hay, el modelo elige libremente.
      for (const item of this.fixQueue.slice(0, 5)) {
        if (!item?.target) continue;
        await this.executeSeedTool(input, steps, "read_file", { path: item.target });
      }
      if (this.fixQueue.length) {
        this.refreshFixQueueFocus(input, steps, { forceAppend: true });
      }
      this.conversation.appendUser([
        "EJECUCION AUTORIZADA POR EL USUARIO (PROCEDE) — MODO LIBRE:",
        "- Tienes write_file, replace_in_file, read_file, list_files, search_files y run_command.",
        "- Corrige el proyecto con cambios REALES en disco. No narres sin mutar.",
        "- Puedes tocar cualquier archivo fuente del proyecto (sin allowlist).",
        this.fixQueue.length
          ? `- Sugerencias de cola (opcionales): ${this.fixQueue.map((i) => i.target).slice(0, 8).join(", ")}`
          : "- No hay cola previa: inspecciona src/ y aplica las correcciones necesarias.",
        "- Evita solo vendor/minificados (workbox, *.min.js) salvo que el usuario lo pida.",
        "- Tras mutar, verifica con read_file. Cierra cuando haya cambios reales.",
      ].join("\n"));
      input.onProgress?.({ phase: "model", text: "PROCEDE libre: el agente puede escribir en el proyecto..." });
    }

    if (listOnly) {
      const listedOk = steps.some((step) => step.name === "list_files" && step.ok === true);
      if (listedOk) {
        this.forceTextOnlyClose = true;
        this.conversation.appendUser([
          "LISTADO YA OBTENIDO CON list_files.",
          "Responde YA al usuario en espanol con la lista completa (carpetas y archivos).",
          "PROHIBIDO llamar mas herramientas. PROHIBIDO plantilla de reporte extenso (Qué sí funcionó / procede).",
          "PROHIBIDO decir que esperas otra instruccion. Entrega el listado ahora.",
        ].join(" "));
      }
    }

    // Contrato de trabajo: plan → ejecuta → verifica → cierra (sin llamadas extra al modelo).
    if (!listOnly && input.promptOnlyMode !== true) {
      this.conversation.appendUser([
        "CONTRATO DE TRABAJO (obligatorio):",
        input.analysisMode === true
          ? "1. PLAN corto (2-4 lineas): orden de carpetas/archivos. PROHIBIDO listar 8 lecturas de golpe."
          : "1. PLAN: antes de la primera herramienta, escribe en 3-5 lineas el objetivo, archivos clave y como verificaras.",
        input.analysisMode === true
          ? "2. EJECUTA SERIAL: UNA herramienta por turno → narra avance en chat (3-8 lineas) → siguiente herramienta. Como Cursor."
          : "2. EJECUTA: sigue ese plan. Si la evidencia lo desmiente, corrige el plan en 1 linea y continua; NO reinicies la exploracion.",
        input.analysisMode === true
          ? "3. VERIFICA: cada hallazgo del chat debe anclarse a la lectura que acabas de hacer."
          : "3. VERIFICA: tras la ultima escritura, una lectura o comando que demuestre el efecto. Sin verificacion no cierres.",
        "4. CIERRA: reporte final + que FALTA para que el proyecto funcione + siguiente accion concreta.",
        "5. PROHIBIDO pedir al usuario \"mas informacion\" sobre el proyecto abierto: inspecciona el disco tu.",
        "6. Solo pregunta al usuario secretos/API keys o preferencias de negocio que no estan en el repo.",
        input.analysisMode === true
          ? "7. PROHIBIDO saturar: no abras 4+ archivos en el mismo turno ni digas solo 'PLAN: leer 8 archivos' sin avanzar uno a uno."
          : "",
      ].filter(Boolean).join("\n"));
    }

    if (input.analysisMode === true && !input.promptOnlyMode && !listOnly) {
      const scopedNow = input.instructionConstraints?.mode === "scoped"
        || input.analysisDepth?.scopedFocus === true;
      if (scopedNow) {
        this.conversation.appendUser(buildDepthReportGuide(depthProfile));
      } else {
        this.conversation.appendUser([
          buildDepthReportGuide(depthProfile),
          "CEREBRO: opcional UNA vez brain_skill deep-project-analysis (si existe) o brain_search sobre analisis de proyectos; si falla la skill, IGNORALA y sigue solo con disco.",
          "CACHE: no repitas list_files/read_file/search_files identicos; reutiliza hits.",
        ].join("\n"));
      }

      // FASE 1 — Razonamiento explícito obligatorio antes de tools.
      const reasoningPhase = this.buildReasoningPhase(input);
      if (reasoningPhase) {
        this.conversation.appendUser(reasoningPhase);
        this.requiresReasoningBlock = true;
      }
    }

    try {
      let modelIterations = 0;
      let lastHarnessStrategy = "";
      let forceReportNudged = false;
      for (let i = 0; i < effectiveMaxIterations; i++) {
        modelIterations = i + 1;
        this.harnessProfile = resolveHarnessProfile(depthProfile, this.adaptiveBudget, {
          analysisMode: input.analysisMode === true,
        });
        if (this.conversation && this.harnessProfile?.conversation) {
          this.conversation.maxChars = Number(this.harnessProfile.conversation.maxChars) || this.conversation.maxChars;
          this.conversation.keepLastTurns = Number(this.harnessProfile.conversation.keepLastTurns) || this.conversation.keepLastTurns;
        }
        const strategyNow = String(this.harnessProfile?.strategy || "");
        // Solo una vez por cambio de estrategia (si no, hincha el contexto y el modelo se congela).
        if (input.analysisMode === true && strategyNow && strategyNow !== lastHarnessStrategy) {
          lastHarnessStrategy = strategyNow;
          const harnessNudge = buildHarnessSystemNudge(this.harnessProfile);
          if (harnessNudge) this.conversation.appendUser(harnessNudge);
        }
        if (
          input.analysisMode === true
          && !forceReportNudged
          && this.adaptiveBudget?.shouldForceReport?.()
          && steps.length >= 4
        ) {
          forceReportNudged = true;
          this.forceTextOnlyClose = true;
          this.conversation.appendUser(
            "HARNESS: presupuesto critico. Escribe YA el reporte final con evidencia acumulada. PROHIBIDO mas herramientas."
          );
        }
        // Anti-cuelgue: si se atasco en ROADMAP o en el mismo read fallido, forzar reporte.
        const recent = steps.slice(-6);
        const roadmapStuck = recent.filter((s) => /ROADMAP/i.test(String(s?.input?.path || ""))).length >= 2;
        const sameFail = recent.length >= 3
          && recent.every((s) => s?.name === recent[0]?.name
            && String(s?.input?.path || "") === String(recent[0]?.input?.path || "")
            && s?.ok === false);
        if (input.analysisMode === true && (roadmapStuck || sameFail) && !forceReportNudged) {
          forceReportNudged = true;
          this.forceTextOnlyClose = true;
          this.conversation.appendUser(
            "EDITCORE: Bucle detectado (lectura ROADMAP o path repetido). Deja ROADMAP al sistema. Escribe YA el reporte con evidencia de codigo ya reunida."
          );
        }
        let userStopped = false;
        if (Array.isArray(input.steering) && input.steering.length) {
          const directions = input.steering.splice(0, input.steering.length);
          for (const direction of directions) {
            const instruction = String(direction?.instruction || "").trim();
            if (!instruction) continue;
            if (isUserStopInstruction(instruction)) {
              userStopped = true;
              stopReason = "Detenido por el usuario.";
              break;
            }
            const steerPlan = resolveUnifiedAgentPlan({
              prompt: input.prompt,
              steeringInstruction: instruction,
              requestedAgent: true,
              projectOpen: Boolean(input.projectRoot),
              allowWrite: input.allowWrite === true,
              permissionMode: input.permissionMode,
              planAuthorizedExecution: input.planAuthorized === true,
              authorizedContinuation: input.planAuthorized === true,
              hasAttachments: false,
            });
            applyRunProfile(input, steerPlan.runProfile);
            input.orchestratorPlan = steerPlan;
            input.prompt = instruction;
            input.runProfile = steerPlan.runProfile;
            this.conversation.appendUser(`NUEVA INSTRUCCION DEL USUARIO (prioritaria): ${instruction}`);
            if (steerPlan.runProfile.orchestrationBlock) {
              this.conversation.appendUser(steerPlan.runProfile.orchestrationBlock);
            }
            input.onProgress?.({ phase: "direction", stage: this.stageForSteps(steps), index: steps.length, text: instruction });
          }
        }
        if (userStopped) break;
        if (input.signal?.aborted) {
          stopReason = String(input.signal.reason?.message || input.signal.reason || "Ejecucion cancelada.");
          break;
        }
        // El presupuesto economico lo gobierna el proveedor de modelos. Este contador
        // es telemetria y nunca detiene una tarea localmente.

        // Detectar loops
        if (this.detectLoop(steps)) {
          stopReason = "Loop detectado - misma secuencia de acciones";
          // Analisis: no tirar 139 pasos a la basura — cerrar con reporte grounded si hay evidencia.
          if (input.analysisMode === true) {
            const evidence = this.collectRunEvidence(steps);
            const opts = this.analysisSufficiencyOpts(input);
            if (analysisEvidenceSufficient(evidence, opts).ok
              || (evidence.filesRead || []).filter((row) => !isDocNoisePath(row.path)).length >= 4) {
              completed = true;
              finalText = this.finalizeAnalysisOnce(input, steps, "");
              stopReason = "Analisis cerrado tras loop: reporte anclado a evidencia real (sin repetir lecturas).";
            }
          }
          break;
        }
        if (this.wastedRepeats >= 3) {
          stopReason = "El modelo repitió demasiadas acciones sin avanzar; se cierra con la evidencia acumulada para no gastar más tokens.";
          break;
        }

        if (shouldCloseAfterVerifiedWork({
          prompt: input.prompt,
          allowWrite: input.allowWrite === true,
          analysisMode: input.analysisMode === true,
          steps,
          uiOneShot: input.runProfile?.uiOneShot === true || input.orchestratorPlan?.uiOneShot === true,
        })) {
          if (this.verifiedCloseArmed) {
            completed = true;
            finalText = this.finalizeExecutionText(input, steps, finalText || this.evidenceFinalText(input, steps));
            stopReason = "Cerrado tras cambios y verificacion. Publicar no estaba pedido.";
            this.logger.log(`✓ [Claude Code] Cierre automatico post-verificacion: ${steps.length} pasos`);
            break;
          }
          this.verifiedCloseArmed = true;
          this.forceTextOnlyClose = true;
          this.conversation.appendUser("Cambios y verificacion ya estan hechos. NO uses herramientas. NO publiques ni conectes servicios. Escribe un resumen breve y cierra.");
        }

        // Early-exit por evidencia SOLO en corridas de solo lectura: en una
        // tarea con escritura autorizada ("procede", "instala", "corrige") el
        // modelo decide cuando terminar; adelantarse tras N lecturas dejaba
        // tareas a medias. El rescate post-bucle sigue cubriendo el caso en el
        // que el proveedor deja de responder sin emitir un final.
        // En analisis el modelo decide cuando dejar de explorar; el reporte
        // se fuerza solo al cierre (sin herramientas) o post-bucle.
        if (input.allowWrite === false && input.analysisMode !== true && this.canCompleteFromEvidence(input, requirements, steps)) {
          // BUG 1 FIX: No cerrar con texto genérico. Pedir al modelo que genere
          // el reporte final. Solo usar evidenceFinalText como último recurso.
          if (!this.reportPromptSent && i < effectiveMaxIterations - 2) {
            this.reportPromptSent = true;
            this.conversation.appendUser("Has acumulado evidencia suficiente del proyecto. Escribe ahora el REPORTE FINAL completo en markdown. Incluye: ## Resumen del proyecto, ## Problemas encontrados, ## Recomendaciones concretas. NO llames más herramientas. Responde en español sin pegar código fuente.");
            continue;
          }
          completed = true;
          finalText = this.evidenceFinalText(input, steps);
          stopReason = "Completado por evidencia acumulada antes de consumir mas llamadas del proveedor.";
          break;
        }

        // Obtener siguiente turno del modelo (texto narrativo + tool calls)
        let turn;
        const forcedTextOnlyThisTurn = this.forceTextOnlyClose === true || input.forceTextOnlyClose === true;
        try {
          const workerDeathErr = typeof input.pullWorkerDeathError === "function" ? input.pullWorkerDeathError() : null;
          if (workerDeathErr) throw workerDeathErr;
          input.onProgress?.({ phase: "model", text: steps.length ? "Siguiente paso…" : "Trabajando…", stage: this.stageForSteps(steps), index: steps.length });
          turn = await this.getNextTurn(input, steps);
          this._malformedJsonRetries = 0;
        } catch (apiError) {
          if (apiError?.code === "EXECUTION_INVALIDATED") throw apiError;
          if (apiError?.code === "WORKER_STALLED" && i < effectiveMaxIterations - 1) {
            continue;
          }
          if (apiError?.code === "AGENT_STEER") {
            if (i < effectiveMaxIterations - 1) continue;
          }
          if (apiError?.code === "WORKER_DEAD") {
            input.pullWorkerDeathError?.();
          }
          if (input.failover && input.failover.handleFailure) {
            const completedStepNames = steps.filter((step) => step.ok !== false).map((step) => step.name);
            const failoverResult = await input.failover.handleFailure(apiError, {
              steps,
              completedSteps: completedStepNames,
              pendingSteps: [],
              currentStage: this.stageForSteps(steps),
              partialResult: finalText,
              modifiedFiles: steps.filter((step) => step.name === "write_file" && step.ok !== false).map((step) => step.input?.path).filter(Boolean),
            });
            if (failoverResult.action === "retry_same_model") {
              await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * (failoverResult.retryCount || 1), 4000)));
              continue;
            }
            if (failoverResult.action === "failover" || failoverResult.action === "duplicate_failover") {
              input.failover.applyProfileToInput(input, failoverResult.profile);
              input.failover.markExecutionResumed(failoverResult.profile);
              input.resetWorkerHealth?.();
              // Silencioso: el chat no anuncia cambio de modelo; solo sigue trabajando.
              input.onProgress?.({
                phase: "model",
                text: "Trabajando…",
                silentFailover: true,
                fromModel: failoverResult.fromModel || "",
                toModel: failoverResult.profile?.model || "",
              });
              continue;
            }
            if (failoverResult.action === "waiting_for_provider") {
              stopReason = "No hay proveedores compatibles disponibles; la tarea quedó en espera de un modelo compatible.";
              input.failoverWaiting = true;
              break;
            }
            if (failoverResult.action === "task_error") {
              throw failoverResult.error || apiError;
            }
          }
          if (this.hasValidatedTaskEvidence(input, steps)) {
            if (input.analysisMode === true) {
              try {
                const drafted = await this.requestAnalysisReport(input, steps);
                if (this.analysisHasModelInvestigation(drafted)) {
                  completed = true;
                  finalText = this.finalizeAnalysisOnce(input, steps, drafted);
                  stopReason = "Reporte del modelo tras fallo temporal del proveedor.";
                  break;
                }
              } catch (_) { /* post-bucle forzara investigacion */ }
              // NO cerrar con plantilla: el post-bucle exige turnos reales del modelo.
              stopReason = "Proveedor fallo; se forzara investigacion del modelo al cierre.";
              break;
            } else {
              completed = true;
              finalText = this.finalizeExecutionText(input, steps, this.evidenceFinalText(input, steps));
              stopReason = "Completado por evidencia validada aunque el proveedor dejo de responder.";
              break;
            }
          }
          if (apiError?.code === "PROVIDER_EMPTY") {
            stopReason = "El proveedor dejo de responder; se cierra con la evidencia acumulada.";
            break;
          }
          const status = apiError?.status || 0;
          const msg = String(apiError?.message || "");
          const isProviderTimeout = apiError?.code === "PROVIDER_TIMEOUT"
            || /timeout|timed out|sin tokens nuevos|sin respuesta completa|Timeout duro/i.test(msg);
          // Analisis: si el modelo se cuelga al redactar, NO reintentar 3x (parece "Redactando..." eterno).
          if (isProviderTimeout && input.analysisMode === true) {
            const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
            const toolOk = steps.filter((step) => step.ok === true && ["list_files", "read_file", "search_files"].includes(String(step.name || ""))).length;
            const enough = analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok || toolOk >= 5;
            if (enough && this.providerCalls >= 1) {
              input.onProgress?.({ phase: "model", text: "Modelo colgado: pidiendo informe con evidencia ya reunida..." });
              let drafted = "";
              try {
                drafted = await this.requestAnalysisReport(input, steps, { appendPrompt: !this.reportPromptSent });
                this.reportPromptSent = true;
              } catch (_) { /* fallback */ }
              if (this.analysisHasModelInvestigation(drafted || finalText)) {
                completed = true;
                finalText = this.finalizeAnalysisOnce(input, steps, drafted || finalText || "");
                stopReason = "Proveedor timeout: informe tras investigacion parcial.";
                break;
              }
            }
            // Sin investigacion del modelo: salir del loop y forzar en post-bucle.
            stopReason = "Timeout del modelo; se reintentara investigacion al cierre.";
            break;
          }
          const isMalformedToolJson = apiError?.code === "MALFORMED_TOOL_JSON"
            || /unexpected token|json\.parse|invalid json|malformed/i.test(msg);
          // JSON roto: hasta 2 reintentos con corrección antes de fallar.
          // En cada reintento le pedimos al modelo que responda en texto plano
          // sin usar herramientas para evitar que vuelva a generar JSON corrupto.
          if (isMalformedToolJson) {
            this._malformedJsonRetries = Number(this._malformedJsonRetries || 0) + 1;
            this.logger.warn(`⚠️ [API] JSON de herramienta mal formado (intento ${this._malformedJsonRetries}/2); forzando failover si persiste: ${msg}`);
            if (this._malformedJsonRetries < 3 && i < effectiveMaxIterations - 1) {
              // Inyectar mensaje de autocorrección: pedir respuesta en texto sin tools
              this.conversation.appendUser(
                "EDITCORE AUTOCORRECCIÓN: Tu última respuesta contenía JSON de herramienta mal formado. " +
                "Responde ahora con texto plano en español describiendo qué necesitas hacer a continuación. " +
                "NO uses tool_calls ni function_call. Solo texto narrativo."
              );
              this.logger.warn(`⚠️ [API] Reintentando con corrección (intento ${this._malformedJsonRetries})...`);
              continue;
            }
            apiError.code = apiError.code || "MALFORMED_TOOL_JSON";
            throw apiError;
          }
          const isGatewayTimeout = status === 524
            || apiError?.code === "PROVIDER_GATEWAY_TIMEOUT"
            || /gateway time-?out|cloudflare|tard[oó] demasiado|API 524|<!DOCTYPE\s+html/i.test(msg);
          const isRetryable = [429, 500, 502, 503, 504, 524].includes(status) ||
            apiError?.code === "PROVIDER_TIMEOUT" ||
            apiError?.code === "PROVIDER_GATEWAY_TIMEOUT" ||
            /timeout|timed out|network|fetch failed|socket|aborted|AbortError|sin respuesta completa|gateway time-?out|cloudflare/i.test(msg);
          if (isGatewayTimeout) {
            const userMsg = "La respuesta tardó demasiado tiempo. Intenta reducir el alcance de la solicitud.";
            input.onProgress?.({ phase: "model", text: userMsg });
            this.conversation.appendUser(`VALIDACION DE EDITCORE: ${userMsg}`);
            if (isRetryable && i < effectiveMaxIterations - 1) {
              this.logger.warn(`⚠️ [API] Gateway timeout 524. Reintentando con alcance reducido...`);
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            throw Object.assign(new Error(userMsg), {
              status: 524,
              code: "PROVIDER_GATEWAY_TIMEOUT",
            });
          }
          if (isRetryable && i < effectiveMaxIterations - 1) {
            this.logger.warn(`⚠️ [API] Error retryable (${status}): ${apiError.message}. Reintentando en 3s...`);
            this.conversation.appendUser(
              "VALIDACION DE EDITCORE: Error temporal del proveedor. Reintenta la misma accion con tool_calls validos."
            );
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          throw apiError;
        }

        if (forcedTextOnlyThisTurn) {
          this.forceTextOnlyClose = false;
          input.forceTextOnlyClose = false;
        }

        // BUG 4 FIX: Si el modelo devolvió texto sin herramientas y el contexto es muy
        // grande (>60k chars), es probable overflow de ventana. Compactar agresivamente
        // y reintentar para que el modelo trabaje con contexto reducido.
        const ctxLen = this.conversation.serializedLength();
        if (!turn.toolCalls?.length && turn.text && steps.length > 4 && ctxLen > 60_000 && i < effectiveMaxIterations - 3 && !this.reportPromptSent) {
          const prevMax = this.conversation.maxChars;
          this.conversation.maxChars = Math.max(25_000, Math.floor(ctxLen * 0.35));
          const didCompact = this.conversation.compact();
          this.conversation.maxChars = prevMax;
          if (didCompact) {
            this.logger.warn(`⚠️ [Context] Compactación de emergencia: ${ctxLen} → ${this.conversation.serializedLength()} chars. Contexto probablemente excedía ventana del proveedor.`);
            const evidence = this.collectRunEvidence(steps);
            this.conversation.setEvidencePreservationBlock(formatEvidencePreservationBlock(evidence, this.runScope));
            this.conversation.appendUser([
              formatEvidencePreservationBlock(evidence),
              "EditCore compactó el historial por tamaño de contexto. El REPORTE FINAL debe derivarse SOLO del evidence ledger anterior; PROHIBIDO contradecir read_file exitosos.",
            ].join("\n\n"));
            continue;
          }
        }

        // Resolver las acciones del turno: tool_calls nativos o protocolo JSON.
        const actions = [];
        let finalAction = null;
        const nativeCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
        const plainActions = nativeCalls.length ? [] : extractPlainToolCalls(turn.text);
        const storedText = plainActions.length ? narrationWithoutToolCalls(turn.text) : turn.text;
        const registeredCalls = this.conversation.appendAssistant({ text: storedText, toolCalls: nativeCalls });
        if (registeredCalls.length) {
          for (const call of registeredCalls) {
            const action = providerToolCallAction(call);
            if (action?.type === "tool" && action.name) actions.push({ ...action, callId: call.id });
            else this.conversation.appendToolResult(call.id, call.function?.name || "tool", { error: "EditCore no pudo interpretar esta llamada; repite la accion con argumentos JSON validos." });
          }
        } else if (plainActions.length) {
          actions.push(...plainActions.map((action) => ({ ...action, callId: null })));
        } else {
          const parsed = this.parseModelResponse(turn);
          if (parsed?.type === "tool" && parsed.name) actions.push({ ...parsed, callId: null });
          else finalAction = parsed;
        }
        const narration = plainActions.length ? narrationWithoutToolCalls(turn.text) : String(turn.text || "").trim();

        // FASE 1 enforcement: si requiere razonamiento y el modelo saltó directo
        // a tool calls sin escribir el bloque, dar 1 aviso y continuar.
        if (this.requiresReasoningBlock === true && actions.length > 0) {
          this.requiresReasoningBlock = false;
        }

        if (input.analysisMode === true && actions.length > 0 && narration) {
          const asksAuth = /Cuando autorices procedo|cuando autorices[,:]?\s*procedo|escribe\s*\*?\*?procede/i.test(narration);
          if (asksAuth && reportLooksComplete(narration)) {
            for (const action of actions) {
              if (action.callId) {
                this.conversation.appendToolResult(action.callId, action.name, {
                  note: "Analisis concluido con solicitud de autorizacion.",
                });
              }
            }
            actions.length = 0;
            completed = true;
            finalText = this.finalizeAnalysisOnce(input, steps, narration);
            stopReason = "Analisis completado esperando autorizacion del usuario.";
            break;
          }
        }

        const narrationTrack = narration ? this.trackNarrationEmission(narration) : { emit: false, duplicate: false };
        const writeExecution = input.allowWrite === true && input.analysisMode !== true && input.listOnly !== true;
        const listOnlyDone = input.listOnly === true && steps.some((step) => step.name === "list_files" && step.ok === true);
        const simulatedNarration = narration
          && narrationLooksLikeSimulatedWork(narration, steps, input.projectRoot || "", { requiresWrite: writeExecution });

        // HARD STOP: el modelo dice que write_file no esta expuesto.
        // En ANALISIS eso es NORMAL (solo lectura): NO cerrar la corrida.
        // En EJECUCION: si no hay write → cerrar; si hay → corregir 1 vez.
        if (narration && narrationClaimsWriteToolsMissing(narration)) {
          const exposed = this.getAvailableTools(input);
          const hasWrite = toolsIncludeWrite(exposed);
          if (!hasWrite || writeExecution !== true) {
            if (narrationTrack.emit) {
              input.onProgress?.({
                phase: "narration_delta",
                stage: this.stageForSteps(steps),
                index: steps.length,
                text: narration,
              });
            }
            for (const action of actions) {
              if (action.callId) {
                this.conversation.appendToolResult(action.callId, action.name, {
                  error: "EditCore cerro la corrida: no hay herramientas de escritura en esta sesion.",
                });
              }
            }
            completed = false;
            finalText = [
              "## Escritura no disponible en esta sesión",
              "",
              "En este turno no estaban expuestas `write_file` / `replace_in_file` (modo analisis, solo lectura o FOCO de lectura).",
              "Activa **Paso a paso** o **Acceso completo**, escribe **PROCEDE** y reintenta la correccion.",
              "",
              "No se modifico ningun archivo.",
            ].join("\n");
            stopReason = "Escritura no expuesta: se detiene para no quemar tokens.";
            this.logger.warn("⏹ [Claude Code] Stop: write tools no expuestas (anti-bucle tokens)");
            break;
          }
          if (!this.writeToolsMissingNudgeSent && i < effectiveMaxIterations - 1) {
            this.writeToolsMissingNudgeSent = true;
            this.conversation.appendUser(
              "VALIDACION DE EDITCORE: FALSO. `write_file` y `replace_in_file` SI estan en las herramientas de esta sesion. "
              + "Emite AHORA un tool_call real de write_file o replace_in_file. PROHIBIDO afirmar que no estan expuestas.",
            );
            input.onProgress?.({ phase: "model", text: "Herramientas de escritura SI disponibles. Reintentando..." });
            continue;
          }
          completed = false;
          finalText = [
            "## No se pudo escribir",
            "",
            "Las herramientas de escritura estaban disponibles pero el modelo no las uso tras la correccion.",
            "Escribe **PROCEDE** de nuevo para reintentar.",
          ].join("\n");
          stopReason = "Modelo insistio en que no hay herramientas de escritura pese a estar expuesto.";
          break;
        }

        if (narration && !AGENT_PROTOCOL_PATTERN.test(narration) && actions.length) {
          if (narrationTrack.emit && !simulatedNarration) {
            input.onProgress?.({ phase: "narration", stage: this.stageForSteps(steps), index: steps.length, text: narration });
          }
        } else if (narration && !actions.length && !AGENT_PROTOCOL_PATTERN.test(narration)) {
          const invented = input.analysisMode === true
            && narrationLooksLikeInventedAnalysis(narration, steps, input.projectRoot || "");
          const promptEcho = looksLikePromptEcho(input.prompt || input.originalGoal || "", narration)
            || looksLikePromptEcho(input.activeInstruction || "", narration);
          const prematureReport = input.analysisMode === true
            && reportLooksComplete(narration)
            && !analysisEvidenceSufficient(this.collectRunEvidence(steps, input.projectRoot || ""), this.analysisSufficiencyOpts(input)).ok;
          const missingToolsClaim = !input.promptOnlyMode && narrationClaimsMissingTools(narration);
          if (promptEcho) {
            this.conversation.appendUser(
              "EDITCORE: Prohibido repetir el prompt del usuario como respuesta. Explora con herramientas y entrega un informe real con secciones, o ejecuta la tarea."
            );
            continue;
          }
          if (listOnlyDone) {
            // El agente ya listo: su texto ES la respuesta final (no exigir write_file).
            let answer = narration;
            if (looksLikeForensicListDrift(answer)) {
              answer = formatListOnlyAnswerFromSteps(steps, input.projectRoot || "", input.prompt || "") || answer;
            }
            if (narrationTrack.emit && !reportBlocksRepetition(answer)) {
              input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: answer });
            }
            completed = true;
            finalText = answer;
            stopReason = "Listado entregado por el agente.";
            break;
          } else if (input.promptOnlyMode) {
            if (narrationTrack.emit && !reportBlocksRepetition(narration)) {
              input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: narration });
            }
          } else if (simulatedNarration || invented || prematureReport || missingToolsClaim) {
            input.onProgress?.({
              phase: "model",
              text: simulatedNarration
                ? "Sin herramientas reales todavia. Esperando write_file o run_command..."
                : missingToolsClaim
                  ? "Acceso al proyecto SI disponible. Continuando con herramientas reales..."
                  : "Narracion sin evidencia descartada. Continuando con archivos reales del proyecto...",
            });
            if (missingToolsClaim && i < effectiveMaxIterations - 1) {
              this.conversation.appendUser(
                writeExecution
                  ? "VALIDACION DE EDITCORE: FALSO. SI tienes acceso al sistema de archivos del proyecto abierto (list_files, read_file, write_file, replace_in_file). PROHIBIDO decir que no tienes acceso o que no puedes continuar. Ejecuta write_file o replace_in_file AHORA."
                  : "VALIDACION DE EDITCORE: FALSO. SI tienes list_files, read_file y search_files. PROHIBIDO decir que no tienes acceso. Ejecuta list_files/read_file AHORA."
              );
              continue;
            }
            if (simulatedNarration && i < effectiveMaxIterations - 1) {
              this.conversation.appendUser("EDITCORE: PROHIBIDO simular creacion o cambios. Usa write_file/replace_in_file/run_command con resultado real. Sin herramienta exitosa no hay progreso ni texto de exito.");
              continue;
            }
          } else if (writeExecution) {
            input.onProgress?.({ phase: "model", text: "Esperando accion real con herramientas..." });
            if (i < effectiveMaxIterations - 1) {
              const claimsNoChannel = /no hay (?:canal|herramientas)|no existe un canal|sin herramientas invocables|solo texto/i.test(narration);
              this.conversation.appendUser(
                claimsNoChannel
                  ? "EDITCORE: FALSO. El canal SI existe. Emite write_file AHORA via tool_calls. No escribas un informe de fallo sin ejecutar la herramienta."
                  : "EDITCORE: En modo ejecucion no narres trabajo ficticio. Emite write_file o replace_in_file AHORA."
              );
              continue;
            }
          } else if (narrationTrack.emit && !reportBlocksRepetition(narration)) {
            input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: narration });
          }
        }

        if (!actions.length) {
          finalText = String(finalAction?.text || "").trim() || narration;
          this.consecutiveNoToolTurns += 1;

          if (listOnlyDone && finalText) {
            if (looksLikeForensicListDrift(finalText)) {
              finalText = formatListOnlyAnswerFromSteps(steps, input.projectRoot || "", input.prompt || "") || finalText;
            }
            completed = true;
            stopReason = "Listado entregado por el agente.";
            break;
          }

          // Hard stop: dos turnos seguidos sin herramientas = bucle de narracion.
          if (this.consecutiveNoToolTurns >= 2 && finalText) {
            if (!this.forcedToolAfterNoToolStop && i < effectiveMaxIterations - 1 && input.listOnly !== true) {
              this.forcedToolAfterNoToolStop = true;
              this.consecutiveNoToolTurns = 0;
              const claimsNoChannel = /no hay (?:canal|herramientas)|no existe un canal|sin herramientas invocables|solo texto/i.test(finalText);
              this.conversation.appendUser(
                writeExecution || claimsNoChannel
                  ? "EDITCORE: FALSO. SI hay canal de herramientas. Emite write_file AHORA con tool_calls reales (path + content). PROHIBIDO narrar que no hay canal o que falló sin ejecutar la herramienta."
                  : "EDITCORE: Respuesta sin tool_calls reales. PROHIBIDO narrar. "
                    + "Ejecuta ahora al menos un tool real (list_files/read_file/search_files) "
                    + "y continua SOLO con evidencia."
              );
              continue;
            }
            if (input.analysisMode === true) {
              const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
              const sufficiencyOpts = this.analysisSufficiencyOpts(input);
              const codeReads = Number(evidence.realFileReadCount || (evidence.filesRead || []).length || 0);
              const hasRealReads = codeReads >= 2 || (evidence.filesRead || []).length >= 2;
              // Con muchas lecturas reales, cerrar con reporte aunque el modelo deje de usar tools
              if (analysisEvidenceSufficient(evidence, sufficiencyOpts).ok || hasRealReads || codeReads >= 8 || steps.filter((s) => s.ok !== false).length >= 12) {
                completed = true;
                const safeFinal = reportLooksComplete(finalText) && !narrationLooksLikeInventedAnalysis(finalText, steps, input.projectRoot || "") && !narrationClaimsMissingTools(finalText) ? finalText : "";
                finalText = this.finalizeAnalysisOnce(input, steps, safeFinal);
                stopReason = "Analisis cerrado con evidencia real de lecturas (el modelo dejo de usar herramientas).";
              } else {
                completed = false;
                stopReason = "El modelo repitio respuestas sin herramientas; se detiene para evitar gasto de tokens.";
              }
            } else {
              completed = false;
              stopReason = "El modelo repitio el mismo reporte sin ejecutar herramientas.";
              const execReport = buildExecutionEvidenceReport(finalText, steps, input.projectRoot || "", this.executionEvidenceOptions(input));
              finalText = execReport.text || finalText;
            }
            break;
          }

          // Cortar bucle de tokens: misma respuesta repetida o reporte ya mostrado.
          if (finalText && (narrationTrack.duplicate || (reportBlocksRepetition(finalText) && this.duplicateNarrationCount >= 1))) {
            if (input.analysisMode === true) {
              const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
              const sufficiencyOpts = this.analysisSufficiencyOpts(input);
              const codeReads = Number(evidence.realFileReadCount || (evidence.filesRead || []).length || 0);
              const hasRealReads = codeReads >= 2 || (evidence.filesRead || []).length >= 2;
              if (analysisEvidenceSufficient(evidence, sufficiencyOpts).ok || hasRealReads) {
                completed = true;
                const safeFinal = reportLooksComplete(finalText) && !narrationLooksLikeInventedAnalysis(finalText, steps, input.projectRoot || "") && !narrationClaimsMissingTools(finalText) ? finalText : "";
                finalText = this.finalizeAnalysisOnce(input, steps, safeFinal);
                stopReason = "Analisis cerrado: el modelo repitio la misma respuesta con evidencia suficiente.";
              } else {
                completed = false;
                stopReason = "El modelo repitio la misma respuesta sin nueva evidencia.";
              }
            } else {
              completed = false;
              stopReason = "El modelo repitio el mismo reporte sin ejecutar herramientas.";
              const execReport = buildExecutionEvidenceReport(finalText, steps, input.projectRoot || "", this.executionEvidenceOptions(input));
              finalText = execReport.text || finalText;
            }
            break;
          }

          // Analisis: evidencia suficiente + respuesta sin herramientas → cerrar ya (no exigir formato perfecto).
          if (input.analysisMode === true && finalText) {
            const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
            const sufficiencyOpts = this.analysisSufficiencyOpts(input);
            const codeReads = Number(evidence.realFileReadCount || (evidence.filesRead || []).length || 0);
            const hasRealReads = codeReads >= 2 || (evidence.filesRead || []).length >= 2;
            if (analysisEvidenceSufficient(evidence, sufficiencyOpts).ok || hasRealReads) {
              completed = true;
              const safeFinal = reportLooksComplete(finalText) && !narrationLooksLikeInventedAnalysis(finalText, steps, input.projectRoot || "") && !narrationClaimsMissingTools(finalText) ? finalText : "";
              finalText = this.finalizeAnalysisOnce(input, steps, safeFinal);
              stopReason = "Analisis cerrado con evidencia suficiente.";
              break;
            }
          }

          if (finalText && narrationAsksUserForRoadmap(finalText) && i < effectiveMaxIterations - 1) {
            this.conversation.appendUser(
              input.analysisMode === true
                ? "VALIDACION DE EDITCORE: No pidas el ROADMAP al usuario. Continua con list_files/read_file y entrega el reporte. EditCore actualiza ROADMAP.md solo (indice); TU no lo crees con write_file en este turno de analisis."
                : "VALIDACION DE EDITCORE: PROHIBIDO pedir el ROADMAP al usuario. Analiza el disco (list_files/read_file). En ejecucion puedes crear/actualizar ROADMAP.md; en analisis EditCore lo sincroniza solo."
            );
            input.onProgress?.({
              phase: "model",
              text: input.analysisMode === true
                ? "Redactando reporte con evidencia real..."
                : "El ROADMAP se crea al analizar el proyecto, no se pide al usuario...",
            });
            continue;
          }

          // Tras PROCEDE: narrar "ACCIÓN 1" o inventar "sin acceso" sin herramientas NO cuenta como progreso.
          if (input.planAuthorized === true && input.allowWrite === true && input.analysisMode !== true
            && !hasMutationEvidence(steps)) {
            if (i < effectiveMaxIterations - 1) {
              const claim = narrationClaimsMissingTools(finalText || String(finalAction?.text || ""));
              this.conversation.appendUser(claim
                ? "VALIDACION DE EDITCORE: FALSO. SI tienes acceso al disco del proyecto abierto. PROHIBIDO abandonar. Ejecuta ahora replace_in_file o write_file."
                : "VALIDACION DE EDITCORE: El usuario ya autorizo. PROHIBIDO solo narrar correcciones. Ejecuta ahora replace_in_file o write_file sobre archivos del plan, luego verifica. Sin mutacion real no hay avance.");
              continue;
            }
            completed = false;
            stopReason = "La ejecucion autorizada termino sin mutacion real (solo narracion).";
            finalText = finalText || String(finalAction?.text || "").trim();
            if (narrationClaimsMissingTools(finalText)) {
              finalText = [
                "EditCore SI tiene acceso al proyecto abierto (`list_files`, `read_file`, `write_file`, `replace_in_file`).",
                "La corrida se detuvo sin mutacion real porque el modelo narro un falso bloqueo de acceso.",
                "Escribe **PROCEDE** para continuar con cambios reales en disco.",
              ].join("\n");
            }
            break;
          }
          if (input.planAuthorized === true && input.allowWrite === true && input.analysisMode !== true
            && hasNarrationOnlyClaim(finalText) && !hasMutationEvidence(steps)) {
            completed = false;
            stopReason = "Narracion de correccion sin tool call de escritura.";
            break;
          }

          // Analisis: rechazar narracion que contradice read_file exitosos.
          if (input.analysisMode === true && finalText) {
            const evidence = collectToolEvidence(steps, input.projectRoot || "", this.runScope);
            const contradiction = detectContradictoryEvidence(finalText, evidence);
            if (!contradiction.ok && analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok) {
              completed = true;
              finalText = buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
              stopReason = "Reporte anclado a evidencia real (narracion contradecia read_file exitosos).";
              break;
            }
          }

          // Analisis: rechazar inventos; si ya hay evidencia real, cerrar con reporte anclado.
          if (input.analysisMode === true && finalText
            && narrationLooksLikeInventedAnalysis(finalText, steps, input.projectRoot || "")) {
            const evidence = collectToolEvidence(steps, input.projectRoot || "", this.runScope);
            if (analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok) {
              completed = true;
              finalText = buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
              stopReason = "Reporte anclado a evidencia real (se descarto narracion inventada).";
              break;
            }
            if (i < effectiveMaxIterations - 1) {
              this.conversation.appendUser(
                "VALIDACION DE EDITCORE: Tu narracion inventa un stack/archivos que NO salieron de list_files/read_file (ej. Vite/App.jsx). "
                + "PROHIBIDO inventar. Usa list_files en la raiz y en src/, luego read_file solo de paths reales (package.json, next.config.js, etc.). "
                + "No escribas el reporte hasta tener evidencia real."
              );
              input.onProgress?.({
                phase: "model",
                text: "Narracion inventada descartada. Leyendo archivos reales del proyecto...",
              });
              continue;
            }
            completed = false;
            stopReason = "El analisis narro un stack inventado sin evidencia de herramientas.";
            finalText = "";
            break;
          }

          // Nunca abandonar pidiendo que el usuario pegue archivos: tools existen o se piden permisos.
          if (input.analysisMode === true && finalText && narrationClaimsMissingTools(finalText)) {
            input.onProgress?.({
              phase: "model",
              text: "Las herramientas de lectura SI existen. Completando evidencia real...",
            });
            const filled = await this.ensureAnalysisEvidenceReads(input, steps);
            const evidence = collectToolEvidence(steps, input.projectRoot || "", this.runScope);
            if (filled || analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok) {
              completed = true;
              finalText = buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
              stopReason = "Reporte anclado tras completar lecturas reales (se rechazo abandono sin tools).";
              break;
            }
            const hasWorkingList = steps.some((step) => step.name === "list_files" && step.ok === true);
            if (!hasWorkingList) {
              completed = false;
              stopReason = "PERMISSION_REQUIRED";
              finalText = [
                "## Permiso requerido",
                "",
                "Necesito permiso de lectura del proyecto (`list_files` / `read_file`) para continuar el analisis.",
                "En el boton **Permisos**, elige **Solo lectura**, **Permisos** o **Acceso completo**, y escribe **ADELANTE**.",
                "No abandono la tarea: cuando autorices el acceso, retomo desde la evidencia ya acumulada.",
              ].join("\n");
              input.onProgress?.({
                phase: "permission_required",
                text: "Activa Permisos/Acceso completo y escribe ADELANTE para continuar.",
              });
              break;
            }
            if (i < effectiveMaxIterations - 1) {
              this.conversation.appendUser(
                "VALIDACION DE EDITCORE: FALSO. SI tienes list_files, read_file y search_files en este entorno. "
                + "PROHIBIDO pedir al usuario que pegue archivos. Ejecuta list_files/read_file AHORA o escribe el REPORTE FINAL con la evidencia ya precargada."
              );
              continue;
            }
          }

          const isEmptyProviderTurn = !finalText || finalText === EMPTY_PROVIDER_FALLBACK;
          if (isEmptyProviderTurn && !nativeCalls.length && !plainActions.length && i < effectiveMaxIterations - 1) {
            emptyResponseRetries += 1;
            if (emptyResponseRetries <= 2) {
              this.logger.warn(`⚠️ [API] Respuesta vacia del proveedor (intento ${emptyResponseRetries}). Reintentando...`);
              const nudge = input.planAuthorized === true
                ? "EDITCORE: El proveedor devolvio respuesta vacia. Ejecuta replace_in_file AHORA en los archivos del plan autorizado. No respondas en silencio."
                : input.analysisMode === true
                  ? "EDITCORE: El proveedor devolvio respuesta vacia. Usa herramientas o escribe el REPORTE FINAL en markdown."
                  : "EDITCORE: El proveedor devolvio respuesta vacia. Responde con una herramienta (read_file, replace_in_file) o un mensaje util.";
              this.conversation.appendUser(nudge);
              continue;
            }
          }

          if (input.analysisMode === true && finalText && !reportLooksComplete(finalText)
            && !this.reportPromptSent && i < effectiveMaxIterations - 2
            && !steps.some((step) => step.ok === false)) {
            this.reportPromptSent = true;
            this.forceTextOnlyClose = true;
            this.conversation.appendUser(analysisReportPromptForEvidence(this.collectRunEvidence(steps, input.projectRoot || "")));
            input.onProgress?.({ phase: "model", text: "Pidiendo al modelo el informe de investigacion..." });
            continue;
          }

          // BUG 6 FIX: Si el modelo responde "Necesito ver/leer más archivos" SIN llamar
          // herramientas, es confusión o contexto saturado. Redirigir en lugar de aceptar.
          const isIndecisiveText = finalText
            && /\bnecesito\s+(?:ver|leer|revisar|analizar|inspeccionar|examinar)\b|\bdebo\s+(?:ver|leer|revisar|analizar)\b|\bpara\s+poder\s+(?:darte|entregarte|generar)\b|\bantes\s+de\s+cerrar\b|\bconsulta\s+opcional\s+al\s+cerebro\b|\bhar[eé]\s+(?:una\s+)?(?:consulta|tanda|lectura)/i.test(finalText)
            && i < effectiveMaxIterations - 2
            && !this.reportPromptSent;
          if (isIndecisiveText) {
            const evidenceReady = analysisEvidenceSufficient(
              this.collectRunEvidence(steps, input.projectRoot || ""),
              this.analysisSufficiencyOpts(input),
            ).ok;
            this.reportPromptSent = true;
            this.forceTextOnlyClose = evidenceReady === true;
            this.conversation.appendUser(evidenceReady
              ? analysisReportPromptForEvidence(this.collectRunEvidence(steps, input.projectRoot || ""))
              : "EDITCORE: Tu respuesta indica que necesitas leer más archivos pero no usaste ninguna herramienta. Si necesitas algo, usa read_file o search_files. Si ya tienes información suficiente, escribe el REPORTE FINAL completo en markdown ahora sin más herramientas, en español y sin volcar código.");
            continue;
          }

          const validation = input.enforceController
            ? validateAgentCompletion(input.prompt, steps, input.allowWrite !== false, { analysisMode: input.analysisMode === true, projectRoot: input.projectRoot, planAuthorized: input.planAuthorized === true })
            : null;
          completed = input.requireEvidence === false || (validation ? validation.ok : this.hasCompletionEvidence(steps, input));
          if (input.analysisMode === true && completed && !reportLooksComplete(finalText)
            && !this.reportPromptSent && i < effectiveMaxIterations - 1
            && !steps.some((step) => step.ok === false)) {
            this.reportPromptSent = true;
            this.forceTextOnlyClose = true;
            completed = false;
            this.conversation.appendUser(analysisReportPromptForEvidence(this.collectRunEvidence(steps, input.projectRoot || "")));
            input.onProgress?.({ phase: "model", text: "El modelo debe redactar el informe de hallazgos..." });
            continue;
          }
          if (input.analysisMode === true && completed) {
            // Analisis profundo: NO forzar Cerebro (quema turnos y cierra temprano).
            finalText = this.finalizeAnalysisOnce(input, steps, finalText);
            const awaitingAuth = isPendingAnalysisPlan(finalText)
              || /Cuando autorices procedo/i.test(String(finalText || ""))
              || /esperando autorizacion/i.test(String(stopReason || ""));
            // Si YA pidio autorizacion, el reporte es terminal: no reabrir el loop
            // por umbral de cobertura (causa de "Trabajando..." eterno).
            if (awaitingAuth) {
              stopReason = stopReason || "Analisis cerrado: esperando autorizacion del usuario.";
              input.onProgress?.({
                phase: "awaiting_authorization",
                stage: this.stageForSteps(steps),
                index: steps.length,
                text: "Esperando tu autorización (escribe procede).",
              });
            } else {
              const groundedCheck = groundAnalysisReport(finalText, steps, input.projectRoot || "", this.runScope);
              const evidenceNow = this.collectRunEvidence(steps, input.projectRoot || "");
              const sufficiency = analysisEvidenceSufficient(evidenceNow, this.analysisSufficiencyOpts(input));
              const coverageRejects = (this.rejectionCounts.get("coverage") || 0) + 1;
              if (!sufficiency.ok && coverageRejects <= 2 && i < effectiveMaxIterations - 1) {
                this.rejectionCounts.set("coverage", coverageRejects);
                this.reportPromptSent = true;
                this.analysisFinalizedText = "";
                completed = false;
                this.conversation.appendUser([
                  "VALIDACION DE EDITCORE: Analisis PREMATURO rechazado (cobertura insuficiente).",
                  ...(sufficiency.reasons || []),
                  formatCoverageBlock(evidenceNow, this.analysisSufficiencyOpts(input)),
                  "Continua con list_files en subcarpetas + read_file de codigo fuente (.ts/.tsx/.js) + search_files de errores reales.",
                  "No cites bugs desde ROADMAP.md (EditCore lo mantiene como indice). NO cierres hasta cubrir el umbral de evidencia / COVERAGE_MAP.",
                  coverageRejects >= 2
                    ? "ULTIMO INTENTO: si no alcanzas el umbral, cierra YA con el mejor reporte anclado a evidencia real."
                    : "",
                ].filter(Boolean).join("\n"));
                continue;
              }
              if (!sufficiency.ok && coverageRejects > 2) {
                this.rejectionCounts.set("coverage", coverageRejects);
                // Cap: cierra con lo que hay para no quemar tokens.
                completed = true;
                finalText = this.finalizeAnalysisOnce(input, steps, reportLooksComplete(finalText) ? finalText : "");
                stopReason = "Analisis cerrado tras 2 rechazos de cobertura (anti-bucle tokens).";
                break;
              }
              if ((groundedCheck.replaced || isHollowAnalysisReport(finalText)) && i < effectiveMaxIterations - 1 && !this.hollowReportNudgeSent) {
                this.hollowReportNudgeSent = true;
                this.reportPromptSent = true;
                this.analysisFinalizedText = "";
                this.conversation.appendUser(
                  [
                    "VALIDACION DE EDITCORE: Informe HUECO rechazado (Falta informacion/NO-GO sin citar codigo).",
                    groundedCheck.reason || "Habia lecturas verificadas.",
                    "Usa los FORENSIC_EXCERPTS siguientes y reescribe el reporte anclado a funciones/lineas reales. PROHIBIDO decir que falta el contenido fuente de paths ya leidos.",
                    formatForensicExcerptsBlock(evidenceNow),
                  ].join("\n\n")
                );
                completed = false;
                continue;
              }
              finalText = this.analysisFinalizedText || groundedCheck.text;
            }
          }
          if (!input.analysisMode && completed && input.allowWrite === true
            && (input.planAuthorized === true || (validation?.requirements?.write === true))) {
            const execReport = buildExecutionEvidenceReport(finalText, steps, input.projectRoot || "", this.executionEvidenceOptions(input));
            if (!execReport.ok) {
              completed = false;
              stopReason = execReport.reasons.join(" ") || "Falta evidencia real de mutacion/verificacion en disco.";
              if (this.duplicateNarrationCount >= 1 || finalRejections >= 1) {
                finalText = execReport.text;
                break;
              }
              if (i < effectiveMaxIterations - 1) {
                this.conversation.appendUser(`VALIDACION DE EDITCORE: ${stopReason} Ejecuta write_file/replace_in_file y luego verifica. No narres correcciones sin herramientas.`);
                continue;
              }
              finalText = execReport.text;
              break;
            }
            if (input.planAuthorized === true) {
              const synced = this.refreshFixQueueFocus(input, steps, { forceAppend: true });
              if (synced && !synced.done && (synced.queue || []).length && i < effectiveMaxIterations - 1) {
                completed = false;
                stopReason = synced.summary || "Cola de correcciones incompleta.";
                this.conversation.appendUser([
                  "DISPATCHER: cola incompleta. No declares listo.",
                  synced.summary,
                  "Continua con el archivo actual de la cola hasta verificarlo.",
                ].join("\n"));
                continue;
              }
            }
            finalText = execReport.text;
          }
          const uiOneShot = input.runProfile?.uiOneShot === true || input.orchestratorPlan?.uiOneShot === true;
          if (completed && uiOneShot) {
            const gate = evaluateOneShotFromSteps(steps);
            if (!gate.ok) {
              completed = false;
              stopReason = gate.summary;
              if (i < effectiveMaxIterations - 1) {
                this.conversation.appendUser(buildOneShotGatePrompt(gate));
                continue;
              }
            }
          }
          if (!completed) {
            const failedNow = steps.filter((step) => step.ok !== true);
            stopReason = failedNow.length
              ? `La ejecucion termino con ${failedNow.length} accion(es) fallida(s).`
              : steps.length ? "La tarea no tiene evidencia suficiente de ejecucion exitosa." : "El modelo intento finalizar sin ejecutar herramientas.";
            // En analisis un fallo cierra honesto; en modo tarea el fallo se
            // devuelve al modelo para que lo corrija o use una alternativa.
            if (failedNow.length && input.analysisMode === true) break;
            stopReason = validation?.reason || stopReason;
            finalRejections += 1;
            if (finalRejections >= 2 || this.duplicateNarrationCount >= 1) break;
            const failDetail = failedNow.slice(-2)
              .map((step) => `${step.name}: ${String(step.result?.error || "").slice(0, 140)}`)
              .filter(Boolean)
              .join(" | ");
            this.conversation.appendUser(`VALIDACION DE EDITCORE: ${stopReason}${failDetail ? ` Fallos pendientes: ${failDetail}.` : ""} No puedes terminar todavia: corrige la causa o usa una alternativa con herramientas, verifica despues de la ultima escritura y entonces entrega el reporte final.`);
            if (i < effectiveMaxIterations - 1) continue;
          }
          this.logger.log(`✓ [Claude Code] Completado: ${steps.length} pasos`);
          break;
        }

        // Listado: si ya hay list_files ok, no ejecutar mas tools; exigir respuesta de texto.
        if (input.listOnly === true && actions.length
          && steps.some((step) => step.name === "list_files" && step.ok === true)) {
          this.forceTextOnlyClose = true;
          this.conversation.appendUser(
            "VALIDACION DE EDITCORE: El listado ya esta hecho. NO uses mas herramientas. Responde al usuario YA con la lista de carpetas y archivos."
          );
          continue;
        }

        // Analisis: si el modelo YA pidio autorizacion, CERRAR YA.
        // No seguir con mas tools ni regenerar (evita "Trabajando..." eterno y reportes pegados).
        // Acceso completo: NO pausar por PROCEDE (el permiso ya autoriza).
        const permissionFullNowPause = input.permissionMode === "full"
          || input.runProfile?.permissionFull === true
          || input.orchestratorPlan?.permissionFull === true;
        if (input.analysisMode === true && input.allowWrite !== true && narration && !permissionFullNowPause) {
          const asksAuth = /Cuando autorices procedo|cuando autorices[,:]?\s*procedo|escribe\s*\*?\*?procede/i.test(narration);
          const pendingPlan = isPendingAnalysisPlan(narration)
            || (reportLooksComplete(narration) && asksAuth);
          if (pendingPlan && String(narration).trim().length >= 200) {
            const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
            const hasDiskEvidence = steps.some((step) => (
              step.ok === true && ["list_files", "read_file", "search_files"].includes(String(step.name || ""))
            ));
            const enough = analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok || hasDiskEvidence;
            if (enough || asksAuth) {
              for (const action of actions) {
                if (action.callId) {
                  this.conversation.appendToolResult(action.callId, action.name, {
                    error: "EditCore cerro el analisis: ya se solicito autorizacion. Esperando PROCEDE del usuario.",
                  });
                }
              }
              if (narrationTrack.emit && !reportBlocksRepetition(narration)) {
                input.onProgress?.({
                  phase: "narration_delta",
                  stage: this.stageForSteps(steps),
                  index: steps.length,
                  text: narration,
                });
              }
              completed = true;
              finalText = this.finalizeAnalysisOnce(
                input,
                steps,
                reportLooksComplete(narration) ? narration : "",
              );
              stopReason = "Analisis cerrado: esperando autorizacion del usuario.";
              input.onProgress?.({
                phase: "awaiting_authorization",
                stage: this.stageForSteps(steps),
                index: steps.length,
                text: "Esperando tu autorización (escribe procede).",
              });
              this.logger.log("✓ [Claude Code] Analisis en pausa por autorizacion");
              break;
            }
          }
        }

        this.consecutiveNoToolTurns = 0;
        // Analisis: UNA herramienta por turno (estilo Cursor). El resto se difiere.
        if (input.analysisMode === true && actions.length > 1) {
          const [firstAction, ...deferred] = actions;
          for (const extra of deferred) {
            if (extra.callId) {
              this.conversation.appendToolResult(extra.callId, extra.name, {
                deferred: true,
                error: "SERIAL_ANALYSIS: solo 1 herramienta por turno. Narra el hallazgo actual en el chat y pide la siguiente en el turno siguiente.",
              });
            }
          }
          actions.length = 0;
          actions.push(firstAction);
          input.onProgress?.({
            phase: "model",
            text: "Modo serial: 1 archivo/carpeta por paso (sin saturar)...",
          });
        }
        // Ejecutar TODAS las acciones del turno en orden. Cada tool_call
        // recibe exactamente un resultado (exito, cache, rechazo o error).
        let forceFeedback = "";
        for (const action of actions) {
          if (forceFeedback) {
            this.conversation.appendToolResult(action.callId, action.name, { error: "EditCore pospuso esta accion: primero atiende la instruccion de implementacion pendiente." });
            continue;
          }
          if (this.shouldForceImplementation(input, requirements, steps, action)) {
            forceFeedback = input.runProfile?.greenfieldCreate || input.orchestratorPlan?.greenfieldCreate
              ? "Creacion de proyecto: deja de explorar. Escribe AHORA los archivos con write_file (README, package.json, src/, etc.)."
              : "STOP EXPLORACION: ya tienes suficiente evidencia de lectura. El plan esta autorizado. Ahora DEBES modificar codigo con write_file o replace_in_file (o run_command si aplica) y luego verificar. NO hagas mas list_files/read_file/search_files hasta haber escrito. PROHIBIDO reescribir el mismo archivo en bucle.";
            this.conversation.appendToolResult(action.callId, action.name, { error: forceFeedback });
            input.onProgress?.({ phase: "narration", stage: "implementation", index: steps.length, text: "Forzando implementación: suficiente lectura, ahora se aplica el cambio real." });
            continue;
          }
          const brainBlock = this.shouldBlockBrainLoop(steps, action);
          if (brainBlock) {
            this.conversation.appendToolResult(action.callId, action.name, { error: brainBlock });
            continue;
          }
          const greenfieldBlock = this.shouldBlockGreenfieldWaste(input, action);
          if (greenfieldBlock) {
            this.conversation.appendToolResult(action.callId, action.name, { error: greenfieldBlock });
            continue;
          }
          const analysisHeavyBlock = this.shouldBlockAnalysisHeavyCommand(input, action);
          if (analysisHeavyBlock) {
            this.conversation.appendToolResult(action.callId, action.name, { error: analysisHeavyBlock });
            continue;
          }
          if (OPERATOR_PUBLISH_TOOLS.includes(action.name) && !isOperatorPublishRequest(input.prompt)) {
            this.conversation.appendToolResult(action.callId, action.name, {
              error: "Publicar/conectar no estaba pedido. Cierra con un resumen; no uses onboard/publish/deploy.",
            });
            continue;
          }

          if (input.analysisMode === true) {
            const targetPath = String(action.input?.path || "").replace(/\\/g, "/");
            const isRoadmap = /(^|\/)ROADMAP(\/|$)/i.test(targetPath) || /(^|\/)ROADMAP\.md$/i.test(targetPath);
            const isReadTool = ["read_file", "search_files", "list_files"].includes(String(action.name || ""));
            const isEditcoreMeta = /(^|\/)\.editcore(\/|$)/i.test(targetPath)
              || /\b(?:chats|memory|context)\.json$/i.test(targetPath);
            const isStatusDoc = Boolean(targetPath) && isReadTool && (isDocNoisePath(targetPath) || isEditcoreMeta);
            const isWrite = ["write_file", "replace_in_file", "delete_file", "apply_diff"].includes(String(action.name || ""));
            if (isRoadmap || isStatusDoc || (isWrite && input.planAuthorized !== true)) {
              this.conversation.appendToolResult(action.callId, action.name, {
                error: (isRoadmap || isStatusDoc)
                  ? "MODO ANALISIS: ROADMAP/.editcore/docs de estado no son fuente de bugs. Continua con codigo (src/api/app) o escribe el REPORTE FINAL. EditCore actualiza ROADMAP.md solo."
                  : "MODO ANALISIS: escritura de codigo bloqueada. Solo lectura y reporte. Escribe PROCEDE despues para corregir.",
              });
              continue;
            }
          }

          if (input.planAuthorized === true) {
            const writeTools = ["write_file", "replace_in_file", "delete_file", "apply_diff"];
            if (writeTools.includes(String(action.name || ""))) {
              const targetRaw = String(action.input?.path || "").replace(/\\/g, "/");
              // Solo bloquear vendor/minificado obvio; el usuario autorizo ejecucion libre.
              if (isVendorOrGeneratedPath(targetRaw) && !/force|forzar|vendor/i.test(String(input.prompt || ""))) {
                this.conversation.appendToolResult(action.callId, action.name, {
                  error: "Evitado: archivo vendor/minificado. Elige codigo fuente en src/ (o pide forzar vendor).",
                });
                continue;
              }
              // Sin dispatcher FOCO: PROCEDE puede mutar cualquier path del proyecto.
              syncFixQueueWithSteps(this.fixQueue || [], steps, input.projectRoot || "");
            }
          }

          // Bloquear reescrituras del mismo archivo (evita bucle write_file una y otra vez)
          action.projectRoot = input.projectRoot;
          if (MUTATION_TOOLS.has(action.name)) {
            const mutPath = String(action.input?.path || action.input?.filePath || "").trim().toLowerCase().replace(/\\/g, "/");
            if (mutPath) {
              const mutKey = `mut:${action.name}:${mutPath}`;
              const mutCount = (this.repeatCounts.get(mutKey) || 0) + 1;
              this.repeatCounts.set(mutKey, mutCount);
              if (mutCount > 1) {
                this.wastedRepeats += 1;
                this.conversation.appendToolResult(action.callId, action.name, {
                  error: `Ya modificaste ${mutPath} en esta tarea (intento #${mutCount}). NO lo reescribas. Verifica con read_file o run_command y entrega el reporte final. Si falló el cambio, usa replace_in_file con un parche distinto, no write_file completo otra vez.`,
                });
                if (mutCount >= 2) {
                  this.conversation.appendUser("AVISO DE EDITCORE: estás reescribiendo el mismo archivo en bucle. PROHIBIDO write_file/replace_in_file otra vez sobre ese path. Ahora: (1) verifica, (2) reporte final en markdown. No explores ni reescribas más.");
                }
                continue;
              }
            }
          }

          // CACHE de lecturas: devolver resultado real, NUNCA error en el primer hit
          // (el bug anterior hacia repeats>=1 → error → el modelo releia por otra ruta).
          if (READ_CACHEABLE_TOOLS.has(action.name) && this.actionRegistry.wasExecuted(action)) {
            const actionHash = this.actionRegistry.hash(action);
            const repeats = (this.repeatCounts.get(actionHash) || 0) + 1;
            this.repeatCounts.set(actionHash, repeats);
            const cachedResult = this.actionRegistry.getResult(action);
            this.logger.log(`⚡ [Cache] Hit #${repeats}: ${action.name}`);
            this.wastedRepeats += repeats > 1 ? 1 : 0;

            steps.push({
              ...this.tagStepMeta(),
              name: action.name,
              input: action.input,
              result: cachedResult,
              ok: true,
              cached: true,
            });
            this.steps = steps;
            this.refreshEvidencePreservationBlock(steps);
            input.onProgress?.({
              phase: "tool",
              stage: "done",
              index: steps.length - 1,
              name: action.name,
              input: action.input || {},
              result: cachedResult,
              ok: true,
              cached: true,
            });
            this.conversation.appendToolResult(action.callId, action.name, {
              cached: true,
              result: this.compactResult(cachedResult),
              nota: repeats === 1
                ? "CACHE HIT: mismo archivo/consulta ya leido en esta corrida. Usa este resultado; NO vuelvas a pedir read_file/list_files/search_files identico."
                : `CACHE HIT #${repeats}: deja de repetir ${action.name}. Entrega el reporte final o ejecuta una accion DISTINTA.`,
            });
            this.tokenLedger.record(action.name, 0, 0, { cached: true });
            if (input.analysisMode === true && repeats === 1) {
              this.emitAnalysisStepProgress(input, action.name, action.input || {}, cachedResult);
            }
            if (repeats >= 2 && input.analysisMode === true) {
              this.conversation.appendUser(
                "EDITCORE: Ya tienes esa evidencia en cache. PROHIBIDO seguir explorando lo mismo. Escribe AHORA el reporte final con las secciones requeridas."
              );
            } else if (repeats >= 3 && !this.repeatWarned) {
              this.repeatWarned = true;
              this.conversation.appendUser(
                "AVISO DE EDITCORE: demasiadas repeticiones cacheadas. Deja de explorar. Entrega el reporte o muta un archivo distinto."
              );
            }
            continue;
          }

          // Ejecutar acción con fallback
          input.onProgress?.({
            phase: "tool",
            stage: "running",
            index: steps.length,
            name: action.name,
            input: action.input || {},
          });
          let result;
          try {
            const toolEpoch = typeof input.captureExecutionEpoch === "function" ? input.captureExecutionEpoch() : undefined;
            input.assertExecutionActive?.(toolEpoch);
            result = await this.executeWithFallback(action);
            input.assertExecutionActive?.(toolEpoch);

            // Registrar éxito en ActionRegistry
            this.actionRegistry.record(action, result, true);
            if (READ_CACHEABLE_TOOLS.has(action.name)) {
              this.repeatCounts.set(this.actionRegistry.hash(action), 1);
            }

            // Una mutacion invalida las lecturas cacheadas de ese archivo.
            if (MUTATION_TOOLS.has(action.name) && typeof this.actionRegistry.invalidatePath === "function") {
              this.actionRegistry.invalidatePath(String(action.input?.path || ""));
            }

            // Registrar en memoria si es lectura/escritura de archivo
            if (this.agentMemory && (action.name === 'read_file' || action.name === 'write_file')) {
              const filePath = action.input?.path || action.input?.filePath || '';
              if (filePath) {
                this.agentMemory.addFile(filePath, action.name === 'write_file' ? 'write' : 'read');
              }
            }

            steps.push({
              ...this.tagStepMeta(),
              name: action.name,
              input: action.input,
              result: result,
              ok: true,
              verificationPassed: action.name === "run_command" ? !isFailedDiagnosticResult(result) : undefined,
            });
            this.steps = steps;
            this.refreshEvidencePreservationBlock(steps);
            const diagnosticFailed = action.name === "run_command" && isFailedDiagnosticResult(result);
            input.onProgress?.({
              phase: "tool",
              stage: "done",
              index: steps.length - 1,
              name: action.name,
              input: action.input || {},
              result,
              ok: true,
              verificationPassed: diagnosticFailed ? false : true,
            });
            this.conversation.appendToolResult(action.callId, action.name, this.compactResult(result));
            // Tras escritura exitosa: no reescribir; verificar y cerrar
            if (MUTATION_TOOLS.has(action.name) && !diagnosticFailed) {
              const written = String(action.input?.path || action.input?.filePath || "el archivo");
              this.conversation.appendUser(`CAMBIO APLICADO en ${written}. No lo reescribas. Siguiente: verifica (read_file o run_command) y entrega el REPORTE FINAL en markdown (## Que hice, ## Verificacion, ## Pendientes). Prohibido volver a write_file sobre el mismo path.`);
              input.onProgress?.({ phase: "narration", stage: "verification", index: steps.length, text: `Cambio aplicado en ${written}. Verificando y cerrando...` });
            }
            if (input.analysisMode === true) {
              this.emitAnalysisStepProgress(input, action.name, action.input || {}, result);
            }
            if (diagnosticFailed) {
              const code = Number(result?.exitCode);
              this.conversation.appendUser([
                `VALIDACION DE EDITCORE: la verificacion FALLO (exit ${Number.isFinite(code) ? code : "≠0"}).`,
                "Esto NO cuenta como OK. Corrige el codigo con replace_in_file/write_file y vuelve a verificar.",
                "PROHIBIDO cerrar la tarea diciendo que lint/test pasaron.",
              ].join(" "));
            }

            // Registrar en ledger (estimado: 100 tokens por operación)
            this.tokenLedger.record(action.name, 100, 50);
            if (input.planAuthorized === true) {
              this.refreshFixQueueFocus(input, steps);
            }

          } catch (error) {
            // Registrar fallo en ActionRegistry
            this.actionRegistry.record(action, { error: error.message }, false);

            steps.push({
              ...this.tagStepMeta(),
              name: action.name,
              input: action.input,
              result: { error: error.message },
              ok: false,
            });
            this.steps = steps;
            this.refreshEvidencePreservationBlock(steps);
            input.onProgress?.({
              phase: "tool",
              stage: "done",
              index: steps.length - 1,
              name: action.name,
              input: action.input || {},
              result: { error: error.message },
              ok: false,
            });
            this.conversation.appendToolResult(action.callId, action.name, { error: error.message, nota: "Corrige la causa real o cambia de estrategia; no repitas la misma entrada fallida." });

            // Registrar en ledger
            this.tokenLedger.record(action.name, 50, 0);
          }

          // Actualizar progreso
          if (this.taskManager?.updateProgress) {
            try {
              this.taskManager.updateProgress(steps[steps.length - 1]);
            } catch (e) {
              // Ignorar errores de taskManager
            }
          }

          // Crear checkpoint cada 5 pasos
          if (steps.length % 5 === 0 && this.taskManager?.createCheckpoint) {
            try {
              this.taskManager.createCheckpoint(steps);
            } catch (e) {
              // Ignorar errores de checkpoint
            }
          }
        }
        if (forceFeedback) this.conversation.appendUser(`VALIDACION DE EDITCORE: ${forceFeedback}`);

        // Auto-fix: tras mutaciones exitosas del turno, corre lint/typecheck y pide correccion.
        if (
          input.allowWrite === true
          && input.analysisMode !== true
          && typeof input.runPostWriteDiagnostics === "function"
        ) {
          const maxCycles = Number(input.maxAutoFixCycles) > 0 ? Number(input.maxAutoFixCycles) : 3;
          const mutatedPaths = [...new Set(
            steps
              .slice(this.lastAutoFixStep || 0)
              .filter((step) => step.ok !== false && ["write_file", "replace_in_file", "apply_diff"].includes(step.name)
                && (step.input?.path || step.result?.path))
              .map((step) => String(step.input?.path || step.result?.path || ""))
              .filter(Boolean)
          )];
          if (mutatedPaths.length) {
            this.lastAutoFixStep = steps.length;
            try {
              const diag = await input.runPostWriteDiagnostics(mutatedPaths);
              const fixState = nextAutoFixState(
                { cycles: this.autoFixCycles || 0 },
                diag,
                maxCycles
              );
              this.autoFixCycles = fixState.cycles;
              if (fixState.triggered && fixState.prompt) {
                this.conversation.appendUser(fixState.prompt);
                input.onProgress?.({
                  phase: "repair",
                  name: "auto_fix",
                  text: `Auto-fix ${fixState.cycles}/${maxCycles}: lint/typecheck fallo; corrigiendo...`,
                  result: fixState.lastDiag || diag,
                });
              } else if (fixState.exhausted) {
                input.onProgress?.({
                  phase: "repair",
                  name: "auto_fix",
                  text: fixState.message,
                  result: diag,
                });
                if (typeof input.onTerminalVerificationFailure === "function" && !this.mutationRollbackRequested) {
                  this.mutationRollbackRequested = true;
                  try {
                    await input.onTerminalVerificationFailure({
                      reason: fixState.message || "auto-fix agotado",
                      diag,
                    });
                  } catch {
                    // Rollback best-effort: no tumbar el agente.
                  }
                }
              }
            } catch {
              // Nunca tumbar el agente por fallo de diagnostico.
            }
          }
        }

        const failedSteps = steps.filter((step) => step.ok !== true);
        if (input.analysisMode === true) {
          const trailingFailures = [];
          for (let k = steps.length - 1; k >= 0 && steps[k].ok !== true; k--) trailingFailures.unshift(steps[k]);
          const hardFailures = trailingFailures.filter((step) => !this.isRecoverableAnalysisFailure(step));
          if (hardFailures.length >= 2) {
            stopReason = "La ejecucion se detuvo despues de acciones fallidas que impiden un analisis fiable.";
            break;
          }
        } else {
          // Solo la racha pendiente puede detener la tarea. Los errores de
          // formato, politica o estado obsoleto son recuperables si el modelo
          // cambia de estrategia; no deben acumularse despues de un exito.
          const trailingFailures = [];
          for (let k = steps.length - 1; k >= 0 && steps[k].ok !== true; k--) trailingFailures.unshift(steps[k]);
          const failureSignatures = trailingFailures.map((step) => `${step.name}:${JSON.stringify(step.input || {})}`);
          const repeatedFailure = failureSignatures.length !== new Set(failureSignatures).size;
          const blockingFailures = trailingFailures.filter((step) => !this.isRecoverableTaskFailure(step));
          if (repeatedFailure || blockingFailures.length >= 3) {
            stopReason = repeatedFailure
              ? "La misma accion fallo dos veces con la misma entrada; se detuvo la ejecucion para no repetir errores."
              : "La ejecucion se detuvo por fallos consecutivos sin progreso; los checkpoints quedaron guardados para continuar.";
            break;
          }
        }

        // Analisis: tras tools, completar cobertura con walker y PEDIR al modelo
        // que redacte el informe. Nunca cerrar aqui con plantilla local (eso
        // programaba la respuesta del chat en vez de dejar investigar al agente).
        if (input.analysisMode === true && actions.length > 0) {
          const projectRoot = input.projectRoot || "";
          const sufficiencyOpts = this.analysisSufficiencyOpts(input);
          let evidence = this.collectRunEvidence(steps, projectRoot);
          if (!analysisEvidenceSufficient(evidence, sufficiencyOpts).ok) {
            for (let w = 0; w < 3; w += 1) {
              evidence = this.collectRunEvidence(steps, projectRoot);
              if (analysisEvidenceSufficient(evidence, sufficiencyOpts).ok) break;
              const walk = nextAnalysisWalkActions(evidence, sufficiencyOpts);
              if (!walk?.[0]?.name) break;
              await this.executeSeedTool(input, steps, walk[0].name, walk[0].input || {});
            }
            evidence = this.collectRunEvidence(steps, projectRoot);
          }
          const searches = Number(evidence.searchCount || (evidence.searches || []).length || 0);
          const reads = Number(evidence.realFileReadCount || 0);
          const minReads = Math.max(4, Number(input.analysisDepth?.minCodeReads || 6));
          if (
            analysisEvidenceSufficient(evidence, sufficiencyOpts).ok
            && (searches >= 1 || reads >= minReads)
            && !this.reportPromptSent
            && i < effectiveMaxIterations - 1
          ) {
            this.reportPromptSent = true;
            this.forceTextOnlyClose = true;
            this.conversation.appendUser(analysisReportPromptForEvidence(evidence));
            input.onProgress?.({
              phase: "model",
              text: "Cobertura lista. El modelo investiga y redacta el informe...",
            });
            continue;
          }
        }
      }

      // Analisis: NUNCA cerrar solo con seeds/walker + plantilla (eso salia en 1s).
      // Exigir investigacion real del modelo antes de marcar completed.
      if (input.analysisMode === true && !/se detiene para no quemar tokens|write tools no expuestas|Escritura no expuesta|acciones fallidas/i.test(String(stopReason || ""))) {
        if (!this.analysisHasModelInvestigation(finalText)) {
          input.onProgress?.({
            phase: "model",
            text: "Forzando investigacion real del modelo (no plantilla)...",
          });
          this.forceTextOnlyClose = false;
          const investigated = await this.forceModelInvestigation(input, steps, {
            minModelTurns: 2,
            maxTurns: 10,
          });
          if (investigated) finalText = investigated;
        }
        if (this.analysisHasModelInvestigation(finalText)) {
          const closed = this.closeAnalysisWithReport(
            input,
            steps,
            finalText || "",
            stopReason || "Analisis completado tras investigacion del modelo.",
          );
          completed = true;
          finalText = closed.text;
          stopReason = closed.stopReason;
        } else if (!completed) {
          // Ultimo recurso: un turno de informe; si no hay modelo, marcar incompleto.
          try {
            const drafted = await this.requestAnalysisReport(input, steps, { appendPrompt: !this.reportPromptSent });
            this.reportPromptSent = true;
            if (this.analysisHasModelInvestigation(drafted)) {
              const closed = this.closeAnalysisWithReport(
                input,
                steps,
                drafted,
                "Analisis completado tras turno forzado de informe.",
              );
              completed = true;
              finalText = closed.text;
              stopReason = closed.stopReason;
            } else {
              completed = false;
              finalText = String(drafted || finalText || "").trim()
                || this.finalizeAnalysisOnce(input, steps, "");
              stopReason = stopReason
                || `Analisis incompleto: solo ${this.providerCalls} llamada(s) al modelo. Escribe CONTINUA.`;
            }
          } catch (_) {
            completed = false;
            stopReason = stopReason || "Analisis incompleto: el modelo no investigo. Escribe CONTINUA.";
            finalText = this.finalizeAnalysisOnce(input, steps, finalText || "");
          }
        }
      } else if (!completed && input.analysisMode !== true && this.hasValidatedTaskEvidence(input, steps)) {
        if (input.allowWrite === true) {
          const requirements = agentTaskRequirements(input.prompt, true, { planAuthorized: input.planAuthorized === true });
          const requiresMutation = input.planAuthorized === true || requirements.write === true;
          if (requiresMutation) {
            const execReport = buildExecutionEvidenceReport(finalText || this.evidenceFinalText(input, steps), steps, input.projectRoot || "", this.executionEvidenceOptions(input));
            if (execReport.ok) {
              const uiOneShot = input.runProfile?.uiOneShot === true || input.orchestratorPlan?.uiOneShot === true;
              if (uiOneShot) {
                const gate = evaluateOneShotFromSteps(steps);
                if (!gate.ok) {
                  completed = false;
                  stopReason = gate.summary;
                  finalText = `${execReport.text}\n\n${gate.summary}`;
                } else {
                  completed = true;
                  finalText = execReport.text;
                  stopReason = "Completado por evidencia acumulada + checklist one-shot.";
                }
              } else {
                completed = true;
                finalText = execReport.text;
                stopReason = "Completado por evidencia acumulada sin cierre final del proveedor.";
              }
            } else {
              completed = false;
              stopReason = execReport.reasons.join(" ") || "Falta evidencia real de mutacion/verificacion en disco.";
              finalText = execReport.text;
            }
          } else {
            const needsWrite = agentTaskRequirements(input.prompt, true, { planAuthorized: input.planAuthorized === true }).write === true;
            if (needsWrite && !hasMutationEvidence(steps)) {
              completed = false;
              stopReason = "Narracion de correccion sin tool call de escritura.";
              finalText = this.incompleteResultText(finalText, stopReason, steps, input);
            } else {
              completed = true;
              finalText = this.finalizeExecutionText(input, steps, finalText || this.evidenceFinalText(input, steps));
              stopReason = "Completado por evidencia acumulada sin cierre final del proveedor.";
            }
          }
        } else {
          completed = true;
          finalText = this.finalizeExecutionText(input, steps, finalText || this.evidenceFinalText(input, steps));
          stopReason = "Completado por evidencia acumulada sin cierre final del proveedor.";
        }
      }

      // Analisis incompleto: mensaje honesto (nunca fingir completed con plantilla).
      if (!completed && input.analysisMode === true && !finalText) {
        finalText = this.finalizeAnalysisOnce(input, steps, "");
        stopReason = stopReason || "Analisis incompleto: falta investigacion del modelo. Escribe CONTINUA.";
      }
      if (completed && input.analysisMode === true) {
        let draft = this.analysisFinalizedText || finalText || "";
        const evidence = this.collectRunEvidence(steps);
        if (!detectContradictoryEvidence(draft, evidence).ok
          || narrationLooksLikeInventedAnalysis(draft, steps, input.projectRoot || "")
          || /Verificacion completada con evidencia real/i.test(draft)
          || isHollowAnalysisReport(draft)
          || !reportLooksComplete(draft)) {
          this.analysisFinalizedText = "";
          draft = "";
        }
        const closed = this.closeAnalysisWithReport(
          input,
          steps,
          draft,
          stopReason || "Analisis completado: hallazgos y plan de correccion listos.",
        );
        finalText = closed.text;
        stopReason = closed.stopReason;
      }

      // Guardar memoria al finalizar
      if (this.agentMemory) {
        // BUG 6 FIX: No guardar como resumen textos no-reporte: "Necesito ver..."
        // o el mensaje genérico de evidencia. La próxima corrida empezaría
        // en un estado inservible generando el loop de recovery.
        const rawConclusion = finalText || stopReason || "";
        const isRealReport = rawConclusion.length > 80
          && !/\bnecesito\s+(?:ver|leer|revisar)\b|Verificacion completada con evidencia real/i.test(rawConclusion);
        const conclusionSource = isRealReport ? rawConclusion : (completed ? "Tarea completada." : stopReason || "");
        const conclusion = String(redactSensitive(conclusionSource)).replace(/\s+/g, " ").slice(0, 300);
        this.agentMemory.addConversation(
          `${String(redactSensitive(input.prompt || "")).replace(/\s+/g, " ").slice(0, 180)} → ${completed ? "COMPLETADO" : "INCOMPLETO"}${conclusion ? `: ${conclusion}` : ""}`,
          {
            tokensUsed: this.tokensUsed,
            stepsExecuted: steps.length,
            completed: completed,
          },
        );
        await this.agentMemory.save();
        this.logger.log(`✓ [Memory] Memoria guardada`);
      }

      const changedFiles = [...new Set(steps
        .filter((step) => classifyAgentStep(step) === "mutation" && step.ok === true)
        .map((step) => String(step.input?.path || step.result?.path || "").trim())
        .filter(Boolean))];

      if (input.projectRoot) {
        try {
          const rawConclusion = finalText || stopReason || "";
          const isRealReport = rawConclusion.length > 80
            && !/\bnecesito\s+(?:ver|leer|revisar)\b|Verificacion completada con evidencia real/i.test(rawConclusion);
          const conclusionSource = isRealReport ? rawConclusion : (completed ? "Tarea completada." : stopReason || "");
          const conclusion = String(redactSensitive(conclusionSource)).replace(/\s+/g, " ").slice(0, 300);
          rememberProjectEvent(input.projectRoot, {
            task: input.prompt,
            summary: conclusion,
            files: changedFiles,
            decision: completed ? "Tarea completada por agente" : `Incompleto: ${stopReason || ""}`.slice(0, 180),
          });
        } catch {}
      }

      // Mostrar reporte de tokens
      const ledgerSummary = this.tokenLedger.getSummary();
      this.logger.log(`📊 [Ledger] ${ledgerSummary.totalTokens} tokens | ${ledgerSummary.savingsPercent}% ahorro por cache`);
      const verificationCommands = [...new Set(steps
        .filter((step) => verificationStepPassed(step))
        .map((step) => String(step.input?.command || "").trim())
        .filter(Boolean))];
      const progressMade = steps.some((step) => step.ok === true);
      // Contar iteraciones de modelo (providerCalls/modelIterations), no steps.
      const iterationLimitHit = !completed && (
        this.providerCalls >= Math.max(1, effectiveMaxIterations - 1)
        || modelIterations >= effectiveMaxIterations
      );
      const scopedDone = (
        input.instructionConstraints?.mode === "scoped"
        || input.instructionConstraints?.mode === "scoped_dir"
        || input.analysisDepth?.scopedFocus === true
        || input.runProfile?.scopedDiskFocus === true
        || input.runProfile?.scopedFolderFocus === true
      ) && steps.some((step) => (step.name === "read_file" || step.name === "list_files") && step.ok === true);
      const awaitingAuthorization = completed && input.analysisMode === true && (
        /esperando autorizacion/i.test(String(stopReason || ""))
        || isPendingAnalysisPlan(finalText)
        || /Cuando autorices procedo/i.test(String(finalText || ""))
      );
      if (awaitingAuthorization && !/autorizacion/i.test(String(stopReason || ""))) {
        stopReason = "Analisis completado esperando autorizacion del usuario.";
      }
      // FOCO 1 archivo: nunca auto-reanudar (evita 3×6 min de hang).
      // Tampoco auto-reanudar si ya se pidio autorizacion al usuario.
      const autoResumeRecommended = !awaitingAuthorization && !scopedDone && !completed && progressMade && (
        iterationLimitHit
        || /Loop detectado|repitio demasiadas|checkpoint|limite total|excedio el limite|fallos consecutivos|sin herramientas/i.test(String(stopReason || ""))
      );

      // Cola FOCO + evidencia (analisis → plan durable; PROCEDE → mutacion).
      let resultFixQueue = Array.isArray(this.fixQueue) ? this.fixQueue : [];
      let resultEvidence = null;
      try {
        resultEvidence = this.collectRunEvidence(steps, input.projectRoot || "");
        if (input.analysisMode === true && completed) {
          const reportText = String(this.analysisFinalizedText || finalText || "");
          resultFixQueue = buildFixQueueFromReport(reportText, resultEvidence || {}, { maxItems: 12 });
          this.fixQueue = resultFixQueue;
        } else if (input.planAuthorized === true) {
          const synced = syncFixQueueWithSteps(this.fixQueue || [], steps, input.projectRoot || "");
          resultFixQueue = synced.queue;
          this.fixQueue = resultFixQueue;
        }
      } catch { /* ignore */ }

      return {
        taskId: input.taskId,
        text: completed
          ? (input.listOnly === true || input.runProfile?.listOnly === true
            ? (() => {
                const listing = formatListOnlyAnswerFromSteps(steps, input.projectRoot || "", input.prompt || "");
                const raw = String(finalText || "").trim();
                if (listing && (!raw || looksLikeForensicListDrift(raw) || looksLikeNoMutationMessage(raw))) {
                  return listing;
                }
                return listing || raw || "Listado vacio.";
              })()
            : (input.analysisMode === true
            ? (() => {
                // Deber ser: devolver SIEMPRE el informe (hallazgos + como corregir).
                // sanitize solo limpia relleno; si destroza el informe, se regenera.
                let t = String(this.analysisFinalizedText || finalText || "").trim();
                if (t) {
                  const cleaned = sanitizeUserFacingReport(t);
                  if (reportLooksComplete(cleaned) && cleaned.length >= 80) t = cleaned;
                }
                if (!t || t.length < 60 || !reportLooksComplete(t) || isHollowAnalysisReport(t)) {
                  this.analysisFinalizedText = "";
                  t = String(this.finalizeAnalysisOnce(input, steps, "") || this.buildAnalysisFallbackReport(input, steps) || "").trim();
                }
                if (!t || t.length < 40) {
                  t = [
                    "## Qué sí funcionó",
                    "",
                    `- Se ejecutaron ${steps.length} herramientas sobre el proyecto.`,
                    "",
                    "## Qué falló / hallazgos",
                    "",
                    "- El cierre no produjo texto de informe utilizable.",
                    "",
                    "## Evidencia",
                    "",
                    String(stopReason || "Sin stopReason.").trim(),
                    "",
                    "## Cómo lo corregiré",
                    "",
                    "1. Escribe **CONTINUA** para regenerar el analisis con mas lecturas.",
                  ].join("\n");
                }
                this.analysisFinalizedText = t;
                return t;
              })()
            : this.finalizeExecutionText(input, steps, finalText)))
          : this.incompleteResultText(finalText, stopReason, steps, input),
        steps: steps,
        completed: completed,
        stopReason: stopReason,
        fixQueue: resultFixQueue,
        evidence: resultEvidence,
        usage: {
          ...this.usageTotals,
          tokensUsed: this.tokensUsed,
          total_tokens: this.tokensUsed,
          provider_calls: this.providerCalls,
          context_compaction_count: this.conversation.compactedTurns,
          stepsExecuted: steps.length,
          ledger: ledgerSummary,
          budget: this.adaptiveBudget.getSummary(),
        },
        report: {
          completed: completed,
          toolCount: steps.length,
          cacheHits: steps.filter(s => s.cached).length,
          failedSteps: steps.filter(s => !s.ok).length,
          changedFiles,
          verificationCommands,
          outcome: awaitingAuthorization
            ? "awaiting_authorization"
            : (completed ? "completed" : "incomplete"),
          stopReason,
          awaitingAuthorization,
          autoResumeRecommended,
          remainingProviderCalls: Math.max(0, effectiveMaxIterations - steps.length),
          progressMade,
          fixQueue: resultFixQueue,
        },
      };

    } catch (error) {
      throw error;
    }
  }

  /**
   * Si el usuario pide listar una ruta absoluta, ejecuta list_files YA
   * (no esperar al modelo ni pedir PowerShell).
   */
  /**
   * Listado puntual: una sola list_files de la carpeta pedida (sin modelo).
   */
  async seedListOnlyFolder(input, steps) {
    let target = "";
    const folders = input.runProfile?.scopedFolderAllowlist
      || input.orchestratorPlan?.scopedFolderAllowlist
      || input.instructionConstraints?.folderAllowlist
      || [];
    if (Array.isArray(folders) && folders.length) {
      target = String(folders[0] || "").trim();
    }
    if (!target) {
      try {
        const { extractScopedFolderAllowlist } = require("./scoped-file-focus");
        const fromPrompt = extractScopedFolderAllowlist(String(input.rawUserPrompt || input.prompt || ""));
        if (fromPrompt.length) target = fromPrompt[0];
      } catch { /* ignore */ }
    }
    if (!target) {
      const m = String(input.prompt || "").match(/\bcarpeta\s+([A-Za-z0-9._-]+)\b/i)
        || String(input.prompt || "").match(/\b(?:lista|listar|enlista)\s+(?:solamente\s+|solo\s+)?([A-Za-z0-9._/-]+)\b/i);
      target = m ? String(m[1] || "").trim() : "";
    }
    if (!target || /^(carpeta|folder|directorio|raiz|ra[ií]z|proyecto)$/i.test(target)) {
      target = ".";
    }
    input.onProgress?.({ phase: "model", text: `Listando ${target}...` });
    await this.executeSeedTool(input, steps, "list_files", { path: target === "." ? "" : target });
  }

  async seedExplicitPathList(input, steps) {
    if (!this.toolExecutor?.execute || !this.conversation) return;
    if (steps.some((step) => step.name === "list_files")) return;
    const hints = typeof extractAbsolutePathHints === "function"
      ? extractAbsolutePathHints(input.prompt)
      : [];
    const match = hints[0] || String(input.prompt || "").match(/(?:[a-zA-Z]:[\\/][^"'`\n]*)|(?:\\\\[^\\/\s][^\n]*)/)?.[0];
    if (!match) return;
    const targetPath = String(match || "").trim().replace(/[.,;:]+$/g, "");
    if (!targetPath) return;
    input.onProgress?.({ phase: "model", text: `Listando ${targetPath}...` });
    const listed = await this.executeSeedTool(input, steps, "list_files", { path: targetPath });
    if (!listed.ok) {
      this.conversation.appendUser(
        `EditCore intento listar "${targetPath}" y fallo. Reintenta list_files con esa ruta o con path relativo al proyecto. PROHIBIDO pedir PowerShell al usuario.`
      );
      return;
    }
    const entries = Array.isArray(listed.result) ? listed.result : (listed.result?.entries || []);
    const names = entries.slice(0, 80).map((entry) => String(entry?.name || entry?.path || "")).filter(Boolean);
    this.conversation.appendUser([
      `LISTADO REAL YA OBTENIDO POR EDITCORE de "${targetPath}" (${entries.length} entradas).`,
      names.length ? `Primer nivel: ${names.join(", ")}` : "Carpeta vacia o sin entradas visibles.",
      "Responde al usuario con esta lista clara. PROHIBIDO decir que no tienes acceso ni pedir comandos de terminal.",
    ].join(" "));
  }

  /**
   * Diagnostico nombrado: lee SOLO los archivos del prompt (sin walker amplio ni ROADMAP).
   */
  async seedNamedDiagnosticTargets(input, steps) {
    const { isNamedFileDiagnosticPrompt, extractAnalysisTargets } = require("./evidence-grounding");
    if (!isNamedFileDiagnosticPrompt(input.prompt || "")) return false;
    const targets = extractAnalysisTargets(input.prompt || "")
      .filter((t) => /\.(?:js|ts|tsx|jsx|mjs|cjs)$/i.test(t));
    if (!targets.length) return false;
    input.onProgress?.({
      phase: "model",
      text: `Diagnostico nombrado: ${targets.length} archivo(s)...`,
    });
    for (const rel of targets.slice(0, 6)) {
      await this.executeSeedTool(input, steps, "read_file", { path: rel });
    }
    this.conversation?.appendUser([
      "DIAGNOSTICO NOMBRADO: EditCore ya leyo los archivos del prompt.",
      `Targets: ${targets.join(", ")}.`,
      "PROHIBIDO cerrar el analisis solo con ROADMAP.md o ANALISIS_ERRORES.",
      "Escribe el REPORTE FINAL anclado a estos archivos. NO MODIFICAR.",
    ].join(" "));
    return true;
  }

  /**
   * PASO 1: evidencia real en disco antes de que el modelo narre.
   * FOCO acotado: solo read_file del allowlist (sin listar android/ios/src).
   * Amplo: list_files raiz → package.json → carpetas clave → configs → walker.
   */
  async seedAnalysisBootstrap(input, steps) {
    if (input.promptOnlyMode || input.analysisMode !== true || !this.toolExecutor?.execute || !this.conversation) return;
    // FOCO retirado: siempre bootstrap normal (list + package.json + carpeta clave).

    // Diagnostico de N archivos nombrados: no abrir el repo entero ni ROADMAP.
    if (await this.seedNamedDiagnosticTargets(input, steps)) return;

    if (steps.some((step) => step.name === "list_files" || step.name === "read_file")) {
      // No saturar con walker masivo: deja que el modelo continue serial en el chat.
      return;
    }

    input.onProgress?.({ phase: "model", text: "Entrando al proyecto: listando y leyendo archivos reales..." });

    const rootListed = await this.executeSeedTool(input, steps, "list_files", { path: "" });
    if (!rootListed.ok) {
      this.conversation.appendUser(
        "EditCore no pudo precargar el listado. Empieza con list_files en la raiz y luego read_file solo de paths reales. "
        + "Si el acceso esta bloqueado, pide al usuario activar Permisos/Acceso completo y ADELANTE; no abandones."
      );
      return;
    }
    const entries = Array.isArray(rootListed.result)
      ? rootListed.result
      : (rootListed.result?.entries || []);
    const names = new Set(entries.map((entry) => String(entry?.name || entry?.path || "").replace(/\\/g, "/").split("/").pop()));

    // Analisis de hallazgos: IGNORAR ROADMAP (docs de estado). Codigo real primero.
    // Bootstrap LIGERO (estilo Cursor): raiz + package.json + UNA carpeta clave.
    // El resto se hace tool a tool con avance visible en el chat (sin saturar).
    const isSelfAnalysis = /\beditcoreai\b|\beditcore\b|\beste proyecto\b|\beste codebase\b/i.test(String(input.prompt || ""));
    if (isSelfAnalysis) {
      // Análisis auto-referencial: leer estructura completa antes de responder.
      for (const rel of [
        "package.json",
        "main.js",
        "preload.js",
        "renderer.js",
        "runtime/tool-dispatcher.js",
        "runtime/action-registry.js",
        "runtime/ai-core.js",
        "runtime/intent-orchestrator.js",
      ]) {
        const exists = names.has(rel) || names.has(rel.split("/")[0]);
        if (exists) {
          await this.executeSeedTool(input, steps, "read_file", { path: rel });
        }
      }
      if (names.has("runtime")) {
        await this.executeSeedTool(input, steps, "list_files", { path: "runtime" });
      }
      for (const dir of ["ide", "src", "api", "scripts"]) {
        if (names.has(dir)) {
          await this.executeSeedTool(input, steps, "list_files", { path: dir });
        }
      }
    } else if (names.has("package.json")) {
      await this.executeSeedTool(input, steps, "read_file", { path: "package.json" });
      const firstDir = ["src", "app", "apps", "api", "packages", "pages", "components", "lib"]
        .find((dir) => names.has(dir));
      if (firstDir) {
        await this.executeSeedTool(input, steps, "list_files", { path: firstDir });
      }
    }

    let configsRead = 0;
    for (const config of [
      "next.config.js", "next.config.mjs", "next.config.ts",
      "vite.config.js", "vite.config.ts", "vite.config.mjs",
      "tsconfig.json", "jsconfig.json",
    ]) {
      if (!names.has(config)) continue;
      await this.executeSeedTool(input, steps, "read_file", { path: config });
      configsRead += 1;
      if (configsRead >= 2) break;
    }

      this.conversation.appendUser([
        "EVIDENCIA INICIAL (bootstrap ligero). El resto es SERIAL como Cursor:",
        "- UNA herramienta por turno (list_files o read_file).",
        "- Tras cada tool, narra 3-8 lineas de avance en el chat (que miraste / que encontraste).",
        "- Luego la siguiente tool. PROHIBIDO planear 8 lecturas de golpe.",
        "- NO cierres en segundos ni copies una plantilla: investiga de verdad hasta tener hallazgos.",
        "ROADMAP.md: no lo uses como fuente de hallazgos; EditCore lo actualiza solo como indice compacto.",
        "PROHIBIDO inventar stacks que no esten en package.json o codigo leido.",
        "PROHIBIDO run_command lint/test/build en modo analisis.",
        "Cuando la cobertura minima este cubierta, escribe el REPORTE FINAL con: ## Qué sí funcionó, ## Mapa, ## Qué falló, ## Qué falta para que funcione, ## Evidencia, ## Cómo lo corregiré.",
      ].join("\n"));
  }

  /**
   * Publica en el chat el avance de 1 tool de analisis (archivo/carpeta).
   * Cada pocos pasos: compacta conversacion + checkpoint ROADMAP (ahorro tokens).
   */
  emitAnalysisStepProgress(input, name, toolInput, result) {
    const note = formatIncrementalAnalysisNote(name, toolInput || {}, result);
    if (!note) return;
    input?.onProgress?.({
      phase: "narration_delta",
      stage: "analysis_step",
      index: Array.isArray(this.steps) ? this.steps.length : 0,
      text: note,
    });
    const rel = String(toolInput?.path || toolInput?.filePath || name || "").replace(/\\/g, "/") || name;
    input?.onProgress?.({
      phase: "model",
      text: `Analizado: ${rel === "." ? "raíz" : rel}`,
    });
    this.maybeCompactAndCheckpointAnalysis(input);
  }

  /**
   * Compactacion preventiva + ROADMAP checkpoint mid-run.
   */
  maybeCompactAndCheckpointAnalysis(input) {
    if (input?.analysisMode !== true || !this.conversation) return;
    this._analysisToolsSinceCheckpoint = (this._analysisToolsSinceCheckpoint || 0) + 1;
    const every = 3;
    if (this._analysisToolsSinceCheckpoint < every) return;
    this._analysisToolsSinceCheckpoint = 0;

    const limit = Number(this.harnessProfile?.conversation?.maxChars) || this.conversation.maxChars || 48_000;
    this.conversation.keepLastTurns = Math.min(
      this.conversation.keepLastTurns || 4,
      Number(this.harnessProfile?.conversation?.keepLastTurns) || 4,
    );
    const before = this.conversation.serializedLength();
    let didCompact = false;
    // Compactar de forma preventiva al 75% del techo (no esperar overflow).
    if (before > limit * 0.75) {
      const prevMax = this.conversation.maxChars;
      this.conversation.maxChars = Math.max(20_000, Math.floor(before * 0.55));
      didCompact = this.conversation.compact();
      this.conversation.maxChars = Math.min(prevMax, limit);
    } else {
      this.conversation.maxChars = limit;
      didCompact = this.conversation.compact();
    }
    if (didCompact) {
      const evidence = this.collectRunEvidence(this.steps || [], input.projectRoot || "");
      this.conversation.setEvidencePreservationBlock(formatEvidencePreservationBlock(evidence, this.runScope));
      this.conversation.appendUser([
        "EDITCORE TOKEN HARNESS: historial compactado mid-analisis.",
        "ROADMAP.md se actualiza como indice compacto (no es fuente de bugs).",
        "Continua SERIAL (1 tool → avance). No reexplore lo ya listado/leido en el resumen.",
        `Contexto: ${before} → ${this.conversation.serializedLength()} chars.`,
      ].join(" "));
      input.onProgress?.({
        phase: "model",
        text: "Compactando contexto y actualizando ROADMAP...",
      });
    }
    try {
      input.onAnalysisCheckpoint?.({
        phase: "mid",
        steps: this.steps || [],
        compacted: didCompact,
      });
    } catch {
      // ignore checkpoint errors
    }
  }

  /** Ejecuta una tool de precarga y la registra en steps + conversacion. */
  async executeSeedTool(input, steps, name, toolInput) {
    if (!this.toolExecutor?.execute || !this.conversation) return { ok: false };
    const MAX_PREPROMPT_FILE_READS = 8;
    if (name === "read_file") {
      const priorReads = steps.filter((step) => step?.name === "read_file" && step?.bootstrapped === true).length;
      if (priorReads >= MAX_PREPROMPT_FILE_READS) {
        const message = `Limite de ${MAX_PREPROMPT_FILE_READS} lecturas previas al prompt. Reduce el alcance o pide archivos concretos.`;
        input.onProgress?.({ phase: "model", text: message });
        this.conversation.appendUser(`EditCore limite de contexto: ${message}`);
        return { ok: false, skipped: true, error: message };
      }
    }
    const constraints = input.instructionConstraints || this.activeInput?.instructionConstraints || null;
    try {
      assertInstructionToolAllowed(name, toolInput || {}, constraints);
    } catch (error) {
      this.conversation.appendUser(`EditCore bloqueo precarga: ${error.message}`);
      input.onProgress?.({ phase: "model", text: error.message });
      return { ok: false, error };
    }
    const callId = `bootstrap_${name}_${steps.length}`;
    const [call] = this.conversation.appendAssistant({
      text: "",
      toolCalls: [{ id: callId, function: { name, arguments: JSON.stringify(toolInput || {}) } }],
    });
    input.onProgress?.({
      phase: "tool",
      stage: "running",
      name,
      input: toolInput,
      index: steps.length,
      bootstrapped: true,
    });
    try {
      const result = await this.toolExecutor.execute(name, toolInput);
      const step = {
        ...this.tagStepMeta(),
        name,
        input: toolInput,
        result,
        ok: true,
        index: steps.length,
        bootstrapped: true,
      };
      steps.push(step);
      this.steps = steps;
      // Registrar bootstrap en ActionRegistry para que el modelo no relea lo mismo.
      if (this.actionRegistry && READ_CACHEABLE_TOOLS.has(name)) {
        this.actionRegistry.record({ name, input: toolInput, projectRoot: input.projectRoot }, result, true);
      }
      this.refreshEvidencePreservationBlock(steps);
      this.conversation.appendToolResult(call.id, name, this.compactResult(result));
      input.onProgress?.({
        phase: "tool",
        stage: "done",
        name,
        input: toolInput,
        result,
        ok: true,
        index: steps.length - 1,
        bootstrapped: true,
      });
      if (input.analysisMode === true) {
        this.emitAnalysisStepProgress(input, name, toolInput || {}, result);
      }
      this.taskManager?.updateProgress?.(step);
      return { ok: true, result };
    } catch (error) {
      this.conversation.appendToolResult(call.id, name, { error: error.message, bootstrapped: true });
      input.onProgress?.({
        phase: "model",
        text: `Precarga ${name} no disponible; continuo con exploracion del modelo.`,
      });
      return { ok: false, error };
    }
  }

  /**
   * Walker determinista: BFS carpeta por carpeta + lecturas de codigo hasta COVERAGE_MAP ok.
   * Completa lecturas/targets del prompt primero; luego nextAnalysisWalkActions.
   */
  async ensureAnalysisEvidenceReads(input, steps) {
    if (input.promptOnlyMode || input.analysisMode !== true || !this.toolExecutor?.execute) return false;
    const projectRoot = input.projectRoot || "";
    const depthProfile = input.analysisDepth || null;
    const constraints = input.instructionConstraints || resolveInstructionConstraints(input.prompt || "");
    const baseName = (value) => String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
    const sufficiencyOpts = {
      prompt: input.prompt,
      targets: this.runScope?.analysisTargets,
      depthProfile,
    };

    // FOCO retirado: walker normal siempre.
    if (false && constraints.mode === "scoped" && constraints.allowlist.length) {
      for (const rel of constraints.allowlist) {
        const evidence0 = this.collectRunEvidence(steps, projectRoot);
        const already = (evidence0.filesRead || []).some((row) => {
          const np = normalizePath(row.path, projectRoot);
          return np === normalizePath(rel, projectRoot) || baseName(row.path) === baseName(rel);
        });
        if (already) continue;
        await this.executeSeedTool(input, steps, "read_file", { path: rel });
      }
      const evidence = this.collectRunEvidence(steps, projectRoot);
      const ok = analysisEvidenceSufficient(evidence, sufficiencyOpts).ok;
      input.onProgress?.({
        phase: "pipeline",
        text: ok ? `FOCO cubierto: ${constraints.allowlist.join(", ")}` : "FOCO: reintentando lectura...",
        pipeline: { coverage: ok ? "foco ok" : "foco pendiente", coverageState: ok ? "ok" : "run" },
      });
      return ok;
    }

    // Primero: forzar lectura de archivos nombrados en el prompt (p.ej. editcore-claude-adapter.js).
    const targets = this.runScope?.analysisTargets || extractAnalysisTargets(input.prompt || "");
    if (targets.length) {
      const evidence0 = this.collectRunEvidence(steps, projectRoot);
      const coverage = analysisTargetCoverage(input.prompt || targets.join(" "), evidence0);
      for (const missing of coverage.missing || []) {
        const base = baseName(missing);
        const candidates = [...new Set([
          missing,
          `resources/app/runtime/${base}`,
          `resources/app/${base}`,
          `runtime/${base}`,
          base,
        ].map((item) => String(item || "").replace(/\\/g, "/")).filter(Boolean))];
        for (const candidate of candidates) {
          const already = (evidence0.filesRead || []).some((row) => {
            const np = normalizePath(row.path, projectRoot);
            return np === normalizePath(candidate, projectRoot)
              || baseName(row.path) === base;
          });
          if (already) break;
          const seeded = await this.executeSeedTool(input, steps, "read_file", { path: candidate });
          if (seeded.ok) break;
        }
      }
    }

    const deep = isDeepOrHeavier(depthProfile?.depth || "");
    // Limitar lecturas previas al prompt para no saturar contexto ni provocar 524.
    const maxSteps = deep ? 6 : 4;
    for (let attempt = 0; attempt < maxSteps; attempt += 1) {
      const evidence = this.collectRunEvidence(steps, projectRoot);
      if (analysisEvidenceSufficient(evidence, sufficiencyOpts).ok) {
        const map = evidence.coverage || buildAnalysisCoverageMap(evidence, sufficiencyOpts);
        input.onProgress?.({
          phase: "pipeline",
          text: map.summary || "Cobertura minima alcanzada",
          pipeline: {
            coverage: map.summary,
            coveragePercent: map.percent,
            coverageState: map.ok ? "ok" : "run",
          },
        });
        await this.seedAnalysisDiagnostics(input, steps);
        return true;
      }

      const actions = nextAnalysisWalkActions(evidence, sufficiencyOpts);
      if (!actions.length) break;

      input.onProgress?.({
        phase: "pipeline",
        text: `Walker cobertura: ${(evidence.coverage || buildAnalysisCoverageMap(evidence, sufficiencyOpts)).summary}`,
        pipeline: {
          coverage: (evidence.coverage || buildAnalysisCoverageMap(evidence, sufficiencyOpts)).summary,
          coveragePercent: (evidence.coverage || buildAnalysisCoverageMap(evidence, sufficiencyOpts)).percent,
          coverageState: "run",
        },
      });

      const action = actions[0];
      await this.executeSeedTool(input, steps, action.name, action.input || {});
    }

    const finalEvidence = this.collectRunEvidence(steps, projectRoot);
    const ok = analysisEvidenceSufficient(finalEvidence, sufficiencyOpts).ok;
    if (ok) {
      await this.seedAnalysisDiagnostics(input, steps);
    } else if (this.conversation) {
      this.conversation.appendUser([
        "EDITCORE WALKER: cobertura aun insuficiente tras exploracion automatica.",
        formatCoverageBlock(finalEvidence, sufficiencyOpts),
        "Continua list_files/read_file/search_files sobre las pendientes. PROHIBIDO cerrar con reporte hueco.",
      ].join("\n"));
    }
    return ok;
  }

  /**
   * Dispatcher: sincroniza cola y anuncia FOCO actual (PROCEDE).
   */
  refreshFixQueueFocus(input, steps, { forceAppend = false } = {}) {
    if (input?.planAuthorized !== true) return null;
    const synced = syncFixQueueWithSteps(this.fixQueue || [], steps || [], input.projectRoot || "");
    this.fixQueue = synced.queue;
    input.fixQueue = synced.queue;
    const key = `${synced.current?.target || ""}:${synced.verifiedCount}:${synced.remainingCount}`;
    if (forceAppend || (this._lastFixQueueKey !== key && (synced.current || synced.done))) {
      this._lastFixQueueKey = key;
      this.conversation?.appendUser(formatFixQueueBlock(synced.queue, {
        focusOnly: !synced.done,
        steps,
        projectRoot: input.projectRoot || "",
      }));
    }
    if (synced.summary) {
      input.onProgress?.({
        phase: "pipeline",
        text: synced.summary,
        pipeline: {
          queueSummary: synced.summary,
          queueFocus: synced.current?.target || "",
          queueVerified: synced.verifiedCount,
          queueTotal: (synced.queue || []).length,
          queueDone: synced.done === true,
          queueState: synced.done ? "ok" : "run",
        },
      });
    }
    return synced;
  }

  /**
   * Tras cobertura: 1 typecheck acotado (tsc --noEmit / npm run typecheck).
   * No lint/build. Resultados alimentan hallazgos del reporte.
   */
  async seedAnalysisDiagnostics(input, steps) {
    if (this.analysisDiagnosticSeeded) return false;
    if (input.promptOnlyMode || input.analysisMode !== true || input.planAuthorized === true) return false;
    if (input.instructionConstraints?.mode === "scoped" || input.analysisDepth?.scopedFocus) return false;
    if (!this.toolExecutor?.execute) return false;

    const evidence = this.collectRunEvidence(steps, input.projectRoot || "");
    if (!analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok) return false;

    input.analysisDiagnosticAllowed = true;
    this.analysisDiagnosticSeeded = true;

    const already = (steps || []).some((step) => {
      if (String(step?.name || "") !== "run_command") return false;
      try {
        return require("../command-policy").isAcotadoDiagnosticCommand(String(step?.input?.command || ""));
      } catch {
        return /\b(?:tsc\b.*--noEmit|typecheck)\b/i.test(String(step?.input?.command || ""));
      }
    });
    if (already) {
      this.conversation?.appendUser("DIAGNOSTICO ACOTADO: ya hay typecheck en esta corrida. Incluye errores TS en el reporte.");
      return true;
    }

    const command = resolveAnalysisDiagnosticCommand(evidence);
    if (!command) {
      this.conversation?.appendUser(
        "DIAGNOSTICO ACOTADO: no hay tsconfig/typecheck detectable. Continua el REPORTE con evidencia de lectura/busqueda."
      );
      return false;
    }

    input.onProgress?.({
      phase: "pipeline",
      text: `Diagnostico acotado: ${command}...`,
      pipeline: { diagnostic: "running", diagnosticDetail: command, diagnosticState: "run" },
    });
    const seeded = await this.executeSeedTool(input, steps, "run_command", { command });
    const out = String(seeded?.result?.output || seeded?.result?.stderr || seeded?.error?.message || "").replace(/\s+/g, " ").slice(0, 500);
    const failed = /error TS|FAILED|exit code [^0]/i.test(out) || seeded.ok === false;
    input.onProgress?.({
      phase: "pipeline",
      text: `Diagnostico acotado: ${command} → ${failed ? "fallo" : "ok"}`,
      pipeline: {
        diagnostic: failed ? "fail" : "ok",
        diagnosticDetail: `${command} → ${failed ? "fallo" : "ok"}`,
        diagnosticState: failed ? "fail" : "ok",
      },
    });
    this.conversation?.appendUser([
      `DIAGNOSTICO ACOTADO EJECUTADO: \`${command}\` → ${seeded.ok ? "ok/con salida" : "fallo"}.`,
      out ? `Salida (recorte): ${out}` : "Sin salida capturada.",
      "Incluye errores TypeScript reales en ## Qué falló. PROHIBIDO lint/build. Escribe el REPORTE FINAL.",
    ].join("\n"));
    return Boolean(seeded.ok || seeded.result);
  }

  /**
   * Ejecuta una accion exclusivamente mediante el despachador autorizado.
   */
  async executeWithFallback(action) {
    const input = this.activeInput || {};
    if (input.promptOnlyMode && isFilesystemTool(action?.name)) {
      const error = new Error("Responde analizando el mensaje del usuario; no explores el disco en esta fase.");
      error.code = "PROMPT_ONLY_BLOCKED_TOOL";
      throw error;
    }
    assertInstructionToolAllowed(
      action?.name,
      action?.input || {},
      input.instructionConstraints || null,
    );
    return await this.toolExecutor.execute(action.name, action.input);
  }

  /**
   * Detecta loops comparando secuencias de acciones
   */
  detectLoop(steps) {
    if (steps.length < 10) return false;
    // BUG 2 FIX: Comparar la firma COMPLETA (nombre + argumentos), no solo el nombre.
    // Cinco read_file con paths diferentes es exploración legítima, NO un loop.
    // Solo es un loop si la secuencia de acciones Y argumentos es exactamente igual.
    const sig = (s) => `${s.name}:${JSON.stringify(s.input || {})}`;
    const recent = steps.slice(-5).map(sig).join("|");
    const previous = steps.slice(-10, -5).map(sig).join("|");
    return recent === previous && recent.length > 0;
  }

  hasCompletionEvidence(steps, input = {}) {
    if (!steps.length) return false;
    const blockingFailures = steps.filter((step) => {
      if (step.ok === true && !step.result?.error) return false;
      if (input.analysisMode === true && this.isRecoverableAnalysisFailure(step)) return false;
      return true;
    });
    if (blockingFailures.length) return false;
    if (input.promptOnlyMode === true) {
      return steps.some((step) => step.ok !== false && step.name === "direction")
        || steps.some((step) => step.ok !== false && !isFilesystemTool(step.name));
    }
    if (input.analysisMode === true) {
      const projectRoot = input.projectRoot || "";
      const meaningful = steps.filter((step) => step.ok !== false && !isShallowReadStep(step, projectRoot));
      const realReads = meaningful.filter((step) => step.name === "read_file" && step.result?.isDirectory !== true);
      const evidence = this.collectRunEvidence(steps, projectRoot);
      const sufficiencyOpts = this.analysisSufficiencyOpts(input);
      const needed = requiredConcreteReads(evidence, sufficiencyOpts);
      if (realReads.length < needed) return false;
      if (!analysisEvidenceSufficient(evidence, sufficiencyOpts).ok) return false;
    }
    const evidenceTools = new Set(["list_files", "read_file", "search_files", "run_command", "inspect_preview", "project_discovery"]);
    if (!input.promptOnlyMode && !steps.some((step) => evidenceTools.has(step.name))) return false;
    const mutationTools = new Set(["write_file", "replace_in_file", "create_pdf", "create_word", "create_excel", "create_csv"]);
    const lastMutation = steps.reduce((last, step, index) => mutationTools.has(step.name) ? index : last, -1);
    if (lastMutation < 0) return true;
    return steps.slice(lastMutation + 1).some((step) => ["read_file", "run_command", "inspect_preview"].includes(step.name));
  }

  isRecoverableAnalysisFailure(step) {
    if (!step || step.ok === true) return false;
    const name = String(step.name || "");
    const error = String(step.result?.error || step.error || "");
    if (["brain_tools", "brain_search", "brain_skill"].includes(name)) return true;
    if (name === "read_file" && /ENOENT|no such file|no existe|no encontrado|cannot find|PATH_NOT_DISCOVERED|no aparecio al listar|Path no descubierto|Antes de leer/i.test(error)) return true;
    if (name === "run_command" && /ANALYSIS_BLOCKED_TOOL|modo diagnostico|missing script|no scripts|not found|command not found|not recognized|is not recognized|no esta disponible|list_files|Argumentos de listado/i.test(error)) return true;
    return false;
  }

  isRecoverableTaskFailure(step) {
    if (!step || step.ok === true) return false;
    const error = String(step.result?.error || step.error || "");
    return /oldText.*no existe|vuelve a leer|lee .* antes de modificar|ya existe\. Ejecuta read_file|cambio desde la ultima lectura|comando no permitido|argumentos? .*no permitid|script no permitido|spawn EINVAL|ENOENT|not found|not recognized|timeout|temporalmente|unavailable|rate limit|reintenta/i.test(error);
  }

  stageForSteps(steps) {
    if (!steps.length) return "discovery";
    const mutationTools = new Set(["write_file", "replace_in_file", "create_pdf", "create_word", "create_excel", "create_csv"]);
    return steps.some((step) => mutationTools.has(step.name)) ? "verification" : "analysis";
  }

  shouldBlockBrainLoop(steps, action) {
    const name = String(action?.name || "");
    if (!/^brain_/i.test(name)) return "";
    const brainCount = (steps || []).filter((step) => /^brain_/i.test(String(step.name || ""))).length;
    if (brainCount < 2) return "";
    return "Ya consultaste el Cerebro. Usa herramientas del proyecto (list_files, read_file, write_file). No repitas brain_search.";
  }

  shouldForceImplementation(input, requirements, steps, action) {
    // BUG 7 FIX: doble protección. Si allowWrite no es exactamente true, nunca forzar.
    if (!requirements.write || input.analysisMode === true || input.allowWrite === false || input.allowWrite !== true) return false;
    if (steps.some((step) => classifyAgentStep(step) === "mutation")) return false;
    const discoveryTools = new Set(["list_files", "read_file", "search_files", "project_discovery", "codebase_map", "symbol_search", "dependency_search", "brain_search", "brain_tools", "brain_skill"]);
    if (!discoveryTools.has(String(action?.name || ""))) return false;
    const successfulDiscovery = steps
      .filter((step) => step?.ok !== false && !step?.result?.error)
      .filter((step) => ["discovery", "other"].includes(classifyAgentStep(step)) || discoveryTools.has(step.name));
    const distinctEvidence = new Set(successfulDiscovery.map((step) => `${step.name}:${JSON.stringify(step.input || {})}`)).size;
    if (input.runProfile?.greenfieldCreate === true || input.orchestratorPlan?.greenfieldCreate === true) {
      return distinctEvidence >= 0;
    }
    // Tras PROCEDE/planAuthorized: no permitir bucles eternos de exploracion.
    const threshold = input.planAuthorized === true
      ? Math.max(2, Number(requirements.minimumEvidence || 2))
      : Math.max(3, Number(requirements.minimumEvidence || 3));
    const brainCount = steps.filter((step) => /^brain_/i.test(String(step.name || ""))).length;
    if (brainCount >= 2) return true;
    return distinctEvidence >= threshold;
  }

  shouldBlockGreenfieldWaste(input, action) {
    if (input.cursorParityMode === true || input.runProfile?.cursorParityMode === true) return "";
    if (input.permissionMode === "full" || input.runProfile?.permissionFull === true) return "";
    if (!(input.runProfile?.greenfieldCreate === true || input.orchestratorPlan?.greenfieldCreate === true)) return "";
    const toolName = String(action?.name || "");
    if (toolName === "list_files") {
      const listPath = String(action?.input?.path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
      if (listPath && listPath !== ".") {
        return "En creacion de proyecto no listes subcarpetas que aun no existen. Crea archivos con write_file (src/, app/, prisma/, etc.).";
      }
    }
    if (toolName !== "run_command") return "";
    const command = String(action?.input?.command || "").trim();
    if (!command) return "";
    if (/[&|;]/.test(command)) {
      return "En creacion de proyecto ejecuta UN solo comando por run_command (sin && ni |). Usa write_file para avanzar.";
    }
    if (/\b(node|npm|npx|pnpm|bun)\b.*\b(--version|-v)\b/i.test(command)) {
      return "No compruebes versiones del entorno. Escribe archivos del proyecto con write_file.";
    }
    if (/\b(git|python|py|docker|psql|redis|redis-cli|kubectl)\b/i.test(command) && !/\bnpm (install|run)\b/i.test(command)) {
      return "No audites el entorno en greenfield. Crea archivos del proyecto y luego npm install / npm run dev.";
    }
    return "";
  }

  /** En analisis forense/profundo, lint/test/build queman el presupuesto y el tope de minutos. */
  shouldBlockAnalysisHeavyCommand(input, action) {
    if (input.planAuthorized === true) return "";
    const toolName = String(action?.name || "");
    let forbidHeavy = input.analysisMode === true;
    try {
      const {
        shouldBlockHeavyVerification,
        isAnalysisHeavyVerificationCommand,
        isAcotadoDiagnosticCommand,
      } = require("../command-policy");
      forbidHeavy = shouldBlockHeavyVerification({
        analysisMode: input.analysisMode === true,
        planAuthorized: input.planAuthorized === true,
        prompt: String(input.prompt || ""),
        goal: String(input.originalGoal || input.persistedGoal || ""),
        task: String(input.task || ""),
      });
      const command = String(action?.input?.command || "");
      const allowDiag = input.analysisDiagnosticAllowed === true && isAcotadoDiagnosticCommand(command);
      if (toolName === "run_command" && forbidHeavy && isAnalysisHeavyVerificationCommand(command) && !allowDiag) {
        return "MODO ANALISIS: PROHIBIDO lint/test/build. Ya tienes evidencia en disco; escribe el REPORTE FINAL. Typecheck acotado solo tras cobertura; lint solo tras PROCEDE.";
      }
    } catch {
      /* fallback abajo */
    }
    if (!forbidHeavy && input.analysisMode !== true) return "";
    if (toolName === "run_diagnostics") {
      return "MODO ANALISIS: PROHIBIDO run_diagnostics. Usa search_files/read_file y escribe el REPORTE FINAL.";
    }
    if (["run_subagent", "run_parallel_explore", "brain_search", "brain_skill", "brain_tools", "brain_install_repo"].includes(toolName)) {
      try {
        const evidence = this.collectRunEvidence(this.steps || [], input.projectRoot || "");
        if (analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input)).ok
          || Number(evidence.realFileReadCount || 0) >= 10) {
          return "MODO ANALISIS: ya hay evidencia suficiente. PROHIBIDO Cerebro/subagent. Escribe el REPORTE FINAL ahora.";
        }
      } catch { /* ignore */ }
    }
    if (toolName !== "run_command") return "";
    const command = String(action?.input?.command || "").trim();
    if (!command) return "";
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|test|build|check|typecheck|verify|dev|start|preview)\b/i.test(command)
      || /\b(?:npx\s+)?(?:eslint|tsc|vitest|jest)\b/i.test(command)
      || /\bnode\s+--test\b/i.test(command)
      || /\blint\b/i.test(command)) {
      return "MODO ANALISIS: PROHIBIDO lint/test/build. Ya tienes evidencia en disco; escribe el REPORTE FINAL. Lint solo tras PROCEDE.";
    }
    return "";
  }

  executionEvidenceOptions(input = {}) {
    return {
      requireDiagnosticVerify: input.planAuthorized === true,
    };
  }

  finalizeAnalysisText(input, steps, candidateText = "") {
    return this.finalizeAnalysisOnce(input, steps, candidateText);
  }

  finalizeExecutionText(input, steps, candidateText = "") {
    if (input.listOnly === true || input.runProfile?.listOnly === true) {
      const listing = formatListOnlyAnswerFromSteps(steps, input.projectRoot || "", input.prompt || "");
      if (listing) return listing;
      if (looksLikeNoMutationMessage(candidateText) || looksLikeForensicListDrift(candidateText)) {
        return listing || String(candidateText || "").trim() || "No se pudo listar la carpeta.";
      }
      return String(candidateText || "").trim();
    }
    if (input.analysisMode === true || input.allowWrite !== true) return candidateText;
    const requirements = agentTaskRequirements(input.prompt, true, { planAuthorized: input.planAuthorized === true });
    const requiresMutation = input.planAuthorized === true || requirements.write === true
      || input.runProfile?.greenfieldCreate === true || input.orchestratorPlan?.greenfieldCreate === true;
    if (!requiresMutation) return candidateText;
    if (!hasMutationEvidence(steps)) {
      const simulated = narrationLooksLikeSimulatedWork(candidateText, steps, input.projectRoot || "", { requiresWrite: true });
      if (simulated || String(candidateText || "").trim()) {
        return [
          "## Sin cambios reales en disco",
          "",
          "EditCore no muestra progreso simulado. No hubo write_file/replace_in_file exitoso en esta corrida.",
          "Reenvia la orden con **crea** o **procede** para que el agente escriba archivos de verdad.",
        ].join("\n");
      }
      return candidateText;
    }
    const grounded = buildExecutionEvidenceReport(
      candidateText,
      steps,
      input.projectRoot || "",
      this.executionEvidenceOptions(input),
    );
    return grounded.text;
  }

  hasValidatedTaskEvidence(input, steps) {
    if (!steps.length) return false;
    const validation = validateAgentCompletion(input.prompt, steps, input.allowWrite !== false, {
      analysisMode: input.analysisMode === true,
      projectRoot: input.projectRoot,
      planAuthorized: input.planAuthorized === true,
    });
    if (!validation.ok) return false;
    const requiresMutation = input.planAuthorized === true || validation.requirements?.write === true;
    if (input.analysisMode !== true && input.allowWrite === true && requiresMutation) {
      if (!buildExecutionEvidenceReport("", steps, input.projectRoot || "", this.executionEvidenceOptions(input)).ok) return false;
    }
    const uiOneShot = input.runProfile?.uiOneShot === true || input.orchestratorPlan?.uiOneShot === true;
    if (uiOneShot) {
      return evaluateOneShotFromSteps(steps).ok;
    }
    return true;
  }

  canCompleteFromEvidence(input, requirements, steps) {
    if (requirements.write || input.allowWrite === false && requirements.verification) return false;
    if (!steps.length || steps.some((step) => step.ok !== true)) return false;
    const evidenceTools = new Set(["list_files", "read_file", "search_files", "run_command", "inspect_preview", "project_discovery"]);
    const distinctEvidence = new Set(steps
      .filter((step) => evidenceTools.has(step.name))
      .map((step) => `${step.name}:${JSON.stringify(step.input || {})}`)).size;
    if (distinctEvidence < Math.max(4, Number(requirements.minimumEvidence || 4))) return false;
    const validation = input.enforceController
      ? validateAgentCompletion(input.prompt, steps, input.allowWrite !== false, { analysisMode: input.analysisMode === true, projectRoot: input.projectRoot, planAuthorized: input.planAuthorized === true })
      : null;
    if (validation && !validation.ok) return false;
    return this.hasCompletionEvidence(steps, input);
  }

  evidenceFinalText(input, steps) {
    // Nunca usar este meta-cierre para analisis/reporte: es el primer punto de falla a mitad.
    if (input?.analysisMode === true) {
      return this.buildAnalysisFallbackReport(input, steps);
    }
    const counts = new Map();
    for (const step of steps) counts.set(step.name, (counts.get(step.name) || 0) + 1);
    const details = [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ");
    const targets = steps
      .map((step) => step.input?.path || step.input?.query || step.input?.command || "")
      .filter(Boolean)
      .slice(-8);
    const suffix = targets.length ? ` Evidencia final revisada: ${targets.join("; ")}.` : "";
    return `Verificacion completada con evidencia real del proyecto. Acciones ejecutadas: ${steps.length}${details ? ` (${details})` : ""}.${suffix}`;
  }

  /** neverEvidenceFinalForAnalysis: helper de tests / cierre seguro. */
  neverEvidenceFinalForAnalysis(input, steps, candidate = "") {
    const text = String(candidate || "");
    if (input?.analysisMode === true || /Verificacion completada con evidencia real/i.test(text)) {
      return this.finalizeAnalysisOnce(input, steps, reportLooksComplete(text) ? text : "");
    }
    return text;
  }

  buildAnalysisFallbackReport(input, steps) {
    const evidence = collectToolEvidence(steps, input.projectRoot || "", this.runScope);
    return buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
  }

  async requestAnalysisReport(input, steps, { appendPrompt = true } = {}) {
    // El informe lo redacta el MODELO (investigacion). La plantilla local solo
    // es rescate si el proveedor falla o no entrega texto util.
    const evidence = this.collectRunEvidence(steps);
    const sufficiency = analysisEvidenceSufficient(evidence, this.analysisSufficiencyOpts(input));
    if (!sufficiency.ok) {
      if (appendPrompt) {
        this.conversation.appendUser(
          `VALIDACION DE EDITCORE: No hay evidencia suficiente para el reporte. ${sufficiency.reasons.join(" ")} Usa list_files/search_files y read_file sobre archivos concretos.`
        );
      }
      return "";
    }
    if (appendPrompt) {
      this.conversation.appendUser(analysisReportPromptForEvidence(evidence));
    }
    input.onProgress?.({ phase: "model", text: "El modelo redacta el informe de investigacion..." });
    const prevForce = this.forceTextOnlyClose;
    this.forceTextOnlyClose = true;
    try {
      const turn = await this.getNextTurn(input, steps);
      const text = String(turn?.text || "").trim();
      if (text.length >= 120 && (reportLooksComplete(text) || isAnalysisReport(text))) {
        return text;
      }
      if (text.length >= 400) {
        return text;
      }
      this.logger.warn("⚠️ [Analisis] El modelo no entrego informe util; rescate con plantilla anclada a evidencia.");
      return buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
    } catch (error) {
      this.logger.warn(`⚠️ [Analisis] Fallo al pedir informe al modelo: ${String(error?.message || error).slice(0, 160)}`);
      return buildGroundedAnalysisReport(evidence, input.projectRoot || "", { prompt: input.prompt || "", depthProfile: input.analysisDepth || null });
    } finally {
      this.forceTextOnlyClose = prevForce;
    }
  }

  incompleteResultText(finalText, stopReason, steps, input = {}) {
    if (input.listOnly === true || input.runProfile?.listOnly === true) {
      const listing = formatListOnlyAnswerFromSteps(steps, input.projectRoot || "", input.prompt || "");
      if (listing) return listing;
    }
    const failed = steps.filter((step) => step.ok !== true);
    const successful = steps.length - failed.length;
    const summary = `No se pudo completar ni verificar la solicitud. Se confirmaron ${successful} accion(es) y fallaron ${failed.length}. Motivo: ${stopReason || "la ejecucion termino sin evidencia suficiente."}`;
    const honest = !hasMutationEvidence(steps) && input.analysisMode !== true && input.listOnly !== true
      ? `${summary}\n\nNo hubo cambios reales en disco. EditCore no muestra trabajo simulado.`
      : summary;
    const partialLabel = input.analysisMode === true ? "Resultado parcial del analisis" : "Resultado parcial";
    const partial = finalText
      && !narrationClaimsWriteToolsMissing(finalText)
      && !narrationLooksLikeSimulatedWork(finalText, steps, input.projectRoot || "", { requiresWrite: input.allowWrite === true && input.analysisMode !== true && input.listOnly !== true })
      ? `\n\n${partialLabel}:\n${finalText}`
      : "";
    return `${honest}${partial}`;
  }

  /**
   * Obtiene el siguiente turno del modelo sobre la conversacion viva.
   */
  async getNextTurn(input, steps) {
    if (!this.providerApi) {
      throw new Error("providerApi no configurado");
    }

    this._modelWaitNudgeSent = false;
    const messages = this.conversation.toProviderMessages();
    const tools = this.getAvailableTools(input);

    this.providerCalls += 1;
    let streamedText = "";
    let streamMode = "pending";
    let waitSeconds = 0;
    let lastTokenAt = Date.now();
    const stepTimeoutMs = 180_000;
    const idleLimitMs = input.analysisMode === true ? 45_000 : 60_000;
    const waitTicker = setInterval(() => {
      waitSeconds += 2;
      if (streamedText) {
        const idleSec = Math.max(0, Math.floor((Date.now() - lastTokenAt) / 1000));
        if (idleSec >= 8) {
          input.onProgress?.({
            phase: "model",
            text: `Trabajando…`,
          });
        }
        return;
      }
      input.onProgress?.({
        phase: "model",
        text: `Trabajando…`,
      });
    }, 2_000);
    let lastExtractedThought = "";
    const onTextDelta = (delta) => {
      const value = String(delta || "");
      if (!value) return;
      lastTokenAt = Date.now();
      const beforeLen = streamedText.length;
      streamedText += value;
      const trimmed = streamedText.trimStart();
      if (streamMode === "pending" && trimmed) {
        streamMode = /^(?:\{|\[|<(?:tool|function)|```json)/i.test(trimmed) ? "protocol" : "narration";
      }
      // Prosa + luego <tool_call>: cortar mid-stream (nunca volcar XML/código al chat).
      if (streamMode === "narration") {
        const cut = streamedText.search(/<(?:tool_call|tool_use|function\s*=|parameter\s*=)\b/i);
        if (cut >= 0) {
          streamMode = "protocol";
          if (cut > beforeLen) {
            const visiblePiece = value.slice(0, cut - beforeLen);
            if (visiblePiece) {
              input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: visiblePiece });
            }
          }
          if (!this._modelWaitNudgeSent) {
            this._modelWaitNudgeSent = true;
            input.onProgress?.({ phase: "model", text: "Ejecutando herramienta…" });
          }
          return;
        }
        input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: value });
        return;
      }
      if (streamMode === "protocol") {
        const thoughtMatch = streamedText.match(/"(?:thought|reasoning|analysis|thinking)"\s*:\s*"((?:[^"\\]|\\.)*)"/i)
          || streamedText.match(/<(?:thinking|thought|reasoning)>([\s\S]*?)(?:<\/(?:thinking|thought|reasoning)>|$)/i);
        if (thoughtMatch && thoughtMatch[1]) {
          const currentThought = thoughtMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
          if (currentThought && currentThought !== lastExtractedThought) {
            const deltaThought = currentThought.startsWith(lastExtractedThought)
              ? currentThought.slice(lastExtractedThought.length)
              : currentThought;
            lastExtractedThought = currentThought;
            if (deltaThought) {
              input.onProgress?.({ phase: "narration_delta", stage: this.stageForSteps(steps), index: steps.length, text: deltaThought });
            }
          }
        } else if (!this._modelWaitNudgeSent) {
          this._modelWaitNudgeSent = true;
          input.onProgress?.({
            phase: "model",
            text: "Trabajando…",
          });
        }
      }
    };
    let response;
    const stepController = new AbortController();
    const abortStep = (message) => {
      const err = new Error(message);
      err.code = "PROVIDER_TIMEOUT";
      try { stepController.abort(err); } catch { /* ignore */ }
      return err;
    };
    const wallTimer = setTimeout(() => {
      abortStep(`Timeout del modelo tras ${Math.round(stepTimeoutMs / 1000)}s sin respuesta completa.`);
    }, stepTimeoutMs);
    if (typeof waitTicker?.unref === "function") waitTicker.unref();
    if (typeof wallTimer?.unref === "function") wallTimer.unref();
    const idleTimer = setInterval(() => {
      if (!streamedText) return;
      if (Date.now() - lastTokenAt >= idleLimitMs) {
        abortStep(`Stream del modelo sin tokens nuevos por ${Math.round(idleLimitMs / 1000)}s.`);
      }
    }, 1_000);
    if (typeof idleTimer?.unref === "function") idleTimer.unref();
    const mergedSignal = input.signal
      ? AbortSignal.any([input.signal, stepController.signal])
      : stepController.signal;

    // Circuit Breaker Step 1: Pre-flight check
    const cbCheck = this._checkCircuitBreaker();
    if (!cbCheck.allowed) {
      const error = new Error(cbCheck.reason);
      error.code = "CIRCUIT_BREAKER_OPEN";
      throw error;
    }

    let watchTimer = null;
    let hardTimeoutTimer = null;
    try {
      const callPromise = this.providerApi.call({
        model: input.model,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        messages: messages,
        tools: tools,
        signal: mergedSignal,
        rawToolCalls: true,
        onTextDelta,
      });
      // Promise.race: aunque Electron ignore abort del body, el loop no se queda eterno.
      response = await Promise.race([
        callPromise,
        new Promise((_, reject) => {
          watchTimer = setInterval(() => {
            if (!stepController.signal.aborted) return;
            if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
            reject(stepController.signal.reason || abortStep("PROVIDER_TIMEOUT"));
          }, 400);
          if (typeof watchTimer?.unref === "function") watchTimer.unref();

          hardTimeoutTimer = setTimeout(() => {
            if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
            reject(abortStep(`Timeout duro del modelo (${Math.round(stepTimeoutMs / 1000)}s).`));
          }, stepTimeoutMs + 1500);
          if (typeof hardTimeoutTimer?.unref === "function") hardTimeoutTimer.unref();
        }),
      ]);
    } finally {
      if (watchTimer) clearInterval(watchTimer);
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      clearTimeout(wallTimer);
      clearInterval(idleTimer);
      clearInterval(waitTicker);
    }
    if (!response) {
      const error = new Error("El proveedor no devolvio respuesta.");
      error.code = "PROVIDER_EMPTY";
      throw error;
    }

    // Estimar tokens usados (considerando cache). Si el proveedor no reporta uso,
    // usamos una estimacion baja para no cortar tareas reales por medicion local.
    const tokensUsed = response.usage?.total_tokens || response.usage?.confirmed_input_tokens || response.usage?.estimated_input_tokens || 250;
    const cacheHits = response.usage?.provider_cache_read_tokens || response.usage?.cache_read_input_tokens || response.usage?.cachedInputTokens || response.usage?.cached_tokens || 0;
    const cacheWrites = response.usage?.cache_creation_input_tokens || 0;

    // Acumular el uso normalizado real para el pie del chat y las metricas.
    this.usageTotals.confirmed_input_tokens += Number(response.usage?.confirmed_input_tokens) || 0;
    this.usageTotals.confirmed_output_tokens += Number(response.usage?.confirmed_output_tokens) || 0;
    this.usageTotals.estimated_input_tokens += Number(response.usage?.estimated_input_tokens) || 0;
    this.usageTotals.estimated_output_tokens += Number(response.usage?.estimated_output_tokens) || 0;
    this.usageTotals.provider_cache_read_tokens += Number(cacheHits) || 0;
    this.usageTotals.peak_request_input_tokens_estimate = Math.max(
      this.usageTotals.peak_request_input_tokens_estimate,
      Number(response.usage?.request_input_tokens_estimate) || 0
    );

    this.tokensUsed += tokensUsed;

    // Actualizar presupuesto adaptativo
    this.adaptiveBudget.spend(tokensUsed);

    // Registrar en token ledger
    this.tokenLedger.record('model_call', tokensUsed, 0, {
      cached: cacheHits > 0,
      cacheCreated: cacheWrites,
    });

    // Log de ahorro por cache
    if (cacheHits > 0) {
      const savingsPercent = Math.round((cacheHits / tokensUsed) * 100);
      this.logger.log(`⚡ [Cache] Ahorro: ${cacheHits} tokens (${savingsPercent}%)`);
    }

    return {
      text: String(response.text || ""),
      toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
      usage: response.usage || {},
      decisionSource: response.decisionSource || "provider",
    };
  }

  /**
   * Circuit Breaker: check if provider calls are allowed.
   * Step 1 of 4: Pre-flight state check.
   * Returns { allowed: boolean, reason?: string }
   */
  _checkCircuitBreaker() {
    const cb = this.circuitBreaker;
    if (!cb) return { allowed: true };

    if (cb.state === "OPEN") {
      const elapsed = Date.now() - cb.openedAt;
      if (elapsed >= cb.cooldownMs) {
        // Transition to HALF_OPEN: allow one probe call
        cb.state = "HALF_OPEN";
        this.logger.log?.(`⚡ [CircuitBreaker] OPEN → HALF_OPEN (cooldown ${Math.round(elapsed / 1000)}s elapsed). Probing provider...`);
        return { allowed: true };
      }
      const remaining = Math.round((cb.cooldownMs - elapsed) / 1000);
      this.logger.warn?.(`⛔ [CircuitBreaker] OPEN — provider calls blocked. Retry in ${remaining}s. (failures: ${cb.failures}/${cb.threshold})`);
      return {
        allowed: false,
        reason: `Circuit breaker OPEN: provider unreachable. ${cb.failures} consecutive failures. Retry in ${remaining}s.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Circuit Breaker Step 3: Record success — reset failure count, close circuit.
   */
  _recordCircuitBreakerSuccess() {
    const cb = this.circuitBreaker;
    if (!cb) return;
    const prevState = cb.state;
    cb.failures = 0;
    cb.lastSuccessAt = Date.now();
    if (cb.state !== "CLOSED") {
      cb.state = "CLOSED";
      this.logger.log?.(`✅ [CircuitBreaker] ${prevState} → CLOSED (provider recovered).`);
    }
  }

  /**
   * Circuit Breaker Step 4: Record failure — increment count, open circuit if threshold hit.
   */
  _recordCircuitBreakerFailure(error) {
    const cb = this.circuitBreaker;
    if (!cb) return;
    cb.failures += 1;
    cb.lastFailureAt = Date.now();

    if (cb.state === "HALF_OPEN") {
      // Probe failed: reopen immediately
      cb.state = "OPEN";
      cb.openedAt = Date.now();
      this.logger.warn?.(`⛔ [CircuitBreaker] HALF_OPEN → OPEN (probe failed: ${String(error?.message || error).slice(0, 120)}).`);
      return;
    }

    if (cb.failures >= cb.threshold && cb.state === "CLOSED") {
      cb.state = "OPEN";
      cb.openedAt = Date.now();
      this.logger.warn?.(`⛔ [CircuitBreaker] CLOSED → OPEN (${cb.failures} failures >= threshold ${cb.threshold}). Blocking provider calls for ${Math.round(cb.cooldownMs / 1000)}s.`);
    } else {
      this.logger.warn?.(`⚠️ [CircuitBreaker] Failure ${cb.failures}/${cb.threshold}: ${String(error?.message || error).slice(0, 120)}`);
    }
  }

  /**
   * Compacta resultado para ahorrar tokens
   */
  compactResult(result) {
    const maxChars = Number(this.adaptiveBudget?.maxToolResultChars?.() || this.harnessProfile?.toolResultChars || 8_000);
    return clipToolResultForHarness(result, maxChars);
  }

  /**
   * Prefijo estable de la conversacion: system prompts + tarea inicial.
   * No se regenera entre iteraciones para maximizar el cache-read.
   */
  buildPrefixMessages(input) {
    const messages = [];
    const tools = this.getAvailableTools(input);
    const toolsListText = tools.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join("\n");

    if (input.listOnly === true || input.runProfile?.listOnly === true) {
      messages.push({
        role: "system",
        content: [
          {
            type: "text",
            // Prompt corto a proposito: listado no carga elite/anti (ahorra ~10k tokens).
            text: `Eres EditCore Agent. El usuario pidio SOLO listar una carpeta.
HERRAMIENTAS:
${toolsListText || "- list_files"}

Reglas:
1. Usa list_files (o el listado ya precargado) y responde con la lista.
2. PROHIBIDO analizar, reporte extenso, Qué sí funcionó, procede, o pedir PowerShell.
3. Responde en espanol: carpetas y archivos del primer nivel, con conteos.`,
            cache_control: { type: "ephemeral" },
          },
        ],
      });
      messages.push({
        role: "user",
        content: `TAREA:\n${input.prompt}\n\nPROYECTO/RUTA: ${input.projectRoot || "(ruta en el prompt)"}`,
      });
      return messages;
    }

    const permissionFullNow = input.permissionMode === "full"
      || input.runProfile?.permissionFull === true
      || input.orchestratorPlan?.permissionFull === true;

    const scopedAnalysis = false;

    const analysisGuide = input.analysisMode ? `

MODO ANALISIS (solo lectura de codigo → informe; EditCore actualiza ROADMAP.md):
${buildDepthReportGuide(input.analysisDepth || resolveAnalysisDepth(input.prompt || ""))}
1. EditCore YA precargo evidencia real. Usa esa evidencia; no inventes otra estructura.
2. Si faltan datos: list_files → read_file de codigo listado.
${permissionFullNow
    ? "3. Acceso completo activo: NO digas 'espera PROCEDE' ni 'Cuando autorices'. Aplica correcciones con tools YA."
    : "3. PROHIBIDO: run_command lint/test/build global, write_file/replace_in_file de codigo (espera PROCEDE)."}
4. PROHIBIDO decir que no tienes list_files/read_file/search_files. Nunca pidas pegar archivos.
5. ROADMAP.md: NO lo uses como fuente de bugs; NO lo reescribas tu. EditCore lo actualiza mid-run y al cierre como indice (ahorro de tokens). PROHIBIDO cerrar el analisis solo citando ROADMAP.md.
6. Usa CACHE de lecturas (no repitas). Cerebro OPCIONAL y max UNA vez; si brain_skill falla o ya hay ≥10 lecturas, IGNORALO y cierra el reporte YA.
7. Cubre funcionalidad, viabilidad, errores, soluciones y evidencia. Sin pegar bloques largos de codigo.
${permissionFullNow
    ? "8. Cierre: aplica correcciones con tools; NO pidas PROCEDE ni listes opciones para autorizar."
    : "8. Ultima linea: Cuando autorices procedo con las correcciones (omitela si el usuario dijo que no pidas PROCEDE)."}
9. Si el usuario dijo CONTINUA tras un corte por tiempo: NO reinicies el path. Reutiliza evidencia y cierra el REPORTE FINAL.` : `

MODO EJECUCION (permisos del chat — lectura/escritura segun Acceso):
${permissionFullNow ? `CONTRATO ACCESO TOTAL (permissionFullNow=${permissionFullNow}):
1. El usuario autorizo operar en su PC dentro del proyecto/rutas indicadas.
2. Usa tools reales YA. PROHIBIDO pedir PowerShell/cmd ni decir que no tienes acceso.
3. PROHIBIDO preguntar '¿Procedo?', 'Escribe procede' o '¿Deseas que proceda?' ANTES o DURANTE la tarea pedida.
4. Lee → escribe → verifica. Al FINAL: resume evidencia de mutacion. PROHIBIDO pedir PROCEDE u opciones de autorizacion.
5. Cierra con evidencia de mutacion.` : "Permisos segun el modo del chat."}
1. ORDEN OBLIGATORIO: leer archivo objetivo → replace_in_file/write_file → verificar.
2. Si el usuario dijo procede/continua, NO re-analices ni inventes un plan nuevo: corrige con herramientas.
3. Con Acceso completo el usuario autoriza entrar a su PC en las rutas que el indique (absolutas). Usa list_files/read_file/write_file sobre esas rutas. Nunca digas que no tienes acceso al disco.
4. Si pide listar/enlistar una ruta (ej. D:\\...), ejecuta list_files con esa ruta YA. PROHIBIDO pedir PowerShell/cmd al usuario.
5. Narra cada paso en ESPAÑOL antes de actuar. El reporte final DEBE incluir ## Evidencia de correccion con archivos modificados y comandos reales.
6. PROHIBIDO afirmar que corregiste algo sin write_file/replace_in_file exitoso.`;

    const greenfieldGuide = (input.runProfile?.greenfieldCreate === true || input.orchestratorPlan?.greenfieldCreate === true) ? `

MODO CREACION DE PROYECTO PROFESIONAL (GREENFIELD — PRIORIDAD MAXIMA):
1. El usuario quiere VER una aplicacion web / proyecto moderno y profesional completo con archivos en la raiz visible (README.md, package.json, vite.config.ts, tailwind.config.js, src/, public/).
2. Estandares de calidad visual y arquitectura:
   - Usa React + Vite + TypeScript + Tailwind CSS con tipografia moderna y paleta semantica (zinc/slate con acento vibrante).
   - Componentes UI modulares, accesibles y limpios (Navbar responsive con menu movil, Hero impactante, Showcase/Cards, Footer).
   - Iconos modernos con Lucide-React (lucide-react).
   - Assets visuales tematicos: fotografia de alta resolucion de stock (Unsplash tematico) y logos SVG vectoriales limpios.
   - Diseno 100% responsive probado en movil (375px) y escritorio (1440px) sin desbordamiento horizontal.
3. NO uses .editcore para el producto. NO compruebes versiones innecesarias (node/npm/git/python/docker).
4. Tras un scaffold o list_files inicial, escribe archivos en rafaga con write_file.
5. Cuando exista package.json con script dev/start: run_command "npm install" y luego run_command "npm run dev" (un comando por llamada).
6. PROHIBIDO encadenar comandos con &&.
7. Construye la aplicacion segun el tema o dominio solicitado por el usuario con copy real, dinamico y coherente.
8. Al terminar el scaffold: NO pidas mas detalles al usuario. Lista lo que YA funciona y lo que AUN FALTA para arrancar (npm install, .env, DB, scripts, stubs) y el siguiente comando concreto.` : "";

    const cursorParityGuide = (input.cursorParityMode === true && input.analysisMode !== true)
      ? buildCursorParitySystemGuide()
      : "";

    const skillCatalogLines = (input.brainInventory?.skills || [])
      .slice(0, 60)
      .map((skill) => `- ${skill.name}${skill.description ? `: ${String(skill.description).slice(0, 90)}` : ""}`)
      .filter(Boolean);
    const skillCatalogBlock = skillCatalogLines.length
      ? `SKILLS DISPONIBLES (${skillCatalogLines.length} con nombre EXACTO para brain_skill):\n${skillCatalogLines.join("\n")}`
      : [
        "SKILLS DISPONIBLES (fallback — usa brain_skill con nombre exacto si el inventario no cargo):",
        "- as-debugging-and-error-recovery: Depuracion sistematica",
        "- as-code-review-and-quality: Revision de codigo",
        "- as-frontend-ui-engineering: UI/CSS/responsive",
        "- as-planning-and-task-breakdown: Planificacion",
        "- as-incremental-implementation: Implementacion segura",
        "- as-security-and-hardening: Seguridad",
        "- editcore-connect: GitHub/Vercel/Supabase",
        "- frontend-design: Diseno visual",
      ].join("\n");

    // System prompt CON CACHE CONTROL + politica elite inmutable
    messages.push({
      role: "system",
      content: [
        {
          type: "text",
          text: withEliteCommunicationPolicy(`Eres EditCore Agent, ingeniero de software sénior embebido en el IDE con acceso al Cerebro EditCore.
Sé directo, técnico y propositivo: responde al grano, toma posición y cierra con la siguiente acción concreta.
Escribe siempre en español correcto: tildes, eñes y espacios entre palabras. No cortes ni pegues palabras.
Identidad: si te preguntan quién eres o qué modelo eres, responde "Soy EditCoreAI". Nunca digas que eres Qwen, Alibaba, Claude genérico o ChatGPT.
Usa las siguientes herramientas para completar la tarea:

HERRAMIENTAS DISPONIBLES:
${toolsListText}
${analysisGuide}${greenfieldGuide}${cursorParityGuide}

${skillCatalogBlock}

COMO TRABAJAR (ESTILO CURSOR — TEXTO EN VIVO):
1. El usuario ve tu respuesta escribirse en tiempo real. Narra cada paso en markdown tecnico antes de actuar (sin relleno).
2. Si el pedido dice NO MODIFICAR / DIAGNOSTICO / solo reporte: OBEDECE. No escribas archivos aunque el usuario diga "avanza" o "porque no avanzas"; entrega el informe.
3. NO eres un agente paralelo ciego. Continua la MISMA tarea con la evidencia ya en conversacion/cache. PROHIBIDO releer el mismo path.
4. ${input.analysisMode === true
    ? "En ANALISIS: carga como mucho 1 skill util del inventario real; prioriza disco y cierra el reporte con recomendaciones concretas."
    : "Usa el Cerebro (brain_search o brain_skill) cuando aporte valor en tareas largas; no lo uses para retrasar el cierre."}
5. Usa encabezados ## y listas numeradas para planes, hallazgos y correcciones.
6. ANTES de invocar herramientas: 1-3 oraciones de razonamiento. Tras cambios: una linea del por que.
7. tool_calls nativos. Reporte final en markdown.
8. WORKSPACE: si el usuario pide cerrar este proyecto y abrir otra carpeta, USA switch_project (no digas que no puedes). Tambien puedes usar open_project / close_project por separado.

SI ES TAREA DE ANÁLISIS/REPORTE/AUDITORIA:
- Secciones: ## Qué sí funcionó | ## Qué falló / hallazgos | ## Qué falta para que funcione | ## Evidencia | ## Cómo lo corregiré
- "Qué falta para que funcione": lista concreta (deps, .env, stubs, Docker, workers, endpoints) basada en disco.
- Tras esas secciones: recomienda la correccion de mayor impacto (archivo + cambio).
- PROHIBIDO pedir al usuario mas informacion del proyecto: tu lo lees.
- PROHIBIDO "Verificacion completada con evidencia real..."
- PROHIBIDO repetir el prompt del usuario como respuesta.
- PROHIBIDO write_file/replace_in_file.
- PROHIBIDO reiniciar el proyecto o decir que el path era incorrecto tras CONTINUA; reutiliza evidencia ya leida.

CIERRE OBLIGATORIO — El modelo DEBE terminar cada respuesta con UNO de estos 3 encabezados de estado (nunca una respuesta abierta sin encabezado):

## ✅ TAREA COMPLETADA
Usar cuando terminaste de ejecutar y verificaste cambios reales.
Formato:
  ## ✅ TAREA COMPLETADA
  <1-2 líneas: qué se hizo>
  ### Evidencia
  - \`<archivo>\` modificado
  - Verificado con \`<tool>\`
  ## Siguientes pasos
  **1. [RECOMENDADA] <título>**
  - Qué hacer: <1 línea concreta>
  - Por qué ahora: <1 línea de impacto>
  **2. <título>**
  - Qué hacer: ...
  - Por qué ahora: ...
  **3. <título>**
  - Qué hacer: ...
  - Por qué ahora: ...

## ⏸️ ESPERANDO TU ACCIÓN
Usar cuando terminaste el análisis y necesitás que el usuario autorice, elija o confirme algo.
Formato:
  ## ⏸️ ESPERANDO TU ACCIÓN
  <1-2 líneas: qué encontraste y qué necesitás>
  ### Qué necesito
  - <instrucción exacta>
  ### Si decidís continuar
  <qué harás cuando responda>

## ℹ️ RESPUESTA
Usar cuando el usuario solo hizo una pregunta informativa, conceptual, o es chat casual.
Formato:
  ## ℹ️ RESPUESTA
  <contenido>
  (opcional) Si querés que profundice en algo o haga alguna acción, decímelo.

REGLAS DURAS:
- NUNCA termines sin uno de estos 3 encabezados (excepto saludo simple como "hola" que puede ser solo texto breve).
- NUNCA mezcles estados: o es COMPLETADA, o ESPERANDO, o RESPUESTA.
- NUNCA uses "TAREA COMPLETADA" si NO hubo write_file/replace_in_file verificados.
- NUNCA uses "ESPERANDO" si el usuario no tiene nada que decidir.
- "Siguientes pasos" SOLO aparece en ✅ COMPLETADA, nunca en ℹ️ RESPUESTA.
- En ⏸️ ESPERANDO NO agregues "Siguientes pasos" (el propio "Qué necesito" es la acción).

2. NO pegues codigo fuente, imports ni bloques fenced en el chat; explica en prosa lo que encontraste o cambiaste.
3. Indica: resultado, archivos modificados, verificaciones ejecutadas y qué falta para que arranque.
4. No afirmes que leíste, modificaste o verificaste algo sin herramienta exitosa que lo demuestre.
5. Si modificaste archivos, verifica después de la última escritura antes de responder como final.
6. Cierra con UNA recomendacion concreta (siguiente accion). No termines pidiendo "mas informacion".
7. ${input.analysisMode === true
    ? "Skills del Cerebro: OPCIONALES en analisis (nombre exacto del inventario). Prioriza disco y el reporte de gaps."
    : "Las skills del Cerebro ayudan en ejecucion: carga la skill especializada si aplica; si falla, continua sin insistir."}
8. Si una skill exige un procedimiento especifico, ese procedimiento tiene prioridad sobre tus habitos generales.
9. En una reanudación: conserva evidencia y skills; no reinicies con reglas genéricas ni reexplores la raiz sin motivo.`),
          cache_control: { type: "ephemeral" } // ← CACHEA ESTO
        }
      ]
    });

    messages.push({
      role: "system",
      content: buildExternalFoundationContext({
        analysisMode: input.analysisMode === true,
        allowWrite: input.allowWrite === true,
      }),
    });

    // Contexto extra del host (por ejemplo, modo Inspector self-repair)
    if (input.systemExtra) {
      messages.push({ role: "system", content: String(input.systemExtra) });
    }

    // Historial del chat Inspector / caller (roles user|assistant) con retención progresiva
    if (Array.isArray(input.history) && input.history.length) {
      const compacted = compactChatHistory(input.history, {
        maxMessages: 28,
        maxContentChars: 8000,
        maxTotalChars: 50000,
        includeSummary: true,
      });
      for (const item of compacted) {
        const role = item?.role === "assistant" ? "assistant" : "user";
        if (Array.isArray(item?.content)) {
          messages.push({ role, content: item.content });
        } else {
          const content = String(item?.content || "").trim();
          if (!content) continue;
          messages.push({ role, content: content.slice(0, 12000) });
        }
      }
    }

    // Inyectar contexto de análisis del proyecto si existe
    if (input.analysisContext) {
      messages.push({
        role: "system",
        content: `## Contexto del proyecto (análisis previo)\n${input.analysisContext}`,
      });
    }

    // Memoria local de proyecto (.editcore/memory.json)
    if (input.projectRoot) {
      try {
        const projMem = loadProjectMemory(input.projectRoot);
        const projMemFormatted = formatMemoryForPrompt(projMem);
        if (projMemFormatted) {
          messages.push({
            role: "system",
            content: [
              {
                type: "text",
                text: projMemFormatted,
                cache_control: { type: "ephemeral" },
              },
            ],
          });
        }
      } catch {}
    }

    // Contexto de memoria persistente del agente (.editcore/agent-memory)
    if (this.agentMemory) {
      const memoryContext = this.agentMemory.buildContextForAgent();
      if (memoryContext.length > 50) {
        messages.push({
          role: "system",
          content: [
            {
              type: "text",
              text: `MEMORIA PERSISTENTE:\n${memoryContext}`,
              cache_control: { type: "ephemeral" } // ← CACHEA MEMORIA
            }
          ]
        });
      }
    }

    // Cerebro context CON CACHE (si existe)
    if (input.brainContext && input.brainContext.length > 100) {
      messages.push({
        role: "system",
        content: [
          {
            type: "text",
        text: `Cerebro EditCore (reglas vigentes para esta tarea):\n${input.brainContext.slice(0, 9000)}`,
            cache_control: { type: "ephemeral" } // ← CACHEA ESTO
          }
        ]
      });
    }

    // Memoria de la corrida anterior en este proyecto: evita que una
    // continuacion ("continua", "procede") re-explore todo desde cero.
    if (input.previousRunSummary && input.freshAnalysisRun !== true) {
      messages.push({
        role: "system",
        content: `MEMORIA DE LA CORRIDA ANTERIOR EN ESTE PROYECTO (evidencia ya verificada — NO repitas estas acciones, continua el trabajo desde este punto):\n${String(input.previousRunSummary).slice(0, 6000)}`,
      });
    }

    const promptText3220 = String(input.prompt || "");
    const hasFixOrCreate3220 = /\b(?:crear?|crees?|corregir?|corrijas?|corrijelo|modifica|modifiques|escribir?|escribas?|arreglar?|arregles?|implementar?|implementes?|haz|hacer|funcionar|ejecutar?|ejecuta)\b/i.test(promptText3220);
    const isCodeAudit = isAnalysisOnlyRequest(input.prompt) && !hasFixOrCreate3220;
    const visionImages = Array.isArray(input.images) ? input.images : [];
    const taskText = `Proyecto: ${input.projectRoot}
Tarea: ${input.prompt}

${input.analysisMode ? (isCodeAudit ? `MODO ANALISIS ACTIVO:
- Solo lectura. Narra en ESPANOL. PROHIBIDO run_command lint/test/build y PROHIBIDO write_file.
- ORDEN: evidencia precargada + read_file de huecos → informe.
- PROHIBIDO inventar carpetas/archivos no observados.
- Informe obligatorio con secciones: ## Qué sí funcionó | ## Qué falló / hallazgos | ## Qué falta para que funcione | ## Evidencia | ## Cómo lo corregiré.
- Termina con: Cuando autorices procedo con las correcciones.` : `MODO ANALISIS Y CONSULTA ACTIVO:
- Responde de forma completa, precisa y detallada a lo solicitado en la tarea.
- Si la tarea pide arquitectura, diseno o investigacion tecnica, cubre todas las fases y requerimientos.
- Con proyecto abierto: inspecciona el disco y di que FALTA para que funcione. PROHIBIDO pedir "mas informacion" al usuario si puedes leerla del repo.
- Solo pregunta secretos/API keys o preferencias de negocio que no estan en disco.`) : `MODO EJECUCION ACTIVO:
- Permisos del chat activos. Si hay plan autorizado, ejecuta correcciones YA con herramientas.
- ORDEN: read_file del objetivo → replace_in_file/write_file → run_command/read_file de verificacion.
- PROHIBIDO solo narrar "ACCION 1/2/3" sin tool_calls. Sin mutacion real la tarea no avanza.
- El cierre DEBE incluir ## Evidencia de correccion con archivos tocados y verificaciones.`}`;
    if (visionImages.length) {
      try {
        const { buildOpenAiImageContent, VISION_ACK_RULE } = require("./vision-intake");
        messages.push({ role: "system", content: VISION_ACK_RULE });
        messages.push({
          role: "user",
          content: buildOpenAiImageContent(taskText, visionImages),
        });
      } catch {
        messages.push({ role: "user", content: taskText });
      }
    } else {
      messages.push({ role: "user", content: taskText });
    }

    return messages;
  }

  /**
   * Compatibilidad: construye los mensajes actuales de la conversacion.
   */
  buildMessages(input, steps) {
    if (this.conversation) return this.conversation.toProviderMessages();
    return this.buildPrefixMessages(input);
  }

  /**
   * Obtiene herramientas disponibles
   */
  getAvailableTools(input) {
    const tool = (name, description, properties = {}, required = []) => ({
      type: "function",
      function: {
        name,
        description,
        parameters: { type: "object", properties, required, additionalProperties: false },
      },
    });
    const tools = [
      tool("list_files", "Lista archivos y carpetas del proyecto.", { path: { type: "string" } }),
      tool("open_project", "Abre una carpeta real en el panel de EditCore (misma accion que Abrir).", { path: { type: "string" }, name: { type: "string" } }),
      tool("close_project", "Cierra el proyecto abierto en el panel (misma accion que Cerrar). El panel queda Sin proyecto."),
      tool("switch_project", "Cierra el proyecto activo y abre otra carpeta en el mismo panel (atomico). Obligatorio cuando el usuario pide cambiar de proyecto. autoPublish/publishFirst publica antes de cambiar.", {
        path: { type: "string" },
        name: { type: "string" },
        targetPath: { type: "string" },
        autoPublish: { type: "boolean" },
        publishFirst: { type: "boolean" },
      }),
      tool("read_file", "Lee un archivo del proyecto (path relativo a un archivo, no a una carpeta).", { path: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } }, ["path"]),
      tool("search_files", "Busca texto en archivos del proyecto.", { query: { type: "string" }, path: { type: "string" } }, ["query"]),
      tool("project_discovery", "Detecta stack, scripts, entrypoints y configuracion del proyecto.", { refresh: { type: "boolean" } }),
      tool("codebase_map", "Mapa estructural de archivos, modulos, simbolos, imports y exports.", { refresh: { type: "boolean" }, includeFiles: { type: "boolean" } }),
      tool("symbol_search", "Busca funciones, clases, componentes, hooks y tipos.", { query: { type: "string" }, kinds: { type: "array", items: { type: "string" } }, path: { type: "string" }, limit: { type: "number" } }, ["query"]),
      tool("dependency_search", "Busca imports, exports y referencias de modulos.", { query: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }, ["query"]),
      tool("inspect_preview", "Inicia y examina visualmente el preview local del proyecto.", { viewport: { type: "string", enum: ["desktop", "mobile"] } }),
      tool("inspect_browser", "Inspecciona el preview local (solo localhost).", { url: { type: "string" }, viewport: { type: "string", enum: ["desktop", "mobile"] } }),
      tool("browser_interact", "Interactua con preview local: dom, console, click, type, scroll, wait_for, screenshot, reload, close.", {
        action: { type: "string", enum: ["dom", "console", "click", "type", "scroll", "wait_for", "screenshot", "reload", "close"] },
        selector: { type: "string" },
        text: { type: "string" },
        url: { type: "string" },
        viewport: { type: "string", enum: ["desktop", "mobile"] },
        y: { type: "number" },
        timeoutMs: { type: "number" },
      }, ["action"]),
      tool("search", "Busqueda unificada en archivos del proyecto y Cerebro.", { query: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }, ["query"]),
      tool("semantic_search", "Busqueda semantica local (TF-IDF) con Qdrant opcional.", { query: { type: "string" }, limit: { type: "number" }, refresh: { type: "boolean" } }, ["query"]),
      tool("run_parallel_explore", "Sub-agentes de solo lectura en paralelo (search + semantic).", { query: { type: "string" }, goal: { type: "string" }, includeGithub: { type: "boolean" }, githubQuery: { type: "string" } }),
      tool("run_subagent", "Sub-agente acotado: explorer (lectura) o implementer (patches max 5).", {
        role: { type: "string", enum: ["explorer", "implementer"] },
        query: { type: "string" },
        goal: { type: "string" },
        task: { type: "string" },
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
              oldText: { type: "string" },
              newText: { type: "string" },
              replaceAll: { type: "boolean" },
            },
          },
        },
      }),
      tool("run_diagnostics", "Ejecuta typecheck/lint del proyecto sobre archivos cambiados.", { files: { type: "array", items: { type: "string" } } }),
      tool("mcp_list_tools", "Lista tools MCP (config global automatica; override opcional por proyecto)."),
      tool("mcp_invoke", "Invoca tool MCP allowlisted bajo demanda.", { serverId: { type: "string" }, tool: { type: "string" }, arguments: { type: "object" } }, ["serverId", "tool"]),
      tool("connection_status", "Consulta conexiones configuradas (GitHub, Vercel, Supabase, SSH).", { service: { type: "string" } }),
      tool("service_read", "Lee datos de un servicio conectado.", { service: { type: "string" }, method: { type: "string" }, path: { type: "string" } }, ["service"]),
      tool("fetch_url", "Descarga contenido de una URL.", { url: { type: "string" } }, ["url"]),
      tool("github_repo_info", "Obtiene informacion de un repositorio GitHub.", { url: { type: "string" } }, ["url"]),
      tool("github_list_files", "Lista archivos de GitHub.", { url: { type: "string" }, path: { type: "string" } }, ["url"]),
      tool("github_read_file", "Lee un archivo de GitHub.", { url: { type: "string" }, path: { type: "string" } }, ["url", "path"]),
      tool("github_search_repos", "Busca repositorios GitHub.", { query: { type: "string" } }, ["query"]),
      tool("brain_search", "Busca memoria, conocimiento y codigo indexado del Cerebro.", { query: { type: "string" }, scope: { type: "string", enum: ["all", "memory", "code", "catalog"] }, limit: { type: "integer" } }, ["query"]),
      tool("brain_skill", "Carga una skill del Cerebro por nombre exacto.", { name: { type: "string" } }, ["name"]),
      tool("brain_tools", "Lista herramientas, skills y capacidades instaladas en EditCore.", { query: { type: "string" }, limit: { type: "integer" } }),
      tool("brain_install_repo", "Inspecciona o instala un repo GitHub en el Cerebro global.", { url: { type: "string" }, mode: { type: "string", enum: ["inspect", "install"] } }, ["url"]),
    ];

    if (input.analysisMode === true) {
      tools.push(tool("run_command", "Solo lectura/diagnostico acotado: git status, rg, npm audit; tras cobertura: npx tsc --noEmit o npm run typecheck. PROHIBIDO lint/build/eslint/test global.", { command: { type: "string" }, cwd: { type: "string" } }, ["command"]));
    } else {
      tools.push(tool("run_command", "Ejecuta comandos de verificacion (npm test, lint, git status, etc).", { command: { type: "string" }, cwd: { type: "string" } }, ["command"]));
    }

    if (input.allowWrite) {
      tools.push(
        tool("write_file", "Crea o reescribe un archivo tras leerlo.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
        tool("replace_in_file", "Reemplaza oldText exacto en un archivo leido.", { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" }, replaceAll: { type: "boolean" } }, ["path", "oldText", "newText"]),
        tool("service_write", "Modifica un servicio conectado.", { service: { type: "string" }, method: { type: "string" }, path: { type: "string" }, body: {} }, ["service"]),
        tool("create_project", "Crea un proyecto o estructura inicial.", { name: { type: "string" }, path: { type: "string" }, template: { type: "string" }, install: { type: "boolean" } }, ["name"]),
        tool("generate_image", "Genera imagen (OpenAI / Replicate Flux / Jaaz) y la guarda en public/assets/. Sin config: available:false.", { prompt: { type: "string" }, size: { type: "string" }, model: { type: "string" }, outputDir: { type: "string" } }, ["prompt"]),
        tool("generate_video", "Genera video corto (Replicate / OpenAI-compatible) y lo guarda en public/assets/. Sin config: available:false.", { prompt: { type: "string" }, model: { type: "string" }, duration: { type: "number" }, outputDir: { type: "string" } }, ["prompt"]),
        tool("images_to_code", "Genera UI desde brief/imagen (vision LLM o scaffold local).", {
          title: { type: "string" },
          description: { type: "string" },
          folder: { type: "string" },
          images: { type: "array", items: { type: "object" } },
          forceVision: { type: "boolean" },
        }),
        tool("clone_web_page", "Clona URL externa: Puppeteer/Playwright DOM+capturas, visión→React/Tailwind, merge golden template + replacements {{TOKEN}}.", {
          url: { type: "string" },
          title: { type: "string" },
          folder: { type: "string" },
          viewport: { type: "string", enum: ["desktop", "mobile"] },
          replacements: { type: "object" },
          skipVision: { type: "boolean" },
          mergeApp: { type: "boolean" },
          dryRun: { type: "boolean" },
        }, ["url"]),
        tool("run_e2e_pipeline", "Ejecuta verificación end-to-end 1→100 (visión, clone, brain, IPC, tools) y escribe .editcore/e2e-pipeline-report.md con el mismo formato de reporte.", {
          writeReport: { type: "boolean" },
        }),
        tool("add_erp_module", "Inyecta modulo ERP (inventory|payroll|invoicing|crm): migracion SQL primero, luego CRUD UI sin pisar nav/conexiones.", { module: { type: "string" } }, ["module"]),
        tool("propose_diff", "Propone un cambio y muestra diff unificado + hunks sin escribir.", {
          path: { type: "string" },
          content: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          replaceAll: { type: "boolean" },
        }, ["path"]),
        tool("propose_diff_batch", "Propone varios diffs multi-archivo.", {
          files: { type: "array", items: { type: "object" } },
        }, ["files"]),
        tool("apply_diff", "Aplica un propose_diff por proposalId.", { proposalId: { type: "string" } }, ["proposalId"]),
        tool("run_tdd_cycle", "Ciclo TDD: escribe test, corre, reporta rojo/verde.", {
          testPath: { type: "string" },
          testContent: { type: "string" },
          fixturePath: { type: "string" },
          fixtureContent: { type: "string" },
          command: { type: "string" },
        }),
        tool("export_session", "Exporta hilo a .editcore/sessions/*.md.", {
          title: { type: "string" },
          messages: { type: "array" },
          fileName: { type: "string" },
        }),
        tool("migration_playbook", "Playbook de migracion (js-to-ts|react-hooks|orm-prisma).", {
          playbook: { type: "string" },
          list: { type: "boolean" },
        }),
        tool("audit_dead_code", "Exports huerfanos / archivos posiblemente sin uso."),
        tool("audit_sql_performance", "Heuristica N+1 en loops."),
        tool("tail_logs", "Tail del log preview/dev.", { path: { type: "string" }, maxLines: { type: "number" } }),
        tool("list_workflows", "Lista workflows en .editcore/workflows.", { ensure: { type: "boolean" } }),
        tool("git_status", "Estado git + diff stat."),
        tool("git_create_branch", "Crea rama git.", { branch: { type: "string" }, checkout: { type: "boolean" } }, ["branch"]),
        tool("git_commit", "Commit git (sin secretos).", { message: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, ["message"]),
        tool("git_pull", "Git pull remoto.", { remote: { type: "string" }, branch: { type: "string" } }),
        tool("git_push", "Git push remoto (requiere confirmacion).", { remote: { type: "string" }, branch: { type: "string" }, setUpstream: { type: "boolean" } }),
        tool("deploy_one_click", "Deploy one-click a Vercel/Netlify con tokens de Conexiones.", {
          provider: { type: "string", enum: ["auto", "vercel", "netlify"] },
          production: { type: "boolean" },
          dir: { type: "string" },
        }),
        tool("publish_project", "Publicacion deterministica: commit sin secretos, push, supabase db push, deploy.", {
          mode: { type: "string", enum: ["project", "editcore"] },
          deploy: { type: "boolean" },
          supabasePush: { type: "boolean" },
          commitMessage: { type: "string" },
        }),
        tool("connect_project", "Conecta proyecto a GitHub, Vercel y Supabase (Conexiones globales).", {
          createGithub: { type: "boolean" },
          createVercel: { type: "boolean" },
          linkSupabase: { type: "boolean" },
          repoName: { type: "string" },
        }),
        tool("assess_project_connections", "Diagnostica que falta para publicar (git, tokens, supabase, vercel)."),
        tool("onboard_project", "Onboard completo: npm install, Supabase, GitHub, Vercel, envs, proveedor de IA.", {
          installDeps: { type: "boolean" },
          bootstrapSupabase: { type: "boolean" },
          connectServices: { type: "boolean" },
          connectGateway: { type: "boolean" },
          firstDeploy: { type: "boolean" },
          projectName: { type: "string" },
          repoName: { type: "string" },
        }),
        tool("provision_project", "Aprovisionar: conectar servicios, sync envs Vercel, Supabase, validar y publicar opcional.", {
          syncVercel: { type: "boolean" },
          manageSupabase: { type: "boolean" },
          validateBeforePublish: { type: "boolean" },
          firstDeploy: { type: "boolean" },
          sshAfterPublish: { type: "boolean" },
          repoName: { type: "string" },
          commitMessage: { type: "string" },
        }),
        tool("project_health", "Estado de salud: git, remote, migraciones, ultima publicacion."),
        tool("create_supabase_project", "Bootstrap supabase/ + env + bucket en proyecto (Supabase propio).", {
          projectName: { type: "string" },
          useCloud: { type: "boolean" },
          bucketName: { type: "string" },
          pushDb: { type: "boolean" },
        }),
        tool("sync_vercel_env", "Sincroniza variables de .env.local a Vercel.", {
          projectId: { type: "string" },
          projectName: { type: "string" },
        }),
        tool("supabase_manage", "Verifica Supabase, drift migraciones y bucket storage.", {
          ensureBucket: { type: "boolean" },
          bucketName: { type: "string" },
        }),
        tool("ssh_deploy", "Deploy por SSH: git pull y reinicio en servidor configurado.", {
          remotePath: { type: "string" },
        }),
        tool("create_pdf", "Crea un PDF dentro del proyecto.", { path: { type: "string" }, content: {} }, ["path", "content"]),
        tool("create_word", "Crea un documento Word.", { path: { type: "string" }, content: {} }, ["path", "content"]),
        tool("create_excel", "Crea un archivo Excel.", { path: { type: "string" }, data: {} }, ["path", "data"]),
        tool("create_csv", "Crea un archivo CSV.", { path: { type: "string" }, data: {} }, ["path", "data"]),
      );
    }

    if (input.brainInventory?.skills?.length) {
      const skillHint = input.brainInventory.skills.slice(0, 30).map((skill) => skill.name).filter(Boolean).join(", ");
      const brainTools = tools.find((item) => item.function.name === "brain_tools");
      if (brainTools) brainTools.function.description += ` Skills precargadas: ${skillHint}.`;
    }

    if (input.promptOnlyMode || input.allowFilesystem === false) {
      return filterToolsByPlan(tools, input.orchestratorPlan || input.runProfile || input);
    }

    const filtered = filterToolsByPlan(tools, input.orchestratorPlan || input.runProfile || input);
    if (this.forceTextOnlyClose === true || input.forceTextOnlyClose === true) return [];
    // PROCEDE / escritura autorizada: tools completas.
    const writeAuthorized = input.allowWrite === true && input.analysisMode !== true && input.listOnly !== true;
    if (input.planAuthorized === true || (writeAuthorized && input.planAuthorized === true)) {
      const byName = new Map(tools.map((item) => [item?.function?.name, item]));
      let execTools = filtered.length ? [...filtered] : [...tools];
      for (const name of ["write_file", "replace_in_file", "list_files", "read_file", "search_files", "run_command", "delete_file"]) {
        if (!execTools.some((item) => item?.function?.name === name) && byName.has(name)) {
          execTools.push(byName.get(name));
        }
      }
      return execTools;
    }
    // FOCO retirado: no limitar tools a read_file/allowlist.
    const promptText = String(input.prompt || "").trim();
    const hideOperator = Boolean(promptText) && !isOperatorPublishRequest(promptText);
    let withoutUnrequestedPublish = hideOperator
      ? filtered.filter((item) => !OPERATOR_PUBLISH_TOOLS.includes(item?.function?.name))
      : filtered;
    // PROCEDE / ejecucion: si el allowlist de analisis se quedo pegado, reinyectar escritura.
    if (writeAuthorized && !toolsIncludeWrite(withoutUnrequestedPublish)) {
      const byName = new Map(tools.map((item) => [item?.function?.name, item]));
      for (const name of ["write_file", "replace_in_file", "list_files", "read_file", "run_command"]) {
        if (!withoutUnrequestedPublish.some((item) => item?.function?.name === name) && byName.has(name)) {
          withoutUnrequestedPublish = [...withoutUnrequestedPublish, byName.get(name)];
        }
      }
    }
    if (withoutUnrequestedPublish.length) return withoutUnrequestedPublish;

    if (input.runProfile?.greenfieldCreate === true || input.orchestratorPlan?.greenfieldCreate === true) {
      const allowed = new Set(["write_file", "create_project", "list_files", "read_file", "replace_in_file", "run_command"]);
      if (input.cursorParityMode === true || input.runProfile?.cursorParityMode === true) {
        return filtered.length ? filtered : tools;
      }
      return tools.filter((item) => allowed.has(item?.function?.name));
    }

    return tools;
  }

  parseModelResponse(response) {
    const nativeCall = Array.isArray(response?.toolCalls) ? response.toolCalls[0] : null;
    if (nativeCall) {
      const action = providerToolCallAction(nativeCall);
      if (action) return action;
    }
    let text = (response.text || "").trim();

    // Quitar markdown code blocks si existen (ej: ```json ... ```)
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/, "$1").trim();
    }

    try {
      const parsed = parseAgentPayload(text);
      if (parsed?.type && (parsed.name || parsed.text)) return parsed;
    } catch (e) {
      // Si no es JSON directo, buscar el bloque JSON completo usando balanceo de llaves
      const startIdx = text.indexOf('{');
      if (startIdx >= 0) {
        let braceCount = 0;
        let endIdx = -1;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '{') braceCount++;
          else if (text[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i;
              break;
            }
          }
        }
        if (endIdx >= 0) {
          try {
            const potentialJson = text.substring(startIdx, endIdx + 1);
            const parsed = parseAgentPayload(potentialJson);
            if (parsed?.type && (parsed.name || parsed.text)) return parsed;
          } catch (e2) {
            // Ignorar
          }
        }
      }
    }

    const parsed = parseAgentPayload(text);
    if (parsed?.type && (parsed.name || parsed.text)) return parsed;

    // Un texto libre sin herramientas es la respuesta final del modelo; la
    // validacion de completitud decide si se acepta o se rechaza con feedback.
    return {
      type: "final",
      text: text || "El proveedor no devolvio una instruccion ni una respuesta util.",
    };
  }
}

module.exports = {
  EditCoreClaudeAdapter,
  sanitizeUserFacingReport,
  groundAnalysisReport,
  collectToolEvidence,
  looksLikePromptEcho,
  reportLooksComplete,
  formatListOnlyAnswerFromSteps,
  looksLikeForensicListDrift,
  looksLikeNoMutationMessage,
  narrationClaimsMissingTools,
  narrationClaimsWriteToolsMissing,
  toolsIncludeWrite,
};
