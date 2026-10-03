// Recargas de saldo con Mercado Pago (Checkout Pro).
//   GET  /payments/offer     → precio de la recarga y si los pagos están activos (con sesión)
//   POST /payments/checkout  → crea el pago pendiente y devuelve el enlace de Mercado Pago (con sesión)
//   POST /payments/webhook   → aviso de Mercado Pago; se confirma consultando su API y se acredita una vez
//   GET  /payments/return    → página a la que vuelve el usuario después de pagar
// El token de Mercado Pago vive solo aquí (secreto MP_ACCESS_TOKEN); la app nunca lo recibe.

import { buildPreference, isMercadoPagoCheckoutUrl, MP_API, verifySignature, webhookPaymentId } from "./mp.mjs";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const PUBLIC_URL = (Deno.env.get("PUBLIC_URL") || "").replace(/\/+$/, "");
const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") || "";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET") || "";

const MESSAGES: Record<string, string> = {
  NO_SESSION: "Inicia sesión en EditCoreAI para recargar.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
  NOT_CONFIGURED: "Los pagos en línea todavía no están activos. Pide tu recarga al administrador.",
  TOO_MANY_ATTEMPTS: "Demasiados intentos de pago. Espera un rato.",
  UPSTREAM: "Mercado Pago no respondió. Intenta de nuevo en unos minutos.",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, code: string) => json(status, { ok: false, error: { code, message: MESSAGES[code] || MESSAGES.UPSTREAM } });

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
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn}: ${res.status}`);
  return await res.json();
}

async function requireUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return token ? await userIdFromToken(token) : null;
}

async function handleOffer(req: Request) {
  if (!(await requireUser(req))) return fail(401, "NO_SESSION");
  const offer = await serviceRpc("editcoreai_payment_offer", {});
  const auto = Boolean(MP_TOKEN && PUBLIC_URL);
  const link = isMercadoPagoCheckoutUrl(offer?.payment_link) ? offer.payment_link : "";
  // auto: link único por compra y saldo automático · link: link fijo, el admin carga el saldo · manual: código.
  const mode = auto ? "auto" : link ? "link" : "manual";
  return json(200, { ok: true, enabled: auto, mode, ...offer, payment_link: link });
}

async function handleCheckout(req: Request) {
  const uid = await requireUser(req);
  if (!uid) return fail(401, "NO_SESSION");
  if (!MP_TOKEN || !PUBLIC_URL) return fail(503, "NOT_CONFIGURED");
  const created = await serviceRpc("editcoreai_payment_create", { p_user: uid });
  if (!created?.ok) return fail(created?.error === "ACCOUNT_SUSPENDED" ? 403 : 429, created?.error || "UPSTREAM");

  const preference = buildPreference({
    paymentId: created.id,
    email: created.email,
    amount: created.amount,
    currency: created.currency,
    creditUsd: created.credit_usd,
    publicUrl: PUBLIC_URL,
  });
  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MP_TOKEN}`, "content-type": "application/json", "X-Idempotency-Key": created.id },
    body: JSON.stringify(preference),
  }).catch(() => null);
  const pref = res && res.ok ? await res.json().catch(() => null) : null;
  if (!pref?.id || !isMercadoPagoCheckoutUrl(pref.init_point)) {
    console.error("preferencia fallida", res?.status);
    return fail(503, "UPSTREAM");
  }
  await serviceRpc("editcoreai_payment_set_preference", { p_id: created.id, p_preference: String(pref.id) });
  return json(200, {
    ok: true,
    url: pref.init_point,
    amount: created.amount,
    currency: created.currency,
    creditUsd: created.credit_usd,
  });
}

async function handleWebhook(req: Request) {
  const body = await req.json().catch(() => null);
  const paymentId = webhookPaymentId(req.url, body);
  if (!paymentId) return json(200, { ok: true, ignored: true });
  const signed = await verifySignature({
    secret: MP_WEBHOOK_SECRET,
    signature: req.headers.get("x-signature"),
    requestId: req.headers.get("x-request-id"),
    dataId: new URL(req.url).searchParams.get("data.id") || paymentId,
  });
  if (!signed) return json(401, { ok: false });
  if (!MP_TOKEN) return json(503, { ok: false });

  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } }).catch(() => null);
  if (!res) return json(502, { ok: false });
  if (res.status === 404) return json(200, { ok: true, ignored: true });
  if (!res.ok) return json(502, { ok: false });
  const payment = await res.json().catch(() => null);
  const reference = String(payment?.external_reference || "");
  if (!/^[0-9a-f-]{36}$/i.test(reference)) return json(200, { ok: true, ignored: true });

  const result = await serviceRpc("editcoreai_payment_settle", {
    p_id: reference,
    p_mp_payment_id: String(payment.id),
    p_status: String(payment.status || ""),
    p_amount: Number(payment.transaction_amount || 0),
    p_currency: String(payment.currency_id || ""),
  });
  if (!result?.ok) console.error("pago no acreditado", paymentId, result?.error);
  return json(200, { ok: true });
}

function returnPage(url: string) {
  const status = new URL(url).searchParams.get("status") || new URL(url).searchParams.get("collection_status") || "";
  const ok = status === "approved";
  const title = ok ? "¡Pago recibido!" : status === "pending" || status === "in_process" ? "Pago en proceso" : "El pago no se completó";
  const text = ok
    ? "Tu saldo se acredita en unos segundos. Vuelve a EditCoreAI."
    : status === "pending" || status === "in_process"
      ? "Mercado Pago está confirmando tu pago. Cuando se apruebe, el saldo aparece solo en EditCoreAI."
      : "No se cobró nada. Puedes cerrar esta pestaña e intentarlo otra vez desde EditCoreAI.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EditCoreAI</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8ea;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px}p{opacity:.8;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (path.endsWith("/payments/offer") && req.method === "GET") return await handleOffer(req);
    if (path.endsWith("/payments/checkout") && req.method === "POST") return await handleCheckout(req);
    if (path.endsWith("/payments/webhook") && req.method === "POST") return await handleWebhook(req);
    if (path.endsWith("/payments/return") && req.method === "GET") return returnPage(req.url);
    return json(404, { ok: false });
  } catch (error) {
    console.error("payments", String(error));
    return path.endsWith("/payments/webhook") ? json(500, { ok: false }) : fail(503, "UPSTREAM");
  }
});
