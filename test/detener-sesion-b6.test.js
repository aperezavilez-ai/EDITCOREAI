"use strict";

// [EDITCORE-INTEGRAL-B6] Bloque 6 — «Detener detiene todo, y la sesión
// no muere a mitad de turno». Pruebas de COMPORTAMIENTO con fakes y
// costuras inyectadas (patrón de test/publicacion-verificada.test.js):
// sin red ni CLI reales. Cubren: (1) acción externa abortada antes de
// lanzar ⇒ no publica; request ya salido ⇒ cancelación tardía
// declarada; (2) NO_SESSION ⇒ re-pide token una vez y reintenta el
// paso con el token fresco; NO_SESSION persistente ⇒ error de sesión,
// nunca «API key»; (3) sanitize 401 NO_SESSION ≠ 401 de key;
// (4) tool_call truncado ⇒ la herramienta NO corre; respuesta cortada
// ⇒ partial declarado; fallo tras contenido ⇒ sin reenvío completo;
// (5) verifier/fotos observan la señal; (6) memoria semántica colgada
// ⇒ el turno arranca tras el timeout; (7) 429 con Retry-After ⇒ el
// provider espera la cabecera y la clasificación es la compartida.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b6-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo", scripts: { typecheck: "tsc --noEmit", build: "node build.js" } }));
fs.writeFileSync(path.join(projectRoot, "src", "App.tsx"), "export const App = () => null;\n");

const extraTools = require("../editcore-chat-kernel/extra-tools");
const { deployOneClick } = require("../runtime/deploy-one-click");
const { classifyHttpError, parseRetryAfterMs, SESSION_EXPIRED_MESSAGE } = require("../runtime/http-error-taxonomy");
const { sanitizeChatProviderError } = require("../runtime/chat-error-sanitize");
const { isBillingOrQuotaError } = require("../runtime/model-failover");
const { parseProviderJsonOrThrow, readOpenAiStream } = require("../runtime/ai-core");
const provider = require("../editcore-chat-kernel/provider");
const { ChatOrchestrator, raceSemanticBlock } = require("../editcore-chat-kernel/orchestrator");
const verifier = require("../editcore-chat-kernel/subagents/verifier");
const kernelTools = require("../editcore-chat-kernel/tools");
const { fetchStockPhoto } = require("../editcore-chat-kernel/stock-photos");
const globalMemory = require("../editcore-chat-kernel/global-memory");

function noSessionError() {
  return Object.assign(new Error("Inicia sesión en EditCoreAI para usar la IA."), { status: 401, code: "NO_SESSION", providerCode: "NO_SESSION" });
}

// ---------- (1) Acción externa y señal ----------

test("B6-1a: acción externa abortada ANTES de lanzar ⇒ la implementación nunca corre", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let implCalls = 0;
  const out = await extraTools.runExternalAction("deploy_one_click", {}, projectRoot, {
    externalActionApproved: true,
    abortSignal: ctrl.signal,
    _externalImpls: { deployOneClick: async () => { implCalls += 1; return { ok: true, url: "https://x.vercel.app" }; } },
  });
  assert.equal(implCalls, 0, "abortada antes de lanzar: no publica");
  assert.equal(out.ok, false);
  assert.equal(out.aborted, true);
  assert.equal(out.cancelledBeforeLaunch, true);
});

test("B6-1b: request ya salido ⇒ el resultado DECLARA la cancelación tardía", async () => {
  const ctrl = new AbortController();
  const out = await extraTools.runExternalAction("deploy_one_click", {}, projectRoot, {
    externalActionApproved: true,
    abortSignal: ctrl.signal,
    _externalImpls: {
      deployOneClick: async () => {
        ctrl.abort(); // Detener llega con el despliegue ya en curso
        return { ok: true, url: "https://demo.vercel.app", message: "Deploy OK" };
      },
    },
  });
  assert.equal(out.cancellationLate, true);
  assert.match(out.message, /cancelación llegó tarde/);
  assert.match(out.message, /demo\.vercel\.app.*sí salió/);
});

test("B6-1c: deployOneClick con señal abortada no lanza el proceso; con aborto en curso declara la tardía y pasa la señal al proceso", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b6-deploy-"));
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_t", orgId: "team_t" }));
  fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");

  const ctrlPre = new AbortController();
  ctrlPre.abort();
  let runs = 0;
  const pre = await deployOneClick(root, { provider: "vercel" }, {
    connections: { vercelToken: "tok" },
    signal: ctrlPre.signal,
    deps: { runProcessImpl: async () => { runs += 1; return { code: 0, stdout: "", stderr: "" }; } },
  });
  assert.equal(runs, 0);
  assert.equal(pre.cancelledBeforeLaunch, true);

  const ctrlMid = new AbortController();
  let seenSignal = null;
  const mid = await deployOneClick(root, { provider: "vercel" }, {
    connections: { vercelToken: "tok" },
    signal: ctrlMid.signal,
    deps: {
      runProcessImpl: async (_cmd, _args, opts) => {
        seenSignal = opts?.signal || null;
        ctrlMid.abort();
        return { code: 0, stdout: "Production: https://demo-app.vercel.app\n", stderr: "" };
      },
      fetchImpl: async () => ({ status: 200 }),
      sleepImpl: async () => {},
    },
  });
  assert.equal(seenSignal, ctrlMid.signal, "la señal llega a las opciones del proceso de deploy");
  assert.equal(mid.cancellationLate, true);
  assert.match(mid.message, /sí salió/);
});

// ---------- (2) Sesión viva en el orquestador ----------

test("B6-2a: paso con NO_SESSION ⇒ se re-pide token UNA vez y el paso se reintenta con el token fresco", async () => {
  const seenKeys = [];
  let refreshCalls = 0;
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "hola, ¿me ayudas con una duda rápida?",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "token-viejo",
    model: "m",
    helpers: {
      refreshAccessToken: async () => { refreshCalls += 1; return "token-fresco"; },
      callChat: async (opts) => {
        seenKeys.push(opts.apiKey);
        if (seenKeys.length === 1) throw noSessionError();
        return { text: "Respuesta tras renovar la sesión.", toolCalls: [], usage: {} };
      },
    },
  });
  assert.equal(refreshCalls, 1, "un solo refresco");
  assert.deepEqual(seenKeys, ["token-viejo", "token-fresco"], "el reintento viaja con el token fresco");
  assert.match(out.text, /Respuesta tras renovar la sesión/);
});

test("B6-2b: NO_SESSION persistente ⇒ error de SESIÓN expirada, nunca consejo de API key", async () => {
  let refreshCalls = 0;
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "hola, ¿me ayudas con una duda rápida?",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "token-viejo",
    model: "m",
    helpers: {
      refreshAccessToken: async () => { refreshCalls += 1; return "token-fresco"; },
      callChat: async () => { throw noSessionError(); },
    },
  });
  assert.equal(refreshCalls, 1);
  assert.equal(out.kind, "ERROR");
  assert.match(out.text, /sesión expiró/);
  assert.doesNotMatch(out.text, /API key/);
});

// ---------- (3) sanitize: sesión ≠ key ----------

test("B6-3a: sanitize distingue 401 NO_SESSION de 401 de API key", () => {
  const sessionMsg = sanitizeChatProviderError(noSessionError());
  assert.equal(sessionMsg, SESSION_EXPIRED_MESSAGE);
  assert.match(sessionMsg, /vuelve a iniciar sesión/);
  assert.doesNotMatch(sessionMsg, /API key/);
  const keyMsg = sanitizeChatProviderError("401 invalid token", { status: 401 });
  assert.match(keyMsg, /API key en Modelos/);
  assert.notEqual(sessionMsg, keyMsg);
});

test("B6-3b: el cuerpo del proxy conserva su código NO_SESSION al parsearse (ai-core)", async () => {
  const body = JSON.stringify({ error: { code: "NO_SESSION", message: "Inicia sesión en EditCoreAI para usar la IA." } });
  const res = {
    status: 401, ok: false,
    headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => body,
  };
  await assert.rejects(() => parseProviderJsonOrThrow(res), (err) => {
    assert.equal(err.code, "NO_SESSION");
    assert.equal(err.providerCode, "NO_SESSION");
    assert.match(err.message, /sesión expiró/);
    assert.doesNotMatch(err.message, /API key/);
    return true;
  });
});

// ---------- (4) Parcial nunca completo / truncados / streamedAny ----------

test("B6-4a: tool_call con argumentos truncados ⇒ la herramienta NO se ejecuta y el paso queda marcado", async () => {
  let calls = 0;
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "Revisa el archivo principal y corrige lo que esté mal",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    helpers: {
      callChat: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"src/App.tsx\"" } }],
            usage: {},
          };
        }
        return { text: "La llamada llegó truncada; no ejecuté nada.", toolCalls: [], usage: {} };
      },
    },
  });
  const truncated = out.steps.find((s) => s.toolCallTruncated === true);
  assert.ok(truncated, "el paso truncado queda registrado como tal");
  assert.equal(truncated.ok, false);
  assert.match(truncated.result.error, /tool_call truncado/);
  assert.ok(!out.steps.some((s) => s.name === "read_file" && s.ok === true), "read_file nunca se ejecutó con {}");
});

test("B6-4b: respuesta cortada (partial) ⇒ el cierre lo declara y el resultado va marcado", async () => {
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "hola, ¿me ayudas con una duda rápida?",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      callChat: async () => ({ text: "Respuesta cortada a mitad de fra", toolCalls: [], usage: {}, partial: true }),
    },
  });
  assert.equal(out.partial, true);
  assert.match(out.text, /Respuesta parcial/);
});

test("B6-4c: el lector SSE marca partial ante EOF sin [DONE] y ante marco de error del proxy", async () => {
  const enc = new TextEncoder();
  const mkRes = (chunks) => ({
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true }),
          cancel: async () => {},
        };
      },
    },
  });
  const cut = await readOpenAiStream(mkRes(['data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n']), null, null, null);
  assert.equal(cut.text, "Hola");
  assert.equal(cut.partial, true, "EOF sin [DONE] con contenido = parcial");
  const framed = await readOpenAiStream(mkRes([
    'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
    'data: {"error":{"code":"UPSTREAM_STREAM_CUT","message":"corte","partial":true}}\n\n',
    "data: [DONE]\n\n",
  ]), null, null, null);
  assert.equal(framed.partial, true);
  assert.equal(framed.streamError.code, "UPSTREAM_STREAM_CUT");
  const clean = await readOpenAiStream(mkRes([
    'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
    "data: [DONE]\n\n",
  ]), null, null, null);
  assert.equal(clean.partial, false);
});

test("B6-4d: fallo TRAS emitir contenido ⇒ el provider NO reenvía el prompt (sin callback del kernel); sin contenido sí reintenta", async () => {
  const enc = new TextEncoder();
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  const sseRes = (reader) => ({
    ok: true, status: 200,
    headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "text/event-stream" : null) },
    body: { getReader: () => reader },
  });
  try {
    global.fetch = async () => {
      fetchCalls += 1;
      let reads = 0;
      return sseRes({
        read: async () => {
          reads += 1;
          if (reads === 1) return { value: enc.encode('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n'), done: false };
          throw new Error("socket hang up");
        },
        cancel: async () => {},
      });
    };
    await assert.rejects(() => provider.callChat({
      apiBaseUrl: "https://api.example.test/v1", apiKey: "k", model: "m",
      messages: [{ role: "user", content: "hola" }], stream: true,
      // SIN onTextDelta: la ruta del kernel no lo pasa a propósito.
    }));
    assert.equal(fetchCalls, 1, "con contenido ya emitido no hay segundo envío del prompt");

    fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls += 1;
      return sseRes({
        read: async () => { throw new Error("socket hang up"); },
        cancel: async () => {},
      });
    };
    await assert.rejects(() => provider.callChat({
      apiBaseUrl: "https://api.example.test/v1", apiKey: "k", model: "m",
      messages: [{ role: "user", content: "hola" }], stream: true,
    }));
    assert.equal(fetchCalls, 2, "sin contenido emitido, el reintento transitorio sigue vivo");
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------- (5) Señal en verifier y fotos ----------

test("B6-5a: runVerifier pasa la señal a runCommand y el aborto se observa", async () => {
  const original = kernelTools.runCommand;
  let seenSignal = null;
  kernelTools.runCommand = (root, cmd, opts = {}) => {
    seenSignal = opts.signal || null;
    return new Promise((resolve) => {
      if (opts.signal?.aborted) return resolve({ ok: false, aborted: true, output: "", stderr: "", error: "Abortado" });
      opts.signal?.addEventListener("abort", () => resolve({ ok: false, aborted: true, output: "", stderr: "", error: "Abortado" }), { once: true });
    });
  };
  try {
    const ctrl = new AbortController();
    const pending = verifier.runVerifier({ projectRoot, path: "src/App.tsx", command: "npm run typecheck", signal: ctrl.signal, timeoutMs: 5000 });
    setTimeout(() => ctrl.abort(), 30);
    const out = await pending;
    assert.ok(seenSignal, "runCommand recibió una señal");
    assert.equal(seenSignal, ctrl.signal);
    assert.equal(out.aborted, true);
  } finally {
    kernelTools.runCommand = original;
  }
});

test("B6-5b: runRealVerification al abortar MATA el proceso en curso (no abandona la promesa)", async () => {
  const original = kernelTools.execute;
  let killObserved = false;
  kernelTools.execute = async (_name, _args, _root, _allow, helpers = {}) => new Promise((resolve) => {
    const sig = helpers.abortSignal;
    if (sig?.aborted) { killObserved = true; return resolve({ ok: false, aborted: true }); }
    sig?.addEventListener("abort", () => { killObserved = true; resolve({ ok: false, aborted: true }); }, { once: true });
  });
  try {
    const { runRealVerification } = require("../editcore-chat-kernel/orchestrator");
    const ctrl = new AbortController();
    const pending = runRealVerification(projectRoot, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 30);
    const out = await pending;
    assert.equal(killObserved, true, "la señal llegó al comando en curso (su abortSignal se disparó)");
    assert.equal(out.aborted, true);
  } finally {
    kernelTools.execute = original;
  }
});

test("B6-5c: fetch_stock_photo con el turno abortado durante la descarga ⇒ NO escribe el archivo", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b6-foto-"));
  const ctrl = new AbortController();
  const big = Buffer.alloc(20_000, 7);
  const fetcher = async (url) => {
    if (String(url).includes("api.openverse.org")) {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ results: [{ url: "https://img.example.test/foto.jpg", title: "taller", creator: "x", license: "CC0", foreign_landing_url: "" }] }) };
    }
    ctrl.abort(); // Detener llega mientras baja la foto
    return { ok: true, status: 200, headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "image/jpeg" : null) }, arrayBuffer: async () => big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength) };
  };
  const out = await fetchStockPhoto({ query: "taller mecanico", projectRoot: root, signal: ctrl.signal, fetcher });
  assert.equal(out.ok, false);
  assert.equal(out.aborted, true);
  assert.equal(fs.existsSync(path.join(root, "assets")), false, "ningún archivo aterrizó tras el stop");
});

// ---------- (6) Memorias semánticas con tope y señal ----------

test("B6-6a: raceSemanticBlock con una memoria que NUNCA resuelve ⇒ devuelve vacío tras el timeout declarado", async () => {
  const started = Date.now();
  const out = await raceSemanticBlock(() => new Promise(() => {}), { timeoutMs: 60 });
  assert.equal(out, "");
  assert.ok(Date.now() - started < 3000, "no se colgó");
});

test("B6-6b: turno con la memoria global colgada ⇒ arranca igual tras el timeout y responde", async () => {
  const original = globalMemory.promptBlockSemantic;
  globalMemory.promptBlockSemantic = () => new Promise(() => {});
  try {
    const orch = new ChatOrchestrator();
    const started = Date.now();
    const out = await orch.handle({
      message: "Corrige el archivo principal del proyecto",
      projectRoot,
      apiBaseUrl: "https://proxy.example.test/v1",
      apiKey: "k",
      model: "m",
      permissionMode: "full",
      helpers: {
        semanticMemoryTimeoutMs: 60,
        callChat: async () => ({ text: "Revisé el proyecto y no hace falta cambiar nada más.", toolCalls: [], usage: {} }),
      },
    });
    assert.ok(Date.now() - started < 20000, "el turno no quedó colgado en la memoria semántica");
    assert.match(out.text, /Revisé el proyecto/);
  } finally {
    globalMemory.promptBlockSemantic = original;
  }
});

// ---------- (7) 429: Retry-After + clasificación compartida ----------

test("B6-7a: taxonomía única del 429: concurrencia ≠ cuota en las tres casas", () => {
  const conc = classifyHttpError({ status: 429, code: "TOO_MANY_REQUESTS", message: "Tienes demasiadas consultas al mismo tiempo. Espera a que terminen." });
  assert.equal(conc.kind, "concurrency");
  assert.match(
    sanitizeChatProviderError(Object.assign(new Error("Tienes demasiadas consultas al mismo tiempo"), { status: 429, code: "TOO_MANY_REQUESTS" })),
    /Demasiadas peticiones simultáneas/,
  );
  const concErr = Object.assign(new Error("Too many requests"), { status: 429, code: "TOO_MANY_REQUESTS" });
  assert.equal(isBillingOrQuotaError(concErr), false, "la concurrencia NO es cuota/saldo para el failover");
  const quotaErr = Object.assign(new Error("insufficient_quota: exceeded your current quota"), { status: 429 });
  assert.equal(classifyHttpError({ error: quotaErr, status: 429 }).kind, "quota");
  assert.equal(isBillingOrQuotaError(quotaErr), true, "la cuota real conserva su trato");
  assert.equal(parseRetryAfterMs("120"), 30_000, "Retry-After con tope declarado de 30 s");
  assert.equal(parseRetryAfterMs("2"), 2_000);
});

test("B6-7b: el provider respeta Retry-After en el 429 antes de reintentar", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  const headers429 = { get: (n) => ({ "content-type": "application/json", "retry-after": "2" }[String(n).toLowerCase()] || null) };
  try {
    global.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return { ok: false, status: 429, headers: headers429, text: async () => JSON.stringify({ error: { code: "TOO_MANY_REQUESTS", message: "Tienes demasiadas consultas al mismo tiempo" } }) };
      }
      return {
        ok: true, status: 200,
        headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "application/json" : null) },
        text: async () => JSON.stringify({ choices: [{ message: { content: "ok tras esperar" } }] }),
      };
    };
    const started = Date.now();
    const out = await provider.callChat({
      apiBaseUrl: "https://api.example.test/v1", apiKey: "k", model: "m",
      messages: [{ role: "user", content: "hola" }], stream: false,
    });
    const elapsed = Date.now() - started;
    assert.equal(out.text, "ok tras esperar");
    assert.equal(fetchCalls, 2);
    assert.ok(elapsed >= 1900, `esperó según Retry-After (2 s), no el backoff fijo: ${elapsed} ms`);
    assert.ok(elapsed < 15000, "la espera está acotada");
  } finally {
    global.fetch = originalFetch;
  }
});
