"use strict";

const {
  readOpenAiStream,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  isGatewayHtmlBody,
  createGatewayTimeoutError,
  parseProviderJsonOrThrow,
  withCacheControl,
} = require("../runtime/ai-core");

function normalizeUsage(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  return {
    input_tokens: Number(raw.input_tokens || raw.prompt_tokens || 0),
    output_tokens: Number(raw.output_tokens || raw.completion_tokens || 0),
    cache_read_input_tokens: Number(raw.cache_read_input_tokens || raw.prompt_tokens_details?.cached_tokens || 0),
    cache_creation_input_tokens: Number(raw.cache_creation_input_tokens || 0),
  };
}

function mergeAbortSignals(primary, secondary) {
  if (primary && secondary && typeof AbortSignal.any === "function") {
    return AbortSignal.any([primary, secondary]);
  }
  return primary || secondary || undefined;
}

function isTransientError(error) {
  if (!error) return false;
  if (error?.code === "AGENT_STEER" || error?.code === "ABORT_ERR") return false;
  const status = Number(error?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504, 524].includes(status)) return true;
  const msg = String(error?.message || error || "").toLowerCase();
  return /timeout|time-?out|aborted|cloudflare|524|504|502|503|429|econnreset|etimedout|enotfound|fetch failed|socket|network|overloaded/i.test(msg);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason || new Error("Aborted"));
      }, { once: true });
    }
  });
}

async function callChatSingleAttempt({
  apiBaseUrl,
  apiKey,
  model,
  messages,
  tools,
  signal,
  toolChoice,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  stream = true,
  onTextDelta = null,
}) {
  const url = `${String(apiBaseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const wantStream = stream !== false;
  const safeMessages = Array.isArray(messages) ? messages : [];
  const cachedMessages = typeof withCacheControl === "function"
    ? withCacheControl(safeMessages)
    : safeMessages;
  const body = {
    model,
    messages: cachedMessages,
    temperature: 0.2,
    stream: wantStream,
    ...(wantStream ? { stream_options: { include_usage: true } } : {}),
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
  }

  const timeoutSignal = Number(timeoutMs) > 0 ? AbortSignal.timeout(Number(timeoutMs)) : null;
  const requestSignal = mergeAbortSignals(signal, timeoutSignal);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey || "",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (error) {
    const abortReason = requestSignal?.reason || signal?.reason || error?.cause || error;
    if (abortReason?.code === "AGENT_STEER" || error?.code === "AGENT_STEER") {
      throw Object.assign(
        new Error(String(abortReason?.message || error?.message || "Nueva instruccion del usuario.")),
        { code: "AGENT_STEER" },
      );
    }
    if (error?.name === "TimeoutError" || /timeout|aborted|abort/i.test(String(error?.message || ""))) {
      throw createGatewayTimeoutError(524, error?.message || "");
    }
    throw error;
  }

  const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
  try {
    if (!res.ok) {
      await parseProviderJsonOrThrow(res);
    }
    if (wantStream && contentType.includes("text/event-stream")) {
      const streamed = await readOpenAiStream(res, onTextDelta, requestSignal);
      const msg = {
        content: streamed?.text || "",
        tool_calls: streamed?.toolCalls || [],
      };
      return {
        text: msg.content || "",
        toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
        usage: streamed?.usage ? normalizeUsage(streamed.usage) : null,
      };
    }
    if (contentType.includes("text/html")) {
      const html = await res.text().catch(() => "");
      throw createGatewayTimeoutError(res.status || 524, html.slice(0, 200));
    }
    const data = await parseProviderJsonOrThrow(res);
    const msg = data.choices?.[0]?.message || {};
    let toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!toolCalls.length && Array.isArray(msg.toolCalls)) toolCalls = msg.toolCalls;
    if (!toolCalls.length && msg.function_call) {
      toolCalls = [{
        id: `fn_${Date.now()}`,
        type: "function",
        function: {
          name: msg.function_call.name,
          arguments: msg.function_call.arguments || "{}",
        },
      }];
    }
    if (onTextDelta && msg.content) {
      try { onTextDelta(String(msg.content)); } catch { /* ignore */ }
    }
    return {
      text: msg.content || "",
      toolCalls,
      usage: data?.usage ? normalizeUsage(data.usage) : null,
    };
  } catch (error) {
    if (error?.code === "PROVIDER_GATEWAY_TIMEOUT" || Number(error?.status) === 524 || isGatewayHtmlBody(error?.message)) {
      throw createGatewayTimeoutError(error?.status || 524, error?.detail || error?.message || "");
    }
    if (/API 524|524:|gateway time-?out|cloudflare/i.test(String(error?.message || ""))) {
      const wrapped = createGatewayTimeoutError(524, error.message);
      throw wrapped;
    }
    throw error;
  }
}

async function callChat({
  apiBaseUrl,
  apiKey,
  model,
  messages,
  tools,
  signal,
  toolChoice,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  stream = true,
  onTextDelta = null,
  fallbackProfiles = [],
  onFallback = null,
}) {
  const profileList = [
    { apiBaseUrl, apiKey, model },
    ...(Array.isArray(fallbackProfiles) ? fallbackProfiles.map((p) => ({
      apiBaseUrl: p.baseUrl || p.apiBaseUrl,
      apiKey: p.apiKey,
      model: p.model || model,
    })) : []),
  ].filter((p) => p.apiBaseUrl && p.apiKey && p.model);

  let lastError = null;

  for (let pIdx = 0; pIdx < profileList.length; pIdx++) {
    const currentProfile = profileList[pIdx];
    const maxRetries = pIdx === 0 ? 2 : 1; // 2 intentos en primario, 1 en respaldo

    if (pIdx > 0) {
      try {
        onFallback?.({
          index: pIdx,
          model: currentProfile.model,
          baseUrl: currentProfile.apiBaseUrl,
        });
      } catch { /* ignore */ }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (signal?.aborted) {
        const abortReason = signal?.reason;
        if (abortReason?.code === "AGENT_STEER") {
          throw Object.assign(new Error("Nueva instruccion del usuario."), { code: "AGENT_STEER" });
        }
        throw (abortReason || new Error("Operacion cancelada"));
      }

      try {
        const result = await callChatSingleAttempt({
          apiBaseUrl: currentProfile.apiBaseUrl,
          apiKey: currentProfile.apiKey,
          model: currentProfile.model,
          messages,
          tools,
          signal,
          toolChoice,
          timeoutMs,
          stream,
          onTextDelta,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (err?.code === "AGENT_STEER" || signal?.aborted) {
          throw err;
        }
        if (isTransientError(err) && attempt < maxRetries - 1) {
          await delay(800 * (attempt + 1), signal).catch(() => {});
          continue;
        }
        break; // pasar al siguiente perfil si este falló
      }
    }
  }

  throw lastError || createGatewayTimeoutError(524, "No se pudo obtener respuesta del proveedor.");
}

module.exports = {
  callChat,
  callChatSingleAttempt,
  normalizeUsage,
  withCacheControl,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
};
