// ai-proxy: las consultas de IA de los usuarios de EditCoreAI pasan por aquí.
// Usa la clave del administrador (secreto del servidor, nunca llega a la app), mide los tokens reales
// de cada respuesta y cobra al usuario el costo del proveedor multiplicado por el margen configurado.
// Rutas (compatibles con OpenAI): GET /ai-proxy/v1/models · POST /ai-proxy/v1/chat/completions

import {
  allowedModelNames,
  indexPricing,
  isModelAllowed,
  normalizeModelName,
  providerCostUsd,
  readUsage,
  restrictToModels,
  sanitizeProviderText,
  scrubProviderFields,
  SseScrubber,
  StreamUsageTracker,
  usageOrEstimate,
} from "./pricing.mjs";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const UPSTREAM_BASE = (Deno.env.get("MEAI_BASE_URL") || "https://api.meai.cloud/v1").replace(/\/+$/, "");
const UPSTREAM_KEY = Deno.env.get("MEAI_API_KEY") || "";
const PRICING_URL = Deno.env.get("MEAI_PRICING_URL") || "https://api.meai.cloud/api/pricing";
const PRICING_GROUP = Deno.env.get("MEAI_GROUP") || "default";
const PRICING_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_PER_USER = 4;

const MESSAGES: Record<string, string> = {
  NO_SESSION: "Inicia sesión en EditCoreAI para usar la IA.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
  OUT_OF_CREDITS: "Tu saldo se agotó. Recarga para seguir usando la IA de EditCoreAI.",
  MODEL_NOT_AVAILABLE: "Ese modelo no está disponible.",
  TOO_MANY_REQUESTS: "Tienes demasiadas consultas al mismo tiempo. Espera a que terminen.",
  NOT_CONFIGURED: "El servicio de IA no está configurado todavía.",
  UPSTREAM: "El servicio de IA no respondió. Intenta de nuevo.",
  BAD_REQUEST: "Solicitud inválida.",
};

let pricingCache: { at: number; value: ReturnType<typeof indexPricing> } | null = null;
const inFlight = new Map<string, number>();

function errorResponse(status: number, code: string, message = MESSAGES[code] || MESSAGES.UPSTREAM) {
  return new Response(JSON.stringify({ error: { code, message, type: "editcoreai_error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function keyModelIds(): Promise<string[]> {
  try {
    const res = await fetch(`${UPSTREAM_BASE}/models`, {
      headers: { Authorization: `Bearer ${UPSTREAM_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data.map((m: { id?: string }) => String(m?.id || "")) : [];
  } catch {
    return [];
  }
}

// Cloudflare reemplaza las respuestas 502 por su propia página: los fallos del proveedor salen como 503.
function upstreamStatus(status: number) {
  return status >= 500 || [401, 402, 403].includes(status) ? 503 : status;
}

async function loadPricing() {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.value;
  try {
    const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(String(res.status));
    const value = restrictToModels(indexPricing(await res.json(), PRICING_GROUP), await keyModelIds());
    if (!value.models.size) throw new Error("sin modelos");
    pricingCache = { at: Date.now(), value };
  } catch (error) {
    if (!pricingCache) throw error;
  }
  return pricingCache.value;
}

async function userIdFromToken(token: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return typeof user?.id === "string" ? user.id : null;
}

async function serviceRpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn}: ${res.status}`);
  return await res.json();
}

function acquire(uid: string) {
  const current = inFlight.get(uid) || 0;
  if (current >= MAX_CONCURRENT_PER_USER) return false;
  inFlight.set(uid, current + 1);
  return true;
}

function release(uid: string) {
  const next = (inFlight.get(uid) || 1) - 1;
  if (next <= 0) inFlight.delete(uid);
  else inFlight.set(uid, next);
}

function keepAlive(promise: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
}

async function chargeUsage(uid: string, model: string, price: unknown, groupRatio: number, usage: Record<string, unknown>) {
  const u = readUsage(usage);
  const cost = providerCostUsd(price as never, usage, groupRatio);
  try {
    await serviceRpc("editcoreai_proxy_charge", {
      p_user: uid,
      p_model: model,
      p_tokens_in: u.promptTokens,
      p_tokens_out: u.completionTokens,
      p_cached_tokens: u.cachedTokens,
      p_provider_cost: cost,
    });
  } catch (error) {
    console.error("cobro fallido", model, cost, String(error));
  }
}

async function handleModels(account: Record<string, unknown>) {
  const pricing = await loadPricing();
  const names = allowedModelNames(pricing, account.allowed_models as string[] | null);
  return new Response(JSON.stringify({
    object: "list",
    data: names.map((id) => ({ id, object: "model", owned_by: "editcoreai" })),
  }), { headers: { "content-type": "application/json" } });
}

async function handleChat(req: Request, uid: string, account: Record<string, unknown>) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST");
  }
  const model = normalizeModelName(body.model);
  const pricing = await loadPricing();
  const price = pricing.models.get(model);
  if (!price || !isModelAllowed(pricing, account.allowed_models as string[] | null, model)) {
    return errorResponse(400, "MODEL_NOT_AVAILABLE");
  }

  if (!acquire(uid)) return errorResponse(429, "TOO_MANY_REQUESTS");
  const wantStream = body.stream === true;
  const upstreamBody = {
    ...body,
    model,
    ...(wantStream ? { stream_options: { include_usage: true } } : {}),
  };
  const promptText = JSON.stringify(body.messages || "");

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${UPSTREAM_KEY}` },
      body: JSON.stringify(upstreamBody),
      signal: req.signal,
    });
  } catch {
    release(uid);
    return errorResponse(503, "UPSTREAM");
  }

  if (!upstream.ok) {
    release(uid);
    const raw = await upstream.text().catch(() => "");
    let detail = "";
    try { detail = String(JSON.parse(raw)?.error?.message || ""); } catch { detail = raw; }
    if (/no access to model|model_not_found|model not found/i.test(detail)) return errorResponse(400, "MODEL_NOT_AVAILABLE");
    // 401/402/403 del proveedor son problemas de la cuenta del administrador, no del usuario.
    return errorResponse(upstreamStatus(upstream.status), "UPSTREAM", detail ? sanitizeProviderText(detail) : MESSAGES.UPSTREAM);
  }

  if (!wantStream) {
    const data = await upstream.json().catch(() => null);
    const outputChars = JSON.stringify(data?.choices || "").length;
    await chargeUsage(uid, model, price, pricing.groupRatio, usageOrEstimate(data?.usage, promptText, outputChars));
    release(uid);
    return new Response(JSON.stringify(scrubProviderFields(data, model)), { headers: { "content-type": "application/json" } });
  }

  const tracker = new StreamUsageTracker();
  const scrubber = new SseScrubber(model);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    tracker.finish();
    await chargeUsage(uid, model, price, pricing.groupRatio, usageOrEstimate(tracker.usage, promptText, tracker.outputChars));
    release(uid);
  };
  const passthrough = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      tracker.push(text);
      const clean = scrubber.push(text);
      if (clean) controller.enqueue(encoder.encode(clean));
    },
    flush(controller) {
      const rest = scrubber.finish();
      if (rest) controller.enqueue(encoder.encode(rest));
    },
  });
  keepAlive(upstream.body!.pipeTo(passthrough.writable).catch(() => {}).finally(settle));
  return new Response(passthrough.readable, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const isModels = req.method === "GET" && path.endsWith("/v1/models");
  const isChat = req.method === "POST" && path.endsWith("/v1/chat/completions");
  if (!isModels && !isChat) return errorResponse(404, "BAD_REQUEST", "Ruta no encontrada.");
  if (!UPSTREAM_KEY || !SERVICE_KEY || !SUPABASE_URL) return errorResponse(503, "NOT_CONFIGURED");

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const uid = token ? await userIdFromToken(token) : null;
  if (!uid) return errorResponse(401, "NO_SESSION");

  let account: Record<string, unknown>;
  try {
    account = await serviceRpc("editcoreai_proxy_account", { p_user: uid });
  } catch {
    return errorResponse(503, "UPSTREAM", "El servidor de cuentas no respondió.");
  }
  if (account.status !== "active") return errorResponse(403, "ACCOUNT_SUSPENDED");
  const unlimited = account.is_unlimited === true || account.role === "admin";
  if (isChat && !unlimited && !(Number(account.credits_balance) > 0)) return errorResponse(402, "OUT_OF_CREDITS");

  try {
    return isModels ? await handleModels(account) : await handleChat(req, uid, account);
  } catch (error) {
    console.error("ai-proxy", String(error));
    return errorResponse(502, "UPSTREAM");
  }
});
