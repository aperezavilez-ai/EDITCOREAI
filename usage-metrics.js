"use strict";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.ceil(number) : 0;
}

function firstUsageValue(usage, names) {
  for (const name of names) {
    const value = finite(usage?.[name]);
    if (value) return value;
  }
  return 0;
}

function providerCacheReadTokens(usage = {}) {
  return firstUsageValue(usage, ["cache_read_input_tokens", "cached_input_tokens", "cached_tokens"])
    || finite(usage?.prompt_tokens_details?.cached_tokens)
    || finite(usage?.input_tokens_details?.cached_tokens)
    || finite(usage?.cache_read?.input_tokens);
}

function normalizeProviderUsage(rawUsage, estimatedInputTokens, outputText, estimateTokens) {
  const usage = rawUsage && typeof rawUsage === "object" ? rawUsage : {};
  const confirmedInput = firstUsageValue(usage, ["confirmed_input_tokens", "prompt_tokens", "input_tokens", "inputTokens", "promptTokenCount"]);
  const confirmedOutput = firstUsageValue(usage, ["confirmed_output_tokens", "completion_tokens", "output_tokens", "outputTokens", "candidatesTokenCount"]);
  const reasoningTokens = firstUsageValue(usage, ["reasoning_tokens", "reasoningTokens"])
    || finite(usage?.completion_tokens_details?.reasoning_tokens)
    || finite(usage?.output_tokens_details?.reasoning_tokens);
  const totalTokens = firstUsageValue(usage, ["total_tokens", "totalTokens", "totalTokenCount"])
    || confirmedInput + confirmedOutput;
  const estimatedInput = confirmedInput ? 0 : finite(estimatedInputTokens);
  const estimatedOutput = confirmedOutput ? 0 : finite(estimateTokens(outputText));
  const costValue = usage.cost_usd ?? usage.total_cost_usd ?? usage.cost;
  const rawCost = costValue === undefined || costValue === null || costValue === "" ? NaN : Number(costValue);
  const costUsd = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
  return {
    ...usage,
    prompt_tokens: confirmedInput,
    completion_tokens: confirmedOutput,
    confirmed_input_tokens: confirmedInput,
    confirmed_output_tokens: confirmedOutput,
    provider_cache_read_tokens: providerCacheReadTokens(usage),
    cached_input_tokens: providerCacheReadTokens(usage),
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    cost_usd: costUsd,
    cost_status: costUsd === null ? "UNKNOWN" : "CONFIRMED",
    estimated_input_tokens: estimatedInput,
    estimated_output_tokens: estimatedOutput,
    telemetry: confirmedInput || confirmedOutput ? "confirmed" : "estimated",
    confirmed: Boolean(confirmedInput || confirmedOutput),
    estimated: !(confirmedInput || confirmedOutput),
    timestamp: usage.timestamp || new Date().toISOString(),
  };
}

function localCacheUsage(entry, fallbackInputTokens, fallbackOutputTokens) {
  const original = entry?.usage || {};
  const confirmedInput = finite(original.confirmed_input_tokens || original.prompt_tokens || original.input_tokens);
  const confirmedOutput = finite(original.confirmed_output_tokens || original.completion_tokens || original.output_tokens);
  const hasConfirmed = original.telemetry === "confirmed" || confirmedInput || confirmedOutput;
  const estimatedInput = finite(entry?.inputTokens || fallbackInputTokens);
  const estimatedOutput = finite(entry?.outputTokens || fallbackOutputTokens);
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    confirmed_input_tokens: 0,
    confirmed_output_tokens: 0,
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    provider_cache_read_tokens: 0,
    local_cache_hit: true,
    local_cache_saved_confirmed_tokens: hasConfirmed ? confirmedInput + confirmedOutput : 0,
    local_cache_saved_estimated_tokens: hasConfirmed ? 0 : estimatedInput + estimatedOutput,
    telemetry: hasConfirmed ? "local-cache-confirmed" : "local-cache-estimated",
  };
}

function aggregateUsage(items = [], extra = {}) {
  const fields = [
    "confirmed_input_tokens", "confirmed_output_tokens", "provider_cache_read_tokens",
    "reasoning_tokens", "total_tokens",
    "estimated_input_tokens", "estimated_output_tokens",
    "local_cache_saved_confirmed_tokens", "local_cache_saved_estimated_tokens",
  ];
  const result = Object.fromEntries(fields.map((field) => [field, 0]));
  result.cost_usd = 0;
  result.costed_requests = 0;
  for (const item of items) {
    for (const field of fields) result[field] += finite(item?.[field]);
    const cost = Number(item?.cost_usd);
    if (Number.isFinite(cost) && cost >= 0) { result.cost_usd += cost; result.costed_requests += 1; }
  }
  result.prompt_tokens = result.confirmed_input_tokens;
  result.completion_tokens = result.confirmed_output_tokens;
  result.local_cache_hits = items.filter((item) => item?.local_cache_hit).length;
  result.cost_status = result.costed_requests === items.length && items.length ? "CONFIRMED" : "UNKNOWN";
  return { ...result, ...extra };
}

module.exports = { aggregateUsage, localCacheUsage, normalizeProviderUsage, providerCacheReadTokens };
