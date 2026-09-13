"use strict";

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.text || part?.content || "").join("");
}

function payloadText(payload = {}) {
  return contentText(payload?.choices?.[0]?.delta?.content)
    || contentText(payload?.choices?.[0]?.message?.content)
    || contentText(payload?.choices?.[0]?.text)
    || contentText(payload?.delta?.text)
    || contentText(payload?.content)
    || contentText(payload?.message?.content)
    || contentText(payload?.candidates?.[0]?.content?.parts)
    || contentText(payload?.output_text)
    || contentText(payload?.text);
}

function payloadUsage(payload = {}) {
  return payload?.usage || payload?.usageMetadata || null;
}

function incrementalText(accumulated, candidate) {
  const next = String(candidate || "");
  if (!next) return "";
  if (next.startsWith(accumulated)) return next.slice(accumulated.length);
  if (accumulated.endsWith(next)) return "";
  return next;
}

async function consumeProviderResponse(response, { signal, onDelta = () => undefined } = {}) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    const text = payloadText(data);
    if (text && !/<[a-z_]|\btool_calls?\b|["']type["']\s*:\s*["']tool["']/i.test(text)) onDelta(text);
    return { text, usage: payloadUsage(data) };
  }
  if (!response.body) return { text: "", usage: null };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let usage = null;
  let protocolDetected = false;
  const consumeLine = (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    const raw = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!raw || raw === "[DONE]") return;
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    usage = payloadUsage(payload) || usage;
    const delta = incrementalText(text, payloadText(payload));
    if (!delta) return;
    text += delta;
    protocolDetected = protocolDetected || /<[a-z_]|\btool_calls?\b|["']type["']\s*:\s*["']tool["']/i.test(text);
    if (!protocolDetected) onDelta(delta);
  };

  while (true) {
    if (signal?.aborted) throw signal.reason || new Error("Respuesta cancelada.");
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = done ? "" : (lines.pop() || "");
    lines.forEach(consumeLine);
    if (done) break;
  }
  if (pending.trim()) consumeLine(pending);
  return { text, usage };
}

module.exports = { consumeProviderResponse, contentText, payloadText, payloadUsage };
