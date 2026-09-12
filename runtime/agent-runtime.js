"use strict";

const { ActionRegistry } = require("./action-registry");
const { SmartRetry, createCommonStrategies } = require("./smart-retry");

const MAX_TOOL_RESULT_CHARS = 2000;
const COMPACT_TRIGGER_STEPS = 6;
const KEEP_RECENT_PAIRS = 4;
const PROVIDER_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_DUPLICATE_BLOCKS = 3;

const CLAUDE_CONFIG = {
  MAX_LOOP_WINDOW: 5,
  MAX_IDENTICAL_ACTIONS: 2,
  MAX_FAILED_RETRIES: 3,
  TOKEN_WARNING_THRESHOLD: 0.7,
  TOKEN_CRITICAL_THRESHOLD: 0.9,
  ACTION_CACHE_TTL: 3600000,
  MAX_CACHE_ENTRIES: 1000,
};

let actionRegistry = null;
let smartRetry = null;

function getActionRegistry() {
  if (!actionRegistry) {
    actionRegistry = new ActionRegistry({
      maxEntries: CLAUDE_CONFIG.MAX_CACHE_ENTRIES,
      cacheTTL: CLAUDE_CONFIG.ACTION_CACHE_TTL,
    });
  }
  return actionRegistry;
}

function getSmartRetry() {
  if (!smartRetry) {
    smartRetry = new SmartRetry({
      maxAttempts: CLAUDE_CONFIG.MAX_FAILED_RETRIES,
      timeout: 30000,
      logger: console,
    });
  }
  return smartRetry;
}

const MUTATION_TOOLS = new Set(["write_file", "replace_in_file", "create_project", "service_write"]);

function detectLoop(steps) {
  if (steps.length < CLAUDE_CONFIG.MAX_LOOP_WINDOW * 2) {
    return false;
  }
  const recentActions = steps.slice(-CLAUDE_CONFIG.MAX_LOOP_WINDOW);
  const previousActions = steps.slice(-CLAUDE_CONFIG.MAX_LOOP_WINDOW * 2, -CLAUDE_CONFIG.MAX_LOOP_WINDOW);
  const recentSig = recentActions.map((s) => s.name).join(",");
  const previousSig = previousActions.map((s) => s.name).join(",");
  if (recentSig === previousSig && recentSig) {
    console.warn("🔄 [Claude Code] Loop detectado: misma secuencia de acciones");
    return true;
  }
  return false;
}

function wasActionExecuted(action, steps) {
  const registry = getActionRegistry();
  if (registry.wasExecuted(action)) {
    console.log(`⚡ [Claude Code] Acción ya ejecutada (cache): ${action.name}`);
    return true;
  }
  return false;
}

function stepSignature(name, args) {
  return JSON.stringify({ name: String(name || ""), input: args && typeof args === "object" ? args : {} });
}

function requestSignalFor(runSignal, requestController) {
  const signals = [AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)];
  if (runSignal) signals.push(runSignal);
  if (requestController?.signal) signals.push(requestController.signal);
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function isSteerAbort(err) {
  return err?.code === "AGENT_STEER";
}

function truncateLargeResults(messages) {
  return messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    const content = String(msg.content || "");
    if (content.length <= MAX_TOOL_RESULT_CHARS) return msg;
    return { ...msg, content: content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[${content.length - MAX_TOOL_RESULT_CHARS} chars omitidos]` };
  });
}

function compactStepHistory(messages, steps) {
  const totalSteps = steps.length;
  if (totalSteps <= COMPACT_TRIGGER_STEPS) return messages;
  const oldStepsCount = totalSteps - KEEP_RECENT_PAIRS;
  if (oldStepsCount <= 0) return messages;

  const head = messages.slice(0, 2);
  const recentMessages = [];
  let stepsSeen = 0;

  for (let i = messages.length - 1; i >= 2; i--) {
    const msg = messages[i];
    recentMessages.unshift(msg);
    if (msg.role === "assistant" && msg.tool_calls) {
      stepsSeen++;
      if (stepsSeen >= KEEP_RECENT_PAIRS) break;
    }
  }

  const summaryLines = steps.slice(0, oldStepsCount).map((step, i) => {
    const target = step.input?.path || step.input?.query || step.input?.command || "";
    const status = step.ok ? "OK" : `ERROR: ${String(step.result?.error || "").slice(0, 100)}`;
    return `${i + 1}. ${step.name}${target ? ` (${String(target).slice(0, 100)})` : ""}: ${status}`;
  });

  const summaryMsg = { role: "user", content: `RESUMEN DE ACCIONES YA EJECUTADAS (no las repitas):\n${summaryLines.join("\n")}` };
  return [...head, summaryMsg, ...recentMessages];
}

function isToolsUnsupportedError(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    err?.status === 400 &&
    (msg.includes("tool") || msg.includes("function") || msg.includes("unsupported") || msg.includes("not support"))
  );
}

class AgentRuntime {
  constructor({ aiCore, dispatcher, context = () => "" } = {}) {
    if (!aiCore || !dispatcher) throw new Error("AgentRuntime requiere AI Core y Tool Dispatcher.");
    this.aiCore = aiCore;
    this.dispatcher = dispatcher;
    this.context = context;
  }

  async run(input = {}) {
    const messages = [
      { role: "system", content: input.systemPrompt || "Completa la tarea usando las herramientas disponibles." },
    ];
    // IMPORTANT FIX: Inyecta explícitamente el directorio de trabajo actual (process.cwd()) 
    // en el contexto del usuario para asegurar que el LLM sepa en todo momento cuál es la raíz válida.
    const sysContext = `Directorio raíz de trabajo actual: ${process.cwd().replace(/\\/g, "/")}\n\n`;
    const userText = `${sysContext}${await this.context(input)}\n\n${input.prompt || ""}`.trim();
    const userImages = Array.isArray(input.images) ? input.images.filter((img) => img?.dataUrl) : [];
    
    if (userImages.length > 0) {
      messages.push({ role: "user", content: [
        { type: "text", text: userText },
        ...userImages.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl, detail: "auto" } })),
      ] });
    } else {
      messages.push({ role: "user", content: userText });
    }

    const steps = [];
    const usageRows = [];
    const maxSteps = Math.max(1, Number(input.maxSteps) || 20);
    let callMode = "native";

    const recordUsage = (usage, messagesToEstimate, outputText) => {
      const raw = usage && typeof usage === "object" ? usage : {};
      const inputTokens = Number(raw.prompt_tokens || raw.input_tokens || raw.inputTokens || 0);
      const outputTokens = Number(raw.completion_tokens || raw.output_tokens || raw.outputTokens || 0);
      const estimatedInput = inputTokens ? 0 : Math.ceil(JSON.stringify(messagesToEstimate).length / 4);
      usageRows.push({
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        confirmed_input_tokens: inputTokens,
        confirmed_output_tokens: outputTokens,
        provider_cache_read_tokens: Number(raw.cache_read_input_tokens || raw.cached_tokens || raw.prompt_tokens_details?.cached_tokens || 0),
        estimated_input_tokens: estimatedInput,
        estimated_output_tokens: outputTokens ? 0 : Math.ceil(String(outputText || "").length / 4),
        provider_calls: 1,
      });
    };
    
    const totalUsage = () => {
      const totals = usageRows.reduce((total, row) => {
        for (const [key, value] of Object.entries(row)) total[key] = Number(total[key] || 0) + Number(value || 0);
        return total;
      }, { model: input.model || "" });
      totals.net_input_tokens_estimate = usageRows.reduce((sum, row) => {
        const billed = Number(row.confirmed_input_tokens || row.estimated_input_tokens || 0);
        return sum + Math.max(0, billed - Number(row.provider_cache_read_tokens || 0));
      }, 0);
      return totals;
    };
    
    const maxNetInputTokens = Math.max(0, Number(input.maxNetInputTokens) || 0);
    const signatureCounts = new Map();
    const maxDuplicateBlocks = Math.max(1, Number(input.maxDuplicateBlocks) || DEFAULT_MAX_DUPLICATE_BLOCKS);
    let blockedDuplicates = 0;

    for (let index = 0; index < maxSteps; index += 1) {
      if (Array.isArray(input.steering) && input.steering.length) {
        const pending = input.steering.splice(0, input.steering.length);
        for (const direction of pending) {
          const text = String(direction?.instruction || "").trim();
          if (!text) continue;
          messages.push({ role: "user", content: `NUEVA INSTRUCCION DEL USUARIO (prioritaria): ${text}` });
          steps.push({ index, name: "direction", input: { instruction: text }, ok: true, result: { message: "Instruccion incorporada" } });
          if (typeof input.onProgress === "function") input.onProgress(steps[steps.length - 1]);
        }
      }

      const sendTools = callMode !== "none" ? this.dispatcher.definitions() : [];
      const outgoingMessages = truncateLargeResults(compactStepHistory(messages, steps));
      const requestController = new AbortController();
      if (typeof input.onRequestController === "function") input.onRequestController(requestController);
      const signal = requestSignalFor(input.signal, requestController);
      let result;
      
      try {
        result = await this.aiCore.complete({
          provider: input.provider,
          model: input.model,
          apiKey: input.apiKey,
          messages: outgoingMessages,
          tools: sendTools,
          signal,
        });
      } catch (err) {
        if (isSteerAbort(err)) continue;

        if ([429, 500, 502, 503, 504].includes(err?.status) ||
            /timeout|timed out|network|fetch failed|socket/i.test(String(err?.message || ""))) {
          console.warn(`\u26a0\ufe0f [AgentRuntime] Error de API retryable (step ${index + 1}): ${err.message}`);
          if (index < maxSteps - 1) {
            await new Promise(r => setTimeout(r, 2000 * Math.min(index + 1, 3)));
            continue;
          }
          return { text: `Error de conexi\u00f3n con el proveedor despu\u00e9s de ${index + 1} intentos: ${err.message}`, toolCalls: [], usage: totalUsage() };
        }

        if (callMode === "native" && isToolsUnsupportedError(err)) {
          callMode = "none";
          result = await this.aiCore.complete({
            provider: input.provider,
            model: input.model,
            apiKey: input.apiKey,
            messages: outgoingMessages,
            tools: [],
            signal: requestSignalFor(input.signal, requestController),
          });
        } else {
          throw err;
        }
      }

      recordUsage(result.usage, outgoingMessages, result.text);

      const usageTotals = totalUsage();
      if (maxNetInputTokens && usageTotals.net_input_tokens_estimate >= maxNetInputTokens) {
        return {
          ok: true,
          segmentYield: true,
          error: "",
          text: result.text,
          steps,
          usage: usageTotals,
          budgetExhausted: false,
        };
      }

      let fn = null;
      let args = {};
      let callId = null;

      const nativeCall = result.toolCalls?.[0];
      if (nativeCall && callMode !== "none") {
        callMode = "native";
        const raw = nativeCall.function || nativeCall;
        fn = { name: raw.name };
        args = raw.arguments || raw.input || {};
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        callId = nativeCall.id || `call-${index}`;
      } else if (result.text && typeof input.parseText === "function") {
        const parsed = input.parseText(result.text);
        if (parsed && parsed.type === "tool" && parsed.name) {
          if (callMode !== "none") callMode = "text";
          fn = { name: parsed.name };
          args = parsed.input || {};
          callId = null;
        }
      }

      if (!fn) return { ok: true, text: result.text, steps, usage: totalUsage() };

      const signature = stepSignature(fn.name, args);
      const seenCount = signatureCounts.get(signature) || 0;
      
      if (seenCount >= maxDuplicateBlocks && !MUTATION_TOOLS.has(fn.name)) {
        blockedDuplicates += 1;
        messages.push({ role: "assistant", content: result.text || "" });
        messages.push({ role: "user", content: `Ya ejecutaste ${fn.name} con esos argumentos ${seenCount} veces y el resultado no cambia. Cambia de estrategia: usa otra herramienta, otros argumentos, o si ya tienes la informacion necesaria responde con el resultado final sin llamar mas herramientas.` });
        if (blockedDuplicates >= maxDuplicateBlocks) {
          return {
            ok: false,
            error: `El agente entro en un bucle repitiendo ${fn.name} y se detuvo para no consumir mas tokens.`,
            text: result.text,
            steps,
            usage: totalUsage(),
          };
        }
        continue;
      }
      signatureCounts.set(signature, seenCount + 1);

      // IMPORTANT FIX: Inyectamos explicitamente process.cwd() en el action context
      // para que el dispatcher sepa dónde buscar las carpetas físicamente.
      const actionContext = { ...input.context, rootPath: process.cwd() };
      const executed = await this.dispatcher.dispatch(fn.name, args, actionContext);
      
      const step = { index, name: fn.name, input: args, ...executed };
      steps.push(step);
      if (typeof input.onProgress === "function") input.onProgress(step);

      if (callMode === "native") {
        messages.push({ role: "assistant", content: result.text || "", tool_calls: [{ id: callId, type: "function", function: { name: fn.name, arguments: JSON.stringify(args) } }] });
        messages.push({ role: "tool", tool_call_id: callId, name: fn.name, content: JSON.stringify(executed) });
      } else {
        messages.push({ role: "assistant", content: result.text });
        messages.push({ role: "user", content: `Resultado de ${fn.name}: ${JSON.stringify(executed)}` });
      }

      if (!executed.ok) {
        messages.push({ role: "user", content: "La herramienta fallo. Corrige los argumentos o informa el bloqueo." });
      }
    }

    return { ok: true, segmentYield: true, error: "", steps, usage: totalUsage() };
  }
}

module.exports = { AgentRuntime };