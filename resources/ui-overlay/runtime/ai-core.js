"use strict";

const { normalizeProviderDefinition } = require("./provider-contract");
const { sanitizeMessagesToolArguments, sanitizeToolCallArguments, safeParseToolArguments } = require("../agent-parser");
const { resolveFactualTemperature } = require("./anti-hallucination-policy");

function usage(raw = {}) {
  const cacheRead = Number(raw.cache_read_input_tokens || raw.cached_input_tokens || raw.cached_tokens || raw.prompt_tokens_details?.cached_tokens || raw.provider_cache_read_tokens || 0);
  const cacheWrite = Number(raw.cache_creation_input_tokens || raw.cache_creation?.input_tokens || 0);
  return {
    ...raw,
    inputTokens: Number(raw.prompt_tokens || raw.input_tokens || raw.promptTokenCount || 0),
    outputTokens: Number(raw.completion_tokens || raw.output_tokens || raw.candidatesTokenCount || 0),
    cachedInputTokens: cacheRead,
    provider_cache_read_tokens: cacheRead,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    reasoningTokens: Number(raw.reasoning_tokens || raw.completion_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(raw.total_tokens || raw.totalTokenCount || 0),
  };
}

function withCacheControl(messages) {
  return messages.map((msg, idx) => {
    if (typeof msg.content !== "string" || !msg.content) return msg;
    // Mark system message and first user message for prefix caching.
    // Providers that support it (OpenRouter, Together AI, Fireworks AI, etc.) will cache the prefix.
    // Providers that don't support cache_control safely ignore the unknown field.
    if (msg.role === "system" || (msg.role === "user" && idx <= 1)) {
      return { ...msg, content: [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }] };
    }
    return msg;
  });
}

function normalizeToolCallsOut(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((call) => call?.function?.name || call?.name)
    .map((call, index) => {
      const fn = call.function || call;
      const rawArgs = fn.arguments ?? fn.input ?? "{}";
      const sanitized = sanitizeToolCallArguments(rawArgs);
      // Si el modelo devolvió argumentos no vacíos que no son JSON válido,
      // el sanitizer los convierte a "{}". Detectar este caso y lanzar
      // MALFORMED_TOOL_JSON para que el adapter pueda recuperarse.
      if (sanitized === "{}" && rawArgs !== null && rawArgs !== undefined) {
        const raw = typeof rawArgs === "string" ? rawArgs.trim() : String(rawArgs ?? "").trim();
        // Solo lanzar si el modelo envió argumentos sustantivos (>10 chars) que no
        // comienzan con '{' — eso indica texto plano/prosa en lugar de JSON.
        // Fragmentos cortos como "}" son residuos de streaming incompleto: silenciar.
        if (raw && raw !== "{}" && raw.length > 10 && !raw.startsWith("{")) {
          const err = Object.assign(
            new Error(`MALFORMED_TOOL_JSON: tool "${fn.name}" arguments no son JSON válido: ${raw.slice(0, 120)}`),
            { code: "MALFORMED_TOOL_JSON" }
          );
          throw err;
        }
      }
      return {
        id: call.id || `call_${fn.name || "tool"}_${index}`,
        type: "function",
        function: {
          name: String(fn.name || ""),
          arguments: sanitized,
        },
      };
    });
}


function normalizeForAnthropic(messages) {
  const result = [];
  for (const msg of sanitizeMessagesToolArguments(messages)) {
    if (msg.role === "system") continue;
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const content = [];
      if (msg.content) content.push({ type: "text", text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      for (const call of msg.tool_calls) {
        const fn = call.function || call;
        let input = fn.arguments || fn.input || {};
        if (typeof input === "string") input = safeParseToolArguments(input);
        if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
        content.push({ type: "tool_use", id: call.id || `call_${fn.name}`, name: fn.name, input });
      }
      result.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }] });
    } else {
      result.push(msg);
    }
  }
  return result;
}

function normalizeForGemini(messages) {
  return sanitizeMessagesToolArguments(messages).filter((item) => item.role !== "system").map((item) => {
    if (item.role === "tool") {
      let response = item.content;
      try { response = JSON.parse(String(item.content || "{}")); } catch { response = { content: String(item.content || "") }; }
      return { role: "user", parts: [{ functionResponse: { name: item.name || item.tool_name || "tool", response } }] };
    }
    const parts = [];
    if (item.content) parts.push({ text: typeof item.content === "string" ? item.content : JSON.stringify(item.content) });
    for (const call of Array.isArray(item.tool_calls) ? item.tool_calls : []) {
      const fn = call.function || call;
      let args = fn.arguments || fn.input || {};
      if (typeof args === "string") args = safeParseToolArguments(args);
      if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
      parts.push({ functionCall: { name: fn.name, args } });
    }
    return { role: item.role === "assistant" ? "model" : "user", parts };
  });
}

function deltaText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : String(part?.text || "")).join("");
}

async function readOpenAiStream(response, onTextDelta, signal, onStreamActivity = null) {
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let streamUsage = {};
  const toolCalls = new Map();
  const toolCallKeyByIndex = new Map();
  const noteActivity = (kind, detail = {}) => {
    try { onStreamActivity?.({ kind, ...detail }); } catch { /* ignore */ }
  };
  const onAbort = () => {
    try { reader.cancel("aborted"); } catch { /* ignore */ }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const consume = (chunk, flush = false) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = flush ? "" : (lines.pop() || "");
    for (const line of lines) {
      const value = line.trim();
      if (!value.startsWith("data:") || value === "data: [DONE]") continue;
      let data;
      try { data = JSON.parse(value.slice(5).trim()); } catch { continue; }
      noteActivity("sse_frame");
      if (data?.usage) streamUsage = data.usage;
      const delta = data?.choices?.[0]?.delta || data?.choices?.[0]?.message || {};
      const content = deltaText(delta.content ?? data?.choices?.[0]?.text);
      if (content) {
        text += content;
        try { onTextDelta?.(content); } catch {}
        noteActivity("text");
      }
      for (const call of delta.tool_calls || []) {
        const index = Number(call.index) || 0;
        const key = call.id ? `id:${call.id}` : (toolCallKeyByIndex.get(index) || `index:${index}`);
        if (call.id) toolCallKeyByIndex.set(index, key);
        const current = toolCalls.get(key) || { id: "", type: "function", function: { name: "", arguments: "" } };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name += call.function.name;
        if (call.function?.arguments) current.function.arguments += call.function.arguments;
        toolCalls.set(key, current);
        noteActivity("tool_call", { name: call.function?.name || current.function.name || "" });
      }
      if (delta.function_call?.name || delta.function_call?.arguments) {
        const key = "legacy:0";
        const current = toolCalls.get(key) || { id: "legacy-stream-0", type: "function", function: { name: "", arguments: "" } };
        current.function.name += delta.function_call?.name || "";
        current.function.arguments += delta.function_call?.arguments || "";
        toolCalls.set(key, current);
        noteActivity("tool_call", { name: current.function.name || "" });
      }
    }
  };
  try {
    let done = false;
    while (!done) {
      if (signal?.aborted) {
        const err = signal.reason instanceof Error ? signal.reason : new Error("Solicitud cancelada.");
        err.code = err.code || "PROVIDER_TIMEOUT";
        throw err;
      }
      const item = await reader.read();
      done = item.done;
      consume(decoder.decode(item.value || new Uint8Array(), { stream: !done }), done);
    }
    if (pending) consume("\n", true);
    return { text, toolCalls: normalizeToolCallsOut([...toolCalls.values()].filter((call) => call.function.name)), usage: usage(streamUsage) };
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function readAnthropicStream(response, onTextDelta, signal, onStreamActivity = null) {
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let streamUsage = {};
  const toolCalls = new Map();
  let currentToolId = "";
  const noteActivity = (kind, detail = {}) => {
    try { onStreamActivity?.({ kind, ...detail }); } catch { /* ignore */ }
  };
  const onAbort = () => {
    try { reader.cancel("aborted"); } catch { /* ignore */ }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const consume = (chunk, flush = false) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = flush ? "" : (lines.pop() || "");
    for (const line of lines) {
      const value = line.trim();
      if (!value.startsWith("data:") || value === "data: [DONE]") continue;
      let data;
      try { data = JSON.parse(value.slice(5).trim()); } catch { continue; }
      noteActivity("sse_frame");
      const type = String(data?.type || "");
      if (type === "content_block_start" && data?.content_block?.type === "tool_use") {
        currentToolId = String(data.content_block.id || `tool-${toolCalls.size}`);
        toolCalls.set(currentToolId, {
          id: currentToolId,
          type: "function",
          function: { name: String(data.content_block.name || ""), arguments: "" },
        });
        noteActivity("tool_call", { name: String(data.content_block.name || "") });
      } else if (type === "content_block_delta") {
        const delta = data?.delta || {};
        if (delta.type === "text_delta" && delta.text) {
          text += delta.text;
          try { onTextDelta?.(delta.text); } catch { /* ignore */ }
          noteActivity("text");
        } else if (delta.type === "input_json_delta" && delta.partial_json && currentToolId) {
          const current = toolCalls.get(currentToolId);
          if (current) current.function.arguments += delta.partial_json;
          noteActivity("tool_call", { name: current?.function?.name || "" });
        } else if (typeof delta.text === "string" && delta.text) {
          text += delta.text;
          try { onTextDelta?.(delta.text); } catch { /* ignore */ }
          noteActivity("text");
        }
      } else if (type === "message_delta" && data?.usage) {
        streamUsage = { ...streamUsage, ...data.usage };
      } else if (type === "message_start" && data?.message?.usage) {
        streamUsage = { ...streamUsage, ...data.message.usage };
      }
    }
  };
  try {
    let done = false;
    while (!done) {
      if (signal?.aborted) {
        const err = signal.reason instanceof Error ? signal.reason : new Error("Solicitud cancelada.");
        err.code = err.code || "PROVIDER_TIMEOUT";
        throw err;
      }
      const item = await reader.read();
      done = item.done;
      consume(decoder.decode(item.value || new Uint8Array(), { stream: !done }), done);
    }
    if (pending) consume("\n", true);
    return {
      text,
      toolCalls: normalizeToolCallsOut([...toolCalls.values()].filter((call) => call.function.name)),
      usage: usage(streamUsage),
    };
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}


function adapterFor(definition) {
  if (definition.kind === "openai-compatible" || definition.kind === "ollama") {
    return async (input) => {
      const base = definition.baseUrl.replace(/\/+$/, "");
      const safeMessages = sanitizeMessagesToolArguments(input.messages || []);
      const messages = definition.kind === "openai-compatible" ? withCacheControl(safeMessages) : safeMessages;
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey || "ollama"}`, "x-api-key": input.apiKey || "" },
        body: JSON.stringify({ model: input.model, messages, temperature: resolveFactualTemperature(input.temperature), stream: Boolean(input.onTextDelta), ...(input.onTextDelta ? { stream_options: { include_usage: true } } : {}), ...(input.tools?.length ? { tools: input.tools } : {}) }),
        signal: input.signal,
      });
      const contentType = response.headers?.get?.("content-type") || "";
      if (response.ok && input.onTextDelta && contentType.includes("text/event-stream")) {
        const streamed = await readOpenAiStream(response, input.onTextDelta, input.signal, input.onStreamActivity);
        if (streamed) return { ...streamed, toolCalls: normalizeToolCallsOut(streamed.toolCalls) };
      }
      if (response.ok && (input.onTextDelta || input.onStreamActivity) && !contentType.includes("text/event-stream")) {
        try { input.onStreamActivity?.({ kind: "buffered", contentType }); } catch { /* ignore */ }
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = Object.assign(new Error(data?.error?.message || data?.message || `HTTP ${response.status}`), { status: response.status });
        if (/unexpected token|invalid json|malformed/i.test(String(err.message || ""))) err.code = "MALFORMED_TOOL_JSON";
        throw err;
      }
      const message = data?.choices?.[0]?.message || data?.message || {};
      const textContent = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : String(message.content || data?.text || "");
      if (input.onTextDelta && textContent) {
        try { input.onTextDelta(textContent); } catch { /* ignore */ }
      }
      const nativeToolCalls = message.tool_calls || data?.tool_calls || [];
      const legacyCall = message.function_call ? [{ id: `call_${message.function_call.name}_0`, type: "function", function: { name: message.function_call.name, arguments: message.function_call.arguments || "{}" } }] : [];
      const outCalls = normalizeToolCallsOut(nativeToolCalls.length ? nativeToolCalls : legacyCall);
      if (outCalls.length) {
        try { input.onStreamActivity?.({ kind: "tool_call", name: outCalls[0]?.function?.name || "" }); } catch { /* ignore */ }
      }
      return { text: textContent, toolCalls: outCalls, usage: usage(data.usage) };
    };
  }
  if (definition.kind === "anthropic") {
    return async (input) => {
      const systemContent = input.system || input.messages.find((item) => item.role === "system")?.content;
      const systemBlock = systemContent
        ? (Array.isArray(systemContent)
          ? systemContent
          : [{ type: "text", text: systemContent, cache_control: { type: "ephemeral" } }])
        : undefined;
      const wantStream = typeof input.onTextDelta === "function";
      const response = await fetch(`${definition.baseUrl.replace(/\/+$/, "")}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          ...(wantStream ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: input.maxOutputTokens || 8192,
          temperature: resolveFactualTemperature(input.temperature),
          system: systemBlock,
          messages: normalizeForAnthropic(input.messages),
          stream: wantStream,
          ...(input.tools?.length
            ? { tools: input.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) }
            : {}),
        }),
        signal: input.signal,
      });
      const contentType = String(response.headers?.get?.("content-type") || response.headers?.["content-type"] || "");
      if (wantStream && response.ok && contentType.includes("text/event-stream")) {
        const streamed = await readAnthropicStream(response, input.onTextDelta, input.signal, input.onStreamActivity);
        return streamed ? { ...streamed, toolCalls: normalizeToolCallsOut(streamed.toolCalls) } : streamed;
      }
      if (wantStream && response.ok && !contentType.includes("text/event-stream")) {
        try { input.onStreamActivity?.({ kind: "buffered", contentType }); } catch { /* ignore */ }
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = Object.assign(new Error(data?.error?.message || data?.message || `HTTP ${response.status}`), { status: response.status });
        if (/unexpected token|invalid json|malformed/i.test(String(err.message || ""))) err.code = "MALFORMED_TOOL_JSON";
        throw err;
      }
      const blocks = Array.isArray(data.content) ? data.content : [];
      const text = blocks.filter((part) => part.type === "text").map((part) => part.text || "").join("");
      if (wantStream && text) {
        try { input.onTextDelta(text); } catch { /* ignore */ }
      }
      const toolCalls = normalizeToolCallsOut(blocks.filter((part) => part.type === "tool_use").map((part) => ({
        id: part.id,
        type: "function",
        function: { name: part.name, arguments: JSON.stringify(part.input || {}) },
      })));
      if (toolCalls.length) {
        try { input.onStreamActivity?.({ kind: "tool_call", name: toolCalls[0]?.function?.name || "" }); } catch { /* ignore */ }
      }
      return {
        text,
        toolCalls,
        usage: usage(data.usage),
      };
    };
  }
  if (definition.kind === "gemini") {
    return async (input) => {
      const endpoint = `${definition.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
      const contents = normalizeForGemini(input.messages);
      const system = input.system || input.messages.find((item) => item.role === "system")?.content;
      const tools = (input.tools || []).map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: resolveFactualTemperature(input.temperature) },
          systemInstruction: system ? { parts: [{ text: typeof system === "string" ? system : JSON.stringify(system) }] } : undefined,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
        }),
        signal: input.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${response.status}`), { status: response.status });
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((part) => part.text || "").join("");
      if (typeof input.onTextDelta === "function" && text) {
        try { input.onTextDelta(text); } catch { /* ignore */ }
      }
      const toolCalls = parts.filter((part) => part.functionCall?.name).map((part, index) => ({ id: `gemini-${index}`, type: "function", function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) } }));
      if (toolCalls.length) {
        try { input.onStreamActivity?.({ kind: "tool_call", name: toolCalls[0]?.function?.name || "" }); } catch { /* ignore */ }
      }
      return { text, toolCalls: normalizeToolCallsOut(toolCalls), usage: usage(data.usageMetadata) };
    };
  }
  throw new Error(`No existe adaptador para ${definition.kind}.`);
}

class AiCore {
  constructor({ metrics = async () => undefined } = {}) { this.providers = new Map(); this.metrics = metrics; }
  register(input) {
    const definition = normalizeProviderDefinition(input);
    this.providers.set(definition.id, { definition, complete: adapterFor(definition) });
    return definition;
  }
  list() { return [...this.providers.values()].map(({ definition }) => definition); }
  async complete(input = {}) {
    const item = this.providers.get(String(input.provider || input.providerKey || "").toLowerCase());
    if (!item) throw new Error(`Proveedor no registrado: ${input.provider || input.providerKey || ""}`);
    const startedAt = Date.now();
    try {
      const result = await item.complete({
        ...input,
        messages: sanitizeMessagesToolArguments(input.messages || []),
        baseUrl: item.definition.baseUrl,
      });
      await this.metrics({ provider: item.definition.id, model: input.model, ok: true, latencyMs: Date.now() - startedAt, usage: result.usage });
      return {
        ...result,
        toolCalls: normalizeToolCallsOut(result.toolCalls),
        provider: item.definition.id,
        model: input.model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      await this.metrics({ provider: item.definition.id, model: input.model, ok: false, latencyMs: Date.now() - startedAt, error: String(error?.message || error) });
      throw error;
    }
  }
}

module.exports = { AiCore, normalizeForAnthropic, normalizeForGemini, withCacheControl, normalizeToolCallsOut };
