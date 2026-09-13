"use strict";

const { createContextManifest, serializeContextManifest } = require("./context-manifest");
const { ToolContext, inferStage } = require("./tool-context");
const { ContentHashCache } = require("./context-store");
const { withEliteCommunicationPolicy } = require("./elite-communication-policy");

function text(value) {
  return typeof value === "string" ? value : JSON.stringify(value || "");
}

function summarize(value, maxChars = 900) {
  const content = text(value).trim();
  if (content.length <= maxChars) return content;
  const head = Math.max(240, Math.floor(maxChars * 0.68));
  const tail = Math.max(120, maxChars - head - 38);
  return `${content.slice(0, head)}\n[contenido referenciado]\n${content.slice(-tail)}`;
}

function selectContextLevel({ stage = "discovery", lastStep = null, hasImages = false, hasDocuments = false } = {}) {
  if (lastStep?.ok === false || lastStep?.result?.error) return 5;
  if (lastStep?.name === "brain_skill" || lastStep?.name === "retrieve_context") return 4;
  if (hasImages || hasDocuments) return 4;
  if (stage === "verification") return 3;
  if (stage === "modification") return 2;
  return 1;
}

function stableSystemPrompt({ analysisMode = false, callerSystemPrompt = "", finalAnswerOnly = false, task = "", taskRef = "" } = {}) {
  const fullTask = String(task || "").trim();
  const maxTaskChars = 80_000;
  const taskContent = fullTask.length <= maxTaskChars
    ? fullTask
    : `${fullTask.slice(0, maxTaskChars)}\n[EditCore: solicitud completa archivada en ${taskRef}; usa retrieve_context para leer el resto.]`;
  return withEliteCommunicationPolicy([
    "Eres EditCore Agent. Responde siempre en espanol y ejecuta la tarea con herramientas reales.",
    'Responde con un solo JSON: {"type":"tool","name":"...","input":{...}} o {"type":"final","text":"..."}.',
    "Las rutas locales son relativas al proyecto activo. No inventes archivos, conexiones, cambios ni verificaciones.",
    "Opera como un agente de ingenieria continuo: comprende todos los requisitos, inspecciona lo necesario, actua, verifica y entrega un reporte sustentado.",
    "Usa la evidencia de herramientas; no repitas acciones resueltas ni mutaciones ya aplicadas. Reutiliza referencias y checkpoints.",
    "En solicitudes extensas conserva todos los requisitos, crea un plan durable y ejecutalo hasta completar o encontrar un bloqueo externo comprobado.",
    "El reporte final debe indicar resultado, archivos modificados, verificaciones ejecutadas y cualquier pendiente real. No declares completitud sin evidencia.",
    "No uses run_command para leer, listar o buscar archivos. Usa las herramientas dedicadas y, en etapa modification, aplica write_file o replace_in_file con la evidencia ya reunida.",
    "Las credenciales permanecen en el host. Usa load_tool_descriptor para obtener parametros opcionales o habilitar una herramienta no anunciada; usa retrieve_context para abrir una referencia.",
    analysisMode ? "MODO ANALISIS: no escribas archivos ni servicios; inspecciona y reporta evidencia." : "",
    finalAnswerOnly ? "FASE FINAL: entrega ahora exclusivamente type final con un reporte detallado basado en la evidencia. No describas lo que vas a hacer, no anuncies que continuaras, no solicites mas herramientas y no entregues una vista previa del reporte." : "",
    taskContent ? `SOLICITUD ORIGINAL DEL USUARIO (conserva todos sus requisitos):\n${taskContent}` : "",
    callerSystemPrompt ? `SUPERVISOR:\n${summarize(callerSystemPrompt, 1600)}` : "",
  ].filter(Boolean).join("\n"));
}

function historySummary(history = []) {
  const decisions = [];
  for (const item of history.slice(-12)) {
    const value = summarize(item?.content, 500);
    if (!value) continue;
    decisions.push(`${item?.role === "assistant" ? "EditCore" : "Usuario"}: ${value}`);
  }
  return decisions.join("\n");
}

function evidenceSignature(step = {}) {
  const input = step.input && typeof step.input === "object"
    ? Object.fromEntries(Object.entries(step.input).filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false))
    : {};
  if (["project_discovery", "codebase_map"].includes(step.name)) delete input.path;
  return JSON.stringify({ name: String(step.name || ""), input });
}

function evidenceLedger(steps = [], { maxItems = 12, maxChars = 8_000 } = {}) {
  const unique = [];
  const seen = new Set();
  for (const step of steps) {
    const signature = evidenceSignature(step);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(step);
  }
  const selected = unique.slice(-Math.max(1, Number(maxItems) || 12));
  const rows = [];
  let used = 0;
  const archived = unique.slice(0, Math.max(0, unique.length - selected.length));
  if (archived.length) {
    const indexRows = archived.map((step, index) => {
      const target = step?.input?.path || step?.input?.query || step?.input?.command || "";
      const status = step?.ok === false || step?.result?.error ? "ERROR" : "OK";
      return `${index + 1}. ${step?.name || "accion"}${target ? ` [${String(target).slice(0, 160)}]` : ""} ${status} REF=${step?.contextRef || ""}`;
    });
    const archiveIndex = `ARCHIVED_EVIDENCE_INDEX (usa retrieve_context con REF para consultar detalles)\n${indexRows.join("\n")}`;
    rows.push(archiveIndex.slice(0, Math.max(0, Math.floor(maxChars * 0.35))));
    used += rows[0].length;
  }
  for (const [index, step] of selected.entries()) {
    const target = step?.input?.path || step?.input?.query || step?.input?.command || "";
    const status = step?.ok === false || step?.result?.error ? "ERROR" : "OK";
    const output = step?.result?.error || step?.result?.summary || step?.result?.relevantOutput || step?.result || "";
    const row = `${index + 1}. ${step?.name || "accion"}${target ? ` [${String(target).slice(0, 240)}]` : ""} ${status} REF=${step?.contextRef || ""}\n${summarize(output, 900)}`;
    if (used + row.length > maxChars) break;
    rows.push(row);
    used += row.length;
  }
  return { text: rows.join("\n"), included: selected.length, total: unique.length, archived: archived.length };
}

function uniqueEvidenceCount(steps = []) {
  return new Set(steps
    .filter((step) => step?.ok !== false && !step?.result?.error)
    .map(evidenceSignature)).size;
}

class ContextEngine {
  constructor({ store, toolDefinitions = [] } = {}) {
    this.store = store;
    this.tools = new ToolContext(toolDefinitions);
    this.cache = new ContentHashCache();
  }

  updateTools(definitions) {
    this.tools.update(definitions);
  }

  storeReference(value, metadata = {}) {
    if (!value || !this.store) return "";
    return this.store.store(value, metadata).id;
  }

  prepare(input = {}) {
    const steps = Array.isArray(input.steps) ? input.steps : [];
    const stage = input.finalAnswerOnly ? "final" : input.stage || inferStage({ steps, changedFiles: input.changedFiles || [], task: input.task, finalPhase: input.finalPhase });
    const inferredLevel = selectContextLevel({ stage, lastStep: steps.at(-1), hasImages: Boolean(input.images?.length), hasDocuments: Boolean(input.documentText) });
    const requestedLevel = Number(input.requestedContextLevel);
    const level = Number.isFinite(requestedLevel) ? Math.max(0, Math.min(5, requestedLevel)) : inferredLevel;
    const taskRef = input.taskRef || this.storeReference(input.task, { kind: "task-request", taskId: input.taskId, runId: input.runId });
    const selected = this.tools.select({
      stage, canWrite: input.canWrite, analysisMode: input.analysisMode, task: input.task,
      needsContextRetrieval: Boolean(steps.at(-1)?.contextRef) || level >= 4 || String(input.task || "").length > 80_000,
      evidenceCount: uniqueEvidenceCount(steps),
      repairPending: input.repairPending === true,
      targetInspectionPending: input.targetInspectionPending === true,
      mutationPending: input.mutationPending === true,
    });
    const brainRef = input.brainRef || this.storeReference(input.brainContext, { kind: "brain", taskId: input.taskId, runId: input.runId });
    const historyText = historySummary((input.history || []).slice(-4));
    const historyRef = input.historyRef || this.storeReference(input.history || [], { kind: "history", taskId: input.taskId, runId: input.runId });
    const documentRef = input.documentRef || this.storeReference(input.documentText, { kind: "documents", taskId: input.taskId, runId: input.runId });
    const catalog = this.cache.getOrCreate("tool-catalog", "all", this.tools.catalog(), (value) => value);
    const fileMetadata = this.cache.getOrCreate("file-metadata", String(input.projectId || input.projectRoot || "project"), input.rootFiles || [], (value) => value);
    const toolCatalogRef = this.storeReference(catalog, { kind: "tool-catalog", taskId: input.taskId, runId: input.runId });
    const last = steps.at(-1);
    const lastResult = last ? summarize(last.result, level >= 4 ? 5000 : level >= 3 ? 2400 : 1400) : "";
    const ledger = evidenceLedger(steps, {
      maxItems: input.finalAnswerOnly ? 18 : level >= 4 ? 14 : 10,
      maxChars: input.finalAnswerOnly ? 16_000 : level >= 4 ? 12_000 : 7_000,
    });
    const manifestSource = {
      ...input,
      rootFiles: fileMetadata,
      stage,
      contextLevel: level,
      brainRef,
      taskRef,
      brainSummary: summarize(input.brainContext, level >= 4 ? 900 : 240),
      historyRef,
      documentRef,
      selectedTools: selected.selected,
      toolCatalog: { ref: toolCatalogRef, count: catalog.length, tool_ids: catalog.map((tool) => tool.tool_id) },
      reasoningSummary: input.reasoningSummary || (last ? `Ultima accion ${last.name}: ${last.ok === false ? "fallo" : "completada"}.` : "Iniciar con la evidencia minima necesaria."),
    };
    const manifestKey = `${input.taskId || input.runId || "task"}:${stage}:${steps.length}`;
    const manifest = this.cache.getOrCreate("manifest", manifestKey, manifestSource, (value) => createContextManifest(value));
    const systemSource = { analysisMode: input.analysisMode === true, callerSystemPrompt: String(input.callerSystemPrompt || ""), finalAnswerOnly: input.finalAnswerOnly === true, task: String(input.task || ""), taskRef };
    const system = this.cache.getOrCreate("system", JSON.stringify(systemSource), systemSource, () => stableSystemPrompt({ ...input, taskRef }));
    const userParts = [
      serializeContextManifest(manifest),
      /\b(code review|audita|auditar|security audit|seguridad|optimiza performance|rendimiento|debugging|depura|depurar)\b/i.test(String(input.task || ""))
        ? "BRAIN_GUIDANCE\nConsulta brain_skill antes de aplicar un workflow especializado y sigue la skill recuperada."
        : "",
      historyText ? `HISTORY_SUMMARY\n${historyText}` : "",
      ledger.text ? `EVIDENCE_LEDGER\n${ledger.text}` : "",
      last ? `LAST_TOOL_RESULT\nTOOL=${last.name}\nRESULT_REF=${last.contextRef || ""}\n${lastResult}` : "",
      input.documentText ? `DOCUMENT_SUMMARY\nDOCUMENT_REF=${documentRef}\n${summarize(input.documentText, 1200)}` : "",
      input.discoverySummary ? `PROJECT_DISCOVERY\nREF=${input.discoveryReference || ""}\n${summarize(input.discoverySummary, level >= 3 ? 1800 : 800)}` : "",
      input.codebaseSummary ? `CODEBASE_MAP\nREF=${input.codebaseMapReference || ""}\n${summarize(input.codebaseSummary, level >= 3 ? 2200 : 900)}` : "",
      input.planSummary ? `TASK_PLAN\nREF=${input.planReference || ""}\n${summarize(input.planSummary, level >= 3 ? 2200 : 900)}` : "",
    ].filter(Boolean);
    const content = input.images?.length && steps.length === 0
      ? [{ type: "text", text: userParts.join("\n\n") }, ...input.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))]
      : userParts.join("\n\n");
    const messages = [{ role: "system", content: system }, { role: "user", content }];
    const sizes = {
      contextSize: JSON.stringify(messages).length + JSON.stringify(selected.definitions).length,
      toolContextSize: JSON.stringify(selected.definitions).length,
      systemContextSize: system.length,
      historyContextSize: historyText.length,
      resultContextSize: lastResult.length,
      evidenceContextSize: ledger.text.length,
    };
    return { messages, tools: selected.definitions, stage, level, manifest, sizes, brainRef, historyRef, documentRef, taskRef, compacted: ledger.included < ledger.total || String(input.task || "").length > 80_000 };
  }
}

module.exports = { ContextEngine, evidenceLedger, historySummary, selectContextLevel, stableSystemPrompt, summarize };
