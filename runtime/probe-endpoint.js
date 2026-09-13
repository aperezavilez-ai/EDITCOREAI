"use strict";

/**
 * Sondeo HTTP de endpoints locales / gateway para diagnosticar puentes AI.
 */

const ALLOWED_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "gafcore-gateway.vercel.app",
]);

function assertProbeUrl(rawUrl = "") {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("probe_endpoint requiere una URL válida (ej. http://127.0.0.1:3000/api/health).");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Solo se permiten http/https.");
  }
  const host = String(parsed.hostname || "").toLowerCase();
  const allowed = ALLOWED_HOSTS.has(host)
    || /^127\.\d+\.\d+\.\d+$/.test(host)
    || host.endsWith(".localhost");
  if (!allowed) {
    throw new Error(
      `Host no permitido para probe: ${host}. Usa loopback (127.0.0.1/localhost) o gafcore-gateway.vercel.app.`,
    );
  }
  return parsed;
}

async function probeEndpoint(input = {}) {
  const parsed = assertProbeUrl(input.url || input.endpoint || "");
  const method = String(input.method || "GET").toUpperCase();
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(input.timeoutMs) || 8_000));
  const headers = input.headers && typeof input.headers === "object" ? { ...input.headers } : {};
  // Nunca devolver secretos: strip Authorization values in response echo.
  const started = Date.now();
  let status = 0;
  let ok = false;
  let bodyPreview = "";
  let error = "";
  let contentType = "";
  try {
    const response = await fetch(parsed.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : (input.body == null ? undefined : String(input.body)),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    status = response.status;
    ok = response.status >= 200 && response.status < 400;
    contentType = String(response.headers.get("content-type") || "");
    const text = await response.text().catch(() => "");
    bodyPreview = String(text || "").slice(0, Number(input.maxBodyChars) || 800);
  } catch (err) {
    error = String(err?.message || err).slice(0, 300);
    ok = false;
  }
  return {
    ok,
    tool: "probe_endpoint",
    url: parsed.toString(),
    method,
    status,
    contentType,
    durationMs: Date.now() - started,
    bodyPreview,
    error: error || undefined,
    healthy: ok,
    hint: ok
      ? "Endpoint respondió en rango 2xx/3xx."
      : "Fallo de red o status no saludable. Revisa que el servicio esté levantado y el puerto.",
  };
}

async function testLocalApi(input = {}) {
  const port = Number(input.port);
  const pathName = String(input.path || "/").startsWith("/")
    ? String(input.path || "/")
    : `/${String(input.path || "")}`;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("test_local_api requiere port (1-65535).");
  }
  const host = String(input.host || "127.0.0.1").trim() || "127.0.0.1";
  return probeEndpoint({
    url: `http://${host}:${port}${pathName}`,
    method: input.method || "GET",
    timeoutMs: input.timeoutMs,
    headers: input.headers,
    maxBodyChars: input.maxBodyChars,
  });
}

module.exports = {
  ALLOWED_HOSTS,
  assertProbeUrl,
  probeEndpoint,
  testLocalApi,
};
