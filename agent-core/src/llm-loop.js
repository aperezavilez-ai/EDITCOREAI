"use strict";

/**
 * Loop LLM + tools (OpenAI-compatible tool_calls).
 * EDITCOREAI inyecta providerApi.call({ messages, tools, signal, onTextDelta }).
 */

function toolDefsForMode(mode = "explain", allowWrite = false) {
  const readTools = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "Lista archivos/carpetas del proyecto (path relativo).",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Lee un archivo de texto del proyecto.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            startLine: { type: "integer" },
            endLine: { type: "integer" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "Busca texto en el proyecto.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            path: { type: "string" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
  ];

  if ((mode === "execute" || allowWrite) && mode !== "diagnose" && mode !== "list") {
    readTools.push(
      {
        type: "function",
        function: {
          name: "replace_in_file",
          description: "Reemplaza oldText por newText en un archivo (mutacion real).",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["path", "oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Crea archivo nuevo (no usar para *-fixed.js ni placeholders).",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "delete_file",
          description: "Borra un archivo del proyecto (no carpetas). Usa solo si el usuario lo pide.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Ejecuta un comando de verificacion en el proyecto (npm test, node --test, lint, etc.).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
    );
  }
  return readTools;
}

function systemPromptForMode(mode, allowWrite) {
  let elite = null;
  try {
    elite = require("../runtime/elite-communication-policy");
  } catch {
    try {
      elite = require("../../runtime/elite-communication-policy");
    } catch {
      elite = null;
    }
  }
  const wrap = elite?.withEliteCommunicationPolicy
    || ((s) => s);
  const base = [
    "Eres EDITCOREAI Agent Core v0.2. Responde SIEMPRE en espanol.",
    "Usa tool_calls reales. PROHIBIDO inventar lecturas/escrituras.",
    "PROHIBIDO cerrar con 'Verificacion completada con evidencia real'.",
    "PROHIBIDO crear *-fixed.js o placeholders.",
    "PROHIBIDO usar ANALISIS_ERRORES o .claude/*.md como evidencia forense.",
  ];
  if (mode === "diagnose") {
    base.push(
      "MODO DIAGNOSTICO (solo lectura): list_files/read_file/search_files.",
      "Entrega: ## Qué sí funcionó | ## Qué falló / hallazgos | ## Evidencia | ## Cómo lo corregiré",
      "Si no hay defectos reales, dilo. No inventes TODOs.",
    );
  } else if (mode === "execute") {
    base.push(
      "MODO EJECUCION: el usuario autorizo cambios.",
      "No esperes oldText del usuario: lee el archivo con read_file y construye replace_in_file con oldText EXACTO del contenido leido.",
      "Puedes hacer varios replace_in_file / write_file en la misma corrida.",
      "Usa delete_file solo si el usuario pide borrar un archivo concreto.",
      "Si hay tests/verificacion, usa run_command (npm test, node --test, etc.). Si falla, lee el error, corrige y reintenta.",
      "Si no hay defecto real, di que no hay mutaciones y termina (no inventes cambios).",
      "Al final: ## Evidencia de correccion con tools y paths mutados.",
    );
  } else if (mode === "list" || mode === "explain") {
    base.push(
      "Lista carpetas con list_files y explica archivos con read_file.",
      "Respuesta clara en markdown. Sin meta-cierres.",
    );
  }
  if (!allowWrite || mode === "diagnose") {
    base.push("PROHIBIDO write_file/replace_in_file/delete_file en esta corrida.");
  }
  return wrap(base.join("\n"));
}

function parseToolCalls(response = {}) {
  const calls = [];
  const raw = response.tool_calls || response.toolCalls || response.rawToolCalls || [];
  if (Array.isArray(raw)) {
    for (const call of raw) {
      const name = call?.function?.name || call?.name || "";
      let args = call?.function?.arguments || call?.arguments || {};
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      if (name) {
        calls.push({
          id: call.id || `call_${calls.length}`,
          name,
          input: args && typeof args === "object" ? args : {},
        });
      }
    }
  }
  return calls;
}

function extractAssistantText(response = {}) {
  if (typeof response.text === "string" && response.text.trim()) return response.text.trim();
  if (typeof response.content === "string" && response.content.trim()) return response.content.trim();
  if (Array.isArray(response.content)) {
    return response.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }
  if (typeof response.message?.content === "string") return response.message.content.trim();
  return "";
}

function extractEvidenceKeywords(prompt = "", filePath = "") {
  const keys = new Set();
  const text = `${prompt}\n${filePath}`;
  for (const m of text.matchAll(/\b([A-Za-z_][\w]{3,})\b/g)) {
    const w = m[1];
    if (/^(resources|runtime|src|app|file|path|modo|diagn|audita|solo|estos|archivos)$/i.test(w)) continue;
    keys.add(w);
  }
  // Símbolos críticos del Agent Core que suelen estar lejos del head.
  for (const k of [
    "tryRunAgentCore", "isAgentCoreEnabled", "loadAgentCore", "resolveCoreRoot",
    "runAgent", "planTask", "CORE_VERSION", "agent-core-bridge",
  ]) keys.add(k);
  return [...keys].slice(0, 40);
}

function sliceRelevantContent(content = "", keywords = [], headChars = 4500, windowChars = 2200) {
  const raw = String(content || "");
  if (raw.length <= headChars + 500) {
    return { text: raw, truncated: false, totalChars: raw.length };
  }

  const lower = raw.toLowerCase();
  const seen = new Set();
  const takeMatches = (keys, maxHitsPerKey = 2) => {
    const parts = [];
    for (const key of keys) {
      const needle = String(key || "").toLowerCase();
      if (!needle || needle.length < 4) continue;
      let from = 0;
      let hits = 0;
      while (hits < maxHitsPerKey && from < raw.length) {
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        const start = Math.max(0, idx - 220);
        const end = Math.min(raw.length, idx + needle.length + windowChars);
        const stamp = `${start}:${end}`;
        if (!seen.has(stamp)) {
          seen.add(stamp);
          parts.push({
            label: `MATCH ${key} @${idx}`,
            text: raw.slice(start, end),
          });
          hits += 1;
        }
        from = idx + needle.length;
      }
    }
    return parts;
  };

  // PRIORIDAD: simbolos de invocacion Agent Core ANTES del HEAD,
  // para que un CORTE_PRESUPUESTO no borre tryRunAgentCore(...).
  const priorityKeys = [
    "tryRunAgentCore(",
    "tryRunAgentCore",
    "isAgentCoreEnabled(",
    "isAgentCoreEnabled",
    "useCore",
    "Agent Core (motor",
  ];
  const priorityParts = takeMatches(priorityKeys, 2);
  const headPart = { label: "HEAD", text: raw.slice(0, headChars) };
  const otherKeys = keywords.filter((k) => !priorityKeys.some((p) => p.toLowerCase().includes(String(k).toLowerCase())));
  const otherParts = takeMatches(otherKeys, 1);
  const tailPart = { label: "TAIL", text: raw.slice(-1200) };

  const parts = [...priorityParts, headPart, ...otherParts, tailPart];
  const text = parts.map((p) => `<<<${p.label}>>>\n${p.text}`).join("\n\n");
  return { text, truncated: true, totalChars: raw.length };
}

/**
 * Empaqueta evidencia para el modelo.
 * Nunca entrega un corte silencioso a mitad de línea sin etiquetar.
 * @returns {{ text: string, truncatedPaths: string[], fileMeta: object[] }}
 */
function packEvidenceForModel(steps = [], options = {}) {
  const maxChars = Number(options.maxChars) || 24000;
  const prompt = String(options.prompt || "");
  const chunks = [];
  const truncatedPaths = [];
  const fileMeta = [];
  let used = 0;

  // Unir ventanas del mismo path antes de empaquetar (head + invocacion Agent Core).
  let { mergeReadStepsByPath } = (() => {
    try {
      return require("./verifier");
    } catch {
      return {};
    }
  })();
  const listSteps = steps.filter((s) => s?.ok && s.name === "list_files");
  const readSteps = typeof mergeReadStepsByPath === "function"
    ? mergeReadStepsByPath(steps)
    : steps.filter((s) => s?.ok && s.name === "read_file");

  // Archivos chicos primero; main.js al final pero con matches prioritarios al inicio del bloque.
  readSteps.sort((a, b) => {
    const ap = String(a.result?.path || "").toLowerCase();
    const bp = String(b.result?.path || "").toLowerCase();
    const aMain = /main\.js$/.test(ap) ? 1 : 0;
    const bMain = /main\.js$/.test(bp) ? 1 : 0;
    if (aMain !== bMain) return aMain - bMain;
    return String(a.result?.content || "").length - String(b.result?.content || "").length;
  });

  for (const step of listSteps) {
    const entries = Array.isArray(step.result)
      ? step.result
      : (step.result?.entries || []);
    const names = entries.slice(0, 120).map((e) => e?.name || e?.path || "").filter(Boolean);
    const block = `LIST ${step.input?.path || "."}\n${names.join("\n")}`;
    if (used + block.length > maxChars) break;
    chunks.push(block);
    used += block.length;
  }

  for (const step of readSteps) {
    const p = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
    const full = String(step.result?.content || "");
    const toolTruncated = step.result?.truncated === true
      || step.result?.partial === true
      || (Array.isArray(step.result?.windows) && step.result.windows.length > 1)
      || Number(step.result?.endLine || 0) > 0 && Number(step.result?.totalLines || 0) > Number(step.result?.endLine || 0);

    const keywords = extractEvidenceKeywords(prompt, p);
    const packed = sliceRelevantContent(full, keywords);
    const budgetLeft = Math.max(2500, maxChars - used - 400);
    let body = packed.text;
    let packTruncated = packed.truncated;
    if (body.length > budgetLeft) {
      // Cortar al final: conserva MATCH tryRunAgentCore del inicio.
      body = `${body.slice(0, budgetLeft)}\n<<<CORTE_PRESUPUESTO>>>`;
      packTruncated = true;
    }

    const flags = [];
    if (toolTruncated) flags.push("TOOL_PARTIAL_READ");
    if (packTruncated) flags.push("PACK_TRUNCATED_FOR_MODEL");
    if (flags.length) truncatedPaths.push(p);

    const hasInvoke = /tryRunAgentCore\s*\(/.test(full);
    const header = [
      `FILE ${p}`,
      `BYTES_IN_TOOL_RESULT=${full.length}`,
      `TOTAL_CHARS_SOURCE≈${packed.totalChars}`,
      hasInvoke ? "CONTIENE_INVOCACION=tryRunAgentCore(" : "CONTIENE_INVOCACION=no",
      flags.length
        ? `AVISO: ${flags.join(", ")} — esto NO significa que el archivo en disco esté incompleto o con sintaxis rota. PROHIBIDO reportar "archivo truncado", "require incompleto" o "error de sintaxis" solo por este corte.`
        : "AVISO: evidencia completa del resultado de read_file (sin corte de empaquetado).",
      hasInvoke
        ? "OBLIGATORIO en el informe: citar la invocacion visible de tryRunAgentCore( (no digas que no es verificable)."
        : "",
    ].filter(Boolean).join("\n");

    const block = `${header}\n\n${body}`;
    if (used + Math.min(block.length, 400) > maxChars && chunks.length) break;
    const clipped = block.slice(0, Math.max(0, maxChars - used));
    chunks.push(clipped);
    used += clipped.length;
    fileMeta.push({
      path: p,
      bytes: full.length,
      truncatedForModel: packTruncated || toolTruncated,
      hasInvoke,
    });
  }

  return {
    text: chunks.join("\n\n---\n\n"),
    truncatedPaths: [...new Set(truncatedPaths)],
    fileMeta,
  };
}

/**
 * Una sola llamada al modelo SIN tools: sintetiza el informe desde evidencia ya leida.
 * Asi el agente razona de verdad, sin inventar view_file/edit_file ni plantillas fijas.
 */
async function synthesizeFromEvidence(input = {}, options = {}) {
  const mode = options.mode || "diagnose";
  const seedSteps = options.seedSteps || [];
  if (!input.providerApi?.call) {
    return { finalText: "", providerCalls: 0, skipped: true };
  }

  const packed = packEvidenceForModel(seedSteps, {
    prompt: input.prompt || "",
    maxChars: mode === "diagnose" ? 32000 : 18000,
  });
  const evidence = packed.text;
  if (!evidence.trim()) {
    return { finalText: "", providerCalls: 0, skipped: true };
  }

  input.onProgress?.({ phase: "model", text: "Agent Core · sintetizando con el modelo (evidencia real)..." });

  const system = [
    "Eres EDITCOREAI Agent Core. Responde SIEMPRE en espanol.",
    "Te doy EVIDENCIA REAL ya leida con tools. NO pidas ni inventes mas tools.",
    "PROHIBIDO mencionar view_file, edit_file, file_reader, codebase_search.",
    "PROHIBIDO inventar rutas o fallos que no esten en la evidencia.",
    "PROHIBIDO 'Verificacion completada con evidencia real'.",
    "Si un FILE tiene CONTIENE_INVOCACION=tryRunAgentCore( o un bloque <<<MATCH tryRunAgentCore: DEBES citar esa invocacion. PROHIBIDO decir que no es verificable.",
    "Si un FILE tiene AVISO PACK_TRUNCATED_FOR_MODEL o CORTE_PRESUPUESTO: el archivo en disco NO esta roto; solo se acorto el texto enviado al modelo.",
    "PROHIBIDO concluir 'archivo truncado', 'linea incompleta', 'require sin cerrar' o 'error de sintaxis' por un corte de evidencia.",
    "Solo reporta defectos si ves una sentencia completa claramente incorrecta en la evidencia.",
    "Si falta contexto por truncado, dilo como limitacion de evidencia, NO como bug del archivo.",
    mode === "diagnose"
      ? "Formato obligatorio: ## Qué sí funcionó | ## Resumen por archivo | ## Qué falló / hallazgos | ## Evidencia | ## Cómo lo corregiré"
      : "Explica con claridad basandote solo en la evidencia.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `PROYECTO: ${input.projectRoot || ""}`,
        `MODO: ${mode}`,
        packed.truncatedPaths.length
          ? `ARCHIVOS CON EVIDENCIA ACORTADA PARA EL MODELO (no implica archivo roto): ${packed.truncatedPaths.join(", ")}`
          : "Ningun archivo fue acortado por empaquetado.",
        "",
        "SOLICITUD DEL USUARIO:",
        String(input.prompt || ""),
        "",
        "EVIDENCIA REAL (unica fuente permitida):",
        evidence,
        "",
        "Escribe el informe ahora. Solo sobre esta evidencia.",
      ].join("\n"),
    },
  ];

  try {
    const response = await input.providerApi.call({
      messages,
      tools: [],
      enableTools: false,
      signal: input.signal,
      onTextDelta: (delta) => {
        if (!delta) return;
        input.onProgress?.({ phase: "narration_delta", text: String(delta) });
      },
    });
    const finalText = extractAssistantText(response);
    // Si el provider igual devolvio tool_calls sin texto, la sintesis fallo.
    const toolCalls = parseToolCalls(response);
    return {
      finalText: finalText || "",
      providerCalls: 1,
      skipped: false,
      truncatedPaths: packed.truncatedPaths,
      fileMeta: packed.fileMeta,
      synthRejectedToolCalls: !finalText && toolCalls.length > 0,
    };
  } catch (error) {
    return {
      finalText: "",
      providerCalls: 1,
      skipped: false,
      error: String(error?.message || error),
      truncatedPaths: packed.truncatedPaths,
      fileMeta: packed.fileMeta,
    };
  }
}

/**
 * @returns {Promise<{ steps: object[], finalText: string, providerCalls: number }>}
 */
async function runLlmToolLoop(input = {}, options = {}) {
  const {
    mode = "explain",
    allowWrite = false,
    seedSteps = [],
    maxIterations = 8,
    repairHint = "",
  } = options;

  if (!input.providerApi?.call) {
    return { steps: [...seedSteps], finalText: "", providerCalls: 0, skipped: true };
  }

  const tools = input.tools;
  const steps = [...seedSteps];
  let providerCalls = 0;
  const messages = [
    { role: "system", content: systemPromptForMode(mode, allowWrite) },
    {
      role: "user",
      content: [
        `PROYECTO: ${input.projectRoot || ""}`,
        `MODO: ${mode}`,
        `PERMISO ESCRITURA: ${allowWrite && mode !== "diagnose" ? "si" : "no"}`,
        "",
        "SOLICITUD:",
        String(input.prompt || ""),
        repairHint ? `\nREPARACION REQUERIDA:\n${repairHint}` : "",
        "",
        seedSteps.length
          ? `EVIDENCIA YA OBTENIDA (${seedSteps.filter((s) => s.ok).length} tools OK). Continua desde ahi; no repitas lecturas identicas sin motivo.`
          : "Empieza con tools si hace falta.",
      ].filter(Boolean).join("\n"),
    },
  ];

  const toolSchemas = toolDefsForMode(mode, allowWrite && mode !== "diagnose");
  let finalText = "";

  for (let i = 0; i < maxIterations; i += 1) {
    if (input.signal?.aborted) break;
    input.onProgress?.({ phase: "model", text: `Agent Core · modelo (${i + 1}/${maxIterations})...` });

    let response;
    try {
      providerCalls += 1;
      response = await input.providerApi.call({
        messages,
        tools: toolSchemas,
        signal: input.signal,
        onTextDelta: (delta) => {
          if (!delta) return;
          input.onProgress?.({ phase: "narration_delta", text: String(delta) });
        },
      });
    } catch (error) {
      steps.push({
        name: "provider_call",
        ok: false,
        error: String(error?.message || error),
        index: steps.length,
      });
      break;
    }

    const toolCalls = parseToolCalls(response);
    const text = extractAssistantText(response);
    if (text) finalText = text;

    if (!toolCalls.length) {
      messages.push({ role: "assistant", content: text || "(sin texto)" });
      break;
    }

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
      })),
    });

    for (const call of toolCalls) {
      if (input.signal?.aborted) break;
      if ((call.name === "write_file" || call.name === "replace_in_file" || call.name === "delete_file")
        && (mode === "diagnose" || !allowWrite)) {
        const err = "Escritura bloqueada en este modo.";
        steps.push({ name: call.name, input: call.input, ok: false, error: err, index: steps.length });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: err }) });
        continue;
      }
      if (call.name === "write_file" && /(?:^|\/)[\w.-]*-fixed\.js$/i.test(String(call.input?.path || ""))) {
        const err = "Bloqueado: no se permiten *-fixed.js.";
        steps.push({ name: call.name, input: call.input, ok: false, error: err, index: steps.length });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: err }) });
        continue;
      }

      input.onProgress?.({
        phase: "tool",
        stage: "running",
        name: call.name,
        input: call.input,
        index: steps.length,
      });
      try {
        const result = await tools.execute(call.name, call.input || {});
        const step = {
          name: call.name,
          input: call.input || {},
          result,
          ok: true,
          index: steps.length,
        };
        steps.push(step);
        input.onProgress?.({
          phase: "tool",
          stage: "done",
          name: call.name,
          input: call.input,
          result,
          ok: true,
          index: steps.length - 1,
        });
        const compact = typeof result === "string"
          ? result.slice(0, 6000)
          : JSON.stringify(result).slice(0, 6000);
        messages.push({ role: "tool", tool_call_id: call.id, content: compact });
      } catch (error) {
        const msg = String(error?.message || error);
        steps.push({
          name: call.name,
          input: call.input || {},
          ok: false,
          error: msg,
          index: steps.length,
        });
        input.onProgress?.({
          phase: "tool",
          stage: "failed",
          name: call.name,
          input: call.input,
          ok: false,
          index: steps.length - 1,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: msg }) });
      }
    }
  }

  return { steps, finalText, providerCalls, skipped: false };
}

module.exports = {
  runLlmToolLoop,
  synthesizeFromEvidence,
  packEvidenceForModel,
  sliceRelevantContent,
  extractEvidenceKeywords,
  toolDefsForMode,
  systemPromptForMode,
  parseToolCalls,
  extractAssistantText,
};
