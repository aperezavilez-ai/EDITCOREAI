"use strict";

const {
  readOpenAiStream,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  isGatewayHtmlBody,
  createGatewayTimeoutError,
  parseProviderJsonOrThrow,
  withCacheControl,
  createIdleTimeout,
} = require("../runtime/ai-core");

const PROVIDER_MAX_TOTAL_MS = 10 * 60_000;
const { logProviderError } = require("../runtime/provider-error-log");
const { modelSupportsVision } = require("../runtime/vision-intake");

function messagesHaveImages(messages) {
  return (Array.isArray(messages) ? messages : []).some((m) =>
    Array.isArray(m?.content) && m.content.some((part) => part?.type === "image_url" || part?.type === "image"));
}

function normalizeUsage(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  return {
    input_tokens: Number(raw.input_tokens || raw.prompt_tokens || 0),
    output_tokens: Number(raw.output_tokens || raw.completion_tokens || 0),
    cache_read_input_tokens: Number(raw.cache_read_input_tokens || raw.prompt_tokens_details?.cached_tokens || raw.cached_tokens || 0),
    cache_creation_input_tokens: Number(raw.cache_creation_input_tokens || raw.cache_write_input_tokens || raw.cache_creation?.input_tokens || 0),
    cache_write_input_tokens: Number(raw.cache_write_input_tokens || raw.cache_creation_input_tokens || raw.cache_creation?.input_tokens || 0),
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

// Una clave rechazada (401) no se recupera sola: sus perfiles pasan al final
// de la cola un rato para no gastar el primer intento de cada turno en ella.
const REJECTED_KEY_TTL_MS = 10 * 60_000;
const rejectedKeys = new Map();

function isRejectedKeyError(error) {
  return Number(error?.status || 0) === 401;
}

function keyRejected(apiKey, now = Date.now()) {
  const until = rejectedKeys.get(apiKey);
  if (!until) return false;
  if (until > now) return true;
  rejectedKeys.delete(apiKey);
  return false;
}

function orderProfiles(list, now = Date.now(), { vision = false } = {}) {
  const seen = new Set();
  const unique = list.filter((p) => {
    const id = `${p.apiBaseUrl}|${p.model}|${p.apiKey}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const rank = (p) => (keyRejected(p.apiKey, now) ? 2 : 0) + (vision && !modelSupportsVision(p.model) ? 1 : 0);
  return unique
    .map((p, index) => ({ p, index, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map((row) => row.p);
}

function providerLabel(host) {
  if (/meai/i.test(host)) return "ME AI";
  if (/apicredits/i.test(host)) return "APICredits";
  return "Otro proveedor";
}

function allProvidersFailedError(failures, lastError) {
  const byProvider = new Map();
  for (const f of failures) {
    const label = providerLabel(f.host);
    const prev = byProvider.get(label) || new Set();
    prev.add(f.status);
    byProvider.set(label, prev);
  }
  const parts = [...byProvider].map(([label, statuses]) => {
    if (statuses.has(401) || statuses.has(403)) return `${label}: clave rechazada, renuévala en Modelos`;
    if (statuses.has(402)) return `${label}: sin saldo`;
    return `${label}: no disponible ahora, reintenta en unos minutos`;
  });
  return Object.assign(new Error(`Ningún modelo respondió. ${parts.join(". ")}.`), {
    status: Number(lastError?.status || 0) || undefined,
    code: "ALL_PROVIDERS_FAILED",
  });
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
  require("../runtime/platform-defaults").assertProviderAllowed(apiBaseUrl);
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

  // Plazo por inactividad (no total): una respuesta larga que sigue llegando no se corta.
  const idle = createIdleTimeout(Number(timeoutMs) || 0, Number(timeoutMs) > 0 ? Math.max(Number(timeoutMs), PROVIDER_MAX_TOTAL_MS) : 0);
  const requestSignal = mergeAbortSignals(signal, idle.signal);
  try {
    return await sendChatRequest({ url, body, apiKey, wantStream, signal, requestSignal, onTextDelta, onActivity: idle.touch });
  } finally {
    idle.clear();
  }
}

async function sendChatRequest({ url, body, apiKey, wantStream, signal, requestSignal, onTextDelta, onActivity }) {
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
      const streamed = await readOpenAiStream(res, onTextDelta, requestSignal, onActivity);
      const msg = {
        content: streamed?.text || "",
        tool_calls: streamed?.toolCalls || [],
      };
      if (!String(msg.content).trim() && !msg.tool_calls.length) {
        throw Object.assign(new Error("El proveedor cortó la respuesta sin enviar contenido."), { code: "EMPTY_PROVIDER_RESPONSE", status: 502 });
      }
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
  const profileList = orderProfiles([
    { apiBaseUrl, apiKey, model },
    ...(Array.isArray(fallbackProfiles) ? fallbackProfiles.map((p) => ({
      apiBaseUrl: p.baseUrl || p.apiBaseUrl,
      apiKey: p.apiKey,
      model: p.model || model,
    })) : []),
  ].filter((p) => p.apiBaseUrl && p.apiKey && p.model), Date.now(), { vision: messagesHaveImages(messages) });

  let lastError = null;
  const failures = [];

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

      let streamedAny = false;
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
          onTextDelta: onTextDelta ? (d) => { if (d) streamedAny = true; return onTextDelta(d); } : null,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (err?.code === "AGENT_STEER" || signal?.aborted) {
          throw err;
        }
        // Lo ya mostrado no se repite con otro intento ni con otro perfil.
        if (streamedAny) throw err;
        let host = "";
        try { host = new URL(currentProfile.apiBaseUrl).host; } catch { /* sin host */ }
        logProviderError({
          model: currentProfile.model,
          host,
          profile: pIdx,
          attempt,
          status: Number(err?.status || 0) || null,
          code: err?.code || null,
          message: String(err?.providerRaw || err?.message || err).slice(0, 500),
        });
        const retry = !isRejectedKeyError(err) && isTransientError(err) && attempt < maxRetries - 1;
        if (!retry) failures.push({ host, status: Number(err?.status || 0) });
        if (isRejectedKeyError(err)) {
          rejectedKeys.set(currentProfile.apiKey, Date.now() + REJECTED_KEY_TTL_MS);
          break;
        }
        if (retry) {
          await delay(800 * (attempt + 1), signal).catch(() => {});
          continue;
        }
        break; // pasar al siguiente perfil si este falló
      }
    }
  }

  if (profileList.length > 1 && failures.length) throw allProvidersFailedError(failures, lastError);
  throw lastError || createGatewayTimeoutError(524, "No se pudo obtener respuesta del proveedor.");
}

module.exports = {
  callChat,
  callChatSingleAttempt,
  orderProfiles,
  rejectedKeys,
  normalizeUsage,
  withCacheControl,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
};
