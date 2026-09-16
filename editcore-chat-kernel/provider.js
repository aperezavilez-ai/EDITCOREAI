"use strict";

const {
  readOpenAiStream,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  isGatewayHtmlBody,
  createGatewayTimeoutError,
  parseProviderJsonOrThrow,
} = require("../runtime/ai-core");

function mergeAbortSignals(primary, secondary) {
  if (primary && secondary && typeof AbortSignal.any === "function") {
    return AbortSignal.any([primary, secondary]);
  }
  return primary || secondary || undefined;
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
}) {
  const url = `${String(apiBaseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const wantStream = stream !== false;
  const body = {
    model,
    messages,
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
        usage: streamed?.usage || null,
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
      usage: data.usage || null,
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

module.exports = {
  callChat,
  GATEWAY_TIMEOUT_USER_MESSAGE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
};
