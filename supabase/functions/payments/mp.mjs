// Lógica de Mercado Pago sin red: la usan la función payments (Deno) y los tests (Node).

export const MP_API = "https://api.mercadopago.com";

/** Cuerpo de la preferencia de Checkout Pro para una recarga. */
export function buildPreference({ paymentId, email, amount, currency, creditUsd, publicUrl }) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  const back = `${base}/functions/v1/payments/return`;
  return {
    items: [{
      id: "recarga",
      title: `Recarga EditCoreAI: $${Number(creditUsd).toFixed(2)} USD de saldo`,
      quantity: 1,
      unit_price: Number(amount),
      currency_id: String(currency || "MXN").toUpperCase(),
    }],
    payer: email ? { email } : undefined,
    external_reference: paymentId,
    notification_url: `${base}/functions/v1/payments/webhook`,
    back_urls: { success: back, failure: back, pending: back },
    auto_return: "approved",
    statement_descriptor: "EDITCOREAI",
    metadata: { editcoreai_payment_id: paymentId },
  };
}

/**
 * Id del pago avisado por Mercado Pago. Acepta webhooks (?type=payment&data.id=… o cuerpo
 * {type, data:{id}}) e IPN antiguos (?topic=payment&id=…). Otros avisos devuelven "".
 */
export function webhookPaymentId(url, body) {
  const q = new URL(url).searchParams;
  const kind = String(body?.type || q.get("type") || q.get("topic") || "").toLowerCase();
  if (kind && kind !== "payment") return "";
  const id = String(body?.data?.id ?? q.get("data.id") ?? q.get("id") ?? "").trim();
  return /^\d{1,30}$/.test(id) ? id : "";
}

async function hmacHex(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Firma x-signature de Mercado Pago (ts=…,v1=…) sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
export async function verifySignature({ secret, signature, requestId, dataId }) {
  if (!secret) return true;
  const parts = Object.fromEntries(String(signature || "").split(",").map((p) => p.trim().split("=", 2)));
  if (!parts.ts || !parts.v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = await hmacHex(secret, manifest);
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/** Solo se abren enlaces de pago de Mercado Pago por https. */
export function isMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && /(^|\.)mercadopago\.com(\.[a-z]{2})?$|(^|\.)mercadolibre\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}
